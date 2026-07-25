import { supabase } from './supabase';

// Supabase truncates every request to 1000 rows regardless of .limit()
// (PostgREST max-rows) — field-verified when a 6,800-parcel export came back
// as exactly 1,000. Anything that can exceed 1000 rows must page.
async function fetchPaged(buildQuery, max = 10000) {
  const out = [];
  let total = null;
  for (let from = 0; from < max; from += 1000) {
    const { data, error, count } = await buildQuery().range(from, Math.min(from + 999, max - 1));
    if (error) throw error;
    if (count != null) total = count;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return { rows: out, count: total ?? out.length };
}

/** Canonical property key = APN + county FIPS, fallback normalized address hash. */
export function dedupeKey({ apn, county_fips, address, city, state, zip }) {
  if (apn && county_fips) return `apn:${county_fips}:${apn}`.toLowerCase();
  const norm = [address, city, state, zip]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `addr:${norm}`;
}

// ---- Deals ----------------------------------------------------------------
// The pipeline view: everything EXCEPT untouched scraped leads (those live on
// the On-Market page until the operator hits Analyze).
export async function listDeals(orgId) {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'lead')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return attachLatestScenario(data);
}

/**
 * Attach each deal's most recent scenario (outputs + calc version) so lists
 * can show real underwritten cash flow instead of a re-estimate. Paged: a few
 * deals with many revisions can blow past the 1000-row cap.
 */
async function attachLatestScenario(deals) {
  if (!deals?.length) return deals || [];
  const ids = deals.map((d) => d.id);
  const { rows } = await fetchPaged(
    () =>
      supabase
        .from('scenarios')
        .select('deal_id, outputs, calc_version, created_at')
        .in('deal_id', ids)
        .order('created_at', { ascending: false }),
    20000,
  );
  const latest = new Map();
  for (const s of rows) if (!latest.has(s.deal_id)) latest.set(s.deal_id, s);
  return deals.map((d) => {
    const s = latest.get(d.id);
    return { ...d, latest_outputs: s?.outputs || null, latest_calc_version: s?.calc_version || null };
  });
}

