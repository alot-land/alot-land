/**
 * Reconciliation and the daily exception report.
 *
 * Netlify Forms holds the primary record; Blobs holds the working one. This
 * compares them and repairs the gap. The rule the brief insists on, and the
 * right one: an unresolved failure is never quietly marked successful. Anything
 * that cannot be repaired is reported, loudly, with what is still wrong.
 */
import * as store from './store.mjs';
import { validate, looksLikeSpam, dedupeKey, newLead, isUnacknowledged, isOverdue, STAGE_LABEL } from './lead.mjs';
import { notifyAll, acknowledgeBuyer } from './notify.mjs';

const FORM_NAME = 'stv-lead';

/** Netlify's own record of what buyers submitted. Needs a read-only API token. */
export async function fetchSubmissions({ siteId, token, days = 7 }) {
  if (!siteId || !token) return { ok: false, reason: 'NETLIFY_API_TOKEN or SITE_ID not set', submissions: [] };
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/submissions?per_page=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, reason: `netlify api ${res.status}`, submissions: [] };
  const all = await res.json();
  const since = Date.now() - days * 864e5;
  return {
    ok: true,
    submissions: all
      .filter(s => (s.form_name === FORM_NAME) && new Date(s.created_at).getTime() >= since),
  };
}

/**
 * Rebuild any lead Netlify accepted that never became a working record.
 * This is the safety net that makes the two stores genuinely independent.
 */
