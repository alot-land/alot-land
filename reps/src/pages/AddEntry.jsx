import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntry } from '../lib/queries';
import { REPS_CATEGORIES, TIERS } from '../lib/reps';
import PageHeader from '../components/PageHeader.jsx';

const today = () => new Date().toISOString().slice(0, 10);

const BLANK = {
  entry_date: today(),
  category: 'Acquisitions & Underwriting',
  description: '',
  hours: '1',
  source_tier: 'strong',
  is_real_estate: true,
  reps_qualifying: true,
  needs_review: false,
  source_ref: '',
};

export default function AddEntry() {
  const qc = useQueryClient();
  const [f, setF] = useState(BLANK);
  const [saved, setSaved] = useState(false);

  const create = useMutation({
    mutationFn: () => createEntry({
      entry_date: f.entry_date,
      category: f.category,
      description: f.description.trim(),
      hours: parseFloat(f.hours) || 0,
      is_real_estate: f.is_real_estate,
      reps_qualifying: f.reps_qualifying,
      needs_review: f.needs_review,
      source_tier: f.source_tier,
      source_ref: f.source_ref.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reps-entries'] });
      setSaved(true);
      setF((p) => ({ ...BLANK, entry_date: p.entry_date, source_tier: p.source_tier }));
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const nonRe = f.category === 'Non-REPS' || f.category === 'Coaching/Education';

  return (
    <div className="pb-16">
      <PageHeader title="Add entry" subtitle="Log a new activity" />
      <div className="px-4 sm:px-8 py-4 sm:py-6 max-w-2xl">
        <form
          onSubmit={(e) => { e.preventDefault(); if (f.description.trim() && parseFloat(f.hours) > 0) create.mutate(); }}
          className="rounded-2xl border border-border bg-panel p-5 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Date">
              <input type="date" value={f.entry_date} max={today()} onChange={(e) => upd('entry_date', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Hours">
              <input type="number" step="0.25" min="0" value={f.hours} onChange={(e) => upd('hours', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Category">
            <select value={f.category}
              onChange={(e) => {
                const v = e.target.value;
                const isNon = v === 'Non-REPS' || v === 'Coaching/Education';
                setF((p) => ({ ...p, category: v, is_real_estate: !isNon, reps_qualifying: !isNon }));
              }}
              className={inputCls}>
              {REPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Description">
            <textarea value={f.description} onChange={(e) => upd('description', e.target.value)} rows={2}
              placeholder="What did you do?" className={`${inputCls} resize-y`} />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Evidence tier">
              <select value={f.source_tier} onChange={(e) => upd('source_tier', e.target.value)} className={inputCls}>
                {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>)}
              </select>
            </Field>
            <Field label="Source reference (optional)">
              <input value={f.source_ref} onChange={(e) => upd('source_ref', e.target.value)} placeholder="e.g. Email thread w/ Hannah" className={inputCls} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <Toggle label="Real-estate activity" checked={f.is_real_estate} onChange={(v) => upd('is_real_estate', v)} />
            <Toggle label="Counts toward 750" checked={f.reps_qualifying} onChange={(v) => upd('reps_qualifying', v)} />
            <Toggle label="Needs review" checked={f.needs_review} onChange={(v) => upd('needs_review', v)} />
          </div>

          {nonRe && (
            <div className="text-xs text-muted">
              This category is treated as non-qualifying (it still counts in your total-work hours for the 50% test).
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={create.isPending || !f.description.trim()}
              className="rounded-xl bg-gold text-bg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {create.isPending ? 'Saving…' : 'Add entry'}
            </button>
            {saved && <span className="text-strong text-sm">✓ Added</span>}
            {create.isError && <span className="text-danger text-sm">{create.error?.message}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls = 'mt-1 w-full bg-bg border border-border-hi rounded-lg px-3 py-2 text-sm outline-none focus:border-gold';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-muted">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-gold" />
      {label}
    </label>
  );
}
