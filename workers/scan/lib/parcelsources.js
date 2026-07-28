/**
 * Auto-discovery of county parcel bulk downloads (Phase 2, zero-operator path).
 *
 * Sources verified 2026-07 via web research:
 *  - Maricopa: the Assessor launched FREE bulk downloads (2026-03) on the
 *    Data Downloads page — pipe-delimited files hosted on
 *    ftp.mcassessor.maricopa.gov, including an "Apartment Master" (duplex →
 *    apartment, with REAL unit counts + complex names) and ownership files.
 *    Exact filenames drift, so links are DISCOVERED from the page at runtime.
 *  - Nashville/Davidson TN: runs its own CAMA (not in the state IMPACT
 *    system), publishes assessor data on data.nashville.gov (Socrata) —
 *    dataset ids drift, so the catalog API picks the right one at runtime.
 *
 * Everything here is pure parsing (testable); the network calls live in
 * bin/parcels.mjs.
 */

// api./ftp. subdomains are firewalled from datacenters (TCP ETIMEDOUT,
// field-verified 2026-07-24) — only www is reachable, and its public
// data-sales pages expose samples + layout docs, not full files.
export const MARICOPA_PAGES = ['https://www.mcassessor.maricopa.gov/page/data_sales/'];

// PRIMARY Maricopa route: the county's GIS parcels on ArcGIS, found at
// RUNTIME through the official ArcGIS Online search API (hardcoded dataset
// ids went stale and 404'd — field-verified 2026-07-24). Queried
// server-side by multifamily PUC so we never pull 1.4M single-family rows.
// The county's OWN ArcGIS server — authoritative, unlike ArcGIS Online
// search which surfaces community copies (a 2021 geometry-only layer,
// field-verified 2026-07-25). The REST services directory is a stable,
// documented API: root?f=json lists folders + services.
export const MARICOPA_REST_ROOTS = [
  'https://gis.maricopa.gov/arcgis/rest/services',
  'https://services.maricopa.gov/arcgis/rest/services',
];

/** Services-directory JSON → { services: [{name,type,url}], folders: [] }. */
export function restCatalogServices(json, baseUrl) {
  const services = (json?.services || []).map((s) => ({
    name: s.name,
    type: s.type,
    url: `${baseUrl}/${String(s.name).split('/').pop()}/${s.type}`,
  }));
  return { services, folders: json?.folders || [] };
}

