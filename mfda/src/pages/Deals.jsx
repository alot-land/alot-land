import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { listDeals, listAllRentBands, listMarkets, deleteDeals } from '../lib/queries';
import { buildZipRents, presetForState, dealMonthlyNet } from '../lib/parcelscreen';
import { usd } from '../lib/format';
import { Tip } from '../components/fields';
import HeartButton from '../components/HeartButton';

const STATUS_STYLES = {
  lead: 'bg-surface-2 text-ink-2',
  analyzing: 'bg-blue/15 text-blue',
  pursue: 'bg-green/15 text-green-deep',
  contract: 'bg-gold/20 text-warn',
  passed: 'bg-surface-2 text-muted',
  closed: 'bg-green/15 text-green-deep',
};

const MISSING_LABELS = {
  units: 'unit count',
  market_rent_monthly: 'a rent band for this ZIP',
  price_anchor: 'a price',
};

/** Monthly net cash flow — underwritten when a scenario exists, else screened. */
function NetCell({ net }) {
  if (!net || net.monthly == null) {
    const missing = (net?.missing || []).map((m) => MISSING_LABELS[m] || m);
    return (
      <span className="text-muted" title={missing.length ? `Needs ${missing.join(' and ')} to estimate` : 'Not enough data to estimate'}>
        —
      </span>
    );
  }
  const tone = net.monthly >= 0 ? 'text-green-deep' : 'text-danger';
  if (net.basis === 'underwritten') {
    return (
      <span className={`font-medium ${tone}`} title={`From the latest saved scenario${net.calc_version ? ` (mf-calc v${net.calc_version})` : ''} — cash flow before taxes ÷ 12`}>
        {usd(net.monthly)}
      </span>
    );
  }
  return (
    <span
      className={`italic ${tone} opacity-80`}
      title={`Estimate — no scenario saved yet. Zip-band rent${net.rent ? ` of ${usd(net.rent)}/unit` : ''} × units, standard expenses, 75% LTV at the asking price. Underwrite to replace it.`}
    >
      {usd(net.monthly)} <span className="text-muted not-italic text-xs">est</span>
    </span>
  );
}

