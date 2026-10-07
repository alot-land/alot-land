/**
 * RentCast rent-estimate proxy.
 *
 * The app supplies its bearer and initiating orgId. Auth validates identity;
 * an RLS-scoped membership read authorizes the org before any RentCast call.
 * Only the server adds the RentCast key. No service-role key is required.
 *
 * Feature-flagged by the presence of RENTCAST_API_KEY. With no key set the
 * function answers 501 and the app silently keeps using its free zip bands —
 * nothing breaks, the button just explains itself.
 *
 * Quota discipline: this is called at UNDERWRITE time for one address, never
 * for the parcel sweep. RentCast's free tier is 50 requests/month, which is
 * ample for per-deal use and would evaporate in seconds on a 12,000-parcel
 * list. The app caches every result in the rent_estimates table.
 */
const RENTCAST_URL = 'https://api.rentcast.io/v1/avm/rent/long-term';

const json = (status, body, contacted = false) => new Response(JSON.stringify({ ...body, rentcast_contacted: contacted }), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(request, orgId) {
  const authorization = request.headers.get('authorization');
  if (!/^Bearer \S+$/i.test(authorization || '')) {
    return json(401, { error: 'unauthorized', message: 'Authentication required.' });
  }
  if (!uuid.test(orgId || '')) {
    return json(403, { error: 'forbidden', message: 'Organization access required.' });
  }
  // These are trusted deployment settings, never URL/header inputs. The public
  // anon key plus the caller's bearer preserves RLS; never use a service role.
  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !anonKey) return json(503, { error: 'authorization_unavailable', message: 'Authorization unavailable.' });
  try {
    const headers = { apikey: anonKey, Authorization: authorization, Accept: 'application/json' };
    const auth = await fetch(`${base}/auth/v1/user`, { headers, redirect: 'error', cache: 'no-store' });
    if (auth.status === 401 || auth.status === 403) return json(401, { error: 'unauthorized', message: 'Authentication required.' });
    if (!auth.ok) throw new Error('auth unavailable');
    const user = await auth.json();
    if (!uuid.test(user?.id || '')) return json(401, { error: 'unauthorized', message: 'Authentication required.' });
    const params = new URLSearchParams({ select: 'org_id,user_id', org_id: `eq.${orgId}`, user_id: `eq.${user.id}`, limit: '1' });
    const membership = await fetch(`${base}/rest/v1/org_members?${params}`, { headers, redirect: 'error', cache: 'no-store' });
    if (!membership.ok) throw new Error('membership unavailable');
    const rows = await membership.json();
    if (!Array.isArray(rows)) throw new Error('invalid membership response');
    if (!rows.some(row => row.org_id === orgId && row.user_id === user.id)) {
      return json(403, { error: 'forbidden', message: 'Organization access required.' });
    }
    return null;
  } catch {
    // Never echo Auth/PostgREST bodies, tokens, settings or exception details.
    return json(503, { error: 'authorization_unavailable', message: 'Authorization unavailable.' });
  }
}

/** Query string for RentCast — only parameters we actually have. */
export function buildQuery({ address, propertyType, bedrooms, bathrooms, squareFootage }) {
  const p = new URLSearchParams({ address });
  if (propertyType) p.set('propertyType', propertyType);
  if (bedrooms != null && bedrooms !== '') p.set('bedrooms', String(bedrooms));
  if (bathrooms != null && bathrooms !== '') p.set('bathrooms', String(bathrooms));
  if (squareFootage != null && squareFootage !== '') p.set('squareFootage', String(squareFootage));
  // Let RentCast fill in whatever we could not supply from its own records.
  p.set('lookupSubjectAttributes', 'true');
  return p.toString();
}

/** RentCast payload → the shape the app stores, or null if it said nothing. */
export function normalize(payload) {
  const rent = Number(payload?.rent);
  if (!Number.isFinite(rent) || rent <= 0) return null;
  const low = Number(payload?.rentRangeLow);
  const high = Number(payload?.rentRangeHigh);
  return {
    rent,
    rent_low: Number.isFinite(low) && low > 0 ? low : null,
    rent_high: Number.isFinite(high) && high > 0 ? high : null,
    comp_count: Array.isArray(payload?.comparables) ? payload.comparables.length : null,
    source: 'rentcast',
  };
}

export default async function handler(request) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const url = new URL(request.url);
  const denied = await authorize(request, url.searchParams.get('orgId'));
  if (denied) return denied;
  // Trim: a key pasted into a dashboard field very often carries a trailing
  // newline or space, which the API rejects exactly like a wrong key.
  const key = (process.env.RENTCAST_API_KEY || '').trim();
  if (!key) {
    return json(501, {
      error: 'not_configured',
      message: 'No RENTCAST_API_KEY set — the app keeps using free ZIP rent bands.',
    });
  }

  const address = (url.searchParams.get('address') || '').trim();
  if (!address) return json(400, { error: 'address_required' });

  const query = buildQuery({
    address,
    propertyType: url.searchParams.get('propertyType') || 'Apartment',
    bedrooms: url.searchParams.get('bedrooms'),
    bathrooms: url.searchParams.get('bathrooms'),
    squareFootage: url.searchParams.get('squareFootage'),
  });

  let res;
  try {
    res = await fetch(`${RENTCAST_URL}?${query}`, {
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      redirect: 'error',
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'RentCast could not be reached.' }, true);
  }

  // Upstream bodies/exceptions may echo credentials. Return fixed messages.
  if (res.status === 401 || res.status === 403) {
    return json(502, {
      error: 'bad_key',
      message: 'RentCast refused the server credentials or plan. Check the server configuration.',
    }, true);
  }
  if (res.status === 429) {
    // Say so plainly rather than degrading into a wrong-looking number.
    return json(429, { error: 'quota_exceeded', message: 'RentCast request quota reached for this billing period.' }, true);
  }
  if (!res.ok) {
    return json(502, { error: 'upstream_error', message: `RentCast returned ${res.status}` }, true);
  }

  const payload = await res.json().catch(() => null);
  const out = normalize(payload);
  if (!out) return json(404, { error: 'no_estimate', message: 'RentCast had no rent estimate for this address.' }, true);

  return json(200, { ...out, address, fetched_at: new Date().toISOString() }, true);
}
