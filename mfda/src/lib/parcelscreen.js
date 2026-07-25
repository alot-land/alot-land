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
  return (markets || []).find((m) => m.state === state) || null;
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
 * Full underwrite input for one parcel (drives the report page and the
 * "Analyze as deal" handoff). Caller passes the (possibly user-edited)
 * units / rent / anchor.
 */
export function parcelDealInput(parcel, { units, rentPerUnit, anchor, preset }) {
  return {
    price: anchor,
    units: [
      {
        type: 'avg unit',
        count: units,
        sqft: parcel.building_sqft ? Math.round(parcel.building_sqft / units) : null,
        actual_rent: null,
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
