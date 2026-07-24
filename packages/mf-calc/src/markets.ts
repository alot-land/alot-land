/**
 * Market-analysis math — added in calc v1.3.0 (new module + tests per the
 * frozen-module protocol).
 *
 * Ranks US markets (counties/metros) for multifamily cash flow and
 * appreciation from free national data. The worker stores RAW series
 * snapshots (Zillow ZHVI/ZORI, ACS, FEMA NRI); every derived number is
 * computed here so there is exactly one source of arithmetic truth.
 *
 * Honesty note: ZHVI/ZORI track homes, not apartment buildings. Gross yield
 * (annual rent ÷ value) is a strong cross-market cash-flow PROXY — a
 * compass for where to point the scanner, not an appraisal of any building.
 */

export interface MarketRawStats {
  geo_id: string; // county FIPS
  name: string;
  state: string;
  lat?: number | null;
  lng?: number | null;
  population?: number | null;
  pop_5y_ago?: number | null;
  /** Zillow series snapshots: latest value and the values 12/60 months back. */
  zhvi_now?: number | null;
  zhvi_1y?: number | null;
  zhvi_5y?: number | null;
  zori_now?: number | null;
  zori_1y?: number | null;
  zori_5y?: number | null;
  /** ACS medians (effective tax rate = median RE tax ÷ median value). */
  median_re_tax?: number | null;
  median_home_value_acs?: number | null;
  renter_share?: number | null; // 0-1 (or derived from the counts below)
  rental_vacancy?: number | null; // 0-1
  /** Raw ACS counts — ratios are derived HERE, not in the data worker. */
  renters?: number | null; // B25003_003
  occupied_units?: number | null; // B25003_001
  vacant_for_rent?: number | null; // B25004_002
  /** FEMA National Risk Index composite (0-100, higher = riskier). */
  nri_score?: number | null;
  nri_rating?: string | null;
}

export interface MarketMetrics {
  geo_id: string;
  name: string;
  state: string;
  lat: number | null;
  lng: number | null;
  population: number | null;
  zhvi: number | null;
  zori: number | null;
  /** ZORI×12 ÷ ZHVI — gross rental yield. */
  gross_yield: number | null;
  appr_1y: number | null;
  appr_5y: number | null;
  rent_growth_1y: number | null;
  rent_growth_5y: number | null;
  tax_rate: number | null;
  renter_share: number | null;
  rental_vacancy: number | null;
  pop_growth_5y: number | null;
  nri_score: number | null;
  nri_rating: string | null;
}

/** Compound annual growth rate; null when the inputs can't support one. */
export function cagr(
  startValue: number | null | undefined,
  endValue: number | null | undefined,
  years: number,
): number | null {
  if (startValue == null || endValue == null) return null;
  if (!(startValue > 0) || !(endValue > 0) || !(years > 0)) return null;
  return (endValue / startValue) ** (1 / years) - 1;
}

const nn = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

export function computeMarketMetrics(raw: MarketRawStats): MarketMetrics {
  const zhvi = nn(raw.zhvi_now);
  const zori = nn(raw.zori_now);
  const tax = nn(raw.median_re_tax);
  const acsValue = nn(raw.median_home_value_acs);
  const renters = nn(raw.renters);
  const occupied = nn(raw.occupied_units);
  const forRent = nn(raw.vacant_for_rent);
  const renterShare =
    nn(raw.renter_share) ?? (renters != null && occupied != null && occupied > 0 ? renters / occupied : null);
  const rentalVacancy =
    nn(raw.rental_vacancy) ??
    (forRent != null && renters != null && renters + forRent > 0 ? forRent / (renters + forRent) : null);
  return {
    geo_id: raw.geo_id,
    name: raw.name,
    state: raw.state,
    lat: nn(raw.lat),
    lng: nn(raw.lng),
    population: nn(raw.population),
    zhvi,
    zori,
    gross_yield: zhvi != null && zori != null && zhvi > 0 ? (zori * 12) / zhvi : null,
    appr_1y: cagr(raw.zhvi_1y, raw.zhvi_now, 1),
    appr_5y: cagr(raw.zhvi_5y, raw.zhvi_now, 5),
    rent_growth_1y: cagr(raw.zori_1y, raw.zori_now, 1),
    rent_growth_5y: cagr(raw.zori_5y, raw.zori_now, 5),
    tax_rate: tax != null && acsValue != null && acsValue > 0 ? tax / acsValue : null,
    renter_share: renterShare,
    rental_vacancy: rentalVacancy,
    pop_growth_5y: cagr(raw.pop_5y_ago, raw.population, 5),
    nri_score: nn(raw.nri_score),
    nri_rating: raw.nri_rating ?? null,
  };
}

