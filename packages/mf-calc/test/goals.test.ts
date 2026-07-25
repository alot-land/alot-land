/**
 * Goal planner — added in calc v1.5.0 (new module + tests per the frozen-
 * module protocol). Tests written BEFORE the implementation.
 *
 * Simulates the path to a target monthly cash flow: capital accumulates
 * from savings plus cash flow of already-purchased deals (the snowball),
 * a deal is bought whenever the war chest covers one, optional refi events
 * return part of the invested cash (BRRRR-style recycling).
 */
import { describe, it, expect } from 'vitest';
import { CALC_VERSION, simulateGoal, goalScenarios, goalProgress } from '../src/index.js';

describe('calc version', () => {
  it('is at least 1.5.0 (goals module)', () => {
    const [maj, min] = CALC_VERSION.split('.').map(Number);
    expect(maj! > 1 || (maj === 1 && min! >= 5)).toBe(true);
  });
});

describe('simulateGoal', () => {
  it('buys immediately when capital covers the first deal and snowballs', () => {
    // Deal: 100k cash in, $1,000/mo cash flow. Target $2,000/mo.
    // Start with 100k, save 5k/mo.
    const r = simulateGoal({
      target_monthly_cashflow: 2_000,
      capital_available: 100_000,
      monthly_savings: 5_000,
      per_deal_cash: 100_000,
      per_deal_monthly_cashflow: 1_000,
    });
    expect(r.reached).toBe(true);
    expect(r.purchases[0]!.month).toBe(0); // first deal on day one
    // After month 0: saving 5k + 1k cash flow = 6k/mo → 100k more ≈ 17 months.
    expect(r.purchases[1]!.month).toBe(17);
    expect(r.months_to_goal).toBe(17);
    expect(r.deals_needed).toBe(2);
    expect(r.final_monthly_cashflow).toBe(2_000);
    expect(r.total_cash_invested).toBe(200_000);
  });

  it('waits to accumulate when starting under the first deal cost', () => {
    const r = simulateGoal({
      target_monthly_cashflow: 1_000,
      capital_available: 40_000,
      monthly_savings: 10_000,
      per_deal_cash: 100_000,
      per_deal_monthly_cashflow: 1_000,
    });
    // 60k short at 10k/mo → buys at month 6, goal reached with 1 deal.
    expect(r.purchases[0]!.month).toBe(6);
    expect(r.months_to_goal).toBe(6);
    expect(r.deals_needed).toBe(1);
  });

  it('refi events return cash and accelerate the next purchase', () => {
    const base = {
      target_monthly_cashflow: 2_000,
      capital_available: 100_000,
      monthly_savings: 0,
      per_deal_cash: 100_000,
      per_deal_monthly_cashflow: 1_000,
    };
    const noRefi = simulateGoal(base);
    const refi = simulateGoal({ ...base, refi_cash_back_fraction: 0.6, refi_months: 12 });
    // Without refi and 0 savings: only cash flow (1k/mo) → 100 months to deal 2.
    expect(noRefi.months_to_goal).toBe(100);
    // With refi: +60k back at month 12; 12k cash flow banked by then → 28k to go
    // at 1k/mo → buys at month 40.
    expect(refi.months_to_goal).toBe(40);
    expect(refi.months_to_goal).toBeLessThan(noRefi.months_to_goal);
  });

  it('reports not-reached instead of looping forever on impossible goals', () => {
    const r = simulateGoal({
      target_monthly_cashflow: 50_000,
      capital_available: 0,
      monthly_savings: 0,
      per_deal_cash: 100_000,
      per_deal_monthly_cashflow: 500,
    });
    expect(r.reached).toBe(false);
    expect(r.months_to_goal).toBeNull();
  });
});

describe('goalProgress (v1.6.0)', () => {
  it('sums committed deal cash flows against the target', () => {
    const p = goalProgress({ target_monthly: 10_000, deal_monthly_cashflows: [1_200, 800, 2_000] });
    expect(p.committed).toBe(4_000);
    expect(p.remaining).toBe(6_000);
    expect(p.pct).toBeCloseTo(0.4, 12);
    expect(p.met).toBe(false);
    // avg 1,333.33/deal → 6,000 / avg = 4.5 → 5 more deals like these
    expect(p.est_more_deals).toBe(5);
  });

  it('met goals report zero remaining and clamp pct at 1', () => {
    const p = goalProgress({ target_monthly: 3_000, deal_monthly_cashflows: [2_000, 2_000] });
    expect(p.met).toBe(true);
    expect(p.remaining).toBe(0);
    expect(p.pct).toBe(1);
    expect(p.est_more_deals).toBe(0);
  });

  it('no deals yet → zero progress, no fabricated deal estimate', () => {
    const p = goalProgress({ target_monthly: 5_000, deal_monthly_cashflows: [] });
    expect(p.committed).toBe(0);
    expect(p.pct).toBe(0);
    expect(p.est_more_deals).toBeNull(); // unknowable without a per-deal figure
  });
});

describe('goalScenarios', () => {
  const inputs = {
    target_monthly_cashflow: 10_000,
    capital_available: 150_000,
    monthly_savings: 5_000,
    avg_price_per_unit: 150_000,
    avg_units_per_deal: 4,
    cash_on_cash: 0.08,
    down_payment_rate: 0.25,
    closing_cost_rate: 0.03,
    seller_down_rate: 0.1,
    seller_cash_on_cash: 0.12,
    refi_cash_back_fraction: 0.6,
    refi_months: 12,
  };
  const s = goalScenarios(inputs);

  it('produces the three named strategies', () => {
    expect(s.map((x) => x.key)).toEqual(['conventional', 'seller_finance', 'value_add_recycle']);
  });

  it('conventional: deal cash = price × (down + closing); cf = cash × CoC ÷ 12', () => {
    const conv = s[0]!;
    // price/deal 600k → cash 600k × 0.28 = 168k; cf = 168k × 8% / 12 = 1,120/mo
    expect(conv.per_deal_cash).toBeCloseTo(168_000, 6);
    expect(conv.per_deal_monthly_cashflow).toBeCloseTo(1_120, 6);
    expect(conv.result.deals_needed).toBe(Math.ceil(10_000 / 1_120));
  });

  it('seller finance needs less cash per deal and reaches the goal sooner', () => {
    const conv = s[0]!;
    const seller = s[1]!;
    expect(seller.per_deal_cash).toBeLessThan(conv.per_deal_cash);
    expect(seller.result.months_to_goal!).toBeLessThanOrEqual(conv.result.months_to_goal!);
  });

  it('recycling capital beats conventional on timeline', () => {
    const conv = s[0]!;
    const brrrr = s[2]!;
    expect(brrrr.result.months_to_goal!).toBeLessThanOrEqual(conv.result.months_to_goal!);
  });

  it('every scenario reports doors at goal', () => {
    for (const sc of s) {
      expect(sc.result.deals_needed * inputs.avg_units_per_deal).toBe(sc.doors_at_goal);
    }
  });
});