export default function Deals() {
  const { org } = useOrg();
  const deals = useQuery({ queryKey: ['deals', org?.id], queryFn: () => listDeals(org.id), enabled: !!org });
  const bands = useQuery({
    queryKey: ['rent-bands-all', org?.id],
    queryFn: () => listAllRentBands(org.id),
    enabled: !!org,
    staleTime: 30 * 60 * 1000,
  });
  const markets = useQuery({ queryKey: ['markets', org?.id], queryFn: () => listMarkets(org.id), enabled: !!org });
  const zipRents = useMemo(() => buildZipRents(bands.data), [bands.data]);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [heartedOnly, setHeartedOnly] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState(null);
  const rows = useMemo(() => {
    let r = (deals.data || []).map((d) => ({
      ...d,
      net: dealMonthlyNet(d, zipRents, presetForState(markets.data, d.state)),
    }));
    if (heartedOnly) r = r.filter((d) => d.favorite);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((d) =>
        [d.address, d.city, d.zip, d.state].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    // Hearted deals float to the top; recency ordering within each group.
    return [...r].sort((a, b) => Number(b.favorite || 0) - Number(a.favorite || 0));
  }, [deals.data, search, heartedOnly, zipRents, markets.data]);
  const heartedCount = useMemo(() => (deals.data || []).filter((d) => d.favorite).length, [deals.data]);

  // Only ever act on rows that are actually on screen — deleting something
  // filtered out of view would be a nasty surprise.
  const visibleIds = useMemo(() => rows.map((d) => d.id), [rows]);
  const selectedVisible = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  function toggleRow(id) {
    setConfirmDelete(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setConfirmDelete(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function runDelete() {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteDeals(org.id, selectedVisible);
      setSelected(new Set());
      setConfirmDelete(false);
      // Goals read committed deals, so refresh those too.
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['goal-deals'] });
    } catch (e) {
      setDelError(e.message || String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Deals</h1>
          <p className="text-muted text-sm">Underwrite, compare scenarios, and pursue the good ones.</p>
        </div>
        <Link to="/deals/new" className="btn-gold">+ New deal</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input w-64"
          type="search"
          placeholder="Search address, city, ZIP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setHeartedOnly((v) => !v)}
          className={`px-3 py-2 rounded-lg border text-sm ${
            heartedOnly ? 'bg-[#C0392B] text-white border-[#C0392B]' : 'bg-surface text-ink-2 border-border hover:bg-surface-2'
          }`}
        >
          ♥ Hearted{heartedCount ? ` (${heartedCount})` : ''}
        </button>

        {selectedVisible.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted">{selectedVisible.length} selected</span>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  onClick={runDelete}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg border border-danger bg-danger text-white text-sm disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : `Yes, delete ${selectedVisible.length} permanently`}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost text-sm">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 rounded-lg border border-danger text-danger text-sm hover:bg-danger/10"
              >
                Delete selected
              </button>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <p className="text-xs text-warn mb-3">
          This removes the {selectedVisible.length === 1 ? 'deal' : `${selectedVisible.length} deals`} along with
          every saved scenario, unit mix, and note attached to {selectedVisible.length === 1 ? 'it' : 'them'}. It
          cannot be undone. Off-market parcels and on-market listings are untouched — a deleted deal can be
          re-analyzed from its source.
        </p>
      )}
      {delError && <p className="text-sm text-danger mb-3">{delError}</p>}

      {deals.isLoading && <div className="text-muted">Loading…</div>}
      {deals.error && <div className="text-danger text-sm">{String(deals.error.message)}</div>}

      {deals.data && deals.data.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium">No deals yet</p>
          <p className="text-muted text-sm mt-1">Enter your first deal to see it underwritten against real data.</p>
          <Link to="/deals/new" className="btn-gold mt-4 inline-flex">+ New deal</Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="th w-8 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label={allVisibleSelected ? 'Clear selection' : 'Select all shown'}
                    title={allVisibleSelected ? 'Clear selection' : 'Select all shown'}
                  />
                </th>
                <th className="th w-10"></th>
                <th className="th">Property</th>
                <th className="th">Market</th>
                <th className="th text-right">Units</th>
                <th className="th text-right">Price</th>
                <th className="th text-right whitespace-nowrap">
                  Net / mo
                  <Tip text="Monthly cash flow after debt service, before income tax (CFBT ÷ 12). Solid figures come from the deal's latest saved scenario — your own rents, expenses and financing. Italic 'est' figures have no scenario yet, so they screen like an off-market parcel: zip-band rent × units, standard expense rates, 75% LTV. Underwrite the deal to replace the estimate." />
                </th>
                <th className="th">Status</th>
                <th className="th">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className={`hover:bg-surface-2/60 ${selected.has(d.id) ? 'bg-danger/5' : ''}`}>
                  <td className="td w-8 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleRow(d.id)}
                      aria-label={`Select ${d.address || 'deal'}`}
                    />
                  </td>
                  <td className="td w-10 text-center">
                    <HeartButton deal={d} />
                  </td>
                  <td className="td">
                    <Link to={`/deals/${d.id}`} className="font-medium hover:underline">
                      {d.address || 'Untitled deal'}
                    </Link>
                  </td>
                  <td className="td text-ink-2">{[d.city, d.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="td text-right">{d.units_count ?? '—'}</td>
                  <td className="td text-right">{d.price != null ? usd(Number(d.price)) : '—'}</td>
                  <td className="td text-right whitespace-nowrap tabular-nums">
                    <NetCell net={d.net} />
                  </td>
                  <td className="td">
                    <span className={`pill ${STATUS_STYLES[d.status] || 'bg-surface-2'}`}>{d.status}</span>
                  </td>
                  <td className="td text-muted text-xs">{new Date(d.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
