-- =====================================================================
-- MFDA · Migration 013 — Address-level rent estimate cache
-- Run after migration_012: SQL Editor → paste → Run.
-- =====================================================================
--
-- Rent is the weakest input in the system: a ZORI *blended* ZIP band cannot
-- tell a 1BR unit from a 3BR. Two fixes arrive together —
--
--   free : HUD Small Area FMR gives a bedroom SHAPE per ZIP (worker writes
--          it into rent_bands with source 'hud_safmr'). No new table needed.
--   paid : RentCast gives an address-level estimate. THIS table caches every
--          answer so re-underwriting the same property costs nothing and a
--          50-request free tier lasts.
--
-- One row per (property, bedroom count, source). Re-fetching updates in
-- place, and fetched_at drives the staleness note in the UI.

create table if not exists public.rent_estimates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  -- Normalized address key (same scheme as the parcel/listing join).
  addr_key     text not null,
  address      text,
  -- -1 = whole-property / bedroom count unknown. NOT NULL with a sentinel
  -- rather than a nullable column: the upsert conflict target must be a plain
  -- column list, and NULLs would never match one. Same -1 convention the
  -- rent_bands table already uses for a blended figure.
  bedrooms     int not null default -1,
  rent         numeric not null,
  rent_low     numeric,
  rent_high    numeric,
  comp_count   int,
  source       text not null,             -- 'rentcast'
  fetched_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

create unique index if not exists rent_estimates_key_idx
  on public.rent_estimates(org_id, addr_key, source, bedrooms);
create index if not exists rent_estimates_org_idx on public.rent_estimates(org_id, fetched_at desc);

alter table public.rent_estimates enable row level security;

drop policy if exists rent_estimates_select on public.rent_estimates;
create policy rent_estimates_select on public.rent_estimates
  for select using (org_id in (select org_id from public.org_members where user_id = auth.uid()));

drop policy if exists rent_estimates_insert on public.rent_estimates;
create policy rent_estimates_insert on public.rent_estimates
  for insert with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));

drop policy if exists rent_estimates_update on public.rent_estimates;
create policy rent_estimates_update on public.rent_estimates
  for update using (org_id in (select org_id from public.org_members where user_id = auth.uid()));
