import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchEntries } from '../lib/queries';
import { computeStats, fmtH } from '../lib/stats';
import { TIERS } from '../lib/reps';
import { serializeCsv, downloadText } from '../lib/csv';
import PageHeader from '../components/PageHeader.jsx';

export default function Dashboard() {
  const [year, setYear] = useState(2026);
  const { data: entries = [], isLoading } = useQuery({ queryKey: ['reps-entries'], queryFn: fetchEntries });

  const years = useMemo(() => {
    const set = new Set(entries.map((e) => (e.entry_date || '').slice(0, 4)).filter(Boolean));
    set.add('2026');
    return [...set].sort().reverse();
  }, [entries]);

  const stats = useMemo(() => computeStats(entries, year), [entries, year]);

  function exportSummary() {
    const rows = [];
    rows.push(['REPS SUMMARY', `Tax year ${year}`]);
    rows.push([]);
    rows.push(['Evidence tier', 'Qualifying RE hours', 'Total work hours', 'RE share %', 'Meets 750?', 'Meets >50%?']);
    for (const t of stats.tiers) {
      rows.push([t.label, fmtH(t.qualifyingHours), fmtH(t.totalWorkHours), t.pct50.toFixed(1) + '%', t.meets750 ? 'YES' : 'no', t.meets50 ? 'YES' : 'no']);
    }
    rows.push([]);
    rows.push(['Category', 'Total hours', 'Qualifying hours', 'Strong', 'Medium', 'Weak']);
    for (const c of stats.byCategory) {
      rows.push([c.category, fmtH(c.hours), fmtH(c.qualifyingHours), fmtH(c.strong), fmtH(c.medium), fmtH(c.weak)]);
    }
    downloadText(`reps-summary-${year}.csv`, serializeCsv([], rows));
  }

  function exportEntries() {
    const yr = entries.filter((e) => (e.entry_date || '').slice(0, 4) === String(year));
    const head = ['Date', 'Category', 'Description', 'Hours', 'Real estate?', 'Qualifying?', 'Needs review?', 'Source tier', 'Source'];
    const records = yr.map((e) => [
      e.entry_date, e.category, e.description, e.hours,
      e.is_real_estate ? 'yes' : 'no', e.reps_qualifying ? 'yes' : 'no',
      e.needs_review ? 'yes' : 'no', e.source_tier, e.source_ref || '',
    ]);
    downloadText(`reps-entries-${year}.csv`, serializeCsv(head, records));
  }

  return (
    <div className="pb-16">
      <PageHeader
        title="REPS Summary"
        subtitle="Real Estate Professional hours"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-gold"
            >
              {years.map((y) => <option key={y} value={y}>Tax year {y}</option>)}
            </select>
            <button onClick={exportSummary} className="rounded-xl bg-panel border border-border-hi px-3 py-2 text-sm text-muted hover:text-text">Export summary</button>
            <button onClick={exportEntries} className="rounded-xl bg-gold text-bg px-3 py-2 text-sm font-medium hover:brightness-110">Export entries</button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5">
        {isLoading ? (
          <div className="text-muted">Loading…</div>
        ) : stats.count === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-hi p-10 text-center">
            <div className="text-muted mb-3">No entries for {year} yet.</div>
            <Link to="/import" className="inline-block rounded-xl bg-gold text-bg px-4 py-2 text-sm font-medium">Import your CSV →</Link>
          </div>
        ) : (
          <>
            {/* Alerts */}
            {(stats.reviewCount > 0 || stats.bigDays.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-3">
                {stats.reviewCount > 0 && (
                  <Link to="/entries?filter=review" className="rounded-2xl border border-gold/40 bg-gold/5 p-4 flex items-center gap-3 hover:bg-gold/10 transition">
                    <span className="text-gold text-lg">⚑</span>
                    <div className="text-sm">
                      <span className="text-gold font-medium">{stats.reviewCount} entries flagged for review</span>
                      <div className="text-muted text-xs">Software builds, coaching, and ambiguous rows — tap to review & retag.</div>
                    </div>
                  </Link>
                )}
                {stats.bigDays.length > 0 && (
                  <div className="rounded-2xl border border-danger/40 bg-danger/5 p-4">
                    <div className="text-sm text-danger font-medium">{stats.bigDays.length} day(s) over 10 logged hours</div>
                    <div className="text-xs text-muted mt-1">
                      {stats.bigDays.slice(0, 5).map((d) => `${d.date} (${fmtH(d.hours)}h)`).join(' · ')}
                      {stats.bigDays.length > 5 ? ' …' : ''} — check for double-counts.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Three-tier totals */}
            <div className="grid md:grid-cols-3 gap-4">
              {stats.tiers.map((t, i) => (
                <TierCard key={t.key} tier={t} emphasize={i === 0} />
              ))}
            </div>

            {/* Context strip */}
            <div className="grid sm:grid-cols-3 gap-3">
              <MiniStat label="Total hours logged" value={`${fmtH(stats.totalHours)}h`} />
              <MiniStat label="Real-estate hours" value={`${fmtH(stats.reHours)}h`} />
              <MiniStat label="Non-real-estate hours" value={`${fmtH(stats.nonReHours)}h`} />
            </div>

            {/* Category breakdown */}
            <section className="rounded-2xl border border-border bg-panel p-5">
              <div className="text-[11px] uppercase tracking-widest text-muted mb-4">Hours by category (with evidence mix)</div>
              <div className="space-y-2.5">
                {stats.byCategory.map((c) => {
                  const max = stats.byCategory[0]?.hours || 1;
                  return (
                    <div key={c.category} className="flex items-center gap-3">
                      <div className="w-44 shrink-0 text-sm truncate">{c.category}</div>
                      <div className="flex-1 h-4 rounded bg-bg overflow-hidden flex" title={`${fmtH(c.hours)}h`}>
                        <Seg h={c.strong} max={max} color="#3CB054" />
                        <Seg h={c.medium} max={max} color="#F5B800" />
                        <Seg h={c.weak} max={max} color="#B08A4A" />
                      </div>
                      <div className="w-16 text-right text-sm tabular-nums">{fmtH(c.hours)}h</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center gap-4 text-[11px] text-muted">
                {TIERS.map((t) => (
                  <span key={t.key} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />{t.label}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function TierCard({ tier, emphasize }) {
  const goal = 750;
  const progress = Math.min(100, (tier.qualifyingHours / goal) * 100);
  return (
    <div
      className={`rounded-2xl border bg-panel p-5 ${emphasize ? 'border-strong/50' : 'border-border'}`}
      style={emphasize ? { boxShadow: 'inset 4px 0 0 0 #3CB054' } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-muted">{tier.label}</div>
        {emphasize && <span className="text-[10px] uppercase tracking-widest text-strong">Defensible floor</span>}
      </div>
      <div className="mt-2 font-display text-4xl">
        {fmtH(tier.qualifyingHours)}<span className="text-lg text-muted">h</span>
      </div>
      <div className="text-xs text-muted">qualifying RE hours toward 750</div>

      <div className="mt-3 h-2 rounded-full bg-bg overflow-hidden">
        <div className="h-2 rounded-full" style={{ width: `${progress}%`, background: tier.meets750 ? '#3CB054' : '#F5B800' }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className={tier.meets750 ? 'text-strong' : 'text-muted'}>
          {tier.meets750 ? '✓ 750-hour test met' : `${fmtH(750 - tier.qualifyingHours)}h to 750`}
        </span>
      </div>

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">RE share (50% test)</div>
          <div className="font-display text-2xl mt-0.5" style={{ color: tier.meets50 ? '#3CB054' : '#E5484D' }}>
            {tier.pct50.toFixed(0)}%
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          {fmtH(tier.qualifyingHours)} / {fmtH(tier.totalWorkHours)}h
          <div className={tier.meets50 ? 'text-strong' : 'text-danger'}>{tier.meets50 ? '✓ over 50%' : 'under 50%'}</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}

function Seg({ h, max, color }) {
  if (!h) return null;
  return <div style={{ width: `${(h / max) * 100}%`, background: color }} />;
}
