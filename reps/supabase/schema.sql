-- REPS Log — schema. Runs in the SAME Supabase project as the Time Audit app
-- (reuses your auth + allowed_emails). Paste into the Supabase SQL Editor once.

create extension if not exists "pgcrypto";

-- =====================================================================
-- REPS_ENTRIES — one row per logged activity (RE and non-RE work)
-- =====================================================================
create table if not exists public.reps_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  entry_date      date not null,
  category        text not null,                 -- REPS taxonomy (incl. 'Non-REPS')
  description     text not null default '',
  hours           numeric(6,2) not null check (hours >= 0),
  is_real_estate  boolean not null default true, -- real-property trade/business activity?
  reps_qualifying boolean not null default true, -- counts toward the 750-hour test?
  needs_review    boolean not null default false,-- flagged for your manual review
  source_tier     text not null default 'weak' check (source_tier in ('strong','medium','weak')),
  source_ref      text,                          -- verbatim Source cell from the import
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists reps_entries_user_date_idx on public.reps_entries(user_id, entry_date);

alter table public.reps_entries enable row level security;
drop policy if exists "reps_entries are owner only" on public.reps_entries;
create policy "reps_entries are owner only" on public.reps_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
