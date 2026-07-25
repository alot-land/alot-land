/**
 * HUD Fair Market Rent API — pure URL building and response parsing.
 *
 * Why this exists: the app's rents come from ZORI *blended* zip bands, which
 * cannot tell a 1BR from a 3BR. HUD publishes Small Area FMRs — bedroom
 * specific, per ZIP, free — and while the LEVELS are policy figures (roughly
 * a 40th percentile of standard-quality rents, so not market rent), the
 * RATIOS between bedroom counts inside one zip are sound. mf-calc's
 * bedroomRatios/adjustRentForBedrooms consume exactly those ratios.
 *
 * API: https://www.huduser.gov/hudapi/public/fmr — free token, Bearer auth.
 * Network calls live in bin/hudfmr.mjs; everything here is testable.
 */

export const HUD_BASE = 'https://www.huduser.gov/hudapi/public/fmr';

/** Counties in a state, with the entity ids the data endpoint accepts. */
export const hudCountiesUrl = (stateCode) => `${HUD_BASE}/listCounties/${encodeURIComponent(stateCode)}`;

/**
 * FMR data for one entity — a county fips, a CBSA/metro code, or a state.
 * When the entity is a designated small area, the response carries per-ZIP
 * rows; otherwise a single area-wide row.
 */
export function hudDataUrl(entityId, year) {
  const q = year ? `?year=${encodeURIComponent(year)}` : '';
  return `${HUD_BASE}/data/${encodeURIComponent(entityId)}${q}`;
}

export const hudAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
});

// HUD labels bedroom columns in words. Both the modern hyphenated form and
// the older underscored one appear across endpoints and vintages.
const BEDROOM_KEYS = [
  ['efficiency', ['Efficiency', 'efficiency']],
  ['one', ['One-Bedroom', 'One_Bedroom', 'onebedroom']],
  ['two', ['Two-Bedroom', 'Two_Bedroom', 'twobedroom']],
  ['three', ['Three-Bedroom', 'Three_Bedroom', 'threebedroom']],
  ['four', ['Four-Bedroom', 'Four_Bedroom', 'fourbedroom']],
];

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One HUD row → the FmrByBedroom shape mf-calc's bedroomRatios expects. */
export function fmrByBedroom(row) {
  const out = {};
  for (const [field, candidates] of BEDROOM_KEYS) {
    let v = null;
    for (const c of candidates) {
      if (row?.[c] != null) {
        v = numOrNull(row[c]);
        break;
      }
    }
    out[field] = v;
  }
  return out;
}

/**
 * FMR data response → per-ZIP rows.
 *
 * `basicdata` is an ARRAY of per-zip objects when the area is a designated
 * small area (smallarea_status 1), and a single OBJECT otherwise. An
 * area-wide object has no zip of its own, so it is returned with zip null and
 * the caller decides whether an area-wide fallback is worth storing.
 */
export function parseFmrResponse(json) {
  const data = json?.data ?? json;
  const basic = data?.basicdata;
  if (!basic) return [];
  const rows = Array.isArray(basic) ? basic : [basic];
  return rows
    .map((r) => ({
      zip: r?.zip_code != null ? String(r.zip_code).slice(0, 5) : null,
      fmr: fmrByBedroom(r),
      /** True when HUD itself publishes this at zip resolution. */
      small_area: Array.isArray(basic) || String(data?.smallarea_status ?? '') === '1',
      year: data?.year ?? json?.year ?? null,
    }))
    .filter((r) => Object.values(r.fmr).some((v) => v != null));
}

/** listCounties response → [{ fips, name }]. */
export function parseCounties(json) {
  const rows = json?.data ?? json;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      fips: r?.fips_code || r?.fips || null,
      name: r?.county_name || r?.name || null,
      state: r?.state_code || r?.state || null,
    }))
    .filter((r) => r.fips);
}

/**
 * Per-zip rows → rent_bands rows.
 *
 * bedrooms is stored as the integer count (0-4); the app's existing ZORI rows
 * use -1 for "blended", so the two sources coexist in one table and the
 * source column keeps them apart.
 */
export function toRentBandRows(parsed, { orgId, state, period, now }) {
  const BED_INDEX = { efficiency: 0, one: 1, two: 2, three: 3, four: 4 };
  const out = [];
  for (const row of parsed) {
    if (!row.zip) continue; // area-wide rows carry no zip — not storable here
    for (const [field, bedrooms] of Object.entries(BED_INDEX)) {
      const rent = row.fmr[field];
      if (rent == null) continue;
      out.push({
        org_id: orgId,
        source: 'hud_safmr',
        zip: row.zip,
        state: state || null,
        period: period || (row.year ? String(row.year) : null),
        bedrooms,
        rent,
        // A policy figure, not a market observation — the app must never
        // present these as rent, only use the ratios between them.
        confidence: 'low',
        retrieved_at: now || null,
      });
    }
  }
  return out;
}