/**
 * Percentile rank (0-100) of each non-null value among the non-null values.
 * Ties share a rank; a single value ranks 50.
 */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null);
  if (!present.length) return values.map(() => null);
  if (present.length === 1) return values.map((v) => (v == null ? null : 50));
  const sorted = [...present].sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    if (v == null) return null;
    const below = sorted.filter((s) => s < v).length;
    const equal = sorted.filter((s) => s === v).length;
    // mid-rank of the tie group, scaled to 0-100 over n-1 steps
    return ((below + (equal - 1) / 2) / (n - 1)) * 100;
  });
}

/** +1 = higher is better, -1 = lower is better. */
export const METRIC_DIRECTIONS: Record<string, 1 | -1> = {
  gross_yield: 1,
  appr_1y: 1,
  appr_5y: 1,
  rent_growth_1y: 1,
  rent_growth_5y: 1,
  renter_share: 1,
  pop_growth_5y: 1,
  affordability: 1, // derived: inverse of zhvi
  tax_rate: -1,
  rental_vacancy: -1,
  nri_score: -1,
};

/** Weight profiles (each sums to 100). */
export const WEIGHT_PROFILES: Record<string, Record<string, number>> = {
  cashflow: {
    gross_yield: 35,
    rent_growth_5y: 12,
    tax_rate: 10,
    rental_vacancy: 8,
    renter_share: 5,
    affordability: 10,
    pop_growth_5y: 10,
    nri_score: 10,
  },
  appreciation: {
    appr_5y: 28,
    appr_1y: 10,
    pop_growth_5y: 20,
    rent_growth_5y: 12,
    gross_yield: 10,
    affordability: 5,
    renter_share: 5,
    nri_score: 10,
  },
  balanced: {
    gross_yield: 22,
    appr_5y: 18,
    rent_growth_5y: 12,
    pop_growth_5y: 13,
    tax_rate: 8,
    rental_vacancy: 6,
    renter_share: 5,
    affordability: 6,
    nri_score: 10,
  },
};

export interface ScoredMarket extends MarketMetrics {
  score: number;
  /** Direction-adjusted percentile per metric actually used. */
  percentiles: Record<string, number>;
  /** Share of the profile's weight backed by present data (0-1). */
  coverage: number;
}

/**
 * Score markets under a weight profile. Each metric becomes a national
 * percentile (direction-adjusted), the score is the weighted mean over the
 * metrics that are PRESENT for that market — missing data redistributes
 * weight and is disclosed via `coverage`, never silently zero-scored.
 */
export function scoreMarkets(
  markets: MarketMetrics[],
  profile: string | Record<string, number> = 'balanced',
): ScoredMarket[] {
  const weights = typeof profile === 'string' ? WEIGHT_PROFILES[profile] : profile;
  if (!weights) throw new Error(`unknown weight profile: ${String(profile)}`);
  const active = Object.entries(weights).filter(([k, w]) => w > 0 && METRIC_DIRECTIONS[k] !== undefined);

  // Metric value extraction ('affordability' = inverse home value).
  const valueOf = (m: MarketMetrics, key: string): number | null => {
    if (key === 'affordability') return m.zhvi != null && m.zhvi > 0 ? -m.zhvi : null;
    const v = (m as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const pctByMetric: Record<string, (number | null)[]> = {};
  for (const [key] of active) {
    const raw = markets.map((m) => valueOf(m, key));
    const ranks = percentileRanks(raw);
    const dir = key === 'affordability' ? 1 : METRIC_DIRECTIONS[key]!;
    pctByMetric[key] = ranks.map((r) => (r == null ? null : dir === 1 ? r : 100 - r));
  }

  const totalWeight = active.reduce((a, [, w]) => a + w, 0);
  const scored = markets.map((m, i) => {
    let wsum = 0;
    let acc = 0;
    const percentiles: Record<string, number> = {};
    for (const [key, w] of active) {
      const p = pctByMetric[key]![i];
      if (p == null) continue;
      percentiles[key] = p;
      acc += p * w;
      wsum += w;
    }
    return {
      ...m,
      score: wsum > 0 ? acc / wsum : 0,
      percentiles,
      coverage: totalWeight > 0 ? wsum / totalWeight : 0,
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Approximate square scan polygon around a centroid, sized from land area.
 * Returns the scanner's closed-ring format: "lng lat,lng lat,...".
 */
export function bboxPolygon(lat: number, lng: number, landAreaSqMi: number, pad = 1.15): string {
  const half = (Math.sqrt(Math.max(landAreaSqMi, 1)) / 2) * pad;
  const dLat = half / 69; // ~69 miles per degree latitude
  const dLng = half / (69 * Math.cos((lat * Math.PI) / 180));
  const pts: [number, number][] = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
  return pts.map(([x, y]) => `${x.toFixed(5)} ${y.toFixed(5)}`).join(',');
}
