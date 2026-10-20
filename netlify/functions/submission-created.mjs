/**
 * Turns a Netlify Forms submission into a working lead record.
 *
 * Netlify Forms is the PRIMARY record: the browser posts straight to Netlify
 * and they store it before any of this runs. That is what makes it an
 * independent backup rather than a second write in the same pipeline — if
 * everything below throws, the submission is still in Netlify's dashboard and
 * reconciliation will find it and rebuild the lead.
 *
 * So this function must never be the reason a buyer is lost, and it never
 * reports failure back to the visitor: by the time it runs, the visitor has
 * already been thanked by Netlify.
 */
import { validate, looksLikeSpam, dedupeKey, newLead } from '../../lead-engine/lead.mjs';
import * as store from '../../lead-engine/store.mjs';
import { notifyAgentsOfNewLead, acknowledgeBuyer } from '../../lead-engine/notify.mjs';
import { assessEligibility, authorise, claimDelivery, AGENT_TRIGGER } from '../../lead-engine/policy.mjs';

// v2 function signature on purpose: the classic `handler` style does not get
// the Netlify Blobs environment injected, which fails with "the environment has
// not been configured to use Netlify Blobs".
export default async (req) => {
  let payload;
  try {
    payload = (await req.json()).payload;
  } catch {
    return new Response('bad payload', { status: 400 });
  }
  if (!payload) return new Response('no payload', { status: 400 });
  if (payload.form_name && payload.form_name !== 'stv-lead') {
    return new Response('ignored: ' + payload.form_name, { status: 200 });
  }

  const d = payload.data || {};
  const siteUrl = (process.env.URL || 'https://alot.land').replace(/\/$/, '');

  let attribution = {};
  try { attribution = typeof d.attribution === 'string' ? JSON.parse(d.attribution) : (d.attribution || {}); } catch {}

  const input = {
    name: d.name, phone: d.phone, email: d.email, lot: d.lot,
    inquiryType: d.inquiryType, message: d.message,
    consent: d.consent === 'true' || d.consent === true || d.consent === 'on',
    company: d.company, renderedAt: Number(d.renderedAt) || undefined,
  };

  const v = validate(input);
  if (!v.ok) {
    // Netlify still holds the raw submission; park the reason so the daily
    // report can show a human what arrived malformed rather than losing it.
    await safely(() => store.quarantine({ reason: 'invalid', errors: v.errors, raw: d, submissionId: payload.id }));
    return new Response('invalid, quarantined', { status: 200 });
  }

  const spam = looksLikeSpam(input);
  if (spam) {
    await safely(() => store.quarantine({ reason: spam, raw: d, submissionId: payload.id, attribution }));
    return new Response('spam, quarantined', { status: 200 });
  }

  // Idempotent on Netlify's own submission id: Netlify may retry this event,
  // and a retry must not produce a second lead or a second text to Tony.
  const already = await safely(() => store.leadBySubmission(payload.id));
  if (already) return new Response('already processed: ' + already, { status: 200 });

  const key = dedupeKey(v.value);
  const claim = await safely(() => store.claimDedupe(key, 'pending'), { claimed: true, existingId: null });
  if (!claim.claimed) {
    await safely(() => store.linkSubmission(payload.id, claim.existingId));
    return new Response('duplicate of ' + claim.existingId, { status: 200 });
  }

  const id = store.newId();
  const lead = newLead({
    id,
    value: v.value,
    attribution,
    meta: {
      lotName: String(d.lotName || '').slice(0, 80),
      lotPrice: String(d.lotPrice || '').slice(0, 40),
      consentText: String(d.consentText || '').slice(0, 400),
      source: 'netlify-forms',
    },
  });
  lead.submissionId = payload.id || null;
  lead.submittedFrom = String(d.pageUrl || '').slice(0, 200);

  try {
    await store.putLead(lead);
    await store.confirmDedupe(key, id);
    await store.indexLead(id, lead.createdAt);
    await store.linkSubmission(payload.id, id);
  } catch (e) {
    // Reconciliation will see a Netlify submission with no lead and rebuild it.
    await safely(() => store.queueFailure({ kind: 'store', submissionId: payload.id, detail: String(e.message || e).slice(0, 300), raw: d }));
    console.error('[submission-created] store failed:', e && (e.stack || e.message || e));
    return new Response('store failed: ' + String(e.message || e).slice(0, 160), { status: 200 });
  }

  // Agents are notified only if this is an eligible new-buyer enquiry AND the
  // delivery has not already been claimed for this submission. Both must pass;
  // either failing means the lead is kept and the owner can act on it.
  const eligibility = assessEligibility(lead, { formName: payload.form_name });
  let attempts = [];
  if (!eligibility.ok) {
    attempts = [{ channel: 'all', to: '-', at: new Date().toISOString(), status: 'skipped',
                  reason: 'not eligible: ' + eligibility.reasons.join('; ') }];
  } else {
    const claim = await safely(() => claimDelivery(store, { submissionId: payload.id, destination: 'agents' }),
                               { claimed: false, reason: 'claim failed' });
    if (!claim.claimed) {
      attempts = [{ channel: 'all', to: '-', at: new Date().toISOString(), status: 'skipped', reason: claim.reason }];
    } else {
      const authorisation = authorise({
        trigger: AGENT_TRIGGER, submissionId: payload.id, destinations: { email: true, sms: true },
      });
      attempts = await safely(() => notifyAgentsOfNewLead(lead, { siteUrl, authorisation }), []);
    }
  }
  lead.eligibility = eligibility;

  const ack = await safely(() => acknowledgeBuyer(lead, { siteUrl }), { status: 'failed', error: 'notify crashed' });
  await safely(() => store.putLead({ ...lead, notifications: attempts, acknowledgement: ack }));

  const broken = (attempts || []).filter(a => a.status === 'failed');
  if (broken.length || ack?.status === 'failed') {
    await safely(() => store.queueFailure({ kind: 'notify', leadId: id, attempts: 1, detail: { broken, ack } }));
  }
  return new Response('lead ' + id, { status: 200 });
};

/** Never let a secondary step throw out of this function. */
async function safely(fn, fallback = null) {
  try { return await fn(); } catch { return fallback; }
}
