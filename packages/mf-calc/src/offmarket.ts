/**
 * Off-market parcel screening — added in calc v1.4.0 (new module + tests per
 * the frozen-module protocol).
 *
 * Off-market parcels carry no asking price and no actual rents, so the
 * screen is estimate-driven and says so: income from a zip rent band,
 * expenses from standard underwriting rates, value anchored on the county
 * appraisal. Missing inputs yield verdict 'insufficient' — never a
 * fabricated number.
 */
import { annualDebtService, noi as noiOf, effectiveGrossIncome, capRate, dscr as dscrOf } from './finance.js';
import { reassessedPropertyTax } from './property.js';
import { emptyExpenses, totalOperatingExpenses, type ExpenseInputs } from './types.js';

export interface ExpenseEstimateRates {
  /** $/unit/yr hazard insurance allowance. */
  insurance_per_unit: number;
  /** Repairs & maintenance as a share of gross potential rent. */
  repairs_rate: number;
  /** Property management as a share of effective gross income. */
  management_rate: number;
  /** $/unit/yr owner-paid utility allowance (common areas, w/s/g share). */
  utilities_per_unit: number;
  /** $/unit/yr replacement reserve. */
  capex_per_unit: number;
}

export const DEFAULT_EXPENSE_RATES: ExpenseEstimateRates = {
  insurance_per_unit: 500,
  repairs_rate: 0.08,
  management_rate: 0.08,
  utilities_per_unit: 300,
  capex_per_unit: 300,
};

export interface EstimateExpensesInputs {
  units: number;
  gross_potential_rent: number;
  vacancy_rate: number;
  rates?: Partial<ExpenseEstimateRates>;
}

/** Standard-rate expense estimate. property_tax stays 0 — the caller must
 * set it via {@link reassessedPropertyTax} at the price being tested. */
export function estimateOperatingExpenses(inp: EstimateExpensesInputs): ExpenseInputs {
  const r = { ...DEFAULT_EXPENSE_RATES, ...(inp.rates || {}) };
  const egi = effectiveGrossIncome({
    gross_potential_rent: inp.gross_potential_rent,
    other_income: 0,
    vacancy_rate: inp.vacancy_rate,
    operating_expenses: 0,
  });
  return {
    ...emptyExpenses(),
    insurance: inp.units * r.insurance_per_unit,
    management: r.management_rate * egi,
    repairs_maintenance: r.repairs_rate * inp.gross_potential_rent,
    utilities: inp.units * r.utilities_per_unit,
    capex_reserve: inp.units * r.capex_per_unit,
  };
}

export interface ScreenParcelInputs {
  units: number | null | undefined;
  /** Estimated market rent per unit per month (e.g. ZORI zip band). */
  market_rent_monthly: number | null | undefined;
  /** Value anchor — county appraised/market value. */
  price_anchor: number | null | undefined;
  vacancy_rate?: number;
  property_tax_rate?: number;
  assessment_ratio?: number;
  ltv?: number;
  annual_rate?: number;
  amort_years?: number;
  min_dscr?: number;
  target_cap?: number;
  expense_rates?: Partial<ExpenseEstimateRates>;
}

export type ScreenVerdict = 'pursue' | 'consider' | 'pass' | 'insufficient';

export interface ScreenParcelResult {
  ok: boolean;
  missing: string[];
  gpr: number | null;
  egi: number | null;
  expenses: ExpenseInputs;
  opex: number | null;
  noi: number | null;
  cap_rate: number | null;
  annual_debt_service: number | null;
  dscr: number | null;
  cash_flow: number | null;
  verdict: ScreenVerdict;
}

const EMPTY: Omit<ScreenParcelResult, 'ok' | 'missing' | 'verdict'> = {
  gpr: null,
  egi: null,
  expenses: emptyExpenses(),
  opex: null,
  noi: null,
  cap_rate: null,
  annual_debt_service: null,
  dscr: null,
  cash_flow: null,
};

/**
 * Fast estimate-based screen of one off-market parcel at the anchor price.
 * pursue   — clears the DSCR bar AND the cap-rate bar at the anchor
 * consider — within 90% of the DSCR bar and 85% of the cap bar
 * pass     — below that
 */
export function screenParcel(inp: ScreenParcelInputs): ScreenParcelResult {
  const missing: string[] = [];
  if (!(inp.units != null && inp.units > 0)) missing.push('units');
  if (!(inp.market_rent_monthly != null && inp.market_rent_monthly > 0)) missing.push('market_rent_monthly');
  if (!(inp.price_anchor != null && inp.price_anchor > 0)) missing.push('price_anchor');
  if (missing.length) return { ...EMPTY, ok: false, missing, verdict: 'insufficient' };

  const units = inp.units as number;
  const rent = inp.market_rent_monthly as number;
  const anchor = inp.price_anchor as number;
  const vacancy = inp.vacancy_rate ?? 0.05;
  const taxRate = inp.property_tax_rate ?? 0.01;
  const assessRatio = inp.assessment_ratio ?? 1;
  const ltv = inp.ltv ?? 0.75;
  const rate = inp.annual_rate ?? 0.075;
  const amort = inp.amort_years ?? 30;
  const minDscr = inp.min_dscr ?? 1.25;
  const targetCap = inp.target_cap ?? 0.07;

  const gpr = units * rent * 12;
  const expenses = estimateOperatingExpenses({
    units,
    gross_potential_rent: gpr,
    vacancy_rate: vacancy,
    rates: inp.expense_rates,
  });
  expenses.property_tax = reassessedPropertyTax(anchor, taxRate, assessRatio);
  const opex = totalOperatingExpenses(expenses);

  const noiArgs = {
    gross_potential_rent: gpr,
    other_income: 0,
    vacancy_rate: vacancy,
    operating_expenses: opex,
  };
  const egi = effectiveGrossIncome(noiArgs);
  const noiValue = noiOf(noiArgs);
  const cap = capRate(noiValue, anchor);
  const debt = annualDebtService(anchor * ltv, rate, amort);
  const dscrValue = dscrOf(noiValue, debt);
  const cashFlow = noiValue - debt;

  let verdict: ScreenVerdict = 'pass';
  if (dscrValue >= minDscr && cap >= targetCap) verdict = 'pursue';
  else if (dscrValue >= minDscr * 0.9 && cap >= targetCap * 0.85) verdict = 'consider';

  return {
    ok: true,
    missing: [],
    gpr,
    egi,
    expenses,
    opex,
    noi: noiValue,
    cap_rate: cap,
    annual_debt_service: debt,
    dscr: dscrValue,
    cash_flow: cashFlow,
    verdict,
  };
}
