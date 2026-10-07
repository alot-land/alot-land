import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, quote as q } from '../security/db-harness.mjs';

test('Round 1 atomic underwriting transactions with actual PostgreSQL/RLS',async t=>{
  const db=await database();t.after(()=>db.close());
  const mix=[{type:'assumption',count:4,sqft:null,actual_rent:null,market_rent:1400,provenance:'operator market assumption'}];
  const deal={id:ids.deal,dedupe_key:'security-canary',address:'new financial truth',price:600000,units_count:4,status:'analyzing'};
  const inputs={price:600000,units:mix};
  const scenario={label:'Round1',calc_version:'1.15.0',inputs,outputs:{calc_version:'1.15.0',resolved_inputs:inputs,marker:'MATCHING ANALYSIS'}};
  const save=(d=deal,u=mix,s=scenario,user=ids.a)=>db.sql(`select public.save_mfda_underwriting(${q(ids.oa)}::uuid,${q(JSON.stringify(d))}::jsonb,${q(JSON.stringify(u))}::jsonb,${s===null?'null':q(JSON.stringify(s))+'::jsonb'})`,user);
  const snapshot=()=>db.sql(`select jsonb_build_object('deal',(select to_jsonb(d) from deals d where id=${q(ids.deal)}),
    'units',(select jsonb_agg(to_jsonb(u) order by id) from units u where deal_id=${q(ids.deal)}),
    'scenarios',(select jsonb_agg(to_jsonb(s) order by id) from scenarios s where deal_id=${q(ids.deal)}))`);
  await db.sql(`insert into units(org_id,deal_id,type,count,sqft,actual_rent,market_rent) values (${q(ids.oa)},${q(ids.deal)},'prior',4,900,1200,1300)`);
  await t.test('unit insert failure rolls back deal, old units and scenarios',async()=>{
    const before=await snapshot();await assert.rejects(save(deal,[{...mix[0],type:null}]),/null value/);assert.equal(await snapshot(),before);
  });
  await t.test('scenario insert failure rolls back the entire revision',async()=>{
    await db.sql(`create function public.round1_inject_failure() returns trigger language plpgsql as $$ begin raise exception 'injected scenario failure'; end $$;
      create trigger round1_fail before insert on public.scenarios for each row execute function public.round1_inject_failure()`);
    const before=await snapshot();await assert.rejects(save(),/injected scenario failure/);assert.equal(await snapshot(),before);
    await db.sql('drop trigger round1_fail on public.scenarios');
  });
  await t.test('new-deal failure leaves no orphan deal',async()=>{
    const before=await db.sql('select count(*) from deals');
    await assert.rejects(save({...deal,id:undefined,dedupe_key:'new-orphan'},[{...mix[0],type:null}]));
    assert.equal(await db.sql('select count(*) from deals'),before);
  });
  await t.test('mismatched units/price/version/resolved snapshot cannot be inserted',async()=>{
    const before=await snapshot();
    for(const bad of [{...scenario,inputs:{...inputs,price:500000}},
      {...scenario,inputs:{...inputs,units:[]}}, {...scenario,calc_version:'wrong'},
      {...scenario,outputs:{...scenario.outputs,resolved_inputs:{price:1}}}]) await assert.rejects(save(deal,mix,bad),/Contradictory/);
    assert.equal(await snapshot(),before);
  });
  await t.test('known count mismatch rolls back all writes',async()=>{
    const before=await snapshot();await assert.rejects(save({...deal,units_count:12}),/count mismatch/);assert.equal(await snapshot(),before);
  });
  await t.test('tenant B cannot alter A through either RPC',async()=>{
    const before=await snapshot();await assert.rejects(save(deal,mix,scenario,ids.b),/Organization unavailable/);
    await assert.rejects(db.sql(`select replace_mfda_units(${q(ids.oa)},${q(ids.deal)},'[]')`,ids.b),/Organization unavailable/);
    assert.equal(await snapshot(),before);
  });
  await t.test('anon cannot execute either mutation RPC',async()=>{
    await assert.rejects(db.sql(`set role anon;select replace_mfda_units(${q(ids.oa)},${q(ids.deal)},'[]')`),/permission denied/);
    await assert.rejects(db.sql(`set role anon;select save_mfda_underwriting(${q(ids.oa)},'{}','[]',null)`),/permission denied/);
  });
  await t.test('multi-org user cannot combine org B RPC and org A deal',async()=>{
    await assert.rejects(db.sql(`select save_mfda_underwriting(${q(ids.ob)},${q(JSON.stringify(deal))},${q(JSON.stringify(mix))},null)`,ids.both),/Deal unavailable/);
  });
  let revision;
  await t.test('valid save commits matching deal/mix/snapshot and authenticated authorship',async()=>{
    const result=JSON.parse(await save({...deal,created_by:ids.b,expected_scenario_id:null}));revision=result.scenario.id;
    assert.equal(result.deal.price,600000);assert.equal(result.scenario.created_by,ids.a);
    assert.deepEqual(result.scenario.inputs,inputs);
    assert.equal(await db.sql(`select actual_rent is null and sqft is null from units where deal_id=${q(ids.deal)}`),'t');
    assert.equal(await db.sql(`select count(*) from scenarios where deal_id=${q(ids.deal)}`),'1');
  });
  await t.test('stale loaded revision is rejected without partial writes',async()=>{
    const before=await snapshot();await assert.rejects(save({...deal,expected_scenario_id:null}),/reload before saving/);assert.equal(await snapshot(),before);
  });
  await t.test('two concurrent saves of one revision serialize; exactly one succeeds',async()=>{
    const d={...deal,expected_scenario_id:revision};
    const outcomes=await Promise.allSettled([save(d),save(d)]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
    assert.equal(await db.sql(`select count(*) from scenarios where deal_id=${q(ids.deal)}`),'2');
  });
  await t.test('standalone replacement is atomic; unknowns survive a round trip',async()=>{
    const rows=JSON.parse(await db.sql(`select replace_mfda_units(${q(ids.oa)},${q(ids.deal)},${q(JSON.stringify(mix))})`,ids.a));
    assert.equal(rows[0].sqft,null);assert.equal(rows[0].actual_rent,null);assert.equal(rows[0].market_rent,1400);
  });
  await t.test('promotion without a scenario commits a known count with unknown rent',async()=>{
    const units=[{type:'Unknown mix',count:12,sqft:null,actual_rent:null,market_rent:null}];
    const result=JSON.parse(await save({...deal,id:undefined,dedupe_key:'promotion',units_count:12},units,null));
    assert.equal(result.deal.units_count,12);assert.equal(result.scenario,null);
    assert.equal(await db.sql(`select count(*) from units where deal_id=${q(result.deal.id)} and actual_rent is null and market_rent is null`),'1');
  });
});
