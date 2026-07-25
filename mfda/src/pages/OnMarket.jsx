import { Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { listOnMarket, setDealStatus, latestScanRun } from '../lib/queries';
import { usd } from '../lib/format';

import { lazyReload } from '../lib/lazyReload';

// maplibre is heavy — load it only when the map view is opened.
const ListingsMap = lazyReload(() => import('../components/ListingsMap'));

const LSTATUS = {
  active: 'bg-green/15 text-green-deep',
  pending: 'bg-gold/20 text-warn',
  comingsoon: 'bg-blue/15 text-blue',
};

export default function OnMarket() {
  const { org } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState('all');
  const [bucket, setBucket] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState('list'); // 'list' | 'map'

  const leads = useQuery({
    queryKey: ['onmarket', org?.id],
    queryFn: () => listOnMarket(org.id),
    enabled: !!org,
  });
  const scan = useQuery({
    queryKey: ['scanrun', org?.id],
    queryFn: () => latestScanRun(org.id),
    enabled: !!org,
  });

  const rows = useMemo(() => {
    let r = leads.data || [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((d) =>
        [d.address, d.city, d.zip, d.mls_number].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (state !== 'all') r = r.filter((d) => d.state === state);
    if (bucket !== 'all') r = r.filter((d) => d.unit_bucket === bucket);
    if (maxPrice) r = r.filter((d) => Number(d.price) <= Number(maxPrice));
    const by = {
      newest: (a, b) => new Date(b.scanned_at || 0) - new Date(a.scanned_at || 0),
      price_asc: (a, b) => Number(a.price) - Number(b.price),
      price_desc: (a, b) => Number(b.price) - Number(a.price),
      dom: (a, b) => (b.days_on_market ?? 0) - (a.days_on_market ?? 0),
      year: (a, b) => (b.year_built ?? 0) - (a.year_built ?? 0),
    };
    return [...r].sort(by[sort] || by.newest);
  }, [leads.data, search, state, bucket, maxPrice, sort]);

  const states = useMemo(
    () => [...new Set((leads.data || []).map((d) => d.state).filter(Boolean))].sort(),
    [leads.data],
  );

  async function analyze(deal) {
    await setDealStatus(deal.id, 'analyzing');
    qc.invalidateQueries({ queryKey: ['onmarket', org.id] });
    qc.invalidateQueries({ queryKey: ['deals', org.id] });
    nav(`/deals/${deal.id}/edit`);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">On-market</h1>
          <p className="text-muted text-sm">
            Scraped lead queue — hit Analyze to pull one into underwriting.
          </p>
        </div>
        {scan.data && (
          <div className="text-xs text-muted text-right">
            Last scan: {scan.data.market} · {new Date(scan.data.started_at).toLocaleString()} ·{' '}
            {scan.data.ok ? `${scan.data.rows_active} active / ${scan.data.rows_sold} sold` : scan.data.blocked ? 'BLOCKED' : 'failed'}
            {scan.data.capped_bands > 0 && ` · ${scan.data.capped_bands} capped bands (partial coverage)`}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="input w-64"
          type="search"
          placeholder="Search address, city, ZIP, MLS#…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="all">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="all">All sizes</option>
          <option value="2-4">2–4 units</option>
          <option value="5+">5+ units</option>
        </select>
        <input
          className="input w-36"
          type="number"
          placeholder="Max price"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
        <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
          {['list', 'map'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-2 text-sm capitalize ${view === v ? 'bg-ink text-bg' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest scan</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="dom">Days on market</option>
          <option value="year">Year built</option>
        </select>
      </div>

      {leads.isLoading && <div className="text-muted">Loading…</div>}
      {leads.error && <div className="text-danger text-sm">{String(leads.error.message)}</div>}

      {leads.data && leads.data.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium">No on-market leads yet</p>
          <p className="text-muted text-sm mt-2 max-w-md mx-auto">
            Run the scanner to fill this queue — from the repo:{' '}
            <code className="text-xs">cd workers/scan && npm install && npm run scan -- --market phoenix --status both</code>{' '}
            (see <code className="text-xs">workers/scan/README.md</code> for the one-time env setup).
          </p>
        </div>
      )}

      {rows.length > 0 && view === 'map' && (
        <Suspense fallback={<div className="card p-10 text-center text-muted">Loading map…</div>}>
          <ListingsMap rows={rows} onAnalyze={analyze} />
        </Suspense>
      )}

      {rows.length > 0 && view === 'list' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-surface-2">
              <tr>
                <th className="th w-16"></th>
                <th className="th">Property</th>
                <th className="th">Size</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">Beds*</th>
                <th className="th text-right">Year</th>
                <th className="th text-right">DOM</th>
                <th className="th">Status</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2/60">
                  <td className="td w-16">
                    {d.photo_url ? (
                      <img src={d.photo_url} alt="" loading="lazy" className="w-14 h-11 object-cover rounded-lg border border-border" />
                    ) : (
                      <div className="w-14 h-11 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-muted text-xs">—</div>
                    )}
                  </td>
                  <td className="td">
                    <div className="font-medium">{d.address}</div>
                    <div className="text-xs text-muted">
                      {[d.city, d.state, d.zip].filter(Boolean).join(', ')}
                      {d.listing_url && (
                        <>
                          {' · '}
                          <a href={d.listing_url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                            Redfin ↗
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <span className="pill bg-surface-2 text-ink-2">{d.unit_bucket} units</span>
                  </td>
                  <td className="td text-right font-medium">{usd(Number(d.price))}</td>
                  <td className="td text-right">{d.beds_total ?? '—'}</td>
                  <td className="td text-right">{d.year_built ?? '—'}</td>
                  <td className="td text-right">{d.days_on_market ?? '—'}</td>
                  <td className="td">
                    <span className={`pill ${LSTATUS[d.listing_status] || 'bg-surface-2 text-muted'}`}>
                      {d.listing_status || '—'}
                    </span>
                  </td>
                  <td className="td text-right">
                    <button onClick={() => analyze(d)} className="btn-gold text-sm py-1">
                      Analyze
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted px-3 py-2 border-t border-border">
            *Beds is the building total from Redfin, not per-unit. Redfin doesn’t expose unit counts —
            “5+” can be anything from 5 to 200 units; verify before underwriting.
          </p>
        </div>
      )}
    </div>
  );
}
