import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filterNearby, compsStats } from '@alot/mf-calc';
import { listCompsForState } from '../lib/queries';
import { usd, num } from '../lib/format';

/**
 * Auto-comps from the scanned sold-comps store. All statistics come from
 * mf-calc (filterNearby/compsStats) — this component only fetches rows and
 * renders. With coordinates it filters by radius; WITHOUT coordinates
 * (off-market or manually-entered deals) it falls back to statewide comps so
 * the valuation section still fills. Values with a ≥3 sample auto-fill the
 * empty inputs on load and stay fully overridable (flagged comps-derived in
 * provenance).
 */
export default function CompsAssist({ orgId, state, lat, lng, unitBucket, values, onUse }) {
  const hasCoords = lat != null && lng != null;
  const [radius, setRadius] = useState(3);
  const [bucket, setBucket] = useState(unitBucket || 'all');

  const comps = useQuery({
    queryKey: ['comps', orgId, state],
    queryFn: () => listCompsForState(orgId, state),
    enabled: !!orgId && !!state,
  });

  const { pool, stats, scope } = useMemo(() => {
    if (!comps.data) return { pool: [], stats: null, scope: null };
    let p = comps.data;
    if (bucket !== 'all') p = p.filter((c) => c.unit_bucket === bucket);
    if (hasCoords) {
      const near = filterNearby(p, { lat, lng }, radius);
      return { pool: near, stats: compsStats(near), scope: `within ${radius} mi` };
    }
    return { pool: p, stats: compsStats(p), scope: `${state} statewide` };
  }, [comps.data, hasCoords, lat, lng, radius, bucket, state]);

  // Auto-fill empty valuation inputs once, when the sample is trustworthy.
  const filledRef = useRef(false);
  useEffect(() => {
    if (filledRef.current || !stats || stats.count === 0) return;
    const patch = {};
    const empty = (v) => v == null || v === '' || Number(v) === 0;
    if (empty(values?.price_per_bed) && stats.median_per_bed != null && stats.per_bed_sample >= 3) {
      patch.price_per_bed = Math.round(stats.median_per_bed);
    }
    if (empty(values?.price_per_sqft) && stats.median_per_sqft != null && stats.per_sqft_sample >= 3) {
      patch.price_per_sqft = Math.round(stats.median_per_sqft);
    }
    if (Object.keys(patch).length) {
      filledRef.current = true;
      onUse(patch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  return (
    <div className="bg-surface-2 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="label mb-0">Sold comps {scope ? `· ${scope}` : ''}</span>
        {hasCoords && (
          <select className="input w-auto py-1 text-sm ml-auto" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            <option value={1}>1 mi</option>
            <option value={3}>3 mi</option>
            <option value={5}>5 mi</option>
            <option value={10}>10 mi</option>
          </select>
        )}
        <select className={`input w-auto py-1 text-sm ${hasCoords ? '' : 'ml-auto'}`} value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="all">All MF</option>
          <option value="2-4">2–4 unit</option>
          <option value="5+">5+ unit</option>
        </select>
      </div>

      {!hasCoords && (
        <p className="text-xs text-muted mb-3">
          No coordinates on this deal, so comps are statewide rather than nearby — a rougher guide.
          Scraped on-market deals filter by radius automatically.
        </p>
      )}

      {comps.isLoading && <div className="text-sm text-muted">Loading comps…</div>}
      {stats && stats.count === 0 && (
        <div className="text-sm text-muted">
          No sold comps {hasCoords ? `in ${radius} mi` : `in ${state}`} yet — the scanner fills these as it runs.
        </div>
      )}

      {stats && stats.count > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
            <div>
              <div className="text-xs text-muted">Comps</div>
              <div className="font-medium tabular-nums">{stats.count}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Median price</div>
              <div className="font-medium tabular-nums">{usd(stats.median_price)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">$/bed <span className="opacity-70">(n={stats.per_bed_sample})</span></div>
              <div className="font-medium tabular-nums">{stats.median_per_bed != null ? usd(stats.median_per_bed) : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">$/sqft <span className="opacity-70">(n={stats.per_sqft_sample})</span></div>
              <div className="font-medium tabular-nums">{stats.median_per_sqft != null ? `$${num(stats.median_per_sqft)}` : '—'}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stats.median_per_bed != null && stats.per_bed_sample >= 3 && (
              <button type="button" className="btn-ghost text-xs py-1" onClick={() => onUse({ price_per_bed: Math.round(stats.median_per_bed) })}>
                Use ${num(Math.round(stats.median_per_bed))}/bed
              </button>
            )}
            {stats.median_per_sqft != null && stats.per_sqft_sample >= 3 && (
              <button type="button" className="btn-ghost text-xs py-1" onClick={() => onUse({ price_per_sqft: Math.round(stats.median_per_sqft) })}>
                Use ${num(Math.round(stats.median_per_sqft))}/sqft
              </button>
            )}
            {stats.per_bed_sample >= 3 || stats.per_sqft_sample >= 3 ? (
              <span className="text-xs text-muted">≥3-sample values auto-filled above — override anytime.</span>
            ) : (
              <span className="text-xs text-muted">Samples too thin to auto-fill (need ≥3) — use judgment or widen the pool.</span>
            )}
          </div>
          <details className="mt-3">
            <summary className="text-xs text-muted cursor-pointer">Show {Math.min(pool.length, 10)} {hasCoords ? 'nearest' : 'recent'}</summary>
            <ul className="mt-2 space-y-1 text-xs text-ink-2">
              {pool.slice(0, 10).map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {c.url ? <a className="underline" href={c.url} target="_blank" rel="noreferrer">{c.address}</a> : c.address}
                    , {c.city} · {c.unit_bucket}u{c.beds_total ? ` · ${c.beds_total}bd` : ''}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">
                    {usd(c.price)}{c.distance_miles != null ? ` · ${c.distance_miles.toFixed(1)}mi` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
