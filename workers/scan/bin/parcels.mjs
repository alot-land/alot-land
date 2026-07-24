#!/usr/bin/env node
/**
 * Zero-operator county parcel pull — discovers, downloads, and imports
 * multifamily assessor data. Runs on a machine with open internet + DB env
 * (droplet/laptop) — NOT the browser app.
 *
 * Usage:
 *   node bin/parcels.mjs                         # all lanes
 *   node bin/parcels.mjs --source maricopa
 *   node bin/parcels.mjs --source nashville
 *   node bin/parcels.mjs --discover-only         # print found links, no writes
 *
 * Lanes:
 *   maricopa   Assessor free bulk downloads (Apartment Master + ownership
 *              backfill), links discovered from the Data Downloads page.
 *   nashville  Davidson Co TN via data.nashville.gov (Socrata), dataset
 *              chosen from the catalog API at runtime.
 *
 * Design: same citizenship rules as the Redfin lane (real UA, 1.5s global
 * throttle via politeFetch, stop on challenge). Every lane writes a
 * scan_runs row, so results show up in the app and the morning digest.
 * A lane that can't confidently map its columns imports NOTHING and prints
 * a full parse report — paste that into the build chat to iterate.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { politeFetch } from '../lib/redfin.js';
import { assessorToParcels, looksLikeEntity, isAbsentee, PRESETS } from '../lib/assessor.js';
import {
  MARICOPA_PAGES,
  NASHVILLE_CATALOG_URL,
  extractLinks,
  pickMaricopaFiles,
  socrataPickDataset,
  socrataCsvUrl,
  mergeOwnership,
} from '../lib/parcelsources.js';
import { essentialsOk, inspectReport, importParcels } from '../lib/parcelimport.js';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const source = String(arg('source', 'all'));
const DISCOVER_ONLY = Boolean(arg('discover-only', false));
const MAX_FILE_MB = 400;

async function fetchOk(url) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res;
}

function unzipToTmp(buf, label) {
  const dir = mkdtempSync(join(tmpdir(), `mfda-${label}-`));
  const zipPath = join(dir, 'dl.zip');
  writeFileSync(zipPath, buf);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]); // ubiquitous on the droplet; errors bubble up
  const files = readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => /\.(txt|csv|dat)$/i.test(f) && statSync(f).isFile())
    .sort((a, b) => statSync(b).size - statSync(a).size);
  if (!files.length) throw new Error('zip contained no .txt/.csv/.dat data file');
  const size = statSync(files[0]).size;
  if (size > MAX_FILE_MB * 1e6) throw new Error(`data file is ${Math.round(size / 1e6)}MB — over the ${MAX_FILE_MB}MB guard`);
  return files[0];
}

async function downloadDataFile(url, label) {
  console.log(`  downloading ${url}`);
  const res = await fetchOk(url);
  if (/\.zip(\?|$)/i.test(url)) {
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`  ${(buf.length / 1e6).toFixed(1)}MB zip`);
    const file = unzipToTmp(buf, label);
    console.log(`  unzipped → ${file} (${(statSync(file).size / 1e6).toFixed(1)}MB)`);
    return readFileSync(file, 'utf8');
  }
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('got an HTML page where a data file was expected (challenge?)');
  return text;
}

// ---- Maricopa lane --------------------------------------------------------
async function maricopaLane() {
  let picked = null;
  for (const page of MARICOPA_PAGES) {
    try {
      console.log(`  reading ${page}`);
      const html = await (await fetchOk(page)).text();
      const files = pickMaricopaFiles(extractLinks(html, page));
      console.log(`  found ${files.all.length} data links · apartment=${files.apartment || 'none'} · ownership=${files.ownership || 'none'}`);
      if (files.apartment) {
        picked = files;
        break;
      }
    } catch (e) {
      console.warn(`  ${page}: ${e.message}`);
    }
  }
  if (!picked) throw new Error('no Apartment Master link found on any Maricopa page');
  if (DISCOVER_ONLY) return { discovered: picked };

  const text = await downloadDataFile(picked.apartment, 'maricopa-apt');
  // The Apartment Master IS the multifamily filter — keep every parsed row.
  const res = assessorToParcels(text, PRESETS.maricopa_apartments);
  console.log(inspectReport(res, 'maricopa apartment master'));
  if (res.unresolved.includes('apn')) {
    throw new Error('APN column did not resolve — paste the parse report above into the build chat');
  }

  // Owner mailing missing from the apartment file? Backfill from the
  // ownership bulk file, joined on APN.
  if ((res.unresolved.includes('owner_name') || res.unresolved.includes('mailing_address')) && picked.ownership) {
    console.log('  owner/mailing not in apartment file — pulling ownership file for backfill');
    const otext = await downloadDataFile(picked.ownership, 'maricopa-own');
    const ores = assessorToParcels(otext, { ...PRESETS.maricopa_apartments });
    console.log(inspectReport(ores, 'maricopa ownership'));
    const { merged } = mergeOwnership(res.parcels, ores.parcels, { looksLikeEntity, isAbsentee });
    console.log(`  merged owner/mailing onto ${merged} of ${res.parcels.length} parcels`);
    if (merged > 0) res.unresolved = res.unresolved.filter((f) => !['owner_name', 'mailing_address'].includes(f));
  }

  if (!essentialsOk(res)) {
    throw new Error(`essential fields unresolved (${res.unresolved.join(', ')}) — imported nothing; paste the parse report into the build chat`);
  }
  return { res };
}

// ---- Nashville lane -------------------------------------------------------
async function nashvilleLane() {
  console.log(`  querying Socrata catalog`);
  const cat = JSON.parse(await (await fetchOk(NASHVILLE_CATALOG_URL)).text());
  const ds = socrataPickDataset(cat);
  if (!ds) throw new Error('no assessor-shaped dataset found in the data.nashville.gov catalog');
  console.log(`  picked dataset ${ds.id} "${ds.name}" (score ${ds.score})`);
  console.log(`  columns: ${(ds.columns || []).join(', ')}`);
  if (DISCOVER_ONLY) return { discovered: ds };

  const LIMIT = 50000;
  let text = '';
  for (let offset = 0; offset < 600000; offset += LIMIT) {
    const page = await (await fetchOk(socrataCsvUrl('data.nashville.gov', ds.id, { limit: LIMIT, offset }))).text();
    const body = offset === 0 ? page : page.slice(page.indexOf('\n') + 1);
    text += body.endsWith('\n') ? body : body + '\n';
    const rows = page.split('\n').length - 1;
    console.log(`  fetched ${offset + Math.max(rows - (offset === 0 ? 1 : 0), 0)} rows…`);
    if (rows < LIMIT) break;
  }

  const res = assessorToParcels(text, PRESETS.tn, { countyFips: '47037' });
  console.log(inspectReport(res, 'nashville socrata'));
  if (!essentialsOk(res)) {
    throw new Error(`essential fields unresolved (${res.unresolved.join(', ')}) — imported nothing; paste the parse report into the build chat`);
  }
  if (!res.kept) throw new Error('0 rows passed the multifamily filter — class/units mapping needs a look; paste the report above');
  return { res };
}

// ---- Orchestration --------------------------------------------------------
const LANES = { maricopa: maricopaLane, nashville: nashvilleLane };
const toRun = source === 'all' ? Object.keys(LANES) : [source];
if (toRun.some((k) => !LANES[k])) {
  console.error(`--source must be one of: ${Object.keys(LANES).join(', ')}, all`);
  process.exit(1);
}

let db = null;
let orgId = null;
if (!DISCOVER_ONLY) {
  const { makeDb } = await import('../lib/db.js');
  db = makeDb();
  orgId = await db.resolveOrgId();
}

let failures = 0;
for (const key of toRun) {
  console.log(`\n→ parcels lane: ${key}`);
  let runId = null;
  try {
    if (!DISCOVER_ONLY) runId = await db.startScanRun(orgId, `parcels-${key}`, 'auto');
    const out = await LANES[key]();
    if (DISCOVER_ONLY) {
      console.log(`  discover-only: ${JSON.stringify(out.discovered, null, 1)}`);
      continue;
    }
    const stats = await importParcels(db, orgId, out.res.parcels);
    console.log(
      `✓ ${key}: imported ${stats.imported} MF parcels · absentee ${stats.absentee} · entity ${stats.entity} · with units ${stats.withUnits}`,
    );
    await db.finishScanRun(runId, {
      ok: true,
      blocked: false,
      rows_fetched: out.res.total,
      rows_active: stats.imported,
      rows_sold: 0,
      notes: `parcels auto-import: ${stats.imported} imported, ${stats.absentee} absentee, ${stats.entity} entity`,
    });
    await db.logCost(orgId, `parcels auto-import ${key}: ${stats.imported} rows`);
  } catch (e) {
    failures++;
    console.error(`✗ ${key}: ${e.message}`);
    if (runId) {
      await db
        .finishScanRun(runId, { ok: false, blocked: false, rows_fetched: 0, rows_active: 0, rows_sold: 0, notes: `FAILED: ${e.message}`.slice(0, 2000) })
        .catch(() => {});
    }
  }
}

process.exit(failures && toRun.length === failures ? 1 : 0);
