import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDeal, listScenarios } from '../lib/queries';
import { usd, pct, ratio } from '../lib/format';

/**
 * Scenario compare — select 2–5 immutable snapshots of one deal, side by side.
 * Outputs come straight from each snapshot (no recomputation — historical
 * results stay exactly as their calc_version produced them). Inputs that
 * DIFFER between selected scenarios are highlighted; identical ones are
 * collapsed by default.
 */

// Curated output metrics: [label, getter, formatter]
const METRICS = [
  ['Score', (o) => o.score?.score, (v) => (v != null ? Math.round(v) : '—')],
  ['Verdict', (o) => o.score?.pursue, (v) => (v == null ? '—' : v ? 'PURSUE' : 'pass')],
  ['NOI', (o) => o.derived?.noi, usd],
  ['Cap on price', (o) => o.derived?.cap_rate_on_price, pct],
  ['DSCR (loan)', (o) => o.financing?.dscr?.dscr, ratio],
  ['Cash-on-cash', (o) => o.financing?.dscr?.cash_on_cash, pct],
  ['Cash flow / yr', (o) => o.financing?.dscr?.cfbt, usd],
  ['IRR', (o) => o.financing?.dscr?.irr, pct],
  ['Equity multiple', (o) => o.financing?.dscr?.equity_multiple, (v) => (v != null ? `${ratio(v)}×` : '—')],
  ['Break-even occ.', (o) => o.financing?.dscr?.break_even_occupancy, (v) => pct(v, 1)],
  ['Max offer (solver)', (o) => o.solvers?.max_offer?.max_offer, usd],
  ['Min down (solver)', (o) => o.solvers?.min_down?.down_fraction, (v) => pct(v, 1)],
  ['Primary valuation', (o) => o.primary_value, usd],
  ['Valuation spread', (o) => o.valuation?.spread, (v) => pct(v, 1)],
  ['Worst-case DSCR', (o) => o.stress?.[5]?.dscr, ratio],
  ['Yr-1 tax benefit (REP on)', (o) => o.tax?.year1?.benefit_rep_on, usd],
  ['Total profit (proforma)', (o) => o.proforma?.exit?.total_profit, usd],
];

/** Flatten a nested inputs object to dot-path → value. Arrays included. */
function flatten(obj, prefix = '', out = {}) {
  if (obj == null || typeof obj !== 'object') {
    out[prefix] = obj;
    return out;
  }
  const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
  for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : String(k), out);
  return out;
}

const RATE_PATH = /rate|pct|vacancy|ltv|fraction|discount|threshold|weight/i;
function fmtInput(path, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (RATE_PATH.test(path) && Math.abs(v) <= 1.5) return pct(v);
    return v.toLocaleString('en-US');
  }
  return String(v);
}

// Noise paths not worth diffing for the operator.
const SKIP = /^(market_id|status|apn|county_fips|address|city|state|zip|lat|lng|market\.)/;