export async function repairMissing({ submissions, siteUrl, dryRun = false }) {
  const repaired = [], failed = [];
  for (const sub of submissions) {
    const existing = await store.leadBySubmission(sub.id);
    if (existing) continue;

    const d = sub.data || {};
    const input = {
      name: d.name, phone: d.phone, email: d.email, lot: d.lot,
      inquiryType: d.inquiryType, message: d.message,
      consent: d.consent === 'true' || d.consent === true,
      company: d.company, renderedAt: Number(d.renderedAt) || undefined,
    };
    const v = validate(input);
    if (!v.ok || looksLikeSpam(input)) continue;   // already quarantined by design

    if (dryRun) { repaired.push({ submissionId: sub.id, wouldCreate: true }); continue; }

    try {
      let attribution = {};
      try { attribution = typeof d.attribution === 'string' ? JSON.parse(d.attribution) : (d.attribution || {}); } catch {}
      const key = dedupeKey(v.value);
      const claim = await store.claimDedupe(key, 'pending');
      if (!claim.claimed) { await store.linkSubmission(sub.id, claim.existingId); continue; }

      const id = store.newId();
      const lead = newLead({ id, value: v.value, attribution, meta: {
        lotName: d.lotName || '', lotPrice: d.lotPrice || '', consentText: d.consentText || '', source: 'reconciliation',
      }, now: new Date(sub.created_at) });
      lead.submissionId = sub.id;
      lead.flags = ['rebuilt-by-reconciliation'];

      await store.putLead(lead);
      await store.confirmDedupe(key, id);
      await store.indexLead(id, lead.createdAt);
      await store.linkSubmission(sub.id, id);

      const attempts = await notifyAll(lead, { siteUrl });
      const ack = await acknowledgeBuyer(lead, { siteUrl });
      await store.putLead({ ...lead, notifications: attempts, acknowledgement: ack });
      repaired.push({ submissionId: sub.id, leadId: id });
    } catch (e) {
      failed.push({ submissionId: sub.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  return { repaired, failed };
}

/** Retry parked notification jobs. Anything still broken stays parked. */
export async function retryFailures({ siteUrl, maxAttempts = 4, dryRun = false }) {
  const jobs = await store.listFailures();
  if (!jobs.length) return { retried: [], stillFailing: [], abandoned: [] };
  const retried = [], stillFailing = [], abandoned = [], keep = [];

  for (const job of jobs) {
    if (job.kind !== 'notify' || !job.leadId) { keep.push(job); continue; }
    if ((job.attempts || 1) >= maxAttempts) { abandoned.push(job); keep.push({ ...job, abandoned: true }); continue; }
    if (dryRun) { retried.push({ leadId: job.leadId, dryRun: true }); keep.push(job); continue; }

    const lead = await store.getLead(job.leadId);
    if (!lead) { keep.push({ ...job, note: 'lead missing' }); stillFailing.push(job); continue; }
    try {
      const attempts = await notifyAll(lead, { siteUrl });
      const broken = attempts.filter(a => a.status === 'failed');
      await store.putLead({ ...lead, notifications: [...(lead.notifications || []), ...attempts] });
      if (broken.length) { keep.push({ ...job, attempts: (job.attempts || 1) + 1 }); stillFailing.push({ leadId: job.leadId, broken }); }
      else retried.push({ leadId: job.leadId });
    } catch (e) {
      keep.push({ ...job, attempts: (job.attempts || 1) + 1, lastError: String(e.message || e).slice(0, 200) });
      stillFailing.push({ leadId: job.leadId, error: String(e.message || e).slice(0, 200) });
    }
  }
  if (!dryRun) await store.replaceFailures(keep);
  return { retried, stillFailing, abandoned };
}

/** What a person needs to look at today. */
export async function buildExceptionReport({ now = new Date(), siteUrl } = {}) {
  const leads = await store.listLeads({ limit: 500 });
  const unacknowledged = leads.filter(l => isUnacknowledged(l, { now }));
  const overdue = leads.filter(l => isOverdue(l, { now }));
  const notifyBroken = leads.filter(l => (l.notifications || []).some(n => n.status === 'failed'));
  const notifySkipped = leads.filter(l => (l.notifications || []).every(n => n.status === 'skipped'));
  const unassigned = leads.filter(l => !l.assignedTo);
  const failures = await store.listFailures();
  const spam = await store.listQuarantine();
  const recentSpam = spam.filter(s => now - new Date(s.at) < 7 * 864e5);

  return {
    generatedAt: now.toISOString(),
    totals: { leads: leads.length, open: leads.filter(l => !['closed', 'lost'].includes(l.stage)).length },
    unacknowledged: unacknowledged.map(brief),
    overdue: overdue.map(brief),
    notificationsFailed: notifyBroken.map(brief),
    notificationsNeverSent: notifySkipped.map(brief),
    unassigned: unassigned.map(brief),
    parkedJobs: failures.length,
    spamForReview: recentSpam.map(s => ({ at: s.at, reason: s.reason, name: s.raw?.name || s.input?.name || '—' })),
    siteUrl,
  };
}

const brief = l => ({
  id: l.id, name: l.name, lot: l.lotName || l.lot, stage: STAGE_LABEL[l.stage] || l.stage,
  createdAt: l.createdAt, source: l.attribution?.utm_source || 'direct',
});

export function reportToText(r) {
  const L = [];
  const section = (title, rows, fmt) => {
    if (!rows.length) return;
    L.push(`${title} (${rows.length})`);
    rows.slice(0, 25).forEach(x => L.push('  · ' + fmt(x)));
    L.push('');
  };
  L.push(`Sugar Tree leads — exception report`, `${r.totals.leads} leads, ${r.totals.open} open`, '');
  section('NOT ACKNOWLEDGED — nobody has picked these up', r.unacknowledged, x => `${x.name} · ${x.lot} · ${x.source} · ${r.siteUrl}/lead/?id=${x.id}`);
  section('NO CONTACT IN 24 HOURS', r.overdue, x => `${x.name} · ${x.lot} · ${r.siteUrl}/lead/?id=${x.id}`);
  section('NOTIFICATIONS FAILED', r.notificationsFailed, x => `${x.name} · ${x.lot}`);
  section('NOTIFICATIONS NEVER SENT (no provider configured)', r.notificationsNeverSent, x => `${x.name} · ${x.lot}`);
  section('SPAM HELD FOR REVIEW — check for false positives', r.spamForReview, x => `${x.at.slice(0, 16)} · ${x.reason} · ${x.name}`);
  if (r.parkedJobs) L.push(`${r.parkedJobs} job(s) still parked and unresolved.`, '');
  if (!r.unacknowledged.length && !r.overdue.length && !r.notificationsFailed.length && !r.notificationsNeverSent.length && !r.parkedJobs) {
    L.push('Nothing outstanding.');
  }
  return L.join('\n');
}
