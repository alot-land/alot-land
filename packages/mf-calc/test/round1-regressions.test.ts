import { describe, it, expect } from 'vitest';
import { buildProforma, forward, irr, breakEvenOccupancy } from '../src/index.js';
// Exercise the production input bridge, not a parallel financial wrapper.
// @ts-expect-error The frontend is JavaScript without declaration files.
import { underwrite } from '../../../mfda/src/lib/underwrite.js';

const property = {
  price: 500000, land_value: 100000, hold_years: 10,
  units: [{ type: '2BR', count: 4, sqft: 850, actual_rent: 1200, market_rent: 1500 }],
  expenses: { insurance: 3000, management: 5000 },
};

describe('Round 1 starting-SHA financial regressions', () => {
  it('R0-1: debt service and principal stop after payoff', () => {
    const p = buildProforma({ gross_potential_rent: 24000, other_income: 0,
      vacancy_rate: 0, operating_expenses: 0, growth_rate: 0, loan_amount: 12000,
      annual_rate: 0, amort_years: 1, hold_years: 2, exit_cap_rate: .1,
      selling_cost_rate: 0, cash_invested: 100000 });
    console.log('R0-1 starting observation', JSON.stringify(p.years[1]));
    expect(p.years[1]!.debt_service).toBe(0);
    expect(p.years[1]!.principal).toBe(0);
    expect(p.years[1]!.cfbt).toBe(24000);
  });
  it('R0-2: seller balloons at 3 and 9 years produce different returns', () => {
    const a = underwrite({ ...property, financing: { seller: { balloon_years: 3 } } });
    const b = underwrite({ ...property, financing: { seller: { balloon_years: 9 } } });
    console.log('R0-2 returns', a.financing.seller_forward.irr, b.financing.seller_forward.irr);
    // Balloon funding creates multiple sign changes; the conservative IRR
    // policy explicitly withholds a guessed root. Cash flows/EM still differ.
    expect(a.financing.seller_forward.irr_status).toBe('non_conventional');
    expect(b.financing.seller_forward.irr_status).toBe('non_conventional');
    expect(a.financing.seller_forward.proforma.equity_cash_flows).not.toEqual(b.financing.seller_forward.proforma.equity_cash_flows);
    expect(a.financing.seller_forward.equity_multiple).not.toBe(b.financing.seller_forward.equity_multiple);
  });
  it('R0-3: non-finite cash flow cannot become 1000 percent IRR', () => {
    console.log('R0-3 IRR', irr([-100, NaN, 200]));
    expect(Number.isNaN(irr([-100, NaN, 200]))).toBe(true);
  });
  it('R0-4: fixed other income reduces rent required for break-even', () => {
    // $60k rent + $12k fixed other income; $36k costs => 40% rent occupancy.
    console.log('R0-4 BEO', breakEvenOccupancy(36000, 0, 60000, 12000));
    expect(breakEvenOccupancy(36000, 0, 60000, 12000)).toBeCloseTo(.4, 12);
  });
  it('R0-5: rehab is retained in simplified depreciable and sale basis', () => {
    const a = underwrite(property);
    const b = underwrite({ ...property, rehab: 100000 });
    console.log('R0-5 rehab basis', a.tax.depreciation.depreciable_basis, b.tax.depreciation.depreciable_basis);
    expect(b.tax.depreciation.depreciable_basis - a.tax.depreciation.depreciable_basis).toBe(100000);
    expect(b.tax.exit.adjusted_basis).toBeGreaterThan(a.tax.exit.adjusted_basis);
  });
  it('R0-7: known property count cannot be silently overwritten by a default mix', () => {
    expect(() => underwrite({ ...property, units_count: 12 })).toThrow(/unit/i);
  });
  it('adjacent: a half-year hold includes the sale at the correct time', () => {
    const a = forward({ price: 100, noi: 0, gross_potential_income: 0,
      operating_expenses: 0, loan_amount: 0, annual_rate: 0, amort_years: 30,
      cash_invested: 100, hold_years: .5, exit_cap_rate: .1, selling_cost_rate: 0 });
    // No sale value and no positive flow: explicit unavailable IRR.
    expect(a.irr).toBeNull();
  });
});
