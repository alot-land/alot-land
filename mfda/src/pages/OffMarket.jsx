import { Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lazyReload } from '../lib/lazyReload';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import {
  listParcels,
  listParcelCounties,
  listMailLists,
  createMailList,
  listParcelsForMailList,
  logMailExport,
  listAllRentBands,
  listMarkets,
  setParcelRating,
} from '../lib/queries';
import { buildZipRents, presetForState, screenRow, streetViewUrl, ownerEquity } from '../lib/parcelscreen';
import RatingControl from '../components/RatingControl';

const OffMarketMap = lazyReload(() => import('../components/OffMarketMap'));
import { freedomsoftCSV, downloadCSV } from '../lib/freedomsoft';
import { usd, pct } from '../lib/format';
import { Tip } from '../components/fields';

const VERDICT_STYLES = {
  pursue: 'bg-green/15 text-green-deep',
  consider: 'bg-gold/20 text-warn',
  pass: 'bg-surface-2 text-muted',
};
const VERDICT_RANK = { pursue: 0, consider: 1, pass: 2, insufficient: 3 };

// Friendly names for the counties we actually target; anything else shows FIPS.
const COUNTY_NAMES = {
  '04013': 'Maricopa, AZ',
  '04019': 'Pima, AZ',
  '04021': 'Pinal, AZ',
  '47037': 'Davidson, TN',
  '47157': 'Shelby, TN',
  '47065': 'Hamilton, TN',
  '47093': 'Knox, TN',
  '47135': 'Perry, TN',
};
const countyLabel = (fips) => COUNTY_NAMES[fips] || fips || '—';

