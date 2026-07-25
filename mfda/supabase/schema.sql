-- =====================================================================
-- MFDA — Multifamily Deal Analyzer · Supabase schema (v1, Phase 0)
-- Run once: Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- Multi-tenant from row one (Engineering Rule #6): every table carries org_id,
-- RLS on everything, roles admin|member, admin invite-token flow. Billing
-- columns (plan, status) exist but are unused.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- ORGS + MEMBERSHIP + INVITES  (the tenancy spine)
-- =====================================================================
create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       text not null default 'free',    -- billing column, unused for now
  status     text not null default 'active',  -- billing column, unused for now
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members(user_id);

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('admin','member')),
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  created_at  timestamptz not null default now()
);
create index if not exists invites_email_idx on public.invites(lower(email));
create unique index if not exists invites_token_idx on public.invites(token);

-- ---------------------------------------------------------------------
-- Security-definer helpers. These bypass RLS on their own lookups so the
-- policies that call them don't recurse (same pattern as time-audit's
-- is_current_user_admin). Never expose org data — they return only booleans/ids.
-- ---------------------------------------------------------------------
create or replace function public.jwt_email()
returns text language sql stable as $$
  select lower(auth.jwt() ->> 'email');
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- Sign-up gate: the founder, or anyone holding a live invite. The sign-in page
-- calls this BEFORE sending a magic link (mirrors time-audit's is_email_allowed).
create or replace function public.is_email_allowed(p_email text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    lower(p_email) = 'david@alot.land'
    or exists (
      select 1 from public.invites
      where lower(email) = lower(p_email)
        and accepted_at is null
        and expires_at > now()
    )
    or exists (  -- already a member (returning user)
      select 1 from public.org_members m
      join auth.users u on u.id = m.user_id
      where lower(u.email) = lower(p_email)
    );
$$;
grant execute on function public.is_email_allowed(text) to anon, authenticated;

-- RLS: orgs
alter table public.orgs enable row level security;
drop policy if exists "members read their orgs" on public.orgs;
create policy "members read their orgs" on public.orgs
  for select to authenticated using (public.is_org_member(id));
drop policy if exists "admins update their org" on public.orgs;
create policy "admins update their org" on public.orgs
  for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- RLS: org_members
alter table public.org_members enable row level security;
drop policy if exists "members read memberships in their orgs" on public.org_members;
create policy "members read memberships in their orgs" on public.org_members
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists "admins manage memberships" on public.org_members;
create policy "admins manage memberships" on public.org_members
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- RLS: invites
alter table public.invites enable row level security;
drop policy if exists "admins manage invites" on public.invites;
create policy "admins manage invites" on public.invites
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- =====================================================================
-- MARKET CONFIG (apps_config: per-state / per-market settings)
-- =====================================================================
create table if not exists public.markets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  state             text not null,             -- 'AZ', 'TN', ...
  county            text,
  name              text not null,
  str_permit_status text not null default 'open' check (str_permit_status in ('open','restricted','closed')),
  property_tax_rate numeric not null default 0.01,
  assessment_ratio  numeric not null default 1,
  appreciation_rate numeric not null default 0.03,
  defaults          jsonb not null default '{}'::jsonb,   -- vacancy, mgmt %, capex/unit, etc.
  seasonality       jsonb not null default '{}'::jsonb,   -- STR monthly occupancy/ADR curve
  created_at        timestamptz not null default now()
);
create index if not exists markets_org_idx on public.markets(org_id);

alter table public.markets enable row level security;
drop policy if exists "members read markets" on public.markets;
create policy "members read markets" on public.markets
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists "admins manage markets" on public.markets;
create policy "admins manage markets" on public.markets
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- =====================================================================
-- DEALS + UNITS
-- Canonical property key = APN + county FIPS (fallback: normalized address
-- hash). dedupe_key holds whichever; unique per org.
-- =====================================================================
create table if not exists public.deals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  apn          text,
  county_fips  text,
  dedupe_key   text not null,
  address      text,
  city         text,
  state        text,
  zip          text,
  status       text not null default 'lead' check (status in ('lead','analyzing','pursue','passed','closed')),
  units_count  int,
  year_built   int,
  price        numeric,
  source       text not null default 'manual',
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists deals_org_idx on public.deals(org_id);
create unique index if not exists deals_dedupe_idx on public.deals(org_id, dedupe_key);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists deals_touch on public.deals;
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

alter table public.deals enable row level security;
drop policy if exists "members crud deals in their orgs" on public.deals;
create policy "members crud deals in their orgs" on public.deals
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists public.units (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  type         text not null,
  count        int not null default 1 check (count >= 0),
  sqft         int not null default 0,
  actual_rent  numeric not null default 0,
  market_rent  numeric not null default 0,
  sort_order   int not null default 0
);
create index if not exists units_deal_idx on public.units(deal_id);

alter table public.units enable row level security;
drop policy if exists "members crud units in their orgs" on public.units;
create policy "members crud units in their orgs" on public.units
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- =====================================================================
-- SCENARIOS — IMMUTABLE (Engineering Rule #4: re-running = new snapshot row).
-- No UPDATE policy exists, so rows can never be mutated via the API.
-- =====================================================================
create table if not exists public.scenarios (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  label        text not null default 'Base',
  inputs       jsonb not null,
  outputs      jsonb not null,
  calc_version text not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists scenarios_deal_idx on public.scenarios(deal_id, created_at desc);

alter table public.scenarios enable row level security;
-- SELECT + INSERT only. Deliberately NO update/delete policy → immutable.
drop policy if exists "members read scenarios" on public.scenarios;
create policy "members read scenarios" on public.scenarios
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists "members insert scenarios" on public.scenarios;
create policy "members insert scenarios" on public.scenarios
  for insert to authenticated with check (public.is_org_member(org_id));

-- =====================================================================
-- CONTACTS — compliance fields ship in Phase 0 (Rule #9), UI comes in Phase 2.
-- =====================================================================
create table if not exists public.contacts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  deal_id        uuid references public.deals(id) on delete set null,
  owner_name     text,
  phone          text,
  email          text,
  source         text check (source in ('assessor','sos','scrape','batchdata','listing')),
  confidence     text check (confidence in ('high','med','low')),
  dnc_status     text not null default 'unknown' check (dnc_status in ('unknown','clear','listed')),
  dnc_checked_at timestamptz,
  lead_state     text,
  opt_out        boolean not null default false,
  inbound        boolean not null default false,
  dnc_exempt     boolean not null default false,  -- listing agents on on-market deals
  created_at     timestamptz not null default now()
);
create index if not exists contacts_org_idx on public.contacts(org_id);
create index if not exists contacts_deal_idx on public.contacts(deal_id);

alter table public.contacts enable row level security;
drop policy if exists "members crud contacts in their orgs" on public.contacts;
create policy "members crud contacts in their orgs" on public.contacts
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- =====================================================================
-- COST LEDGER — every external model/API/skip-trace/DD call with $ amount.
-- =====================================================================
create table if not exists public.cost_ledger (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  deal_id     uuid references public.deals(id) on delete set null,
  kind        text not null check (kind in ('model','api','skiptrace','dd','other')),
  provider    text,
  description text,
  amount_usd  numeric not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists cost_ledger_org_idx on public.cost_ledger(org_id, created_at desc);

alter table public.cost_ledger enable row level security;
drop policy if exists "members read cost_ledger" on public.cost_ledger;
create policy "members read cost_ledger" on public.cost_ledger
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists "members insert cost_ledger" on public.cost_ledger;
create policy "members insert cost_ledger" on public.cost_ledger
  for insert to authenticated with check (public.is_org_member(org_id));

-- =====================================================================
-- BOOTSTRAP: on new user, accept a pending invite OR create a personal org.
-- Makes "auth works" produce a usable, admin-owned org immediately.
-- =====================================================================
create or replace function public.bootstrap_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invite public.invites%rowtype;
  v_org_id uuid;
begin
  select * into v_invite from public.invites
    where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
    order by created_at desc limit 1;

  if found then
    insert into public.org_members (org_id, user_id, role)
      values (v_invite.org_id, new.id, v_invite.role)
      on conflict do nothing;
    update public.invites set accepted_at = now() where id = v_invite.id;
  else
    insert into public.orgs (name) values (coalesce(new.email, 'My Org'))
      returning id into v_org_id;
    insert into public.org_members (org_id, user_id, role) values (v_org_id, new.id, 'admin');
    -- Seed starter markets (AZ Maricopa + TN) for the new org.
    -- property_tax_rate is the EFFECTIVE annual rate on purchase price, so
    -- assessment_ratio stays 1 — the statutory ratio is already baked in
    -- (AZ class 4: 10% × ~$10/$100 AV ≈ 0.66%; TN residential: 25% ×
    -- ~$3.05/$100 AV ≈ 0.75%). See migration_012_tax_presets.sql.
    insert into public.markets (org_id, state, county, name, str_permit_status, property_tax_rate, assessment_ratio, appreciation_rate, defaults)
      values
      (v_org_id, 'AZ', 'Maricopa', 'Phoenix / Maricopa County', 'restricted', 0.0066, 1, 0.04,
        '{"vacancy_rate":0.05,"management_pct":0.09,"capex_per_unit":300}'::jsonb),
      (v_org_id, 'TN', null, 'Tennessee (statewide)', 'open', 0.0075, 1, 0.035,
        '{"vacancy_rate":0.05,"management_pct":0.09,"capex_per_unit":300}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_mfda on auth.users;
create trigger on_auth_user_created_mfda
  after insert on auth.users
  for each row execute function public.bootstrap_new_user();
