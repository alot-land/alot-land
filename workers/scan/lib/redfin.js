/**
 * Redfin access layer — ported from AlotOfLand/redfin-comps (HANDOFF-MFDA.md).
 *
 * HARD RULES (inherited, non-negotiable):
 *  - Identify as a normal browser via the UA below. ~1 request / 1.5s, globally
 *    serialized.
 *  - No CAPTCHA solving, no proxy rotation, no IP spoofing, no login
 *    automation, no fingerprint evasion.
 *  - If Redfin blocks: STOP and surface it. Never escalate, never fail silent.
 *  - Respect the 350-listing cap; narrow the search rather than hammer.
 */

export const NUM_HOMES_CAP = 350;
const MIN_GAP_MS = 1500;

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Verified parameter vocabulary (do not "improve" — cargo-culted from the real
// site request and confirmed live 2026-07-21).
export const UIPT = { house: 1, condo: 2, townhouse: 3, multifamily: 4, land: 5 };
export const STATUS_BITS = { active: 1, contingent: 2, comingsoon: 4, pending: 128 };
export const SOLD_ONLY = 8;
export const SOLD_DAYS = [7, 30, 90, 180, 365, 730, 1095, 1825];

// Global 1.5s-gap serializer. Per-process; the worker is a single process so
// this is a true global limiter here (unlike the serverless original).
let lastRequestAt = 0;
let queue = Promise.resolve();

export function politeFetch(url, fetchImpl = fetch, extraHeaders = {}) {
  const run = async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fetchImpl(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/csv,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
      redirect: 'follow',
      cache: 'no-store',
    });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/**
 * Build a gis-csv URL. Polygon mode only — it works in any state with no
 * region-id resolution (the repo's region index is TN-only) and crosses
 * county/state lines freely.
 *
 * q: {
 *   poly: string            // "lng lat,lng lat,..." closed ring
 *   statuses: {active,pending,comingsoon,sold}  // sold is exclusive (bit 8)
 *   soldWithinDays?: number // only with sold
 *   minPrice?, maxPrice?: number
 * }
 */
export function gisCsvUrl(q) {
  const p = new URLSearchParams();
  p.set('al', '1');
  p.set('uipt', String(UIPT.multifamily));
  p.set('sf', '1,2,3,5,6,7');
  p.set('num_homes', String(NUM_HOMES_CAP));
  p.set('v', '8');

  if (q.statuses.sold) {
    // Special case: 8 = sold-only. Not OR-able with active bits.
    p.set('status', String(SOLD_ONLY));
    const days = q.soldWithinDays ?? 365;
    if (!SOLD_DAYS.includes(days)) throw new Error(`sold_within_days must be one of ${SOLD_DAYS}`);
    p.set('sold_within_days', String(days));
  } else {
    let bits = 0;
    if (q.statuses.active) bits |= STATUS_BITS.active;
    if (q.statuses.contingent) bits |= STATUS_BITS.contingent;
    if (q.statuses.comingsoon) bits |= STATUS_BITS.comingsoon;
    if (q.statuses.pending) bits |= STATUS_BITS.pending;
    if (!bits) throw new Error('no statuses requested');
    p.set('status', String(bits));
  }

  if (q.minPrice != null) p.set('min_price', String(Math.round(q.minPrice)));
  if (q.maxPrice != null) p.set('max_price', String(Math.round(q.maxPrice)));
  p.set('poly', q.poly);

  return `https://www.redfin.com/stingray/api/gis-csv?${p.toString()}`;
}

/**
 * Fetch a gis-csv URL. Returns { ok, blocked, text }.
 * Block detection is CONTENT-based: a WAF challenge can arrive as HTTP 200
 * HTML. A leading '<' or missing CSV headers counts as blocked — this check is
 * what keeps a challenge page from being recorded as "zero listings".
 */
export async function fetchGisCsv(url, fetchImpl = fetch) {
  let res;
  try {
    res = await politeFetch(url, fetchImpl);
  } catch (e) {
    return { ok: false, blocked: false, text: null, error: String(e) };
  }
  if (!res.ok) return { ok: false, blocked: res.status === 403, text: null, error: `HTTP ${res.status}` };
  const text = await res.text();
  if (/^\s*</.test(text) || !/SALE TYPE|PROPERTY TYPE|PRICE/.test(text.slice(0, 500))) {
    return { ok: false, blocked: true, text: null, error: 'HTML/challenge response' };
  }
  return { ok: true, blocked: false, text };
}
