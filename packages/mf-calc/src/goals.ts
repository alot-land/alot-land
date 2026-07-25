/**
 * Goal planner — added in calc v1.5.0 (new module + tests per the frozen-
 * module protocol).
 *
 * Month-by-month simulation of the path to a target monthly cash flow.
 * Capital accumulates from savings plus the cash flow of deals already
 * bought (the snowball); a deal is purchased whenever the war chest covers
 * one; optional refi events return a fraction of each deal's invested cash
 * `refi_months` after its purchase (BRRRR-style recycling).
 */
import { annualDebtService } from './finance.js';

export interface SimulateGoalInputs {
  target_monthly_cashflow: number;
  capital_available: number;
  monthly_savings: number;
  per_deal_cash: number;
  per_deal_monthly_cashflow: number;
  /** Fraction of per_deal_cash returned at refi (0 = no refi; may exceed 1
   * when buying far enough under value). */
  refi_cash_back_fraction?: number;
  /** Months after purchase when the refi cash arrives. */
  refi_months?: number;
  /** Monthly cash-flow change applied at each deal's refi (negative: the
   * larger loan's added debt service). */
  refi_monthly_cashflow_delta?: number;
  max_months?: number;
}

export interface GoalPurchase {
  month: number;
  deal_number: number;
}

export interface SimulateGoalResult {
  reached: boolean;
  months_to_goal: number | null;
  deals_needed: number;
  purchases: GoalPurchase[];
  final_monthly_cashflow: number;
  total_cash_invested: number;
  /** Total refi proceeds received before (or at) the goal month. */
  refi_cash_returned: number;
}

export function simulateGoal(inp: SimulateGoalInputs): SimulateGoalResult {
  const maxMonths = inp.max_months ?? 600;
  const refiFrac = inp.refi_cash_back_fraction ?? 0;
  const refiMonths = inp.refi_months ?? 0;

  const refiDelta = inp.refi_monthly_cashflow_delta ?? 0;
  let capital = inp.capital_available;
  let cashflow = 0;
  let invested = 0;
  let refiReturned = 0;
  const purchases: GoalPurchase[] = [];
  const refiQueue: { month: number; amount: number }[] = [];

  const done = (reached: boolean, month: number | null): SimulateGoalResult => ({
    reached,
    months_to_goal: month,
    deals_needed: purchases.length,
    purchases,
    final_monthly_cashflow: cashflow,
    total_cash_invested: invested,
    refi_cash_returned: refiReturned,
  });

  if (inp.target_monthly_cashflow <= 0) return done(true, 0);
  if (!(inp.per_deal_cash > 0) || !(inp.per_deal_monthly_cashflow > 0)) return done(false, null);

  for (let m = 0; m <= maxMonths; m++) {
    if (m > 0) capital += inp.monthly_savings + cashflow;
    for (const r of refiQueue) {
      if (r.month === m) {
        capital += r.amount;
        refiReturned += r.amount;
        cashflow += refiDelta;
      }
    }
    while (capital >= inp.per_deal_cash) {
      capital -= inp.per_deal_cash;
      invested += inp.per_deal_cash;
      cashflow += inp.per_deal_monthly_cashflow;
      purchases.push({ month: m, deal_number: purchases.length + 1 });
      if (refiFrac > 0) refiQueue.push({ month: m + refiMonths, amount: refiFrac * inp.per_deal_cash });
      if (cashflow >= inp.target_monthly_cashflow) return done(true, m);
    }
  }
  return done(false, null);
}

// ---------------------------------------------------------------------------
// Equity math (v1.7.0): buy under value, cash-out refi, recycle the equity.
// ---------------------------------------------------------------------------

export interface EquitySpreadResult {
  dollars: number;
  pct: number;
}

/** Value minus price — the equity walked into at purchase. */
export function equitySpread(inp: {
  price: number | null | undefined;
  value: number | null | undefined;
}): EquitySpreadResult | null {
  if (inp.price == null || inp.value == null || !(inp.value > 0) || !(inp.price > 0)) return null;
  const dollars = inp.value - inp.price;
  return { dollars, pct: dollars / inp.value };
}

export interface EquityCaptureInputs {
  purchase_price: number;
  market_value: number;
  down_payment_rate: number;
  closing_cost_rate: number;
  rehab?: number;
  refi_ltv: number;
  refi_rate: number;
  refi_amort_years?: number;
}

export interface EquityCaptureResult {
  cash_in: number;
  purchase_loan: number;
  refi_loan: number;
  /** Cash returned after the refi pays off the purchase loan (≥ 0). */
  cash_out: number;
  net_cash_left_in: number;
  equity_after_refi: number;
  /** Debt service on the ADDED principal — the honest cash-flow cost. */
  added_monthly_debt_service: number;
}

export function equityCapture(inp: EquityCaptureInputs): EquityCaptureResult {
  const rehab = inp.rehab ?? 0;
  const amort = inp.refi_amort_years ?? 30;
  const cashIn = inp.purchase_price * (inp.down_payment_rate + inp.closing_cost_rate) + rehab;
  const purchaseLoan = inp.purchase_price * (1 - inp.down_payment_rate);
  const refiLoan = inp.refi_ltv * inp.market_value;
  const cashOut = Math.max(0, refiLoan - purchaseLoan);
  return {
    cash_in: cashIn,
    purchase_loan: purchaseLoan,
    refi_loan: refiLoan,
    cash_out: cashOut,
    net_cash_left_in: cashIn - cashOut,
    equity_after_refi: inp.market_value - Math.max(refiLoan, purchaseLoan),
    added_monthly_debt_service: cashOut > 0 ? annualDebtService(cashOut, inp.refi_rate, amort) / 12 : 0,
  };
}

