import { NumberInput, TextInput } from './fields';

const BLANK = { type: '', count: 1, sqft: null, actual_rent: null, market_rent: null, provenance:'operator assumption' };

export default function UnitMixEditor({ units, onChange }) {
  function update(i, patch) {
    onChange(units.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  }
  function add() {
    onChange([...units, { ...BLANK }]);
  }
  function remove(i) {
    onChange(units.filter((_, j) => j !== i));
  }

  const totalUnits = units.reduce((a, u) => a + (Number(u.count) || 0), 0);
  const monthlyMarket = units.reduce((a, u) => a + (Number(u.count) || 0) * (Number(u.market_rent) || 0), 0);
  const monthlyActual = units.reduce((a, u) => a + (Number(u.count) || 0) * (Number(u.actual_rent) || 0), 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr>
              <th className="th">Unit type</th>
              <th className="th w-20">Count</th>
              <th className="th w-24">Sqft</th>
              <th className="th w-32">Actual rent</th>
              <th className="th w-32">Market rent</th>
              <th className="th w-8"></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={i}>
                <td className="td border-0 pt-2">
                  <TextInput value={u.type} onChange={(v) => update(i, { type: v })} placeholder="2BR/1BA" />
                  <div className="text-xs text-muted mt-1">{u.provenance || 'Unverified unit assumptions'}</div>
                </td>
                <td className="td border-0 pt-2">
                  <NumberInput value={u.count} onChange={(v) => update(i, { count: v })} min="0" />
                </td>
                <td className="td border-0 pt-2">
                  <NumberInput value={u.sqft} onChange={(v) => update(i, { sqft: v })} min="0" />
                </td>
                <td className="td border-0 pt-2">
                  <NumberInput value={u.actual_rent} onChange={(v) => update(i, { actual_rent: v })} min="0" suffix="/mo" />
                </td>
                <td className="td border-0 pt-2">
                  <NumberInput value={u.market_rent} onChange={(v) => update(i, { market_rent: v })} min="0" suffix="/mo" />
                </td>
                <td className="td border-0 pt-2 text-center">
                  <button type="button" onClick={() => remove(i)} className="text-danger hover:opacity-70" title="Remove">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3">
        <button type="button" onClick={add} className="btn-ghost text-sm">
          + Add unit type
        </button>
        <div className="text-xs text-muted">
          <span className="text-ink font-medium">{totalUnits}</span> units ·{' '}
          <span className="text-ink font-medium">{units.length && units.every(u=>u.actual_rent!=null) ? `$${monthlyActual.toLocaleString()}` : 'Unknown'}</span> actual /{' '}
          <span className="text-ink font-medium">{units.length && units.every(u=>u.market_rent!=null) ? `$${monthlyMarket.toLocaleString()}` : 'Unknown'}</span> market /mo
        </div>
      </div>
    </div>
  );
}
