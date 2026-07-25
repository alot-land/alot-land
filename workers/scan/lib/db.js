/**
 * Supabase persistence for the scanner. Uses the SERVICE ROLE key — this file
 * runs only on trusted machines (operator laptop / droplet cron), never in the
 * browser app. RLS is bypassed by design; org scoping is explicit here.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** `KEY=value` lines → object. Comments, blanks, and quotes handled. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || /^\s*#/.test(line)) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Populate process.env from workers/scan/.env when the DB vars are missing,
 * so `node bin/parcels.mjs` works without `--env-file` or a sourced shell.
 * Never overrides a variable that is already set.
 */
export function loadEnvFile(path) {
  const file = path || join(dirname(dirname(fileURLToPath(import.meta.url))), '.env');
  let parsed;
  try {
    parsed = parseEnvFile(readFileSync(file, 'utf8'));
  } catch {
    return false; // no .env — the caller's error message still applies
  }
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
  return true;
}

// Load workers/scan/.env at IMPORT time, not inside makeDb().
//
// Every bin script imports this module, and several read their own
// credentials at module top level — before makeDb() is ever called.
// bin/hudfmr.mjs hit exactly that: it exited with "Set HUD_API_TOKEN" while
// the token sat in .env, because the check ran nine lines above makeDb().
// Loading on import removes the ordering hazard for every script at once,
// including future ones. Existing variables are never overridden, so an
// exported shell value or a cron environment still wins.
loadEnvFile();

export function makeDb(env = process.env) {
  if (env === process.env && !(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)) loadEnvFile();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example, or run with --env-file=.env)');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  /** Resolve target org: MFDA_ORG_ID env wins; else the sole org in the DB. */
  async function resolveOrgId() {
    if (env.MFDA_ORG_ID) return env.MFDA_ORG_ID;
    const { data, error } = await supabase.from('orgs').select('id, name');
    if (error) throw error;
    if (!data?.length) throw new Error('No orgs exist yet — sign into the app once first.');
    if (data.length > 1) {
      throw new Error(
        `Multiple orgs found (${data.map((o) => o.name).join(', ')}). Set MFDA_ORG_ID to choose.`,
      );
    }
    return data[0].id;
  }

  /** Normalized-address dedupe key (mirrors the app's queries.js fallback). */
  function dedupeKey(l) {
    const norm = [l.address, l.city, l.state, l.zip]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return `addr:${norm}`;
  }

  /**
   * ACTIVE lane → deals. New rows insert with status 'lead'; rows that already
   * exist get their LISTING fields refreshed only — never status/notes/price
   * overrides the operator may have set. (A plain upsert would reset a deal
   * you'd moved to 'analyzing' back to 'lead' on every re-scan.)
   */
  async function upsertActiveDeals(orgId, listings) {
    if (!listings.length) return 0;
    const now = new Date().toISOString();
    const withKeys = listings.map((l) => ({ l, key: dedupeKey(l) }));

    const { data: existing, error: exErr } = await supabase
      .from('deals')
      .select('id, dedupe_key')
      .eq('org_id', orgId)
      .in('dedupe_key', withKeys.map((w) => w.key));
    if (exErr) throw exErr;
    const existingByKey = new Map((existing || []).map((r) => [r.dedupe_key, r.id]));

    const listingFields = (l) => ({
      price: l.price,
      year_built: l.year_built,
      mls_number: l.mls_number,
      listing_url: l.url || null,
      unit_bucket: l.unit_bucket,
      beds_total: l.beds_total,
      baths_total: l.baths_total,
      sqft: l.sqft,
      lat: l.lat,
      lng: l.lng,
      days_on_market: l.days_on_market,
      listing_status: l.status,
      scanned_at: now,
    });

    const inserts = withKeys
      .filter((w) => !existingByKey.has(w.key))
      .map(({ l, key }) => ({
        org_id: orgId,
        dedupe_key: key,
        address: l.address || null,
        city: l.city || null,
        state: l.state || null,
        zip: l.zip || null,
        status: 'lead',
        source: 'redfin',
        ...listingFields(l),
      }));
    if (inserts.length) {
      const { error } = await supabase.from('deals').insert(inserts);
      if (error) throw error;
    }

    for (const { l, key } of withKeys) {
      const id = existingByKey.get(key);
      if (!id) continue;
      const { error } = await supabase.from('deals').update(listingFields(l)).eq('id', id);
      if (error) throw error;
    }
    return listings.length;
  }

  /** SOLD lane → comps. Upsert on (org_id, dedupe_key). */
  async function upsertComps(orgId, listings) {
    if (!listings.length) return 0;
    const rows = listings.map((l) => ({
      org_id: orgId,
      source: 'redfin',
      dedupe_key: `${dedupeKey(l)}:${l.mls_number || l.price}`,
      mls_number: l.mls_number,
      address: l.address || null,
      city: l.city || null,
      state: l.state || null,
      zip: l.zip || null,
      price: l.price,
      sold_date: l.sold_date,
      property_type: l.property_type,
      unit_bucket: l.unit_bucket,
      beds_total: l.beds_total,
      baths_total: l.baths_total,
      sqft: l.sqft,
      year_built: l.year_built,
      lat: l.lat,
      lng: l.lng,
      url: l.url || null,
      raw: {},
    }));
    const { error } = await supabase
      .from('comps')
      .upsert(rows, { onConflict: 'org_id,dedupe_key', ignoreDuplicates: false });
    if (error) throw error;
    return rows.length;
  }

  async function startScanRun(orgId, market, statuses) {
    const { data, error } = await supabase
      .from('scan_runs')
      .insert({ org_id: orgId, market, statuses, source: 'redfin' })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  }

  async function finishScanRun(id, patch) {
    const { error } = await supabase
      .from('scan_runs')
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async function logCost(orgId, description) {
    await supabase.from('cost_ledger').insert({
      org_id: orgId,
      kind: 'api',
      provider: 'redfin',
      description,
      amount_usd: 0,
    });
  }

  return { supabase, resolveOrgId, upsertActiveDeals, upsertComps, startScanRun, finishScanRun, logCost, dedupeKey };
}
