import { getTranscript, parseVideoId, TranscriptError } from '../../shared/youtube.mjs';
import { FORMATS, suggestFilename } from '../../shared/formats.mjs';

export const config = { path: '/api/transcript' };

/**
 * Instance-local cache and rate limiter. Netlify recycles instances freely, so
 * neither is authoritative — they exist to keep one browser tab (or one loop in
 * a script) from hammering YouTube, not as a security boundary.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const cache = new Map();

const RATE_LIMIT = { windowMs: 60_000, max: 30 };
const hits = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the LRU eviction below drops cold entries first.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function rateLimited(ip) {
  const now = Date.now();
  const window = hits.get(ip)?.filter((at) => now - at < RATE_LIMIT.windowMs) ?? [];
  if (window.length >= RATE_LIMIT.max) {
    hits.set(ip, window);
    return true;
  }
  window.push(now);
  hits.set(ip, window);
  if (hits.size > 500) {
    for (const [key, stamps] of hits) {
      if (!stamps.some((at) => now - at < RATE_LIMIT.windowMs)) hits.delete(key);
    }
  }
  return false;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const url = new URL(request.url);
  const input = url.searchParams.get('v') || url.searchParams.get('url') || '';
  const lang = url.searchParams.get('lang') || undefined;
  const translateTo = url.searchParams.get('translateTo') || undefined;
  const format = url.searchParams.get('format');

  if (!input.trim()) {
    return json({ error: 'Pass a YouTube URL or video ID as ?v=', code: 'MISSING_INPUT' }, 400);
  }
  if (format && !Object.hasOwn(FORMATS, format)) {
    return json(
      { error: `Unknown format "${format}". Try: ${Object.keys(FORMATS).join(', ')}.`, code: 'BAD_FORMAT' },
      400,
    );
  }

  const videoId = parseVideoId(input);
  if (!videoId) {
    return json(
      { error: 'Could not find a YouTube video ID in that input.', code: 'BAD_ID' },
      400,
    );
  }

  const ip =
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  if (rateLimited(ip)) {
    return json(
      { error: 'Too many requests — slow down for a minute.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': '60' },
    );
  }

  const cacheKey = `${videoId}|${lang || ''}|${translateTo || ''}`;
  let result = cacheGet(cacheKey);
  let cached = Boolean(result);

  if (!result) {
    try {
      result = await getTranscript(videoId, { lang, translateTo });
      cacheSet(cacheKey, result);
    } catch (error) {
      if (error instanceof TranscriptError) {
        return json({ error: error.message, code: error.code, videoId }, error.status);
      }
      console.error('transcript failed', error);
      return json({ error: 'Unexpected error fetching the transcript.', code: 'INTERNAL' }, 500);
    }
  }

  if (format) {
    const spec = FORMATS[format];
    return new Response(spec.render(result), {
      status: 200,
      headers: {
        'Content-Type': spec.mime,
        'Content-Disposition': `attachment; filename="${suggestFilename(result, format)}"`,
        'Cache-Control': 'public, max-age=600',
      },
    });
  }

  return json({ ...result, cached }, 200, { 'Cache-Control': 'public, max-age=600' });
}
