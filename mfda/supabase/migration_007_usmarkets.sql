-- =====================================================================
-- MFDA · Migration 007 — US market finder (Phase 3)
-- Run after migration_006: SQL Editor → paste → Run.
--
-- market_stats: RAW national data snapshots per county (Zillow ZHVI/ZORI,
-- Census ACS, FEMA NRI). Deliberately raw — every derived number (yields,
-- CAGRs, tax rates, scores) is computed by @alot/mf-calc in the app, so
-- arithmetic has exactly one home. Refreshed by workers/scan/bin/usmarkets.mjs.
-- =====================================================================

create table if not exists public.market_stats (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  geo_level     text not null default 'county',
  geo_id        text not null,            -- county FIPS (5 digits)
  name          text not null,
  state         text not null,
  lat           numeric,
  lng           numeric,
  land_sqmi     numeric,                  -- drives scan-polygon generation
  population    bigint,
  pop_5y_ago    bigint,
  -- Zillow series snapshots (latest, 12mo back, 60mo back)
  zhvi_now      numeric,
  zhvi_1y       numeric,
  zhvi_5y       numeric,
  zori_now      numeric,
  zori_1y       numeric,
  zori_5y       numeric,
  -- ACS raw values/counts
  median_re_tax         numeric,
  median_home_value_acs numeric,
  renters               bigint,
  occupied_units        bigint,
  vacant_for_rent       bigint,
  -- FEMA National Risk Index
  nri_score     numeric,
  nri_rating    text,
  raw           jsonb not null default '{}'::jsonb,
  retrieved_at  timestamptz not null default now()
);
create unique index if not exists market_stats_geo_idx on public.market_stats(org_id, geo_level, geo_id);
create index if not exists market_stats_state_idx on public.market_stats(org_id, state);

alter table public.market_stats enable row level security;
drop policy if exists "members read market_stats" on public.market_stats;
create policy "members read market_stats" on public.market_stats
  for select to authenticated using (public.is_org_member(org_id));

-- Targeting: markets chosen from the finder become scan targets.
alter table public.markets add column if not exists geo_id text;          -- county FIPS
alter table public.markets add column if not exists scan_enabled boolean not null default false;
alter table public.markets add column if not exists poly text;            -- scanner ring "lng lat,..."
alter table public.markets add column if not exists source text not null default 'manual';

-- Members may add targets from the finder (was admin-only management).
drop policy if exists "members add markets" on public.markets;
create policy "members add markets" on public.markets
  for insert to authenticated with check (public.is_org_member(org_id));
