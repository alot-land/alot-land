import { supabase } from './supabase';

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
  return data;
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

// Sold comps for a state (bucket/radius filtering happens client-side via mf-calc).
export async function listCompsForState(orgId, state) {
  const { data, error } = await supabase
    .from('comps')
    .select('price, lat, lng, beds_total, sqft, unit_bucket, sold_date, address, city, url')
    .eq('org_id', orgId)
    .eq('state', state)
    .limit(2000);
  if (error) throw error;
  return data;
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
    // On edit, an unspecified source means "keep what's there" (protects the
    // redfin provenance on scraped deals).
    if (deal.source === undefined) delete row.source;
    const { data, error } = await supabase.from('deals').update(row).eq('id', deal.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('deals')
    .insert({ ...row, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
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
  let q = supabase
    .from('parcels')
    .select(
      'id, apn, state, county_fips, situs_address, situs_city, situs_zip, owner_name, owner_is_entity, mailing_address, mailing_city, mailing_state, mailing_zip, absentee, property_class, units, year_built, building_sqft, last_sale_date, last_sale_price, assessed_value',
      { count: 'exact' },
    )
    .eq('org_id', orgId);
  if (f.state && f.state !== 'all') q = q.eq('state', f.state);
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
  const { data, error, count } = await q
    .order('units', { ascending: false, nullsFirst: false })
    .limit(5000);
  if (error) throw error;
  return { rows: data, count };
}

// Distinct state/county pairs actually imported (drives the filter dropdowns).
export async function listParcelCounties(orgId) {
  const { data, error } = await supabase
    .from('parcels')
    .select('state, county_fips')
    .eq('org_id', orgId)
    .limit(10000);
  if (error) throw error;
  const seen = new Map();
  for (const r of data) seen.set(`${r.state}:${r.county_fips}`, r);
  return [...seen.values()].sort((a, b) => `${a.state}${a.county_fips}`.localeCompare(`${b.state}${b.county_fips}`));
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

export async function listParcelsForMailList(listId) {
  const { data, error } = await supabase
    .from('mail_list_items')
    .select('parcels(*)')
    .eq('list_id', listId)
    .limit(5000);
  if (error) throw error;
  return data.map((r) => r.parcels).filter(Boolean);
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
  const { data, error } = await supabase
    .from('market_stats')
    .select(
      'geo_id, name, state, lat, lng, land_sqmi, population, pop_5y_ago, zhvi_now, zhvi_1y, zhvi_5y, zori_now, zori_1y, zori_5y, median_re_tax, median_home_value_acs, renters, occupied_units, vacant_for_rent, nri_score, nri_rating, retrieved_at',
    )
    .eq('org_id', orgId)
    .eq('geo_level', 'county')
    .limit(4000);
  if (error) throw error;
  return data;
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
