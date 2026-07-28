-- =====================================================================
-- MFDA · Migration 014 — Parcel coverage per targeted county
-- Run after migration_013a: SQL Editor → paste → Run.
-- =====================================================================
--
-- Adding a county on the Markets page should be the ONLY thing you do to get
-- its off-market data. This table is what makes that possible: the droplet
-- works through targeted counties that have no parcels yet, and records what
-- happened to each one.
--
-- The failure rows matter as much as the successes. Counties differ wildly in
-- what they publish — some have a clean ArcGIS service, some are behind a
-- vendor portal, some publish nothing machine-readable at all. Recording WHY
-- a county failed is what turns "no data" into a decision: retry, request the
-- file by email, or buy that one.

create table if not exists public.parcel_coverage (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  county_fips  text not null,
  state        text,
  county_name  text,
  -- queued      never attempted
  -- ok          parcels imported
  -- failed      every route failed; `reason` says how far each got
  -- unsupported county publishes nothing usable — stop retrying, decide
  status       text not null default 'queued'
                 check (status in ('queued', 'ok', 'failed', 'unsupported')),
  parcels      int not null default 0,
  source_url   text,                       -- the route that worked, for audit
  reason       text,                       -- every route's failure, joined
  attempts     int not null default 0,
  attempted_at timestamptz,
  updated_at   timestamptz not null default now()
);

create unique index if not exists parcel_coverage_key_idx
  on public.parcel_coverage(org_id, county_fips);
create index if not exists parcel_coverage_status_idx
  on public.parcel_coverage(org_id, status);

alter table public.parcel_coverage enable row level security;

drop policy if exists parcel_coverage_read on public.parcel_coverage;
create policy parcel_coverage_read on public.parcel_coverage
  for select using (org_id in (select org_id from public.org_members where user_id = auth.uid()));

-- The droplet writes with the service-role key (RLS bypassed); these let a
-- signed-in member re-queue a county from the app.
drop policy if exists parcel_coverage_write on public.parcel_coverage;
create policy parcel_coverage_write on public.parcel_coverage
  for insert with check (org_id in (select org_id from public.org_members where user_id = auth.uid()));

drop policy if exists parcel_coverage_update on public.parcel_coverage;
create policy parcel_coverage_update on public.parcel_coverage
  for update using (org_id in (select org_id from public.org_members where user_id = auth.uid()));
