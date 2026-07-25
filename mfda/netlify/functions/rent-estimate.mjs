/**
 * RentCast rent-estimate proxy.
 *
 * Runs server-side for one reason: the API key must never reach the browser.
 * The app calls /.netlify/functions/rent-estimate; this adds the key and
 * normalizes the response.
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

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

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
  // Trim: a key pasted into a dashboard field very often carries a trailing
  // newline or space, which the API rejects exactly like a wrong key.
  const key = (process.env.RENTCAST_API_KEY || '').trim();
  if (!key) {
    return json(501, {
      error: 'not_configured',
      message: 'No RENTCAST_API_KEY set — the app keeps using free ZIP rent bands.',
    });
  }

  const url = new URL(request.url);
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
    });
  } catch (e) {
    return json(502, { error: 'upstream_unreachable', message: String(e.message || e) });
  }

  // 401 and 403 mean different things and need different fixes, so don't
  // collapse them. RentCast's own explanation is included verbatim — it is
  // the only thing that distinguishes "wrong key" from "key fine, plan does
  // not cover this endpoint". Never echo the key itself; its LENGTH is enough
  // to spot a truncated or empty paste.
  if (res.status === 401 || res.status === 403) {
    const detail = await res.text().catch(() => '');
    const upstream = detail.slice(0, 200).replace(/\s+/g, ' ').trim();
    return json(502, {
      error: 'bad_key',
      message:
        (res.status === 401
          ? 'RentCast did not recognise the API key. Re-copy it from the RentCast dashboard and re-paste it into Netlify (no spaces or line breaks), then redeploy.'
          : 'RentCast recognised the key but refused the request — usually no active plan on the account, or a plan that does not include the rent-estimate endpoint. Check that a plan (the free Developer tier counts) is selected in the RentCast dashboard.') +
        (upstream ? ` RentCast said: “${upstream}”` : '') +
        ` (key received by the server: ${key.length} characters)`,
    });
  }
  if (res.status === 429) {
    // Say so plainly rather than degrading into a wrong-looking number.
    return json(429, { error: 'quota_exceeded', message: 'RentCast request quota reached for this billing period.' });
  }
  if (!res.ok) {
    return json(502, { error: 'upstream_error', message: `RentCast returned ${res.status}` });
  }

  const payload = await res.json().catch(() => null);
  const out = normalize(payload);
  if (!out) return json(404, { error: 'no_estimate', message: 'RentCast had no rent estimate for this address.' });

  return json(200, { ...out, address, fetched_at: new Date().toISOString() });
}
