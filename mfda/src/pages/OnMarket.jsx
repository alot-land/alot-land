import { Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import {
  listOnMarket,
  setDealStatus,
  setDealRating,
  latestScanRun,
  listAllRentBands,
  listMarkets,
  listParcelValueIndex,
} from '../lib/queries';
import {
  buildZipRents,
  presetForState,
  screenListingRow,
  buildParcelValueMap,
  listingEquity,
} from '../lib/parcelscreen';
import RatingControl from '../components/RatingControl';
import { Tip } from '../components/fields';
import { usd, pct } from '../lib/format';

import { lazyReload } from '../lib/lazyReload';

const VERDICT_STYLES = {
  pursue: 'bg-green/15 text-green-deep',
  consider: 'bg-gold/20 text-warn',
  pass: 'bg-surface-2 text-muted',
};
const VERDICT_RANK = { pursue: 0, consider: 1, pass: 2, insufficient: 3 };

// Leaflet map is only needed when the map view is opened — keep it lazy.
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
  const [ratingFilter, setRatingFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState('all');

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
  const bands = useQuery({
    queryKey: ['rent-bands-all', org?.id],
    queryFn: () => listAllRentBands(org.id),
    enabled: !!org,
    staleTime: 30 * 60 * 1000,
  });
  const markets = useQuery({
    queryKey: ['markets', org?.id],
    queryFn: () => listMarkets(org.id),
    enabled: !!org,
  });
  const zipRents = useMemo(() => buildZipRents(bands.data), [bands.data]);
  const parcelValues = useQuery({
    queryKey: ['parcel-value-index', org?.id],
    queryFn: () => listParcelValueIndex(org.id),
    enabled: !!org,
    staleTime: 30 * 60 * 1000,
  });
  const valueMap = useMemo(() => buildParcelValueMap(parcelValues.data), [parcelValues.data]);

  const rows = useMemo(() => {
    let r = (leads.data || []).map((d) => ({
      ...d,
      screen: screenListingRow(d, zipRents, presetForState(markets.data, d.state)),
      equity: listingEquity(d, valueMap),
    }));
    if (ratingFilter !== 'all') {
      r = ratingFilter === 'none' ? r.filter((d) => !d.rating) : r.filter((d) => d.rating === ratingFilter);
    }
    if (verdictFilter !== 'all') r = r.filter((d) => d.screen.verdict === verdictFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((d) =>
        [d.address, d.city, d.zip, d.mls_number].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (state !== 'all') r = r.filter((d) => d.state === state);
    if (bucket !== 'all') r = r.filter((d) => d.unit_bucket === bucket);
    if (maxPrice) r = r.filter((d) => d.price != null && Number(d.price) <= Number(maxPrice));
    const by = {
      newest: (a, b) => new Date(b.scanned_at || 0) - new Date(a.scanned_at || 0),
      screen: (a, b) =>
        VERDICT_RANK[a.screen.verdict] - VERDICT_RANK[b.screen.verdict] ||
        (b.screen.cap_rate ?? -1) - (a.screen.cap_rate ?? -1),
      price_asc: (a, b) => Number(a.price) - Number(b.price),
      price_desc: (a, b) => Number(b.price) - Number(a.price),
      dom: (a, b) => (b.days_on_market ?? 0) - (a.days_on_market ?? 0),
      year: (a, b) => (b.year_built ?? 0) - (a.year_built ?? 0),
      equity: (a, b) => (b.equity?.dollars ?? -1e15) - (a.equity?.dollars ?? -1e15),
    };
    return [...r].sort(by[sort] || by.newest);
  }, [leads.data, zipRents, markets.data, valueMap, search, state, bucket, maxPrice, sort, ratingFilter, verdictFilter]);

  async function rate(deal, rating) {
    qc.setQueryData(['onmarket', org.id], (old) =>
      old?.map?.((d) => (d.id === deal.id ? { ...d, rating } : d)),
    );
    try {
      await setDealRating(deal.id, rating);
    } catch {
      qc.invalidateQueries({ queryKey: ['onmarket', org.id] });
    }
  }

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
        <select className="input w-auto" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
          <option value="all">Any rating</option>
          <option value="heart">♥ Hearted</option>
          <option value="up">👍 Thumbs up</option>
          <option value="down">👎 Thumbs down</option>
          <option value="none">Unrated</option>
        </select>
        <select className="input w-auto" value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)}>
          <option value="all">Any screen</option>
          <option value="pursue">Pursue only</option>
          <option value="consider">Consider only</option>
          <option value="pass">Pass only</option>
          <option value="insufficient">Needs data</option>
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest scan</option>
          <option value="screen">Best screen first</option>
          <option value="equity">Most equity first</option>
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
                <th className="th w-20"></th>
                <th className="th w-16"></th>
                <th className="th">Property</th>
                <th className="th">
                  Screen
                  <Tip text="Each listing runs through the deal engine at its ASKING price: rent from the Zillow zip band, standard expenses. 2–4 unit listings screen with a 3-unit assumption (Redfin doesn't say exactly); 5+ shows 'needs data' until you underwrite with real units. A compass for what to open first, not an underwrite." />
                </th>
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
                  <td className="td w-20">
                    <RatingControl value={d.rating} onChange={(r) => rate(d, r)} size="text-sm" />
                  </td>
                  <td className="td w-16">
                    {d.photo_url ? (
                      <img src={d.photo_url} alt="" loading="lazy" className="w-14 h-11 object-cover rounded-lg border border-border" />
                    ) : (
                      <div className="w-14 h-11 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-muted text-xs">—</div>
                    )}
                  </td>
                  <td className="td">
                    <div className="font-medium">
                      {d.address}
                      {d.equity && d.equity.pct >= 0.08 && (
                        <span
                          className="pill bg-green/15 text-green-deep ml-2 text-xs"
                          title={`County appraisal ${usd(Number(d.price) + d.equity.dollars)} vs asking ${usd(Number(d.price))} — walk-in equity if the appraisal holds. Verify with comps before counting it.`}
                        >
                          💰 ≈{Math.round(d.equity.pct * 100)}% under value
                        </span>
                      )}
                    </div>
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
                    {d.screen.verdict === 'insufficient' ? (
                      <span className="pill bg-surface-2 text-muted" title={`missing: ${d.screen.missing.join(', ')}`}>
                        needs data
                      </span>
                    ) : (
                      <span
                        className={`pill ${VERDICT_STYLES[d.screen.verdict]} capitalize`}
                        title={`est. NOI ${usd(d.screen.noi)} · cap ${pct(d.screen.cap_rate, 1)} at asking (3-unit assumption)`}
                      >
                        {d.screen.verdict}
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <span className="pill bg-surface-2 text-ink-2">{d.unit_bucket} units</span>
                  </td>
                  <td className="td text-right font-medium">{d.price != null ? usd(Number(d.price)) : '—'}</td>
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