export default function OffMarket() {
  const { org } = useOrg();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [state, setState] = useState('all');
  const [county, setCounty] = useState('all');
  const [minUnits, setMinUnits] = useState('');
  const [maxUnits, setMaxUnits] = useState('');
  const [absentee, setAbsentee] = useState(false);
  const [entity, setEntity] = useState(false);
  const [heldYears, setHeldYears] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [highEquity, setHighEquity] = useState(false);
  const [ratingFilter, setRatingFilter] = useState('all'); // all | heart | up | down | none
  const [verdictFilter, setVerdictFilter] = useState('all'); // all | pursue | consider | pass | insufficient
  const [sort, setSort] = useState('screen'); // screen | units | value
  const [view, setView] = useState('list'); // list | map
  const [mapSelectedId, setMapSelectedId] = useState(null);
  const nav = useNavigate();

  // "Held ≥ N years" → a last-sale-date cutoff computed at query time.
  const soldBefore = useMemo(() => {
    const n = Number(heldYears);
    if (!n || n <= 0) return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  }, [heldYears]);

  const filters = { state, countyFips: county, minUnits, maxUnits, absentee, entity, soldBefore, search, rating: ratingFilter };
  const parcels = useQuery({
    queryKey: ['parcels', org?.id, filters],
    queryFn: () => listParcels(org.id, filters),
    enabled: !!org,
    keepPreviousData: true,
  });
  const counties = useQuery({
    queryKey: ['parcel-counties', org?.id],
    queryFn: () => listParcelCounties(org.id),
    enabled: !!org,
  });
  const lists = useQuery({
    queryKey: ['mail-lists', org?.id],
    queryFn: () => listMailLists(org.id),
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

  // Every filtered parcel runs through the calc engine's fast screen —
  // estimated NOI, cap on county value, DSCR, verdict. Pure arithmetic,
  // microseconds per row.
  const rows = useMemo(() => {
    const raw = parcels.data?.rows || [];
    let scored = raw.map((p) => ({ ...p, screen: screenRow(p, zipRents, presetForState(markets.data, p.state)) }));
    if (verdictFilter !== 'all') scored = scored.filter((p) => p.screen.verdict === verdictFilter);
    if (highEquity) {
      scored = scored.filter((p) => {
        const eq = ownerEquity(p);
        return eq != null && eq.pct >= 0.5;
      });
    }
    const by = {
      screen: (a, b) =>
        VERDICT_RANK[a.screen.verdict] - VERDICT_RANK[b.screen.verdict] ||
        (b.screen.cap_rate ?? -1) - (a.screen.cap_rate ?? -1),
      units: (a, b) => (b.units ?? 0) - (a.units ?? 0),
      value: (a, b) => (b.assessed_value ?? 0) - (a.assessed_value ?? 0),
    };
    return [...scored].sort(by[sort] || by.screen);
  }, [parcels.data, zipRents, markets.data, sort, verdictFilter, highEquity]);
  const total = parcels.data?.count ?? 0;

  async function rate(p, rating) {
    qc.setQueryData(['parcels', org.id, filters], (old) =>
      old ? { ...old, rows: old.rows.map((r) => (r.id === p.id ? { ...r, rating } : r)) } : old,
    );
    try {
      await setParcelRating(p.id, rating);
    } catch {
      qc.invalidateQueries({ queryKey: ['parcels'] });
    }
  }
  const states = useMemo(
    () => [...new Set((counties.data || []).map((c) => c.state))].sort(),
    [counties.data],
  );
  const countyOptions = useMemo(
    () => (counties.data || []).filter((c) => state === 'all' || c.state === state),
    [counties.data, state],
  );

  function exportCSV(parcelRows, listName, listId) {
    const name = listName || `MFDA off-market ${new Date().toISOString().slice(0, 10)}`;
    downloadCSV(`${name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`, freedomsoftCSV(parcelRows, name));
    logMailExport(org.id, user.id, { listId, rowCount: parcelRows.length });
  }

  async function saveList() {
    const name = window.prompt('Name this mail list:', `Absentee MF ${new Date().toISOString().slice(0, 10)}`);
    if (!name) return;
    setSaving(true);
    try {
      await createMailList(org.id, user.id, {
        name,
        filters,
        parcelIds: rows.map((r) => r.id),
      });
      qc.invalidateQueries({ queryKey: ['mail-lists', org.id] });
    } finally {
      setSaving(false);
    }
  }

  async function exportSavedList(list) {
    const items = await listParcelsForMailList(list.id);
    exportCSV(items, list.name, list.id);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Off-market</h1>
          <p className="text-muted text-sm">
            County assessor parcels — filter to a target list, then export a FreedomSoft-ready CSV.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveList}
            disabled={!rows.length || saving}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as mail list'}
          </button>
          <button
            type="button"
            onClick={() => exportCSV(rows, null, null)}
            disabled={!rows.length}
            className="btn-gold text-sm disabled:opacity-50"
          >
            Export FreedomSoft CSV ({rows.length.toLocaleString()})
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input w-64"
          type="search"
          placeholder="Search owner, address, city, APN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={state} onChange={(e) => { setState(e.target.value); setCounty('all'); }}>
          <option value="all">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={county} onChange={(e) => setCounty(e.target.value)}>
          <option value="all">All counties</option>
          {countyOptions.map((c) => (
            <option key={c.county_fips} value={c.county_fips}>{countyLabel(c.county_fips)}</option>
          ))}
        </select>
        {[
          ['Min units', minUnits, setMinUnits, 'e.g. 3', 'Only parcels with at least this many units. Unit counts come from the assessor or the land-use class (DUPLEX=2…); apartments without a stated count are excluded when this is set.'],
          ['Max units', maxUnits, setMaxUnits, 'e.g. 20', 'Upper bound on units — keeps you in your 2–20 unit wheelhouse.'],
          ['Held ≥ years', heldYears, setHeldYears, 'e.g. 10', 'Owner\'s last recorded sale is at least this many years back. Long holds = equity + used-up depreciation — classic sellers. Needs sale dates in the county data.'],
        ].map(([label, value, set, ph, tip]) => (
          <label key={label} className="flex flex-col gap-0.5 text-xs text-muted">
            <span className="flex items-center">{label}<Tip text={tip} /></span>
            <input
              className="input w-28 text-sm"
              type="number"
              placeholder={ph}
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-ink-2 px-1">
          <input type="checkbox" checked={absentee} onChange={(e) => setAbsentee(e.target.checked)} />
          Absentee
          <Tip text="Owner's mailing address differs from the property address — they don't live there. The classic motivated-seller signal for direct mail." />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-2 px-1">
          <input type="checkbox" checked={entity} onChange={(e) => setEntity(e.target.checked)} />
          Entity-owned
          <Tip text="Owner name looks like an LLC / corp / trust. These are investors, not homeowners — different mail copy, and principals can be looked up via the Secretary of State." />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-2 px-1">
          <input type="checkbox" checked={highEquity} onChange={(e) => setHighEquity(e.target.checked)} />
          💰 High equity
          <Tip text="County value at least double what the owner paid (50%+ equity). These owners can sell you a discount or carry financing and still profit — the raw material of the equity-capture strategy. Needs a recorded sale price; owners with no sale on record are excluded even though many have huge equity too." />
        </label>
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
          <option value="screen">Best screen first</option>
          <option value="units">Most units first</option>
          <option value="value">Highest value first</option>
        </select>
      </div>

      {/* Live feedback — there's no Search button; results follow the filters. */}
      {parcels.data && (
        <div className="text-sm text-ink-2 mb-3">
          <span className="font-semibold tabular-nums">{rows.length.toLocaleString()}</span> parcels match
          {parcels.isFetching && <span className="text-muted"> · updating…</span>}
          <span className="text-muted"> — results update as you type; no search button needed.</span>
        </div>
      )}

      {parcels.isLoading && <div className="text-muted">Loading…</div>}
      {parcels.error && <div className="text-danger text-sm">{String(parcels.error.message)}</div>}

      {parcels.data && total === 0 && (search || state !== 'all' || absentee || entity || minUnits || maxUnits || heldYears) && (
        <div className="card p-8 text-center">
          <p className="font-medium">0 parcels match these filters</p>
          <p className="text-muted text-sm mt-2 max-w-lg mx-auto">
            Loosen one filter at a time to see which is excluding everything. Two common causes:
            “Min units” drops apartment parcels whose county file doesn’t state a unit count, and
            “Held ≥ years” drops parcels whose file lacks a sale date.
          </p>
        </div>
      )}

      {parcels.data && total === 0 && !search && state === 'all' && !absentee && !entity && !minUnits && (
        <div className="card p-10 text-center">
          <p className="font-medium">No parcels imported yet</p>
          <p className="text-muted text-sm mt-2 max-w-lg mx-auto">
            Download a county assessor file, then from the repo run{' '}
            <code className="text-xs">cd workers/scan && node bin/assessor.mjs --source maricopa --file parcels.csv --inspect</code>{' '}
            to check the column mapping, and re-run without <code className="text-xs">--inspect</code> to import.
            See <code className="text-xs">workers/scan/README.md</code> § Off-market imports.
          </p>
        </div>
      )}

      {rows.length > 0 && view === 'map' && (
        <Suspense fallback={<div className="card p-10 text-center text-muted">Loading map…</div>}>
          <OffMarketMap
            rows={rows}
            selected={rows.find((p) => p.id === mapSelectedId) || null}
            onSelect={(p) => setMapSelectedId(p?.id ?? null)}
            onOpen={(p) => nav(`/off-market/${p.id}`)}
          />
        </Suspense>
      )}

      {rows.length > 0 && view === 'list' && (
        <div className="card overflow-x-auto">
          <div className="px-3 py-2 text-xs text-muted border-b border-border">
            {rows.length.toLocaleString()} parcels match
            {total > 10000 && ' (server cap 10,000 reached — tighten filters for full coverage)'}
          </div>
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-surface-2">
              <tr>
                <th className="th w-8"></th>
                <th className="th">Owner</th>
                <th className="th">Property</th>
                <th className="th">
                  Screen
                  <Tip text="Every parcel runs through the deal engine on the fly: rent from the Zillow zip band × units, expenses at standard rates, value from the county appraisal. Pursue = clears your DSCR and cap-rate bars at county value. Click the row for the full report." />
                </th>
                <th className="th text-right">Est. NOI</th>
                <th className="th text-right">Cap</th>
                <th className="th text-right">Units</th>
                <th className="th text-right">Last sale</th>
                <th className="th text-right">Assessed</th>
                <th className="th">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((p) => (
                <tr
                  key={p.id}
                  onClick={() => nav(`/off-market/${p.id}`)}
                  className="hover:bg-surface-2/60 cursor-pointer"
                >
                  <td className="td">
                    <RatingControl value={p.rating} onChange={(r) => rate(p, r)} size="text-sm" />
                  </td>
                  <td className="td">
                    <div className="font-medium">{p.owner_name || '—'}</div>
                    <div className="text-xs text-muted">APN {p.apn}</div>
                  </td>
                  <td className="td">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMapSelectedId(p.id);
                        setView('map');
                      }}
                      className="text-left hover:underline"
                      title="Show on map"
                    >
                      {p.situs_address || '—'}
                    </button>
                    <div className="text-xs text-muted">
                      {[p.situs_city, p.state, p.situs_zip].filter(Boolean).join(', ')}
                      {streetViewUrl(p) && (
                        <>
                          {' · '}
                          <a
                            href={streetViewUrl(p)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="underline hover:text-ink"
                          >
                            Street View ↗
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    {p.screen.verdict === 'insufficient' ? (
                      <span className="pill bg-surface-2 text-muted" title={`missing: ${p.screen.missing.join(', ')}`}>
                        needs data
                      </span>
                    ) : (
                      <span className={`pill ${VERDICT_STYLES[p.screen.verdict]} capitalize`}>{p.screen.verdict}</span>
                    )}
                  </td>
                  <td className="td text-right tabular-nums">{p.screen.noi != null ? usd(p.screen.noi) : '—'}</td>
                  <td className="td text-right tabular-nums">{p.screen.cap_rate != null ? pct(p.screen.cap_rate, 1) : '—'}</td>
                  <td className="td text-right">{p.units ?? '—'}</td>
                  <td className="td text-right">
                    {p.last_sale_date ? (
                      <>
                        <div>{p.last_sale_price ? usd(Number(p.last_sale_price)) : '—'}</div>
                        <div className="text-xs text-muted">{p.last_sale_date}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td text-right">{p.assessed_value ? usd(Number(p.assessed_value)) : '—'}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {p.absentee && <span className="pill bg-gold/20 text-warn">absentee</span>}
                      {p.owner_is_entity && <span className="pill bg-blue/15 text-blue">entity</span>}
                      {(() => {
                        const eq = ownerEquity(p);
                        return eq && eq.pct >= 0.5 ? (
                          <span
                            className="pill bg-green/15 text-green-deep"
                            title={`Owner paid ${usd(Number(p.last_sale_price))}; county values it at ${usd(Number(p.assessed_value))} — ≈${usd(eq.dollars)} equity. Room to sell you a discount or carry financing and still win.`}
                          >
                            💰 {Math.round(eq.pct * 100)}% equity
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && (
            <p className="text-xs text-muted px-3 py-2 border-t border-border">
              Table shows the first 200 rows; Export includes all {rows.length.toLocaleString()} matches.
            </p>
          )}
        </div>
      )}

      {(lists.data || []).length > 0 && (
        <div className="card mt-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-medium">
            Saved mail lists
            <Tip text="A frozen snapshot of parcels at save time — re-exporting a saved list gives the same rows even after new imports. Exports are logged for campaign history." />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="th">Name</th>
                <th className="th text-right">Parcels</th>
                <th className="th text-right">Created</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {lists.data.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2/60">
                  <td className="td font-medium">{l.name}</td>
                  <td className="td text-right">{l.mail_list_items?.[0]?.count ?? '—'}</td>
                  <td className="td text-right text-muted">{new Date(l.created_at).toLocaleDateString()}</td>
                  <td className="td text-right">
                    <button type="button" onClick={() => exportSavedList(l)} className="btn-ghost text-sm py-1">
                      Export CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
