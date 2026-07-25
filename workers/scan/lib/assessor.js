/**
 * County assessor file parsing → parcel rows (Phase 2 off-market machine).
 *
 * County files vary wildly (CSV/pipe/tab, different headers per county), so
 * parsing is CONFIG-DRIVEN: each logical field has candidate header names,
 * resolved case-insensitively against the actual file. Presets exist for
 * Maricopa (AZ) and Tennessee comptroller CAMA exports — expect one
 * inspect-and-adjust round on first contact with a real file (use --inspect).
 */
import { parseCSV } from './csv.js';

/** Sniff the delimiter from the header line. */
export function sniffDelimiter(text) {
  const line = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const counts = [
    ['|', (line.match(/\|/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
    [',', (line.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Parse delimiter-separated text. Comma path uses the RFC-ish parser
 * (quoted commas); pipe/tab files are split directly (quotes rare there). */
export function parseDSV(text, delim) {
  if (delim === ',') return parseCSV(text);
  return text
    .split(/\r?\n/)
    .filter((l) => l.length)
    .map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim()));
}

/**
 * Field → candidate header names (checked case-insensitively, in order).
 * The `generic` set backstops both presets and any other county.
 */
const GENERIC = {
  apn: ['apn', 'parcel', 'parcel_number', 'parcelid', 'parcel_id', 'parid', 'parcel_no', 'parcelno', 'parcel_num', 'assessor_parcel_number'],
  owner_name: ['owner_name', 'owner', 'ownership', 'ownername', 'owner1', 'current_owner', 'taxpayer_name', 'taxpayer'],
  // 'ownaddr1'/'propaddr' style: Nashville ArcGIS Hub parcel export (2026-07)
  // '*_line1' / '*_zip_code': Maricopa ArcGIS parcel layer (2026-07-25).
  mailing_address: ['mailing_address', 'mail_address', 'mail_addr', 'owner_address', 'owner_address_line1', 'mailing_address_line1', 'mail_address_line1', 'mailing_addr1', 'mail_line1', 'taxpayer_address', 'ownaddr1', 'own_addr1'],
  mailing_city: ['mailing_city', 'mail_city', 'owner_city', 'taxpayer_city', 'owncity'],
  mailing_state: ['mailing_state', 'mail_state', 'owner_state', 'taxpayer_state', 'ownstate'],
  mailing_zip: ['mailing_zip', 'mail_zip', 'owner_zip', 'owner_zip_code', 'mail_zip_code', 'mail_zipcode', 'taxpayer_zip', 'ownzip'],
  situs_address: ['situs_address', 'situs_addr', 'situs', 'property_address', 'property_full_street_address', 'property_street_address', 'prop_address', 'site_address', 'location', 'property_location', 'propaddr', 'physical_address', 'physical_street_address'],
  situs_city: ['situs_city', 'property_city', 'prop_city', 'site_city', 'propcity', 'physical_city', 'city'],
  situs_zip: ['situs_zip', 'property_zip', 'property_zip_code', 'prop_zip', 'site_zip', 'propzip', 'physical_zip', 'physical_zipcode', 'zip', 'zip_code'],
  units: ['units', 'unit_count', 'number_of_units', 'num_units', 'no_of_units', 'total_units', 'numberofunits', 'living_units', 'number_of_living_units', 'dwelling_units', 'res_units'],
  year_built: ['year_built', 'yearbuilt', 'const_year', 'construction_year', 'year_constructed', 'yr_built', 'eff_year_built'],
  // Descriptions sort ahead of bare codes: the text carries the unit count
  // ("DUPLEX") that unitsFromClass reads, a code carries none.
  property_class: ['property_class', 'class', 'property_use', 'use_code', 'puc', 'land_use', 'land_use_desc', 'land_use_description', 'use_description', 'property_use_description', 'property_use_code', 'ludesc', 'lucode', 'property_type', 'classification', 'prop_class'],
  last_sale_date: ['last_sale_date', 'sale_date', 'deed_date', 'sale_dt', 'last_sold', 'transfer_date', 'owndate'],
  last_sale_price: ['last_sale_price', 'sale_price', 'saleprice', 'sale_amount', 'consideration', 'last_sale_amount', 'price'],
  assessed_value: ['assessed_value', 'total_assessed', 'assessed_total', 'full_cash_value', 'fcv', 'total_value', 'appraised_value', 'total_appraisal', 'totlappr', 'totlassd'],
  building_sqft: ['building_sqft', 'improvement_sqft', 'living_area', 'livable_area_sqft', 'livable_area', 'bldg_sqft', 'sqft', 'finished_area', 'total_living_area'],
  lot_sqft: ['lot_sqft', 'land_sqft', 'lot_size_sqft', 'lot_size', 'land_area', 'lot_area', 'acreage', 'acres'],
  lat: ['lat', 'latitude', 'latitude_dd', 'intptlat', 'point_y', 'centroid_lat'],
  lng: ['lon', 'lng', 'longitude', 'longitude_dd', 'intptlon', 'intptlong', 'point_x', 'centroid_lon'],
};

export const PRESETS = {
  maricopa: {
    state: 'AZ',
    county_fips: '04013',
    // Maricopa PUC codes: 03xx = multifamily residential.
    isMultifamily: (row) =>
      /^03/.test(String(row.property_class || '')) ||
      Number(row.units) >= 2 ||
      /apart|multi|duplex|triplex|fourplex/i.test(String(row.property_class || '')),
    columns: GENERIC,
  },
  // Maricopa's Apartment Master bulk file: every row is already multifamily
  // (duplex → apartment), so the file itself is the filter.
  maricopa_apartments: {
    state: 'AZ',
    county_fips: '04013',
    isMultifamily: () => true,
    columns: GENERIC,
  },
  tn: {
    state: 'TN',
    county_fips: null, // per-county file; pass --county-fips
    isMultifamily: (row) =>
      Number(row.units) >= 2 ||
      /apart|multi[- ]?fam|duplex|triplex|quadplex|fourplex/i.test(String(row.property_class || '')),
    columns: GENERIC,
  },
  custom: {
    state: null,
    county_fips: null,
    isMultifamily: (row) =>
      Number(row.units) >= 2 || /apart|multi|duplex|triplex|fourplex/i.test(String(row.property_class || '')),
    columns: GENERIC,
  },
};

/**
 * Resolve logical fields to column indexes for this file's headers.
 *
 * Two passes per candidate: an exact match on the separator-normalized
 * header, then a separator-INSENSITIVE match. API-sourced data arrives with
 * camelCase headers ("PropertyUseDescription") that normalize to one word and
 * would otherwise miss every underscored synonym — field-verified against
 * Maricopa's ArcGIS parcel layer, 2026-07-25.
 */
export function resolveColumns(headers, columns = GENERIC) {
  const norm = headers.map((h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const squashed = norm.map((h) => h.replace(/_/g, ''));
  const idx = {};
  for (const [field, candidates] of Object.entries(columns)) {
    idx[field] = -1;
    for (const cand of candidates) {
      const i = norm.indexOf(cand);
      const j = i >= 0 ? i : squashed.indexOf(cand.replace(/_/g, ''));
      if (j >= 0) {
        idx[field] = j;
        break;
      }
    }
  }
  return idx;
}

/**
 * When a file has no units column, the land-use class often states the
 * count outright (Nashville: "DUPLEX", "TRIPLEX"…). Deterministic text →
 * number; apartments stay null (class doesn't say how many units).
 */
export function unitsFromClass(desc) {
  const s = String(desc || '').toLowerCase();
  if (/duplex|two[- ]?family|2[- ]?family/.test(s)) return 2;
  if (/triplex|three[- ]?family|3[- ]?family/.test(s)) return 3;
  if (/quadplex|fourplex|four[- ]?family|4[- ]?family|quadruplex/.test(s)) return 4;
  // Explicit counts in apartment descriptions ("APARTMENTS 5-9 UNITS",
  // "APARTMENT 24 UNITS"). Ranges take the LOW end — underwriting on a count
  // the property might not have is the expensive direction to be wrong in.
  const range = /(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\s*units?\b/.exec(s);
  if (range) return plausibleUnits(Number(range[1]));
  const exact = /(\d{1,4})\s*units?\b/.exec(s);
  if (exact) return plausibleUnits(Number(exact[1]));
  return null;
}

const plausibleUnits = (n) => (Number.isFinite(n) && n >= 1 && n <= 2000 ? n : null);

const ENTITY_RE = /\b(llc|l\.l\.c|inc|corp|corporation|company|co\b|trust|tr\b|lp|llp|ltd|partners(hip)?|properties|investments|holdings|capital|ventures|estates|group)\b/i;
export function looksLikeEntity(name) {
  return ENTITY_RE.test(String(name || ''));
}

function normAddr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|circle|cir)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Absentee = mailing address materially differs from the property address. */
export function isAbsentee(situsAddr, situsZip, mailAddr, mailZip) {
  const s = normAddr(situsAddr);
  const m = normAddr(mailAddr);
  if (!s || !m) return false; // unknowable → don't claim it
  if (s === m) return false;
  // Same street number + same zip → treat as owner-occupied-ish.
  const sNum = s.match(/^\d+/)?.[0];
  const mNum = m.match(/^\d+/)?.[0];
  if (sNum && sNum === mNum && String(situsZip || '').slice(0, 5) === String(mailZip || '').slice(0, 5)) return false;
  return true;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * For the parcels columns Postgres declares as `int` — units, year_built,
 * building_sqft, lot_sqft. County APIs hand these back as doubles
 * ("326073.22" for a lot size, field-verified on Maricopa 2026-07-25), and
 * an unrounded decimal is a hard insert error, not a coercion.
 */
function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // YYYYMMDD | YYYY-MM-DD | with optional trailing time ("2018/05/12 00:00:00+00"
  // — ArcGIS CSV exports ship timestamps, field-verified on Nashville OwnDate)
  let m = s.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})([ T].*)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})([ T].*)?$/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

/**
 * Parse an assessor file into multifamily parcel rows.
 * Returns { parcels, total, kept, dropped, unresolved: [missing fields] }.
 */
export function assessorToParcels(text, preset, opts = {}) {
  const delim = opts.delimiter || sniffDelimiter(text);
  const rows = parseDSV(text, delim);
  if (rows.length < 2) return { parcels: [], total: 0, kept: 0, dropped: 0, unresolved: [] };
  const headers = rows[0];
  const idx = resolveColumns(headers, preset.columns);
  const unresolved = Object.entries(idx)
    .filter(([, i]) => i < 0)
    .map(([f]) => f);
  const get = (r, f) => (idx[f] >= 0 ? String(r[idx[f]] ?? '').trim() : '');
  // Some files publish lot size in ACRES (header says so) — convert to sqft.
  const lotIsAcres = idx.lot_sqft >= 0 && /acre/i.test(String(headers[idx.lot_sqft]));

  const parcels = [];
  let dropped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2) continue;
    const apn = get(r, 'apn');
    if (!apn) {
      dropped++;
      continue;
    }
    const logical = {
      property_class: get(r, 'property_class'),
      units: int(get(r, 'units')) ?? unitsFromClass(get(r, 'property_class')),
    };
    if (!preset.isMultifamily(logical)) continue;

    const situsAddr = get(r, 'situs_address');
    const situsZip = get(r, 'situs_zip');
    const mailAddr = get(r, 'mailing_address');
    const mailZip = get(r, 'mailing_zip');
    const owner = get(r, 'owner_name');

    parcels.push({
      apn,
      state: opts.state || preset.state,
      county_fips: opts.countyFips || preset.county_fips,
      situs_address: situsAddr || null,
      situs_city: get(r, 'situs_city') || null,
      situs_zip: situsZip ? situsZip.slice(0, 5) : null,
      owner_name: owner || null,
      owner_is_entity: looksLikeEntity(owner),
      mailing_address: mailAddr || null,
      mailing_city: get(r, 'mailing_city') || null,
      mailing_state: get(r, 'mailing_state') || null,
      mailing_zip: mailZip ? mailZip.slice(0, 5) : null,
      absentee: isAbsentee(situsAddr, situsZip, mailAddr, mailZip),
      property_class: logical.property_class || null,
      units: logical.units,
      year_built: int(get(r, 'year_built')),
      building_sqft: int(get(r, 'building_sqft')),
      lot_sqft: (() => {
        const v = num(get(r, 'lot_sqft'));
        return v == null ? null : Math.round(lotIsAcres ? v * 43560 : v);
      })(),
      last_sale_date: parseDate(get(r, 'last_sale_date')),
      last_sale_price: num(get(r, 'last_sale_price')),
      assessed_value: num(get(r, 'assessed_value')),
      lat: num(get(r, 'lat')),
      lng: num(get(r, 'lng')),
    });
  }
  return { parcels, total: rows.length - 1, kept: parcels.length, dropped, unresolved, delimiter: delim, headers };
}