// The scraped lead queue (On-Market page).
export async function listOnMarket(orgId) {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'lead')
    .order('scanned_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

export async function setDealStatus(id, status) {
  const { error } = await supabase.from('deals').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function setDealFavorite(id, favorite) {
  const { error } = await supabase.from('deals').update({ favorite }).eq('id', id);
  if (error) throw error;
}

export async function setDealRating(id, rating) {
  const { error } = await supabase.from('deals').update({ rating }).eq('id', id);
  if (error) throw error;
}

// Commit a deal to a goal (or null to unassign) with its per-deal target.
export async function assignDealGoal(id, goalId, targetMonthly) {
  const { error } = await supabase
    .from('deals')
    .update({ goal_id: goalId, deal_target_monthly: targetMonthly ?? null })
    .eq('id', id);
  if (error) throw error;
}

// Stage + actual contract terms.
export async function updateDealTracking(id, fields) {
  const allowed = {};
  for (const k of ['status', 'contract_price', 'contract_date', 'expected_close_date']) {
    if (fields[k] !== undefined) allowed[k] = fields[k] === '' ? null : fields[k];
  }
  const { error } = await supabase.from('deals').update(allowed).eq('id', id);
  if (error) throw error;
}

// Deals committed to any goal + the latest scenario per deal (for progress).
export async function listGoalDeals(orgId) {
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, address, city, state, status, goal_id, deal_target_monthly')
    .eq('org_id', orgId)
    .not('goal_id', 'is', null);
  if (error) throw error;
  if (!deals.length) return [];
  const { data: scens, error: e2 } = await supabase
    .from('scenarios')
    .select('deal_id, outputs, created_at')
    .in('deal_id', deals.map((d) => d.id))
    .order('created_at', { ascending: false });
  if (e2) throw e2;
  const latest = new Map();
  for (const s of scens) if (!latest.has(s.deal_id)) latest.set(s.deal_id, s);
  return deals.map((d) => ({ ...d, latest_outputs: latest.get(d.id)?.outputs || null }));
}

// Sold comps for a state (bucket/radius filtering happens client-side via mf-calc).
export async function listCompsForState(orgId, state) {
  const { rows } = await fetchPaged(
    () =>
      supabase
        .from('comps')
        .select('price, lat, lng, beds_total, sqft, unit_bucket, sold_date, address, city, url')
        .eq('org_id', orgId)
        .eq('state', state)
        .order('sold_date', { ascending: false }),
    4000,
  );
  return rows;
}

export async function getRentBands(orgId, zip) {
  const { data, error } = await supabase
    .from('rent_bands')
    .select('source, zip, period, bedrooms, rent, confidence, retrieved_at')
    .eq('org_id', orgId)
    .eq('zip', zip);
  if (error) throw error;
  return data;
}

export async function getListingContact(dealId) {
  const { data, error } = await supabase
    .from('contacts')
    .select('owner_name, brokerage, phone, dnc_exempt, source')
    .eq('deal_id', dealId)
    .eq('source', 'listing')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function latestScanRun(orgId) {
  const { data, error } = await supabase
    .from('scan_runs')
    .select('*')
    .eq('org_id', orgId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findDealByDedupeKey(orgId, key) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('dedupe_key', key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDeal(id) {
  const { data, error } = await supabase.from('deals').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function upsertDeal(orgId, userId, deal) {
  const row = {
    org_id: orgId,
    apn: deal.apn || null,
    county_fips: deal.county_fips || null,
    dedupe_key: dedupeKey(deal),
    address: deal.address || null,
    city: deal.city || null,
    state: deal.state || null,
    zip: deal.zip || null,
    status: deal.status || 'analyzing',
    units_count: deal.units_count ?? null,
    year_built: deal.year_built ?? null,
    price: deal.price ?? null,
    source: deal.source || 'manual',
    notes: deal.notes || null,
  };
  if (deal.id) {
    // On edit, unspecified source/notes mean "keep what's there" (protects
    // redfin provenance and the off-market owner details written into notes —
    // the form doesn't carry notes, so writing null would erase them).
    if (deal.source === undefined) delete row.source;
    if (deal.notes === undefined) delete row.notes;
    const { data, error } = await supabase.from('deals').update(row).eq('id', deal.id).select().single();
    if (error) throw friendlyDedupeError(error);
    return data;
  }
  // Deals are unique per property (org_id + dedupe_key). A manual entry can
  // collide with an existing scraped lead — surface that clearly instead of
  // a raw Postgres 23505.
  const existing = await findDealByDedupeKey(orgId, row.dedupe_key);
  if (existing) {
    const e = new Error(
      'A deal for this property already exists in your pipeline (same address/APN) — open it from the Deals or On-Market page instead of creating a duplicate.',
    );
    e.existingDealId = existing.id;
    throw e;
  }
  const { data, error } = await supabase
    .from('deals')
    .insert({ ...row, created_by: userId })
    .select()
    .single();
  if (error) throw friendlyDedupeError(error);
  return data;
}

function friendlyDedupeError(error) {
  if (error?.code === '23505') {
    return new Error('Another deal already uses this address/APN — each property can have only one deal.');
  }
  return error;
}

// ---- Units ----------------------------------------------------------------
export async function getUnits(dealId) {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('deal_id', dealId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function replaceUnits(orgId, dealId, units) {
  await supabase.from('units').delete().eq('deal_id', dealId);
  if (!units.length) return [];
  const rows = units.map((u, i) => ({
    org_id: orgId,
    deal_id: dealId,
    type: u.type,
    count: u.count,
    sqft: u.sqft,
    actual_rent: u.actual_rent,
    market_rent: u.market_rent,
    sort_order: i,
  }));
  const { data, error } = await supabase.from('units').insert(rows).select();
  if (error) throw error;
  return data;
}

// ---- Scenarios (immutable) ------------------------------------------------
export async function listScenarios(dealId) {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveScenario(orgId, userId, dealId, { label, inputs, outputs, calc_version }) {
  const { data, error } = await supabase
    .from('scenarios')
    .insert({ org_id: orgId, deal_id: dealId, label, inputs, outputs, calc_version, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Off-market parcels (Phase 2) ----------------------------------------
// Filters run server-side so a county-sized table stays cheap; the 5000 cap
// is a mail-campaign-sized page, not the dataset limit.
export async function listParcels(orgId, f = {}) {
  const build = () => {
    let q = supabase
      .from('parcels')
      .select(
        'id, apn, state, county_fips, situs_address, situs_city, situs_zip, owner_name, owner_is_entity, mailing_address, mailing_city, mailing_state, mailing_zip, absentee, property_class, units, year_built, building_sqft, last_sale_date, last_sale_price, assessed_value, lat, lng, rating',
        { count: 'exact' },
      )
      .eq('org_id', orgId);
    if (f.state && f.state !== 'all') q = q.eq('state', f.state);
    if (f.rating && f.rating !== 'all') {
      if (f.rating === 'none') q = q.is('rating', null);
      else q = q.eq('rating', f.rating);
    }
    if (f.countyFips && f.countyFips !== 'all') q = q.eq('county_fips', f.countyFips);
    if (f.absentee) q = q.eq('absentee', true);
    if (f.entity) q = q.eq('owner_is_entity', true);
    if (f.minUnits) q = q.gte('units', Number(f.minUnits));
    if (f.maxUnits) q = q.lte('units', Number(f.maxUnits));
    if (f.soldBefore) q = q.lte('last_sale_date', f.soldBefore);
    if (f.search && f.search.trim()) {
      const s = f.search.trim().replace(/[%,]/g, ' ');
      q = q.or(`situs_address.ilike.%${s}%,owner_name.ilike.%${s}%,situs_city.ilike.%${s}%,apn.ilike.%${s}%`);
    }
    return q.order('units', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
  };
  return fetchPaged(build, 10000);
}

// Distinct state/county pairs actually imported (drives the filter dropdowns).
export async function listParcelCounties(orgId) {
  // Distinct pairs via aggregation-free pagination over an ordered scan
  // would be wasteful at county scale — lean on the geo index instead.
  const { rows } = await fetchPaged(
    () => supabase.from('parcels').select('state, county_fips').eq('org_id', orgId).order('state').order('county_fips'),
    50000,
  );
  const seen = new Map();
  for (const r of rows) seen.set(`${r.state}:${r.county_fips}`, r);
  return [...seen.values()].sort((a, b) => `${a.state}${a.county_fips}`.localeCompare(`${b.state}${b.county_fips}`));
}

export async function getParcel(id) {
  const { data, error } = await supabase.from('parcels').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// rating: 'heart' | 'up' | 'down' | null
export async function setParcelRating(id, rating) {
  const { error } = await supabase.from('parcels').update({ rating }).eq('id', id);
  if (error) throw error;
}

// ---- Notes (timestamped, org-shared; attach to parcels or deals) ----------
export async function listNotes(orgId, entityType, entityId) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, body, author_email, created_at')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addNote(orgId, user, entityType, entityId, body) {
  const { data, error } = await supabase
    .from('notes')
    .insert({
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      body,
      author_email: user?.email || null,
      created_by: user?.id || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) throw error;
}

// Minimal parcel value index (address+zip → county appraisal) for spotting
// on-market listings priced under county value.
export async function listParcelValueIndex(orgId) {
  const { rows } = await fetchPaged(
    () =>
      supabase
        .from('parcels')
        .select('situs_address, situs_zip, assessed_value')
        .eq('org_id', orgId)
        .not('assessed_value', 'is', null)
        .order('id'),
    20000,
  );
  return rows;
}

// Every rent band for the org (zip → est. market rent), for parcel screening.
export async function listAllRentBands(orgId) {
  const { rows } = await fetchPaged(
    () =>
      supabase
        .from('rent_bands')
        .select('zip, bedrooms, rent, source, period')
        .eq('org_id', orgId)
        .order('zip'),
    20000,
  );
  return rows;
}

export async function listMailLists(orgId) {
  const { data, error } = await supabase
    .from('mail_lists')
    .select('id, name, filters, created_at, mail_list_items(count)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createMailList(orgId, userId, { name, filters, parcelIds }) {
  const { data: list, error } = await supabase
    .from('mail_lists')
    .insert({ org_id: orgId, name, filters, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  const CHUNK = 500;
  for (let i = 0; i < parcelIds.length; i += CHUNK) {
    const rows = parcelIds.slice(i, i + CHUNK).map((pid) => ({
      list_id: list.id,
      parcel_id: pid,
      org_id: orgId,
    }));
    const { error: e2 } = await supabase.from('mail_list_items').insert(rows);
    if (e2) throw e2;
  }
  return list;
}

// Deleting a list removes its snapshot (items cascade); logged exports keep
// their history with the list reference cleared.
export async function deleteMailList(id) {
  const { error } = await supabase.from('mail_lists').delete().eq('id', id);
  if (error) throw error;
}

export async function listParcelsForMailList(listId) {
  const { rows } = await fetchPaged(
    () => supabase.from('mail_list_items').select('parcels(*)').eq('list_id', listId).order('parcel_id'),
    10000,
  );
  return rows.map((r) => r.parcels).filter(Boolean);
}

export async function logMailExport(orgId, userId, { listId, rowCount }) {
  const { error } = await supabase.from('mail_exports').insert({
    org_id: orgId,
    list_id: listId || null,
    format: 'freedomsoft',
    row_count: rowCount,
    created_by: userId,
  });
  if (error) console.error('mail_exports', error);
}

// ---- US market finder (Phase 3) ------------------------------------------
// Raw county stats — ALL derived numbers (yields, CAGRs, scores) come from
// @alot/mf-calc in the page, so the math stays in the frozen engine.
export async function listMarketStats(orgId) {
  const { rows } = await fetchPaged(
    () =>
      supabase
        .from('market_stats')
        .select(
          'geo_id, name, state, lat, lng, land_sqmi, population, pop_5y_ago, zhvi_now, zhvi_1y, zhvi_5y, zori_now, zori_1y, zori_5y, median_re_tax, median_home_value_acs, renters, occupied_units, vacant_for_rent, nri_score, nri_rating, retrieved_at',
        )
        .eq('org_id', orgId)
        .eq('geo_level', 'county')
        .order('geo_id'),
    5000,
  );
  return rows;
}

// Counties already added as scan targets (marks rows in the finder).
export async function listTargetGeoIds(orgId) {
  const { data, error } = await supabase
    .from('markets')
    .select('geo_id')
    .eq('org_id', orgId)
    .not('geo_id', 'is', null);
  if (error) throw error;
  return new Set(data.map((r) => r.geo_id));
}

export async function addMarketTarget(orgId, target) {
  const { data, error } = await supabase
    .from('markets')
    .insert({
      org_id: orgId,
      state: target.state,
      county: target.county || null,
      name: target.name,
      geo_id: target.geo_id,
      poly: target.poly,
      scan_enabled: true,
      source: 'finder',
      property_tax_rate: target.property_tax_rate ?? 0.01,
      appreciation_rate: target.appreciation_rate ?? 0.03,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Markets --------------------------------------------------------------
export async function listMarkets(orgId) {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('org_id', orgId)
    .order('state', { ascending: true });
  if (error) throw error;
  return data;
}

// ---- Goals ----------------------------------------------------------------
export async function listGoals(orgId) {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createGoal(orgId, userId, { name, target_monthly, inputs }) {
  const { data, error } = await supabase
    .from('goals')
    .insert({ org_id: orgId, name, target_monthly, inputs, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGoal(id, { name, target_monthly, inputs }) {
  const { error } = await supabase.from('goals').update({ name, target_monthly, inputs }).eq('id', id);
  if (error) throw error;
}

export async function setGoalStatus(id, status) {
  const { error } = await supabase
    .from('goals')
    .update({ status, achieved_at: status === 'achieved' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// ---- Cost ledger ----------------------------------------------------------
export async function logCost(orgId, userId, { deal_id, kind, provider, description, amount_usd }) {
  const { error } = await supabase.from('cost_ledger').insert({
    org_id: orgId,
    deal_id: deal_id || null,
    kind,
    provider: provider || null,
    description: description || null,
    amount_usd: amount_usd || 0,
    created_by: userId,
  });
  if (error) console.error('cost_ledger', error);
}

// ---- Invites (admin) ------------------------------------------------------
export async function listInvites(orgId) {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createInvite(orgId, userId, { email, role }) {
  const { data, error } = await supabase
    .from('invites')
    .insert({ org_id: orgId, email: email.toLowerCase().trim(), role, invited_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokeInvite(id) {
  const { error } = await supabase.from('invites').delete().eq('id', id);
  if (error) throw error;
}

export async function listMembers(orgId) {
  const { data, error } = await supabase
    .from('org_members')
    .select('role, created_at, user_id')
    .eq('org_id', orgId);
  if (error) throw error;
  return data;
}
