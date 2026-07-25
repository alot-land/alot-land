/**
 * Off-market screening orchestrator — input prep ONLY; every formula is a
 * call into @alot/mf-calc (same discipline as underwrite.js).
 *
 * Estimate provenance, stated wherever numbers render:
 *  - income: ZORI zip rent band (blended bedrooms) × unit count
 *  - value anchor: county appraised value (assessed_value column)
 *  - expenses: standard underwriting rates (mf-calc DEFAULT_EXPENSE_RATES)
 */
import * as mf from '@alot/mf-calc';

/** rent_bands rows → Map zip → est. monthly market rent (blended ZORI row
 * preferred; else the median of whatever bedroom rows the zip has). */
export function buildZipRents(bands) {
  const byZip = new Map();
  for (const b of bands || []) {
    if (!b.zip || !(Number(b.rent) > 0)) continue;
    // HUD SAFMR rows are a bedroom SHAPE, not market rent — they must never
    // set the level. buildZipBedroomRatios consumes them instead.
    if (b.source === 'hud_safmr') continue;
    const arr = byZip.get(b.zip) || [];
    arr.push(b);
    byZip.set(b.zip, arr);
  }
  const out = new Map();
  for (const [zip, rows] of byZip) {
    const blended = rows.find((r) => Number(r.bedrooms) === -1);
    if (blended) {
      out.set(zip, Number(blended.rent));
      continue;
    }
    const rents = rows.map((r) => Number(r.rent)).sort((a, b) => a - b);
    out.set(zip, rents[Math.floor(rents.length / 2)]);
  }
  return out;
}

/**
 * rent_bands rows → Map zip → bedroom ratios (from HUD SAFMR).
 *
 * The ratios reshape the blended ZORI level to a bedroom count; the SAFMR
 * levels themselves are policy figures and are never shown as rent.
 */
export function buildZipBedroomRatios(bands) {
  const byZip = new Map();
  for (const b of bands || []) {
    if (b.source !== 'hud_safmr' || !b.zip || !(Number(b.rent) > 0)) continue;
    const cur = byZip.get(b.zip) || {};
    // Newest vintage wins when several years are stored.
    const prev = cur[`__period_${b.bedrooms}`];
    if (prev != null && String(b.period || '') < String(prev)) continue;
    cur[`__period_${b.bedrooms}`] = b.period || '';
    cur[Number(b.bedrooms)] = Number(b.rent);
    byZip.set(b.zip, cur);
  }
  const out = new Map();
  for (const [zip, byBed] of byZip) {
    const ratios = mf.bedroomRatios({
      efficiency: byBed[0] ?? null,
      one: byBed[1] ?? null,
      two: byBed[2] ?? null,
      three: byBed[3] ?? null,
      four: byBed[4] ?? null,
    });
    if (Object.keys(ratios).length) out.set(zip, ratios);
  }
  return out;
}

/**
 * Market rent for one unit: the blended ZIP level, reshaped to a bedroom
 * count when SAFMR ratios cover that ZIP. Falls back to the blend itself —
 * never to nothing — and reports which happened for the provenance line.
 */
export function zipRentForUnit(zip, { zipRents, bedroomRatios, bedrooms }) {
  const z = zip ? String(zip).slice(0, 5) : null;
  const blended = z ? zipRents?.get(z) ?? null : null;
  if (blended == null) return { rent: null, basis: 'none' };
  const ratios = z ? bedroomRatios?.get(z) : null;
  if (ratios && bedrooms != null) {
    const adj = mf.adjustRentForBedrooms({ blended_rent: blended, bedrooms, ratios });
    if (adj != null) return { rent: adj, basis: 'safmr_adjusted', bedrooms };
  }
  return { rent: blended, basis: 'zori_blended' };
}

/**
 * Maricopa (and others) publish unit counts as RANGES — "APARTMENTS 25 - 99
 * UNITS" parses to 25, deliberately the low end. That makes the stored count
 * a FLOOR, not a fact, and per-unit math on it understates the property. The
 * UI marks these with ≥ rather than presenting 25 as if it were counted.
 */
export function unitsAreFloor(propertyClass) {
  const s = String(propertyClass || '');
  return /\d\s*(?:-|–|to)\s*\d+\s*units?\b/i.test(s) || /\d\s*\+\s*units?\b/i.test(s);
}

// Address join key: lowercase alphanumeric with street-suffix words dropped,
// plus zip5 — matches Redfin's "1305 Stratford Ave" to the county's
// "1305 STRATFORD AVE".
const SUFFIX_RE = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|circle|cir|pike|pk|terrace|ter)\b/g;
export function addrKey(address, zip) {
  const a = String(address || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const z = String(zip || '').slice(0, 5);
  return a && z ? `${a}:${z}` : null;
}

/** parcels value index rows → Map addrKey → county appraised value. */
export function buildParcelValueMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const k = addrKey(r.situs_address, r.situs_zip);
    if (k && Number(r.assessed_value) > 0) map.set(k, Number(r.assessed_value));
  }
  return map;
}

/** Equity walked into at asking price, when the listing matches a parcel. */
export function listingEquity(deal, valueMap) {
  const k = addrKey(deal.address, deal.zip);
  if (!k || !valueMap?.size) return null;
  const value = valueMap.get(k);
  if (value == null || !(Number(deal.price) > 0)) return null;
  return mf.equitySpread({ price: Number(deal.price), value });
}

