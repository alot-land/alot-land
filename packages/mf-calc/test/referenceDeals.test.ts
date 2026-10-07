/**
 * TWO FULLY HAND-VERIFIED REFERENCE DEALS.
 *
 * These are the anchor of the frozen calc engine (Engineering Rule #2). Every
 * number below is computed by hand in the comments and asserted against the
 * engine. If any of these break, a formula changed and CALC_VERSION must bump.
 *
 * Reference Deal 1 — clean fourplex (2–4u: comps primary; all-cash vs agency).
 * Reference Deal 2 — 10-unit value-add (5+u: direct cap primary; DSCR + exit + tax).
 */
import { describe, it, expect } from 'vitest';
import {
  emptyExpenses,
  totalOperatingExpenses,
  reassessedPropertyTax,
  totalCashInvested,
  annualGrossPotentialRent,
  totalUnits,
  totalSqft,
  lossToLease,
  noi as computeNoi,
  capRate,
  forward,
  valuationPanel,
  directCapValue,
  prescreen,
  scoreDeal,
  depreciation,
  taxYear,
  exitTax,
  type UnitType,
  type BuyBox,
} from '../src/index.js';

// ===========================================================================
// REFERENCE DEAL 1 — "Maple Fourplex", clean numbers, 2–4 unit class.
// ===========================================================================
describe('Reference Deal 1 — Maple Fourplex ($500k, 4u)', () => {
  const PRICE = 500000;
  const mix: UnitType[] = [
    { type: '2BR/1BA', count: 4, sqft: 850, actual_rent: 1500, market_rent: 1500 },
  ];

  // GPR = 4 × 1500 × 12 = 72,000
  const gpr = annualGrossPotentialRent(mix, 'market');

  // Operating expenses (annual), property tax RE-ASSESSED at purchase price:
  //   tax        = 500,000 × 0.9%           = 4,500
  //   insurance                              = 3,500
  //   management (flat)                      = 5,000
  //   utilities                              = 2,400
  //   R&M                                    = 3,000
  //   capex reserve (4u × $300)              = 1,200
  //   ------------------------------------------------
  //   total                                  = 19,600
  const exp = {
    ...emptyExpenses(),
    property_tax: reassessedPropertyTax(PRICE, 0.009),
    insurance: 3500,
    management: 5000,
    utilities: 2400,
    repairs_maintenance: 3000,
    capex_reserve: 1200,
  };
  const opex = totalOperatingExpenses(exp);

  // EGI = 72,000 × (1 − 0.05) = 68,400 ; NOI = 68,400 − 19,600 = 48,800
  const noi = computeNoi({
    gross_potential_rent: gpr,
    other_income: 0,
    vacancy_rate: 0.05,
    operating_expenses: opex,
  });

  it('GPR = $72,000; opex = $19,600 (tax reassessed at price); NOI = $48,800', () => {
    expect(gpr).toBe(72000);
    expect(exp.property_tax).toBe(4500);
    expect(opex).toBe(19600);
    expect(noi).toBe(48800);
  });

  it('cap rate on price = 9.76%', () => {
    expect(capRate(noi, PRICE)).toBeCloseTo(0.0976, 4);
  });

  // --- Financing: agency, 25% down, 7% / 30yr ---------------------------------
  // loan 375,000 ; ADS = 29,938.86 ; DSCR = 48,800 / 29,938.86 = 1.630
  // CFBT = 48,800 − 29,938.86 = 18,861 ; cash = 125,000 + 10,000 closing = 135,000
  // CoC = 18,861 / 135,000 = 13.97%
  it('agency financing: DSCR ≈ 1.630, CFBT ≈ $18,861, CoC ≈ 13.97%', () => {
    const cash = totalCashInvested({ down_payment: 125000, closing_costs: 10000, rehab: 0, furnishing: 0 });
    const r = forward({
      price: PRICE,
      noi,
      gross_potential_income: gpr,
      operating_expenses: opex,
      loan_amount: 375000,
      annual_rate: 0.07,
      amort_years: 30,
      cash_invested: cash,
      hold_years: 5,
      exit_cap_rate: 0.08,
    });
    expect(r.dscr).toBeCloseTo(1.63, 2);
    expect(r.cfbt).toBeGreaterThan(18855);
    expect(r.cfbt).toBeLessThan(18867);
    expect(r.cash_on_cash).toBeCloseTo(0.1397, 3);
  });

  // --- All-cash (private-investor framing) ------------------------------------
  // cash = 500,000 + 10,000 = 510,000 ; CFBT = NOI ; CoC = 48,800/510,000 = 9.57%
  it('all-cash: DSCR = Infinity, CoC ≈ 9.57%', () => {
    const r = forward({
      price: PRICE,
      noi,
      gross_potential_income: gpr,
      operating_expenses: opex,
      loan_amount: 0,
      annual_rate: 0.07,
      amort_years: 30,
      cash_invested: 510000,
      hold_years: 5,
      exit_cap_rate: 0.08,
    });
    expect(r.dscr).toBeNull(); // No debt: coverage is not applicable.
    expect(r.cash_on_cash).toBeCloseTo(0.0957, 3);
  });

  // --- Valuation panel (2–4u → comps primary) ---------------------------------
  it('valuation: comps primary; direct cap = $610,000; comps/unit = $520,000', () => {
    const panel = valuationPanel({
      units: totalUnits(mix),
      salesComps: { price_per_unit: 130000, units: 4, total_sqft: totalSqft(mix) },
      grm: { market_grm: 7, annual_gross_rent: gpr },
      directCap: { noi, market_cap_rate: 0.08 },
      dscrConstrained: { noi, min_dscr: 1.2, annual_rate: 0.07, amort_years: 30, ltv: 0.75 },
    });
    const comps = panel.results.find((r) => r.method === 'sales-comps-per-unit')!;
    const dc = panel.results.find((r) => r.method === 'direct-cap')!;
    expect(comps.primary).toBe(true);
    expect(comps.value).toBe(520000);
    expect(dc.primary).toBe(false);
    expect(dc.value).toBe(610000);
  });

  it('prescreen: 1985 build, individually metered, STR open → no flags', () => {
    expect(prescreen({ year_built: 1985, master_metered: false, str_permit_status: 'open' })).toEqual([]);
  });

  // --- Score against a balanced buy-box ---------------------------------------
  it('scores as a strong pursue (> 90)', () => {
    const box: BuyBox = {
      weight_cash_flow: 0.4,
      weight_appreciation: 0.2,
      weight_cost_seg: 0.2,
      weight_bottom_line: 0.2,
      pursue_threshold: 70,
      target_coc: 0.08,
      target_dscr: 1.25,
      target_appreciation_rate: 0.03,
      target_first_year_writeoff_ratio: 1.0,
      target_value_spread: 0.1,
    };
    // cost-seg: basis 400k (20% land) → 120k bonus + 280k/27.5 SL ≈ 130,182; equity 135k
    const dep = depreciation({ purchase_price: PRICE, land_value: 100000, cost_seg_pct: 0.3, bonus_rate: 1 });
    const r = scoreDeal(
      {
        cash_on_cash: 0.1397,
        dscr: 1.63,
        appreciation_rate: 0.03,
        first_year_writeoff_ratio: dep.first_year_total / 135000,
        value_spread: (610000 - PRICE) / PRICE, // 0.22
      },
      box,
    );
    expect(r.pursue).toBe(true);
    expect(r.score).toBeGreaterThan(90);
  });
});

