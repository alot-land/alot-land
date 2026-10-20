/**
 * Lead storage.
 *
 * Netlify Blobs, deliberately — NOT Supabase. The free Supabase tier auto-pauses
 * after inactivity and comes back as an NXDOMAIN "failed to fetch", which has
 * already bitten this account on another project. A store that sleeps is the
 * wrong place for buyer enquiries that cost money to generate. Blobs is part of
 * the platform the site already runs on: no extra service, no keys to leak, no
 * pause, strongly consistent reads.
 *
 * Everything the rest of the system needs goes through this file, so moving to
 * Postgres later means rewriting this one module and nothing else.
 */
import { getStore } from '@netlify/blobs';

const LEADS = 'stv-leads';
const INDEX = 'stv-lead-index';

/**
 * Netlify injects the Blobs environment into v2 functions automatically. The
 * classic `handler` style does NOT get it, which is why every function touching
 * this store uses the v2 signature — a personal API token cannot stand in,
 * because tokens are treated as a build context and may only write
 * deploy-scoped stores.
 */
const store = (name) => getStore({ name, consistency: 'strong' });

/** Random, unguessable id — these appear in URLs sent by text message. */
export function newId() {
  const b = new Uint8Array(16);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export async function getLead(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id ?? ''))) return null;
  return await store(LEADS).get(id, { type: 'json' });
}

export async function putLead(lead) {
  await store(LEADS).setJSON(lead.id, lead);
  return lead;
}

/**
 * Claim a dedupe key for a lead, atomically enough for our volume.
 *
 * Returns the EXISTING id if this person already enquired about this lot inside
 * the window, so a double-tap on a phone cannot create two records and two
 * texts to Tony.
 */
export async function claimDedupe(key, id, windowHours = 72) {
  if (!key) return { claimed: true, existingId: null };
  const s = store(INDEX);
  const k = 'dedupe:' + encodeURIComponent(key);
  const prior = await s.get(k, { type: 'json' });
  if (prior && Date.now() - prior.t < windowHours * 36e5) {
    return { claimed: false, existingId: prior.id };
  }
  await s.setJSON(k, { id, t: Date.now() });
  return { claimed: true, existingId: null };
}

/**
 * Point a dedupe key at the real lead id once it exists.
 * claimDedupe deliberately refuses to overwrite a live claim, so confirming the
 * placeholder needs its own call — otherwise a duplicate submission is told
 * about a lead id of "pending", which is useless to everyone downstream.
 */
export async function confirmDedupe(key, id) {
  if (!key) return;
  await store(INDEX).setJSON('dedupe:' + encodeURIComponent(key), { id, t: Date.now() });
}

/**
 * Netlify's submission id → our lead id.
 *
 * Two jobs. It makes this function idempotent, because Netlify can retry a
 * submission-created event and a retry must not make a second lead or a second
 * text to Tony. And it is the join reconciliation uses to find submissions
 * Netlify accepted that never became a lead.
 */
export async function linkSubmission(submissionId, leadId) {
  if (!submissionId) return;
  await store(INDEX).setJSON('sub:' + submissionId, { leadId, t: Date.now() });
}

export async function leadBySubmission(submissionId) {
  if (!submissionId) return null;
  const v = await store(INDEX).get('sub:' + submissionId, { type: 'json' });
  return v?.leadId ?? null;
}

/** Append-only id list, so listing never has to scan the blob store. */
export async function indexLead(id, createdAt) {
  const s = store(INDEX);
  const cur = (await s.get('all', { type: 'json' })) ?? { ids: [] };
  if (!cur.ids.some(x => x.id === id)) cur.ids.push({ id, at: createdAt });
  await s.setJSON('all', cur);
}

export async function listLeads({ limit = 200 } = {}) {
  const idx = (await store(INDEX).get('all', { type: 'json' })) ?? { ids: [] };
  const recent = idx.ids.slice(-limit).reverse();
  const out = [];
  for (const { id } of recent) {
    const l = await getLead(id);
    if (l) out.push(l);
  }
  return out;
}

/** Small durable flags — used for alert and report deduplication. */
export async function getFlag(key) {
  return await store(INDEX).get('flag:' + key, { type: 'json' });
}
export async function setFlag(key, value) {
  await store(INDEX).setJSON('flag:' + key, value);
}

/**
 * Atomic create-only write. Returns true only for the caller that created it.
 *
 * This is what makes a notification claim safe under concurrency. A read then a
 * write is not a claim: two events arriving together both read "nothing there",
 * both write, and the buyer gets alerted twice. `onlyIfNew` is resolved by the
 * store, so exactly one caller can ever win.
 */
export async function createFlagIfAbsent(key, value) {
  const res = await store(INDEX).setJSON('flag:' + key, value, { onlyIfNew: true });
  return res?.modified === true;
}

/** Remove a lead outright. Used to purge synthetic test records. */
export async function removeLead(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id ?? ''))) return;
  await store(LEADS).delete(id);
  const idx = store(INDEX);
  const cur = (await idx.get('all', { type: 'json' })) ?? { ids: [] };
  await idx.setJSON('all', { ids: cur.ids.filter(x => x.id !== id) });
}

/** The latest exception report, for the dashboard to read instead of email. */
export async function putReport(report) {
  await store(INDEX).setJSON('report', report);
}
export async function getReport() {
  return await store(INDEX).get('report', { type: 'json' });
}

/**
 * Failed downstream work (an email that would not send, an SMS provider that
 * was down) is parked here rather than thrown away, so it can be retried and
 * so the daily report can say what is still broken.
 */
export async function queueFailure(job) {
  const s = store(INDEX);
  const cur = (await s.get('failures', { type: 'json' })) ?? { jobs: [] };
  cur.jobs.push({ ...job, at: new Date().toISOString(), attempts: job.attempts ?? 1 });
  await s.setJSON('failures', cur);
}

export async function listFailures() {
  return ((await store(INDEX).get('failures', { type: 'json' })) ?? { jobs: [] }).jobs;
}

export async function replaceFailures(jobs) {
  await store(INDEX).setJSON('failures', { jobs });
}

/** Spam is kept, never deleted — a false positive must be recoverable. */
export async function quarantine(record) {
  const s = store(INDEX);
  const cur = (await s.get('spam', { type: 'json' })) ?? { items: [] };
  cur.items.push({ ...record, at: new Date().toISOString() });
  await s.setJSON('spam', cur);
}

export async function listQuarantine() {
  return ((await store(INDEX).get('spam', { type: 'json' })) ?? { items: [] }).items;
}

export const isConfigured = () => {
  // Blobs needs a deploy context; locally `netlify dev` provides it.
  try { getStore({ name: LEADS }); return true; } catch { return false; }
};
