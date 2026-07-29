/**
 * YouTube caption fetching.
 *
 * YouTube has no public captions API for videos you don't own, so this walks the
 * same path the player does: ask InnerTube (the player's own backend) for the
 * player response, read the caption track list out of it, then fetch the track.
 *
 * Any single client can fail — some get an empty track list, some hand back a
 * baseUrl that 403s from a datacenter IP — so we try several in order and keep
 * the first one that actually yields text. The watch-page scrape is the last
 * resort when InnerTube refuses outright.
 */

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player';
// Public key shipped in YouTube's own web player bundle. Not a secret, not ours.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const CLIENTS = [
  {
    name: 'ANDROID',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '20.10.38',
    },
  },
  {
    name: 'IOS',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '20.10.4',
    },
  },
  {
    name: 'WEB',
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20250501.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': BROWSER_UA,
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20250501.00.00',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
  },
  {
    name: 'TVHTML5',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
      thirdParty: { embedUrl: 'https://www.youtube.com' },
    },
    headers: { 'User-Agent': BROWSER_UA },
  },
];

export class TranscriptError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ ids --- */

/**
 * Pull an 11-character video id out of anything a user is likely to paste:
 * a watch URL, a share link, an embed/shorts/live URL, or the bare id.
 */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTube =
    host === 'youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be' ||
    host === 'm.youtube.com' ||
    host.endsWith('.youtube.com');
  if (!isYouTube) return null;

  const fromQuery = url.searchParams.get('v');
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && segments[0] && /^[\w-]{11}$/.test(segments[0])) {
    return segments[0];
  }
  const keyed = ['embed', 'shorts', 'live', 'v'];
  for (let i = 0; i < segments.length - 1; i++) {
    if (keyed.includes(segments[i]) && /^[\w-]{11}$/.test(segments[i + 1])) {
      return segments[i + 1];
    }
  }
  return null;
}

/* ------------------------------------------------------- player response --- */

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlayerResponse(videoId, client) {
  const res = await fetchWithTimeout(`${INNERTUBE_URL}?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      ...client.headers,
    },
    body: JSON.stringify({
      videoId,
      context: client.context,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) throw new Error(`InnerTube ${client.name} responded ${res.status}`);
  return res.json();
}

/** Scan forward from `marker` and return the first balanced {...} literal. */
function extractJsonObject(html, marker) {
  const markerAt = html.indexOf(marker);
  if (markerAt === -1) return null;
  const start = html.indexOf('{', markerAt + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

async function fetchPlayerResponseFromWatchPage(videoId) {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&has_verified=1&bpctr=9999999999`,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        // Skips the EU consent interstitial, which otherwise replaces the page.
        Cookie: 'CONSENT=YES+1; SOCS=CAI',
      },
    },
  );
  if (!res.ok) throw new Error(`Watch page responded ${res.status}`);
  const html = await res.text();
  const json =
    extractJsonObject(html, 'ytInitialPlayerResponse') ||
    extractJsonObject(html, '"playerResponse":');
  if (!json) throw new Error('No player response in watch page');
  return JSON.parse(json);
}

/* ------------------------------------------------------------- captions --- */

function readRunsText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run.text || '').join('');
  return '';
}

function extractCaptionTracks(playerResponse) {
  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks;
  if (!Array.isArray(tracks)) return { tracks: [], translationLanguages: [] };

  return {
    tracks: tracks
      .filter((track) => track && track.baseUrl)
      .map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode || '',
        // vssId looks like ".en" for a real track and "a.en" for auto-generated.
        vssId: track.vssId || '',
        name: readRunsText(track.name) || track.languageCode || 'Unknown',
        isGenerated: track.kind === 'asr' || /^a\./.test(track.vssId || ''),
        isTranslatable: Boolean(track.isTranslatable),
      })),
    translationLanguages: Array.isArray(renderer.translationLanguages)
      ? renderer.translationLanguages.map((lang) => ({
          code: lang.languageCode,
          name: readRunsText(lang.languageName) || lang.languageCode,
        }))
      : [],
  };
}

function trackKey(track) {
  return `${track.languageCode}${track.isGenerated ? '.auto' : ''}`;
}

function pickTrack(tracks, wanted) {
  if (!tracks.length) return null;
  if (wanted) {
    const exact = tracks.find((track) => trackKey(track) === wanted);
    if (exact) return exact;
    const byLang = tracks.filter((track) => track.languageCode === wanted);
    if (byLang.length) return byLang.find((track) => !track.isGenerated) || byLang[0];
    const byPrefix = tracks.filter((track) => track.languageCode.split('-')[0] === wanted.split('-')[0]);
    if (byPrefix.length) return byPrefix.find((track) => !track.isGenerated) || byPrefix[0];
    return null;
  }
  const english = tracks.filter((track) => track.languageCode.split('-')[0] === 'en');
  const pool = english.length ? english : tracks;
  return pool.find((track) => !track.isGenerated) || pool[0];
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const key = entity.toLowerCase();
    return key in ENTITIES ? ENTITIES[key] : match;
  });
}

