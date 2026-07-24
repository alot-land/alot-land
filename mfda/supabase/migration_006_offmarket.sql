-- =====================================================================
-- MFDA · Migration 006 — Off-market machine (Phase 2)
-- Run after migration_005: SQL Editor → paste → Run.
--
-- parcels: county assessor rows (multifamily only — filtered at import).
-- This is where REAL unit counts and owner mailing addresses live.
-- Mail needs no skip trace: the assessor mailing address is ground truth.
-- =====================================================================

create table if not exists public.parcels (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  state           text not null,
  county_fips     text,
  apn             text not null,
  dedupe_key      text not null,           -- apn:<fips>:<apn>
  -- situs (the property itself)
  situs_address   text,
  situs_city      text,
  situs_zip       text,
  -- ownership
  owner_name      text,
  owner_is_entity boolean not null default false,  -- LLC/corp/trust heuristic
  mailing_address text,
  mailing_city    text,
  mailing_state   text,
  mailing_zip     text,
  absentee        boolean not null default false,  -- mailing ≠ situs
  -- property facts (assessor-grade: REAL unit counts at last)
  property_class  text,
  units           int,
  year_built      int,
  building_sqft   int,
  lot_sqft        int,
  last_sale_date  date,
  last_sale_price numeric,
  assessed_value  numeric,
  raw             jsonb not null default '{}'::jsonb,
  imported_at     timestamptz not null default now()
);
create unique index if not exists parcels_dedupe_idx on public.parcels(org_id, dedupe_key);
create index if not exists parcels_org_geo_idx on public.parcels(org_id, state, county_fips);
create index if not exists parcels_filter_idx on public.parcels(org_id, absentee, owner_is_entity, units);

alter table public.parcels enable row level security;
drop policy if exists "members read parcels" on public.parcels;
create policy "members read parcels" on public.parcels
  for select to authenticated using (public.is_org_member(org_id));

-- Owner entities (SOS resolution fills principals later — Phase 2b).
create table if not exists public.owners (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  is_entity   boolean not null default false,
  sos_state   text,
  principals  jsonb not null default '[]'::jsonb,  -- [{name, role, source}]
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists owners_name_idx on public.owners(org_id, lower(name));

alter table public.owners enable row level security;
drop policy if exists "members read owners" on public.owners;
create policy "members read owners" on public.owners
  for select to authenticated using (public.is_org_member(org_id));

-- Mail lists: a saved selection of parcels + the filters that produced it.
create table if not exists public.mail_lists (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  filters    jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.mail_list_items (
  list_id   uuid not null references public.mail_lists(id) on delete cascade,
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  org_id    uuid not null references public.orgs(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (list_id, parcel_id)
);
create table if not exists public.mail_exports (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  list_id    uuid references public.mail_lists(id) on delete set null,
  format     text not null default 'freedomsoft',
  row_count  int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.mail_lists enable row level security;
alter table public.mail_list_items enable row level security;
alter table public.mail_exports enable row level security;
drop policy if exists "members crud mail_lists" on public.mail_lists;
create policy "members crud mail_lists" on public.mail_lists
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists "members crud mail_list_items" on public.mail_list_items;
create policy "members crud mail_list_items" on public.mail_list_items
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists "members crud mail_exports" on public.mail_exports;
create policy "members crud mail_exports" on public.mail_exports
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Call-window rules per state (spec: config-driven calling-hour gating).
-- Defaults follow the federal TSR window (8:00–21:00 local).
create table if not exists public.calling_hours (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  state      text not null,
  tz         text not null,
  call_start time not null default '08:00',
  call_end   time not null default '21:00',
  primary key (org_id, state)
);
alter table public.calling_hours enable row level security;
drop policy if exists "members read calling_hours" on public.calling_hours;
create policy "members read calling_hours" on public.calling_hours
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists "admins manage calling_hours" on public.calling_hours;
create policy "admins manage calling_hours" on public.calling_hours
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Seed AZ + TN calling windows for every existing org.
insert into public.calling_hours (org_id, state, tz)
select o.id, s.state, s.tz
from public.orgs o
cross join (values ('AZ', 'America/Phoenix'), ('TN', 'America/Chicago')) as s(state, tz)
on conflict (org_id, state) do nothing;
