/**
 * Shared parcel import: essentials gate, chunked upserts, inspect report.
 * Used by both bin/assessor.mjs (manual file) and bin/parcels.mjs (auto).
 */

// A mail campaign needs at minimum: which parcel, who owns it, where to mail.
export const ESSENTIAL_FIELDS = ['apn', 'owner_name', 'mailing_address'];

export function essentialsOk(res) {
  return ESSENTIAL_FIELDS.every((f) => !res.unresolved.includes(f));
}

/** Human/pasteable report of how a file parsed — the iterate-loop payload. */
export function inspectReport(res, label = '') {
  const lines = [];
  lines.push(`=== parse report ${label} ===`);
  lines.push(`delimiter=${JSON.stringify(res.delimiter)} rows=${res.total} kept=${res.kept} dropped=${res.dropped}`);
  lines.push(`headers: ${(res.headers || []).join(' | ')}`);
  if (res.unresolved?.length) {
    const blocking = res.unresolved.filter((f) => ESSENTIAL_FIELDS.includes(f));
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

/** Chunked upsert into parcels. Returns stats. */
export async function importParcels(db, orgId, parcels) {
  const rows = parcels.map((p) => ({
    org_id: orgId,
    dedupe_key: `apn:${p.county_fips || 'na'}:${p.apn}`.toLowerCase(),
    ...p,
  }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.supabase
      .from('parcels')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'org_id,dedupe_key' });
    if (error) throw new Error(`parcels upsert failed: ${error.message}`);
  }
  return {
    imported: rows.length,
    absentee: rows.filter((r) => r.absentee).length,
    entity: rows.filter((r) => r.owner_is_entity).length,
    withUnits: rows.filter((r) => r.units != null).length,
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
