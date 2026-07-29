# YouTube Transcripts

Paste a YouTube link, get the video's transcript — searchable, timestamped,
click-to-seek, and exportable as text, Markdown, SRT, VTT, or JSON.

Standalone app, same shape as `time-audit/` and `mission-control/`: its own
`package.json` and `netlify.toml`, deployed as its own Netlify site.

## Running it

```bash
cd youtube-transcripts
npm install
npm run dev        # http://localhost:5175
```

`npm run dev` serves the API locally through the same handler Netlify runs in
production, so there's no separate function server to start.

```bash
npm run build      # -> dist/
npm run preview    # static preview (no API — use `npm run dev` for that)
```

## Command line

The core is importable, so there's a CLI for the same job:

```bash
npm run pull -- https://youtu.be/dQw4w9WgXcQ
npm run pull -- dQw4w9WgXcQ --format srt --out auto
npm run pull -- <url> --lang en.auto --translate es --format md
```

## API

One endpoint, `GET /api/transcript`:

| Param | Meaning |
| --- | --- |
| `v` | YouTube URL or 11-character video ID (required) |
| `lang` | Track key from `languages[].key`, e.g. `en` or `en.auto` |
| `translateTo` | Language code for YouTube's machine translation, e.g. `es` |
| `format` | `txt`, `timestamped`, `md`, `srt`, `vtt`, `json` — returns a file download instead of JSON |

```bash
curl 'http://localhost:5175/api/transcript?v=dQw4w9WgXcQ'
curl 'http://localhost:5175/api/transcript?v=dQw4w9WgXcQ&format=srt'
```

Without `format`, the response is JSON:

```jsonc
{
  "videoId": "…",
  "title": "…",
  "author": "…",
  "lengthSeconds": 213,
  "language":  { "key": "en", "code": "en", "name": "English", "isGenerated": false },
  "languages": [ /* every available track */ ],
  "translationLanguages": [ /* codes YouTube will translate into */ ],
  "segments":  [ { "start": 12.4, "dur": 3.1, "text": "…" } ]
}
```

Errors come back as `{ error, code }` with a real status code. Codes worth
handling: `BAD_ID`, `NO_CAPTIONS`, `UNAVAILABLE` (private/deleted/region-locked),
`LANG_UNAVAILABLE`, `RATE_LIMITED`, `FETCH_FAILED`.

## How it works

YouTube has no public captions API for videos you don't own, so
`shared/youtube.mjs` asks InnerTube — the backend the YouTube player itself
talks to — for the player response, reads the caption track list out of it, and
fetches the track.

Any single client can come up empty: some get no track list, some return a
caption URL that 403s from a datacenter IP. So it tries several player clients
in order (Android → iOS → web → embedded TV) and keeps the first one that
actually yields text, falling back to scraping the watch page if InnerTube
refuses outright. That fallback chain is the whole reason this is more than
twenty lines, and it's the part to look at first if fetching ever starts
failing — client versions age out.

The function keeps a small in-instance cache (10 min) and a per-IP rate limit
(30/min). Netlify recycles instances freely, so both are best-effort — they
exist to stop a loop from hammering YouTube, not as a security boundary.

## Deploying

Point a new Netlify site at this repo with base directory `youtube-transcripts/`
— `netlify.toml` covers the rest. No environment variables, no API keys, no
database.

## Caveats

- **No captions, no transcript.** If the uploader didn't add captions and
  YouTube didn't auto-generate any, there is nothing to fetch.
- **Auto-generated tracks are rough** — no punctuation to speak of, and speaker
  changes aren't marked.
- **Unofficial plumbing.** This relies on YouTube's internal player API. It
  works well and is how every transcript tool does it, but YouTube can change it
  without notice.
- **Transcripts belong to whoever made the video.** Fine for reading, searching,
  quoting, and summarizing; republishing wholesale is the video owner's call.