// ===========================================================================
// REFERENCE DEAL 2 — "Cedar 10-Plex", value-add, 5+ unit class, with exit+tax.
// ===========================================================================
describe('Reference Deal 2 — Cedar 10-Plex ($1.0M, 10u value-add)', () => {
  const PRICE = 1000000;
  const mix: UnitType[] = [
    { type: '2BR/1BA', count: 6, sqft: 900, actual_rent: 1000, market_rent: 1200 },
    { type: '1BR/1BA', count: 4, sqft: 650, actual_rent: 850, market_rent: 950 },
  ];

  // GPR market = (6×1200 + 4×950) × 12 = 11,000 × 12 = 132,000
  // GPR actual = (6×1000 + 4×850) × 12 =  9,400 × 12 = 112,800
  const gprMarket = annualGrossPotentialRent(mix, 'market');
  const gprActual = annualGrossPotentialRent(mix, 'actual');

  // OpEx: tax reassessed 1.1% = 11,000; ins 8,000; mgmt 10,000; util 6,000;
  //       R&M 8,000; capex 10×300 = 3,000 → total 46,000
  const exp = {
    ...emptyExpenses(),
    property_tax: reassessedPropertyTax(PRICE, 0.011),
    insurance: 8000,
    management: 10000,
    utilities: 6000,
    repairs_maintenance: 8000,
    capex_reserve: 3000,
  };
  const opex = totalOperatingExpenses(exp);
  const otherIncome = 3000;
  const vacancy = 0.07;

  // Stabilized (market) NOI: EGI = 132,000×0.93 + 3,000 = 125,760 ; NOI = 79,760
  const noiMarket = computeNoi({
    gross_potential_rent: gprMarket,
    other_income: otherIncome,
    vacancy_rate: vacancy,
    operating_expenses: opex,
  });
  // In-place (actual) NOI: EGI = 112,800×0.93 + 3,000 = 107,904 ; NOI = 61,904
  const noiActual = computeNoi({
    gross_potential_rent: gprActual,
    other_income: otherIncome,
    vacancy_rate: vacancy,
    operating_expenses: opex,
  });

  it('GPR market $132k / actual $112.8k; opex $46k; NOI market $79,760 / actual $61,904', () => {
    expect(gprMarket).toBe(132000);
    expect(gprActual).toBe(112800);
    expect(exp.property_tax).toBe(11000);
    expect(opex).toBe(46000);
    expect(noiMarket).toBe(79760);
    expect(noiActual).toBe(61904);
  });

  it('loss-to-lease ≈ 14.5% → value-add story', () => {
    expect(lossToLease(mix)).toBeCloseTo(1600 / 11000, 4);
  });

  it('direct cap (5+u primary): stabilized $997k vs in-place $773.8k @ 8% cap', () => {
    expect(directCapValue({ noi: noiMarket, market_cap_rate: 0.08 })).toBe(997000);
    expect(directCapValue({ noi: noiActual, market_cap_rate: 0.08 })).toBe(773800);
  });

  it('valuation panel marks direct cap primary for 10 units', () => {
    const panel = valuationPanel({
      units: totalUnits(mix),
      directCap: { noi: noiMarket, market_cap_rate: 0.08 },
      salesComps: { price_per_unit: 100000, units: 10, total_sqft: totalSqft(mix) },
    });
    expect(panel.results.find((r) => r.method === 'direct-cap')!.primary).toBe(true);
  });

  // --- DSCR financing + 5yr exit ----------------------------------------------
  // loan 750,000 @ 7.5% / 30yr ; ADS ≈ 62,936 ; DSCR = 79,760/62,936 = 1.267
  // CFBT ≈ 16,824 ; cash = 250k down + 30k closing + 40k rehab = 320,000
  // CoC = 16,824 / 320,000 = 5.26%
  // exit: NOI grows 3%/yr → yr5 NOI = 79,760×1.03^5 = 92,464 ; value = /0.08 = 1,155,796
  const holdYears = 5;
  const r = forward({
    price: PRICE,
    noi: noiMarket,
    gross_potential_income: gprMarket + otherIncome,
    operating_expenses: opex,
    loan_amount: 750000,
    annual_rate: 0.075,
    amort_years: 30,
    cash_invested: 320000,
    hold_years: holdYears,
    exit_cap_rate: 0.08,
    noi_growth_rate: 0.03,
    selling_cost_rate: 0.06,
  });

  it('DSCR ≈ 1.267 and CFBT ≈ $16,824', () => {
    expect(r.dscr).toBeCloseTo(1.267, 2);
    expect(r.cfbt).toBeGreaterThan(16750);
    expect(r.cfbt).toBeLessThan(16900);
  });

  it('CoC (year 1, with rehab in basis) ≈ 5.26%', () => {
    expect(r.cash_on_cash).toBeCloseTo(0.0526, 3);
  });

  it('exit value ≈ $1,155,800 with 3% NOI growth', () => {
    const expected = (79760 * 1.03 ** holdYears) / 0.08;
    expect(r.exit_value).toBeCloseTo(expected, 0);
    expect(r.exit_value).toBeGreaterThan(1150000);
    expect(r.exit_value).toBeLessThan(1162000);
  });

  it('net sale proceeds are positive and IRR is finite & positive', () => {
    expect(r.net_sale_proceeds).toBeGreaterThan(0);
    expect(Number.isFinite(r.irr)).toBe(true);
    expect(r.irr).toBeGreaterThan(0);
    expect(r.equity_multiple).toBeGreaterThan(1);
  });

  // --- Tax layer: cost seg year 1, REP both ways ------------------------------
  it('cost-seg year-1 depreciation drives a REP-on loss offset; REP-off = 0', () => {
    // basis = 1,000,000 − 200,000 land = 800,000 ; 30% reclass = 240,000 bonus
    // + 560,000/27.5 SL = 20,364 → first-year total 260,364
    const dep = depreciation({ purchase_price: PRICE, land_value: 200000, cost_seg_pct: 0.3, bonus_rate: 1 });
    expect(dep.first_year_total).toBeCloseTo(260363.64, 1);

    const ty = taxYear({
      noi: noiMarket,
      loan_amount: 750000,
      annual_rate: 0.075,
      amort_years: 30,
      year: 1,
      depreciation_this_year: dep.first_year_total,
      marginal_rate: 0.37,
      passive_income_available: 0,
    });
    expect(ty.taxable_income).toBeLessThan(0); // paper loss
    expect(ty.benefit_rep_on).toBeGreaterThan(0); // offsets active income
    expect(ty.benefit_rep_off).toBe(0); // suspended, no passive income
  });

  it('exit tax recaptures depreciation at 25% + LTCG on appreciation', () => {
    const et = exitTax({
      sale_price: r.exit_value,
      selling_costs: r.exit_value * 0.06,
      purchase_price: PRICE,
      accumulated_depreciation: 300000, // ~5yr cumulative
      recapture_rate: 0.25,
      ltcg_rate: 0.2,
    });
    expect(et.recapture_portion).toBeLessThanOrEqual(300000);
    expect(et.total_exit_tax).toBeGreaterThan(0);
    expect(et.recapture_tax).toBeCloseTo(et.recapture_portion * 0.25, 4);
  });
});
