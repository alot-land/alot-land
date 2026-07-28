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
    // Approximate county bounds. Used only to REJECT a layer whose extent is
    // nowhere near the county — a Massachusetts street layer scored well on
    // title alone and was picked for a Knox query (field-verified 2026-07-26).
    bbox: [-84.29, 35.78, -83.65, 36.18],
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
    bbox: [-84.45, 35.94, -83.99, 36.29],
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
    bbox: [-85.52, 34.97, -84.93, 35.43],
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
  // Deliberately empty for MFDA. See STATEWIDE_PARCEL_FINDINGS: the statewide
  // layers that exist carry no mailing address and no unit/land-use field, so
  // they cannot drive either half of off-market multifamily. An empty list
  // fails fast with a clear reason instead of retrying dead hosts.
  TN: [],
};

/**
 * Statewide parcel layers, field-verified by curl on 2026-07-26. Recorded so
 * the same dead ends are not rediscovered — every one of these cost a round.
 *
 * THE HEADLINE: none of the three carries a MAILING ADDRESS. Owner name plus
 * an out-of-county mailing address is what identifies an absentee owner, so
 * no free statewide source in these states can drive a mail campaign. This is
 * a property of the data, not a gap in the search.
 */
export const STATEWIDE_PARCEL_FINDINGS = {
  TN: {
    url: 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0',
    org: 'YuVBSS7Y1of2Qud1 (State of Tennessee STS GIS, publisher: Comptroller — Division of Property Assessments)',
    parcels: 2138531,
    counties: '86 of 95',
    owner: true,
    mailing_address: false,
    // No land-use class, no unit count, no assessed value — nothing to select
    // multifamily with, which is why this fails MFDA's essentials gate. For
    // LAND it is a different story: owner + DEEDAC acreage + geometry.
    land_use_or_units: false,
    fields: ['OBJECTID', 'COUNTY_ID', 'PARCEL_TYPE', 'GISLINK', 'PARCELID', 'CMAP', 'GP', 'PARCEL',
      'ADDRESS', 'DEEDAC', 'OWNER', 'OWNER2', 'SUBDIV', 'LOT', 'LINK_TPAD', 'LINK_TPV', 'COUNTY_NAME'],
    // These run their own assessment systems and are STRUCTURALLY absent —
    // they will never appear in the state layer, so they need county sources.
    excluded_counties: ['Chester', 'Davidson', 'Hamilton', 'Hickman', 'Knox',
      'Montgomery', 'Rutherford', 'Shelby', 'Williamson'],
    dead_ends: ['tnmap.tn.gov/arcgis (15 folders, no parcel services)', 'gis.tn.gov (301s to tnmap)',
      'tngis.org (Hub site, no data)', 'data.tn.gov catalog API (no JSON)',
      'assessment.cot.tn.gov/TPAD (403 to curl — bot-protected, holds the fuller record)'],
  },
  VA: {
    url: 'https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0',
    parcels: 4170691,
    counties: '136 localities (all)',
    owner: false,
    mailing_address: false,
    land_use_or_units: false,
    fields: ['OBJECTID', 'VGIN_QPID', 'FIPS', 'LOCALITY', 'PARCELID', 'PTM_ID', 'LASTUPDATE'],
    // Geometry and IDs only, by VGIN's own description. A companion 363MB
    // File Geodatabase ("Virginia Parcels: Local Schema Tables", item
    // 523d89ebf23d4d84957f9fe5b9158bd9) joins on VGIN_QPID and MAY carry
    // owner — but its schema differs per locality, so it is a per-locality
    // question, not a statewide answer. Unverified: not downloaded.
    note: 'attributes limited to locality + parcel id',
  },
  IN: {
    url: 'https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0',
    parcels: 3682675,
    counties: '92 of 92',
    owner: false,
    mailing_address: false,
    // dlgf_prop_class_code IS a usable land-use filter, and lat/lng are
    // included — so this is a good geometry/classification source and a
    // useless mail source.
    land_use_or_units: true,
    note: 'situs address + class code + lat/lng, no owner name',
  },
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


/**
 * ArcGIS layer/service JSON → [west, south, east, north] in WGS84, or null.
 *
 * Only extents already in 4326 are trusted. A Web Mercator extent could be
 * converted, but a wrong conversion would silently pass a bad layer, and the
 * whole point of this check is to be certain — so an unconvertible extent
 * returns null and the caller treats it as "unknown", not "fine".
 */
export function layerExtent4326(json) {
  const e = json?.extent || json?.fullExtent || json?.initialExtent;
  if (!e || ![e.xmin, e.ymin, e.xmax, e.ymax].every((v) => Number.isFinite(v))) return null;
  const wkid = e.spatialReference?.latestWkid ?? e.spatialReference?.wkid ?? null;
  if (wkid !== 4326) return null;
  return [e.xmin, e.ymin, e.xmax, e.ymax];
}

/** Do two [w,s,e,n] boxes overlap at all? */
export function bboxesOverlap(a, b) {
  if (!a || !b) return true; // unknown extent is not evidence of wrongness
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/**
 * Reject a candidate layer that is demonstrably somewhere else.
 *
 * Returns a reason string when the layer should be rejected, or null to keep
 * it. Deliberately one-sided: an unknown or missing extent never rejects,
 * because absence of evidence is not evidence of a wrong county.
 */
export function extentMismatchReason(layerJson, countyBbox) {
  if (!countyBbox) return null;
  const ext = layerExtent4326(layerJson);
  if (!ext) return null;
  if (bboxesOverlap(ext, countyBbox)) return null;
  const fmt = (b) => `[${b.map((n) => n.toFixed(2)).join(', ')}]`;
  return `layer extent ${fmt(ext)} does not overlap the county ${fmt(countyBbox)}`;
}

// ArcGIS Hub indexes the open-data portals counties actually publish on
// today, which is how to reach a county whose own REST server is gone or
// token-walled (Knox's KGIS hosts now answer 401 — field-verified
// 2026-07-26).
export const hubSearchUrl = (q, size = 20) =>
  `https://hub.arcgis.com/api/v3/datasets?q=${encodeURIComponent(q)}&page[size]=${size}`;

/**
 * Hub search JSON → the best parcel dataset, or null.
 *
 * `must` is a hard filter on the title/owner/org text, never a score: a
 * well-titled parcel layer from the wrong county otherwise wins on merit.
 */
export function pickHubDataset(json, { must = [], bbox = null } = {}) {
  const items = json?.data || [];
  let best = null;
  for (const it of items) {
    const a = it?.attributes || {};
    const url = a.url || a.layer?.url || null;
    if (!url) continue;
    const hay = `${a.name || ''} ${a.owner || ''} ${a.orgName || ''} ${(a.tags || []).join(' ')}`.toLowerCase();
    if (must.length && !must.some((m) => hay.includes(String(m).toLowerCase()))) continue;
    if (bbox && Array.isArray(a.extent?.coordinates)) {
      const [[w, s2], [e2, n]] = a.extent.coordinates;
      if (!bboxesOverlap([w, s2, e2, n], bbox)) continue;
    }
    let score = 0;
    if (/parcel/i.test(a.name || '')) score += 4;
    if (/assessor|ownership|owner|cadastr/.test(hay)) score += 3;
    if (/land.?use|use.?code|zoning/.test(hay)) score += 2;
    if (/label|anno|road|boundary|archive|deprecat/.test(hay)) score -= 4;
    if (!best || score > best.score) {
      best = { id: it.id, title: a.name, owner: a.owner || a.orgName, url: String(url).replace(/\/+$/, ''), score };
    }
  }
  return best && best.score >= 4 ? best : null;
}


/**
 * markets.poly ("lng lat,lng lat,…" ring) → [west, south, east, north].
 *
 * A county added from the Markets page already carries a bounding box — the
 * scan polygon — so every auto-discovered county gets the same geography
 * guard as a hand-configured one, for free.
 */
export function polyToBbox(poly) {
  const pts = String(poly || '')
    .split(',')
    .map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Guess where a county keeps its GIS from its name alone.
 *
 * These are patterns, not knowledge — the point is that a county the operator
 * just clicked needs NO hand configuration to be attempted. A wrong host
 * costs one failed request and a printed line; the discovery routes that
 * follow (Hub, public search) do not depend on guessing right at all.
 */
export function candidateHosts(countyName, state) {
  const slug = String(countyName || '').toLowerCase().replace(/\s*county\s*$/, '').replace(/[^a-z]/g, '');
  const st = String(state || '').toLowerCase();
  if (!slug) return { rest_roots: [], portals: [] };
  const rest = [
    `gis.${slug}county${st}.gov`,
    `gis.${slug}county.gov`,
    `gis.${slug}county.org`,
    `maps.${slug}county${st}.gov`,
    `gis.${slug}.gov`,
  ];
  return {
    rest_roots: rest.map((h) => `https://${h}/arcgis/rest/services`),
    portals: [
      `https://${slug}county.maps.arcgis.com`,
      `https://${slug}.maps.arcgis.com`,
      `https://${slug}county${st}.maps.arcgis.com`,
    ],
  };
}

/**
 * A markets row (as added from the Markets page) → a county lane config.
 *
 * This is what makes "click a county, get its data" possible: everything the
 * lane needs — fips, state, name, bounding box, name guard — is already in
 * the row the operator created by clicking Add to targets.
 */
export function countyConfigFromMarket(row) {
  const county = String(row.county || row.name || '').replace(/,.*$/, '').trim();
  const bare = county.replace(/\s*county\s*$/i, '').trim();
  const hosts = candidateHosts(bare, row.state);
  return {
    fips: row.geo_id,
    state: row.state,
    label: `${county || row.name} ${row.state}`.trim(),
    bbox: polyToBbox(row.poly),
    must: [bare.toLowerCase()].filter(Boolean),
    preset: 'custom',
    ...hosts,
  };
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
    // The guard reads TITLE and OWNER only. Tags and snippets mention every
    // place a dataset was ever compared to, so guarding on them let a
    // Massachusetts layer satisfy a "knox" requirement.
    const identity = `${title} ${it.owner || ''}`.toLowerCase();
    const hay = `${identity} ${it.snippet || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
    if (must.length && !must.some((m) => identity.includes(String(m).toLowerCase()))) continue;
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
