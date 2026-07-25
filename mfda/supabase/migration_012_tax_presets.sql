-- =====================================================================
-- MFDA · Migration 012 — Fix the seeded market property-tax presets
-- Run after migration_011: SQL Editor → paste → Run.
-- =====================================================================
--
-- WHY (accuracy fix, found in the July 2026 audit)
--
-- The engine computes:  annual tax = purchase_price × assessment_ratio × property_tax_rate
--
-- The two seeded starter markets stored property_tax_rate as an EFFECTIVE
-- rate on full market value (0.66% AZ, 0.75% TN) but ALSO carried the
-- county's statutory assessment ratio (0.10 AZ, 0.25 TN). The ratio was
-- therefore applied twice, understating property tax by ~10x in AZ and
-- ~4x in TN — the single largest operating expense on most small
-- multifamily deals.
--
--   Phoenix fourplex at $619,000 — modeled $409/yr, real ≈ $4,100/yr
--   Nashville fourplex at $425,000 — modeled $797/yr, real ≈ $3,100-3,500/yr
--
-- Correct pairings (either form is valid; the product is what matters):
--   AZ Maricopa  class 4 rental: 10% ratio × ~$10 per $100 AV ≈ 0.66% of value
--   TN Davidson  residential 25% ratio × ~$3.05 per $100 AV  ≈ 0.75% of value
--
-- Fix: keep the effective rates, set assessment_ratio = 1 so it is applied
-- once. Only rows still carrying the exact seeded values are touched — any
-- market you have edited yourself is left alone.
--
-- IMPACT: future underwrites and off-market screens get the corrected tax.
-- Saved scenarios are immutable snapshots and keep their old numbers; open a
-- deal and Edit → Save revision to re-run it. Expect NOI to drop by roughly
-- the corrected tax amount — deals that looked marginal may now fail, which
-- is the point.

update public.markets
   set assessment_ratio = 1
 where state = 'AZ'
   and county = 'Maricopa'
   and property_tax_rate = 0.0066
   and assessment_ratio = 0.10;

update public.markets
   set assessment_ratio = 1
 where state = 'TN'
   and county is null
   and property_tax_rate = 0.0075
   and assessment_ratio = 0.25;

-- Same fix at the source, so new orgs are seeded correctly.
create or replace function public.bootstrap_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_invite public.invites%rowtype;
begin
  select * into v_invite from public.invites
   where lower(email) = lower(new.email) and accepted_at is null
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
    -- property_tax_rate here is the EFFECTIVE annual rate on purchase price,
    -- so assessment_ratio stays 1 (see migration 012).
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
