#!/usr/bin/env node
/**
 * Assessor import — county parcel files → the parcels table (multifamily only).
 *
 * Usage:
 *   node bin/assessor.mjs --source maricopa --file ~/Downloads/parcels.csv --inspect
 *   node bin/assessor.mjs --source maricopa --file ~/Downloads/parcels.csv
 *   node bin/assessor.mjs --source tn --file ~/Downloads/davidson.csv --county-fips 47037
 *   node bin/assessor.mjs --source custom --file x.csv --state AR --county-fips 05007
 *
 * Workflow for a NEW file format: run --inspect first (no DB writes) — it
 * prints the headers, sample rows, which logical fields resolved, and a
 * multifamily-filter preview. Paste that into the build chat if fields are
 * missing; the column candidates get extended and you re-run.
 */
import { readFile } from 'node:fs/promises';
import { assessorToParcels, resolveColumns, PRESETS, sniffDelimiter, parseDSV } from '../lib/assessor.js';
import { importParcels } from '../lib/parcelimport.js';
import { makeDb } from '../lib/db.js';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const source = String(arg('source', ''));
const file = arg('file', null);
const INSPECT = Boolean(arg('inspect', false));
// Value flags must be real strings — a bare `--state` (no value) returns
// boolean true from arg() and would corrupt parcels.state / dedupe keys.
const str = (v) => (typeof v === 'string' ? v : null);
const state = str(arg('state', null));
const countyFips = str(arg('county-fips', null));
if (state && !/^[A-Za-z]{2}$/.test(state)) {
  console.error(`--state must be a 2-letter code (got "${state}")`);
  process.exit(1);
}
if (countyFips && !/^\d{5}$/.test(countyFips)) {
  console.error(`--county-fips must be a 5-digit FIPS code (got "${countyFips}")`);
  process.exit(1);
}

const preset = PRESETS[source];
if (!preset || !file) {
  console.error('Usage: node bin/assessor.mjs --source maricopa|tn|custom --file <path> [--inspect] [--state XX] [--county-fips NNNNN]');
  process.exit(1);
}
if (source === 'tn' && !countyFips && !INSPECT) {
  console.error('TN files are per-county — pass --county-fips (e.g. Davidson=47037, Perry=47135).');
  process.exit(1);
}
if (source === 'custom' && !state && !INSPECT) {
  // parcels.state is NOT NULL — a custom import without --state would fail
  // the whole upsert chunk with a raw 23502.
  console.error('--source custom requires --state XX (2-letter state code).');
  process.exit(1);
}

console.log(`Reading ${file} …`);
const text = await readFile(file, 'utf8');
console.log(`  ${(text.length / 1e6).toFixed(1)}MB`);

if (INSPECT) {
  const delim = sniffDelimiter(text);
  const rows = parseDSV(text, delim);
  const headers = rows[0] || [];
  const idx = resolveColumns(headers, preset.columns);
  console.log(`\nDelimiter: ${JSON.stringify(delim)} · ${rows.length - 1} data rows`);
  console.log(`\nHeaders (${headers.length}):\n  ${headers.join(' | ')}`);
  console.log('\nField resolution:');
  for (const [f, i] of Object.entries(idx)) {
    console.log(`  ${f.padEnd(16)} → ${i >= 0 ? headers[i] : '✗ NOT FOUND'}`);
  }
  console.log('\nSample rows:');
  for (const r of rows.slice(1, 4)) console.log(`  ${r.slice(0, 12).join(' | ')}`);
  const res = assessorToParcels(text, preset, { state, countyFips });
  console.log(`\nMultifamily filter preview: ${res.kept} of ${res.total} rows kept, ${res.dropped} dropped (no APN)`);
  if (res.parcels[0]) console.log('First parsed parcel:', JSON.stringify(res.parcels[0], null, 1));
  console.log('\nInspect only — nothing written. Paste this output into the build chat if fields are missing.');
  process.exit(0);
}

const res = assessorToParcels(text, preset, { state, countyFips });
console.log(`Parsed: ${res.kept} multifamily parcels of ${res.total} rows (${res.dropped} without APN)`);
if (res.unresolved.length) {
  console.warn(`⚠ Unresolved fields (will import as null): ${res.unresolved.join(', ')}`);
  console.warn('  Run with --inspect and paste the output into the build chat to map them.');
}
if (!res.kept) {
  console.error('✗ Nothing matched the multifamily filter — run --inspect to check the class/units columns.');
  process.exit(1);
}

const db = makeDb();
const orgId = await db.resolveOrgId();
const stats = await importParcels(db, orgId, res.parcels);
await db.logCost(orgId, `assessor import ${source}: ${stats.imported} MF parcels`);

console.log(`✓ Imported ${stats.imported} multifamily parcels.`);
console.log(`  absentee: ${stats.absentee} · entity-owned: ${stats.entity} · with real unit counts: ${stats.withUnits}`);
console.log('  Open the app → Off-Market to build lists and export FreedomSoft CSVs.');
