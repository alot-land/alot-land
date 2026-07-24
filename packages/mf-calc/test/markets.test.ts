/**
 * Market-analysis math — added in calc v1.3.0 (new module + tests per the
 * frozen-module protocol). Tests written BEFORE the implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  CALC_VERSION,
  cagr,
  computeMarketMetrics,
  percentileRanks,
  scoreMarkets,
  bboxPolygon,
  WEIGHT_PROFILES,
  METRIC_DIRECTIONS,
} from '../src/index.js';

describe('calc version', () => {
  it('is at least 1.3.0 (markets module)', () => {
    const [maj, min] = CALC_VERSION.split('.').map(Number);
    expect(maj! > 1 || (maj === 1 && min! >= 3)).toBe(true);
  });
});

describe('cagr', () => {
  it('computes compound annual growth', () => {
    // 100 → 121 over 2 years = 10%/yr exactly
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 10);
    // 300000 → 450000 over 5 years
    expect(cagr(300_000, 450_000, 5)).toBeCloseTo((450_000 / 300_000) ** (1 / 5) - 1, 12);
  });

  it('handles decline', () => {
    expect(cagr(200, 100, 1)).toBeCloseTo(-0.5, 12);
  });

  it('returns null on missing/invalid inputs', () => {
    expect(cagr(null, 100, 5)).toBeNull();
    expect(cagr(100, null, 5)).toBeNull();
    expect(cagr(0, 100, 5)).toBeNull();
    expect(cagr(100, 100, 0)).toBeNull();
    expect(cagr(-5, 100, 5)).toBeNull();
  });
});

describe('computeMarketMetrics', () => {
  const raw = {
    geo_id: '04013',
    name: 'Maricopa County',
    state: 'AZ',
    lat: 33.35,
    lng: -112.49,
    population: 4_500_000,
    zhvi_now: 480_000,
    zhvi_1y: 460_000,
    zhvi_5y: 330_000,
    zori_now: 2_100,
    zori_1y: 2_020,
    zori_5y: 1_500,
    median_re_tax: 2_016,
    median_home_value_acs: 420_000,
    renter_share: 0.36,
    rental_vacancy: 0.07,
    pop_5y_ago: 4_200_000,
    nri_score: 22.5,
    nri_rating: 'Relatively Moderate',
  };
  const m = computeMarketMetrics(raw);

  it('gross yield = annual rent / home value', () => {
    expect(m.gross_yield).toBeCloseTo((2_100 * 12) / 480_000, 12); // 5.25%
  });

  it('appreciation and rent growth are CAGRs of the series snapshots', () => {
    expect(m.appr_1y).toBeCloseTo(480_000 / 460_000 - 1, 12);
    expect(m.appr_5y).toBeCloseTo((480_000 / 330_000) ** (1 / 5) - 1, 12);
    expect(m.rent_growth_5y).toBeCloseTo((2_100 / 1_500) ** (1 / 5) - 1, 12);
  });

  it('effective tax rate from ACS medians', () => {
    expect(m.tax_rate).toBeCloseTo(2_016 / 420_000, 12); // 0.48%
  });

  it('population growth CAGR', () => {
    expect(m.pop_growth_5y).toBeCloseTo((4_500_000 / 4_200_000) ** (1 / 5) - 1, 12);
  });

  it('passes through identity and risk fields', () => {
    expect(m.geo_id).toBe('04013');
    expect(m.nri_score).toBe(22.5);
    expect(m.zhvi).toBe(480_000);
    expect(m.zori).toBe(2_100);
  });

  it('derives renter share and rental vacancy from raw ACS counts', () => {
    const d = computeMarketMetrics({
      geo_id: 'x', name: 'X', state: 'TN',
      renters: 36_000, occupied_units: 100_000, vacant_for_rent: 4_000,
    });
    expect(d.renter_share).toBeCloseTo(0.36, 12);
    expect(d.rental_vacancy).toBeCloseTo(4_000 / 40_000, 12);
  });

  it('an explicit renter_share wins over derivation', () => {
    const d = computeMarketMetrics({
      geo_id: 'x', name: 'X', state: 'TN',
      renter_share: 0.5, renters: 1, occupied_units: 100,
    });
    expect(d.renter_share).toBe(0.5);
  });

  it('nulls where inputs are missing, without throwing', () => {
    const sparse = computeMarketMetrics({ geo_id: 'x', name: 'X', state: 'TN' });
    expect(sparse.gross_yield).toBeNull();
    expect(sparse.appr_5y).toBeNull();
    expect(sparse.tax_rate).toBeNull();
  });
});

describe('percentileRanks', () => {
  it('ranks non-null values 0-100, keeps nulls null', () => {
    const r = percentileRanks([10, null, 20, 30, 40]);
    expect(r[1]).toBeNull();
    expect(r[0]).toBe(0);
    expect(r[4]).toBe(100);
    expect(r[2]).toBeCloseTo(100 / 3, 6); // rank 1 of 3 steps
  });

  it('ties share a rank and a single value ranks 50', () => {
    const r = percentileRanks([5, 5]);
    expect(r[0]).toBe(r[1]);
    expect(percentileRanks([7])[0]).toBe(50);
  });
});

describe('scoreMarkets', () => {
  // Three synthetic markets: A = cash-flow monster, B = appreciation darling,
  // C = weak on everything (and risky).
  const A = computeMarketMetrics({
    geo_id: 'A', name: 'A', state: 'TN',
    zhvi_now: 200_000, zhvi_1y: 196_000, zhvi_5y: 180_000,
    zori_now: 1_800, zori_1y: 1_750, zori_5y: 1_500,
    median_re_tax: 1_000, median_home_value_acs: 200_000,
    renter_share: 0.45, rental_vacancy: 0.05,
    population: 500_000, pop_5y_ago: 480_000, nri_score: 10,
  });
  const B = computeMarketMetrics({
    geo_id: 'B', name: 'B', state: 'AZ',
    zhvi_now: 600_000, zhvi_1y: 540_000, zhvi_5y: 380_000,
    zori_now: 2_400, zori_1y: 2_250, zori_5y: 1_900,
    median_re_tax: 4_200, median_home_value_acs: 600_000,
    renter_share: 0.35, rental_vacancy: 0.06,
    population: 1_000_000, pop_5y_ago: 850_000, nri_score: 30,
  });
  const C = computeMarketMetrics({
    geo_id: 'C', name: 'C', state: 'FL',
    zhvi_now: 400_000, zhvi_1y: 404_000, zhvi_5y: 390_000,
    zori_now: 1_600, zori_1y: 1_610, zori_5y: 1_550,
    median_re_tax: 6_000, median_home_value_acs: 400_000,
    renter_share: 0.30, rental_vacancy: 0.12,
    population: 300_000, pop_5y_ago: 305_000, nri_score: 80,
  });

  it('cashflow profile puts the high-yield market first; weak market last', () => {
    const scored = scoreMarkets([A, B, C], 'cashflow');
    expect(scored[0]!.geo_id).toBe('A'); // 10.8% yield, low tax, low risk
    expect(scored[2]!.geo_id).toBe('C');
    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
  });

  it('appreciation profile reorders in favor of the growth market', () => {
    const scored = scoreMarkets([A, B, C], 'appreciation');
    expect(scored[0]!.geo_id).toBe('B'); // 9.6% 5y CAGR, strong pop growth
  });

  it('scores are 0-100 and per-metric percentiles are exposed', () => {
    const scored = scoreMarkets([A, B, C], 'balanced');
    for (const s of scored) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.percentiles).toBeTypeOf('object');
    }
  });

  it('lower-is-better metrics are inverted (high risk hurts)', () => {
    expect(METRIC_DIRECTIONS.nri_score).toBe(-1);
    expect(METRIC_DIRECTIONS.tax_rate).toBe(-1);
    expect(METRIC_DIRECTIONS.rental_vacancy).toBe(-1);
    expect(METRIC_DIRECTIONS.gross_yield).toBe(1);
  });

  it('missing metrics redistribute weight instead of zeroing the score', () => {
    const sparse = computeMarketMetrics({
      geo_id: 'S', name: 'S', state: 'TX',
      zhvi_now: 250_000, zori_now: 2_000, // yield only — no history
    });
    const scored = scoreMarkets([A, B, C, sparse], 'cashflow');
    const s = scored.find((x) => x.geo_id === 'S')!;
    expect(s.score).toBeGreaterThan(0); // 9.6% yield ranks high among peers
    expect(s.coverage).toBeLessThan(1); // and the thin data is disclosed
  });

  it('every profile weights sum to 100', () => {
    for (const p of Object.values(WEIGHT_PROFILES)) {
      const sum = Object.values(p).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    }
  });
});

describe('bboxPolygon', () => {
  it('returns a closed 5-point ring around the centroid', () => {
    const poly = bboxPolygon(33.45, -112.07, 9200); // Maricopa-ish area (sq mi)
    const pts = poly.split(',').map((p) => p.trim().split(' ').map(Number));
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual(pts[4]); // closed
    // Roughly sqrt(9200)≈96mi across → ±~0.7° lat
    const lats = pts.map((p) => p[1]!);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(1);
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(3);
    // Longitude spread wider than latitude at 33°N (cos scaling)
    const lngs = pts.map((p) => p[0]!);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(Math.max(...lats) - Math.min(...lats));
  });
});
