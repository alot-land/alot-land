-- =====================================================================
-- MFDA · Migration 011 — Deal ratings, goal linkage, under-contract tracking
-- Run after migration_010: SQL Editor → paste → Run.
-- =====================================================================

-- ♥/👍/👎 on deals (On-Market queue and beyond) — same scheme as parcels.
alter table public.deals add column if not exists rating text
  check (rating in ('heart','up','down'));
create index if not exists deals_rating_idx on public.deals(org_id, rating) where rating is not null;

-- Goal linkage: a deal can be committed to a goal with its own target.
alter table public.deals add column if not exists goal_id uuid references public.goals(id) on delete set null;
alter table public.deals add column if not exists deal_target_monthly numeric;
create index if not exists deals_goal_idx on public.deals(org_id, goal_id) where goal_id is not null;

-- Under-contract stage + actual terms.
alter table public.deals drop constraint if exists deals_status_check;
alter table public.deals add constraint deals_status_check
  check (status in ('lead','analyzing','pursue','contract','passed','closed'));
alter table public.deals add column if not exists contract_price numeric;
alter table public.deals add column if not exists contract_date date;
alter table public.deals add column if not exists expected_close_date date;
