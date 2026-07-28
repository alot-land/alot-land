/**
 * Shared parcel import: essentials gate, chunked upserts, inspect report.
 * Used by both bin/assessor.mjs (manual file) and bin/parcels.mjs (auto).
 */

// A mail campaign needs at minimum: which parcel, who owns it, where to mail.
export const ESSENTIAL_FIELDS = ['apn', 'owner_name', 'mailing_address'];

export function essentialsOk(res) {
  if (!ESSENTIAL_FIELDS.every((f) => !res.unresolved.includes(f))) return false;
  // The multifamily filter reads units OR the land-use class. With neither
  // resolved it cannot distinguish an apartment building from a car park, so
  // whatever survives the filter is arbitrary. A Knox run reported both
  // unresolved, called them "not essential", and proceeded to keep 0 rows
  // from an out-of-state layer (field-verified 2026-07-26).
  if (res.unresolved.includes('units') && res.unresolved.includes('property_class')) return false;
  return true;
}

/** Human/pasteable report of how a file parsed — the iterate-loop payload. */
export function inspectReport(res, label = '') {
  const lines = [];
  lines.push(`=== parse report ${label} ===`);
  lines.push(`delimiter=${JSON.stringify(res.delimiter)} rows=${res.total} kept=${res.kept} dropped=${res.dropped}`);
  lines.push(`headers: ${(res.headers || []).join(' | ')}`);
  if (res.unresolved?.length) {
    const noFilterField = res.unresolved.includes('units') && res.unresolved.includes('property_class');
    const blocking = [
      ...res.unresolved.filter((f) => ESSENTIAL_FIELDS.includes(f)),
      ...(noFilterField ? ['units + property_class (nothing to filter multifamily on)'] : []),
    ];
    lines.push(`UNRESOLVED fields: ${res.unresolved.join(', ')}`);
    lines.push(
      blocking.length
        ? `  BLOCKING (import aborts): ${blocking.join(', ')} — the rest are quality gaps`
        : '  none of these are essential — import proceeds',
    );
  }
  // Counties with no unit column derive units from the class description.
  // Whatever it can't read is the gap between "imported" and "screenable",
  // so name the descriptions rather than making it another round-trip.
  const noUnits = (res.parcels || []).filter((p) => p.units == null);
  if (noUnits.length) {
    const counts = new Map();
    for (const p of noUnits) {
      const k = p.property_class || '(blank)';
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
    lines.push(`no unit count on ${noUnits.length} of ${res.parcels.length} — these screen as "needs data":`);
    for (const [k, n] of top) lines.push(`  ${n}× ${k}`);
  }
  if (res.parcels?.[0]) lines.push(`first parcel: ${JSON.stringify(res.parcels[0])}`);
  return lines.join('\n');
}

/**
 * Chunked upsert into parcels, tolerant of individual bad rows.
 *
 * A failing chunk is split in half and retried rather than abandoned, so one
 * malformed value costs its own row instead of the 499 around it (a single
 * unrounded lot size took down a whole 12k import, field-verified
 * 2026-07-25). Binary isolation keeps that cheap: ~log2(chunk) extra calls
 * per bad row instead of one call per row.
 *
 * Rejected rows are RETURNED, never swallowed — the caller reports them.
 * Silent partial imports are the failure mode worth fearing here: a mail
 * list that quietly lost rows still looks complete.
 */
export async function importParcels(db, orgId, parcels) {
  const rows = parcels.map((p) => ({
    org_id: orgId,
    dedupe_key: `apn:${p.county_fips || 'na'}:${p.apn}`.toLowerCase(),
    ...p,
  }));
  const failed = [];

  async function upsert(slice) {
    if (!slice.length) return 0;
    const { error } = await db.supabase
      .from('parcels')
      .upsert(slice, { onConflict: 'org_id,dedupe_key' });
    if (!error) return slice.length;
    if (slice.length === 1) {
      failed.push({ apn: slice[0].apn, error: error.message });
      return 0;
    }
    const mid = Math.floor(slice.length / 2);
    return (await upsert(slice.slice(0, mid))) + (await upsert(slice.slice(mid)));
  }

  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK) imported += await upsert(rows.slice(i, i + CHUNK));

  // A handful of odd rows is data reality; a broad failure is a bug, and
  // should stop the run rather than leave a plausible-looking partial table.
  // Both bars must be cleared — a ratio alone would trip on tiny batches
  // where one bad row is 25%, a count alone would ignore 24 losses in 30.
  if (failed.length > Math.max(25, rows.length * 0.02)) {
    throw new Error(
      `parcels upsert rejected ${failed.length} of ${rows.length} rows (>2%) — imported ${imported} before stopping. ` +
        `First errors: ${failed.slice(0, 3).map((f) => `${f.apn}: ${f.error}`).join(' | ')}`,
    );
  }

  const ok = rows.filter((r) => !failed.some((f) => f.apn === r.apn));
  return {
    imported,
    failed,
    absentee: ok.filter((r) => r.absentee).length,
    entity: ok.filter((r) => r.owner_is_entity).length,
    withUnits: ok.filter((r) => r.units != null).length,
  };
}

export async function parcelCount(db, orgId) {
  const { count, error } = await db.supabase
    .from('parcels')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (error) throw error;
  return count || 0;
}
