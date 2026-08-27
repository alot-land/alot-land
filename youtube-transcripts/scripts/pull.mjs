#!/usr/bin/env node
/**
 * Command-line transcript puller — the same core the web app uses.
 *
 *   npm run pull -- <url|id> [--lang en] [--translate es] [--format txt] [--out file]
 *
 * Formats: txt (default), timestamped, md, srt, vtt, json.
 */
import { writeFile } from 'node:fs/promises';
import { getTranscript, parseVideoId, TranscriptError } from '../shared/youtube.mjs';
import { FORMATS, suggestFilename } from '../shared/formats.mjs';

function parseArgs(argv) {
  const options = { format: 'txt' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang' || arg === '--translate' || arg === '--format' || arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

const USAGE = `Usage: npm run pull -- <youtube-url-or-id> [options]

Options:
  --lang <key>       Caption track key, e.g. "en" or "en.auto"
  --translate <code> Have YouTube machine-translate the track, e.g. "es"
  --format <name>    ${Object.keys(FORMATS).join(' | ')}   (default: txt)
  --out <path>       Write to a file instead of stdout ("auto" names it from the title)
`;

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));

  if (options.help || positional.length === 0) {
    process.stdout.write(USAGE);
    process.exit(positional.length === 0 && !options.help ? 1 : 0);
  }

  if (!Object.hasOwn(FORMATS, options.format)) {
    throw new Error(`Unknown format "${options.format}". Try: ${Object.keys(FORMATS).join(', ')}.`);
  }

  const videoId = parseVideoId(positional[0]);
  if (!videoId) throw new Error(`Could not find a video ID in "${positional[0]}".`);

  const result = await getTranscript(videoId, {
    lang: options.lang,
    translateTo: options.translate,
  });
  const rendered = FORMATS[options.format].render(result);

  if (options.out) {
    const path = options.out === 'auto' ? suggestFilename(result, options.format) : options.out;
    await writeFile(path, rendered, 'utf8');
    process.stderr.write(`Wrote ${result.segments.length} lines to ${path}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof TranscriptError ? `${error.code}: ${error.message}` : error.message;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
