/**
 * Input plausibility — added in calc v1.14.0 (new module + tests per the
 * frozen-module protocol).
 *
 * Every formula in this engine is arithmetic on whatever it is handed, and
 * arithmetic on garbage produces confident garbage. A real case: a Glendale
 * parcel published by the county as "APARTMENTS 25 - 99 UNITS" with an
 * assessed value of $137,900. The engine dutifully divided 25 units of ZIP
 * rent by that anchor and reported a 172% cap rate, 27.4 DSCR and a
 * PURSUE 100/100 verdict. Nothing was miscalculated; the price was simply not
 * a whole-building market value.
 *
 * This module refuses to let that reach a verdict. It does NOT judge whether
 * a deal is good — that is scoring's job. It judges whether the inputs could
 * describe a real building at all, and the thresholds are deliberately far
 * outside any plausible deal so a merely unusual one is never suppressed.
 */

export interface PlausibilityThresholds {
  /** Below this $/unit the anchor is not a whole-building value. */
  min_price_per_unit: number;
  /** Above this $/unit the unit count is probably understated. */
  max_price_per_unit: number;
  /** Above this cap rate the income and the price disagree about reality. */
  max_cap_rate: number;
  /** Above this monthly rent per unit the rent figure is not a unit rent. */
  max_rent_per_unit: number;
}

/**
 * Chosen to be unmistakable, not tight:
 *  - $20k/unit — below the cost of a habitable unit anywhere in the US; in
 *    practice it means a land-only or partial-parcel assessment.
 *  - $2M/unit — above any 2-20 unit building; in practice it means the unit
 *    count is a floor (a county "25 - 99 UNITS" band read as 25).
 *  - 25% cap — roughly 3x the best real small-multifamily cap. Above it the
 *    price anchor and the income cannot both be right.
 *  - $20k/month/unit — no long-term residential unit rents for this.
 */
export const DEFAULT_PLAUSIBILITY: PlausibilityThresholds = {
  min_price_per_unit: 20_000,
  max_price_per_unit: 2_000_000,
  max_cap_rate: 0.25,
  max_rent_per_unit: 20_000,
};

export type PlausibilityCode =
  | 'price_per_unit_too_low'
  | 'price_per_unit_too_high'
  | 'cap_rate_impossible'
  | 'rent_per_unit_too_high';

export interface PlausibilityFlag {
  code: PlausibilityCode;
  /** Plain-English, safe to render directly next to the number. */
  message: string;
}

export interface PlausibilityInput {
  units?: number | null;
  /** Price or value anchor the ratios were computed against. */
  price?: number | null;
  /** Monthly market rent per unit. */
  rent_per_unit?: number | null;
  /** Cap rate as a decimal, if already computed. */
  cap_rate?: number | null;
  thresholds?: Partial<PlausibilityThresholds>;
}

export interface PlausibilityResult {
  ok: boolean;
  flags: PlausibilityFlag[];
  /** Convenience for display: the derived $/unit, when computable. */
  price_per_unit: number | null;
}

const usd0 = (n: number) =>
  `$${Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * Check whether these inputs could describe a real building.
 *
 * Missing inputs are NOT flagged — absent data is the 'insufficient' path's
 * job, and flagging it here would double-report it. Only present-and-absurd
 * values raise a flag.
 */
export function checkPlausibility(inp: PlausibilityInput): PlausibilityResult {
  const t = { ...DEFAULT_PLAUSIBILITY, ...(inp.thresholds || {}) };
  const flags: PlausibilityFlag[] = [];

  const units = inp.units != null && inp.units > 0 ? inp.units : null;
  const price = inp.price != null && inp.price > 0 ? inp.price : null;
  const pricePerUnit = units != null && price != null ? price / units : null;

  if (pricePerUnit != null) {
    if (pricePerUnit < t.min_price_per_unit) {
      flags.push({
        code: 'price_per_unit_too_low',
        message:
          `${usd0(price!)} across ${units} units is ${usd0(pricePerUnit)} per unit — below what any ` +
          `habitable unit costs. The price anchor is probably a land-only or partial-parcel ` +
          `assessment rather than a whole-building value.`,
      });
    } else if (pricePerUnit > t.max_price_per_unit) {
      flags.push({
        code: 'price_per_unit_too_high',
        message:
          `${usd0(price!)} across ${units} units is ${usd0(pricePerUnit)} per unit. Either the unit ` +
          `count is understated — county bands like "25 - 99 UNITS" are stored as the low end — or ` +
          `the price is not for this building alone.`,
      });
    }
  }

  if (inp.cap_rate != null && Number.isFinite(inp.cap_rate) && inp.cap_rate > t.max_cap_rate) {
    flags.push({
      code: 'cap_rate_impossible',
      message:
        `A ${(inp.cap_rate * 100).toFixed(1)}% cap rate is several times the best real small-multifamily ` +
        `deal. The income and the price cannot both be right — check the unit count and the price anchor.`,
    });
  }

  if (inp.rent_per_unit != null && inp.rent_per_unit > t.max_rent_per_unit) {
    flags.push({
      code: 'rent_per_unit_too_high',
      message:
        `${usd0(inp.rent_per_unit)} per unit per month is not a long-term residential rent — this looks ` +
        `like a whole-building figure being applied to every unit.`,
    });
  }

  return { ok: flags.length === 0, flags, price_per_unit: pricePerUnit };
}
