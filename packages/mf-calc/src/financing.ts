/**
 * Financing comparator + solvers.
 *
 * Forward: terms → CoC, DSCR, CFBT, IRR, equity multiple, break-even occupancy.
 * Inverse A: minimum down payment where DSCR ≥ floor AND CoC ≥ target.
 * Inverse B: max allowable offer given target returns (offer solved backward).
 * Seller-finance: 3-option offer letter.
 */
import {
  annualDebtService,
  cashFlowBeforeTax,
  cashOnCash,
  dscr,
  breakEvenOccupancy,
  remainingBalance,
  timedIrr,
  type IrrResult,
} from './finance.js';
import { buildProforma, type Proforma } from './proforma.js';
import { firstPeriodDebtService, type DebtTerms, type Refinance } from './debt.js';

export interface ForwardInput extends DebtTerms {
  price: number;
  noi: number;
  /** Gross potential income (GPR + other income) for break-even occupancy. */
  gross_potential_income: number;
  gross_potential_rent?: number;
  other_income?: number;
  concessions?: number;
  bad_debt?: number;
  vacancy_rate?: number;
  operating_expenses: number;
  /** Loan amount. For all-cash pass 0. */
  loan_amount: number;
  annual_rate: number;
  amort_years: number;
  interest_only?: boolean;
  /** Cash the buyer brings beyond the loan: down + closing + rehab + furnishing. */
  cash_invested: number;
  // --- exit / hold, for IRR + equity multiple ---
  hold_years: number;
  exit_cap_rate: number;
  /** Annual NOI growth (decimal) applied to derive exit-year NOI. */
  noi_growth_rate?: number;
  /** Selling costs at exit as a fraction of sale price (e.g. 0.06). */
  selling_cost_rate?: number;
  refinance?: Refinance;
  initial_reserves?: number;
}

export interface ForwardResult {
  cash_invested: number;
  annual_debt_service: number;
  cfbt: number;
  dscr: number | null;
  cash_on_cash: number | null;
  break_even_occupancy: number | null;
  irr: number | null;
  irr_status: IrrResult['status'];
  debt_yield: number | null;
  equity_multiple: number | null;
  exit_value: number;
  loan_balance_at_exit: number;
  net_sale_proceeds: number;
  proforma: Proforma;
}

/** Exit-year NOI grown from year-1 NOI. */
export function exitNoi(noi: number, growth: number, holdYears: number): number {
  return noi * Math.pow(1 + growth, holdYears);
}

export function forward(inp: ForwardInput): ForwardResult {
  const growth = inp.noi_growth_rate ?? 0;
  const sellCostRate = inp.selling_cost_rate ?? 0.06;
  const other=inp.other_income ?? 0;
  const gpr=inp.gross_potential_rent ?? inp.gross_potential_income-other;
  const losses=(inp.concessions ?? 0)+(inp.bad_debt ?? 0);
  const vacancy=inp.vacancy_rate ?? (gpr>0 ? (gpr+other-losses-inp.operating_expenses-inp.noi)/gpr : 0);
  const projection=buildProforma({ ...inp,gross_potential_rent:gpr,other_income:other,vacancy_rate:vacancy,
    growth_rate:growth,selling_cost_rate:sellCostRate });
  // Annualize a partial first period so annual NOI/coverage/CoC use like units.
  const ads = projection.years[0]!.debt_service*12/projection.years[0]!.months;
  const cfbt = cashFlowBeforeTax(inp.noi, ads);
  const dscrVal = dscr(inp.noi, ads);
  const coc = cashOnCash(cfbt, inp.cash_invested);
  const beo = breakEvenOccupancy(inp.operating_expenses, ads,
    inp.gross_potential_rent ?? inp.gross_potential_income-other,other,(inp.concessions ?? 0)+(inp.bad_debt ?? 0));

  // Exit
  const exitValue=projection.exit.exit_value;
  const loanBal=projection.exit.loan_payoff;
  const netSale=projection.exit.net_sale_proceeds;

  // Actual monthly equity ledger includes sale/refinance/payoff once.
  const irrResult=timedIrr(projection.equity_cash_flows);
  const em = projection.exit.equity_multiple;

  return {
    cash_invested:inp.cash_invested,
    annual_debt_service: ads,
    cfbt,
    dscr: Number.isFinite(dscrVal) ? dscrVal : null,
    cash_on_cash: inp.cash_invested>1e-8 && Number.isFinite(coc) ? coc : null,
    break_even_occupancy: Number.isFinite(beo) ? beo : null,
    irr: irrResult.value,
    irr_status: irrResult.status,
    debt_yield: inp.loan_amount>0 ? inp.noi/inp.loan_amount : null,
    equity_multiple: em,
    exit_value: exitValue,
    loan_balance_at_exit: loanBal,
    net_sale_proceeds: netSale,
    proforma: projection,
  };
}

// ---------------------------------------------------------------------------
// Inverse A — minimum down payment where DSCR ≥ floor AND CoC ≥ target.
// DSCR is monotonic in down payment; CoC is not, so we scan a fine grid and
// return the smallest down that satisfies both. Returns null if unreachable.
// ---------------------------------------------------------------------------
export interface InverseAInput extends Omit<DebtTerms,'loan_amount'> {
  price: number;
  noi: number;
  annual_rate: number;
  amort_years: number;
  /** Fixed cash costs on top of down payment (closing + rehab + furnishing). */
  other_cash: number;
  min_dscr: number;
  target_coc: number;
  interest_only?: boolean;
  /** Grid resolution as a down-fraction step. Default 0.005 (0.5%). */
  step?: number;
  hold_months?: number;
  financing_fees?: number;
  lender_costs?: number;
}

