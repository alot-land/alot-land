import { describe, it, expect } from 'vitest';
import {
  forward,
  minDownForTargets,
  maxOfferForTargets,
  sellerFinanceOffers,
  exitNoi,
} from '../src/financing.js';
import { dscr, annualDebtService } from '../src/finance.js';

describe('forward underwrite', () => {
  const inp = {
    price: 500000,
    noi: 44400,
    gross_potential_income: 72000,
    operating_expenses: 24000,
    loan_amount: 375000,
    annual_rate: 0.07,
    amort_years: 30,
    cash_invested: 125000,
    hold_years: 5,
    exit_cap_rate: 0.08,
    noi_growth_rate: 0,
    selling_cost_rate: 0.06,
  };
  const r = forward(inp);

  it('DSCR ≈ 1.483', () => {
    expect(r.dscr).toBeCloseTo(1.483, 2);
  });
  it('CoC ≈ 11.57%', () => {
    expect(r.cash_on_cash).toBeCloseTo(0.1157, 3);
  });
  it('CFBT ≈ $14,461', () => {
    expect(r.cfbt).toBeCloseTo(14461, 0);
  });
  it('exit value with flat NOI = NOI/exit cap', () => {
    expect(r.exit_value).toBeCloseTo(44400 / 0.08, 0); // 555,000
  });
  it('produces a finite positive IRR', () => {
    expect(r.irr).toBeGreaterThan(0);
    expect(Number.isFinite(r.irr)).toBe(true);
  });
  it('equity multiple > 1 for a cash-flowing deal with gain', () => {
    expect(r.equity_multiple).toBeGreaterThan(1);
  });
  it('all-cash (loan 0) has unavailable DSCR and lower CoC', () => {
    const cash = forward({ ...inp, loan_amount: 0, cash_invested: 500000 });
    expect(cash.dscr).toBeNull();
    expect(cash.cash_on_cash).toBeCloseTo(44400 / 500000, 4); // 8.88% unlevered
  });
});

describe('exitNoi', () => {
  it('grows NOI at the growth rate over the hold', () => {
    expect(exitNoi(100000, 0.03, 5)).toBeCloseTo(100000 * 1.03 ** 5, 4);
  });
});

describe('inverse A — min down for targets', () => {
  it('finds a down where DSCR ≥ 1.20 and CoC ≥ target, and DSCR actually clears', () => {
    const res = minDownForTargets({
      price: 500000,
      noi: 44400,
      annual_rate: 0.07,
      amort_years: 30,
      other_cash: 0,
      min_dscr: 1.2,
      target_coc: 0.08,
    });
    expect(res).not.toBeNull();
    expect(res!.dscr).toBeGreaterThanOrEqual(1.2);
    expect(res!.cash_on_cash).toBeGreaterThanOrEqual(0.08);
  });
  it('returns null when targets are unreachable', () => {
    const res = minDownForTargets({
      price: 500000,
      noi: 44400,
      annual_rate: 0.07,
      amort_years: 30,
      other_cash: 0,
      min_dscr: 1.2,
      target_coc: 0.9, // impossible
    });
    expect(res).toBeNull();
  });
});

describe('inverse B — max offer for targets', () => {
  it('the returned max offer meets DSCR/CoC and a higher price would fail', () => {
    const noiAtPrice = (price: number) => {
      // NOI shrinks slightly as price rises (re-assessed taxes at 1.2% of price).
      const baseNoi = 44400 + 500000 * 0.012; // strip out the tax baked into 44400 base
      return baseNoi - price * 0.012;
    };
    const res = maxOfferForTargets({
      noiAtPrice,
      gross_potential_income: 72000,
      ltv: 0.75,
      annual_rate: 0.07,
      amort_years: 30,
      closing_rate: 0,
      flat_cash: 0,
      min_dscr: 1.2,
      target_coc: 0.08,
      price_low: 100000,
      price_high: 900000,
    });
    expect(res).not.toBeNull();
    expect(res!.dscr).toBeGreaterThanOrEqual(1.2 - 1e-6);
    expect(res!.cash_on_cash).toBeGreaterThanOrEqual(0.08 - 1e-6);
    // A price $20k higher should violate at least one target.
    const higher = res!.max_offer + 20000;
    const noi = noiAtPrice(higher);
    const loan = higher * 0.75;
    const ads = annualDebtService(loan, 0.07, 30);
    const cfbt = noi - ads;
    const coc = cfbt / (higher - loan);
    const worseDscr = dscr(noi, ads);
    expect(worseDscr < 1.2 || coc < 0.08).toBe(true);
  });
});

describe('seller finance offers', () => {
  const offers = sellerFinanceOffers({
    list_price: 500000,
    low_rate: 0.04,
    mid_rate: 0.06,
    cash_discount: 0.12,
    down_fraction: 0.1,
    amort_years: 30,
    balloon_years: 5,
  });
  it('returns three labeled options', () => {
    expect(offers).toHaveLength(3);
    expect(offers.map((o) => o.label)).toEqual(['Full price / low rate', 'Mid', 'Cash discount']);
  });
  it('full-price option keeps list price', () => {
    expect(offers[0]!.price).toBe(500000);
  });
  it('cash-discount option discounts list by 12%', () => {
    expect(offers[2]!.price).toBe(440000);
  });
  it('lower rate → lower payment at equal price', () => {
    expect(offers[0]!.monthly_payment).toBeLessThan(offers[1]!.monthly_payment);
  });
});
