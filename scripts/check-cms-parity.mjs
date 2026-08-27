#!/usr/bin/env node
/**
 * Checks that every field in the content schema is exposed in the CMS.
 *
 * A field present in src/content/config.ts but missing from
 * public/admin/config.yml is deleted the moment anyone saves that entry —
 * Decap rewrites the file from only the fields it knows. There is no error and
 * no warning; it surfaces later as scrambled ordering or a vanished section.
 *
 * Also checks for duplicate collection and file names, which take the whole
 * CMS offline rather than failing quietly.
 */
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const src = readFileSync('src/content/config.ts', 'utf8');
const cms = YAML.parse(readFileSync('public/admin/config.yml', 'utf8'));

const zod = {};
for (const [, name, body] of src.matchAll(/const (\w+) = defineCollection\(\{([\s\S]*?)\n\}\);/g)) {
  zod[name] = [...body.matchAll(/^    (\w+):/gm)].map(m => m[1]);
}

let problems = 0;

const names = cms.collections.map(c => c.name);
const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
if (dupes.length) { console.error(`✗ duplicate collection names: ${dupes.join(', ')}`); problems++; }

for (const c of cms.collections) {
  const fileNames = (c.files ?? []).map(f => f.name);
  const fileDupes = [...new Set(fileNames.filter((n, i) => fileNames.indexOf(n) !== i))];
  if (fileDupes.length) { console.error(`✗ ${c.name}: duplicate file names — ${fileDupes.join(', ')}`); problems++; }

  const declared = zod[c.name];
  if (!declared) continue;
  const exposed = c.fields
    ? c.fields.map(f => f.name)
    : [...new Set((c.files ?? []).flatMap(f => (f.fields ?? []).map(x => x.name)))];
  const missing = declared.filter(f => !exposed.includes(f));
  if (missing.length) {
    console.error(`✗ ${c.name}: in the schema but not in the CMS — ${missing.join(', ')} (these are deleted on save)`);
    problems++;
  }
}

if (problems) {
  console.error(`\n${problems} problem(s). Add the missing fields to public/admin/config.yml.`);
  process.exit(1);
}
console.log('✓ CMS and content schema agree; no duplicate names.');
