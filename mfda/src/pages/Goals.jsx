import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { listGoals, createGoal, updateGoal, setGoalStatus, listGoalDeals } from '../lib/queries';
import { usd } from '../lib/format';
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
  purchase_discount: 0.7,
  refi_ltv: 0.7,
  refi_rate: 0.075,
  bank_rate: 0.075,
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
    'Buy AT market price, improve, refinance most of your cash back out (BRRRR-style). Assumes the value-add rent increase covers the bigger refi loan — cash flow per deal holds steady. The most work per building.',
  equity_capture:
    "Buy at a DISCOUNT to real value (a $1.1M building for $700k), then cash-out refi against FULL value. The discount pays twice: the same rents carry a smaller loan, so cash flow beats a full-price deal from day one — and the refi returns your capital (sometimes more) for the next purchase. After the refi, cash flow honestly steps down to the full-value loan. This is what the off-market 💰 leads feed.",
};

const FIELD_DEFS = [
  ['avg_price_per_unit', '$ / unit', 'Typical all-in price per unit in your target markets.', 1000],
  ['avg_units_per_deal', 'Units / deal', 'Typical building size you buy.', 1],
  ['cash_on_cash', 'CoC (bank)', 'Cash-on-cash on a conventionally financed deal, decimal (0.08 = 8%). Steal the real number from your underwritten deals.', 0.01],
  ['down_payment_rate', 'Down %', 'Bank down payment, decimal.', 0.01],
  ['closing_cost_rate', 'Closing %', 'Closing costs as a share of price, decimal.', 0.01],
  ['seller_down_rate', 'Seller down %', 'Down payment when the seller carries, decimal.', 0.01],
  ['seller_cash_on_cash', 'CoC (seller)', 'Cash-on-cash under seller terms — usually higher (cheaper debt), decimal.', 0.01],
  ['refi_cash_back_fraction', 'Refi cash-back', 'Share of invested cash returned at refi in the value-add strategy, decimal.', 0.05],
  ['refi_months', 'Months to refi', 'Time from purchase to the refinance (value-add and equity-capture).', 1],
  ['purchase_discount', 'Buy at % of value', 'Equity capture: price ÷ real value, decimal. 0.7 = paying $700k for a $1M building.', 0.05],
  ['refi_ltv', 'Refi LTV', 'Equity capture: cash-out refi loan as a share of FULL market value, decimal.', 0.05],
  ['refi_rate', 'Refi rate', 'Interest rate on the cash-out refi, decimal.', 0.005],
  ['bank_rate', 'Bank rate', 'Purchase-loan interest rate (used to translate CoC into NOI for the equity-capture math), decimal.', 0.005],
];

