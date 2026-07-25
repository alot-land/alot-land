/**
 * STR (short-term rental) comparison — added in calc v1.9.0 (new module +
 * tests per the frozen-module protocol).
 *
 * Answers "what would this SAME building earn as a short-term rental?"
 * against the LTR underwrite: ADR × occupancy income, the STR expense
 * stack (turn cleaning, platform fees, STR-grade management) on top of the
 * carried-over operating costs, same loan.
 */
import { annualDebtService } from './finance.js';
import { emptyExpenses, type ExpenseInputs } from './types.js';

export interface StrDefaultsSuggestion {
  adr: number;
  occupancy_rate: number;
  estimated: true;
}

/**
 * A STARTING ADR from the LTR rent we already have, so the STR panel can
 * auto-populate. Heuristic: a short-term night typically grosses ~2.5× the
 * long-term nightly equivalent (monthly rent ÷ 30), i.e. ADR ≈ rent ÷ 12,
 * paired with a conservative 60% occupancy. It's a glance-level estimate,
 * clearly flagged — real ADR comes from AirDNA/comps once a deal interests
 * you. Returns null without a usable rent rather than inventing a number.
 */
export function suggestStrDefaults(monthlyRentPerUnit: number | null | undefined): StrDefaultsSuggestion | null {
  if (monthlyRentPerUnit == null || !(monthlyRentPerUnit > 0)) return null;
  return {
    adr: Math.round(monthlyRentPerUnit / 12),
    occupancy_rate: 0.6,
    estimated: true,
  };
}

export interface StrComparisonInputs {
  units: number;
  /** Average daily rate per unit. */
  adr: number;
  /** Occupied share of nights, 0–1. */
  occupancy_rate: number;
  avg_stay_days: number;
  /** Cleaning/turnover cost per stay (what the cleaner charges you). */
  cost_per_turn: number;
  /** Cleaning fee charged to the GUEST per stay. Cleaning is normally a
   * pass-through, so this defaults to cost_per_turn (net owner cost 0);
   * lower it if you absorb part of the turnover. */
  cleaning_fee_per_stay?: number;
  /** STR management, share of revenue (typically 0.20–0.25). */
  str_management_rate: number;
  /** Platform/host fees, share of revenue. */
  platform_fee_rate: number;
  /** LTR operating expenses EXCLUDING management — taxes, insurance,
   * repairs, utilities, reserves carry over. */
  base_operating_expenses: number;
  loan_amount: number;
  annual_rate: number;
  amort_years: number;
  cash_invested: number;
  ltr_noi: number;
  ltr_cfbt: number;
}

export interface StrComparisonResult {
  occupied_nights: number;
  turns: number;
  gross_revenue: number;
  expenses: ExpenseInputs;
  opex_total: number;
  noi: number;
  dscr: number;
  cfbt: number;
  cash_on_cash: number;
  noi_delta: number;
  cfbt_delta: number;
  /** Avg stay ≤ 7 nights → the STR material-participation tax lane may
   * apply (see strMaterialParticipationEligible for the full test). */
  material_participation_hint: boolean;
}

export function strComparison(inp: StrComparisonInputs): StrComparisonResult | null {
  if (!(inp.units > 0) || !(inp.adr > 0)) return null;
  if (!(inp.occupancy_rate > 0) || inp.occupancy_rate > 1) return null;
  if (!(inp.avg_stay_days > 0)) return null;

  const occupiedNights = inp.units * 365 * inp.occupancy_rate;
  const gross = occupiedNights * inp.adr;
  const turns = occupiedNights / inp.avg_stay_days;

  // Cleaning is a guest pass-through: the guest's cleaning fee offsets what
  // the cleaner charges. Only the UNRECOVERED portion is an owner expense.
  const cleaningFee = inp.cleaning_fee_per_stay ?? inp.cost_per_turn;
  const netCleaningPerTurn = Math.max(0, inp.cost_per_turn - cleaningFee);

  const expenses: ExpenseInputs = {
    ...emptyExpenses(),
    management: inp.str_management_rate * gross,
    str_cleaning: turns * netCleaningPerTurn,
    str_platform_fees: inp.platform_fee_rate * gross,
    other: inp.base_operating_expenses,
  };
  const opex =
    expenses.management + expenses.str_cleaning + expenses.str_platform_fees + expenses.other;

  const noi = gross - opex;
  const debt = annualDebtService(inp.loan_amount, inp.annual_rate, inp.amort_years);
  const cfbt = noi - debt;
  return {
    occupied_nights: occupiedNights,
    turns,
    gross_revenue: gross,
    expenses,
    opex_total: opex,
    noi,
    dscr: debt > 0 ? noi / debt : Infinity,
    cfbt,
    cash_on_cash: inp.cash_invested > 0 ? cfbt / inp.cash_invested : 0,
    noi_delta: noi - inp.ltr_noi,
    cfbt_delta: cfbt - inp.ltr_cfbt,
    material_participation_hint: inp.avg_stay_days <= 7,
  };
}
