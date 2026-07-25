#!/usr/bin/env node
/**
 * HUD Small Area FMR importer — bedroom-level rent SHAPE, free.
 *
 * Usage:
 *   node bin/hudfmr.mjs                      # every county with parcels/deals
 *   node bin/hudfmr.mjs --states AZ,TN
 *   node bin/hudfmr.mjs --counties 04013,47037
 *   node bin/hudfmr.mjs --year 2026
 *   node bin/hudfmr.mjs --dry-run            # fetch + report, no writes
 *
 * Needs HUD_API_TOKEN in the environment (free — see workers/scan/README.md).
 *
 * What this is FOR: ZORI gives an accurate rent LEVEL per zip but blends all
 * bedroom counts together. SAFMR gives an accurate bedroom SHAPE but at
 * policy levels, not market. Storing both lets mf-calc reshape the ZORI level
 * to a bedroom count — neither source is used for the job it is bad at.
 *
 * Rows upsert on (org_id, source, zip, period, bedrooms), so re-runs are
 * idempotent and vintages accumulate. FMRs change once a year (Oct 1), so
 * running this annually is enough.
 */
import { makeDb } from '../lib/db.js';
import {
  hudDataUrl,
  hudAuthHeaders,
  parseFmrResponse,
  toRentBandRows,
  isRealZip,
} from '../lib/hudfmr.js';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const DRY = Boolean(arg('dry-run', false));
const YEAR = arg('year', null);
const statesArg = arg('states', null);
const countiesArg = arg('counties', null);

const token = process.env.HUD_API_TOKEN;
if (!token) {
  console.error(
    'Set HUD_API_TOKEN in workers/scan/.env (loaded automatically). Free: sign in at https://www.huduser.gov/portal/dataset/fmr-api.html\n' +
      '→ Create New Token, then add HUD_API_TOKEN=... to workers/scan/.env',
  );
  process.exit(1);
}

const db = makeDb();
const orgId = await db.resolveOrgId();

/** Counties to pull: explicit flag, else every county fips we hold data for. */
async function targetCounties() {
  if (countiesArg && countiesArg !== true) {
    return String(countiesArg).split(',').map((s) => s.trim()).filter(Boolean).map((fips) => ({ fips, state: null }));
  }
  const wanted = statesArg && statesArg !== true
    ? String(statesArg).split(',').map((s) => s.trim().toUpperCase())
    : null;

  // Walk the DISTINCT county codes with a loose index scan: ask for the
  // smallest fips greater than the last one seen, one row at a time. Costs
  // one request per county.
  //
  // The obvious version — select every parcel and dedupe in memory — is
  // broken however large the .limit() looks: PostgREST caps a request at 1000
  // rows, so with 12,278 Maricopa parcels ahead of 8,842 Davidson ones it
  // returned nothing but Maricopa and Nashville was silently never attempted.
  const seen = new Map();
  let cursor = null;
  for (let guard = 0; guard < 500; guard++) {
    let q = db.supabase
      .from('parcels')
      .select('county_fips, state')
      .eq('org_id', orgId)
      .not('county_fips', 'is', null)
      .order('county_fips', { ascending: true })
      .limit(1);
    if (wanted) q = q.in('state', wanted);
    if (cursor) q = q.gt('county_fips', cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    seen.set(data[0].county_fips, data[0].state);
    cursor = data[0].county_fips;
  }
  return [...seen].map(([fips, state]) => ({ fips, state }));
}

const counties = await targetCounties();
if (!counties.length) {
  console.log('No counties to pull — import parcels first, or pass --counties.');
  process.exit(0);
}
console.log(`HUD SAFMR for ${counties.length} county/counties: ${counties.map((c) => c.fips).join(', ')}`);

const now = new Date().toISOString();
let allRows = [];
for (const c of counties) {
  // HUD county entity ids are the 5-digit fips padded with 99999.
  const entity = c.fips.length === 5 ? `${c.fips}99999` : c.fips;
  const url = hudDataUrl(entity, YEAR && YEAR !== true ? YEAR : undefined);
  try {
    const res = await fetch(url, { headers: hudAuthHeaders(token) });
    if (!res.ok) {
      console.warn(`  ✗ ${c.fips}: HTTP ${res.status} ${res.statusText} (${url})`);
      continue;
    }
    const json = await res.json();
    const parsed = parseFmrResponse(json);
    const zipRows = parsed.filter((p) => p.zip);
    if (!zipRows.length) {
      // Not a designated small area: HUD publishes one area-wide figure, so
      // there is no bedroom shape that varies by zip to import.
      console.warn(`  – ${c.fips}: no zip-level SAFMR (area-wide only) — skipped`);
      continue;
    }
    const rows = toRentBandRows(zipRows, { orgId, state: c.state, period: YEAR && YEAR !== true ? String(YEAR) : null, now });
    console.log(`  ✓ ${c.fips}: ${zipRows.length} zips · ${rows.length} bedroom rows`);
    allRows.push(...rows);
  } catch (e) {
    console.warn(`  ✗ ${c.fips}: ${e.message}`);
  }
}

if (!allRows.length) {
  console.error('Nothing to import — see the messages above.');
  process.exit(1);
}

const sample = allRows.slice(0, 5).map((r) => `${r.zip}/${r.bedrooms}bd=$${r.rent}`).join(', ');
if (DRY) {
  console.log(`[dry-run] would upsert ${allRows.length} rows. e.g. ${sample}`);
  process.exit(0);
}

const CHUNK = 500;
for (let i = 0; i < allRows.length; i += CHUNK) {
  const { error } = await db.supabase
    .from('rent_bands')
    .upsert(allRows.slice(i, i + CHUNK), { onConflict: 'org_id,source,zip,period,bedrooms' });
  if (error) {
    console.error('✗ upsert failed:', error.message);
    process.exit(1);
  }
  process.stdout.write(`  upserted ${Math.min(i + CHUNK, allRows.length)}/${allRows.length}\r`);
}
console.log('');

// Sweep out anything a previous run stored under a non-ZIP key. Earlier
// versions truncated HUD's "MSA level" summary rows into the fake ZIP
// "MSA l"; those rows will never be rewritten now that they are rejected at
// parse time, so they have to be deleted or they linger forever.
// Distinct keys are walked with a loose index scan (the 1000-row cap makes a
// plain select unreliable), then deleted by exact value — never by pattern,
// so a real ZIP cannot be caught by accident.
const badZips = [];
let zipCursor = null;
for (let guard = 0; guard < 5000; guard++) {
  let q = db.supabase
    .from('rent_bands')
    .select('zip')
    .eq('org_id', orgId)
    .eq('source', 'hud-safmr')
    .order('zip', { ascending: true })
    .limit(1);
  if (zipCursor) q = q.gt('zip', zipCursor);
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) break;
  zipCursor = data[0].zip;
  if (!isRealZip(zipCursor)) badZips.push(zipCursor);
}
if (badZips.length) {
  const { error } = await db.supabase
    .from('rent_bands')
    .delete()
    .eq('org_id', orgId)
    .eq('source', 'hud-safmr')
    .in('zip', badZips);
  if (error) console.warn(`  ⚠ could not remove non-ZIP rows: ${error.message}`);
  else console.log(`  cleaned ${badZips.length} non-ZIP key(s) from earlier runs: ${badZips.join(', ')}`);
}

await db.logCost(orgId, `HUD SAFMR import: ${allRows.length} bedroom rows`);
console.log(`✓ Imported ${allRows.length} SAFMR bedroom rows. e.g. ${sample}`);
console.log('  The app now reshapes ZORI zip rents to each unit\'s bedroom count.');
