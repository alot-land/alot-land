import { useEffect, useRef } from 'react';
import { formatClock } from '../../shared/formats.mjs';

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Embedded player plus video metadata. Exposes a seek handle to the parent via
 * `onReady` — the iframe accepts player commands over postMessage when
 * enablejsapi=1, so no extra YouTube script is needed (and none is allowed by
 * our CSP).
 */
export default function VideoPanel({ result, onReady }) {
  const frameRef = useRef(null);

  useEffect(() => {
    function seekTo(seconds) {
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        EMBED_ORIGIN,
      );
    }
    onReady?.(seekTo);
    return () => onReady?.(null);
  }, [onReady, result.videoId]);

  const watchUrl = `https://www.youtube.com/watch?v=${result.videoId}`;

  return (
    <div className="card overflow-hidden">
      <div className="aspect-video w-full bg-black">
        <iframe
          ref={frameRef}
          key={result.videoId}
          className="h-full w-full"
          src={`${EMBED_ORIGIN}/embed/${result.videoId}?enablejsapi=1&rel=0`}
          title={result.title || 'YouTube video'}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      <div className="space-y-2 p-4">
        <h2 className="font-display text-lg leading-snug text-text">
          {result.title || result.videoId}
        </h2>
        <p className="text-sm text-muted">
          {result.author && <span>{result.author}</span>}
          {result.author && result.lengthSeconds ? <span className="px-1.5">·</span> : null}
          {result.lengthSeconds ? <span>{formatClock(result.lengthSeconds)}</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="rounded-full border border-border bg-panel-2 px-2.5 py-1 text-muted">
            {result.segments.length.toLocaleString()} lines
          </span>
          <span className="rounded-full border border-border bg-panel-2 px-2.5 py-1 text-muted">
            {result.language.name}
            {result.language.isGenerated ? ' · auto' : ''}
          </span>
          {result.translatedTo && (
            <span className="rounded-full border border-blue/40 bg-blue/10 px-2.5 py-1 text-blue">
              translated → {result.translatedTo}
            </span>
          )}
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full border border-border px-2.5 py-1 text-muted transition hover:border-border-hi hover:text-text"
          >
            Open on YouTube ↗
          </a>
        </p>
      </div>
    </div>
  );
}
