import { describe, it, expect } from 'vitest';
import { checkPlausibility, DEFAULT_PLAUSIBILITY, screenParcel, CALC_VERSION } from '../src/index.js';

describe('checkPlausibility', () => {
  it('passes an ordinary deal without comment', () => {
    // $500k fourplex at $1,500/unit, ~9.8% cap — unremarkable.
    const r = checkPlausibility({ units: 4, price: 500_000, rent_per_unit: 1500, cap_rate: 0.098 });
    expect(r.ok).toBe(true);
    expect(r.flags).toEqual([]);
    expect(r.price_per_unit).toBe(125_000);
  });

  it('catches the Glendale case that produced a 100/100 PURSUE', () => {
    // Real 2026-07-25 data: county band "APARTMENTS 25 - 99 UNITS" stored as
    // 25, against a $137,900 assessed value. $5,516/unit.
    const r = checkPlausibility({ units: 25, price: 137_900, cap_rate: 1.7269 });
    expect(r.ok).toBe(false);
    const codes = r.flags.map((f) => f.code);
    expect(codes).toContain('price_per_unit_too_low');
    expect(codes).toContain('cap_rate_impossible');
    expect(Math.round(r.price_per_unit!)).toBe(5516);
    // The message has to be readable next to the number, not a code.
    expect(r.flags[0].message).toContain('$5,516 per unit');
  });

  it('flags a price per unit that implies the unit count is a floor', () => {
    const r = checkPlausibility({ units: 2, price: 6_000_000 });
    expect(r.flags.map((f) => f.code)).toEqual(['price_per_unit_too_high']);
    expect(r.flags[0].message).toContain('25 - 99 UNITS');
  });

  it('flags a rent that is really a whole-building figure', () => {
    const r = checkPlausibility({ units: 10, price: 1_500_000, rent_per_unit: 45_000 });
    expect(r.flags.map((f) => f.code)).toEqual(['rent_per_unit_too_high']);
  });

  it('says nothing about missing inputs — that is the insufficient path', () => {
    expect(checkPlausibility({}).ok).toBe(true);
    expect(checkPlausibility({ units: 4 }).ok).toBe(true);
    expect(checkPlausibility({ price: 500_000 }).ok).toBe(true);
    // Zero and negative are treated as absent, not as absurd.
    expect(checkPlausibility({ units: 0, price: 0 }).ok).toBe(true);
    expect(checkPlausibility({ units: 4, price: 500_000, cap_rate: null }).ok).toBe(true);
  });

  it('leaves merely unusual deals alone', () => {
    // A genuinely cheap rural fourplex and a genuinely strong cap must pass —
    // the thresholds exist to catch impossible, not remarkable.
    expect(checkPlausibility({ units: 4, price: 90_000, cap_rate: 0.22 }).ok).toBe(true);
    // Right at the boundary, both directions.
    expect(checkPlausibility({ units: 1, price: DEFAULT_PLAUSIBILITY.min_price_per_unit }).ok).toBe(true);
    expect(checkPlausibility({ units: 1, price: DEFAULT_PLAUSIBILITY.max_price_per_unit }).ok).toBe(true);
    expect(checkPlausibility({ units: 4, price: 500_000, cap_rate: DEFAULT_PLAUSIBILITY.max_cap_rate }).ok).toBe(true);
  });

  it('accepts caller thresholds', () => {
    const r = checkPlausibility({ units: 4, price: 500_000, thresholds: { min_price_per_unit: 200_000 } });
    expect(r.flags.map((f) => f.code)).toEqual(['price_per_unit_too_low']);
  });
});

describe('screenParcel plausibility gate', () => {
  it('returns implausible instead of a verdict when the inputs cannot be real', () => {
    const s = screenParcel({ units: 25, market_rent_monthly: 1500, price_anchor: 137_900 });
    // Previously this scored 'pursue' — a confidently wrong recommendation.
    expect(s.verdict).toBe('implausible');
    expect(s.plausible).toBe(false);
    expect(s.flags.length).toBeGreaterThan(0);
    // The arithmetic is still returned; it is the VERDICT that is withheld.
    expect(s.noi).toBeGreaterThan(0);
    expect(s.cap_rate).toBeGreaterThan(1);
  });

  it('leaves a normal parcel screening exactly as before', () => {
    const s = screenParcel({ units: 4, market_rent_monthly: 1500, price_anchor: 500_000 });
    expect(s.plausible).toBe(true);
    expect(s.flags).toEqual([]);
    expect(['pursue', 'consider', 'pass']).toContain(s.verdict);
  });

  it('still reports insufficient when data is missing, not implausible', () => {
    // Missing beats absurd — an absent unit count is a data gap, not a lie.
    const s = screenParcel({ units: null, market_rent_monthly: 1500, price_anchor: 137_900 });
    expect(s.verdict).toBe('insufficient');
    expect(s.plausible).toBe(true);
  });
});

describe('version', () => {
  it('is at least the version that introduced the plausibility gate', () => {
    expect(CALC_VERSION >= '1.14.0').toBe(true);
  });
});