/** Owner's equity position: county value vs what they paid. */
export function ownerEquity(parcel) {
  return mf.equitySpread({
    price: parcel.last_sale_price != null ? Number(parcel.last_sale_price) : null,
    value: parcel.assessed_value != null ? Number(parcel.assessed_value) : null,
  });
}

/** Google Street View (pano when we have coordinates, address search otherwise). */
export function streetViewUrl(p) {
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`;
  }
  const q = encodeURIComponent(
    [p.situs_address, p.situs_city, p.state, p.situs_zip].filter(Boolean).join(', '),
  );
  return q ? `https://www.google.com/maps/search/?api=1&query=${q}` : null;
}

/** Market preset (markets table row) for a parcel's state, if any. */
export function presetForState(markets, state) {
  const rows = (markets || []).filter((m) => m.state === state);
  // Prefer hand-seeded presets (real tax rates / assessment ratios) over rows
  // auto-created by the market finder, which carry engine defaults.
  return rows.find((m) => m.source !== 'finder') || rows[0] || null;
}

/** Fast screen for list rows. Pure mf-calc; ~µs per parcel. */
export function screenRow(parcel, zipRents, preset) {
  const rent = parcel.situs_zip ? zipRents.get(String(parcel.situs_zip).slice(0, 5)) ?? null : null;
  const screen = mf.screenParcel({
    units: parcel.units,
    market_rent_monthly: rent,
    price_anchor: parcel.assessed_value != null ? Number(parcel.assessed_value) : null,
    property_tax_rate: preset?.property_tax_rate ?? undefined,
    assessment_ratio: preset?.assessment_ratio ?? undefined,
  });
  return { ...screen, rent };
}

/**
 * Fast screen for ON-MARKET listings. Redfin gives price and zip but only a
 * unit BUCKET ('2-4' / '5+'), so 2-4s screen with a disclosed 3-unit
 * assumption and 5+ report 'insufficient' until real units are entered in
 * underwriting. The asking price is the anchor.
 */
export function screenListingRow(deal, zipRents, preset) {
  const unitsEst = deal.unit_bucket === '2-4' ? 3 : null;
  const rent = deal.zip ? zipRents.get(String(deal.zip).slice(0, 5)) ?? null : null;
  const screen = mf.screenParcel({
    units: unitsEst,
    market_rent_monthly: rent,
    price_anchor: deal.price != null ? Number(deal.price) : null,
    property_tax_rate: preset?.property_tax_rate ?? undefined,
    assessment_ratio: preset?.assessment_ratio ?? undefined,
  });
  return { ...screen, rent, units_est: unitsEst };
}

/**
 * Monthly net cash flow for a deal row, with its provenance.
 *
 *  - 'underwritten': the deal's latest saved scenario — cash flow before
 *    taxes (NOI − debt service), the same figure the tracking card shows.
 *  - 'estimated': no scenario yet, so the deal screens like an off-market
 *    parcel — zip-band rent × real unit count, standard expense rates,
 *    75% LTV at the screen's rate, anchored on the asking price.
 *
 * Returns null when there isn't enough to say anything honest.
 */
export function dealMonthlyNet(deal, zipRents, preset) {
  const cfbt = deal.latest_outputs?.financing?.dscr?.cfbt;
  if (cfbt != null && Number.isFinite(Number(cfbt))) {
    return { monthly: Number(cfbt) / 12, basis: 'underwritten', calc_version: deal.latest_calc_version || null };
  }
  const rent = deal.zip ? zipRents.get(String(deal.zip).slice(0, 5)) ?? null : null;
  const screen = mf.screenParcel({
    units: deal.units_count,
    market_rent_monthly: rent,
    price_anchor: deal.price != null ? Number(deal.price) : null,
    property_tax_rate: preset?.property_tax_rate ?? undefined,
    assessment_ratio: preset?.assessment_ratio ?? undefined,
  });
  if (!screen.ok || screen.cash_flow == null) {
    return { monthly: null, basis: 'insufficient', missing: screen.missing };
  }
  return { monthly: screen.cash_flow / 12, basis: 'estimated', rent };
}

/**
 * Full underwrite input for one parcel (drives the report page and the
 * "Analyze as deal" handoff). Caller passes the (possibly user-edited)
 * units / rent / anchor.
 */
export function parcelDealInput(parcel, { units, rentPerUnit, anchor, preset }) {
  return {
    price: anchor,
    units: [
      {
        // UnitType requires numbers. actual_rent = market rent (we don't know
        // in-place rents on off-market parcels; assuming at-market keeps
        // loss-to-lease honestly at 0 instead of a fake 100%).
        type: 'avg unit',
        count: units,
        sqft: parcel.building_sqft ? Math.round(parcel.building_sqft / units) : 0,
        actual_rent: rentPerUnit,
        market_rent: rentPerUnit,
      },
    ],
    rent_basis: 'market',
    property_tax_rate: preset?.property_tax_rate ?? undefined,
    assessment_ratio: preset?.assessment_ratio ?? undefined,
    market: preset || undefined,
    noi_growth_rate: preset?.appreciation_rate ?? undefined,
    expenses: (() => {
      // Standard-rate estimate; underwrite() overwrites property_tax with
      // the reassessed figure at the price under test.
      const gpr = units * rentPerUnit * 12;
      return mf.estimateOperatingExpenses({ units, gross_potential_rent: gpr, vacancy_rate: 0.05 });
    })(),
  };
}
