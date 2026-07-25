import { useQuery } from '@tanstack/react-query';
import { getRentBands } from '../lib/queries';
import { usd } from '../lib/format';

const SOURCE_LABELS = {
  zori: 'Zillow ZORI (blended, all sizes)',
  // Bedroom SHAPE only — the app uses the RATIOS between these, never the
  // level, which is a policy figure rather than market rent.
  'hud-safmr': 'HUD Small Area FMR (bedroom shape)',
  acs: 'Census ACS',
};
const CONF = { high: 'bg-green/15 text-green-deep', med: 'bg-gold/20 text-warn', low: 'bg-surface-2 text-muted' };

/**
 * Market rent reference for the deal's ZIP — provenance-first (Rule #3):
 * every number shows its source, period, and confidence. Informs the operator;
 * never auto-writes rents (unit-mix rents stay operator-entered).
 */
export default function RentBandsCard({ orgId, zip }) {
  const bands = useQuery({
    queryKey: ['rentbands', orgId, zip],
    queryFn: () => getRentBands(orgId, zip),
    enabled: !!orgId && !!zip && zip.length >= 5,
  });

  if (!zip || zip.length < 5) return null;
  if (bands.isLoading) return <div className="bg-surface-2 rounded-xl p-3 text-sm text-muted">Loading rent bands…</div>;

  const rows = bands.data || [];
  if (!rows.length) {
    return (
      <div className="bg-surface-2 rounded-xl p-3 text-sm text-muted">
        No rent bands for ZIP {zip} yet — run{' '}
        <code className="text-xs">node bin/rents.mjs</code> in <code className="text-xs">workers/scan</code>{' '}
        to import Zillow ZORI (monthly refresh).
      </div>
    );
  }

  // Latest period per (source, bedrooms).
  const latest = new Map();
  for (const r of rows) {
    const k = `${r.source}:${r.bedrooms}`;
    const prev = latest.get(k);
    if (!prev || r.period > prev.period) latest.set(k, r);
  }
  const show = [...latest.values()].sort((a, b) =>
    a.source === b.source ? a.bedrooms - b.bedrooms : a.source.localeCompare(b.source),
  );

  return (
    <div className="bg-surface-2 rounded-xl p-4">
      <div className="label mb-2">Market rent reference · ZIP {zip}</div>
      <div className="flex flex-wrap gap-4">
        {show.map((r) => (
          <div key={`${r.source}:${r.bedrooms}`} className="text-sm">
            <div className="font-medium tabular-nums text-lg">
              {usd(Number(r.rent))}<span className="text-xs text-muted">/mo</span>
            </div>
            <div className="text-xs text-muted">
              {r.bedrooms >= 0 ? `${r.bedrooms}BR · ` : ''}
              {SOURCE_LABELS[r.source] || r.source} · {r.period}{' '}
              <span className={`pill ${CONF[r.confidence] || ''}`}>{r.confidence}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">
        Reference only — ZORI blends all unit sizes; smaller units typically sit below it, larger above.
        Enter per-unit rents in the mix; your numbers are what get underwritten.
      </p>
    </div>
  );
}
