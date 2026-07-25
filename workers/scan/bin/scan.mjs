#!/usr/bin/env node
/**
 * MFDA on-market scanner — Redfin lane.
 *
 * Usage:
 *   node bin/scan.mjs --market phoenix --status both            # active + sold
 *   node bin/scan.mjs --market nashville --status active
 *   node bin/scan.mjs --market phoenix --status sold --days 365
 *   node bin/scan.mjs --market phoenix --status active --dry-run
 *
 * Env (see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * optional MFDA_ORG_ID. --dry-run needs no env at all.
 *
 * Behavior on block: stops immediately, records blocked=true in scan_runs,
 * exits 2. Do not wrap this in a retry loop.
 */
import { gisCsvUrl, fetchGisCsv } from '../lib/redfin.js';
import { listingsFromCSV } from '../lib/csv.js';
import { pullWithBands } from '../lib/bands.js';
import { MARKETS } from '../lib/markets.js';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const marketKey = arg('market');
const statusMode = arg('status', 'both'); // active | sold | both
const soldDays = Number(arg('days', 365));
const dryRun = Boolean(arg('dry-run', false));

const market = MARKETS[marketKey];
if (!market) {
  console.error(`--market must be one of: ${Object.keys(MARKETS).join(', ')}`);
  process.exit(1);
}
if (!['active', 'sold', 'both'].includes(statusMode)) {
  console.error('--status must be active | sold | both');
  process.exit(1);
}

function bandFetcher(statuses) {
  return async (min, max) => {
    const url = gisCsvUrl({
      poly: market.poly,
      statuses,
      soldWithinDays: statuses.sold ? soldDays : undefined,
      minPrice: min > 0 ? min : undefined,
      maxPrice: max < 200_000_000 ? max : undefined,
    });
    const res = await fetchGisCsv(url);
    if (!res.ok) return { ok: false, blocked: res.blocked, listings: [] };
    const { listings, dropped } = listingsFromCSV(res.text);
    return { ok: true, blocked: false, listings, dropped };
  };
}

async function pullLane(label, statuses) {
  console.log(`\n→ ${label} (${market.label})`);
  const result = await pullWithBands(bandFetcher(statuses));
  const droppedNote = result.bands.filter((b) => b.rows === -1).length;
  console.log(
    `  ${result.listings.length} rows · ${result.requests} requests · ` +
      `${result.cappedBands} still-capped bands${result.blocked ? ' · BLOCKED' : ''}` +
      (droppedNote ? ` · ${droppedNote} failed bands` : ''),
  );
  return result;
}

const started = Date.now();
console.log(`MFDA scan · market=${marketKey} · status=${statusMode}${dryRun ? ' · DRY RUN' : ''}`);

let db = null;
let orgId = null;
let runId = null;
if (!dryRun) {
  const { makeDb } = await import('../lib/db.js');
  db = makeDb();
  orgId = await db.resolveOrgId();
  runId = await db.startScanRun(orgId, marketKey, statusMode);
}

let blocked = false;
let requests = 0;
let cappedBands = 0;
let activeRows = 0;
let soldRows = 0;
const notes = [];

try {
  if (statusMode !== 'sold') {
    const r = await pullLane('active + pending + coming-soon', {
      active: true,
      pending: true,
      comingsoon: true,
      contingent: true,
    });
    requests += r.requests;
    cappedBands += r.cappedBands;
    blocked = blocked || r.blocked;
    const active = r.listings.filter((l) => l.status !== 'sold');
    activeRows = active.length;
    notes.push(`active bands: ${JSON.stringify(r.bands)}`);
    if (!dryRun && active.length) {
      await db.upsertActiveDeals(orgId, active);
      console.log(`  ↳ upserted ${active.length} deals (lead queue)`);
    }
  }

  if (statusMode !== 'active' && !blocked) {
    const r = await pullLane(`sold within ${soldDays}d`, { sold: true });
    requests += r.requests;
    cappedBands += r.cappedBands;
    blocked = blocked || r.blocked;
    soldRows = r.listings.length;
    notes.push(`sold bands: ${JSON.stringify(r.bands)}`);
    if (!dryRun && r.listings.length) {
      await db.upsertComps(orgId, r.listings);
      console.log(`  ↳ upserted ${r.listings.length} comps`);
    }
  }
} finally {
  if (!dryRun && runId) {
    await db.finishScanRun(runId, {
      ok: !blocked,
      blocked,
      requests_made: requests,
      rows_fetched: activeRows + soldRows,
      rows_active: activeRows,
      rows_sold: soldRows,
      capped_bands: cappedBands,
      notes: notes.join('\n').slice(0, 8000),
    });
    await db.logCost(orgId, `redfin scan ${marketKey}/${statusMode}: ${requests} requests`);
  }
}

// Post-scan chores (droplet has open internet; the build sandbox doesn't).
// Failures never affect the scan itself.
if (!dryRun && !blocked) {
  const { spawnSync } = await import('node:child_process');
  const runChild = (name, args = []) => {
    const script = new URL(`./${name}`, import.meta.url).pathname;
    const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', timeout: 45 * 60_000 });
    if (r.status !== 0) console.warn(`  ${name} incomplete — retries on the next scan (details above).`);
  };

  // Phase 2: county assessor auto-import — bootstraps when empty, then
  // refreshes monthly (owners change; assessor files update periodically).
  // Disable with MFDA_PARCELS_AUTO=0.
  if (process.env.MFDA_PARCELS_AUTO !== '0') {
    try {
      const { parcelCount } = await import('../lib/parcelimport.js');
      const empty = (await parcelCount(db, orgId)) === 0;
      let stale = false;
      if (!empty) {
        const { data } = await db.supabase
          .from('parcels')
          .select('imported_at')
          .eq('org_id', orgId)
          .order('imported_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        stale = !data || (Date.now() - new Date(data.imported_at).getTime()) / 86400e3 > 30;
      }
      if (empty || stale) {
        console.log(`\n→ parcels ${empty ? 'table is empty' : 'data is >30d old'} — running county auto-import …`);
        runChild('parcels.mjs', ['--source', 'all']);
      }
    } catch (e) {
      console.warn(`  parcels bootstrap skipped: ${e.message}`);
    }
  }

  // Phase 3: refresh national market stats when empty/stale (the script
  // itself no-ops when data is <90 days old), then scan any target markets
  // added from the Markets finder. Only after the first market of the day
  // (phoenix) so the nashville run doesn't repeat them.
  if (marketKey === 'phoenix' && process.env.MFDA_USMARKETS_AUTO !== '0') {
    try {
      console.log('\n→ US market stats refresh check …');
      runChild('usmarkets.mjs');
      runChild('targets.mjs');
    } catch (e) {
      console.warn(`  usmarkets/targets skipped: ${e.message}`);
    }
  }
}

const secs = Math.round((Date.now() - started) / 1000);
if (blocked) {
  console.error(`\n✗ Redfin returned a block/challenge. Stopped without retrying (${secs}s).`);
  console.error('  Do NOT re-run immediately. Wait, then try again; if persistent, use the site manually.');
  process.exit(2);
}
console.log(`\n✓ Done in ${secs}s. ${activeRows} active → deals, ${soldRows} sold → comps.`);
