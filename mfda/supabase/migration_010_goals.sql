-- =====================================================================
-- MFDA · Migration 010 — Goals (cash-flow targets + strategy planning)
-- Run after migration_009: SQL Editor → paste → Run.
-- =====================================================================

create table if not exists public.goals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  name           text not null,
  target_monthly numeric not null,
  inputs         jsonb not null default '{}'::jsonb,  -- planner assumptions snapshot
  status         text not null default 'active' check (status in ('active','achieved')),
  achieved_at    timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists goals_org_idx on public.goals(org_id, status, created_at desc);

alter table public.goals enable row level security;
drop policy if exists "members crud goals" on public.goals;
create policy "members crud goals" on public.goals
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
