import { useMemo, useState } from 'react';
import { formatClock, toPlainText } from '../../shared/formats.mjs';

/** Split a line on every case-insensitive match so matches can be marked. */
function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={index} className="rounded bg-gold/30 px-0.5 text-text">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export default function TranscriptView({ result, onSeek }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState('cues');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return result.segments;
    return result.segments.filter((segment) => segment.text.toLowerCase().includes(needle));
  }, [result.segments, query]);

  const prose = useMemo(() => toPlainText(result.segments), [result.segments]);
  const trimmedQuery = query.trim();

  return (
    <div className="card flex min-h-[24rem] flex-col">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this transcript"
          aria-label="Search this transcript"
          className="field flex-1 py-2 text-sm"
        />
        <div className="flex rounded-xl border border-border bg-panel-2 p-1">
          {[
            ['cues', 'Lines'],
            ['prose', 'Paragraphs'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === value ? 'bg-gold text-bg' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {trimmedQuery && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted">
          {matches.length.toLocaleString()} matching {matches.length === 1 ? 'line' : 'lines'}
          {view === 'prose' && ' — switch to Lines to jump to them'}
        </p>
      )}

      <div className="scroll-slim max-h-[70vh] flex-1 overflow-y-auto p-2 sm:p-4">
        {view === 'prose' ? (
          <div className="space-y-4 px-2 text-[15px] leading-relaxed text-text/90">
            {prose.split('\n\n').map((paragraph, index) => (
              <p key={index}>{highlight(paragraph, trimmedQuery)}</p>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">No lines match “{trimmedQuery}”.</p>
        ) : (
          <ol className="space-y-0.5">
            {matches.map((segment, index) => (
              <li key={`${segment.start}-${index}`}>
                <button
                  type="button"
                  onClick={() => onSeek?.(Math.floor(segment.start))}
                  className="group flex w-full gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2"
                  title="Jump to this moment"
                >
                  <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted transition group-hover:text-gold">
                    {formatClock(segment.start)}
                  </span>
                  <span className="text-[15px] leading-relaxed text-text/90">
                    {highlight(segment.text, trimmedQuery)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
