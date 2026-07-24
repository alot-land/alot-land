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

export const MARICOPA_PAGES = [
  'https://www.mcassessor.maricopa.gov/page/data_sales/',
  'https://api.mcassessor.maricopa.gov/page/data_sales/',
  'https://ftp.mcassessor.maricopa.gov/data-sales/',
];

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
