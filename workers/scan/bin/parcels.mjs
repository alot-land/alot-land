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
import { request as httpsRequest } from 'node:https';
import {
  MARICOPA_PAGES,
  MARICOPA_ARCGIS_QUERIES,
  MARICOPA_REST_ROOTS,
  restCatalogServices,
  rankParcelServices,
  ARCGIS_SEARCH_URL,
  pickMaricopaService,
  MARICOPA_PORTALS,
  MARICOPA_PORTAL_QUERIES,
  PORTAL_SEARCH_URL,
  PORTAL_SELF_URL,
  portalOrgId,
  pickPortalService,
  multifamilyWhereClauses,
  rankClassFields,
  layerFieldNames,
  NASHVILLE_CATALOG_URL,
  NASHVILLE_HUB_DATASETS,
  hubDownloadUrl,
  arcgisQueryUrl,
  pickClassField,
  featuresToRows,
  rowsToCsv,
  extractLinks,
  extractFileUrls,
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

/**
 * mcassessor.maricopa.gov serves an INCOMPLETE TLS chain (missing its
 * Entrust intermediate — field-verified 2026-07-24), so Node's fetch
 * rejects it. For *.maricopa.gov only, fall back to a raw HTTPS GET with
 * verification off. Public bulk-download data; shape is validated after.
 */
function insecureGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('too many redirects'));
    const req = httpsRequest(
      url,
      { rejectUnauthorized: false, headers: { 'User-Agent': UA_STRING } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(insecureGet(new URL(res.headers.location, url).href, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} on ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const UA_STRING =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Node buries TLS codes at varying depths (err.cause.cause…) — unwrap fully.
function isTlsChainError(e) {
  let cur = e;
  for (let i = 0; cur && i < 6; i++) {
    if (/UNABLE_TO_VERIFY|unable to verify|certificate|CERT_/i.test(`${cur.code || ''} ${cur.message || ''}`)) return true;
    cur = cur.cause;
  }
  return false;
}

/** Fetch a Maricopa URL: normal path first, raw-HTTPS fallback second.
 * Their hosts fail Node's fetch in more ways than one (incomplete TLS
 * chain on www, opaque "fetch failed" on api/ftp — field-verified), so any
 * fetch failure on *.maricopa.gov falls back. */
async function maricopaFetch(url, asBuffer = false) {
  try {
    const res = await fetchOk(url);
    return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } catch (e) {
    if (!new URL(url).hostname.endsWith('maricopa.gov')) throw e;
    const why = isTlsChainError(e) ? 'TLS chain incomplete' : `fetch failed (${e.message})`;
    console.warn(`  ${why} on ${new URL(url).hostname} — using raw-HTTPS fallback`);
    const buf = await insecureGet(url);
    return asBuffer ? buf : buf.toString('utf8');
  }
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

async function downloadDataFile(url, label, { viaMaricopa = false } = {}) {
  console.log(`  downloading ${url}`);
  const getBuf = async () =>
    viaMaricopa ? maricopaFetch(url, true) : Buffer.from(await (await fetchOk(url)).arrayBuffer());
  if (/\.zip(\?|$)/i.test(url)) {
    const buf = await getBuf();
    console.log(`  ${(buf.length / 1e6).toFixed(1)}MB zip`);
    const file = unzipToTmp(buf, label);
    console.log(`  unzipped → ${file} (${(statSync(file).size / 1e6).toFixed(1)}MB)`);
    return readFileSync(file, 'utf8');
  }
  const text = viaMaricopa ? await maricopaFetch(url) : await (await fetchOk(url)).text();
  if (text.trimStart().startsWith('<')) throw new Error('got an HTML page where a data file was expected (challenge?)');
  return text;
}

// ---- Maricopa lane --------------------------------------------------------
// Primary: county GIS parcels via ArcGIS, filtered server-side to
// multifamily PUC (03xx) so only ~tens of thousands of rows transfer.
// Fallback: scrape the assessor's data-sales pages for bulk files.
/** Page a layer's rows for a WHERE clause (shared by both ArcGIS routes). */
async function queryArcgisLayer(layerUrl, where) {
  const rows = [];
  for (let offset = 0; offset < 300000; offset += 2000) {
    const j = JSON.parse(await (await fetchOk(arcgisQueryUrl(layerUrl, { where, offset }))).text());
    if (j.error) throw new Error(`arcgis error: ${JSON.stringify(j.error).slice(0, 200)}`);
    const page = featuresToRows(j);
    rows.push(...page);
    process.stdout.write(`  ${rows.length} multifamily features…\r`);
    if (page.length < 2000) break;
  }
  console.log('');
  return rows;
}

/** Try a candidate parcel layer: read fields, find the class field, query MF. */
async function tryParcelLayer(layerUrl) {
  const layerJson = JSON.parse(await (await fetchOk(`${layerUrl}?f=json`)).text());
  const fields = layerFieldNames(layerJson);
  if (!fields.length) throw new Error('no fields');
  console.log(`  fields (${fields.length}): ${fields.join(', ')}`);
  // A layer usually carries several use/class columns and only one holds the
  // multifamily codes, so sweep them best-first. Each column may be text or
  // numeric, or hold descriptions rather than codes — try every shape.
  const candidates = rankClassFields(fields);
  if (!candidates.length) throw new Error('no PUC/land-use field');
  console.log(`  class-field candidates: ${candidates.join(' · ')}`);
  const attempts = [];
  for (const classField of candidates) {
    for (const where of multifamilyWhereClauses(classField)) {
      try {
        console.log(`  querying where ${where}`);
        const rows = await queryArcgisLayer(layerUrl, where);
        if (rows.length) {
          console.log(`  ✓ ${rows.length} rows via ${classField}`);
          return rows;
        }
        attempts.push(`"${where}" → 0 rows`);
      } catch (e) {
        attempts.push(`"${where}" → ${e.message}`);
      }
    }
  }
  throw new Error(`no multifamily rows on any of ${candidates.join(', ')}: ${attempts.join(' · ')}`);
}

/** Maricopa's own ArcGIS Online portals — only county-published items. */
async function maricopaViaPortal() {
  let lastErr = null;
  for (const portal of MARICOPA_PORTALS) {
    // /search is NOT scoped to the host portal — without the org id it
    // returns items from every county on ArcGIS Online.
    let orgId = null;
    try {
      orgId = portalOrgId(JSON.parse(await (await fetchOk(PORTAL_SELF_URL(portal))).text()));
      console.log(`  ${portal} org id: ${orgId || 'unknown'}`);
    } catch (e) {
      console.warn(`  ${portal} portals/self: ${e.message}`);
    }
    for (const q of MARICOPA_PORTAL_QUERIES) {
      try {
        console.log(`  portal search: ${portal} · ${q}`);
        const search = JSON.parse(await (await fetchOk(PORTAL_SEARCH_URL(portal, q, 25, orgId))).text());
        // Name guard as well as the org filter: if portals/self failed we are
        // searching all of ArcGIS Online and must not accept another county.
        const svc = pickPortalService(search, { must: orgId ? [] : ['maricopa'] });
        if (!svc) {
          const titles = (search?.results || []).map((r) => `"${r.title}"`).slice(0, 10);
          throw new Error(`no parcel service matched; top results: ${titles.join(' · ') || 'none'}`);
        }
        console.log(`  picked "${svc.title}" by ${svc.owner} (score ${svc.score})`);
        const rows = await tryParcelLayer(`${svc.url}/0`);
        if (DISCOVER_ONLY) return { discovered: { portal, service: svc, rows: rows.length } };
        return { text: rowsToCsv(rows), via: `portal:${portal}:${svc.id}` };
      } catch (e) {
        lastErr = e;
        console.warn(`    ${e.message}`);
      }
    }
  }
  throw lastErr || new Error('no Maricopa portals configured');
}

/** Authoritative route: enumerate the county's own GIS services directory. */
async function maricopaViaCountyRest() {
  let lastErr = null;
  for (const root of MARICOPA_REST_ROOTS) {
    try {
      console.log(`  county GIS directory: ${root}`);
      const rootJson = JSON.parse(await (await fetchOk(`${root}?f=json`)).text());
      const cat = restCatalogServices(rootJson, root);
      let services = [...cat.services];
      for (const folder of cat.folders.slice(0, 12)) {
        try {
          const fj = JSON.parse(await (await fetchOk(`${root}/${folder}?f=json`)).text());
          services.push(...restCatalogServices(fj, `${root}/${folder}`).services);
        } catch (e) {
          console.warn(`    folder ${folder}: ${e.message}`);
        }
      }
      const ranked = rankParcelServices(services);
      console.log(`  ${services.length} services · parcel candidates: ${ranked.map((s) => s.name).join(' · ') || 'none'}`);
      if (!ranked.length) throw new Error(`no parcel-named services; all: ${services.map((s) => s.name).slice(0, 40).join(', ')}`);

      for (const svc of ranked.slice(0, 4)) {
        try {
          console.log(`  service ${svc.url}`);
          const svcJson = JSON.parse(await (await fetchOk(`${svc.url}?f=json`)).text());
          const layers = (svcJson?.layers || [{ id: 0, name: 'layer 0' }]).slice(0, 5);
          for (const layer of layers) {
            try {
              console.log(`  layer ${layer.id}: ${layer.name}`);
              const rows = await tryParcelLayer(`${svc.url}/${layer.id}`);
              if (DISCOVER_ONLY) return { discovered: { service: svc.url, layer: layer.id, rows: rows.length } };
              return { text: rowsToCsv(rows), via: `county-rest:${svc.name}/${layer.id}` };
            } catch (e) {
              console.warn(`    layer ${layer.id}: ${e.message}`);
            }
          }
        } catch (e) {
          console.warn(`    ${svc.name}: ${e.message}`);
        }
      }
      throw new Error('no candidate layer had a usable class field — layer field lists above');
    } catch (e) {
      lastErr = e;
      console.warn(`  ${root}: ${e.message}`);
    }
  }
  throw lastErr || new Error('no county REST roots configured');
}

async function maricopaViaArcgis() {
  let lastErr = null;
  for (const q of MARICOPA_ARCGIS_QUERIES) {
    try {
      console.log(`  searching ArcGIS Online: ${q}`);
      const search = JSON.parse(await (await fetchOk(ARCGIS_SEARCH_URL(q))).text());
      const svc = pickMaricopaService(search);
      if (!svc) {
        const titles = (search?.results || []).map((r) => `"${r.title}" (${r.owner})`).slice(0, 10);
        throw new Error(`no parcel service matched; top results: ${titles.join(' · ') || 'none'}`);
      }
      console.log(`  picked "${svc.title}" by ${svc.owner} (score ${svc.score})`);
      console.log(`  layer ${svc.url}/0`);
      const rows = await tryParcelLayer(`${svc.url}/0`);
      if (DISCOVER_ONLY) return { discovered: { service: svc, rows: rows.length } };
      return { text: rowsToCsv(rows), via: `arcgis:${svc.id}` };
    } catch (e) {
      lastErr = e;
      console.warn(`  search "${q}": ${e.message}`);
    }
  }
  throw lastErr || new Error('no ArcGIS search queries configured');
}

// Route order = most authoritative first: the county's on-prem REST server,
// then its own ArcGIS Online portals, then the open web search, then the
// assessor site scrape. Each prints why it failed so one run diagnoses the
// whole chain.
const MARICOPA_ROUTES = [
  ['county REST directory', maricopaViaCountyRest],
  ['county ArcGIS Online portal', maricopaViaPortal],
  ['public ArcGIS Online search', maricopaViaArcgis],
];

async function maricopaLane() {
  try {
    let got = null;
    const failures = [];
    for (const [label, route] of MARICOPA_ROUTES) {
      try {
        console.log(`  → route: ${label}`);
        got = await route();
        console.log(`  ✓ ${label} worked`);
        break;
      } catch (e) {
        console.warn(`  ✗ ${label}: ${e.message}`);
        failures.push(`${label}: ${e.message}`);
      }
    }
    if (!got) throw new Error(`all ArcGIS routes failed — ${failures.join(' | ')}`);
    if (got.discovered) return got;
    const res = assessorToParcels(got.text, PRESETS.maricopa);
    console.log(inspectReport(res, `maricopa ${got.via}`));
    if (!essentialsOk(res)) {
      throw new Error(`essential fields unresolved (${res.unresolved.join(', ')}) — imported nothing; paste the parse report into the build chat`);
    }
    if (!res.kept) throw new Error('0 rows passed the multifamily filter — paste the report above into the build chat');
    return { res };
  } catch (e) {
    console.warn(`  ArcGIS route failed: ${e.message}`);
    console.log('  falling back to assessor-site page scrape');
    return maricopaViaPages();
  }
}

async function maricopaViaPages() {
  let picked = null;
  for (const page of MARICOPA_PAGES) {
    try {
      console.log(`  reading ${page}`);
      const html = await maricopaFetch(page);
      let urls = extractFileUrls(html, page);

      // The landing page is a static index whose files sit one level deeper
      // (field-verified: zero file links on data_sales itself). Crawl the
      // data-ish subpages it links to.
      if (!urls.length) {
        const subpages = extractLinks(html, page)
          .filter((u) => {
            try {
              const x = new URL(u);
              return (
                x.hostname.endsWith('maricopa.gov') &&
                u !== page &&
                /data|download|sales|apartment|master|bulk|gis|parcel|rental|owner/i.test(x.pathname) &&
                !/\.(pdf|jpg|png|css|js)(\?|$)/i.test(x.pathname)
              );
            } catch {
              return false;
            }
          })
          .slice(0, 8);
        console.log(`  no file links on the page itself — crawling ${subpages.length} subpage(s)`);
        for (const sub of subpages) {
          try {
            const subHtml = await maricopaFetch(sub);
            const found = extractFileUrls(subHtml, sub);
            if (found.length) console.log(`    ${sub} → ${found.length} file link(s)`);
            urls.push(...found);
          } catch (e) {
            console.warn(`    ${sub}: ${e.message}`);
          }
        }
        if (!urls.length && subpages.length) {
          console.log(`  page snippet: ${html.replace(/\s+/g, ' ').slice(0, 400)}`);
          console.log(`  subpages tried: ${subpages.join(' | ')}`);
        }
      }

      const files = pickMaricopaFiles(urls);
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

  const text = await downloadDataFile(picked.apartment, 'maricopa-apt', { viaMaricopa: true });
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
    const otext = await downloadDataFile(picked.ownership, 'maricopa-own', { viaMaricopa: true });
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
// Primary: ArcGIS Hub CSV download (Nashville left Socrata for Hub, 2026).
// Fallback: the old Socrata route, in case the portal moves back or the Hub
// dataset id changes before this code does.
async function nashvilleViaHub() {
  let lastErr = null;
  for (const id of NASHVILLE_HUB_DATASETS) {
    try {
      const url = hubDownloadUrl(id);
      if (DISCOVER_ONLY) return { discovered: { hubDataset: id, url } };
      const text = await downloadDataFile(url, 'nashville-hub');
      return { text, via: `hub:${id}` };
    } catch (e) {
      lastErr = e;
      console.warn(`  hub dataset ${id}: ${e.message}`);
    }
  }
  throw lastErr || new Error('no Hub datasets configured');
}

async function nashvilleViaSocrata() {
  console.log('  falling back to legacy Socrata catalog');
  const cat = JSON.parse(await (await fetchOk(NASHVILLE_CATALOG_URL)).text());
  const ds = socrataPickDataset(cat);
  if (!ds) throw new Error('no assessor-shaped dataset found in the Socrata catalog');
  console.log(`  picked dataset ${ds.id} "${ds.name}" (score ${ds.score})`);
  if (DISCOVER_ONLY) return { discovered: ds };
  const LIMIT = 50000;
  let text = '';
  for (let offset = 0; offset < 600000; offset += LIMIT) {
    const page = await (await fetchOk(socrataCsvUrl('data.nashville.gov', ds.id, { limit: LIMIT, offset }))).text();
    const body = offset === 0 ? page : page.slice(page.indexOf('\n') + 1);
    text += body.endsWith('\n') ? body : body + '\n';
    const rows = page.split('\n').length - 1;
    if (rows < LIMIT) break;
  }
  return { text, via: `socrata:${ds.id}` };
}

async function nashvilleLane() {
  let got;
  try {
    got = await nashvilleViaHub();
  } catch (e) {
    console.warn(`  ArcGIS Hub route failed: ${e.message}`);
    got = await nashvilleViaSocrata();
  }
  if (got.discovered) return got;

  const res = assessorToParcels(got.text, PRESETS.tn, { countyFips: '47037' });
  console.log(inspectReport(res, `nashville ${got.via}`));
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
