import { useCallback, useEffect, useRef, useState } from 'react';
import SearchForm from './components/SearchForm.jsx';
import VideoPanel from './components/VideoPanel.jsx';
import LanguagePicker from './components/LanguagePicker.jsx';
import ExportBar from './components/ExportBar.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { fetchTranscript } from './lib/api.js';

const HISTORY_KEY = 'yt-transcripts:recent';
const HISTORY_LIMIT = 8;

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Friendly nudge for the error codes a user can actually do something about. */
function errorHint(code) {
  switch (code) {
    case 'NO_CAPTIONS':
      return 'Nothing to pull here — the uploader never added captions and YouTube has not auto-generated any.';
    case 'UNAVAILABLE':
      return 'Private, deleted, or region-locked videos cannot be read.';
    case 'RATE_LIMITED':
      return 'Wait a minute, then try again.';
    case 'FETCH_FAILED':
      return 'This is usually temporary — retrying often works.';
    default:
      return null;
  }
}

export default function App() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [lastInput, setLastInput] = useState('');

  const seekRef = useRef(null);
  const requestRef = useRef(null);

  const handlePlayerReady = useCallback((seek) => {
    seekRef.current = seek;
  }, []);

  const run = useCallback(async (input, options = {}) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setBusy(true);
    setError(null);
    setLastInput(input);

    try {
      const data = await fetchTranscript(input, { ...options, signal: controller.signal });
      setResult(data);
      setHistory((previous) => {
        const next = [
          { videoId: data.videoId, title: data.title, author: data.author },
          ...previous.filter((entry) => entry.videoId !== data.videoId),
        ].slice(0, HISTORY_LIMIT);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          // Private mode or a full quota — history is a nicety, not a feature.
        }
        return next;
      });
    } catch (caught) {
      if (caught.name === 'AbortError') return;
      setError({ message: caught.message, code: caught.code });
      setResult(null);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  // Deep link support: /?v=<id or url> loads straight into a transcript.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('v');
    if (initial) run(initial);
  }, [run]);

  const hint = error && errorHint(error.code);

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="pb-6">
          <h1 className="font-display text-2xl text-text sm:text-3xl">YouTube Transcripts</h1>
          <p className="pt-1 text-sm text-muted">
            Paste a link, get the full transcript — searchable, timestamped, and exportable.
          </p>
        </header>

        <SearchForm initialValue={lastInput} busy={busy} onSubmit={(value) => run(value)} />

        {!result && !error && !busy && history.length > 0 && (
          <div className="pt-6">
            <p className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent</p>
            <div className="flex flex-wrap gap-2">
              {history.map((entry) => (
                <button
                  key={entry.videoId}
                  type="button"
                  onClick={() => run(entry.videoId)}
                  className="max-w-full truncate rounded-lg border border-border bg-panel px-3 py-1.5 text-xs text-muted transition hover:border-border-hi hover:text-text"
                >
                  {entry.title || entry.videoId}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-danger/40 bg-danger/5 p-4">
            <p className="text-sm font-semibold text-danger">{error.message}</p>
            {hint && <p className="pt-1 text-sm text-muted">{hint}</p>}
          </div>
        )}

        {busy && !result && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-panel p-4 text-sm text-muted">
            <span className="h-3 w-3 animate-pulse rounded-full bg-gold" />
            Pulling the transcript…
          </div>
        )}

        {result && (
          <main className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
            <div className="space-y-4 lg:sticky lg:top-6">
              <VideoPanel result={result} onReady={handlePlayerReady} />
              <LanguagePicker
                result={result}
                busy={busy}
                onChangeLanguage={(lang) =>
                  run(result.videoId, { lang, translateTo: result.translatedTo || undefined })
                }
                onTranslate={(translateTo) =>
                  run(result.videoId, { lang: result.language.key, translateTo: translateTo || undefined })
                }
              />
              <ExportBar result={result} />
            </div>
            <TranscriptView result={result} onSeek={(seconds) => seekRef.current?.(seconds)} />
          </main>
        )}

        <footer className="pt-10 text-xs text-muted">
          Reads the caption tracks YouTube already publishes for a video. Transcripts stay the
          property of whoever made the video — use them accordingly.
        </footer>
      </div>
    </div>
  );
}
