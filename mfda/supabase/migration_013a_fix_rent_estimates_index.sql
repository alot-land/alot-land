-- =====================================================================
-- MFDA · Migration 013a — Repair the rent_estimates unique index
-- Only needed if you ran the FIRST version of migration_013.
-- Harmless (and a no-op) if you ran the corrected one. SQL Editor → Run.
-- =====================================================================
--
-- The original 013 declared:
--     create unique index ... on rent_estimates(org_id, addr_key, source,
--                                               coalesce(bedrooms, -1));
--
-- Two problems:
--  1. PostgREST cannot match an EXPRESSION index to an upsert's on_conflict
--     column list, so the first cached RentCast answer would have failed with
--     "no unique or exclusion constraint matching the ON CONFLICT
--     specification" — a spent API request and no cache row.
--  2. `create unique index IF NOT EXISTS` keys off the index NAME, so simply
--     re-running the corrected migration would silently skip the fix. The old
--     index has to be dropped by name first. That is the whole reason this
--     file exists rather than "just run 013 again".
--
-- bedrooms becomes NOT NULL with a -1 sentinel ("no bedroom count"), the same
-- convention rent_bands already uses for a blended figure — NULLs can never
-- satisfy a conflict target.

update public.rent_estimates set bedrooms = -1 where bedrooms is null;

alter table public.rent_estimates alter column bedrooms set default -1;
alter table public.rent_estimates alter column bedrooms set not null;

drop index if exists public.rent_estimates_key_idx;
create unique index rent_estimates_key_idx
  on public.rent_estimates(org_id, addr_key, source, bedrooms);

-- Verify — the definition must list plain columns, with no coalesce():
--   select indexdef from pg_indexes where indexname = 'rent_estimates_key_idx';
