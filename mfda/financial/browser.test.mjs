import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, quote as q, root } from '../security/db-harness.mjs';
import { browserHarness } from '../security/browser-harness.mjs';

test('Round 1 actual form/property/save financial integrity', {timeout:120000}, async t=>{
  const db=await database();let h;
  t.after(async()=>{try{await h?.close();}finally{await db.close();}});
  h=await browserHarness(db,{appRoot:process.env.MFDA_R1_BASELINE_APP ?? root});
  const original=JSON.parse(await db.sql(`select to_jsonb(s) from scenarios s where deal_id=${q(ids.deal)}`));
  await t.test('R0-7: sourced 12 units open as 12, unknown rents/SF are blank',async()=>{
    await db.sql(`delete from scenarios where deal_id=${q(ids.deal)};delete from units where deal_id=${q(ids.deal)};update deals set units_count=12 where id=${q(ids.deal)}`);
    const {ctx,page}=await h.context();
    try{
      await page.goto(h.base+`/deals/${ids.deal}/edit`);
      await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='A ONLY SECURITY CANARY'));
      const row=page.locator('table').filter({has:page.getByText('Unit type',{exact:true})}).locator('tbody tr').first();
      const values=await row.locator('input').evaluateAll(es=>es.map(e=>e.value));
      console.log('R0-7 actual loaded mix',values);
      assert.equal(values[1],'12');assert.equal(values[2],'');assert.equal(values[3],'');assert.equal(values[4],'');
      await page.getByRole('button',{name:/Save revision/}).click();
      await page.getByText('Selected unit rent is incomplete or invalid',{exact:true}).waitFor();
      assert.equal(await db.sql(`select units_count from deals where id=${q(ids.deal)}`),'12');
      assert.equal(await db.sql(`select count(*) from scenarios where deal_id=${q(ids.deal)}`),'0');
    }finally{await ctx.close();}
  });
  if(process.env.MFDA_R1_BASELINE_APP) return;
  const inputs={...original.inputs,price:400000,address:'A ONLY SECURITY CANARY',vacancy_rate:0,
    market_id:'',expenses:{insurance:0,management:0,utilities:0,repairs_maintenance:0,capex_reserve:0}};
  await db.sql(`update deals set units_count=4,price=500000 where id=${q(ids.deal)};
    insert into scenarios(id,org_id,deal_id,label,inputs,outputs,calc_version) values
    (${q(original.id)},${q(ids.oa)},${q(ids.deal)},'saved zero assumptions',${q(JSON.stringify(inputs))},${q(JSON.stringify(original.outputs))},'1.14.0')`);
  await t.test('snapshot price/zero expenses/vacancy survive edit hydration and market data',async()=>{
    const {ctx,page}=await h.context();
    try{
      await page.goto(h.base+`/deals/${ids.deal}/edit`);
      await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='A ONLY SECURITY CANARY'));
      const numbers=await page.locator('input[type=number]').evaluateAll(es=>es.map(e=>e.value));
      assert.ok(numbers.includes('400000'));assert.ok(!numbers.includes('500000'));
      assert.equal(await page.locator('label').filter({hasText:/^Insurance/}).locator('input').inputValue(),'0');
      assert.equal(await page.locator('label').filter({hasText:/^Vacancy/}).locator('input').inputValue(),'0');
    }finally{await ctx.close();}
  });
  await t.test('actual form save: scenario failure rolls back; retry saves a replayable revision',async()=>{
    const {ctx,page}=await h.context();const calls=[];
    try{
      await ctx.route('https://mfda-security.invalid/rest/v1/rpc/save_mfda_underwriting',async route=>{
        const req=route.request(),args=req.postDataJSON();calls.push(args);
        const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url')).sub;
        try{
          const body=await db.sql(`select save_mfda_underwriting(${q(args.p_org_id)},${q(JSON.stringify(args.p_deal))},${q(JSON.stringify(args.p_units))},${q(JSON.stringify(args.p_scenario))})`,uid);
          await route.fulfill({status:200,contentType:'application/json',body});
        }catch(e){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:e.message})});}
      });
      await db.sql(`create function public.round1_browser_fail() returns trigger language plpgsql as $$ begin raise exception 'browser injected scenario failure';end $$;
        create trigger round1_browser before insert on scenarios for each row execute function round1_browser_fail()`);
      await page.goto(h.base+`/deals/${ids.deal}/edit`);
      await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='400000'));
      await page.getByRole('button',{name:/Save revision/}).click();
      await page.getByText(/browser injected scenario failure/).waitFor();
      assert.equal(await db.sql(`select price from deals where id=${q(ids.deal)}`),'500000');
      assert.equal(await db.sql(`select count(*) from scenarios where deal_id=${q(ids.deal)}`),'1');
      await db.sql('drop trigger round1_browser on scenarios');
      await page.getByRole('button',{name:/Save revision/}).click();
      await page.waitForURL(`**/deals/${ids.deal}`);
      assert.equal(calls.length,2);assert.equal(calls[1].p_deal.price,400000);
      assert.equal(calls[1].p_scenario.inputs.vacancy_rate,0);
      assert.equal(calls[1].p_scenario.inputs.expenses.insurance,0);
      assert.ok(calls[1].p_scenario.inputs.financing.dscr.rate>0);
      const s=JSON.parse(await db.sql(`select to_jsonb(s) from scenarios s where deal_id=${q(ids.deal)} and calc_version='1.15.0'`));
      const replay=await page.evaluate(async inp=>(await import('/src/lib/underwrite.js')).underwrite(inp),s.inputs);
      assert.deepEqual(replay,s.outputs);
      assert.equal(await db.sql(`select price from deals where id=${q(ids.deal)}`),'400000');
    }finally{await ctx.close();}
  });
  assert.deepEqual(h.errors,[]);
});