export default function Compare() {
  const { id } = useParams();
  const deal = useQuery({ queryKey: ['deal', id], queryFn: () => getDeal(id) });
  const scenarios = useQuery({ queryKey: ['scenarios', id], queryFn: () => listScenarios(id) });
  const [picked, setPicked] = useState(null); // null = default latest 2
  const [showAllInputs, setShowAllInputs] = useState(false);

  const list = scenarios.data || [];
  const selectedIds = picked ?? list.slice(0, 2).map((s) => s.id);
  const selected = list.filter((s) => selectedIds.includes(s.id));

  function toggle(sid) {
    const cur = new Set(selectedIds);
    if (cur.has(sid)) cur.delete(sid);
    else if (cur.size < 5) cur.add(sid);
    setPicked([...cur]);
  }

  const inputRows = useMemo(() => {
    if (selected.length < 2) return { changed: [], same: [] };
    const flats = selected.map((s) => flatten(s.inputs || {}));
    const keys = [...new Set(flats.flatMap((f) => Object.keys(f)))]
      .filter((k) => !SKIP.test(k))
      .sort();
    const changed = [];
    const same = [];
    for (const k of keys) {
      const vals = flats.map((f) => f[k]);
      const differs = vals.some((v) => JSON.stringify(v) !== JSON.stringify(vals[0]));
      (differs ? changed : same).push({ path: k, vals });
    }
    return { changed, same };
  }, [selected]);

  if (deal.isLoading || scenarios.isLoading)
    return <div className="p-10 text-center text-muted">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div>
        <Link to={`/deals/${id}`} className="text-sm text-muted hover:underline">← Back to deal</Link>
        <h1 className="font-display text-2xl font-semibold">Compare scenarios</h1>
        <p className="text-muted text-sm">{deal.data?.address} · pick 2–5 versions · snapshots are immutable</p>
      </div>

      <div className="card p-4">
        <div className="label mb-2">Versions ({selectedIds.length}/5 selected)</div>
        <div className="flex flex-wrap gap-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                selectedIds.includes(s.id)
                  ? 'bg-ink text-bg border-ink'
                  : 'bg-surface text-ink-2 border-border hover:bg-surface-2'
              }`}
            >
              {s.label} · {new Date(s.created_at).toLocaleString()} <span className="opacity-60">v{s.calc_version}</span>
            </button>
          ))}
        </div>
      </div>

      {selected.length < 2 ? (
        <div className="card p-10 text-center text-muted">
          Select at least two versions. {list.length < 2 && 'Re-run the deal (Edit / re-run) to create more versions.'}
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-surface-2">
                <tr>
                  <th className="th">Result</th>
                  {selected.map((s) => (
                    <th key={s.id} className="th text-right">
                      {s.label}
                      <div className="font-normal normal-case text-muted">{new Date(s.created_at).toLocaleDateString()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([label, get, fmt]) => {
                  const vals = selected.map((s) => get(s.outputs || {}));
                  const nums = vals.filter((v) => typeof v === 'number');
                  const best = nums.length === vals.length && nums.length > 1 ? Math.max(...nums) : null;
                  return (
                    <tr key={label}>
                      <td className="td text-ink-2">{label}</td>
                      {vals.map((v, i) => (
                        <td
                          key={selected[i].id}
                          className={`td text-right ${best != null && v === best && nums.some((n) => n !== best) ? 'text-green-deep font-medium' : ''}`}
                        >
                          {fmt(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted px-3 py-2 border-t border-border">
              Green = best value among selected (where higher is better for most metrics — read Min down and spread in context).
            </p>
          </div>

          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h2 className="font-medium">Changed inputs</h2>
                <p className="text-xs text-muted">{inputRows.changed.length} inputs differ · {inputRows.same.length} identical (hidden)</p>
              </div>
              <button type="button" className="btn-ghost text-xs" onClick={() => setShowAllInputs((v) => !v)}>
                {showAllInputs ? 'Hide identical' : 'Show all inputs'}
              </button>
            </div>
            <table className="w-full text-sm min-w-[560px] mt-2">
              <thead>
                <tr>
                  <th className="th">Input</th>
                  {selected.map((s) => <th key={s.id} className="th text-right">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {inputRows.changed.map(({ path, vals }) => (
                  <tr key={path} className="bg-gold/10">
                    <td className="td font-mono text-xs">{path}</td>
                    {vals.map((v, i) => (
                      <td key={selected[i].id} className="td text-right font-medium">{fmtInput(path, v)}</td>
                    ))}
                  </tr>
                ))}
                {inputRows.changed.length === 0 && (
                  <tr><td className="td text-muted" colSpan={selected.length + 1}>No input differences — same assumptions, possibly different calc versions.</td></tr>
                )}
                {showAllInputs && inputRows.same.map(({ path, vals }) => (
                  <tr key={path}>
                    <td className="td font-mono text-xs text-muted">{path}</td>
                    {vals.map((v, i) => (
                      <td key={selected[i].id} className="td text-right text-muted">{fmtInput(path, v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
