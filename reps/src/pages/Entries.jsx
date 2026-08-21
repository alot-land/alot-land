import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEntries, updateEntry, deleteEntry, createEntry } from '../lib/queries';
import { REPS_CATEGORIES, TIERS, tierByKey } from '../lib/reps';
import { fmtH } from '../lib/stats';
import { serializeCsv, downloadText } from '../lib/csv';
import PageHeader from '../components/PageHeader.jsx';

const today = () => new Date().toISOString().slice(0, 10);

const COLS = {
  date: 'The calendar day the activity happened. Entries are always sorted by this date.',
  category: 'REPS category. Non-REPS and Coaching/Education are treated as non-qualifying.',
  description: 'What you did. The small grey line is the original evidence source.',
  hrs: 'Hours logged for this activity. Click to edit.',
  evidence: 'How well documented this is. Strong = emails/signings/contemporaneous logs; Medium = calendar; Weak = assumed pattern or estimate. Drives your defensible floor.',
  qual: 'Counts toward the 750-hour test. Turn off for education or non-real-estate work.',
  re: 'Real-estate trade/business activity. Non-RE work still counts in the 50%-test denominator.',
  rev: 'Flagged for your manual review — usually software/app/book building or ambiguous rows.',
};

export default function Entries() {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const { data: entries = [] } = useQuery({ queryKey: ['reps-entries'], queryFn: fetchEntries });

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [tier, setTier] = useState('all');
  const [reviewOnly, setReviewOnly] = useState(sp.get('filter') === 'review');
  const [year, setYear] = useState('2026');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reps-entries'] });
  const update = useMutation({ mutationFn: ({ id, patch }) => updateEntry(id, patch), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteEntry, onSuccess: invalidate });

  // ---- inline add-in-place ----
  const [addOpen, setAddOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(0);
  const BLANK = {
    entry_date: today(), category: 'Acquisitions & Underwriting', description: '',
    hours: '1', source_tier: 'strong', is_real_estate: true, reps_qualifying: true,
    needs_review: false, source_ref: '',
  };
  const [addForm, setAddForm] = useState(BLANK);
  const setA = (k, v) => setAddForm((p) => ({ ...p, [k]: v }));
  const openAddOn = (date) => { setAddForm({ ...BLANK, entry_date: date || today() }); setAddOpen(true); };

  const create = useMutation({
    mutationFn: () => createEntry({
      entry_date: addForm.entry_date,
      category: addForm.category,
      description: addForm.description.trim(),
      hours: parseFloat(addForm.hours) || 0,
      is_real_estate: addForm.is_real_estate,
      reps_qualifying: addForm.reps_qualifying,
      needs_review: addForm.needs_review,
      source_tier: addForm.source_tier,
      source_ref: addForm.source_ref.trim() || null,
    }),
    onSuccess: () => {
      invalidate();
      setJustAdded((n) => n + 1);
      setAddForm((p) => ({ ...p, description: '', hours: '1' })); // keep date/category for rapid entry
    },
  });

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return entries.filter((e) => {
      if (year !== 'all' && (e.entry_date || '').slice(0, 4) !== year) return false;
      if (cat !== 'all' && e.category !== cat) return false;
      if (tier !== 'all' && e.source_tier !== tier) return false;
      if (reviewOnly && !e.needs_review) return false;
      if (needle && !(`${e.description} ${e.source_ref || ''}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [entries, q, cat, tier, reviewOnly, year]);

  const totalHours = useMemo(() => fmtH(filtered.reduce((s, e) => s + Number(e.hours || 0), 0)), [filtered]);
  const qualHours = useMemo(() => fmtH(filtered.filter((e) => e.reps_qualifying).reduce((s, e) => s + Number(e.hours || 0), 0)), [filtered]);

  const set = (id, patch) => update.mutate({ id, patch });

  function exportCsv() {
    const head = ['Date', 'Category', 'Description', 'Hours', 'Real estate?', 'Qualifying?', 'Needs review?', 'Evidence tier', 'Source'];
    const records = filtered.map((e) => [
      e.entry_date, e.category, e.description, e.hours,
      e.is_real_estate ? 'yes' : 'no', e.reps_qualifying ? 'yes' : 'no',
      e.needs_review ? 'yes' : 'no', e.source_tier, e.source_ref || '',
    ]);
    downloadText(`reps-entries-${year}-${filtered.length}rows.csv`, serializeCsv(head, records));
  }

  return (
    <div className="pb-16">
      <PageHeader
        title="Entries"
        subtitle={`${filtered.length} shown · ${totalHours}h total · ${qualHours}h qualifying`}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => (addOpen ? setAddOpen(false) : openAddOn(today()))}
              title="Add a new entry. Set its date and it drops into the list in date order."
              className="rounded-xl bg-gold text-bg px-3 py-2 text-sm font-medium hover:brightness-110"
            >
              {addOpen ? 'Close' : '+ Add entry'}
            </button>
            <button
              onClick={exportCsv}
              title="Download the currently-filtered rows as a CSV (opens in Excel / Google Sheets)."
              className="rounded-xl bg-panel border border-border-hi px-3 py-2 text-sm text-muted hover:text-text"
            >
              Export CSV
            </button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        {/* Inline add form */}
        {addOpen && (
          <AddInline
            form={addForm} setA={setA}
            onSubmit={() => { if (addForm.description.trim() && parseFloat(addForm.hours) > 0) create.mutate(); }}
            pending={create.isPending} justAdded={justAdded}
          />
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description / source…"
            title="Filter by any text in the description or the source reference."
            className="flex-1 min-w-[200px] bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-gold"
          />
          <select value={year} onChange={(e) => setYear(e.target.value)} title="Filter by tax year." className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="all">All years</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} title="Filter by REPS category." className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="all">All categories</option>
            {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} title="Filter by evidence strength." className="bg-panel border border-border rounded-xl px-3 py-2 text-sm outline-none">
            <option value="all">All evidence</option>
            {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer px-2" title="Show only rows flagged for manual review.">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="accent-gold" />
            Needs review
          </label>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-panel overflow-x-auto md:overflow-visible">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <Th title={COLS.date}>Date</Th>
                <Th title={COLS.category}>Category</Th>
                <Th title={COLS.description}>Description</Th>
                <Th title={COLS.hrs} className="text-right">Hrs</Th>
                <Th title={COLS.evidence}>Evidence</Th>
                <Th title={COLS.qual} className="text-center">Qual.</Th>
                <Th title={COLS.re} className="text-center">RE</Th>
                <Th title={COLS.rev} className="text-center">Rev.</Th>
                <Th className="text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className={`border-b border-border/50 hover:bg-panel-2/40 group ${e.needs_review ? 'bg-gold/5' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted tabular-nums" title={e.entry_date}>{e.entry_date}</td>
                  <td className="px-3 py-2">
                    <select
                      value={e.category} title={COLS.category}
                      onChange={(ev) => set(e.id, { category: ev.target.value, is_real_estate: ev.target.value !== 'Non-REPS' && ev.target.value !== 'Coaching/Education' })}
                      className="bg-bg border border-border-hi rounded-md px-1.5 py-1 text-xs outline-none focus:border-gold max-w-[170px]"
                    >
                      {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 max-w-[320px]">
                    <div className="truncate" title={e.description}>{e.description}</div>
                    {e.source_ref && <div className="text-[10px] text-muted truncate" title={`Source: ${e.source_ref}`}>{e.source_ref}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <input
                      type="number" step="0.25" min="0" defaultValue={e.hours} title={COLS.hrs}
                      onBlur={(ev) => { const v = parseFloat(ev.target.value); if (Number.isFinite(v) && v !== Number(e.hours)) set(e.id, { hours: v }); }}
                      className="w-14 bg-bg border border-transparent hover:border-border-hi focus:border-gold rounded-md px-1.5 py-1 text-right outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={e.source_tier} title={COLS.evidence}
                      onChange={(ev) => set(e.id, { source_tier: ev.target.value })}
                      className="bg-bg border rounded-md px-1.5 py-1 text-xs outline-none"
                      style={{ borderColor: tierByKey[e.source_tier]?.color, color: tierByKey[e.source_tier]?.color }}
                    >
                      {TIERS.map((t) => <option key={t.key} value={t.key} style={{ color: '#E8E8E8' }}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.reps_qualifying} title={COLS.qual} onChange={(ev) => set(e.id, { reps_qualifying: ev.target.checked })} className="accent-strong" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.is_real_estate} title={COLS.re} onChange={(ev) => set(e.id, { is_real_estate: ev.target.checked })} className="accent-blue" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={!!e.needs_review} title={COLS.rev} onChange={(ev) => set(e.id, { needs_review: ev.target.checked })} className="accent-gold" />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openAddOn(e.entry_date)} title={`Add a new entry on ${e.entry_date}`} className="opacity-0 group-hover:opacity-100 text-muted hover:text-gold text-xs mr-2">+</button>
                    <button onClick={() => remove.mutate(e.id)} title="Delete this entry" className="text-muted hover:text-danger text-xs">✕</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-muted">No entries match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, title, className = '' }) {
  return (
    <th
      title={title}
      className={`px-3 py-2.5 font-medium sticky top-14 z-20 bg-panel border-b border-border ${title ? 'cursor-help' : ''} ${className}`}
    >
      {children}
    </th>
  );
}

const inp = 'w-full bg-bg border border-border-hi rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-gold';

function AddInline({ form, setA, onSubmit, pending, justAdded }) {
  const nonRe = form.category === 'Non-REPS' || form.category === 'Coaching/Education';
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="rounded-2xl border border-gold/40 bg-panel p-4"
      style={{ boxShadow: 'inset 4px 0 0 0 #F5B800' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-widest text-gold">Add entry</div>
        <div className="text-[11px] text-muted">Set the date to place it — it slots into the list in date order.</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <label className="col-span-1" title="The day this happened — determines where it lands in the list.">
          <span className="text-[10px] uppercase tracking-widest text-muted">Date</span>
          <input type="date" max={today()} value={form.entry_date} onChange={(e) => setA('entry_date', e.target.value)} className={inp} />
        </label>
        <label className="col-span-1" title="Hours logged.">
          <span className="text-[10px] uppercase tracking-widest text-muted">Hours</span>
          <input type="number" step="0.25" min="0" value={form.hours} onChange={(e) => setA('hours', e.target.value)} className={inp} />
        </label>
        <label className="col-span-2" title="REPS category.">
          <span className="text-[10px] uppercase tracking-widest text-muted">Category</span>
          <select value={form.category}
            onChange={(e) => { const v = e.target.value; const isNon = v === 'Non-REPS' || v === 'Coaching/Education'; setA('category', v); setA('is_real_estate', !isNon); setA('reps_qualifying', !isNon); }}
            className={inp}>
            {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="col-span-2" title="Evidence strength.">
          <span className="text-[10px] uppercase tracking-widest text-muted">Evidence</span>
          <select value={form.source_tier} onChange={(e) => setA('source_tier', e.target.value)} className={inp}>
            {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="col-span-2 md:col-span-4" title="What you did.">
          <span className="text-[10px] uppercase tracking-widest text-muted">Description</span>
          <input value={form.description} onChange={(e) => setA('description', e.target.value)} placeholder="What did you do?" className={inp} />
        </label>
        <label className="col-span-2" title="Where this came from (email thread, calendar, etc.).">
          <span className="text-[10px] uppercase tracking-widest text-muted">Source (optional)</span>
          <input value={form.source_ref} onChange={(e) => setA('source_ref', e.target.value)} placeholder="e.g. Email thread w/ Hannah" className={inp} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="Real-estate trade/business activity.">
          <input type="checkbox" checked={form.is_real_estate} onChange={(e) => setA('is_real_estate', e.target.checked)} className="accent-blue" /> Real estate
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="Counts toward the 750-hour test.">
          <input type="checkbox" checked={form.reps_qualifying} onChange={(e) => setA('reps_qualifying', e.target.checked)} className="accent-strong" /> Counts toward 750
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="Flag for later review.">
          <input type="checkbox" checked={form.needs_review} onChange={(e) => setA('needs_review', e.target.checked)} className="accent-gold" /> Needs review
        </label>
        {nonRe && <span className="text-[11px] text-muted">Non-qualifying — still counts in total-work for the 50% test.</span>}
        <button type="submit" disabled={pending || !form.description.trim()} className="ml-auto rounded-lg bg-gold text-bg px-4 py-1.5 text-sm font-medium disabled:opacity-50">
          {pending ? 'Adding…' : 'Add'}
        </button>
        {justAdded > 0 && <span className="text-strong text-xs">✓ {justAdded} added</span>}
      </div>
    </form>
  );
}
