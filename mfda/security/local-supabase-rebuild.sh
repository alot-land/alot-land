#!/usr/bin/env bash
set -euo pipefail

readonly MFDA_LOCAL_DB='postgresql://postgres:postgres@127.0.0.1:55422/postgres'
readonly MFDA_SUPABASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase" && pwd)"

psql -X "$MFDA_LOCAL_DB" -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public cascade;
create schema public authorization postgres;
grant all on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- Equivalent to the explicit local config's legacy API-exposure model.
-- RLS remains enabled and authoritative on every MFDA table.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
SQL

files=("$MFDA_SUPABASE_DIR/schema.sql" "$MFDA_SUPABASE_DIR"/migration_*.sql)
for file in "${files[@]}"; do
  printf 'APPLY %s\n' "$(basename "$file")"
  psql -X "$MFDA_LOCAL_DB" -v ON_ERROR_STOP=1 -f "$file"
done

psql -X "$MFDA_LOCAL_DB" -v ON_ERROR_STOP=1 -Atc \
  "select 'public_tables=' || count(*) from pg_tables where schemaname='public';
   select 'rls_tables=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;"
