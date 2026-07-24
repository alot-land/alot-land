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
  owner_name: ['owner_name', 'owner', 'ownername', 'owner1', 'current_owner', 'taxpayer_name', 'taxpayer'],
  mailing_address: ['mailing_address', 'mail_address', 'mail_addr', 'owner_address', 'mailing_addr1', 'mail_line1', 'taxpayer_address'],
  mailing_city: ['mailing_city', 'mail_city', 'owner_city', 'taxpayer_city'],
  mailing_state: ['mailing_state', 'mail_state', 'owner_state', 'taxpayer_state'],
  mailing_zip: ['mailing_zip', 'mail_zip', 'owner_zip', 'mail_zipcode', 'taxpayer_zip'],
  situs_address: ['situs_address', 'situs_addr', 'situs', 'property_address', 'prop_address', 'site_address', 'location', 'property_location'],
  situs_city: ['situs_city', 'property_city', 'prop_city', 'site_city', 'city'],
  situs_zip: ['situs_zip', 'property_zip', 'prop_zip', 'site_zip', 'zip', 'zip_code'],
  units: ['units', 'unit_count', 'number_of_units', 'num_units', 'no_of_units', 'total_units', 'numberofunits', 'living_units', 'number_of_living_units', 'dwelling_units', 'res_units'],
  year_built: ['year_built', 'yearbuilt', 'const_year', 'year_constructed', 'yr_built', 'eff_year_built'],
  property_class: ['property_class', 'class', 'property_use', 'use_code', 'puc', 'land_use', 'land_use_desc', 'land_use_description', 'use_description', 'property_use_description', 'property_type', 'classification', 'prop_class'],
  last_sale_date: ['last_sale_date', 'sale_date', 'deed_date', 'sale_dt', 'last_sold', 'transfer_date'],
  last_sale_price: ['last_sale_price', 'sale_price', 'sale_amount', 'consideration', 'last_sale_amount', 'price'],
  assessed_value: ['assessed_value', 'total_assessed', 'assessed_total', 'full_cash_value', 'fcv', 'total_value', 'appraised_value', 'total_appraisal'],
  building_sqft: ['building_sqft', 'improvement_sqft', 'living_area', 'bldg_sqft', 'sqft', 'finished_area', 'total_living_area'],
  lot_sqft: ['lot_sqft', 'land_sqft', 'lot_size', 'land_area', 'acreage', 'lot_area'],
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

/** Resolve logical fields to column indexes for this file's headers. */
export function resolveColumns(headers, columns = GENERIC) {
  const norm = headers.map((h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const idx = {};
  for (const [field, candidates] of Object.entries(columns)) {
    idx[field] = -1;
    for (const cand of candidates) {
      const i = norm.indexOf(cand);
      if (i >= 0) {
        idx[field] = i;
        break;
      }
    }
  }
  return idx;
}

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

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // YYYYMMDD | YYYY-MM-DD | MM/DD/YYYY
  let m = s.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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
      units: num(get(r, 'units')),
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
      year_built: num(get(r, 'year_built')),
      building_sqft: num(get(r, 'building_sqft')),
      lot_sqft: num(get(r, 'lot_sqft')),
      last_sale_date: parseDate(get(r, 'last_sale_date')),
      last_sale_price: num(get(r, 'last_sale_price')),
      assessed_value: num(get(r, 'assessed_value')),
    });
  }
  return { parcels, total: rows.length - 1, kept: parcels.length, dropped, unresolved, delimiter: delim, headers };
}
