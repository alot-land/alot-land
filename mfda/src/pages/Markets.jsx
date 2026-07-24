import { Suspense, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { listMarketStats, listTargetGeoIds, addMarketTarget } from '../lib/queries';
import { usd, pct, num } from '../lib/format';
import { Tip } from '../components/fields';
import { lazyReload } from '../lib/lazyReload';
import {
  computeMarketMetrics,
  scoreMarkets,
  bboxPolygon,
  CALC_VERSION,
} from '@alot/mf-calc';

const MarketsMap = lazyReload(() => import('../components/MarketsMap'));

const PROFILES = [
  ['cashflow', 'Cash flow'],
  ['balanced', 'Balanced'],
  ['appreciation', 'Appreciation'],
];

const fmtPct = (v, dp = 1) => (v == null ? '—' : pct(v, dp));

export default function Markets() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const [profile, setProfile] = useState('balanced');
  const [state, setState] = useState('all');
  const [minPop, setMinPop] = useState('25000');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  const stats = useQuery({
    queryKey: ['market-stats', org?.id],
    queryFn: () => listMarketStats(org.id),
    enabled: !!org,
    staleTime: 10 * 60 * 1000,
  });
  const targets = useQuery({
    queryKey: ['target-geoids', org?.id],
    queryFn: () => listTargetGeoIds(org.id),
    enabled: !!org,
  });

  // All math happens in mf-calc; this component only filters and displays.
  const scored = useMemo(() => {
    if (!stats.data?.length) return [];
    const metrics = stats.data.map(computeMarketMetrics);
    return scoreMarkets(metrics, profile);
  }, [stats.data, profile]);

  const rows = useMemo(() => {
    let r = scored;
    if (state !== 'all') r = r.filter((m) => m.state === state);
    if (Number(minPop) > 0) r = r.filter((m) => (m.population ?? 0) >= Number(minPop));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((m) => `${m.name} ${m.state}`.toLowerCase().includes(q));
    }
    return r;
  }, [scored, state, minPop, search]);

  const states = useMemo(() => [...new Set(scored.map((m) => m.state))].sort(), [scored]);
  const selected = rows.find((m) => m.geo_id === selectedId) || null;
  const retrievedAt = stats.data?.[0]?.retrieved_at;

  async function addTarget(m) {
    if (m.lat == null || m.lng == null || !m.land_sqmi) return;
    setAdding(true);
    try {
      const raw = stats.data.find((s) => s.geo_id === m.geo_id);
      await addMarketTarget(org.id, {
        state: m.state,
        county: m.name,
        name: `${m.name}, ${m.state}`,
        geo_id: m.geo_id,
        poly: bboxPolygon(m.lat, m.lng, raw?.land_sqmi ?? m.land_sqmi ?? 100),
        property_tax_rate: m.tax_rate ?? undefined,
        appreciation_rate: m.appr_5y != null ? Math.min(Math.max(m.appr_5y, 0), 0.08) : undefined,
      });
      qc.invalidateQueries({ queryKey: ['target-geoids', org.id] });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Markets</h1>
          <p className="text-muted text-sm">
            Every US county ranked for multifamily investing — pick a lens, find a pocket, add it to
            your scans.
            <Tip text="Scores are national percentiles of free public data (Zillow values/rents, Census, FEMA risk), weighted by the selected profile and computed by the tested calc engine. It ranks MARKETS, not buildings — home-price data is a proxy. Use it to point the scanner, then underwrite real listings." />
          </p>
        </div>
        {retrievedAt && (
          <div className="text-xs text-muted">
            data {new Date(retrievedAt).toLocaleDateString()} · calc v{CALC_VERSION}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {PROFILES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setProfile(key)}
              className={`px-3 py-2 text-sm ${profile === key ? 'bg-ink text-white' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Tip text="Cash flow leans on gross rental yield (annual rent ÷ home value), taxes, and vacancy. Appreciation leans on 5-year value growth and population growth. Balanced blends both. Rankings reorder instantly — same data, different lens." />
        <input
          className="input w-56"
          type="search"
          placeholder="Search county or state…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="all">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          Min population
          <input className="input w-28" type="number" value={minPop} onChange={(e) => setMinPop(e.target.value)} />
          <Tip text="Tiny counties produce noisy statistics (a handful of sales can swing everything). 25,000+ keeps rankings meaningful; drop it to explore rural markets." />
        </label>
      </div>

      {stats.isLoading && <div className="text-muted">Loading…</div>}
      {stats.error && <div className="text-danger text-sm">{String(stats.error.message)}</div>}

      {stats.data && stats.data.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium">No market data yet</p>
          <p className="text-muted text-sm mt-2 max-w-md mx-auto">
            The droplet pulls national data (Zillow, Census, FEMA) automatically with the next
            morning scan. To load it now, run{' '}
            <code className="text-xs">node bin/usmarkets.mjs</code> from{' '}
            <code className="text-xs">workers/scan</code> on a machine with the scanner env.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <Suspense fallback={<div className="card p-10 text-center text-muted">Loading map…</div>}>
            <MarketsMap markets={rows} selectedId={selectedId} onSelect={(m) => setSelectedId(m.geo_id)} />
          </Suspense>

          {selected && (
            <div className="card mt-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-semibold">
                    {selected.name}, {selected.state}
                    <span className="pill bg-surface-2 text-ink-2 ml-2 align-middle">
                      score {Math.round(selected.score)}
                    </span>
                    {selected.coverage < 0.85 && (
                      <span className="pill bg-gold/20 text-warn ml-1 align-middle">
                        thin data ({Math.round(selected.coverage * 100)}%)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    pop {selected.population ? num(selected.population) : '—'} · home value{' '}
                    {selected.zhvi ? usd(selected.zhvi) : '—'} · rent{' '}
                    {selected.zori ? `${usd(selected.zori)}/mo` : '—'}
                  </div>
                </div>
                {targets.data?.has(selected.geo_id) ? (
                  <span className="pill bg-green/15 text-green-deep">✓ in your scan targets</span>
                ) : (
                  <button
                    type="button"
                    disabled={adding || selected.lat == null}
                    onClick={() => addTarget(selected)}
                    className="btn-gold text-sm disabled:opacity-50"
                  >
                    {adding ? 'Adding…' : 'Add to targets'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-3 text-sm">
                {[
                  ['Gross yield', fmtPct(selected.gross_yield), 'Annual rent ÷ home value — the cash-flow proxy. Above ~7% usually pencils; below 5% rarely does.'],
                  ['Appreciation 5y', fmtPct(selected.appr_5y), 'Compound annual home-value growth over the last 5 years (Zillow ZHVI).'],
                  ['Rent growth 5y', fmtPct(selected.rent_growth_5y), 'Compound annual rent growth (Zillow ZORI).'],
                  ['Pop growth 5y', fmtPct(selected.pop_growth_5y), 'Compound annual population growth (Census). People = renters.'],
                  ['Tax rate', fmtPct(selected.tax_rate), 'Effective property tax: median taxes paid ÷ median home value (Census).'],
                  ['Rental vacancy', fmtPct(selected.rental_vacancy), 'Vacant-for-rent units ÷ rental stock. High vacancy = soft demand.'],
                  ['Renter share', fmtPct(selected.renter_share, 0), 'Share of households renting. More renters = deeper tenant pool.'],
                  ['Hazard risk', selected.nri_rating || (selected.nri_score != null ? selected.nri_score.toFixed(0) : '—'), "FEMA National Risk Index — natural-hazard exposure and expected losses. Drives insurance cost and climate risk."],
                ].map(([label, value, tip]) => (
                  <div key={label}>
                    <div className="text-xs text-muted flex items-center">
                      {label}
                      <Tip text={tip} />
                    </div>
                    <div className="font-medium tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card mt-4 overflow-x-auto">
            <div className="px-3 py-2 text-xs text-muted border-b border-border">
              Top {Math.min(rows.length, 100)} of {rows.length} counties under the “
              {PROFILES.find(([k]) => k === profile)?.[1]}” lens
            </div>
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-surface-2">
                <tr>
                  <th className="th text-right">#</th>
                  <th className="th">County</th>
                  <th className="th text-right">Score</th>
                  <th className="th text-right">Yield</th>
                  <th className="th text-right">Appr 5y</th>
                  <th className="th text-right">Rents 5y</th>
                  <th className="th text-right">Pop 5y</th>
                  <th className="th text-right">Tax</th>
                  <th className="th text-right">Home value</th>
                  <th className="th">Risk</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((m, i) => (
                  <tr
                    key={m.geo_id}
                    onClick={() => setSelectedId(m.geo_id)}
                    className={`cursor-pointer hover:bg-surface-2/60 ${m.geo_id === selectedId ? 'bg-surface-2' : ''}`}
                  >
                    <td className="td text-right text-muted">{i + 1}</td>
                    <td className="td font-medium">
                      {m.name}, {m.state}
                      {targets.data?.has(m.geo_id) && <span className="pill bg-green/15 text-green-deep ml-2">target</span>}
                    </td>
                    <td className="td text-right font-semibold tabular-nums">{Math.round(m.score)}</td>
                    <td className="td text-right tabular-nums">{fmtPct(m.gross_yield)}</td>
                    <td className="td text-right tabular-nums">{fmtPct(m.appr_5y)}</td>
                    <td className="td text-right tabular-nums">{fmtPct(m.rent_growth_5y)}</td>
                    <td className="td text-right tabular-nums">{fmtPct(m.pop_growth_5y)}</td>
                    <td className="td text-right tabular-nums">{fmtPct(m.tax_rate)}</td>
                    <td className="td text-right tabular-nums">{m.zhvi ? usd(m.zhvi) : '—'}</td>
                    <td className="td text-xs text-ink-2">{m.nri_rating || '—'}</td>
                    <td className="td text-right">
                      {!targets.data?.has(m.geo_id) && m.lat != null && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTarget(m);
                          }}
                          className="btn-ghost text-xs py-1"
                        >
                          + Target
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted px-3 py-2 border-t border-border">
              Scores are national percentiles under the selected lens; a market missing a metric is
              scored on what it has (flagged “thin data”). Home-value and rent series are all-homes
              proxies — this page finds markets, the underwriting pages price buildings.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
