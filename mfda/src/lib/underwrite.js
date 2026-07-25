/**
 * Underwrite orchestrator — the ONLY bridge between a stored deal and the
 * frozen @alot/mf-calc engine.
 *
 * DISCIPLINE (Engineering Rule #1): every financial FORMULA is a call into
 * mf-calc. This file only (a) assembles inputs and (b) computes a couple of
 * trivial ratios that *feed* mf-calc's scoring (input preparation, which the
 * rule explicitly permits). No NOI/DSCR/IRR/valuation/tax math lives here.
 *
 * The returned object is what the results view renders AND what we snapshot
 * immutably into `scenarios.outputs` alongside `calc_version`.
 */
import * as mf from '@alot/mf-calc';

const DEFAULTS = {
  vacancy_rate: 0.05,
  closing_cost_rate: 0.02,
  hold_years: 5,
  exit_cap_rate: 0.08,
  noi_growth_rate: 0.03,
  selling_cost_rate: 0.06,
  assessment_ratio: 1,
  property_tax_rate: 0.01,
  targets: { min_dscr: 1.2, target_coc: 0.08 },
  tax: {
    cost_seg_pct: 0.3,
    bonus_rate: 1.0,
    marginal_rate: 0.37,
    recapture_rate: 0.25,
    ltcg_rate: 0.2,
  },
  financing: {
    dscr: { ltv: 0.75, rate: 0.075, amort_years: 30 },
    agency: { ltv: 0.75, rate: 0.07, amort_years: 30 },
    seller: {
      low_rate: 0.04,
      mid_rate: 0.06,
      cash_discount: 0.1,
      down_fraction: 0.1,
      amort_years: 30,
      balloon_years: 5,
    },
  },
  buy_box: {
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
  },
};

/** Shallow-merge helper for nested defaults (input prep only). */
function withDefaults(deal) {
  return {
    ...DEFAULTS,
    ...deal,
    targets: { ...DEFAULTS.targets, ...(deal.targets || {}) },
    tax: { ...DEFAULTS.tax, ...(deal.tax || {}) },
    financing: {
      dscr: { ...DEFAULTS.financing.dscr, ...(deal.financing?.dscr || {}) },
      agency: { ...DEFAULTS.financing.agency, ...(deal.financing?.agency || {}) },
      seller: { ...DEFAULTS.financing.seller, ...(deal.financing?.seller || {}) },
    },
    buy_box: { ...DEFAULTS.buy_box, ...(deal.buy_box || {}) },
    valuation_comps: deal.valuation_comps || {},
    prescreen: deal.prescreen || {},
    expenses: deal.expenses || {},
  };
}

/** Build a mf-calc ExpenseInputs from form values + the re-assessed tax. */
function buildExpenses(d) {
  const e = { ...mf.emptyExpenses(), ...d.expenses };
  e.property_tax = mf.reassessedPropertyTax(d.price, d.property_tax_rate, d.assessment_ratio);
  return e;
}

/** One financing structure's forward result. */
function financingForward(d, noiValue, gpi, opex, loanAmount, rate, amortYears, extraCash) {
  const cash = mf.totalCashInvested({
    down_payment: d.price - loanAmount,
    closing_costs: d.price * d.closing_cost_rate,
    rehab: d.rehab || 0,
    furnishing: d.furnishing || 0,
  }) + (extraCash || 0);
  return mf.forward({
    price: d.price,
    noi: noiValue,
    gross_potential_income: gpi,
    operating_expenses: opex,
    loan_amount: loanAmount,
    annual_rate: rate,
    amort_years: amortYears,
    cash_invested: cash,
    hold_years: d.hold_years,
    exit_cap_rate: d.exit_cap_rate,
    noi_growth_rate: d.noi_growth_rate,
    selling_cost_rate: d.selling_cost_rate,
  });
}