export interface InverseAResult {
  down_fraction: number;
  down_payment: number;
  loan_amount: number;
  dscr: number;
  cash_on_cash: number;
  cash_invested: number;
}

export function minDownForTargets(inp: InverseAInput): InverseAResult | null {
  const step = inp.step ?? 0.005;
  if(!Number.isFinite(step)||step<=0||step>1) throw new RangeError('Invalid solver grid step');
  for (let i=0; i<=Math.ceil(1/step); i++) {
    const d=Math.min(1,i*step);
    const down = inp.price * d;
    const loan = inp.price - down;
    const ads = firstPeriodDebtService({...inp,loan_amount:loan},inp.hold_months);
    const cfbt = inp.noi - ads;
    const dscrVal = dscr(inp.noi, ads);
    const cash = down + inp.other_cash + (loan>0 ? (inp.financing_fees ?? 0)+(inp.lender_costs ?? 0) : 0);
    const coc = cashOnCash(cfbt, cash);
    if (cash>1e-8 && Number.isFinite(coc) && dscrVal >= inp.min_dscr && coc >= inp.target_coc) {
      return {
        down_fraction: d,
        down_payment: down,
        loan_amount: loan,
        dscr: dscrVal,
        cash_on_cash: coc,
        cash_invested: cash,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inverse B — max allowable offer given target returns.
// Returns improve monotonically as price falls (lower price → less tax, less
// loan, better CoC/DSCR/IRR), so binary-search the highest price that still
// clears every target. `noiAtPrice` lets callers inject price-dependent NOI
// (re-assessed taxes fall with price).
// ---------------------------------------------------------------------------
export interface InverseBInput extends Omit<DebtTerms,'loan_amount'> {
  /** NOI as a function of purchase price (captures re-assessed property tax). */
  noiAtPrice: (price: number) => number;
  gross_potential_income: number;
  ltv: number;
  annual_rate: number;
  amort_years: number;
  /** Non-down cash as a fraction of price (closing) plus a flat amount (rehab). */
  closing_rate: number;
  flat_cash: number;
  min_dscr: number;
  target_coc: number;
  interest_only?: boolean;
  /** Search bounds. */
  price_low?: number;
  price_high: number;
  hold_months?: number;
}

export interface InverseBResult {
  max_offer: number;
  dscr: number;
  cash_on_cash: number;
  cash_invested: number;
}

function meetsTargets(price: number, inp: InverseBInput): { ok: boolean; dscr: number; coc: number; cash: number } {
  const noi = inp.noiAtPrice(price);
  const loan = price * inp.ltv;
  const down = price - loan;
  const ads = firstPeriodDebtService({...inp,loan_amount:loan},inp.hold_months);
  const cfbt = noi - ads;
  const dscrVal = dscr(noi, ads);
  const cash = down + price * inp.closing_rate + inp.flat_cash;
  const coc = cashOnCash(cfbt, cash);
  return { ok: cash>1e-8 && Number.isFinite(coc) && dscrVal >= inp.min_dscr && coc >= inp.target_coc, dscr: dscrVal, coc, cash };
}

export function maxOfferForTargets(inp: InverseBInput): InverseBResult | null {
  let lo = inp.price_low ?? 1;
  let hi = inp.price_high;
  if(![lo,hi,inp.ltv].every(Number.isFinite)||lo<0||hi<lo||inp.ltv<0||inp.ltv>1) throw new RangeError('Invalid offer bounds/LTV');
  // If even the lowest price fails, unreachable.
  if (!meetsTargets(lo, inp).ok) return null;
  // If the highest price already passes, that's the max in range.
  if (meetsTargets(hi, inp).ok) {
    const r = meetsTargets(hi, inp);
    return { max_offer: hi, dscr: r.dscr, cash_on_cash: r.coc, cash_invested: r.cash };
  }
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (meetsTargets(mid, inp).ok) lo = mid;
    else hi = mid;
    if (hi - lo < 1) break;
  }
  const r = meetsTargets(lo, inp);
  return { max_offer: lo, dscr: r.dscr, cash_on_cash: r.coc, cash_invested: r.cash };
}

// ---------------------------------------------------------------------------
// Seller-finance 3-option offer letter.
// ---------------------------------------------------------------------------
export interface SellerFinanceInput {
  list_price: number;
  /** Seller-carry rate for the "full price / low rate" option. */
  low_rate: number;
  /** Rate for the mid option. */
  mid_rate: number;
  /** Discount fraction off list for the cash-discount option (e.g. 0.12). */
  cash_discount: number;
  down_fraction: number;
  amort_years: number;
  balloon_years: number;
}

export interface SellerFinanceOption {
  label: string;
  price: number;
  down_payment: number;
  loan_amount: number;
  rate: number;
  monthly_payment: number;
  balloon_years: number;
}

export function sellerFinanceOffers(inp: SellerFinanceInput): SellerFinanceOption[] {
  const mk = (label: string, price: number, rate: number): SellerFinanceOption => {
    const down = price * inp.down_fraction;
    const loan = price - down;
    const ads = annualDebtService(loan, rate, inp.amort_years);
    return {
      label,
      price,
      down_payment: down,
      loan_amount: loan,
      rate,
      monthly_payment: ads / 12,
      balloon_years: inp.balloon_years,
    };
  };
  return [
    mk('Full price / low rate', inp.list_price, inp.low_rate),
    mk('Mid', inp.list_price, inp.mid_rate),
    mk('Cash discount', inp.list_price * (1 - inp.cash_discount), inp.mid_rate),
  ];
}
