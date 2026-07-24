-- =====================================================================
-- MFDA · Migration 008 — Deal favorites (hearts)
-- Run after migration_007: SQL Editor → paste → Run.
-- Org-wide heart on a deal; members already have update rights on deals.
-- =====================================================================

alter table public.deals add column if not exists favorite boolean not null default false;
create index if not exists deals_favorite_idx on public.deals(org_id, favorite) where favorite;