export function underwrite(dealInput) {
  const d = withDefaults(dealInput);
  const units = d.units || [];

  // --- Income / NOI (mf-calc) ---
  const unitsTotal = mf.totalUnits(units);
  const sqftTotal = mf.totalSqft(units);
  const gprMarket = mf.annualGrossPotentialRent(units, 'market');
  const gprActual = mf.annualGrossPotentialRent(units, 'actual');
  const basis = d.rent_basis === 'actual' ? 'actual' : 'market';
  const gpr = basis === 'actual' ? gprActual : gprMarket;

  const exp = buildExpenses(d);
  const opex = mf.totalOperatingExpenses(exp);
  const otherIncome = d.other_income || 0;

  const noiArgs = (g) => ({
    gross_potential_rent: g,
    other_income: otherIncome,
    vacancy_rate: d.vacancy_rate,
    operating_expenses: opex,
  });
  const noiValue = mf.noi(noiArgs(gpr));
  const noiMarket = mf.noi(noiArgs(gprMarket));
  const noiActual = mf.noi(noiArgs(gprActual));
  const egi = mf.effectiveGrossIncome(noiArgs(gpr));
  const capOnPrice = mf.capRate(noiValue, d.price);
  const gpi = gpr + otherIncome;

  // --- Valuation panel (mf-calc) ---
  const vc = d.valuation_comps;
  const valuation = mf.valuationPanel({
    units: unitsTotal,
    salesComps:
      vc.price_per_unit != null || vc.price_per_sqft != null || vc.price_per_bed != null
        ? {
            price_per_unit: vc.price_per_unit,
            price_per_sqft: vc.price_per_sqft,
            price_per_bed: vc.price_per_bed,
            beds_total: d.beds_total ?? undefined,
            units: unitsTotal,
            total_sqft: sqftTotal,
          }
        : undefined,
    grm: vc.market_grm != null ? { market_grm: vc.market_grm, annual_gross_rent: gprMarket } : undefined,
    directCap:
      vc.market_cap_rate != null ? { noi: noiMarket, market_cap_rate: vc.market_cap_rate } : undefined,
    dscrConstrained: {
      noi: noiValue,
      min_dscr: d.targets.min_dscr,
      annual_rate: d.financing.dscr.rate,
      amort_years: d.financing.dscr.amort_years,
      ltv: d.financing.dscr.ltv,
    },
    replacementCost:
      vc.replacement_cost_per_unit != null
        ? {
            cost_per_unit: vc.replacement_cost_per_unit,
            units: unitsTotal,
            total_sqft: sqftTotal,
            land_value: d.land_value || 0,
          }
        : undefined,
  });

  // --- Financing comparator: all four side by side (mf-calc.forward) ---
  const fin = d.financing;
  const allCash = financingForward(d, noiValue, gpi, opex, 0, fin.agency.rate, fin.agency.amort_years);
  const dscrLoan = financingForward(
    d, noiValue, gpi, opex, d.price * fin.dscr.ltv, fin.dscr.rate, fin.dscr.amort_years,
  );
  const agencyLoan = financingForward(
    d, noiValue, gpi, opex, d.price * fin.agency.ltv, fin.agency.rate, fin.agency.amort_years,
  );
  const sellerOffers = mf.sellerFinanceOffers({
    list_price: d.price,
    low_rate: fin.seller.low_rate,
    mid_rate: fin.seller.mid_rate,
    cash_discount: fin.seller.cash_discount,
    down_fraction: fin.seller.down_fraction,
    amort_years: fin.seller.amort_years,
    balloon_years: fin.seller.balloon_years,
  });
  // Representative seller-finance forward = the "mid" option.
  const mid = sellerOffers[1];
  const sellerForward = financingForward(
    d, noiValue, gpi, opex, mid.loan_amount, mid.rate, fin.seller.amort_years,
    // seller-finance down replaces the standard down in cash-invested:
    mid.down_payment - (d.price - mid.loan_amount),
  );

  // --- Inverse solvers (mf-calc) ---
  const otherCash = d.price * d.closing_cost_rate + (d.rehab || 0) + (d.furnishing || 0);
  const minDown = mf.minDownForTargets({
    price: d.price,
    noi: noiValue,
    annual_rate: fin.dscr.rate,
    amort_years: fin.dscr.amort_years,
    other_cash: otherCash,
    min_dscr: d.targets.min_dscr,
    target_coc: d.targets.target_coc,
  });
  // Inverse B: NOI as a function of price (re-assessed tax falls with price).
  const opexExTax = opex - exp.property_tax;
  const noiAtPrice = (price) => {
    const tax = mf.reassessedPropertyTax(price, d.property_tax_rate, d.assessment_ratio);
    return mf.noi({
      gross_potential_rent: gpr,
      other_income: otherIncome,
      vacancy_rate: d.vacancy_rate,
      operating_expenses: opexExTax + tax,
    });
  };
  const maxOffer = mf.maxOfferForTargets({
    noiAtPrice,
    gross_potential_income: gpi,
    ltv: fin.dscr.ltv,
    annual_rate: fin.dscr.rate,
    amort_years: fin.dscr.amort_years,
    closing_rate: d.closing_cost_rate,
    flat_cash: (d.rehab || 0) + (d.furnishing || 0),
    min_dscr: d.targets.min_dscr,
    target_coc: d.targets.target_coc,
    price_high: d.price * 1.5,
  });

  // --- Stress panel (mf-calc) ---
  const stress = mf.stressPanel({
    gross_potential_rent: gpr,
    other_income: otherIncome,
    vacancy_rate: d.vacancy_rate,
    insurance: exp.insurance,
    other_operating_expenses: opex - exp.insurance,
    loan_amount: d.price * fin.dscr.ltv,
    annual_rate: fin.dscr.rate,
    amort_years: fin.dscr.amort_years,
    cash_invested: dscrLoan == null ? 0 : d.price * (1 - fin.dscr.ltv) + otherCash,
  });

  // --- Tax layer (mf-calc): depreciation, year 1 both ways, exit ---
  const dep = mf.depreciation({
    purchase_price: d.price,
    land_value: d.land_value || 0,
    cost_seg_pct: d.tax.cost_seg_pct,
    bonus_rate: d.tax.bonus_rate,
  });
  const year1 = mf.taxYear({
    noi: noiValue,
    loan_amount: d.price * fin.dscr.ltv,
    annual_rate: fin.dscr.rate,
    amort_years: fin.dscr.amort_years,
    year: 1,
    depreciation_this_year: dep.first_year_total,
    marginal_rate: d.tax.marginal_rate,
    passive_income_available: d.tax.passive_income_available || 0,
  });
  // Accumulated depreciation over the hold (bonus yr1 + straight-line thereafter).
  const accumDep =
    dep.first_year_total + dep.annual_straight_line * Math.max(0, d.hold_years - 1);
  const exit = mf.exitTax({
    sale_price: dscrLoan.exit_value,
    selling_costs: dscrLoan.exit_value * d.selling_cost_rate,
    purchase_price: d.price,
    accumulated_depreciation: accumDep,
    recapture_rate: d.tax.recapture_rate,
    ltcg_rate: d.tax.ltcg_rate,
  });
  const strEligible = mf.strMaterialParticipationEligible(
    d.str_avg_stay_days ?? 30,
    d.str_material_participation ?? false,
  );

  // --- Prescreen (mf-calc) ---
  const prescreenFlags = mf.prescreen({
    ...d.prescreen,
    str_permit_status: d.prescreen.str_permit_status ?? d.market?.str_permit_status,
  });

  // --- Score (mf-calc). value_spread & writeoff ratio are input-prep ratios. ---
  const primaryValue =
    valuation.results.find((r) => r.primary)?.value ?? valuation.median ?? d.price;
  const valueSpread = (primaryValue - d.price) / d.price; // input prep for scoreDeal
  const equity = dscrLoan == null ? d.price : d.price * (1 - fin.dscr.ltv) + otherCash;
  const writeoffRatio = equity > 0 ? dep.first_year_total / equity : 0; // input prep
  const score = mf.scoreDeal(
    {
      cash_on_cash: dscrLoan.cash_on_cash,
      dscr: dscrLoan.dscr,
      appreciation_rate: d.market?.appreciation_rate ?? d.noi_growth_rate,
      first_year_writeoff_ratio: writeoffRatio,
      value_spread: valueSpread,
    },
    d.buy_box,
  );

  // --- Investor proforma (mf-calc): year-by-year on the DSCR-loan structure ---
  const proforma = mf.buildProforma({
    gross_potential_rent: gpr,
    other_income: otherIncome,
    vacancy_rate: d.vacancy_rate,
    operating_expenses: opex,
    growth_rate: d.noi_growth_rate,
    loan_amount: d.price * fin.dscr.ltv,
    annual_rate: fin.dscr.rate,
    amort_years: fin.dscr.amort_years,
    hold_years: d.hold_years,
    exit_cap_rate: d.exit_cap_rate,
    selling_cost_rate: d.selling_cost_rate,
    cash_invested: d.price * (1 - fin.dscr.ltv) + otherCash,
  });

  // --- Optional STR comparison (mf-calc): same building, same loan --------
  const strInputs = d.str || {};
  const strOut =
    strInputs.adr > 0 && strInputs.occupancy_rate > 0
      ? mf.strComparison({
          units: unitsTotal,
          adr: strInputs.adr,
          occupancy_rate: strInputs.occupancy_rate,
          avg_stay_days: strInputs.avg_stay_days ?? 3,
          cost_per_turn: strInputs.cost_per_turn ?? 120,
          cleaning_fee_per_stay: strInputs.cleaning_fee_per_stay ?? strInputs.cost_per_turn ?? 120,
          str_management_rate: strInputs.management_rate ?? 0.22,
          platform_fee_rate: strInputs.platform_fee_rate ?? 0.03,
          base_operating_expenses: opex - exp.management,
          loan_amount: d.price * fin.dscr.ltv,
          annual_rate: fin.dscr.rate,
          amort_years: fin.dscr.amort_years,
          cash_invested: d.price * (1 - fin.dscr.ltv) + otherCash,
          ltr_noi: noiValue,
          ltr_cfbt: dscrLoan.cfbt,
        })
      : null;

  return {
    calc_version: mf.CALC_VERSION,
    basis,
    derived: {
      units_total: unitsTotal,
      sqft_total: sqftTotal,
      gpr_market: gprMarket,
      gpr_actual: gprActual,
      loss_to_lease: mf.lossToLease(units),
      egi,
      opex_total: opex,
      expenses: exp,
      noi: noiValue,
      noi_market: noiMarket,
      noi_actual: noiActual,
      cap_rate_on_price: capOnPrice,
    },
    valuation,
    financing: {
      all_cash: allCash,
      dscr: dscrLoan,
      agency: agencyLoan,
      seller_forward: sellerForward,
      seller_offers: sellerOffers,
    },
    solvers: { min_down: minDown, max_offer: maxOffer },
    stress,
    proforma,
    tax: { depreciation: dep, year1, exit, accumulated_depreciation: accumDep, str_eligible: strEligible },
    prescreen: prescreenFlags,
    str_comparison: strOut,
    score,
    primary_value: primaryValue,
    value_spread: valueSpread,
  };
}
