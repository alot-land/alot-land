/**
 * Reconciliation and the daily exception report.
 *
 * Netlify Forms holds the primary record; Blobs holds the working one. This
 * compares them and repairs the gap. The rule the brief insists on, and the
 * right one: an unresolved failure is never quietly marked successful. Anything
 * that cannot be repaired is reported, loudly, with what is still wrong.
 */
import * as store from './store.mjs';
import { validate, looksLikeSpam, dedupeKey, newLead, isUnacknowledged, isOverdue, STAGE_LABEL, CLOSED_STAGES } from './lead.mjs';
import { notifyOwner } from './notify.mjs';

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

      // A rebuilt lead is NOT a new arrival. Agents are never told, and the
      // buyer is not acknowledged either — an auto-reply days late reads worse
      // than silence. The owner is told so a human can decide how to hand it on.
      const told = await notifyOwner({
        subject: `Recovered lead needing handoff — ${lead.name} · ${lead.lotName || lead.lot}`,
        text: [`Reconciliation found a submission that was never processed into a lead.`,
               `It has been rebuilt and is in the dashboard. Nobody has been contacted.`, '',
               `${lead.name} · ${lead.phone || lead.email || 'no contact'} · ${lead.lotName || lead.lot}`,
               `Submitted ${sub.created_at}`, '',
               `${siteUrl}/lead/?id=${id}`, '',
               `Decide whether to pass it to Tony — it is not new, and should not be`,
               `presented to the buyer as though it just arrived.`].join('\n'),
      }).catch(e => ({ status: 'failed', error: String(e.message ?? e) }));
      await store.putLead({ ...lead, notifications: [{ channel: 'email', to: 'owner', at: new Date().toISOString(),
        status: told?.status ?? 'unknown', reason: 'recovered lead — owner notified, agents not' }] });
      repaired.push({ submissionId: sub.id, leadId: id, ownerNotified: told?.status });
    } catch (e) {
      failed.push({ submissionId: sub.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  return { repaired, failed };
}

/** Retry parked notification jobs. Anything still broken stays parked. */
/**
 * Historical notification failures are NOT retried to agents.
 *
 * A retry of a days-old alert reads to Tony as a brand-new buyer. The job is
 * reported to the owner through the dashboard instead, and marked so it stops
 * being counted as pending work forever.
 */
export async function retryFailures() {
  const jobs = await store.listFailures();
  const agentJobs = jobs.filter(j => j.kind === 'notify');
  if (agentJobs.length) {
    await store.replaceFailures(jobs.map(j => j.kind === 'notify'
      ? { ...j, abandoned: true, note: 'agent notification not retried by policy — see the dashboard' }
      : j));
  }
  return { retried: [], stillFailing: [], abandoned: agentJobs.map(j => ({ leadId: j.leadId })),
           policy: 'historical agent notifications are never automatically retried' };
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

/**
 * The owner's daily report. Sales first, problems second — a report that opens
 * with errors gets read as a system alert and stops being opened.
 */
export function dailyReport(leads, exceptions, { siteUrl, now = new Date() } = {}) {
  const since = (h) => new Date(now.getTime() - h * 36e5);
  const open = leads.filter(l => !CLOSED_STAGES.has(l.stage));
  const inStage = (...st) => leads.filter(l => st.includes(l.stage));
  const newToday = leads.filter(l => new Date(l.createdAt) >= since(24));

  const bySource = {};
  for (const l of newToday) {
    const k = l.attribution?.utm_source || 'direct';
    bySource[k] = (bySource[k] ?? 0) + 1;
  }
  const byLot = {};
  for (const l of open) {
    const k = l.lotName || l.lot || 'unknown';
    byLot[k] = (byLot[k] ?? 0) + 1;
  }

  const L = [];
  L.push('ALOT OF LAND — DAILY SALES & LEAD REPORT', fmtDay(now), '');
  L.push(`New inquiries (24h):  ${newToday.length}`);
  L.push(`Active prospects:     ${open.length}`);
  L.push(`Contacted:            ${inStage('contacted', 'qualified').length}`);
  L.push(`Showings scheduled:   ${inStage('showing_scheduled').length}`);
  L.push(`Offers:               ${inStage('offer', 'under_contract').length}`);
  L.push(`Closed:               ${inStage('closed').length}`);
  L.push('');

  if (Object.keys(byLot).length) {
    L.push('BY LOT');
    Object.entries(byLot).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => L.push(`  ${String(n).padStart(3)}  ${k}`));
    L.push('');
  }
  if (Object.keys(bySource).length) {
    L.push('WHERE TODAY\'S INQUIRIES CAME FROM');
    Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => L.push(`  ${String(n).padStart(3)}  ${k}`));
    L.push('');
  }

  const attention = [];
  exceptions.unacknowledged.forEach(x => attention.push(`Nobody has opened ${x.name} · ${x.lot} — ${siteUrl}/lead/?id=${x.id}`));
  exceptions.overdue.forEach(x => attention.push(`No contact in 24h: ${x.name} · ${x.lot}`));
  exceptions.notificationsFailed.forEach(x => attention.push(`Notification failed: ${x.name} · ${x.lot}`));
  exceptions.notificationsNeverSent.forEach(x => attention.push(`Never notified (no provider configured): ${x.name}`));
  if (exceptions.parkedJobs) attention.push(`${exceptions.parkedJobs} job(s) unresolved — not retried to agents by policy`);
  exceptions.spamForReview.slice(0, 5).forEach(x => attention.push(`Held as spam, check it is not real: ${x.name} (${x.reason})`));

  L.push('NEEDS ATTENTION');
  if (attention.length) attention.forEach(a => L.push(`  · ${a}`));
  else L.push('  Nothing outstanding.');
  L.push('');
  L.push(`Leads: ${siteUrl}/crm/`);
  return L.join('\n');
}

const fmtDay = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
}).format(d);

/** Local wall-clock parts in Chicago, so DST is handled by the platform. */
export function chicagoNow(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

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
