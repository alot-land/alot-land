#!/usr/bin/env node
/**
 * US market data pull (Phase 3) — Zillow + Census + FEMA, county level,
 * ~3,000 rows into market_stats. Runs on open-internet machines
 * (droplet/laptop). ~6 HTTP requests total; data updates monthly at most,
 * so the auto-refresh cadence is 90 days.
 *
 * Usage:
 *   node bin/usmarkets.mjs            # skip if data is <90 days old
 *   node bin/usmarkets.mjs --force
 *
 * A failed source degrades gracefully (e.g. FEMA down → no risk fields
 * this cycle) EXCEPT Zillow ZHVI, which is the base set.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { politeFetch } from '../lib/redfin.js';
import { zillowSnapshots, acsMap, nriMap, gazetteerMap, buildMarketStats } from '../lib/usmarkets.js';
import { makeDb } from '../lib/db.js';

const FORCE = process.argv.includes('--force');
const FRESH_DAYS = 90;

const ZHVI_URL =
  'https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv';
const ZORI_URLS = [
  'https://files.zillowstatic.com/research/public_csvs/zori/County_zori_uc_sfrcondomfr_sm_sa_month.csv',
  'https://files.zillowstatic.com/research/public_csvs/zori/County_zori_uc_sfrcondomfr_sm_month.csv',
];
const ACS_FIELDS = {
  population: 'B01003_001E',
  median_home_value: 'B25077_001E',
  median_re_tax: 'B25103_001E',
  renters: 'B25003_003E',
  occupied_units: 'B25003_001E',
  vacant_for_rent: 'B25004_002E',
};
const acsUrl = (year, codes) =>
  `https://api.census.gov/data/${year}/acs/acs5?get=NAME,${codes.join(',')}&for=county:*`;
// FEMA publishes the NRI counties table BOTH as a zip on hazards.fema.gov
// (403s from datacenter IPs) and as an ArcGIS-hosted dataset ("National
// Risk Index Counties", item 39485e8035d446a5bff03259508ae355) — the Hub
// CSV route is the same API that works for the Nashville parcels, so it
// goes first.
const NRI_SOURCES = [
  { kind: 'csv', url: 'https://hub.arcgis.com/api/v3/datasets/39485e8035d446a5bff03259508ae355_0/downloads/data?format=csv&spatialRefId=4326' },
  { kind: 'zip', url: 'https://hazards.fema.gov/nri/Content/StaticDocuments/DataDownload/NRI_Table_Counties/NRI_Table_Counties.zip' },
];

async function fetchNriCsv() {
  let lastErr = null;
  for (const s of NRI_SOURCES) {
    try {
      if (s.kind === 'csv') {
        const text = await fetchText(s.url);
        if (text.trimStart().startsWith('<')) throw new Error('HTML instead of CSV');
        console.log(`  nri via ${s.url}`);
        return text;
      }
      return await fetchZipText([s.url], 'nri', /NRI_Table_Counties\.csv$/i);
    } catch (e) {
      lastErr = e;
      console.warn(`  nri: ${s.url}: ${e.message}`);
    }
  }
  throw lastErr || new Error('all NRI sources failed');
}
// NB: capital "Gaz" in the filename — the lowercase variant 404s (verified
// in the field 2026-07-24).
const GAZ_URLS = [2025, 2024, 2023].map(
  (y) => `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${y}_Gazetteer/${y}_Gaz_counties_national.zip`,
);
// FEMA's WAF 403s bare fetches; a Referer + browser Accept gets the real file.
const BROWSERISH = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://hazards.fema.gov/nri/data-resources',
};

async function fetchText(url, headers) {
  const res = await politeFetch(url, fetch, headers);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

/** ACS occasionally serves an HTML page instead of JSON — retry once. */
async function fetchAcsJson(url) {
  const key = process.env.CENSUS_API_KEY;
  const full = key ? `${url}&key=${key}` : url;
  for (let attempt = 1; ; attempt++) {
    const text = await fetchText(full);
    try {
      if (text.trimStart().startsWith('<')) throw new Error('HTML response');
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= 2) throw new Error(`ACS non-JSON after retry (${e.message}): ${text.slice(0, 150)}`);
      console.warn(`  ACS returned non-JSON (attempt ${attempt}) — retrying in 5s…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function fetchFirst(urls, kind) {
  let lastErr = null;
  for (const u of urls) {
    try {
      return { text: await fetchText(u), url: u };
    } catch (e) {
      lastErr = e;
      console.warn(`  ${kind}: ${e.message}`);
    }
  }
  throw lastErr || new Error(`${kind}: all candidate URLs failed`);
}

async function fetchZipText(urls, kind, filePattern) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await politeFetch(u, fetch, kind === 'nri' ? BROWSERISH : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const dir = mkdtempSync(join(tmpdir(), `mfda-${kind}-`));
      const zipPath = join(dir, 'dl.zip');
      writeFileSync(zipPath, buf);
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
      const files = readdirSync(dir, { recursive: true })
        .map((f) => join(dir, String(f)))
        .filter((f) => filePattern.test(f) && statSync(f).isFile())
        .sort((a, b) => statSync(b).size - statSync(a).size);
      if (!files.length) throw new Error('zip had no matching data file');
      console.log(`  ${kind}: ${u} → ${files[0]}`);
      return readFileSync(files[0], 'utf8');
    } catch (e) {
      lastErr = e;
      console.warn(`  ${kind}: ${u}: ${e.message}`);
    }
  }
  throw lastErr || new Error(`${kind}: all candidate URLs failed`);
}

const db = makeDb();
const orgId = await db.resolveOrgId();

if (!FORCE) {
  const { data } = await db.supabase
    .from('market_stats')
    .select('retrieved_at')
    .eq('org_id', orgId)
    .order('retrieved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data && (Date.now() - new Date(data.retrieved_at).getTime()) / 86400e3 < FRESH_DAYS) {
    console.log(`market_stats is fresh (<${FRESH_DAYS}d) — nothing to do (use --force to refresh).`);
    process.exit(0);
  }
}

const runId = await db.startScanRun(orgId, 'usmarkets', 'auto');
try {
  console.log('→ Zillow ZHVI (county home values)…');
  const zhvi = zillowSnapshots(await fetchText(ZHVI_URL));
  console.log(`  ${zhvi.size} counties`);

  let zori = new Map();
  try {
    console.log('→ Zillow ZORI (county rents)…');
    zori = zillowSnapshots((await fetchFirst(ZORI_URLS, 'zori')).text);
    console.log(`  ${zori.size} counties`);
  } catch (e) {
    console.warn(`  ZORI unavailable this cycle: ${e.message}`);
  }

  let acsNow = new Map();
  let acsOld = new Map();
  try {
    console.log('→ Census ACS (2023 + 2018 5-year)…');
    acsNow = acsMap(await fetchAcsJson(acsUrl(2023, Object.values(ACS_FIELDS))), ACS_FIELDS);
    acsOld = acsMap(await fetchAcsJson(acsUrl(2018, ['B01003_001E'])), { population: 'B01003_001E' });
    console.log(`  ${acsNow.size} counties now · ${acsOld.size} 5y-ago`);
  } catch (e) {
    console.warn(`  ACS unavailable this cycle: ${e.message}`);
  }

  let nri = new Map();
  try {
    console.log('→ FEMA National Risk Index…');
    nri = nriMap(await fetchNriCsv());
    console.log(`  ${nri.size} counties`);
  } catch (e) {
    console.warn(`  NRI unavailable this cycle: ${e.message}`);
  }

  let gaz = new Map();
  try {
    console.log('→ Census Gazetteer (centroids/areas)…');
    gaz = gazetteerMap(await fetchZipText(GAZ_URLS, 'gaz', /gaz_counties_national\.txt$/i));
    console.log(`  ${gaz.size} counties`);
  } catch (e) {
    console.warn(`  Gazetteer unavailable this cycle: ${e.message}`);
  }

  const rows = buildMarketStats({ zhvi, zori, acsNow, acsOld, nri, gaz }).map((r) => ({
    ...r,
    org_id: orgId,
    retrieved_at: new Date().toISOString(),
  }));
  console.log(`→ upserting ${rows.length} market_stats rows…`);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.supabase
      .from('market_stats')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'org_id,geo_level,geo_id' });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }

  const withRent = rows.filter((r) => r.zori_now != null).length;
  const withRisk = rows.filter((r) => r.nri_score != null).length;
  await db.finishScanRun(runId, {
    ok: true,
    blocked: false,
    rows_fetched: rows.length,
    rows_active: withRent,
    rows_sold: 0,
    notes: `usmarkets: ${rows.length} counties · ${withRent} with rents · ${withRisk} with risk`,
  });
  await db.logCost(orgId, `usmarkets pull: ${rows.length} counties (zillow+acs+nri+gazetteer)`);
  console.log(`✓ ${rows.length} counties · ${withRent} with rent data · ${withRisk} with risk data`);
  console.log('  Open the app → Markets to explore.');
} catch (e) {
  await db
    .finishScanRun(runId, { ok: false, blocked: false, rows_fetched: 0, rows_active: 0, rows_sold: 0, notes: `FAILED: ${e.message}`.slice(0, 2000) })
    .catch(() => {});
  console.error(`✗ usmarkets: ${e.message}`);
  process.exit(1);
}
