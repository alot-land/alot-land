/**
 * Run with `npm test` (node --test, no dependencies).
 *
 * These stub global fetch with fixture payloads shaped like the real InnerTube
 * and timedtext responses, so the client-fallback logic, track selection,
 * caption parsing, and error mapping are all exercised without touching the
 * network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTranscript, parseVideoId, TranscriptError } from '../shared/youtube.mjs';
import { toSrt, toVtt, toPlainText, toTimestampedText, formatClock } from '../shared/formats.mjs';

const VIDEO_ID = 'abcdefghijk';

function playerResponse({ tracks = [], status = 'OK', reason, title = 'Test video' } = {}) {
  return {
    playabilityStatus: reason ? { status, reason } : { status },
    videoDetails: {
      videoId: VIDEO_ID,
      title,
      author: 'Test channel',
      lengthSeconds: '212',
    },
    captions: tracks.length
      ? {
          playerCaptionsTracklistRenderer: {
            captionTracks: tracks,
            translationLanguages: [
              { languageCode: 'es', languageName: { simpleText: 'Spanish' } },
            ],
          },
        }
      : undefined,
  };
}

const EN_TRACK = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
  languageCode: 'en',
  vssId: '.en',
  name: { simpleText: 'English' },
  isTranslatable: true,
};

const EN_AUTO_TRACK = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr',
  languageCode: 'en',
  vssId: 'a.en',
  kind: 'asr',
  name: { runs: [{ text: 'English (auto-generated)' }] },
  isTranslatable: true,
};

const JSON3_BODY = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'first ' }, { utf8: 'line' }] },
    { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'second &amp; line' }] },
    { tStartMs: 3500, dDurationMs: 1000, segs: [{ utf8: '\n' }] }, // whitespace-only: dropped
    { tStartMs: 9000, dDurationMs: 2000, segs: [{ utf8: 'after a long pause' }] },
    { tStartMs: 12000 }, // no segs at all: dropped
  ],
});

const XML_BODY = `<?xml version="1.0" encoding="utf-8"?><transcript>
<text start="0" dur="1.5">first line</text>
<text start="1.5" dur="2">second &amp;amp; line</text>
<text start="9" dur="2">after a long pause</text>
</transcript>`;

/** Install a fetch stub; returns a log of requested URLs. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = typeof url === 'string' ? url : url.toString();
    calls.push(href);
    const result = await handler(href, options, calls.length);
    if (result instanceof Error) throw result;
    const { body = '', status = 200 } = result || {};
    return new Response(body, { status });
  };
  calls.restore = () => {
    globalThis.fetch = original;
  };
  return calls;
}

const isPlayerCall = (url) => url.includes('/youtubei/v1/player');
const isWatchCall = (url) => url.includes('/watch?v=');

test('parses a json3 caption track end to end', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) return { body: JSON.stringify(playerResponse({ tracks: [EN_TRACK] })) };
    if (url.includes('fmt=json3')) return { body: JSON3_BODY };
    return { body: '' };
  });
  t.after(calls.restore);

  const result = await getTranscript(VIDEO_ID);

  assert.equal(result.videoId, VIDEO_ID);
  assert.equal(result.title, 'Test video');
  assert.equal(result.author, 'Test channel');
  assert.equal(result.lengthSeconds, 212);
  assert.equal(result.source, 'ANDROID', 'first client should win when it works');
  assert.equal(result.language.key, 'en');
  assert.equal(result.language.isGenerated, false);
  assert.deepEqual(result.translationLanguages, [{ code: 'es', name: 'Spanish' }]);

  // Whitespace-only and seg-less events are dropped; entities are decoded.
  assert.equal(result.segments.length, 3);
  assert.deepEqual(result.segments[0], { start: 0, dur: 1.5, text: 'first line' });
  assert.equal(result.segments[1].text, 'second & line');
});

test('falls back to the XML track format when json3 comes back empty', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) return { body: JSON.stringify(playerResponse({ tracks: [EN_TRACK] })) };
    if (url.includes('fmt=json3')) return { body: '' };
    return { body: XML_BODY };
  });
  t.after(calls.restore);

  const result = await getTranscript(VIDEO_ID);
  assert.equal(result.segments.length, 3);
  // The XML cue body is double-encoded, so it must survive two decode passes.
  assert.equal(result.segments[1].text, 'second & line');
});

test('moves to the next client when one returns a caption URL that fails', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) return { body: JSON.stringify(playerResponse({ tracks: [EN_TRACK] })) };
    // Every caption fetch 403s until the third player client has been tried.
    const playerCalls = calls.filter(isPlayerCall).length;
    if (playerCalls < 3) return { status: 403, body: 'denied' };
    return url.includes('fmt=json3') ? { body: JSON3_BODY } : { body: '' };
  });
  t.after(calls.restore);

  const result = await getTranscript(VIDEO_ID);
  assert.equal(result.source, 'WEB');
  assert.equal(result.segments.length, 3);
});

test('falls back to scraping the watch page when InnerTube fails outright', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) return { status: 400, body: 'nope' };
    if (isWatchCall(url)) {
      const payload = JSON.stringify(playerResponse({ tracks: [EN_TRACK] }));
      return {
        body: `<html><script>var ytInitialPlayerResponse = ${payload};</script></html>`,
      };
    }
    return url.includes('fmt=json3') ? { body: JSON3_BODY } : { body: '' };
  });
  t.after(calls.restore);

  const result = await getTranscript(VIDEO_ID);
  assert.equal(result.source, 'WATCH_PAGE');
  assert.equal(result.segments.length, 3);
});

test('prefers a human track over the auto-generated one, and honours an explicit pick', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) {
      return { body: JSON.stringify(playerResponse({ tracks: [EN_AUTO_TRACK, EN_TRACK] })) };
    }
    return url.includes('fmt=json3') ? { body: JSON3_BODY } : { body: '' };
  });
  t.after(calls.restore);

  const auto = await getTranscript(VIDEO_ID);
  assert.equal(auto.language.key, 'en', 'human track wins by default');
  assert.equal(auto.languages.length, 2);

  const picked = await getTranscript(VIDEO_ID, { lang: 'en.auto' });
  assert.equal(picked.language.key, 'en.auto');
  assert.equal(picked.language.isGenerated, true);
});

test('passes translateTo through as a tlang parameter', async (t) => {
  const calls = stubFetch((url) => {
    if (isPlayerCall(url)) return { body: JSON.stringify(playerResponse({ tracks: [EN_TRACK] })) };
    return url.includes('fmt=json3') ? { body: JSON3_BODY } : { body: '' };
  });
  t.after(calls.restore);

  const result = await getTranscript(VIDEO_ID, { translateTo: 'es' });
  assert.equal(result.translatedTo, 'es');
  assert.ok(
    calls.some((url) => url.includes('tlang=es')),
    'caption request should carry tlang=es',
  );
});

test('reports NO_CAPTIONS when the video plays but has no tracks', async (t) => {
  const calls = stubFetch((url) =>
    isPlayerCall(url) || isWatchCall(url)
      ? { body: JSON.stringify(playerResponse({ tracks: [] })) }
      : { body: '' },
  );
  t.after(calls.restore);

  await assert.rejects(getTranscript(VIDEO_ID), (error) => {
    assert.ok(error instanceof TranscriptError);
    assert.equal(error.code, 'NO_CAPTIONS');
    assert.equal(error.status, 404);
    return true;
  });
});

test('surfaces YouTube playability errors as UNAVAILABLE', async (t) => {
  const calls = stubFetch((url) =>
    isPlayerCall(url) || isWatchCall(url)
      ? {
          body: JSON.stringify(
            playerResponse({ status: 'LOGIN_REQUIRED', reason: 'This video is private.' }),
          ),
        }
      : { body: '' },
  );
  t.after(calls.restore);

  await assert.rejects(getTranscript(VIDEO_ID), (error) => {
    assert.equal(error.code, 'UNAVAILABLE');
    assert.equal(error.message, 'This video is private.');
    assert.equal(error.status, 403);
    return true;
  });
});

test('reports LANG_UNAVAILABLE for a language the video does not have', async (t) => {
  const calls = stubFetch((url) =>
    isPlayerCall(url) || isWatchCall(url)
      ? { body: JSON.stringify(playerResponse({ tracks: [EN_TRACK] })) }
      : { body: '' },
  );
  t.after(calls.restore);

  await assert.rejects(getTranscript(VIDEO_ID, { lang: 'ja' }), (error) => {
    assert.equal(error.code, 'LANG_UNAVAILABLE');
    assert.match(error.message, /Available: en/);
    return true;
  });
});

test('reports UPSTREAM_UNREACHABLE when every request throws', async (t) => {
  const calls = stubFetch(() => new Error('ECONNREFUSED'));
  t.after(calls.restore);

  await assert.rejects(getTranscript(VIDEO_ID), (error) => {
    assert.equal(error.code, 'UPSTREAM_UNREACHABLE');
    assert.equal(error.status, 502);
    return true;
  });
});

test('rejects a malformed video id before making any request', async (t) => {
  const calls = stubFetch(() => ({ body: '{}' }));
  t.after(calls.restore);

  await assert.rejects(getTranscript('too-short'), (error) => {
    assert.equal(error.code, 'BAD_ID');
    return true;
  });
  assert.equal(calls.length, 0, 'should not hit the network for a bad id');
});

test('parseVideoId handles the URL shapes people actually paste', () => {
  const id = 'dQw4w9WgXcQ';
  const good = [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?v=${id}&t=42s&list=PLabc`,
    `https://youtu.be/${id}?si=xyz`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `www.youtube.com/watch?v=${id}`,
  ];
  good.forEach((input) => assert.equal(parseVideoId(input), id, input));

  const bad = ['', '   ', 'not a url', 'https://vimeo.com/12345', `https://evil.com/watch?v=${id}`];
  bad.forEach((input) => assert.equal(parseVideoId(input), null, input));
});

/* ------------------------------------------------------------- formats --- */

