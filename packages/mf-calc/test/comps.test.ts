/**
 * v1.1.0 additions: comps statistics + $/bed valuation axis.
 * (New tests added BEFORE the version bump ships, per the frozen-module rule.)
 */
import { describe, it, expect } from 'vitest';
import {
  haversineMiles,
  filterNearby,
  compsStats,
  salesCompsPerBed,
  CALC_VERSION,
  valuationPanel,
  salesCompsPerBedValue,
} from '../src/index.js';

describe('CALC_VERSION', () => {
  it('is at least 1.1.0 (the comps additions)', () => {
    const [maj=0, min=0] = CALC_VERSION.split('.').map(Number);
    expect(maj * 100 + min).toBeGreaterThanOrEqual(101);
  });
});

describe('haversineMiles', () => {
  it('zero distance to itself', () => {
    expect(haversineMiles(33.45, -112.07, 33.45, -112.07)).toBe(0);
  });
  it('Phoenix → Tempe ≈ 9–12 miles (hand-checked)', () => {
    const d = haversineMiles(33.4484, -112.074, 33.4255, -111.94);
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(13);
  });
  it('one degree of latitude ≈ 69 miles', () => {
    const d = haversineMiles(33, -112, 34, -112);
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });
});

describe('filterNearby', () => {
  const subject = { lat: 33.45, lng: -112.07 };
  const comps = [
    { price: 500000, lat: 33.45, lng: -112.07 },        // 0 mi
    { price: 600000, lat: 33.46, lng: -112.08 },        // ~0.9 mi
    { price: 700000, lat: 33.9, lng: -112.5 },          // ~40 mi
    { price: 800000, lat: null, lng: null },            // no coords
    { price: 0, lat: 33.45, lng: -112.07 },             // no price
  ];
  it('keeps only priced comps with coords inside the radius, nearest first', () => {
    const near = filterNearby(comps, subject, 5);
    expect(near).toHaveLength(2);
    expect(near[0]!.price).toBe(500000);
    expect(near[0]!.distance_miles).toBeCloseTo(0, 3);
    expect(near[1]!.distance_miles).toBeLessThan(5);
  });
  it('wider radius admits more', () => {
    expect(filterNearby(comps, subject, 100)).toHaveLength(3);
  });
});

describe('compsStats', () => {
  const comps = [
    { price: 400000, beds_total: 8, sqft: 4000 },
    { price: 600000, beds_total: 10, sqft: null },
    { price: 500000, beds_total: null, sqft: 5000 },
  ];
  const s = compsStats(comps);
  it('counts and price spread', () => {
    expect(s.count).toBe(3);
    expect(s.median_price).toBe(500000);
    expect(s.min_price).toBe(400000);
    expect(s.max_price).toBe(600000);
  });
  it('$/bed uses only rows with beds and reports the sample size', () => {
    // 400000/8=50000 ; 600000/10=60000 → median 55000, sample 2
    expect(s.median_per_bed).toBe(55000);
    expect(s.per_bed_sample).toBe(2);
  });
  it('$/sqft uses only rows with sqft and reports the sample size', () => {
    // 400000/4000=100 ; 500000/5000=100 → median 100, sample 2
    expect(s.median_per_sqft).toBe(100);
    expect(s.per_sqft_sample).toBe(2);
  });
  it('empty input yields zero-count nulls', () => {
    const e = compsStats([]);
    expect(e.count).toBe(0);
    expect(e.median_per_bed).toBeNull();
    expect(e.median_per_sqft).toBeNull();
  });
});

describe('$/bed valuation', () => {
  it('salesCompsPerBed = pricePerBed × subject beds', () => {
    expect(salesCompsPerBed(55000, 8)).toBe(440000);
  });
  it('salesCompsPerBedValue returns null without price_per_bed or beds_total', () => {
    expect(salesCompsPerBedValue({ units: 4, total_sqft: 0, price_per_bed: 55000 })).toBeNull();
    expect(salesCompsPerBedValue({ units: 4, total_sqft: 0, beds_total: 8 })).toBeNull();
  });
  it('valuationPanel includes the per-bed method when inputs exist', () => {
    const panel = valuationPanel({
      units: 4,
      salesComps: { units: 4, total_sqft: 3400, price_per_bed: 55000, beds_total: 8 },
    });
    const pb = panel.results.find((r) => r.method === 'sales-comps-per-bed');
    expect(pb).toBeDefined();
    expect(pb!.value).toBe(440000);
    expect(pb!.primary).toBe(false); // per-unit comps stay the primary for 2–4u
  });
  it('valuationPanel omits the method when beds are unknown', () => {
    const panel = valuationPanel({
      units: 4,
      salesComps: { units: 4, total_sqft: 3400, price_per_unit: 130000 },
    });
    expect(panel.results.some((r) => r.method === 'sales-comps-per-bed')).toBe(false);
  });
});
