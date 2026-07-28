/**
 * Generic county parcel lane — the discovery chain, extracted so both the
 * manual runner (bin/parcels.mjs) and the automatic queue (bin/parcelqueue.mjs)
 * use exactly one implementation.
 *
 * Routes, most authoritative first: the county's own ArcGIS REST directory,
 * its ArcGIS Online portal (org-scoped), ArcGIS Hub open data, the public
 * ArcGIS search, then a statewide service filtered to the county. Every route
 * is guarded by the county's bounding box, because a title can claim any
 * county and geography cannot.
 */
import { politeFetch } from './redfin.js';
import { assessorToParcels, PRESETS } from './assessor.js';
import { essentialsOk, inspectReport } from './parcelimport.js';
import {
  restCatalogServices,
  rankParcelServices,
  ARCGIS_SEARCH_URL,
  PORTAL_SEARCH_URL,
  PORTAL_SELF_URL,
  portalOrgId,
  pickPortalService,
  multifamilyWhereClauses,
  rankClassFields,
  STATEWIDE_PARCEL_ROOTS,
  countyFilterClauses,
  countySearchQueries,
  extentMismatchReason,
  hubSearchUrl,
  pickHubDataset,
  layerFieldNames,
  arcgisQueryUrl,
  pickClassField,
  featuresToRows,
  rowsToCsv,
} from './parcelsources.js';

export async function fetchOk(url) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res;
}
export /**
 * Fetch JSON, or fail with a description of what actually came back.
 *
 * A dead ArcGIS root typically answers with a landing page, and feeding that
 * to JSON.parse produced `Unexpected token '<'` five times per county —
 * an error about our parser rather than about their server.
 */