const SEGMENTS = [
  { start: 0, dur: 1.5, text: 'first line' },
  { start: 1.5, dur: 2, text: 'second line' },
  { start: 9, dur: 2, text: 'after a long pause' },
];

test('formatClock switches to hours only when needed', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3725), '1:02:05');
});

test('SRT and VTT emit well-formed, non-overlapping cues', () => {
  const srt = toSrt(SEGMENTS);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,500\nfirst line\n/);
  assert.match(srt, /\n3\n00:00:09,000 --> 00:00:11,000\nafter a long pause\n/);

  const vtt = toVtt(SEGMENTS);
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\n/);

  // A cue whose duration would overrun the next cue gets clamped.
  const overlapping = [
    { start: 0, dur: 10, text: 'long' },
    { start: 2, dur: 2, text: 'next' },
  ];
  assert.match(toSrt(overlapping), /00:00:00,000 --> 00:00:02,000/);

  // A zero-duration cue still produces a non-empty range.
  assert.match(toSrt([{ start: 5, dur: 0, text: 'blip' }]), /00:00:05,000 --> 00:00:05,100/);
});

test('plain text breaks paragraphs at long pauses', () => {
  const paragraphs = toPlainText(SEGMENTS).split('\n\n');
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0], 'first line second line');
  assert.equal(paragraphs[1], 'after a long pause');
});

test('timestamped text prefixes each cue with its clock time', () => {
  assert.equal(
    toTimestampedText(SEGMENTS).split('\n')[2],
    '[0:09] after a long pause',
  );
});
