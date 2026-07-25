import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { listGoals, assignDealGoal, updateDealTracking } from '../lib/queries';
import { usd } from '../lib/format';
import { Tip } from './fields';

const STAGES = ['analyzing', 'pursue', 'contract', 'passed', 'closed'];

/**
 * Stage + goal linkage + under-contract terms for a deal.
 * `monthlyCashflow` is the selected scenario's underwritten monthly CFBT —
 * computed by mf-calc; this card only compares and displays.
 */
export default function DealTrackingCard({ deal, monthlyCashflow }) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const goals = useQuery({ queryKey: ['goals', org?.id], queryFn: () => listGoals(org.id), enabled: !!org });
  const activeGoals = (goals.data || []).filter((g) => g.status === 'active');

  const [target, setTarget] = useState(deal.deal_target_monthly ?? '');
  const [contract, setContract] = useState({
    contract_price: deal.contract_price ?? '',
    contract_date: deal.contract_date ?? '',
    expected_close_date: deal.expected_close_date ?? '',
  });
  const [err, setErr] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deal', deal.id] });
    qc.invalidateQueries({ queryKey: ['deals', org.id] });
    qc.invalidateQueries({ queryKey: ['goal-deals', org.id] });
  };

  async function setStage(status) {
    setErr(null);
    try {
      await updateDealTracking(deal.id, { status });
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setGoal(goalId) {
    setErr(null);
    try {
      await assignDealGoal(deal.id, goalId || null, target === '' ? null : Number(target));
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveContract() {
    setErr(null);
    try {
      await updateDealTracking(deal.id, contract);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  const targetNum = target === '' ? null : Number(target);
  const gap = targetNum != null && monthlyCashflow != null ? monthlyCashflow - targetNum : null;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-medium">
          Deal tracking
          <Tip text="Stage moves the deal through your pipeline. Under contract unlocks fields for the actual negotiated terms. Assigning a goal counts this deal's underwritten cash flow toward that goal's progress on the Goals page." />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              className={`px-2.5 py-1.5 text-xs capitalize ${deal.status === s ? 'bg-ink text-bg' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}
            >
              {s === 'contract' ? 'under contract' : s}
            </button>
          ))}
        </div>
      </div>

      {deal.status === 'contract' && (
        <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-border">
          {[
            ['contract_price', 'Contract price', 'number', 'The actual negotiated price.'],
            ['contract_date', 'Contract date', 'date', 'The day it went under contract.'],
            ['expected_close_date', 'Expected close', 'date', 'Target closing date — track your timeline.'],
          ].map(([key, label, type, tip]) => (
            <label key={key} className="flex flex-col gap-0.5 text-xs text-muted">
              <span className="flex items-center">{label}<Tip text={tip} /></span>
              <input
                className="input w-40 text-sm"
                type={type}
                value={contract[key]}
                onChange={(e) => setContract((c) => ({ ...c, [key]: e.target.value }))}
              />
            </label>
          ))}
          <button type="button" onClick={saveContract} className="btn-gold text-sm">
            Save terms
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-border">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          <span className="flex items-center">
            Part of goal
            <Tip text="Commit this deal to one of your goals — its underwritten monthly cash flow counts toward the goal's progress bar." />
          </span>
          <select
            className="input w-52 text-sm"
            value={deal.goal_id || ''}
            onChange={(e) => setGoal(e.target.value)}
          >
            <option value="">— not assigned —</option>
            {activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({usd(Number(g.target_monthly))}/mo)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          <span className="flex items-center">
            Want from this deal / mo
            <Tip text="What you personally want this deal to produce monthly. The line to the right tells you whether the underwrite gets there." />
          </span>
          <input
            className="input w-36 text-sm"
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => deal.goal_id && setGoal(deal.goal_id)}
          />
        </label>
        {monthlyCashflow == null ? (
          <div className="text-sm text-muted pb-2">Run an underwrite to see the monthly cash flow.</div>
        ) : gap == null ? (
          // Always show the estimate first — no target required.
          <div className="text-sm pb-2">
            <span className="font-medium">≈ {usd(monthlyCashflow)}/mo</span>{' '}
            <span className="text-muted">underwritten cash flow — set a target to compare.</span>
          </div>
        ) : (
          <div className={`text-sm pb-2 ${gap >= 0 ? 'text-green-deep' : 'text-danger'}`}>
            {gap >= 0
              ? `✓ Makes it — ${usd(monthlyCashflow)}/mo underwritten, ${usd(gap)} over your target`
              : `✗ Falls short — ${usd(monthlyCashflow)}/mo underwritten, ${usd(-gap)} under your target`}
          </div>
        )}
      </div>

      {activeGoals.length === 0 && (
        <p className="text-xs text-muted mt-2">No active goals yet — set one on the Goals page to commit deals to it.</p>
      )}
      {err && <div className="text-danger text-sm mt-2">{err}</div>}
    </div>
  );
}