async function fetchJson(url) {
  const text = await (await fetchOk(url)).text();
  const head = text.trimStart().slice(0, 1);
  if (head === '<') throw new Error(`not an API — ${url} returned an HTML page`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON from ${url}: ${text.trim().slice(0, 80)}`);
  }
}
export /** Page a layer's rows for a WHERE clause (shared by both ArcGIS routes). */
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
export /** Try a candidate parcel layer: read fields, find the class field, query MF. */
async function tryParcelLayer(layerUrl, extraWhere = null, bbox = null) {
  const layerJson = await fetchJson(`${layerUrl}?f=json`);
  // Geography is the one check a title cannot fake.
  const mismatch = extentMismatchReason(layerJson, bbox);
  if (mismatch) throw new Error(mismatch);
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
    for (const mfWhere of multifamilyWhereClauses(classField)) {
      // A statewide layer needs the county filter ANDed on, or we would pull
      // every multifamily parcel in the state.
      const where = extraWhere ? `(${mfWhere}) AND (${extraWhere})` : mfWhere;
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
export /** Walk a REST services directory and return the first layer that yields rows. */
async function viaRestDirectory(roots, label, extraWhere = null, bbox = null) {
  let lastErr = null;
  for (const root of roots) {
    try {
      console.log(`  ${label} directory: ${root}`);
      const rootJson = await fetchJson(`${root}?f=json`);
      const cat = restCatalogServices(rootJson, root);
      const services = [...cat.services];
      for (const folder of cat.folders.slice(0, 12)) {
        try {
          const fj = JSON.parse(await (await fetchOk(`${root}/${folder}?f=json`)).text());
          services.push(...restCatalogServices(fj, `${root}/${folder}`).services);
        } catch (e) {
          console.warn(`    folder ${folder}: ${e.message}`);
        }
      }
      const ranked = rankParcelServices(services);
      console.log(`  ${services.length} services · parcel candidates: ${ranked.map((x) => x.name).join(' · ') || 'none'}`);
      if (!ranked.length) throw new Error(`no parcel-named services; all: ${services.map((x) => x.name).slice(0, 40).join(', ')}`);

      for (const svc of ranked.slice(0, 4)) {
        try {
          const svcJson = JSON.parse(await (await fetchOk(`${svc.url}?f=json`)).text());
          const layers = (svcJson?.layers || [{ id: 0, name: 'layer 0' }]).slice(0, 5);
          for (const layer of layers) {
            try {
              console.log(`  layer ${layer.id}: ${layer.name}`);
              const rows = await tryParcelLayer(`${svc.url}/${layer.id}`, extraWhere, bbox);
              return { rows, via: `${label}:${svc.name}/${layer.id}` };
            } catch (e) {
              console.warn(`    layer ${layer.id}: ${e.message}`);
            }
          }
        } catch (e) {
          console.warn(`    ${svc.name}: ${e.message}`);
        }
      }
      throw new Error('no candidate layer had a usable class field');
    } catch (e) {
      lastErr = e;
      console.warn(`  ${root}: ${e.message}`);
    }
  }
  throw lastErr || new Error('no roots configured');
}
export /** The county's own ArcGIS Online portals, org-scoped. */
async function viaPortals(cfg) {
  let lastErr = null;
  for (const portal of cfg.portals || []) {
    let orgId = null;
    try {
      orgId = portalOrgId(JSON.parse(await (await fetchOk(PORTAL_SELF_URL(portal))).text()));
      console.log(`  ${portal} org id: ${orgId || 'unknown'}`);
    } catch (e) {
      console.warn(`  ${portal} portals/self: ${e.message}`);
    }
    for (const q of countySearchQueries(cfg)) {
      try {
        console.log(`  portal search: ${portal} · ${q}`);
        const search = await fetchJson(PORTAL_SEARCH_URL(portal, q, 25, orgId));
        // The name guard applies even when an org id was found: a portal that
        // does not exist still answers portals/self, so the org filter can be
        // meaningless while looking successful.
        const svc = pickPortalService(search, { must: cfg.must || [] });
        if (!svc) throw new Error('no parcel service matched');
        console.log(`  picked "${svc.title}" by ${svc.owner}`);
        return { rows: await tryParcelLayer(`${svc.url}/0`, null, cfg.bbox), via: `portal:${svc.id}` };
      } catch (e) {
        lastErr = e;
        console.warn(`    ${e.message}`);
      }
    }
  }
  throw lastErr || new Error('no portals configured');
}
export /** ArcGIS Hub — the open-data index counties actually publish to today. */
async function viaHubSearch(cfg) {
  let lastErr = null;
  for (const q of countySearchQueries(cfg).map((x) => x.replace(/ type:"[^"]+"/, ''))) {
    try {
      console.log(`  hub search: ${q}`);
      const json = await fetchJson(hubSearchUrl(`${q} ${cfg.state}`));
      const ds = pickHubDataset(json, { must: cfg.must || [], bbox: cfg.bbox });
      if (!ds) throw new Error('no parcel dataset matched');
      console.log(`  picked "${ds.title}" by ${ds.owner}`);
      return { rows: await tryParcelLayer(ds.url, null, cfg.bbox), via: `hub:${ds.id}` };
    } catch (e) {
      lastErr = e;
      console.warn(`    ${e.message}`);
    }
  }
  throw lastErr || new Error('no hub queries configured');
}
export /** Public ArcGIS Online search — last resort, name-guarded. */
async function viaPublicSearch(cfg) {
  let lastErr = null;
  for (const q of countySearchQueries(cfg)) {
    try {
      console.log(`  public ArcGIS search: ${q}`);
      const search = await fetchJson(ARCGIS_SEARCH_URL(q));
      const svc = pickPortalService(search, { must: cfg.must || [] });
      if (!svc) throw new Error('no parcel service matched');
      console.log(`  picked "${svc.title}" by ${svc.owner}`);
      return { rows: await tryParcelLayer(`${svc.url}/0`, null, cfg.bbox), via: `arcgis:${svc.id}` };
    } catch (e) {
      lastErr = e;
      console.warn(`    ${e.message}`);
    }
  }
  throw lastErr || new Error('no queries configured');
}
export /** A statewide parcel layer, restricted to this county. */
async function viaStatewide(cfg) {
  const roots = STATEWIDE_PARCEL_ROOTS[cfg.state] || [];
  if (!roots.length) throw new Error(`no statewide roots for ${cfg.state}`);
  let lastErr = null;
  for (const clause of countyFilterClauses(cfg)) {
    try {
      console.log(`  statewide, county filter: ${clause}`);
      return await viaRestDirectory(roots, `statewide-${cfg.state}`, clause, cfg.bbox);
    } catch (e) {
      lastErr = e;
      console.warn(`    ${e.message}`);
    }
  }
  throw lastErr || new Error('statewide routes exhausted');
}

/**
 * Run every route for one county config until one yields rows.
 *
 * Returns { res } on success, or throws with every route's reason joined —
 * the reasons are the product here as much as the data, because they are what
 * tells you whether a county is worth another attempt or needs buying.
 */
export async function runCountyLane(cfg, { discoverOnly = false, log = console } = {}) {
  const routes = [
    ['county REST directory', () => viaRestDirectory(cfg.rest_roots || [], 'county', null, cfg.bbox)],
    ['county ArcGIS Online portal', () => viaPortals(cfg)],
    ['ArcGIS Hub open data', () => viaHubSearch(cfg)],
    ['public ArcGIS Online search', () => viaPublicSearch(cfg)],
    [`statewide ${cfg.state} service`, () => viaStatewide(cfg)],
  ];
  let got = null;
  const failures = [];
  for (const [label, route] of routes) {
    try {
      log.log(`  → route: ${label}`);
      got = await route();
      log.log(`  ✓ ${label} worked`);
      break;
    } catch (e) {
      log.warn(`  ✗ ${label}: ${e.message}`);
      failures.push(`${label}: ${e.message}`);
    }
  }
  if (!got) {
    const err = new Error(`all routes failed for ${cfg.label}`);
    err.failures = failures;
    throw err;
  }
  if (discoverOnly) return { discovered: { county: cfg.label, via: got.via, rows: got.rows.length } };

  const res = assessorToParcels(rowsToCsv(got.rows), PRESETS[cfg.preset || 'custom'], {
    countyFips: cfg.fips,
    state: cfg.state,
  });
  log.log(inspectReport(res, `${cfg.label} ${got.via}`));
  if (!essentialsOk(res)) {
    const err = new Error(`essential fields unresolved (${res.unresolved.join(', ')})`);
    err.unresolved = res.unresolved;
    throw err;
  }
  if (!res.kept) throw new Error('0 rows passed the multifamily filter');
  return { res, via: got.via };
}
