import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, ids, quote as q, root } from '/Users/davidastone/code/alot-land/alot-land/mfda/security/db-harness.mjs';
import { browserHarness } from '/Users/davidastone/code/alot-land/alot-land/mfda/security/browser-harness.mjs';

// Independently authored checks. Reuse only the inspected local infrastructure.
test('independent database review', async t => {
  const before = await database({ baseline: true });
  const after = await database();
  t.after(async () => { await before.close(); await after.close(); });
  async function consumed(db) {
    const token = randomUUID();
    await db.sql(`insert into public.invites(org_id,email,token,invited_by,accepted_at) values
      (${q(ids.oa)},'historical@example.invalid',${q(token)},${q(ids.admin)},clock_timestamp())`);
    return token;
  }
  await t.test('REGRESSION reproduction: deleting consumed invitation author succeeds before 015 and fails after', async () => {
    const oldToken = await consumed(before), newToken = await consumed(after);
    await before.sql(`delete from auth.users where id=${q(ids.admin)}`);
    assert.equal(await before.sql(`select invited_by is null from public.invites where token=${q(oldToken)}`), 't');
    await assert.rejects(after.sql(`delete from auth.users where id=${q(ids.admin)}`), /Consumed invitation is immutable/);
    assert.equal(await after.sql(`select count(*) from auth.users where id=${q(ids.admin)}`), '1');
    assert.equal(await after.sql(`select invited_by from public.invites where token=${q(newToken)}`), ids.admin);
    console.log('R-1 confirmed: FK ON DELETE SET NULL is rejected by migration 015 trigger; entire auth-user deletion rolls back.');
  });
  await t.test('populated forward upgrade preserves existing memberships and consumed invitations', async () => {
    const old = await before.sql('select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m');
    const consumedOld = await before.sql('select jsonb_agg(to_jsonb(i) order by id) from public.invites i');
    await before.sql(await readFile(root+'/supabase/migration_015_p0_invitation_authorization.sql', 'utf8'));
    assert.equal(await before.sql('select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m'), old);
    assert.equal(await before.sql('select jsonb_agg(to_jsonb(i) order by id) from public.invites i'), consumedOld);
  });
  await t.test('unconfirmed existing recipient, multiple conflicting invitations and replay stay at member', async () => {
    const uid = randomUUID(), email = '  MixedCase@example.invalid  ', one = randomUUID(), two = randomUUID();
    await after.sql(`insert into auth.users values (${q(uid)},${q(email)},null);
      insert into public.invites(org_id,email,role,token,created_at) values
      (${q(ids.ob)},'mixedcase@example.invalid','member',${q(one)},clock_timestamp()-interval '1 hour'),
      (${q(ids.ob)},'MIXEDCASE@example.invalid','admin',${q(two)},clock_timestamp());`);
    await after.sql('select public.accept_pending_mfda_invites()',uid);
    assert.equal(await after.sql(`select count(*) from public.org_members where user_id=${q(uid)}`), '0');
    assert.equal(await after.sql(`select count(*) from public.invites where token in (${q(one)},${q(two)}) and accepted_at is null`), '2');
    await after.sql(`update auth.users set email_confirmed_at=clock_timestamp() where id=${q(uid)}`);
    assert.equal(await after.sql(`select role from public.org_members where user_id=${q(uid)}`), 'member');
    assert.equal(await after.sql(`select count(*) from public.invites where token in (${q(one)},${q(two)}) and accepted_at is not null`), '2');
    for (const token of [one,two]) await assert.rejects(after.sql(`select public.redeem_invite(${q(token)})`,uid), /Invitation unavailable/);
  });
  await t.test('private helper cannot be exposed through role inheritance or public/anonymous execution', async () => {
    assert.equal(await after.sql("select has_function_privilege('authenticated','public.accept_mfda_invite(uuid,uuid)','execute')"), 'f');
    assert.equal(await after.sql("select has_function_privilege('anon','public.accept_pending_mfda_invites()','execute')"), 'f');
    await assert.rejects(after.sql('set role anon; select public.accept_pending_mfda_invites()'), /permission denied/);
    await assert.rejects(after.sql(`select public.accept_mfda_invite(${q(randomUUID())},${q(ids.a)})`,ids.b), /permission denied/);
    await assert.rejects(after.sql('select public.redeem_invite(null)',ids.a), /Invitation unavailable/);
  });
  await t.test('historical expired-invitation admin grant survives the forward migration',async()=>{
    const old=await database({baseline:true});
    try {
      const uid=randomUUID();
      await old.sql(`insert into public.invites(org_id,email,role,expires_at) values
        (${q(ids.ob)},'historical-expired@example.invalid','admin',clock_timestamp()-interval '1 day');
        insert into auth.users values (${q(uid)},'historical-expired@example.invalid',clock_timestamp())`);
      assert.equal(await old.sql(`select role from public.org_members where user_id=${q(uid)}`),'admin');
      await old.sql(await readFile(root+'/supabase/migration_015_p0_invitation_authorization.sql','utf8'));
      assert.equal(await old.sql(`select role from public.org_members where user_id=${q(uid)}`),'admin');
      console.log('Historical unauthorized admin membership remains after migration; rollout requires authorized membership reconciliation.');
    } finally { await old.close(); }
  });
  await t.test('restricted synthetic auth writer can run insert/confirmation triggers without helper execute grants',async()=>{
    const uid=randomUUID(),token=randomUUID();
    await after.sql(`create role review_auth_writer nologin;
      grant usage on schema auth to review_auth_writer;
      grant insert,select,update on auth.users to review_auth_writer;
      insert into public.invites(org_id,email,role,token) values
        (${q(ids.ob)},'auth-writer@example.invalid','member',${q(token)});
      set role review_auth_writer;
      insert into auth.users values (${q(uid)},'auth-writer@example.invalid',null);
      update auth.users set email_confirmed_at=clock_timestamp() where id=${q(uid)};`);
    assert.equal(await after.sql(`select role from public.org_members where user_id=${q(uid)}`),'member');
    assert.equal(await after.sql(`select accepted_at is not null from public.invites where token=${q(token)}`),'t');
  });
});

