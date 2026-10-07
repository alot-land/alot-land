/**
 * Valuation — compute every applicable method and render side-by-side with a
 * spread indicator. When methods diverge > 15%, the report must explain why
 * (typically loss-to-lease: mismanaged/value-add vs overpriced).
 */
import { firstPeriodDebtService, type DebtTerms } from './debt.js';

export type ValuationMethod =
  | 'sales-comps-per-unit'
  | 'sales-comps-per-sqft'
  | 'sales-comps-per-bed'
  | 'grm'
  | 'direct-cap'
  | 'dscr-constrained'
  | 'replacement-cost';

export interface ValuationResult {
  method: ValuationMethod;
  value: number;
  /** Primary method for this asset class? (2–4u → comps; 5+ → direct cap). */
  primary: boolean;
  note?: string;
}

export interface SalesCompsInput {
  /** Median/avg sold $ per unit from comps. */
  price_per_unit?: number;
  /** Median/avg sold $ per sqft from comps. */
  price_per_sqft?: number;
  /** Median sold $ per bed from comps (v1.1.0: the honestly computable axis
   * when unit counts are unavailable, e.g. the Redfin lane). */
  price_per_bed?: number;
  units: number;
  total_sqft: number;
  /** Subject building-total beds — required for the per-bed method. */
  beds_total?: number;
}

export interface GrmInput {
  /** Market GRM from comparable sales (price / annual gross rent). */
  market_grm: number;
  annual_gross_rent: number;
}

export interface DirectCapInput {
  noi: number;
  market_cap_rate: number; // decimal
}

export interface DscrConstrainedInput extends Omit<DebtTerms,'loan_amount'> {
  noi: number;
  min_dscr: number; // e.g. 1.20
  annual_rate: number;
  amort_years: number;
  ltv: number; // decimal
  hold_months?: number;
}

export interface ReplacementCostInput {
  /** Construction cost per unit (or per sqft — supply one). */
  cost_per_unit?: number;
  cost_per_sqft?: number;
  units: number;
  total_sqft: number;
  land_value: number;
}

export function salesCompsPerUnit(inp: SalesCompsInput): number | null {
  if (inp.price_per_unit == null) return null;
  return inp.price_per_unit * inp.units;
}

export function salesCompsPerSqft(inp: SalesCompsInput): number | null {
  if (inp.price_per_sqft == null) return null;
  return inp.price_per_sqft * inp.total_sqft;
}

export function salesCompsPerBedValue(inp: SalesCompsInput): number | null {
  if (inp.price_per_bed == null || !inp.beds_total) return null;
  return inp.price_per_bed * inp.beds_total;
}

export function grmValue(inp: GrmInput): number {
  return inp.market_grm * inp.annual_gross_rent;
}

export function directCapValue(inp: DirectCapInput): number {
  if (inp.market_cap_rate <= 0) return 0;
  return inp.noi / inp.market_cap_rate;
}

/**
 * Max supportable price constrained by DSCR: find the loan whose debt service
 * keeps DSCR at exactly the floor, then gross up by LTV to a purchase price.
 *
 *   max annual debt service = NOI / minDSCR
 *   annual payment per $1 of loan = annualDebtService(1, rate, term)
 *   max loan = maxDebtService / paymentPerDollar
 *   max price = maxLoan / LTV
 */
export function dscrConstrainedValue(inp: DscrConstrainedInput): number {
  if (inp.min_dscr <= 0 || inp.ltv <= 0) return 0;
  const maxDebtService = inp.noi / inp.min_dscr;
  const perDollar = firstPeriodDebtService({...inp,loan_amount:1},inp.hold_months);
  if (perDollar <= 0) return 0;
  const maxLoan = maxDebtService / perDollar;
  return Math.max(0,maxLoan / inp.ltv);
}

export function replacementCostValue(inp: ReplacementCostInput): number {
  let structures = 0;
  if (inp.cost_per_unit != null) structures = inp.cost_per_unit * inp.units;
  else if (inp.cost_per_sqft != null) structures = inp.cost_per_sqft * inp.total_sqft;
  return structures + inp.land_value;
}

export interface ValuationPanelInput {
  units: number;
  salesComps?: SalesCompsInput;
  grm?: GrmInput;
  directCap?: DirectCapInput;
  dscrConstrained?: DscrConstrainedInput;
  replacementCost?: ReplacementCostInput;
}

export interface ValuationPanel {
  results: ValuationResult[];
  min: number;
  max: number;
  median: number;
  /** (max - min) / median. */
  spread: number;
  /** True when spread exceeds 15% — report must explain the divergence. */
  diverges: boolean;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Build the full valuation panel. `primary` flags: for 2–4 units, sales comps
 * are primary; for 5+ units, direct cap is primary. Replacement cost is always
 * a ceiling sanity check (never marked primary).
 */
export function valuationPanel(inp: ValuationPanelInput): ValuationPanel {
  const results: ValuationResult[] = [];
  const smallAsset = inp.units <= 4;

  if (inp.salesComps) {
    const perUnit = salesCompsPerUnit(inp.salesComps);
    if (perUnit != null)
      results.push({ method: 'sales-comps-per-unit', value: perUnit, primary: smallAsset });
    const perSqft = salesCompsPerSqft(inp.salesComps);
    if (perSqft != null)
      results.push({ method: 'sales-comps-per-sqft', value: perSqft, primary: false });
    const perBed = salesCompsPerBedValue(inp.salesComps);
    if (perBed != null)
      results.push({
        method: 'sales-comps-per-bed',
        value: perBed,
        primary: false,
        note: 'from sold comps (no unit counts in source)',
      });
  }
  if (inp.grm) {
    results.push({
      method: 'grm',
      value: grmValue(inp.grm),
      primary: false,
      note: 'quick screen only',
    });
  }
  if (inp.directCap) {
    results.push({ method: 'direct-cap', value: directCapValue(inp.directCap), primary: !smallAsset });
  }
  if (inp.dscrConstrained) {
    results.push({
      method: 'dscr-constrained',
      value: dscrConstrainedValue(inp.dscrConstrained),
      primary: false,
      note: 'max price at DSCR floor',
    });
  }
  if (inp.replacementCost) {
    results.push({
      method: 'replacement-cost',
      value: replacementCostValue(inp.replacementCost),
      primary: false,
      note: 'ceiling sanity check',
    });
  }

  const values = results.map((r) => r.value).filter((v) => v > 0);
  const mn = values.length ? Math.min(...values) : 0;
  const mx = values.length ? Math.max(...values) : 0;
  const md = median(values);
  const spread = md > 0 ? (mx - mn) / md : 0;

  return { results, min: mn, max: mx, median: md, spread, diverges: spread > 0.15 };
}
