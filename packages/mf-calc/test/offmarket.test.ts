/**
 * Off-market parcel screening — added in calc v1.4.0 (new module + tests per
 * the frozen-module protocol). Tests written BEFORE the implementation.
 *
 * Context: off-market parcels have NO asking price and NO actual rents. The
 * screen estimates income from a zip rent band, expenses from standard
 * rates, anchors value on the county appraisal, and produces an honest
 * verdict — 'insufficient' rather than a fabricated score when inputs are
 * missing.
 */
import { describe, it, expect } from 'vitest';
import {
  CALC_VERSION,
  estimateOperatingExpenses,
  screenParcel,
  DEFAULT_EXPENSE_RATES,
  annualDebtService,
  totalOperatingExpenses,
} from '../src/index.js';

describe('calc version', () => {
  it('is at least 1.4.0 (offmarket module)', () => {
    const [maj, min] = CALC_VERSION.split('.').map(Number);
    expect(maj! > 1 || (maj === 1 && min! >= 4)).toBe(true);
  });
});

describe('estimateOperatingExpenses', () => {
  // 4 units × $1,400 → GPR 67,200; 5% vacancy → EGI 63,840.
  const e = estimateOperatingExpenses({
    units: 4,
    gross_potential_rent: 67_200,
    vacancy_rate: 0.05,
  });

  it('applies the default per-unit and percentage rates exactly', () => {
    expect(e.insurance).toBeCloseTo(4 * DEFAULT_EXPENSE_RATES.insurance_per_unit, 6);
    expect(e.management).toBeCloseTo(0.08 * 63_840, 6); // % of EGI
    expect(e.repairs_maintenance).toBeCloseTo(0.08 * 67_200, 6); // % of GPR
    expect(e.utilities).toBeCloseTo(4 * DEFAULT_EXPENSE_RATES.utilities_per_unit, 6);
    expect(e.capex_reserve).toBeCloseTo(4 * DEFAULT_EXPENSE_RATES.capex_per_unit, 6);
  });

  it('leaves property tax at 0 for the caller to reassess', () => {
    expect(e.property_tax).toBe(0);
    expect(e.str_cleaning).toBe(0);
  });

  it('accepts rate overrides', () => {
    const custom = estimateOperatingExpenses({
      units: 10,
      gross_potential_rent: 120_000,
      vacancy_rate: 0.1,
      rates: { insurance_per_unit: 700, management_rate: 0.1 },
    });
    expect(custom.insurance).toBeCloseTo(7_000, 6);
    expect(custom.management).toBeCloseTo(0.1 * 108_000, 6);
  });
});

describe('screenParcel', () => {
  const strong = screenParcel({
    units: 4,
    market_rent_monthly: 1_400,
    price_anchor: 400_000,
  });

  it('computes GPR, NOI, and cap rate on the anchor exactly', () => {
    expect(strong.gpr).toBeCloseTo(67_200, 6);
    // EGI 63,840 − (est opex 14,883.2 + tax 400,000×1% = 4,000) = 44,956.8
    expect(strong.opex).toBeCloseTo(18_883.2, 4);
    expect(strong.noi).toBeCloseTo(44_956.8, 4);
    expect(strong.cap_rate).toBeCloseTo(44_956.8 / 400_000, 8);
  });

  it('computes DSCR against the default 75% LTV loan', () => {
    const debt = annualDebtService(300_000, 0.075, 30);
    expect(strong.annual_debt_service).toBeCloseTo(debt, 6);
    expect(strong.dscr).toBeCloseTo(44_956.8 / debt, 6);
    expect(strong.cash_flow).toBeCloseTo(44_956.8 - debt, 4);
  });

  it('strong economics → pursue', () => {
    // cap 11.2%, dscr ~1.79 — clears both bars comfortably
    expect(strong.verdict).toBe('pursue');
    expect(strong.ok).toBe(true);
    expect(strong.missing).toEqual([]);
  });

  it('overpriced anchor → pass', () => {
    const weak = screenParcel({ units: 2, market_rent_monthly: 900, price_anchor: 800_000 });
    expect(weak.verdict).toBe('pass');
  });

  it('borderline economics → consider', () => {
    // Find a price where dscr is between 90% and 100% of the 1.25 bar.
    const mid = screenParcel({ units: 4, market_rent_monthly: 1_400, price_anchor: 572_000 });
    expect(mid.dscr).toBeGreaterThan(1.25 * 0.9);
    expect(mid.dscr).toBeLessThan(1.25);
    expect(mid.verdict).toBe('consider');
  });

  it('missing inputs → insufficient, with the gaps named, no fabricated numbers', () => {
    const noUnits = screenParcel({ units: null, market_rent_monthly: 1_400, price_anchor: 400_000 });
    expect(noUnits.verdict).toBe('insufficient');
    expect(noUnits.ok).toBe(false);
    expect(noUnits.missing).toContain('units');
    expect(noUnits.noi).toBeNull();
    const noRent = screenParcel({ units: 4, market_rent_monthly: null, price_anchor: 400_000 });
    expect(noRent.missing).toContain('market_rent_monthly');
    const noAnchor = screenParcel({ units: 4, market_rent_monthly: 1_400, price_anchor: null });
    expect(noAnchor.missing).toContain('price_anchor');
  });

  it('respects threshold overrides', () => {
    const strict = screenParcel({
      units: 4,
      market_rent_monthly: 1_400,
      price_anchor: 400_000,
      target_cap: 0.15, // absurdly strict → same deal no longer pursues
    });
    expect(strict.verdict).not.toBe('pursue');
  });

  it('estimated expense panel reconciles with totalOperatingExpenses', () => {
    expect(totalOperatingExpenses(strong.expenses)).toBeCloseTo(strong.opex, 4);
  });
});
