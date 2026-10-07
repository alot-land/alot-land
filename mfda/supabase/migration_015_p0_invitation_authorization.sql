-- P0 closure. Apply AFTER every previous migration, BEFORE the new client.
-- Do not replay migration 012 afterward: it replaces bootstrap_new_user.
begin;

-- Only trusted callers can supply a user ID. Both bootstrap and the public
-- RPC use this one boundary. Lock first, then check wall-clock expiry: now()
-- would allow a transaction opened before expiry to redeem afterward.
create or replace function public.accept_mfda_invite(p_token uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.invites%rowtype;
  v_email text;
begin
  select lower(btrim(email)) into v_email from auth.users
    where id = p_user and email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  select * into v_invite from public.invites where token = p_token for update;
  if not found or v_invite.accepted_at is not null
    or v_invite.expires_at <= clock_timestamp()
    or lower(btrim(v_invite.email)) <> v_email
    or v_invite.role not in ('member', 'admin') then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  -- Existing membership is never upgraded by redemption, including replay
  -- through another invite. Administrators retain their explicit RLS path.
  insert into public.org_members(org_id, user_id, role)
    values (v_invite.org_id, p_user, v_invite.role) on conflict do nothing;
  update public.invites set accepted_at = clock_timestamp() where id = v_invite.id;
  return v_invite.org_id;
end;
$$;
revoke all on function public.accept_mfda_invite(uuid, uuid) from public, anon, authenticated;

create or replace function public.redeem_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  return public.accept_mfda_invite(p_token, auth.uid());
end;
$$;
revoke all on function public.redeem_invite(uuid) from public, anon;
grant execute on function public.redeem_invite(uuid) to authenticated;

-- Email-based onboarding is preserved for new AND existing verified users.
-- No caller-supplied org, email, role or user ID is accepted.
create or replace function public.accept_pending_mfda_invites()
returns void language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  for v_token in
    select i.token from public.invites i join auth.users u
      on lower(btrim(i.email)) = lower(btrim(u.email))
      where u.id = auth.uid() and u.email_confirmed_at is not null
        and i.accepted_at is null and i.expires_at > clock_timestamp()
      order by i.created_at, i.id
  loop
    begin
      perform public.accept_mfda_invite(v_token, auth.uid());
    exception when insufficient_privilege then
      -- A concurrent redemption, deletion or expiration is a rejection.
      null;
    end;
  end loop;
end;
$$;
revoke all on function public.accept_pending_mfda_invites() from public, anon;
grant execute on function public.accept_pending_mfda_invites() to authenticated;

create or replace function public.bootstrap_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_token uuid; v_org_id uuid;
begin
  -- Inserting an unverified email cannot reserve/consume its invitation.
  if new.email_confirmed_at is null then return new; end if;
  for v_token in select token from public.invites
    where lower(btrim(email)) = lower(btrim(new.email))
      and accepted_at is null and expires_at > clock_timestamp()
    order by created_at, id
  loop
    begin
      perform public.accept_mfda_invite(v_token, new.id);
    exception when insufficient_privilege then null;
    end;
  end loop;
  -- The existing founder allowlist is the only explicit personal-org grant.
  -- Invalid/uninvited users have no membership and no administrative default.
  if lower(btrim(new.email)) = 'david@alot.land'
    and not exists (select 1 from public.org_members where user_id = new.id) then
    insert into public.orgs(name) values (new.email) returning id into v_org_id;
    insert into public.org_members(org_id, user_id, role) values (v_org_id, new.id, 'admin');
    insert into public.markets(org_id, state, county, name, str_permit_status,
      property_tax_rate, assessment_ratio, appreciation_rate, defaults) values
      (v_org_id, 'AZ', 'Maricopa', 'Phoenix / Maricopa County', 'restricted', 0.0066, 1, 0.04,
       '{"vacancy_rate":0.05,"management_pct":0.09,"capex_per_unit":300}'::jsonb),
      (v_org_id, 'TN', null, 'Tennessee (statewide)', 'open', 0.0075, 1, 0.035,
       '{"vacancy_rate":0.05,"management_pct":0.09,"capex_per_unit":300}'::jsonb);
  end if;
  return new;
end;
$$;
revoke all on function public.bootstrap_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_confirmed_mfda on auth.users;
create trigger on_auth_user_confirmed_mfda after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.bootstrap_new_user();

-- Consumption cannot be undone, nor can a consumed invitation be retargeted.
create or replace function public.protect_consumed_mfda_invite()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.accepted_at is not null and new is distinct from old then
    raise exception 'Consumed invitation is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_consumed_mfda_invite() from public, anon, authenticated;
drop trigger if exists protect_consumed_mfda_invite on public.invites;
create trigger protect_consumed_mfda_invite before update on public.invites
  for each row execute function public.protect_consumed_mfda_invite();
commit;
