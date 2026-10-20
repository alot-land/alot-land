#!/usr/bin/env node
/**
 * Emits the lots that may trigger an agent notification.
 *
 * Netlify Functions cannot read Astro content collections, so the list is
 * generated at build time. A lot that sells, is hidden, or is still "coming
 * soon" drops out — and because the policy is fail-closed, dropping out means
 * no agent is notified about it rather than the check being skipped.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'src/content/listings';
const files = (await readdir(DIR)).filter(f => f.endsWith('.md'));
const lots = [];

for (const f of files) {
  const raw = await readFile(join(DIR, f), 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] ?? '';
  const get = k => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const slug = f.replace(/\.md$/, '');
  const status = get('status');
  const visible = get('visible');
  if (status !== 'available') continue;
  if (visible === 'false') continue;
  lots.push({ slug, title: get('title') ?? '', price: get('price') ?? '' });
}

lots.sort((a, b) => a.slug.localeCompare(b.slug));
await writeFile('lead-engine/eligible-lots.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), lots }, null, 2) + '\n');
console.log(`eligible-lots: ${lots.length} available lot(s) — ${lots.map(l => l.slug).join(', ') || 'none'}`);
