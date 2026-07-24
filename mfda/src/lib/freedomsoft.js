/**
 * FreedomSoft-ready CSV export (Phase 2 gate).
 *
 * FreedomSoft's importer does its own column mapping on upload, so the
 * contract here is clean, unambiguous headers — not a byte-exact template.
 * Owner Name is the assessor's verbatim string (ground truth); the First/Last
 * split is best-effort for mail-merge and safe to ignore at import time.
 */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Assessor names are usually "LAST FIRST M" or "LAST, FIRST". Entities keep
 * the full string in Last Name so mail merges read "Dear DESERT HOLDINGS LLC"
 * rather than inventing a first name. */
export function splitOwnerName(name, isEntity) {
  const full = String(name || '').trim();
  if (!full) return { first: '', last: '' };
  if (isEntity) return { first: '', last: full };
  const comma = full.split(',');
  if (comma.length === 2) return { first: comma[1].trim(), last: comma[0].trim() };
  const parts = full.split(/\s+/);
  if (parts.length === 1) return { first: '', last: full };
  return { first: parts.slice(1).join(' '), last: parts[0] };
}

export const FREEDOMSOFT_HEADERS = [
  'Owner Name',
  'Owner First Name',
  'Owner Last Name',
  'Property Address',
  'Property City',
  'Property State',
  'Property Zip',
  'Mailing Address',
  'Mailing City',
  'Mailing State',
  'Mailing Zip',
  'Units',
  'Year Built',
  'Last Sale Date',
  'Last Sale Price',
  'Assessed Value',
  'APN',
  'County FIPS',
  'Tags',
  'List Name',
];

function tagsFor(p) {
  const t = ['mfda', 'multifamily'];
  if (p.absentee) t.push('absentee');
  if (p.owner_is_entity) t.push('entity-owned');
  if (p.units != null) t.push(`${p.units}u`);
  return t.join(';');
}

/** parcels rows (from the parcels table) → CSV text. */
export function freedomsoftCSV(parcels, listName) {
  const lines = [FREEDOMSOFT_HEADERS.map(csvCell).join(',')];
  for (const p of parcels) {
    const { first, last } = splitOwnerName(p.owner_name, p.owner_is_entity);
    lines.push(
      [
        p.owner_name,
        first,
        last,
        p.situs_address,
        p.situs_city,
        p.state,
        p.situs_zip,
        p.mailing_address,
        p.mailing_city,
        p.mailing_state,
        p.mailing_zip,
        p.units,
        p.year_built,
        p.last_sale_date,
        p.last_sale_price,
        p.assessed_value,
        p.apn,
        p.county_fips,
        tagsFor(p),
        listName,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Trigger a browser download of the CSV. */
export function downloadCSV(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