/** Rank a service list for "the assessor parcel layer lives here". */
export function rankParcelServices(services) {
  return services
    .filter((s) => /(Map|Feature)Server/i.test(s.type || ''))
    .map((s) => {
      let score = 0;
      if (/parcel/i.test(s.name)) score += 4;
      if (/assessor|assessment|cadastr/i.test(s.name)) score += 3;
      if (/tax/i.test(s.name)) score += 1;
      if (/label|anno|boundar|zip|grid/i.test(s.name)) score -= 3;
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * County parcel sources, county-agnostic.
 *
 * Every county publishes the same thing behind a different door, so rather
 * than a bespoke lane each, a config drives the SAME discovery chain that was
 * hardened against Maricopa: the county's own ArcGIS REST directory, then its
 * ArcGIS Online portal, then the public ArcGIS search, then a statewide
 * fallback service filtered to the county.
 *
 * `rest_roots` and `portals` are CANDIDATES, not facts — they are guesses at
 * where a county keeps its GIS, and the runner reports which one answered.
 * Add more freely; a dead root costs one failed request and a printed line.
 *
 * `statewide` is the strongest card for small counties that run no GIS of
 * their own: one state service holding every parcel, filtered by county.
 */
export const COUNTY_SOURCES = {
  knox: {
    fips: '47093',
    state: 'TN',
    label: 'Knox County / Knoxville TN',
    // KGIS is the long-running Knoxville/Knox County GIS partnership.
    rest_roots: [
      'https://www.kgis.org/arcgis/rest/services',
      'https://arcgis.kgis.org/arcgis/rest/services',
      'https://gis.knoxcounty.org/arcgis/rest/services',
    ],
    portals: ['https://kgis.maps.arcgis.com', 'https://knoxcounty.maps.arcgis.com'],
    must: ['knox'],
    preset: 'tn',
  },
  anderson: {
    fips: '47001',
    state: 'TN',
    label: 'Anderson County / Oak Ridge TN',
    rest_roots: [
      'https://gis.andersoncountytn.gov/arcgis/rest/services',
      'https://maps.andersoncountytn.gov/arcgis/rest/services',
    ],
    portals: ['https://andersoncountytn.maps.arcgis.com'],
    must: ['anderson'],
    preset: 'tn',
  },
  hamilton: {
    fips: '47065',
    state: 'TN',
    label: 'Hamilton County / Chattanooga TN',
    rest_roots: [
      'https://www.gis.hamiltontn.gov/arcgis/rest/services',
      'https://gis.hamiltontn.gov/arcgis/rest/services',
      'https://maps.chattanooga.gov/arcgis/rest/services',
    ],
    portals: ['https://hamiltontn.maps.arcgis.com', 'https://chattanooga.maps.arcgis.com'],
    must: ['hamilton', 'chattanooga'],
    preset: 'tn',
  },
};

/**
 * Statewide parcel services, tried when no county-run service answers. A
 * small county often has no GIS of its own but every parcel still sits in the
 * state layer, so this is the difference between "no lane possible" and "one
 * config line".
 */
export const STATEWIDE_PARCEL_ROOTS = {
  TN: [
    'https://tnmap.tn.gov/arcgis/rest/services',
    'https://www.tngis.org/arcgis/rest/services',
  ],
};

/** Field names a statewide layer might use for the county, best first. */
export const COUNTY_FILTER_FIELDS = ['COUNTY_FIPS', 'CNTYFIPS', 'FIPS', 'CO_FIPS', 'COUNTY', 'CNTY_NAME', 'COUNTYNAME'];

/**
 * WHERE clauses that restrict a statewide layer to one county — by fips
 * (5-digit and 3-digit forms) and by name, since which one a state uses is
 * not knowable in advance.
 */
export function countyFilterClauses(cfg) {
  const county = cfg.label.split(/ County| \//)[0].trim();
  const fips3 = String(cfg.fips).slice(-3);
  return [
    `COUNTY_FIPS = '${cfg.fips}'`,
    `FIPS = '${cfg.fips}'`,
    `CNTYFIPS = '${fips3}'`,
    `UPPER(COUNTY) = '${county.toUpperCase()}'`,
    `UPPER(CNTY_NAME) = '${county.toUpperCase()}'`,
  ];
}

/** Portal/AGO search terms for a county, most specific first. */
export function countySearchQueries(cfg) {
  const county = cfg.label.split(/ County| \//)[0].trim();
  return [
    `${county} parcels type:"Feature Service"`,
    `${county} county parcels assessor type:"Feature Service"`,
    'parcels type:"Feature Service"',
  ];
}

export const ARCGIS_SEARCH_URL = (q, num = 20) =>
  `https://www.arcgis.com/sharing/rest/search?f=json&num=${num}&q=${encodeURIComponent(q)}`;

// Maricopa County's OWN ArcGIS Online organizations. Searching a portal
// directly only returns items that org published, which sidesteps the
// community-copy problem that sank the public www.arcgis.com search (it
// surfaced a 2021 geometry-only layer with no use codes, field-verified
// 2026-07-25). Modern county data increasingly lives in hosted feature
// services here rather than on an on-prem REST server.
export const MARICOPA_PORTALS = [
  'https://maricopa.maps.arcgis.com',
  'https://maricopacounty.maps.arcgis.com',
  'https://mcgis.maps.arcgis.com',
];

// A portal's /search endpoint does NOT restrict results to that portal's own
// items — it searches all of ArcGIS Online, so "parcels" on the Maricopa host
// happily returned "Napa County Public Parcels" (field-verified 2026-07-25).
// The org id has to be asked for and passed explicitly.
export const PORTAL_SELF_URL = (portal) => `${portal}/sharing/rest/portals/self?f=json`;

/** portals/self JSON → the org id used to scope a search. */
export function portalOrgId(selfJson) {
  return selfJson?.id || null;
}

/** Item search, restricted to one org when its id is known. */
export const PORTAL_SEARCH_URL = (portal, q, num = 25, orgId = null) => {
  const query = orgId ? `orgid:${orgId} AND (${q})` : q;
  return `${portal}/sharing/rest/search?f=json&num=${num}&q=${encodeURIComponent(query)}`;
};

export const MARICOPA_PORTAL_QUERIES = [
  'parcels type:"Feature Service"',
  'assessor parcel type:"Feature Service"',
];

/**
 * Rank portal search results for the parcel layer.
 *
 * `must` is a hard filter, not a score: an item that doesn't name the county
 * anywhere is rejected outright. Without it a well-titled parcel layer from
 * ANY county outscores the right county's, which is exactly how "Napa County
 * Public Parcels" won a Maricopa search.
 */
export function pickPortalService(searchJson, { must = [] } = {}) {
  const items = searchJson?.results || [];
  let best = null;
  for (const it of items) {
    if (!it?.url || !/(feature|map)\s*service/i.test(it.type || '')) continue;
    const title = String(it.title || '');
    const hay = `${title} ${it.owner || ''} ${it.snippet || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
    if (must.length && !must.every((m) => hay.includes(String(m).toLowerCase()))) continue;
    let score = 0;
    if (/parcel/i.test(title)) score += 4;
    if (/assessor|ownership|owner|cadastr/.test(hay)) score += 3;
    if (/use.?code|puc|land.?use/.test(hay)) score += 2;
    if (/label|anno|boundar|zip|grid|sample|test|deprecat|archive/.test(hay)) score -= 4;
    if (!best || score > best.score) {
      best = { id: it.id, title, owner: it.owner, url: String(it.url).replace(/\/+$/, ''), score };
    }
  }
  return best && best.score >= 4 ? best : null;
}

/**
 * WHERE clauses to try for "multifamily" on a discovered class field, in
 * order. Maricopa PUCs are 03xx but the field may be stored as text OR as a
 * number, and a LIKE against a numeric column is a hard error on ArcGIS —
 * so the numeric range is tried too rather than reporting "0 rows".
 */
export function multifamilyWhereClauses(classField) {
  const kw = ['DUPLEX', 'TRIPLEX', 'FOURPLEX', 'APART', 'MULTI'];
  return [
    `${classField} LIKE '03%'`,
    `${classField} >= 300 AND ${classField} < 400`,
    // Descriptive land-use fields (what Nashville turned out to have).
    kw.map((k) => `UPPER(${classField}) LIKE '%${k}%'`).join(' OR '),
  ];
}

export const MARICOPA_ARCGIS_QUERIES = [
  'maricopa parcels assessor type:"Feature Service"',
  'maricopa county parcels type:"Feature Service"',
];

/** Rank ArcGIS Online search results for the Maricopa parcel service. */
export function pickMaricopaService(searchJson) {
  const items = searchJson?.results || [];
  let best = null;
  for (const it of items) {
    if (!it?.url || !/(feature|map)\s*service/i.test(it.type || '')) continue;
    const hay = `${it.title || ''} ${it.owner || ''} ${it.snippet || ''}`.toLowerCase();
    if (!hay.includes('maricopa')) continue;
    let score = 0;
    if (/parcel/i.test(it.title || '')) score += 4;
    if (/assessor|ownership|owner/.test(hay)) score += 3;
    if (/maricopa/.test(String(it.owner || '').toLowerCase())) score += 3;
    if (/county|gis/.test(String(it.owner || '').toLowerCase())) score += 1;
    if (/test|sample|copy|deprecat/.test(hay)) score -= 4;
    if (!best || score > best.score) {
      best = { id: it.id, title: it.title, owner: it.owner, url: String(it.url).replace(/\/+$/, ''), score };
    }
  }
  return best && best.score >= 4 ? best : null;
}

/** ArcGIS layer descriptor JSON (…/FeatureServer/0?f=json) → field names. */
export function layerFieldNames(layerJson) {
  return (layerJson?.fields || []).map((f) => f?.name).filter(Boolean);
}

export const hubDatasetMetaUrl = (id) => `https://hub.arcgis.com/api/v3/datasets/${id}`;

/** Hub v3 dataset metadata → { url: FeatureServer layer URL, fields: [names] }. */
export function arcgisLayerFromMeta(meta) {
  const a = meta?.data?.attributes || {};
  const url = a.url || a.layer?.url || a.server?.url || null;
  const rawFields = a.fields || a.layer?.fields || [];
  const fields = rawFields.map((f) => (typeof f === 'string' ? f : f?.name)).filter(Boolean);
  return url ? { url: String(url).replace(/\/+$/, ''), fields } : null;
}

/** Find the property-use-code/class field on an ArcGIS layer. */
export function pickClassField(fields) {
  return rankClassFields(fields)[0] ?? null;
}

/**
 * Every plausible use/class field, best first — a layer usually has several
 * and only one of them carries the multifamily codes.
 *
 * Field-verified on Maricopa's IndividualService/Parcel layer (2026-07-25):
 * it exposes PropertyUseCode (the 03xx PUC we want), PropertyUseDescription,
 * AND LandLegalClassCode, which holds statutory legal classes ("3", "4.1")
 * that match none of the multifamily patterns. Picking one field and giving
 * up cost a full droplet round-trip, so the caller now tries them in order.
 */
export function rankClassFields(fields) {
  const fs = fields.map(String);
  const tier = (f) => {
    // Legal/assessment CLASS is a different taxonomy from land USE — it can
    // look like a match by name, so it sorts last rather than being dropped.
    if (/legal.?class|assess.*class|class.?code$/i.test(f) && !/use/i.test(f)) return 4;
    if (/^puc$/i.test(f)) return 0;
    if (/^puc/i.test(f)) return 1;
    if (/property.?use|use.?code|land.?use/i.test(f)) return 1;
    if (/use.?desc|property.?use.?desc/i.test(f)) return 2;
    if (/prop.?class|classification|property.?type/i.test(f)) return 3;
    return null;
  };
  return fs
    .map((f) => ({ f, t: tier(f) }))
    .filter((x) => x.t != null)
    // Codes before descriptions within a tier; stable otherwise.
    .sort((a, b) => a.t - b.t)
    .map((x) => x.f);
}

export function arcgisQueryUrl(layerUrl, { where = '1=1', offset = 0, count = 2000 } = {}) {
  const p = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(count),
  });
  return `${layerUrl}/query?${p.toString()}`;
}

/** ArcGIS query JSON → plain attribute rows. */
export function featuresToRows(json) {
  return (json?.features || []).map((f) => f.attributes).filter(Boolean);
}

/** Attribute rows → CSV text (union of keys), so the standard assessor
 * parser — column resolution, inspect reports, essentials gate — applies
 * unchanged to API-sourced data. */
export function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

// Nashville migrated its portal from Socrata to ArcGIS Hub (confirmed
// 2026-07: the Socrata catalog 404s and datasets live on
// datanashvillegov-nashville.hub.arcgis.com). The Hub CSV-download API is
// the stable route; dataset ids drift rarely, so known ids first with the
// legacy Socrata path kept as a last-ditch fallback.
export const NASHVILLE_HUB_DATASETS = [
  'fa26cd9326c446179be059e00449cb1f_0', // "Parcels" (assessor parcel table)
];

export const hubDownloadUrl = (id) =>
  `https://hub.arcgis.com/api/v3/datasets/${id}/downloads/data?format=csv&spatialRefId=4326`;

export const NASHVILLE_CATALOG_URL =
  'https://api.us.socrata.com/api/catalog/v1?domains=data.nashville.gov&limit=50&q=' +
  encodeURIComponent('property assessor parcel');

/** Pull every href out of an HTML page, resolved against the page URL. */
export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /href\s*=\s*["']([^"'#>\s]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(new URL(m[1], baseUrl).href);
    } catch {
      /* malformed href — skip */
    }
  }
  return [...new Set(out)];
}

/**
 * All data-file URLs in ANY text — hrefs plus absolute/relative URLs
 * embedded in scripts or JSON (client-rendered pages like Maricopa's keep
 * their download links out of the static HTML). JSON escaping (\/) is
 * unescaped before matching.
 */
export function extractFileUrls(text, baseUrl) {
  const t = String(text).replace(/\\\//g, '/');
  const out = new Set(extractLinks(t, baseUrl).filter((u) => /\.(zip|txt|csv|dat)(\?|$)/i.test(u)));
  const abs = /https?:\/\/[^\s"'<>\\)]+\.(?:zip|txt|csv|dat)\b/gi;
  let m;
  while ((m = abs.exec(t))) out.add(m[0]);
  // "/file/…/x.zip" style relative paths quoted in JS/JSON
  const rel = /["']((?:\/[A-Za-z0-9._~-]+)+\.(?:zip|txt|csv|dat))["']/g;
  while ((m = rel.exec(t))) {
    try {
      out.add(new URL(m[1], baseUrl).href);
    } catch {
      /* skip */
    }
  }
  return [...out];
}

/**
 * Categorize Maricopa download links. Returns { apartment, ownership } —
 * best candidate URL for each, or null. Apartment Master is the primary
 * multifamily file; an ownership/parcel-master file backfills owner mailing
 * addresses if the apartment file lacks them.
 */
export function pickMaricopaFiles(links) {
  const files = links.filter((u) => /\.(zip|txt|csv|dat)(\?|$)/i.test(u));
  const apartment = files.find((u) => /apart/i.test(u)) || null;
  const ownership =
    files.find((u) => /owner/i.test(u)) ||
    files.find((u) => /parcel[-_ ]?master|master[-_ ]?parcel/i.test(u)) ||
    null;
  return { apartment, ownership, all: files };
}

/**
 * Pick the best assessor dataset from a Socrata catalog response.
 * Scores each result by how many of the fields we need its columns cover.
 */
export function socrataPickDataset(catalog) {
  const results = catalog?.results || [];
  let best = null;
  for (const r of results) {
    const res = r.resource || {};
    if (res.type && res.type !== 'dataset') continue;
    const cols = (res.columns_field_name || []).map((c) => String(c).toLowerCase());
    const has = (re) => cols.some((c) => re.test(c));
    let score = 0;
    if (has(/apn|parcel/)) score += 4;
    if (has(/owner/)) score += 3;
    if (has(/mail/)) score += 3;
    if (has(/land.?use|class|property.?use/)) score += 2;
    if (has(/unit/)) score += 2;
    if (has(/address|location|situs/)) score += 1;
    if (/assessor|assessment|property/i.test(res.name || '')) score += 1;
    if ((res.columns_field_name || []).length < 5) score -= 5;
    if (!best || score > best.score) best = { id: res.id, name: res.name, score, columns: res.columns_field_name };
  }
  // Below this the "best" match is a lookup table or map layer, not CAMA data.
  return best && best.score >= 8 ? best : null;
}

export function socrataCsvUrl(domain, id, { limit = 50000, offset = 0 } = {}) {
  return `https://${domain}/resource/${id}.csv?$limit=${limit}&$offset=${offset}&$order=:id`;
}

const normApn = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

/**
 * Backfill owner/mailing fields on parcels from a second parsed file
 * (ownership master), joined on normalized APN. Recomputes entity/absentee
 * flags for rows that gained data. Mutates and returns parcels.
 */
export function mergeOwnership(parcels, ownershipRows, helpers) {
  const { looksLikeEntity, isAbsentee } = helpers;
  const byApn = new Map();
  for (const o of ownershipRows) {
    if (o.apn) byApn.set(normApn(o.apn), o);
  }
  let merged = 0;
  for (const p of parcels) {
    const o = byApn.get(normApn(p.apn));
    if (!o) continue;
    let touched = false;
    for (const f of ['owner_name', 'mailing_address', 'mailing_city', 'mailing_state', 'mailing_zip']) {
      if (p[f] == null && o[f] != null) {
        p[f] = o[f];
        touched = true;
      }
    }
    if (touched) {
      merged++;
      p.owner_is_entity = looksLikeEntity(p.owner_name);
      p.absentee = isAbsentee(p.situs_address, p.situs_zip, p.mailing_address, p.mailing_zip);
    }
  }
  return { parcels, merged };
}
