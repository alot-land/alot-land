/**
 * v1.2.0 — investor proforma. Anchored to Reference Deal 2 (Cedar 10-Plex) and
 * to the consistency contract with forward().
 */
import { describe, it, expect } from 'vitest';
import { buildProforma } from '../src/proforma.js';
import { forward } from '../src/financing.js';
import { CALC_VERSION } from '../src/types.js';

describe('CALC_VERSION', () => {
  it('is at least 1.2.0 (the proforma addition)', () => {
    const [maj=0, min=0] = CALC_VERSION.split('.').map(Number);
    expect(maj * 100 + min).toBeGreaterThanOrEqual(102);
  });
});

// Cedar 10-Plex numbers (hand-verified in referenceDeals.test.ts):
// GPR 132,000 · other 3,000 · vac 7% · opex 46,000 → NOI 79,760
// loan 750,000 @ 7.5%/30 · hold 5 · exit cap 8% · sell 6% · cash 320,000 · g 3%
const INP = {
  gross_potential_rent: 132000,
  other_income: 3000,
  vacancy_rate: 0.07,
  operating_expenses: 46000,
  growth_rate: 0.03,
  loan_amount: 750000,
  annual_rate: 0.075,
  amort_years: 30,
  hold_years: 5,
  exit_cap_rate: 0.08,
  selling_cost_rate: 0.06,
  cash_invested: 320000,
};

const pf = buildProforma(INP);

describe('proforma years', () => {
  it('has one row per hold year', () => {
    expect(pf.years).toHaveLength(5);
    expect(pf.years[0]!.year).toBe(1);
    expect(pf.years[4]!.year).toBe(5);
  });

  it('year 1 reproduces the hand-verified Cedar NOI ($79,760)', () => {
    const y1 = pf.years[0]!;
    expect(y1.gpr).toBe(132000);
    expect(y1.vacancy_loss).toBeCloseTo(9240, 6);
    expect(y1.egi).toBeCloseTo(125760, 6);
    expect(y1.operating_expenses).toBe(46000);
    expect(y1.noi).toBeCloseTo(79760, 6);
  });

  it('year N NOI = year-1 NOI × (1+g)^(N-1) — single-growth contract', () => {
    for (const y of pf.years) {
      expect(y.noi).toBeCloseTo(79760 * 1.03 ** (y.year - 1), 4);
    }
  });

  it('debt service is constant and splits into interest + principal', () => {
    for (const y of pf.years) {
      expect(y.debt_service).toBeCloseTo(pf.years[0]!.debt_service, 4);
      expect(y.interest + y.principal).toBeCloseTo(y.debt_service, 2);
    }
    // amortization: interest falls, principal rises
    expect(pf.years[4]!.interest).toBeLessThan(pf.years[0]!.interest);
    expect(pf.years[4]!.principal).toBeGreaterThan(pf.years[0]!.principal);
  });

  it('loan balance declines monotonically', () => {
    let prev = INP.loan_amount;
    for (const y of pf.years) {
      expect(y.loan_balance_end).toBeLessThan(prev);
      prev = y.loan_balance_end;
    }
  });

  it('cumulative CFBT is the running sum and CoC = CFBT / cash', () => {
    let run = 0;
    for (const y of pf.years) {
      run += y.cfbt;
      expect(y.cumulative_cfbt).toBeCloseTo(run, 6);
      expect(y.cash_on_cash).toBeCloseTo(y.cfbt / 320000, 8);
    }
  });
});

describe('proforma ↔ forward consistency', () => {
  const fwd = forward({
    price: 1000000,
    noi: 79760,
    gross_potential_income: 135000,
    operating_expenses: 46000,
    loan_amount: 750000,
    annual_rate: 0.075,
    amort_years: 30,
    cash_invested: 320000,
    hold_years: 5,
    exit_cap_rate: 0.08,
    noi_growth_rate: 0.03,
    selling_cost_rate: 0.06,
  });

  it('exit value matches forward() exactly', () => {
    expect(pf.exit.exit_value).toBeCloseTo(fwd.exit_value, 4);
  });
  it('loan payoff matches forward() balance at exit', () => {
    expect(pf.exit.loan_payoff).toBeCloseTo(fwd.loan_balance_at_exit, 4);
  });
  it('net sale proceeds match forward()', () => {
    expect(pf.exit.net_sale_proceeds).toBeCloseTo(fwd.net_sale_proceeds, 4);
  });
  it('equity multiple matches forward()', () => {
    expect(pf.exit.equity_multiple).toBeCloseTo(fwd.equity_multiple!, 6);
  });
  it('year-5 CFBT equals the forward flow for year 5 (ex-sale)', () => {
    const y5 = pf.years[4]!;
    expect(y5.cfbt).toBeCloseTo(79760 * 1.03 ** 4 - y5.debt_service, 4);
  });
});

describe('edge cases', () => {
  it('all-cash proforma: no debt service, balance 0, exit has no payoff', () => {
    const cash = buildProforma({ ...INP, loan_amount: 0, cash_invested: 1030000 });
    expect(cash.years[0]!.debt_service).toBe(0);
    expect(cash.years[0]!.loan_balance_end).toBe(0);
    expect(cash.exit.loan_payoff).toBe(0);
    expect(cash.years[0]!.cfbt).toBeCloseTo(79760, 6);
  });
  it('total profit = cumulative CF + net proceeds − equity', () => {
    const last = pf.years[4]!;
    expect(pf.exit.total_profit).toBeCloseTo(
      last.cumulative_cfbt + pf.exit.net_sale_proceeds - 320000,
      6,
    );
  });
});
