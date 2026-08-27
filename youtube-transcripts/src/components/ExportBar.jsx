import { useState } from 'react';
import { FORMATS, toPlainText, toTimestampedText } from '../../shared/formats.mjs';
import { copyText, downloadTranscript } from '../lib/download.js';

const DOWNLOAD_FORMATS = ['txt', 'timestamped', 'md', 'srt', 'vtt', 'json'];

export default function ExportBar({ result }) {
  const [copied, setCopied] = useState('');

  async function handleCopy(kind) {
    const text = kind === 'timestamped' ? toTimestampedText(result.segments) : toPlainText(result.segments);
    const ok = await copyText(text);
    setCopied(ok ? kind : 'failed');
    setTimeout(() => setCopied(''), 2000);
  }

  return (
    <div className="card space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary" onClick={() => handleCopy('plain')}>
          {copied === 'plain' ? 'Copied ✓' : 'Copy text'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => handleCopy('timestamped')}>
          {copied === 'timestamped' ? 'Copied ✓' : 'Copy + times'}
        </button>
      </div>
      {copied === 'failed' && (
        <p className="text-xs text-danger">
          Clipboard blocked by the browser — use a download instead.
        </p>
      )}

      <div>
        <p className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Download</p>
        <div className="flex flex-wrap gap-2">
          {DOWNLOAD_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => downloadTranscript(result, format)}
              className="rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs font-medium text-muted transition hover:border-border-hi hover:text-text"
            >
              {FORMATS[format].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
