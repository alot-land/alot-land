import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseRepsCsv } from '../lib/csv';
import { rowsToEntries, importEntries } from '../lib/queries';
import { fmtH } from '../lib/stats';
import PageHeader from '../components/PageHeader.jsx';

export default function Import() {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [mode, setMode] = useState('replace');
  const [result, setResult] = useState(null);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const raw = parseRepsCsv(text);
      const entries = rowsToEntries(raw);
      const byTier = { strong: 0, medium: 0, weak: 0 };
      let hours = 0, qual = 0, review = 0;
      for (const e of entries) {
        byTier[e.source_tier] += e.hours;
        hours += e.hours;
        if (e.reps_qualifying) qual += e.hours;
        if (e.needs_review) review++;
      }
      return { count: entries.length, hours, qual, review, byTier, entries };
    } catch (err) {
      return { error: err.message };
    }
  }, [text]);

  const run = useMutation({
    mutationFn: () => importEntries(preview.entries, mode),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['reps-entries'] });
    },
  });

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  }

  return (
    <div className="pb-16">
      <PageHeader title="Import" subtitle="Load or refresh your log from CSV" />
      <div className="px-4 sm:px-8 py-4 sm:py-6 max-w-3xl space-y-4">
        <div className="rounded-2xl border border-border bg-panel p-5 space-y-3">
          <div className="text-sm text-muted">
            Paste your CSV (columns: <span className="text-text">Date, Day, Activity Category, Description, Hours, Source</span>)
            or upload a file. Each row is auto-classified — you can retag everything on the Entries page afterward.
          </div>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={8}
            placeholder="Date,Day,Activity Category,Description,Hours,Source&#10;05/28/2026,Thu,Property Closing,Closed on Sugar Tree Vista...,8.0,Email thread"
            className="w-full bg-bg border border-border-hi rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-gold"
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted">
              <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" id="csvfile" />
              <span className="cursor-pointer rounded-lg bg-panel-2 border border-border-hi px-3 py-1.5 hover:text-text inline-block" onClick={() => document.getElementById('csvfile').click()}>
                Choose file…
              </span>
            </label>
            {text && <button onClick={() => { setText(''); setResult(null); }} className="text-xs text-muted hover:text-text">clear</button>}
          </div>
        </div>

        {preview?.error && <div className="text-sm text-danger">Parse error: {preview.error}</div>}

        {preview && !preview.error && (
          <div className="rounded-2xl border border-border bg-panel p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-widest text-muted">Preview</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Rows" value={preview.count} />
              <Stat label="Total hours" value={`${fmtH(preview.hours)}h`} />
              <Stat label="Qualifying" value={`${fmtH(preview.qual)}h`} />
              <Stat label="Flagged for review" value={preview.review} />
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-strong">Strong {fmtH(preview.byTier.strong)}h</span>
              <span className="text-gold">Medium {fmtH(preview.byTier.medium)}h</span>
              <span className="text-weak">Weak {fmtH(preview.byTier.weak)}h</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-gold" />
                Replace all my entries
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === 'append'} onChange={() => setMode('append')} className="accent-gold" />
                Append (skip duplicates)
              </label>
              <button
                onClick={() => run.mutate()} disabled={run.isPending || !preview.count}
                className="ml-auto rounded-xl bg-gold text-bg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {run.isPending ? 'Importing…' : mode === 'replace' ? 'Replace & import' : 'Append & import'}
              </button>
            </div>
            {mode === 'replace' && (
              <div className="text-[11px] text-danger">This deletes your current REPS entries and loads this CSV fresh.</div>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-2xl border border-strong/40 bg-strong/5 p-4 text-sm">
            <span className="text-strong font-medium">✓ Imported {result.inserted} entries</span>
            {result.skipped ? <span className="text-muted"> · {result.skipped} duplicates skipped</span> : null}
            <span className="text-muted"> — head to the Dashboard.</span>
          </div>
        )}

        {run.isError && <div className="text-sm text-danger">Import failed: {run.error?.message}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-panel-2 border border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-xl mt-0.5">{value}</div>
    </div>
  );
}
