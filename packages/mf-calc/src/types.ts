/**
 * MFDA calc engine — shared types.
 *
 * ENGINEERING RULE #1: LLMs never do arithmetic. Every financial calculation
 * lives in this package as a pure function. LLMs may only populate inputs and
 * write narrative text.
 *
 * ENGINEERING RULE #3: Every model input carries provenance. See {@link Provenanced}.
 */

/** Bump this whenever a formula changes. Scenario snapshots record the version
 * they were computed under so historical results stay reproducible. */
export const CALC_VERSION = '1.6.0';

export type Confidence = 'high' | 'med' | 'low';

/**
 * Rule #3: no naked numbers. Every assumption fed into the engine is wrapped
 * with where it came from, when it was retrieved, how confident we are, and
 * whether a human overrode it. Reports render the provenance table from these.
 */
export interface Provenanced<T> {
  value: T;
  source: string;
  retrieved_at: string; // ISO-8601
  confidence: Confidence;
  is_override: boolean;
}

/** Convenience constructor for a provenanced value. */
export function pv<T>(
  value: T,
  source: string,
  opts: { retrieved_at?: string; confidence?: Confidence; is_override?: boolean } = {},
): Provenanced<T> {
  return {
    value,
    source,
    retrieved_at: opts.retrieved_at ?? '1970-01-01T00:00:00.000Z',
    confidence: opts.confidence ?? 'med',
    is_override: opts.is_override ?? false,
  };
}

export type RentalMode = 'LTR' | 'MTR' | 'STR';

/** One line of the unit mix. Rents are MONTHLY per unit of this type. */
export interface UnitType {
  /** Human label, e.g. "2BR/1BA". */
  type: string;
  count: number;
  sqft: number;
  /** In-place rent the seller currently collects (monthly, per unit). */
  actual_rent: number;
  /** Market rent this unit type should command (monthly, per unit). */
  market_rent: number;
}

/**
 * Operating expenses, annual dollars. NOTE on convention: we treat the capex
 * replacement reserve as an above-the-line operating expense (it reduces NOI).
 * This is the conservative choice and keeps DSCR honest. All fields are annual $.
 */
export interface ExpenseInputs {
  /** RE property tax. MUST be re-assessed at purchase price per county rules —
   * never the seller's in-place assessed value. See {@link reassessedPropertyTax}. */
  property_tax: number;
  insurance: number;
  /** Property management. LTR 8–10% of EGI, STR 20–25%. Pass the dollar figure. */
  management: number;
  utilities: number;
  /** Repairs & maintenance. */
  repairs_maintenance: number;
  /** Replacement reserve (capex), per-unit-per-year rolled up to annual total. */
  capex_reserve: number;
  /** On-site payroll — typically only modeled at >= 20 units. */
  payroll: number;
  /** Any other recurring operating expense not captured above. */
  other: number;
  // --- STR-only additions (0 for LTR/MTR) ---
  /** Cleaning turn costs (annual). */
  str_cleaning: number;
  /** Platform / booking fees (annual). */
  str_platform_fees: number;
  /** Occupancy / lodging tax (annual). */
  str_occupancy_tax: number;
}

export function emptyExpenses(): ExpenseInputs {
  return {
    property_tax: 0,
    insurance: 0,
    management: 0,
    utilities: 0,
    repairs_maintenance: 0,
    capex_reserve: 0,
    payroll: 0,
    other: 0,
    str_cleaning: 0,
    str_platform_fees: 0,
    str_occupancy_tax: 0,
  };
}

export function totalOperatingExpenses(e: ExpenseInputs): number {
  return (
    e.property_tax +
    e.insurance +
    e.management +
    e.utilities +
    e.repairs_maintenance +
    e.capex_reserve +
    e.payroll +
    e.other +
    e.str_cleaning +
    e.str_platform_fees +
    e.str_occupancy_tax
  );
}

/** Loan terms. rate is an annual decimal (0.07 = 7%). */
export interface LoanTerms {
  /** Loan-to-value as a decimal (0.75 = 75%). */
  ltv: number;
  annual_rate: number;
  amort_years: number;
  /** Interest-only? If true, payment = interest only, no amortization. */
  interest_only?: boolean;
  /** Balloon term in years (for seller finance / bridge). Not used by amort math
   * directly but retained for reporting. */
  balloon_years?: number;
}

export type FinancingType = 'all-cash' | 'dscr' | 'agency' | 'seller-finance';
