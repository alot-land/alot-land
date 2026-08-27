#!/usr/bin/env node
/**
 * Pulls the transcript for every FAQ that has a video, and stores it in
 * seo-engine/transcripts/.
 *
 * Why this exists: the strongest technique in the whole method is writing the
 * page answer FROM what David actually said on camera, not from scratch. That
 * puts material in the index that exists nowhere else. This removes the manual
 * step between "video uploaded" and "transcript available to write from".
 *
 * David pastes a YouTube URL into /admin → FAQs → Video Answer URL. That commits
 * to the repo, this runs, and the transcript is waiting for the next cycle.
 *
 * Idempotent: an FAQ whose transcript is already stored for that same video is
 * skipped, so it is safe to run on every push. Re-pull one by deleting its file.
 *
 * Uses the transcript core from youtube-transcripts/, which owns YouTube's
 * undocumented caption plumbing and its client-fallback chain.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const FAQ_DIR = join(REPO, 'src/content/faqs');
const OUT_DIR = join(HERE, 'transcripts');
const INDEX = join(OUT_DIR, 'index.json');

const { getTranscript, parseVideoId, TranscriptError } =
  await import(join(REPO, 'youtube-transcripts/shared/youtube.mjs'));

// Minimal frontmatter read — the files are machine-written by Decap and always
// well formed, so a YAML dependency would be more risk than it removes.
function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

await mkdir(OUT_DIR, { recursive: true });

const previous = existsSync(INDEX)
  ? JSON.parse(await readFile(INDEX, 'utf8'))
  : { entries: [] };
const wasPulled = new Map((previous.entries ?? []).map(e => [e.slug, e]));

const files = (await readdir(FAQ_DIR)).filter(f => f.endsWith('.md')).sort();
const entries = [];
let pulled = 0, skipped = 0, failed = 0, noVideo = 0;

for (const file of files) {
  const slug = basename(file, '.md');
  const fm = frontmatter(await readFile(join(FAQ_DIR, file), 'utf8'));

  if (!fm.videoUrl) { noVideo++; continue; }

  let videoId;
  try {
    videoId = parseVideoId(fm.videoUrl);
  } catch {
    console.error(`  ✗ ${slug}: not a YouTube URL — ${fm.videoUrl}`);
    failed++;
    entries.push({ slug, question: fm.question, videoUrl: fm.videoUrl, status: 'bad-url' });
    continue;
  }

  const outFile = join(OUT_DIR, `${slug}.txt`);
  const prior = wasPulled.get(slug);

  // Already have this exact video's transcript — leave it alone.
  if (prior?.videoId === videoId && prior.status === 'ok' && existsSync(outFile)) {
    skipped++;
    entries.push(prior);
    continue;
  }

  try {
    const result = await getTranscript(videoId);
    const text = result.segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const header =
      `# ${fm.question ?? slug}\n` +
      `# video: https://www.youtube.com/watch?v=${videoId}\n` +
      `# captions: ${result.track?.kind === 'asr' ? 'auto-generated' : 'human'}\n` +
      `# NOTE: raw transcript. Write the FAQ answer FROM this, do not paste it in.\n\n`;
    await writeFile(outFile, header + text + '\n');
    pulled++;
    console.log(`  ✓ ${slug}: ${text.split(/\s+/).length} words`);
    entries.push({
      slug, question: fm.question, videoUrl: fm.videoUrl, videoId,
      status: 'ok',
      captions: result.track?.kind === 'asr' ? 'auto' : 'human',
      words: text.split(/\s+/).length,
      file: `seo-engine/transcripts/${slug}.txt`,
    });
  } catch (err) {
    const why = err instanceof TranscriptError ? err.code || err.message : err.message;
    console.error(`  ✗ ${slug}: ${why}`);
    failed++;
    entries.push({ slug, question: fm.question, videoUrl: fm.videoUrl, videoId, status: 'failed', error: String(why) });
  }
}

await writeFile(INDEX, JSON.stringify({ entries }, null, 2) + '\n');

console.log(
  `\n${files.length} FAQs · ${noVideo} without video · ` +
  `${pulled} pulled · ${skipped} already had one · ${failed} failed`,
);

// A failure must not fail the build — a video going private should not block a
// deploy. The dashboard reports it instead.
process.exit(0);
