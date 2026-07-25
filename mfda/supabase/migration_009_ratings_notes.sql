-- =====================================================================
-- MFDA · Migration 009 — Parcel ratings + universal timestamped notes
-- Run after migration_008: SQL Editor → paste → Run.
--
-- rating: ♥ heart (strong — contact first), 👍 up (potential),
--         👎 down (something's off), null (unrated).
-- notes: org-shared, timestamped, attach to parcels AND deals.
-- =====================================================================

alter table public.parcels add column if not exists rating text
  check (rating in ('heart','up','down'));
-- Coordinates (present in most county GIS exports) → Street View links.
alter table public.parcels add column if not exists lat numeric;
alter table public.parcels add column if not exists lng numeric;
create index if not exists parcels_rating_idx on public.parcels(org_id, rating) where rating is not null;

-- Parcels were import-only (select) — rating needs member updates.
drop policy if exists "members update parcels" on public.parcels;
create policy "members update parcels" on public.parcels
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  entity_type  text not null check (entity_type in ('parcel','deal')),
  entity_id    uuid not null,
  body         text not null,
  author_email text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists notes_entity_idx on public.notes(org_id, entity_type, entity_id, created_at desc);

alter table public.notes enable row level security;
drop policy if exists "members crud notes" on public.notes;
create policy "members crud notes" on public.notes
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