export interface GoalProgressInputs {
  target_monthly: number;
  /** Monthly cash flow of each deal assigned to the goal (underwritten or actual). */
  deal_monthly_cashflows: number[];
}

export interface GoalProgressResult {
  committed: number;
  remaining: number;
  pct: number;
  met: boolean;
  /** ≈ additional deals like the assigned ones needed; null with no deals yet. */
  est_more_deals: number | null;
}

/** Progress of a goal from its assigned deals — added in v1.6.0. */
export function goalProgress(inp: GoalProgressInputs): GoalProgressResult {
  const committed = inp.deal_monthly_cashflows.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, inp.target_monthly - committed);
  const pct = inp.target_monthly > 0 ? Math.min(1, committed / inp.target_monthly) : 1;
  const avg = inp.deal_monthly_cashflows.length ? committed / inp.deal_monthly_cashflows.length : 0;
  return {
    committed,
    remaining,
    pct,
    met: remaining === 0,
    est_more_deals: remaining === 0 ? 0 : avg > 0 ? Math.ceil(remaining / avg) : null,
  };
}

export interface GoalScenarioInputs {
  target_monthly_cashflow: number;
  capital_available: number;
  monthly_savings: number;
  avg_price_per_unit: number;
  avg_units_per_deal: number;
  /** CoC on a conventionally financed deal. */
  cash_on_cash: number;
  down_payment_rate: number;
  closing_cost_rate: number;
  /** Seller-finance: low down + better CoC (cheap debt). */
  seller_down_rate: number;
  seller_cash_on_cash: number;
  /** Value-add recycle: refi returns this share of invested cash. */
  refi_cash_back_fraction: number;
  refi_months: number;
  /** Equity capture: purchase price ÷ market value (0.7 = buying at 70%). */
  purchase_discount?: number;
  refi_ltv?: number;
  refi_rate?: number;
  max_months?: number;
}

export interface GoalScenario {
  key: 'conventional' | 'seller_finance' | 'value_add_recycle' | 'equity_capture';
  label: string;
  per_deal_price: number;
  per_deal_cash: number;
  per_deal_monthly_cashflow: number;
  doors_at_goal: number;
  /** Cash returned at each deal's refi (equity-capture strategy). */
  refi_cash_back?: number;
  result: SimulateGoalResult;
}

/** The three strategy paths, each run through the same simulator. */
export function goalScenarios(inp: GoalScenarioInputs): GoalScenario[] {
  const price = inp.avg_price_per_unit * inp.avg_units_per_deal;
  const common = {
    target_monthly_cashflow: inp.target_monthly_cashflow,
    capital_available: inp.capital_available,
    monthly_savings: inp.monthly_savings,
    max_months: inp.max_months,
  };

  const mk = (
    key: GoalScenario['key'],
    label: string,
    cash: number,
    coc: number,
    refiFrac: number,
  ): GoalScenario => {
    const cf = (cash * coc) / 12;
    const result = simulateGoal({
      ...common,
      per_deal_cash: cash,
      per_deal_monthly_cashflow: cf,
      refi_cash_back_fraction: refiFrac,
      refi_months: inp.refi_months,
    });
    return {
      key,
      label,
      per_deal_price: price,
      per_deal_cash: cash,
      per_deal_monthly_cashflow: cf,
      doors_at_goal: result.deals_needed * inp.avg_units_per_deal,
      result,
    };
  };

  // Equity capture: buy at a discount to value, cash-out refi against FULL
  // value, recycle the equity — with the larger loan's debt service charged
  // against cash flow at each refi.
  const discount = inp.purchase_discount ?? 0.7;
  const refiLtv = inp.refi_ltv ?? 0.7;
  const refiRate = inp.refi_rate ?? 0.075;
  const ec = equityCapture({
    purchase_price: price,
    market_value: price / discount,
    down_payment_rate: inp.down_payment_rate,
    closing_cost_rate: inp.closing_cost_rate,
    refi_ltv: refiLtv,
    refi_rate: refiRate,
  });
  const ecCf = (ec.cash_in * inp.cash_on_cash) / 12;
  const ecResult = simulateGoal({
    ...common,
    per_deal_cash: ec.cash_in,
    per_deal_monthly_cashflow: ecCf,
    refi_cash_back_fraction: ec.cash_in > 0 ? ec.cash_out / ec.cash_in : 0,
    refi_months: inp.refi_months,
    refi_monthly_cashflow_delta: -ec.added_monthly_debt_service,
  });

  return [
    mk(
      'conventional',
      'Conventional (bank-financed)',
      price * (inp.down_payment_rate + inp.closing_cost_rate),
      inp.cash_on_cash,
      0,
    ),
    mk(
      'seller_finance',
      'Seller finance (low down, cheap debt)',
      price * (inp.seller_down_rate + inp.closing_cost_rate),
      inp.seller_cash_on_cash,
      0,
    ),
    mk(
      'value_add_recycle',
      'Value-add + refi recycle (BRRRR-style)',
      price * (inp.down_payment_rate + inp.closing_cost_rate),
      inp.cash_on_cash,
      inp.refi_cash_back_fraction,
    ),
    {
      key: 'equity_capture',
      label: 'Equity capture (buy under value + cash-out refi)',
      per_deal_price: price,
      per_deal_cash: ec.cash_in,
      per_deal_monthly_cashflow: ecCf,
      doors_at_goal: ecResult.deals_needed * inp.avg_units_per_deal,
      refi_cash_back: ec.cash_out,
      result: ecResult,
    },
  ];
}
