/**
 * US market data assembly (Phase 3) — parsing + joining ONLY.
 *
 * Sources (all free, county level, joined on 5-digit FIPS):
 *  - Zillow ZHVI / ZORI county CSVs (files.zillowstatic.com)
 *  - Census ACS 5-year API (population, medians, tenure counts)
 *  - FEMA National Risk Index county table
 *  - Census Gazetteer (centroids + land area → scan polygons later)
 *
 * This module stores RAW snapshots; every derived number (yield, CAGR,
 * tax rate, score) is computed by @alot/mf-calc in the app. No math here
 * beyond picking columns.
 */
import { parseCSV } from './csv.js';

const fips5 = (state, county) => `${String(state).padStart(2, '0')}${String(county).padStart(3, '0')}`;

const numOrNull = (v) => {
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= -111111111) return null; // ACS sentinel values (-666666666 etc.)
  return n;
};

/**
 * Zillow county CSV → Map fips → { now, y1, y5, name, state }.
 * Snapshot columns: the last date column, and the ones 12 and 60 months
 * earlier in the series (clamped to the series start).
 */
export function zillowSnapshots(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return new Map();
  const headers = rows[0];
  const col = (name) => headers.indexOf(name);
  const iState = col('StateCodeFIPS');
  const iCounty = col('MunicipalCodeFIPS');
  const iName = col('RegionName');
  const iSt = col('State');
  if (iState < 0 || iCounty < 0) throw new Error('Zillow CSV missing StateCodeFIPS/MunicipalCodeFIPS');
  const dateIdx = headers.map((h, i) => (/^\d{4}-\d{2}-\d{2}$/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (!dateIdx.length) throw new Error('Zillow CSV has no date columns');
  const last = dateIdx[dateIdx.length - 1];
  const back = (months) => dateIdx[Math.max(dateIdx.length - 1 - months, 0)];
  const out = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < headers.length - 2) continue;
    const key = fips5(row[iState], row[iCounty]);
    // Walk back from the end to the latest non-empty value.
    let nowVal = null;
    for (let k = dateIdx.length - 1; k >= Math.max(dateIdx.length - 4, 0); k--) {
      nowVal = numOrNull(row[dateIdx[k]]);
      if (nowVal != null) break;
    }
    out.set(key, {
      now: nowVal,
      y1: numOrNull(row[back(12)]),
      y5: numOrNull(row[back(60)]),
      name: iName >= 0 ? row[iName] : key,
      state: iSt >= 0 ? row[iSt] : null,
    });
  }
  return out;
}

/**
 * ACS API JSON (array-of-arrays) → Map fips → {field: value}.
 * `fields` maps output names to ACS variable codes.
 */
export function acsMap(json, fields) {
  if (!Array.isArray(json) || json.length < 2) return new Map();
  const headers = json[0];
  const iState = headers.indexOf('state');
  const iCounty = headers.indexOf('county');
  const idx = Object.fromEntries(Object.entries(fields).map(([out, code]) => [out, headers.indexOf(code)]));
  const out = new Map();
  for (let r = 1; r < json.length; r++) {
    const row = json[r];
    const rec = {};
    for (const [name, i] of Object.entries(idx)) rec[name] = i >= 0 ? numOrNull(row[i]) : null;
    out.set(fips5(row[iState], row[iCounty]), rec);
  }
  return out;
}

/** FEMA NRI county table CSV → Map fips → { nri_score, nri_rating }. */
export function nriMap(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return new Map();
  const headers = rows[0].map((h) => h.toUpperCase());
  const iFips = headers.indexOf('STCOFIPS');
  const iScore = headers.indexOf('RISK_SCORE');
  const iRating = headers.indexOf('RISK_RATNG');
  if (iFips < 0 || iScore < 0) throw new Error('NRI CSV missing STCOFIPS/RISK_SCORE');
  const out = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const f = String(row[iFips] || '').padStart(5, '0');
    if (f.length !== 5) continue;
    out.set(f, { nri_score: numOrNull(row[iScore]), nri_rating: iRating >= 0 ? row[iRating] || null : null });
  }
  return out;
}

/** Census Gazetteer counties file (tab- OR pipe-delimited — the 2025
 * edition ships pipes, field-verified 2026-07-24) → Map fips → geo facts. */
export function gazetteerMap(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return new Map();
  const delim = lines[0].includes('|') ? '|' : '\t';
  const headers = lines[0].split(delim).map((h) => h.trim().toUpperCase());
  const iGeoid = headers.indexOf('GEOID');
  const iName = headers.indexOf('NAME');
  const iUsps = headers.indexOf('USPS');
  const iArea = headers.indexOf('ALAND_SQMI');
  const iLat = headers.indexOf('INTPTLAT');
  const iLng = headers.findIndex((h) => h.startsWith('INTPTLONG'));
  if (iGeoid < 0 || iLat < 0) throw new Error('Gazetteer file missing GEOID/INTPTLAT');
  const out = new Map();
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r].split(delim).map((c) => c.trim());
    const f = String(row[iGeoid] || '').padStart(5, '0');
    if (f.length !== 5) continue;
    out.set(f, {
      name: iName >= 0 ? row[iName] : f,
      state: iUsps >= 0 ? row[iUsps] : null,
      land_sqmi: iArea >= 0 ? numOrNull(row[iArea]) : null,
      lat: numOrNull(row[iLat]),
      lng: numOrNull(row[iLng]),
    });
  }
  return out;
}

/**
 * Join everything on FIPS → market_stats rows. Zillow ZHVI presence is the
 * base set (a county without a home-value series can't be scored anyway).
 */
export function buildMarketStats({ zhvi, zori, acsNow, acsOld, nri, gaz }) {
  const rows = [];
  for (const [f, z] of zhvi) {
    const zr = zori?.get(f);
    const a = acsNow?.get(f);
    const ao = acsOld?.get(f);
    const n = nri?.get(f);
    const g = gaz?.get(f);
    rows.push({
      geo_level: 'county',
      geo_id: f,
      name: g?.name || z.name,
      state: g?.state || z.state || 'US',
      lat: g?.lat ?? null,
      lng: g?.lng ?? null,
      land_sqmi: g?.land_sqmi ?? null,
      population: a?.population ?? null,
      pop_5y_ago: ao?.population ?? null,
      zhvi_now: z.now,
      zhvi_1y: z.y1,
      zhvi_5y: z.y5,
      zori_now: zr?.now ?? null,
      zori_1y: zr?.y1 ?? null,
      zori_5y: zr?.y5 ?? null,
      median_re_tax: a?.median_re_tax ?? null,
      median_home_value_acs: a?.median_home_value ?? null,
      renters: a?.renters ?? null,
      occupied_units: a?.occupied_units ?? null,
      vacant_for_rent: a?.vacant_for_rent ?? null,
      nri_score: n?.nri_score ?? null,
      nri_rating: n?.nri_rating ?? null,
    });
  }
  return rows;
}
