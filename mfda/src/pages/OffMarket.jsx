import { useMemo, useState } from 'react';
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
} from '../lib/queries';
import { freedomsoftCSV, downloadCSV } from '../lib/freedomsoft';
import { usd } from '../lib/format';
import { Tip } from '../components/fields';

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

  // "Held ≥ N years" → a last-sale-date cutoff computed at query time.
  const soldBefore = useMemo(() => {
    const n = Number(heldYears);
    if (!n || n <= 0) return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  }, [heldYears]);

  const filters = { state, countyFips: county, minUnits, maxUnits, absentee, entity, soldBefore, search };
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

  const rows = parcels.data?.rows || [];
  const total = parcels.data?.count ?? 0;
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
        <input className="input w-24" type="number" placeholder="Min units" value={minUnits} onChange={(e) => setMinUnits(e.target.value)} />
        <input className="input w-24" type="number" placeholder="Max units" value={maxUnits} onChange={(e) => setMaxUnits(e.target.value)} />
        <input className="input w-28" type="number" placeholder="Held ≥ yrs" value={heldYears} onChange={(e) => setHeldYears(e.target.value)} />
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
      </div>

      {parcels.isLoading && <div className="text-muted">Loading…</div>}
      {parcels.error && <div className="text-danger text-sm">{String(parcels.error.message)}</div>}

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

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-3 py-2 text-xs text-muted border-b border-border">
            {total.toLocaleString()} parcels match
            {total > rows.length && ` (showing first ${rows.length.toLocaleString()} — tighten filters to export the rest)`}
          </div>
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-surface-2">
              <tr>
                <th className="th">Owner</th>
                <th className="th">Property</th>
                <th className="th">Mails to</th>
                <th className="th text-right">Units</th>
                <th className="th text-right">Year</th>
                <th className="th text-right">Last sale</th>
                <th className="th text-right">Assessed</th>
                <th className="th">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((p) => (
                <tr key={p.id} className="hover:bg-surface-2/60">
                  <td className="td">
                    <div className="font-medium">{p.owner_name || '—'}</div>
                    <div className="text-xs text-muted">APN {p.apn}</div>
                  </td>
                  <td className="td">
                    <div>{p.situs_address || '—'}</div>
                    <div className="text-xs text-muted">
                      {[p.situs_city, p.state, p.situs_zip].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td className="td text-xs text-ink-2">
                    <div>{p.mailing_address || '—'}</div>
                    <div className="text-muted">
                      {[p.mailing_city, p.mailing_state, p.mailing_zip].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td className="td text-right">{p.units ?? '—'}</td>
                  <td className="td text-right">{p.year_built ?? '—'}</td>
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
