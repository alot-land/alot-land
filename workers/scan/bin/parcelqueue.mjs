#!/usr/bin/env node
/**
 * Automatic parcel acquisition for counties you targeted on the Markets page.
 *
 * Usage:
 *   node bin/parcelqueue.mjs                # work the queue, default 3 counties
 *   node bin/parcelqueue.mjs --limit 10
 *   node bin/parcelqueue.mjs --county 47093 # force one, ignoring its status
 *   node bin/parcelqueue.mjs --retry-failed # include previously failed counties
 *   node bin/parcelqueue.mjs --dry-run      # discover only, write nothing
 *
 * The point: clicking "Add to targets" is the ONLY action required. This job
 * finds targeted counties with no parcels, tries every discovery route, and
 * records the outcome in parcel_coverage — including the reasons, which are
 * what tell you whether a county is worth retrying, worth emailing the
 * assessor about, or worth buying.
 *
 * Deliberately incremental. A handful of counties per night, each behind the
 * same 1.5s global throttle as every other lane, is polite traffic. Grinding
 * 79 counties in one pass is not, and would get the droplet blocked.
 */
import { makeDb } from '../lib/db.js';
import { countyConfigFromMarket } from '../lib/parcelsources.js';
import { runCountyLane } from '../lib/countylane.js';
import { importParcels } from '../lib/parcelimport.js';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const LIMIT = Number(arg('limit', 3)) || 3;
const ONLY = arg('county', null);
const RETRY_FAILED = Boolean(arg('retry-failed', false));
const DRY = Boolean(arg('dry-run', false));

// A county whose data landed is re-pulled monthly; ownership and sale history
// move slowly, so anything more often is wasted traffic.
const FRESH_DAYS = 30;
// A failure is usually structural (no service exists), so retry rarely.
const RETRY_DAYS = 14;

const db = makeDb();
const orgId = await db.resolveOrgId();

const { data: targets, error } = await db.supabase
  .from('markets')
  .select('geo_id, state, county, name, poly')
  .eq('org_id', orgId)
  .not('geo_id', 'is', null);
if (error) throw error;

const { data: coverage, error: covErr } = await db.supabase
  .from('parcel_coverage')
  .select('*')
  .eq('org_id', orgId);
if (covErr) throw covErr;
const byFips = new Map((coverage || []).map((c) => [c.county_fips, c]));

const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

/** Which targeted counties are worth attempting right now, and why. */
function pickWork() {
  if (ONLY && ONLY !== true) {
    const t = targets.find((x) => x.geo_id === String(ONLY));
    return t ? [t] : [];
  }
  return targets.filter((t) => {
    const c = byFips.get(t.geo_id);
    if (!c) return true;                                    // never attempted
    if (c.status === 'unsupported') return false;           // decided, stop asking
    if (c.status === 'ok') return daysSince(c.attempted_at) > FRESH_DAYS;
    return RETRY_FAILED && daysSince(c.attempted_at) > RETRY_DAYS;
  });
}

const work = pickWork().slice(0, LIMIT);
if (!work.length) {
  const pending = targets.filter((t) => !byFips.has(t.geo_id)).length;
  console.log(
    `Nothing to do — ${targets.length} targeted counties, ${pending} never attempted, ` +
      `${(coverage || []).filter((c) => c.status === 'ok').length} with data.` +
      (RETRY_FAILED ? '' : ' Use --retry-failed to re-attempt failures.'),
  );
  process.exit(0);
}

console.log(`Working ${work.length} of ${targets.length} targeted counties (limit ${LIMIT})`);

async function record(t, fields) {
  if (DRY) return;
  const prev = byFips.get(t.geo_id);
  const { error: e } = await db.supabase.from('parcel_coverage').upsert(
    {
      org_id: orgId,
      county_fips: t.geo_id,
      state: t.state,
      county_name: t.county || t.name,
      attempts: (prev?.attempts || 0) + 1,
      attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'org_id,county_fips' },
  );
  if (e) console.warn(`  ⚠ could not record coverage: ${e.message}`);
}

let ok = 0;
let failed = 0;
for (const t of work) {
  const cfg = countyConfigFromMarket(t);
  console.log(`\n=== ${cfg.label} (${cfg.fips}) ===`);
  if (!cfg.bbox) {
    // Without a bounding box the geography guard is off, and an unguarded
    // public search is exactly how a Massachusetts layer got picked for Knox.
    console.warn('  ✗ no scan polygon on this target — cannot verify a layer is the right county');
    await record(t, { status: 'failed', reason: 'no scan polygon on the market row (re-add it from Markets)' });
    failed++;
    continue;
  }

  try {
    const out = await runCountyLane(cfg, { discoverOnly: DRY });
    if (DRY) {
      console.log(`  [dry-run] ${JSON.stringify(out.discovered)}`);
      continue;
    }
    const stats = await importParcels(db, orgId, out.res.parcels);
    console.log(
      `  ✓ imported ${stats.imported} · absentee ${stats.absentee} · entity ${stats.entity} · with units ${stats.withUnits}`,
    );
    if (stats.failed?.length) {
      console.warn(`  ⚠ ${stats.failed.length} row(s) rejected by the database`);
      for (const f of stats.failed.slice(0, 5)) console.warn(`    ${f.apn}: ${f.error}`);
    }
    await record(t, {
      status: 'ok',
      parcels: stats.imported,
      source_url: out.via || null,
      reason: null,
    });
    await db.logCost(orgId, `parcel queue ${cfg.label}: ${stats.imported} rows`);
    ok++;
  } catch (e) {
    const reason = e.failures ? e.failures.join(' | ') : e.message;
    console.warn(`  ✗ ${cfg.label}: ${reason}`);
    await record(t, { status: 'failed', parcels: 0, reason: reason.slice(0, 2000) });
    failed++;
  }
}

console.log(`\n${ok} imported · ${failed} failed · ${targets.length - work.length} still queued`);
console.log('Coverage per county is on the Markets page — failures say what to do next.');
