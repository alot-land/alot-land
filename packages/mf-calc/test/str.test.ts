/**
 * STR (short-term rental) comparison — added in calc v1.9.0 (new module +
 * tests per the frozen-module protocol). Tests written BEFORE the
 * implementation.
 */
import { describe, it, expect } from 'vitest';
import { CALC_VERSION, strComparison, annualDebtService } from '../src/index.js';

describe('calc version', () => {
  it('is at least 1.9.0 (str module)', () => {
    const [maj, min] = CALC_VERSION.split('.').map(Number);
    expect(maj! > 1 || (maj === 1 && min! >= 9)).toBe(true);
  });
});

describe('strComparison', () => {
  const inp = {
    units: 4,
    adr: 150,
    occupancy_rate: 0.65,
    avg_stay_days: 3,
    cost_per_turn: 120,
    str_management_rate: 0.22,
    platform_fee_rate: 0.03,
    /** LTR operating expenses EXCLUDING LTR management (taxes, insurance,
     * repairs, utilities, reserves carry over to the STR case). */
    base_operating_expenses: 12_000,
    loan_amount: 450_000,
    annual_rate: 0.075,
    amort_years: 30,
    cash_invested: 168_000,
    /** LTR side, for deltas (from the main underwrite). */
    ltr_noi: 44_956.8,
    ltr_cfbt: 7_199.4,
  };
  const r = strComparison(inp);

  it('computes occupied nights, turns, and gross revenue exactly', () => {
    expect(r.occupied_nights).toBeCloseTo(4 * 365 * 0.65, 6); // 949
    expect(r.gross_revenue).toBeCloseTo(949 * 150, 6); // 142,350
    expect(r.turns).toBeCloseTo(949 / 3, 6);
  });

  it('builds the STR expense stack on top of the carried-over base', () => {
    expect(r.expenses.str_cleaning).toBeCloseTo((949 / 3) * 120, 4);
    expect(r.expenses.management).toBeCloseTo(0.22 * 142_350, 4);
    expect(r.expenses.str_platform_fees).toBeCloseTo(0.03 * 142_350, 4);
    expect(r.opex_total).toBeCloseTo(12_000 + (949 / 3) * 120 + 0.22 * 142_350 + 0.03 * 142_350, 4);
  });

  it('NOI, DSCR, cash flow, CoC on the same loan', () => {
    const noi = 142_350 - r.opex_total;
    expect(r.noi).toBeCloseTo(noi, 4);
    const debt = annualDebtService(450_000, 0.075, 30);
    expect(r.dscr).toBeCloseTo(noi / debt, 6);
    expect(r.cfbt).toBeCloseTo(noi - debt, 4);
    expect(r.cash_on_cash).toBeCloseTo((noi - debt) / 168_000, 8);
  });

  it('reports the deltas against the LTR side', () => {
    expect(r.noi_delta).toBeCloseTo(r.noi - 44_956.8, 4);
    expect(r.cfbt_delta).toBeCloseTo(r.cfbt - 7_199.4, 4);
  });

  it('flags material-participation eligibility from the stay length', () => {
    expect(r.material_participation_hint).toBe(true); // 3-night stays ≤ 7
    const monthly = strComparison({ ...inp, avg_stay_days: 30 });
    expect(monthly.material_participation_hint).toBe(false);
  });

  it('rejects nonsense inputs with null instead of fabricated numbers', () => {
    expect(strComparison({ ...inp, adr: 0 })).toBeNull();
    expect(strComparison({ ...inp, occupancy_rate: 1.5 })).toBeNull();
    expect(strComparison({ ...inp, units: 0 })).toBeNull();
  });
});