function cleanCue(text) {
  return decodeEntities(text)
    // Auto-generated tracks carry sound tags like [Music] and speaker markup.
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJson3(body) {
  const data = JSON.parse(body);
  if (!Array.isArray(data.events)) return [];
  const segments = [];
  for (const event of data.events) {
    if (!Array.isArray(event.segs)) continue;
    const text = cleanCue(event.segs.map((seg) => seg.utf8 || '').join(''));
    if (!text) continue;
    segments.push({
      start: (event.tStartMs || 0) / 1000,
      dur: (event.dDurationMs || 0) / 1000,
      text,
    });
  }
  return segments;
}

function parseTimedTextXml(body) {
  const segments = [];
  const cue = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = cue.exec(body)) !== null) {
    const attrs = match[1];
    const start = Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1] ?? NaN);
    const dur = Number(/\bdur="([\d.]+)"/.exec(attrs)?.[1] ?? 0);
    // The cue body is entity-encoded inside XML that itself was encoded once.
    const text = cleanCue(decodeEntities(match[2]).replace(/<[^>]+>/g, ''));
    if (!text || !Number.isFinite(start)) continue;
    segments.push({ start, dur: Number.isFinite(dur) ? dur : 0, text });
  }
  return segments;
}

async function fetchTrackSegments(track, translateTo) {
  const base = new URL(track.baseUrl);
  if (translateTo) base.searchParams.set('tlang', translateTo);

  const json3 = new URL(base);
  json3.searchParams.set('fmt', 'json3');

  for (const [url, parse] of [
    [json3, parseJson3],
    [base, parseTimedTextXml],
  ]) {
    try {
      const res = await fetchWithTimeout(url.toString(), {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (!body.trim()) continue;
      const segments = parse(body);
      if (segments.length) return segments;
    } catch {
      // Try the next format, then the next client.
    }
  }
  return [];
}

/* ---------------------------------------------------------------- public --- */

function readMeta(playerResponse, videoId) {
  const details = playerResponse?.videoDetails || {};
  const lengthSeconds = Number(details.lengthSeconds);
  return {
    videoId,
    title: details.title || '',
    author: details.author || '',
    channelId: details.channelId || '',
    lengthSeconds: Number.isFinite(lengthSeconds) ? lengthSeconds : null,
    isLive: Boolean(details.isLive || details.isLiveContent),
  };
}

function playabilityProblem(playerResponse) {
  const status = playerResponse?.playabilityStatus;
  if (!status || status.status === 'OK') return null;
  const reason =
    status.reason ||
    readRunsText(status.errorScreen?.playerErrorMessageRenderer?.reason) ||
    'This video cannot be played.';
  return { status: status.status, reason };
}

/**
 * Fetch a transcript for one video.
 *
 * @param {string} videoId  11-character YouTube id.
 * @param {{ lang?: string, translateTo?: string }} [options]
 *   lang — track key from `languages[].key` (e.g. "en" or "en.auto").
 *   translateTo — language code to have YouTube machine-translate the track into.
 */
export async function getTranscript(videoId, options = {}) {
  const { lang, translateTo } = options;
  if (!/^[\w-]{11}$/.test(videoId)) {
    throw new TranscriptError('BAD_ID', 'That does not look like a YouTube video ID or URL.', 400);
  }

  const sources = [
    ...CLIENTS.map((client) => ({
      label: client.name,
      load: () => fetchPlayerResponse(videoId, client),
    })),
    { label: 'WATCH_PAGE', load: () => fetchPlayerResponseFromWatchPage(videoId) },
  ];

  let meta = null;
  let blocked = null;
  let sawEmptyTrackList = false;
  let langMiss = null;
  let reachedYouTube = false;

  for (const source of sources) {
    let playerResponse;
    try {
      playerResponse = await source.load();
      reachedYouTube = true;
    } catch {
      continue;
    }

    if (!meta && playerResponse?.videoDetails) meta = readMeta(playerResponse, videoId);

    const problem = playabilityProblem(playerResponse);
    if (problem) {
      blocked = blocked || problem;
      continue;
    }

    const { tracks, translationLanguages } = extractCaptionTracks(playerResponse);
    if (!tracks.length) {
      sawEmptyTrackList = true;
      continue;
    }

    const languages = tracks.map((track) => ({
      key: trackKey(track),
      code: track.languageCode,
      name: track.name,
      isGenerated: track.isGenerated,
      isTranslatable: track.isTranslatable,
    }));

    const track = pickTrack(tracks, lang);
    if (!track) {
      langMiss = { languages, translationLanguages };
      continue;
    }

    const segments = await fetchTrackSegments(track, translateTo);
    if (!segments.length) continue;

    return {
      ...(meta || readMeta(playerResponse, videoId)),
      language: {
        key: trackKey(track),
        code: track.languageCode,
        name: track.name,
        isGenerated: track.isGenerated,
      },
      translatedTo: translateTo || null,
      languages,
      translationLanguages,
      segments,
      source: source.label,
    };
  }

  if (langMiss) {
    throw new TranscriptError(
      'LANG_UNAVAILABLE',
      `No "${lang}" track for this video. Available: ${langMiss.languages
        .map((entry) => entry.key)
        .join(', ')}.`,
      404,
    );
  }
  if (blocked) {
    throw new TranscriptError('UNAVAILABLE', blocked.reason, 403);
  }
  if (sawEmptyTrackList) {
    throw new TranscriptError(
      'NO_CAPTIONS',
      meta?.isLive
        ? 'This is a live stream — captions are only available once it has ended and been processed.'
        : 'This video has no captions or transcript available.',
      404,
    );
  }
  if (!reachedYouTube) {
    throw new TranscriptError('UPSTREAM_UNREACHABLE', 'Could not reach YouTube. Try again.', 502);
  }
  throw new TranscriptError(
    'FETCH_FAILED',
    'YouTube listed captions for this video but would not hand them over. Try again in a moment.',
    502,
  );
}
