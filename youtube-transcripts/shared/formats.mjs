/**
 * Transcript formatters. Imported by both the browser bundle (for downloads and
 * copy-to-clipboard) and the serverless function (for `?format=` responses), so
 * keep this free of Node and DOM APIs.
 */

/** 65 -> "1:05", 3725 -> "1:02:05" */
export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function stamp(totalSeconds, msSeparator) {
  const clamped = Math.max(0, totalSeconds || 0);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${msSeparator}${pad(ms, 3)}`;
}

/**
 * Cue end time. Some tracks report a zero or overlapping duration, so fall back
 * to the next cue's start and never emit a zero-length range.
 */
function endOf(segments, index) {
  const current = segments[index];
  const next = segments[index + 1];
  const byDuration = current.start + (current.dur || 0);
  const capped = next ? Math.min(byDuration || next.start, next.start) : byDuration;
  return Math.max(capped, current.start + 0.1);
}

/** Continuous prose, broken into paragraphs at natural pauses. */
export function toPlainText(segments, { gapSeconds = 2.5, maxChars = 700 } = {}) {
  const paragraphs = [];
  let current = [];
  let previousEnd = null;

  segments.forEach((segment) => {
    const gap = previousEnd === null ? 0 : segment.start - previousEnd;
    const length = current.join(' ').length;
    if (current.length && (gap >= gapSeconds || length >= maxChars)) {
      paragraphs.push(current.join(' '));
      current = [];
    }
    current.push(segment.text);
    previousEnd = segment.start + (segment.dur || 0);
  });

  if (current.length) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

/** One line per cue, prefixed with a clickable-looking timestamp. */
export function toTimestampedText(segments) {
  return segments.map((segment) => `[${formatClock(segment.start)}] ${segment.text}`).join('\n');
}

export function toSrt(segments) {
  return segments
    .map((segment, index) =>
      [
        index + 1,
        `${stamp(segment.start, ',')} --> ${stamp(endOf(segments, index), ',')}`,
        segment.text,
        '',
      ].join('\n'),
    )
    .join('\n');
}

export function toVtt(segments) {
  const cues = segments.map((segment, index) =>
    [`${stamp(segment.start, '.')} --> ${stamp(endOf(segments, index), '.')}`, segment.text, ''].join(
      '\n',
    ),
  );
  return `WEBVTT\n\n${cues.join('\n')}`;
}

export function toMarkdown(result) {
  const url = `https://www.youtube.com/watch?v=${result.videoId}`;
  const header = [
    `# ${result.title || result.videoId}`,
    '',
    result.author ? `**Channel:** ${result.author}  ` : '',
    `**Source:** ${url}  `,
    `**Language:** ${result.language.name}${result.language.isGenerated ? ' (auto-generated)' : ''}`,
    '',
    '---',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return `${header}\n\n${toPlainText(result.segments)}\n`;
}

export function toJson(result) {
  return JSON.stringify(
    {
      videoId: result.videoId,
      title: result.title,
      author: result.author,
      lengthSeconds: result.lengthSeconds,
      language: result.language,
      translatedTo: result.translatedTo,
      segments: result.segments,
    },
    null,
    2,
  );
}

export const FORMATS = {
  txt: {
    label: 'Plain text',
    extension: 'txt',
    mime: 'text/plain; charset=utf-8',
    render: (result) => toPlainText(result.segments),
  },
  timestamped: {
    label: 'Text + timestamps',
    extension: 'txt',
    mime: 'text/plain; charset=utf-8',
    render: (result) => toTimestampedText(result.segments),
  },
  md: {
    label: 'Markdown',
    extension: 'md',
    mime: 'text/markdown; charset=utf-8',
    render: toMarkdown,
  },
  srt: {
    label: 'SubRip (.srt)',
    extension: 'srt',
    mime: 'application/x-subrip; charset=utf-8',
    render: (result) => toSrt(result.segments),
  },
  vtt: {
    label: 'WebVTT (.vtt)',
    extension: 'vtt',
    mime: 'text/vtt; charset=utf-8',
    render: (result) => toVtt(result.segments),
  },
  json: {
    label: 'JSON',
    extension: 'json',
    mime: 'application/json; charset=utf-8',
    render: toJson,
  },
};

/** Filesystem-safe download name derived from the video title. */
export function suggestFilename(result, format) {
  const slug = (result.title || result.videoId)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || result.videoId}.${FORMATS[format].extension}`;
}
