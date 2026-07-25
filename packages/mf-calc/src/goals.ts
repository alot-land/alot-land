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

export interface SimulateGoalInputs {
  target_monthly_cashflow: number;
  capital_available: number;
  monthly_savings: number;
  per_deal_cash: number;
  per_deal_monthly_cashflow: number;
  /** Fraction of per_deal_cash returned at refi (0 = no refi). */
  refi_cash_back_fraction?: number;
  /** Months after purchase when the refi cash arrives. */
  refi_months?: number;
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
  max_months?: number;
}

export interface GoalScenario {
  key: 'conventional' | 'seller_finance' | 'value_add_recycle';
  label: string;
  per_deal_price: number;
  per_deal_cash: number;
  per_deal_monthly_cashflow: number;
  doors_at_goal: number;
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
  ];
}
