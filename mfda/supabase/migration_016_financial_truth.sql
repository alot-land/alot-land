-- Round 1: preserve unknown facts and atomically save a financial revision.
-- SECURITY INVOKER retains existing P0 authorization and tenant-parent checks.
alter table public.units alter column sqft drop not null;
alter table public.units alter column actual_rent drop not null;
alter table public.units alter column market_rent drop not null;
alter table public.units alter column sqft drop default;
alter table public.units alter column actual_rent drop default;
alter table public.units alter column market_rent drop default;
alter table public.units add column if not exists provenance text;

create or replace function public.replace_mfda_units(p_org_id uuid,p_deal_id uuid,p_units jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not public.is_org_member(p_org_id) then raise exception 'Organization unavailable'; end if;
  perform 1 from public.deals where id=p_deal_id and org_id=p_org_id for update;
  if not found then raise exception 'Deal unavailable'; end if;
  if jsonb_typeof(p_units)<>'array' then raise exception 'Unit array required'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) u where
    (u->>'count')::numeric<=0 or (u->>'count')::numeric<>trunc((u->>'count')::numeric) or
    (u->>'sqft')::numeric<0 or (u->>'actual_rent')::numeric<0 or (u->>'market_rent')::numeric<0)
    then raise exception 'Invalid unit data'; end if;
  delete from public.units where deal_id=p_deal_id and org_id=p_org_id;
  insert into public.units(org_id,deal_id,type,count,sqft,actual_rent,market_rent,sort_order,provenance)
    select p_org_id,p_deal_id,u->>'type',(u->>'count')::int,(u->>'sqft')::int,
      (u->>'actual_rent')::numeric,(u->>'market_rent')::numeric,ord::int-1,u->>'provenance'
    from jsonb_array_elements(p_units) with ordinality as a(u,ord);
  select coalesce(jsonb_agg(to_jsonb(u) order by sort_order),'[]'::jsonb) into result
    from public.units u where deal_id=p_deal_id and org_id=p_org_id;
  return result;
end $$;
revoke all on function public.replace_mfda_units(uuid,uuid,jsonb) from public,anon;
grant execute on function public.replace_mfda_units(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_mfda_underwriting(p_org_id uuid,p_deal jsonb,p_units jsonb,p_scenario jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare saved public.deals; snapshot public.scenarios; mix_count int; current_revision text;
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then raise exception 'Organization unavailable'; end if;
  if jsonb_typeof(p_deal)<>'object' or jsonb_typeof(p_units)<>'array' then raise exception 'Invalid save payload'; end if;
  if p_deal->>'id' is not null then
    select * into saved from public.deals where id=(p_deal->>'id')::uuid and org_id=p_org_id for update;
    if not found then raise exception 'Deal unavailable'; end if;
    select id::text into current_revision from public.scenarios where deal_id=saved.id and org_id=p_org_id order by created_at desc,id desc limit 1;
    if p_deal ? 'expected_scenario_id' and coalesce(p_deal->>'expected_scenario_id','')<>coalesce(current_revision,'') then
      raise exception 'Underwriting changed; reload before saving';
    end if;
    update public.deals set
      apn=p_deal->>'apn',county_fips=p_deal->>'county_fips',dedupe_key=p_deal->>'dedupe_key',
      address=p_deal->>'address',city=p_deal->>'city',state=p_deal->>'state',zip=p_deal->>'zip',
      status=coalesce(p_deal->>'status',saved.status),units_count=(p_deal->>'units_count')::int,
      year_built=(p_deal->>'year_built')::int,price=(p_deal->>'price')::numeric,
      source=case when p_deal ? 'source' then p_deal->>'source' else saved.source end,
      notes=case when p_deal ? 'notes' then p_deal->>'notes' else saved.notes end
      where id=saved.id and org_id=p_org_id returning * into saved;
  else
    insert into public.deals(org_id,apn,county_fips,dedupe_key,address,city,state,zip,status,units_count,year_built,price,source,notes,created_by)
      values(p_org_id,p_deal->>'apn',p_deal->>'county_fips',p_deal->>'dedupe_key',p_deal->>'address',p_deal->>'city',p_deal->>'state',p_deal->>'zip',
        coalesce(p_deal->>'status','analyzing'),(p_deal->>'units_count')::int,(p_deal->>'year_built')::int,(p_deal->>'price')::numeric,
        coalesce(p_deal->>'source','manual'),p_deal->>'notes',auth.uid()) returning * into saved;
  end if;
  perform public.replace_mfda_units(p_org_id,saved.id,p_units);
  select coalesce(sum(count),0) into mix_count from public.units where deal_id=saved.id and org_id=p_org_id;
  if mix_count>0 and mix_count<>saved.units_count then raise exception 'Unit mix/count mismatch'; end if;
  if p_scenario is not null then
    if jsonb_typeof(p_scenario->'inputs')<>'object' or jsonb_typeof(p_scenario->'outputs')<>'object' or
      p_scenario->>'calc_version' is distinct from p_scenario->'outputs'->>'calc_version' or
      p_scenario->'inputs'->>'price' is distinct from p_deal->>'price' or
      p_scenario->'inputs'->'units' is distinct from p_units or
      (p_scenario->'outputs'->'resolved_inputs') is distinct from p_scenario->'inputs'
      then raise exception 'Contradictory scenario payload'; end if;
    insert into public.scenarios(org_id,deal_id,label,inputs,outputs,calc_version,created_by)
      values(p_org_id,saved.id,coalesce(p_scenario->>'label','Base'),p_scenario->'inputs',p_scenario->'outputs',p_scenario->>'calc_version',auth.uid())
      returning * into snapshot;
  end if;
  return jsonb_build_object('deal',to_jsonb(saved),'scenario',to_jsonb(snapshot));
end $$;
revoke all on function public.save_mfda_underwriting(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_mfda_underwriting(uuid,jsonb,jsonb,jsonb) to authenticated;