function ScenarioGrid({ target, inputs }) {
  const scenarios = useMemo(() => {
    if (!(target > 0)) return [];
    try {
      return goalScenarios({ target_monthly_cashflow: target, ...DEFAULT_INPUTS, ...inputs });
    } catch {
      return [];
    }
  }, [target, inputs]);
  if (!scenarios.length) return null;

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
      {scenarios.map((s) => (
        <div key={s.key} className="card p-4 flex flex-col">
          <div className="text-sm font-medium flex items-center">
            {s.label}
            <Tip text={SCENARIO_TIPS[s.key]} />
          </div>
          <div className="stat mt-2">{fmtMonths(s.result.months_to_goal)}</div>
          <div className="text-xs text-muted">to {usd(target)}/month</div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Deals / doors</span>
              <span className="tabular-nums">{s.result.deals_needed} / {s.doors_at_goal}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Cash per deal</span>
              <span className="tabular-nums">{usd(s.per_deal_cash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{s.post_refi_monthly_cashflow != null ? 'Cash flow (pre-refi)' : 'Cash flow per deal'}</span>
              <span className="tabular-nums">{usd(s.per_deal_monthly_cashflow)}/mo</span>
            </div>
            {s.post_refi_monthly_cashflow != null && (
              <div className="flex justify-between">
                <span className="text-muted">Cash flow (after refi)</span>
                <span className="tabular-nums">{usd(s.post_refi_monthly_cashflow)}/mo</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Total cash deployed</span>
              <span className="tabular-nums">{usd(s.result.total_cash_invested)}</span>
            </div>
            {s.refi_cash_back != null && s.refi_cash_back > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Refi cash back / deal</span>
                <span className="tabular-nums text-green-deep">{usd(s.refi_cash_back)}</span>
              </div>
            )}
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
              {s.result.deals_needed === 0 && (inputs.capital_available ?? 0) < s.per_deal_cash
                ? `Never gets off the ground: ${usd(inputs.capital_available ?? 0)} to start doesn't cover the ${usd(s.per_deal_cash)} this strategy needs per deal${!((inputs.monthly_savings ?? 0) > 0) ? ', and at $0/month added nothing grows' : ''}. Lower the cash per deal or add monthly savings.`
                : "Converges too slowly (50+ years): cash flow alone can't accumulate the next down payment fast enough. Add savings, lower-down financing, or refi recycling."}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GoalForm({ initial, submitLabel, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '');
  const [target, setTarget] = useState(initial?.target ?? 10_000);
  const [inputs, setInputs] = useState({ ...DEFAULT_INPUTS, ...(initial?.inputs || {}) });
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    <div>
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
            <Tip text="Net monthly rental cash flow after all expenses and loan payments, portfolio-wide. Savings never count toward this — they only fund purchases." />
          </span>
          <input className="input w-36 text-sm" type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        {num('capital_available', 'Cash to start', 'What you can deploy today — down payments, closing, reserves.')}
        {num('monthly_savings', 'Saving / month (optional)', "NOT part of the goal — outside money toward the NEXT down payment. $0 is allowed; then only the buildings' cash flow and refis fund purchases.")}
        <button
          type="button"
          onClick={() => onSave({ name: name.trim(), target: Number(target), inputs })}
          disabled={saving || !(Number(target) > 0)}
          className="btn-gold text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">
            Cancel
          </button>
        )}
      </div>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-muted underline mt-3">
        {showAdvanced ? 'Hide' : 'Edit'} deal assumptions
      </button>
      {showAdvanced && (
        <div className="flex flex-wrap gap-3 mt-3">
          {FIELD_DEFS.map(([key, label, tip, step]) => num(key, label, tip, step))}
        </div>
      )}
      <div className="mt-4">
        <ScenarioGrid target={Number(target)} inputs={inputs} />
      </div>
    </div>
  );
}

export default function Goals() {
  const { org } = useOrg();
  const { user } = useAuth();
  const qc = useQueryClient();

  const goals = useQuery({ queryKey: ['goals', org?.id], queryFn: () => listGoals(org.id), enabled: !!org });
  const goalDeals = useQuery({ queryKey: ['goal-deals', org?.id], queryFn: () => listGoalDeals(org.id), enabled: !!org });
  const actives = (goals.data || []).filter((g) => g.status === 'active');
  const achieved = (goals.data || []).filter((g) => g.status === 'achieved');

  const [showNew, setShowNew] = useState(false);
  const [newInitial, setNewInitial] = useState(null); // set by "Duplicate"
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const isOpen = (id) => expanded[id] ?? actives.length === 1; // solo goal opens by default

  const refresh = () => qc.invalidateQueries({ queryKey: ['goals', org.id] });

  function progressFor(goal) {
    const assigned = (goalDeals.data || []).filter((d) => d.goal_id === goal.id);
    const cfs = assigned
      .map((d) =>
        d.latest_outputs?.financing?.dscr?.cfbt != null
          ? d.latest_outputs.financing.dscr.cfbt / 12
          : d.deal_target_monthly != null
            ? Number(d.deal_target_monthly)
            : null,
      )
      .filter((v) => v != null);
    return { assigned, progress: goalProgress({ target_monthly: Number(goal.target_monthly), deal_monthly_cashflows: cfs }) };
  }

  async function saveNew({ name, target, inputs }) {
    setSaving(true);
    try {
      await createGoal(org.id, user.id, { name: name || `${usd(target)}/month`, target_monthly: target, inputs });
      setShowNew(false);
      setNewInitial(null);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(goal, { name, target, inputs }) {
    setSaving(true);
    try {
      await updateGoal(goal.id, { name: name || goal.name, target_monthly: target, inputs });
      setEditingId(null);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  async function markAchieved(g) {
    await setGoalStatus(g.id, 'achieved');
    refresh();
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Goals</h1>
          <p className="text-muted text-sm">
            Run as many goals as you want — each with its own assumptions, strategies, and committed deals.
            <Tip text="Four strategies run through a month-by-month simulation per goal: capital grows from savings plus the cash flow of each deal bought (the snowball), and a new deal is bought whenever the war chest covers one. All math in the tested calc engine. Deals pick which goal they serve from their results page." />
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewInitial(null);
            setShowNew((v) => !v);
          }}
          className="btn-gold text-sm"
        >
          {showNew ? 'Close' : '+ New goal'}
        </button>
      </div>

      {(showNew || actives.length === 0) && (
        <div className="card p-4 mb-6">
          <div className="text-sm font-medium mb-3">{newInitial ? `New goal (duplicated from “${newInitial.name}”)` : 'New goal'}</div>
          <GoalForm
            initial={newInitial}
            submitLabel="Set goal"
            onSave={saveNew}
            onCancel={actives.length > 0 ? () => { setShowNew(false); setNewInitial(null); } : null}
            saving={saving}
          />
        </div>
      )}

      <div className="space-y-4">
        {actives.map((g) => {
          const { assigned, progress } = progressFor(g);
          const open = isOpen(g.id);
          return (
            <div key={g.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded((s) => ({ ...s, [g.id]: !open }))}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-4 hover:bg-surface-2/50"
              >
                <span className="text-muted">{open ? '▾' : '▸'}</span>
                <div>
                  <div className="font-display text-lg font-semibold">{g.name}</div>
                  <div className="text-xs text-muted">{usd(Number(g.target_monthly))}/month target</div>
                </div>
                <div className="flex-1 min-w-[160px] max-w-md">
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full bg-green rounded-full" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {usd(progress.committed)}/mo committed · {assigned.length} deal{assigned.length === 1 ? '' : 's'}
                    {progress.met && ' · 🎉 covered'}
                  </div>
                </div>
              </button>

              {open && (
                <div className="px-4 pb-4 border-t border-border pt-4">
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button type="button" onClick={() => setEditingId(editingId === g.id ? null : g.id)} className="btn-ghost text-sm py-1">
                      {editingId === g.id ? 'Close editor' : '✎ Edit goal'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewInitial({ name: g.name, target: Number(g.target_monthly), inputs: g.inputs || {} });
                        setShowNew(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="btn-ghost text-sm py-1"
                      title="Copy this goal's numbers into a new goal — tweak assumptions to compare scenarios side by side"
                    >
                      ⧉ Duplicate as new
                    </button>
                    <button type="button" onClick={() => markAchieved(g)} className="btn-gold text-sm py-1 ml-auto">
                      🎉 Made it — mark achieved
                    </button>
                  </div>

                  {editingId === g.id ? (
                    <GoalForm
                      initial={{ name: g.name, target: Number(g.target_monthly), inputs: g.inputs || {} }}
                      submitLabel="Save changes"
                      onSave={(v) => saveEdit(g, v)}
                      onCancel={() => setEditingId(null)}
                      saving={saving}
                    />
                  ) : (
                    <>
                      {assigned.length > 0 ? (
                        <div className="mb-4 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                          {!progress.met && progress.est_more_deals != null && (
                            <span>{usd(progress.remaining)}/mo to go · ≈ {progress.est_more_deals} more deal{progress.est_more_deals === 1 ? '' : 's'} like these</span>
                          )}
                          {assigned.map((d) => (
                            <Link key={d.id} to={`/deals/${d.id}`} className="hover:underline">
                              {d.address || 'deal'}
                              {d.status === 'contract' && ' (under contract)'}
                              {d.status === 'closed' && ' (closed ✓)'}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted mb-4">
                          No deals committed yet — on any deal’s results page, use “Part of goal” to count it here.
                        </p>
                      )}
                      <ScenarioGrid target={Number(g.target_monthly)} inputs={g.inputs || {}} />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted mt-4">
        Simulations, honestly labeled: constant per-deal assumptions, no appreciation or rent growth
        counted (upside on top). calc v{CALC_VERSION}.
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
