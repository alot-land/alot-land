import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEntries, updateEntry, deleteEntry } from '../lib/queries';
import { REPS_CATEGORIES, TIERS, tierByKey } from '../lib/reps';
import { fmtH } from '../lib/stats';
import PageHeader from '../components/PageHeader.jsx';

export default function Entries() {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const { data: entries = [] } = useQuery({ queryKey: ['reps-entries'], queryFn: fetchEntries });

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [tier, setTier] = useState('all');
  const [reviewOnly, setReviewOnly] = useState(sp.get('filter') === 'review');
  const [year, setYear] = useState('2026');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reps-entries'] });
  const update = useMutation({ mutationFn: ({ id, patch }) => updateEntry(id, patch), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteEntry, onSuccess: invalidate });

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return entries.filter((e) => {
      if (year !== 'all' && (e.entry_date || '').slice(0, 4) !== year) return false;
      if (cat !== 'all' && e.category !== cat) return false;
      if (tier !== 'all' && e.source_tier !== tier) return false;
      if (reviewOnly && !e.needs_review) return false;
      if (needle && !(`${e.description} ${e.source_ref || ''}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [entries, q, cat, tier, reviewOnly, year]);

  const totalHours = useMemo(() => fmtH(filtered.reduce((s, e) => s + Number(e.hours || 0), 0)), [filtered]);
  const qualHours = useMemo(() => fmtH(filtered.filter((e) => e.reps_qualifying).reduce((s, e) => s + Number(e.hours || 0), 0)), [filtered]);

  const set = (id, patch) => update.mutate({ id, patch });

  return (
    <div className="pb-16">
      <PageHeader
        title="Entries"
        subtitle={`${filtered.length} shown · ${totalHours}h total · ${qualHours}h qualifying`}
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description / source…"
            className="flex-1 min-w-[200px] bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-gold"
          />
          <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="all">All years</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="all">All categories</option>
            {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="all">All evidence</option>
            {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer px-2">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="accent-gold" />
            Needs review
          </label>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-panel overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-border">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 font-medium text-right">Hrs</th>
                <th className="px-3 py-2.5 font-medium">Evidence</th>
                <th className="px-3 py-2.5 font-medium text-center">Qual.</th>
                <th className="px-3 py-2.5 font-medium text-center">RE</th>
                <th className="px-3 py-2.5 font-medium text-center">Rev.</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className={`border-b border-border/50 hover:bg-panel-2/40 ${e.needs_review ? 'bg-gold/5' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted tabular-nums">{e.entry_date}</td>
                  <td className="px-3 py-2">
                    <select
                      value={e.category}
                      onChange={(ev) => set(e.id, { category: ev.target.value, is_real_estate: ev.target.value !== 'Non-REPS' && ev.target.value !== 'Coaching/Education' })}
                      className="bg-bg border border-border-hi rounded-md px-1.5 py-1 text-xs outline-none focus:border-gold max-w-[170px]"
                    >
                      {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 max-w-[320px]">
                    <div className="truncate" title={e.description}>{e.description}</div>
                    {e.source_ref && <div className="text-[10px] text-muted truncate" title={e.source_ref}>{e.source_ref}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <input
                      type="number" step="0.25" min="0" defaultValue={e.hours}
                      onBlur={(ev) => { const v = parseFloat(ev.target.value); if (Number.isFinite(v) && v !== Number(e.hours)) set(e.id, { hours: v }); }}
                      className="w-14 bg-bg border border-transparent hover:border-border-hi focus:border-gold rounded-md px-1.5 py-1 text-right outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={e.source_tier}
                      onChange={(ev) => set(e.id, { source_tier: ev.target.value })}
                      className="bg-bg border rounded-md px-1.5 py-1 text-xs outline-none"
                      style={{ borderColor: tierByKey[e.source_tier]?.color, color: tierByKey[e.source_tier]?.color }}
                    >
                      {TIERS.map((t) => <option key={t.key} value={t.key} style={{ color: '#E8E8E8' }}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.reps_qualifying} onChange={(ev) => set(e.id, { reps_qualifying: ev.target.checked })} className="accent-strong" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.is_real_estate} onChange={(ev) => set(e.id, { is_real_estate: ev.target.checked })} className="accent-blue" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.needs_review} onChange={(ev) => set(e.id, { needs_review: ev.target.checked })} className="accent-gold" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove.mutate(e.id)} className="text-muted hover:text-danger text-xs">✕</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-muted">No entries match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