function getClients() {
  const element = document.getElementById('root');
  const f = element[Object.keys(element).find(k=>k.startsWith('__reactContainer$'))].stateNode.current;
  const clients = new Set();
  function walk(x) { if (!x) return; if (x.memoizedProps?.client?.getQueryCache) clients.add(x.memoizedProps.client); walk(x.child); walk(x.sibling); }
  walk(f); return [...clients];
}
const address = page => page.locator('input[placeholder="123 Main St"]');
const text = page => page.evaluate(() => document.body.innerText+'\n'+[...document.querySelectorAll('input,textarea')].map(x=>x.value).join('\n'));
async function eventually(fn, timeout=15000) {
  const end=Date.now()+timeout;
  while (!(await fn())) { assert.ok(Date.now()<end,'independent condition timed out'); await new Promise(r=>setTimeout(r,20)); }
}

test('independent browser review', async t => {
  const db = await database(); let h;
  t.after(async()=>{ try { await h?.close(); } finally { await db.close(); } });
  h = await browserHarness(db);
  const bDeal = randomUUID();
  await db.sql(`insert into public.deals(id,org_id,dedupe_key,address,status,price,units_count)
    values (${q(bDeal)},${q(ids.ob)},'independent-b','REVIEW B POSITIVE RECORD','analyzing',650000,4)`);
  await t.test('current client replaces and clears retained old client, including late successful A response', async () => {
    const {ctx,page}=await h.context(); let release;
    try {
      await page.goto(h.base+'/deals'); await page.getByText('A ONLY SECURITY CANARY',{exact:true}).waitFor();
      const find=getClients.toString();
      await page.evaluate(code=>{window.reviewOldClient=eval('('+code+')')()[0]},find);
      h.control.hold=new Promise(r=>release=r);
      const start=h.requests.length;
      await page.evaluate(()=>{ void window.reviewOldClient.invalidateQueries(); });
      await eventually(()=>h.requests.slice(start).some(r=>r.table==='deals'));
      await h.changeUser(page,ids.b);
      await page.getByText('REVIEW B POSITIVE RECORD',{exact:true}).waitFor({timeout:1000}).catch(()=>{});
      h.control.hold=null; release();
      await page.getByText('REVIEW B POSITIVE RECORD',{exact:true}).waitFor();
      await eventually(async()=>await page.evaluate(()=>window.reviewOldClient.getQueryCache().getAll().length)===0);
      assert.doesNotMatch(await text(page),/A ONLY/);
      const result=await page.evaluate(code=>{const current=eval('('+code+')')()[0];return {fresh:current!==window.reviewOldClient,keys:current.getQueryCache().getAll().map(q=>q.queryKey)}},find);
      assert.equal(result.fresh,true); assert.ok(result.keys.length>0);
      assert.ok(result.keys.every(k=>k[1]===ids.b && k[3]===ids.ob));
    } finally { h.control.hold=null;release?.(); await ctx.close(); }
  });
  await t.test('identity changes within the same org and role discard local drafts and caches', async () => {
    const {ctx,page}=await h.context(ids.both);
    try {
      await page.goto(h.base+`/deals/${ids.deal}/edit`);
      await eventually(async()=>await address(page).inputValue()==='A ONLY SECURITY CANARY');
      await address(page).fill('SAME ORG PREVIOUS USER DRAFT');
      await h.changeUser(page,ids.admin);
      await page.getByText('admin@example.invalid',{exact:true}).waitFor();
      await eventually(async()=>await address(page).inputValue()==='A ONLY SECURITY CANARY');
      assert.doesNotMatch(await text(page),/SAME ORG PREVIOUS USER DRAFT/);
    } finally { await ctx.close(); }
  });
  await t.test('favorite optimistic cache update, status invalidation and note refetch still work', async () => {
    const {ctx,page}=await h.context();
    await ctx.route('https://mfda-security.invalid/rest/v1/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if (!['POST','PATCH'].includes(req.method())) return route.fallback();
      const table=url.pathname.split('/').at(-1),row=req.postDataJSON();
      const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url').toString()).sub;
      let result;
      if(table==='deals'&&req.method()==='PATCH') {
        assert.ok(Object.keys(row).every(k=>['favorite','status'].includes(k)));
        const id=url.searchParams.get('id').slice(3);
        await db.sql(`update public.deals set ${Object.entries(row).map(([k,v])=>`${k}=${q(v)}`).join(',')} where id=${q(id)}`,uid); result=null;
      } else if(table==='notes'&&req.method()==='POST') {
        result=JSON.parse(await db.sql(`with n as (insert into public.notes(org_id,entity_type,entity_id,body,author_email,created_by) values
          (${q(row.org_id)},${q(row.entity_type)},${q(row.entity_id)},${q(row.body)},${q(row.author_email)},${q(row.created_by)}) returning *) select row_to_json(n) from n`,uid));
      } else return route.fallback();
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    try {
      await page.goto(h.base+`/deals/${ids.deal}`);await page.getByRole('heading',{name:'A ONLY SECURITY CANARY'}).waitFor();
      await page.getByRole('button',{name:'Heart this deal',exact:true}).click();
      await page.getByRole('button',{name:'Remove heart',exact:true}).waitFor();
      await eventually(async()=>await db.sql(`select favorite from public.deals where id=${q(ids.deal)}`)==='t');
      await page.getByRole('button',{name:'pursue',exact:true}).click();
      await eventually(async()=>await db.sql(`select status from public.deals where id=${q(ids.deal)}`)==='pursue');
      await eventually(async()=> (await page.getByRole('button',{name:'pursue',exact:true}).getAttribute('class')).includes('bg-ink'));
      await page.locator('textarea').fill('INDEPENDENT NOTE INVALIDATION');
      await page.getByRole('button',{name:'Add',exact:true}).click();
      await page.getByText('INDEPENDENT NOTE INVALIDATION',{exact:true}).waitFor();
      const keys=await page.evaluate(code=>eval('('+code+')')()[0].getQueryCache().getAll().map(q=>q.queryKey),getClients.toString());
      assert.ok(keys.some(k=>k[6]==='notes'&&k[1]===ids.a&&k[3]===ids.oa));
    } finally { await ctx.close(); }
  });
  await t.test('known limitation reproduced: unchanged foreground focus discards unsaved draft',async()=>{
    const {ctx,page}=await h.context();
    try {
      await page.goto(h.base+`/deals/${ids.deal}/edit`);
      await eventually(async()=>await address(page).inputValue()==='A ONLY SECURITY CANARY');
      await address(page).fill('FOREGROUND UNSAVED DRAFT');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await eventually(async()=>await address(page).count()>0&&await address(page).inputValue()==='A ONLY SECURITY CANARY');
      console.log('R-2 reproduced: unchanged foreground authorization check silently discarded the draft.');
    } finally { await ctx.close(); }
  });
  await t.test('membership request identity race is discarded instead of supplying new identity access',async()=>{
    const {ctx,page}=await h.context();
    try {
      await page.goto(h.base+`/deals/${ids.deal}`);await page.getByRole('heading',{name:'A ONLY SECURITY CANARY'}).waitFor();
      const start=h.requests.length;
      for(const uid of [ids.b,ids.a,ids.b,ids.a,ids.b]) {
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await h.changeUser(page,uid);
      }
      await page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      assert.doesNotMatch(await text(page),/A ONLY/);
      const mismatch=h.requests.slice(start).filter(r=>r.table==='org_members'&&r.search.includes('org%3Aorgs')&&!r.search.includes('user_id=eq.'+r.uid));
      console.log('Obsolete membership requests carrying replacement JWT:',JSON.stringify(mismatch));
    } finally { await ctx.close(); }
  });
  await t.test('RESIDUAL reproduction: delayed saved-list export downloads A records after identity becomes B',async()=>{
    const listId=await db.sql(`insert into public.mail_lists(org_id,name) values (${q(ids.oa)},'A ONLY EXPORT REVIEW') returning id`);
    await db.sql(`insert into public.mail_list_items(list_id,parcel_id,org_id) values (${q(listId)},${q(ids.parcel)},${q(ids.oa)})`);
    const {ctx,page}=await h.context(); let release,started=false;
    const barrier=new Promise(r=>release=r);
    await ctx.route('https://mfda-security.invalid/rest/v1/mail_list_items*',async route=>{
      const req=route.request(),url=new URL(req.url());
      const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url').toString()).sub;
      assert.equal(uid,ids.a);
      assert.equal(url.searchParams.get('org_id'),'eq.'+ids.oa);
      const data=JSON.parse(await db.sql(`select coalesce(jsonb_agg(jsonb_build_object('parcels',to_jsonb(p))),'[]')
        from public.mail_list_items i join public.parcels p on p.id=i.parcel_id
        where i.list_id=${q(listId)} and i.org_id=${q(ids.oa)}`,uid));
      started=true;await barrier;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const downloads=[];page.on('download',d=>downloads.push(d));
    try {
      await page.goto(h.base+'/off-market');
      await page.getByRole('button',{name:/Saved mail lists/}).waitFor();
      if(await page.getByText('A ONLY EXPORT REVIEW',{exact:true}).count()===0) await page.getByRole('button',{name:/Saved mail lists/}).click();
      await page.getByRole('row').filter({hasText:'A ONLY EXPORT REVIEW'}).getByRole('button',{name:/CSV/}).click();
      await eventually(()=>started);
      await h.changeUser(page,ids.b);
      await page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      assert.doesNotMatch(await text(page),/A ONLY/);
      assert.equal(await db.sql(`select count(*) from public.parcels where id=${q(ids.parcel)}`,ids.b),'0');
      release();await eventually(()=>downloads.length===1);
      const contents=await readFile(await downloads[0].path(),'utf8');
      assert.match(contents,/A ONLY PARCEL CANARY/);
      console.log('R-3 confirmed: active B receives delayed A CSV:',downloads[0].suggestedFilename());
    } finally { release();await ctx.close(); }
  });
  assert.deepEqual(h.errors,[]);
});
