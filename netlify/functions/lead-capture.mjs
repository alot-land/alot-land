/**
 * Lead intake. The one path a buyer enquiry travels.
 *
 * Order matters and is deliberate:
 *   validate → spam check → dedupe claim → STORE → respond → notify
 *
 * The lead is durably stored before the browser is told "thank you", and
 * before any email or text is attempted. If storage fails the caller gets an
 * error and a phone number, never a false success — the brief's hard rule.
 * Notification failures are recorded and queued, and never undo the capture.
 */
import { validate, looksLikeSpam, dedupeKey, newLead } from '../../lead-engine/lead.mjs';
import * as store from '../../lead-engine/store.mjs';
import { notifyAll, acknowledgeBuyer } from '../../lead-engine/notify.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const FALLBACK = { phone: '(615) 538-6878', text: 'Call or text us on (615) 538-6878 and we will pick it up.' };

/** Coarse IP hash: enough to evidence consent, not enough to identify anyone. */
async function hashIp(ip) {
  if (!ip) return null;
  const buf = new TextEncoder().encode('alot-land:' + ip);
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  let input;
  try { input = await req.json(); } catch { return json(400, { error: 'Bad request.', fallback: FALLBACK }); }

  const v = validate(input);
  if (!v.ok) return json(422, { error: 'Please check the form.', fields: v.errors });

  const siteUrl = (process.env.URL || 'https://alot.land').replace(/\/$/, '');

  // Spam is quarantined, never dropped: a false positive has to be recoverable.
  const spam = looksLikeSpam(input);
  if (spam) {
    try { await store.quarantine({ reason: spam, input: v.value, attribution: input.attribution ?? {} }); } catch {}
    // Answer exactly as a success would, so a bot learns nothing.
    return json(200, { ok: true, deduped: false });
  }

  const key = dedupeKey(v.value);
  let claim = { claimed: true, existingId: null };
  try {
    claim = await store.claimDedupe(key, 'pending');
  } catch (e) {
    return json(503, { error: 'We could not record that just now.', fallback: FALLBACK });
  }
  if (!claim.claimed) {
    // Same person, same lot, within the window — acknowledge without a second
    // record and without texting Tony twice.
    return json(200, { ok: true, deduped: true, id: claim.existingId });
  }

  const id = store.newId();
  const lead = newLead({
    id,
    value: v.value,
    attribution: input.attribution ?? {},
    meta: {
      lotName: String(input.lotName ?? '').slice(0, 80),
      lotPrice: String(input.lotPrice ?? '').slice(0, 40),
      consentText: String(input.consentText ?? '').slice(0, 400),
      ipHash: await hashIp(context?.ip || req.headers.get('x-nf-client-connection-ip')),
      source: 'website',
    },
  });

  // ── The only step allowed to fail the request ──────────────────────────
  try {
    await store.putLead(lead);
    await store.confirmDedupe(key, id);
    await store.indexLead(id, lead.createdAt);
  } catch (e) {
    return json(503, {
      error: 'We could not record that just now — please call so we do not lose you.',
      fallback: FALLBACK,
      detail: String(e.message ?? e).slice(0, 200),
    });
  }

  // Stored. From here nothing may turn this into a failure for the buyer.
  try {
    const attempts = await notifyAll(lead, { siteUrl });
    const ack = await acknowledgeBuyer(lead, { siteUrl });
    const saved = { ...lead, notifications: attempts, acknowledgement: ack };
    await store.putLead(saved);
    const broken = attempts.filter(a => a.status === 'failed');
    if (broken.length || ack.status === 'failed') {
      await store.queueFailure({ leadId: id, kind: 'notify', attempts: 1, detail: { broken, ack } });
    }
  } catch (e) {
    try { await store.queueFailure({ leadId: id, kind: 'notify-crash', detail: String(e.message ?? e).slice(0, 300) }); } catch {}
  }

  return json(200, { ok: true, id, deduped: false });
};

export const config = { path: '/api/lead' };
