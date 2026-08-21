-- REPS agent summary RPC. Run once in the Supabase SQL Editor.
-- Lets the agent fetch the whole dashboard (three-tier totals, 50% test,
-- category breakdown, >10hr days) for a tax year in a single call:
--   POST /rest/v1/rpc/reps_summary   body: { "p_user_id": "<uuid>", "p_year": 2026 }
--
-- Not SECURITY DEFINER: it runs under the caller's role, so RLS still applies.
-- The agent calls it with the service_role key (which bypasses RLS and scopes by
-- p_user_id); a normal signed-in user only ever sees their own rows.

create or replace function public.reps_summary(p_user_id uuid, p_year int default 2026)
returns jsonb
language sql
stable
as $$
  with r as (
    select hours, reps_qualifying, needs_review, is_real_estate, category, entry_date,
      case source_tier when 'strong' then 0 when 'medium' then 1 else 2 end as ord
    from public.reps_entries
    where user_id = p_user_id
      and extract(year from entry_date)::int = p_year
  ),
  agg as (
    select
      coalesce(sum(hours) filter (where reps_qualifying and ord <= 0), 0) as qs,
      coalesce(sum(hours) filter (where ord <= 0), 0)                     as ts,
      coalesce(sum(hours) filter (where reps_qualifying and ord <= 1), 0) as qsm,
      coalesce(sum(hours) filter (where ord <= 1), 0)                     as tsm,
      coalesce(sum(hours) filter (where reps_qualifying), 0)             as qa,
      coalesce(sum(hours), 0)                                            as ta,
      coalesce(sum(hours) filter (where is_real_estate), 0)             as reh,
      count(*)                                                          as cnt,
      count(*) filter (where needs_review)                             as rev
    from r
  )
  select jsonb_build_object(
    'year', p_year,
    'count', cnt,
    'total_hours', ta,
    'qualifying_hours', qa,
    're_hours', reh,
    'non_re_hours', round(ta - reh, 2),
    'review_count', rev,
    'tiers', jsonb_build_array(
      jsonb_build_object('tier','strong_only',   'qualifying_hours',qs, 'total_work_hours',ts,
        're_share_pct', case when ts>0 then round(qs/ts*100,1) else 0 end, 'meets_750', qs>=750,  'meets_50pct', ts>0 and qs/ts>0.5),
      jsonb_build_object('tier','strong_medium', 'qualifying_hours',qsm,'total_work_hours',tsm,
        're_share_pct', case when tsm>0 then round(qsm/tsm*100,1) else 0 end,'meets_750', qsm>=750,'meets_50pct', tsm>0 and qsm/tsm>0.5),
      jsonb_build_object('tier','all',           'qualifying_hours',qa, 'total_work_hours',ta,
        're_share_pct', case when ta>0 then round(qa/ta*100,1) else 0 end, 'meets_750', qa>=750,  'meets_50pct', ta>0 and qa/ta>0.5)
    ),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category',category,'hours',h,'qualifying_hours',qh) order by h desc)
      from (
        select category, sum(hours) h, coalesce(sum(hours) filter (where reps_qualifying),0) qh
        from r group by category
      ) c
    ), '[]'::jsonb),
    'big_days', coalesce((
      select jsonb_agg(jsonb_build_object('date',d,'hours',h) order by h desc)
      from (select entry_date d, sum(hours) h from r group by entry_date having sum(hours) > 10) bd
    ), '[]'::jsonb)
  )
  from agg;
$$;

grant execute on function public.reps_summary(uuid, int) to anon, authenticated, service_role;
