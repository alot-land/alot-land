import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';
import { listGoals, createGoal, setGoalStatus, listGoalDeals } from '../lib/queries';
import { usd, pct } from '../lib/format';
import { Tip } from '../components/fields';
import { goalScenarios, goalProgress, CALC_VERSION } from '@alot/mf-calc';

const DEFAULT_INPUTS = {
  capital_available: 100_000,
  monthly_savings: 3_000,
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

const fmtMonths = (m) => {
  if (m == null) return 'not reachable within 50 years';
  if (m === 0) return 'immediately';
  const y = Math.floor(m / 12);
  const rem = m % 12;
  return [y > 0 && `${y} yr${y > 1 ? 's' : ''}`, rem > 0 && `${rem} mo`].filter(Boolean).join(' ');
};

const SCENARIO_TIPS = {
  conventional:
    'Bank loans at 25% down. The slow-and-steady baseline: most capital per deal, but simplest to execute and finance.',
  seller_finance:
    'Owner carries the note at ~10% down — exactly what long-hold, high-equity off-market sellers can offer. Less cash per deal and cheaper debt means faster doors, but every deal takes a negotiated seller.',
  value_add_recycle:
    'Buy under-rented buildings, improve, refinance, and pull most of your cash back out to buy the next one (BRRRR-style). Fastest path on paper — and the most work per deal.',
};

export default function Goals() {
  const { org } = useOrg();
  const { user } = useAuth();
  const qc = useQueryClient();

  const goals = useQuery({ queryKey: ['goals', org?.id], queryFn: () => listGoals(org.id), enabled: !!org });
  const goalDeals = useQuery({ queryKey: ['goal-deals', org?.id], queryFn: () => listGoalDeals(org.id), enabled: !!org });
  const active = (goals.data || []).find((g) => g.status === 'active');
  const achieved = (goals.data || []).filter((g) => g.status === 'achieved');

  // Deals committed to the active goal: underwritten monthly CFBT (mf-calc
  // output), else the operator's pledged per-deal target.
  const assigned = useMemo(
    () => (goalDeals.data || []).filter((d) => active && d.goal_id === active.id),
    [goalDeals.data, active],
  );
  const progress = useMemo(() => {
    if (!active) return null;
    const cfs = assigned
      .map((d) =>
        d.latest_outputs?.financing?.dscr?.cfbt != null
          ? d.latest_outputs.financing.dscr.cfbt / 12
          : d.deal_target_monthly != null
            ? Number(d.deal_target_monthly)
            : null,
      )
      .filter((v) => v != null);
    return goalProgress({ target_monthly: Number(active.target_monthly), deal_monthly_cashflows: cfs });
  }, [active, assigned]);

  const [name, setName] = useState('');
  const [target, setTarget] = useState(10_000);
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // When a goal is active, plan against ITS saved assumptions.
  const planTarget = active ? Number(active.target_monthly) : Number(target) || 0;
  const planInputs = active ? { ...DEFAULT_INPUTS, ...(active.inputs || {}) } : inputs;

  const scenarios = useMemo(() => {
    if (!(planTarget > 0)) return [];
    try {
      return goalScenarios({ target_monthly_cashflow: planTarget, ...planInputs });
    } catch {
      return [];
    }
  }, [planTarget, planInputs]);

  async function save() {
    setSaving(true);
    try {
      await createGoal(org.id, user.id, {
        name: name.trim() || `${usd(Number(target))}/month`,
        target_monthly: Number(target),
        inputs,
      });
      setName('');
      qc.invalidateQueries({ queryKey: ['goals', org.id] });
    } finally {
      setSaving(false);
    }
  }

  async function markAchieved(g) {
    await setGoalStatus(g.id, 'achieved');
    qc.invalidateQueries({ queryKey: ['goals', org.id] });
  }

  const num = (key, label, tip, step = 1) => (
    <label key={key} className="flex flex-col gap-0.5 text-xs text-muted">
      <span className="flex items-center">{label}<Tip text={tip} /></span>
      <input
        className="input w-36 text-sm"
        type="number"
        step={step}
        value={inputs[key]}
        onChange={(e) => setInputs((s) => ({ ...s, [key]: Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Goals</h1>
        <p className="text-muted text-sm">
          Name the monthly cash flow you want — see the paths, the price tags, and the timelines.
          <Tip text="Three strategies run through a month-by-month simulation: your capital grows from savings plus the cash flow of each deal you buy (the snowball), and a new deal is bought whenever the war chest covers one. All math in the tested calc engine — the timelines are arithmetic, not vibes." />
        </p>
      </div>

      {/* Active goal, or the form to set one */}
      {active ? (
        <div className="card p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-muted">Active goal</div>
              <div className="font-display text-xl font-semibold">{active.name}</div>
              <div className="text-sm text-ink-2">{usd(Number(active.target_monthly))}/month target</div>
            </div>
            <button type="button" onClick={() => markAchieved(active)} className="btn-gold text-sm ml-auto">
              🎉 Made it — mark achieved
            </button>
          </div>
          {progress && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center">
                  <span className="font-medium">{usd(progress.committed)}/mo committed</span>
                  <Tip text="Sum of the underwritten monthly cash flow (or your pledged per-deal target) of every deal assigned to this goal from its results page." />
                </span>
                <span className="text-muted">
                  {progress.met
                    ? '🎉 target covered by committed deals'
                    : `${usd(progress.remaining)}/mo to go${progress.est_more_deals != null ? ` · ≈ ${progress.est_more_deals} more deal${progress.est_more_deals === 1 ? '' : 's'} like these` : ''}`}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-green rounded-full transition-all"
                  style={{ width: `${Math.round(progress.pct * 100)}%` }}
                />
              </div>
              {assigned.length > 0 && (
                <div className="mt-2 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                  {assigned.map((d) => (
                    <Link key={d.id} to={`/deals/${d.id}`} className="hover:underline">
                      {d.address || 'deal'}
                      {d.status === 'contract' && ' (under contract)'}
                      {d.status === 'closed' && ' (closed ✓)'}
                    </Link>
                  ))}
                </div>
              )}
              {assigned.length === 0 && (
                <p className="text-xs text-muted mt-2">
                  No deals committed yet — on any deal’s results page, use “Part of goal” to count it here.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="card p-4 mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              <span>Goal name</span>
              <input
                className="input w-52 text-sm"
                placeholder="e.g. Replace my income"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              <span className="flex items-center">
                Target cash flow / month
                <Tip text="Net monthly cash flow after all expenses and loan payments, across the whole portfolio." />
              </span>
              <input
                className="input w-36 text-sm"
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            {num('capital_available', 'Cash to start', 'What you can deploy today — down payments, closing, reserves.')}
            {num('monthly_savings', 'Saving / month (optional)', "NOT part of the goal — the goal is pure rental cash flow. This is outside money you put toward the NEXT down payment. $0 is allowed: then only the buildings' own cash flow (and refis) fund the next purchase, which is much slower — that's the honest math, and it's why the low-down seller-finance path wins at $0.")}
            <button type="button" onClick={save} disabled={saving || !(Number(target) > 0)} className="btn-gold text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Set goal'}
            </button>
          </div>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-muted underline mt-3">
            {showAdvanced ? 'Hide' : 'Edit'} deal assumptions
          </button>
          {showAdvanced && (
            <div className="flex flex-wrap gap-3 mt-3">
              {num('avg_price_per_unit', '$ / unit', 'Typical all-in price per unit in your target markets. Phoenix 2–4s run higher; Nashville duplexes lower.', 1000)}
              {num('avg_units_per_deal', 'Units / deal', 'Typical building size you buy.')}
              {num('cash_on_cash', 'CoC (bank)', 'Cash-on-cash return on a conventionally financed deal, as a decimal (0.08 = 8%). Your underwritten deals tell you what is realistic.', 0.01)}
              {num('down_payment_rate', 'Down %', 'Bank down payment, decimal.', 0.01)}
              {num('closing_cost_rate', 'Closing %', 'Closing costs as a share of price, decimal.', 0.01)}
              {num('seller_down_rate', 'Seller down %', 'Down payment when the seller carries, decimal.', 0.01)}
              {num('seller_cash_on_cash', 'CoC (seller)', 'Cash-on-cash under seller terms — usually higher because the debt is cheaper, decimal.', 0.01)}
              {num('refi_cash_back_fraction', 'Refi cash-back', 'Share of invested cash returned at refinance in the value-add strategy, decimal (0.6 = 60%).', 0.05)}
              {num('refi_months', 'Months to refi', 'Time from purchase to the value-add refinance.')}
            </div>
          )}
        </div>
      )}

      {/* The three paths */}
      {scenarios.length > 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          {scenarios.map((s) => (
            <div key={s.key} className="card p-4 flex flex-col">
              <div className="text-sm font-medium flex items-center">
                {s.label}
                <Tip text={SCENARIO_TIPS[s.key]} />
              </div>
              <div className="stat mt-2">{fmtMonths(s.result.months_to_goal)}</div>
              <div className="text-xs text-muted">to {usd(planTarget)}/month</div>
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Deals / doors</span>
                  <span className="tabular-nums">
                    {s.result.deals_needed} / {s.doors_at_goal}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Cash per deal</span>
                  <span className="tabular-nums">{usd(s.per_deal_cash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Cash flow per deal</span>
                  <span className="tabular-nums">{usd(s.per_deal_monthly_cashflow)}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Total cash deployed</span>
                  <span className="tabular-nums">{usd(s.result.total_cash_invested)}</span>
                </div>
                {s.result.refi_cash_returned > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Refi cash recycled</span>
                    <span className="tabular-nums">{usd(s.result.refi_cash_returned)}</span>
                  </div>
                )}
              </div>
              {s.result.reached && s.result.purchases.length > 0 && (
                <div className="mt-3 pt-2 border-t border-border text-xs text-muted">
                  <div className="font-medium text-ink-2 mb-1">Buying schedule</div>
                  {s.result.purchases.slice(0, 6).map((pch) => (
                    <div key={pch.deal_number}>
                      Deal {pch.deal_number} — {pch.month === 0 ? 'now' : `month ${pch.month}`}
                    </div>
                  ))}
                  {s.result.purchases.length > 6 && <div>… {s.result.purchases.length - 6} more</div>}
                </div>
              )}
              {!s.result.reached && (
                <div className="mt-3 text-xs text-warn">
                  {s.result.deals_needed === 0 && planInputs.capital_available < s.per_deal_cash
                    ? `Never gets off the ground: ${usd(planInputs.capital_available)} to start doesn't cover the ${usd(s.per_deal_cash)} this strategy needs per deal${!(planInputs.monthly_savings > 0) ? ", and at $0/month added nothing grows" : ''}. Lower the cash per deal (seller finance, smaller buildings) or add monthly savings.`
                    : "Converges too slowly (50+ years): the buildings' cash flow alone can't accumulate the next down payment fast enough. Add monthly savings, use lower-down financing, or recycle cash via refis."}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted mt-4">
        Simulations, honestly labeled: constant per-deal assumptions, no appreciation or rent growth
        counted (upside on top). CoC defaults are editable — steal the real numbers from your
        underwritten deals. calc v{CALC_VERSION}.
      </p>

      {achieved.length > 0 && (
        <div className="card mt-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-medium">🏆 Achieved</div>
          <table className="w-full text-sm">
            <tbody>
              {achieved.map((g) => (
                <tr key={g.id}>
                  <td className="td font-medium">{g.name}</td>
                  <td className="td text-right">{usd(Number(g.target_monthly))}/mo</td>
                  <td className="td text-right text-muted">
                    {g.achieved_at && new Date(g.achieved_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
