import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { database, ids, quote as q, root } from '../../../../mfda/security/db-harness.mjs';
import { browserHarness } from '../../../../mfda/security/browser-harness.mjs';

const observations = [];
const evidence = new URL('./observations.json', import.meta.url);
async function record(value) { observations.push(value); await writeFile(evidence, JSON.stringify(observations, null, 2) + '\n'); }
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'bounded diagnostic barrier timed out'); await new Promise(r => setTimeout(r, 20)); }
}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
function retainLifetime() {
  const node = document.getElementById('root');
  const fiber = node[Object.keys(node).find(k => k.startsWith('__reactContainer$'))].stateNode.current;
  let completion, client;
  function walk(f) {
    if (!f) return;
    const value = f.memoizedProps?.value;
    if (value?.capture && value?.invalidate) completion = value;
    if (f.memoizedProps?.client?.getQueryCache) client = f.memoizedProps.client;
    walk(f.child); walk(f.sibling);
  }
  walk(fiber);
  if (!completion || !client) throw new Error('Production tenant boundary not found');
  window.reviewOldGuard = completion.capture(); window.reviewOldClient = client;
  return window.reviewOldGuard();
}

test('independent SQL lifecycle probes (actual migrations, FK and transaction behavior)', { timeout: 120000 }, async t => {
  const db = await database({ baseline: true }); t.after(() => db.close());
  const migration = await readFile(root + '/supabase/migration_015_p0_invitation_authorization.sql', 'utf8');
  const author = randomUUID(), otherAuthor = randomUUID(), token = randomUUID(), pending = randomUUID();
  await db.sql(`insert into auth.users values (${q(author)},'review-author@example.invalid',clock_timestamp()),
    (${q(otherAuthor)},'review-other@example.invalid',clock_timestamp());
    insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(author)},'admin');
    insert into public.invites(org_id,email,token,invited_by,accepted_at) values
      (${q(ids.oa)},'a@example.invalid',${q(token)},${q(author)},'2026-01-01T03:04:05.123456Z'),
      (${q(ids.oa)},'review-pending@example.invalid',${q(pending)},${q(author)},null);
    insert into public.notes(org_id,entity_type,entity_id,body,created_by) values
      (${q(ids.ob)},'deal',${q(ids.deal)},'UNRELATED HISTORY',${q(otherAuthor)});
    create role review_auth_writer nologin;
    grant usage on schema auth to review_auth_writer;
    grant select(id),delete on auth.users to review_auth_writer;`);
  const snapshot = () => db.sql(`select jsonb_build_object('invites',(select jsonb_agg(to_jsonb(i) order by id) from public.invites i),
    'members',(select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m),
    'orgs',(select jsonb_agg(to_jsonb(o) order by id) from public.orgs o),
    'notes',(select jsonb_agg(to_jsonb(n) order by id) from public.notes n))`);
  const row = () => db.sql(`select to_jsonb(i) from public.invites i where token=${q(token)}`);
  const original = JSON.parse(await row());
  await t.test('populated upgrade and repeat change no historical rows or FK definitions', async () => {
    const before = await snapshot();
    const constraints = await db.sql("select jsonb_agg(pg_get_constraintdef(oid) order by oid) from pg_constraint where contype='f'");
    await db.sql(migration); await db.sql(migration);
    assert.equal(await snapshot(), before);
    assert.equal(await db.sql("select jsonb_agg(pg_get_constraintdef(oid) order by oid) from pg_constraint where contype='f'"), constraints);
    assert.equal(await db.sql("select confdeltype from pg_constraint where conrelid='public.invites'::regclass and confrelid='auth.users'::regclass"), 'n');
    await record({ probe: 'populated-upgrade', preserved: true, foreignKeysAltered: false });
  });
  await t.test('living-author nulling and combined security edits fail, including a future column', async () => {
    await db.sql("alter table public.invites add column review_future_history text default 'preserve'");
    for (const edit of ['invited_by=null', 'accepted_at=null', `org_id=${q(ids.ob)}`, "email='b@example.invalid'", "role='admin'", `token=${q(randomUUID())}`,
      "invited_by=null,review_future_history='changed'", "invited_by=null,accepted_at=null"]) {
      await assert.rejects(db.sql(`update public.invites set ${edit} where token=${q(token)}`, ids.admin), /immutable/);
    }
    assert.equal(await db.sql(`select review_future_history from public.invites where token=${q(token)}`), 'preserve');
    await db.sql('alter table public.invites drop column review_future_history');
    assert.deepEqual(JSON.parse(await row()), original);
  });
  await t.test('restricted writer SERIALIZABLE deletion preserves consumed microsecond timestamp, other histories and memberships', async () => {
    const before = JSON.parse(await snapshot());
    await db.sql(`set role review_auth_writer; begin isolation level serializable; delete from auth.users where id=${q(author)}; commit`);
    assert.deepEqual(JSON.parse(await row()), { ...original, invited_by: null });
    const after = JSON.parse(await snapshot());
    assert.deepEqual(after.members, before.members.filter(m => m.user_id !== author));
    assert.deepEqual(after.orgs, before.orgs); assert.deepEqual(after.notes, before.notes);
    assert.equal(await db.sql(`select invited_by is null and accepted_at is null from public.invites where token=${q(pending)}`), 't');
    assert.equal(await db.sql(`select count(*) from auth.users where id=${q(author)}`), '0');
    for (const edit of ['accepted_at=null', "email='b@example.invalid'", "role='admin'", `invited_by=${q(otherAuthor)}`])
      await assert.rejects(db.sql(`update public.invites set ${edit} where token=${q(token)}`, ids.admin), /immutable/);
    await assert.rejects(db.sql(`select public.redeem_invite(${q(token)})`, ids.a), /Invitation unavailable/);
    await record({ probe: 'author-deletion', consumed: JSON.parse(await row()), membershipChanges: 'deleted author only' });
  });
  await t.test('invalid, wrong recipient/org/role, unverified, expired and consumed invitations never authorize', async () => {
    const u = randomUUID(), exp = randomUUID(), unv = randomUUID();
    await db.sql(`insert into auth.users values (${q(u)},'review-unverified@example.invalid',null);
      insert into public.invites(org_id,email,token,expires_at) values
      (${q(ids.oa)},'review-unverified@example.invalid',${q(unv)},clock_timestamp()+interval '1 day'),
      (${q(ids.oa)},'b@example.invalid',${q(exp)},clock_timestamp()-interval '1 day')`);
    for (const [tok, who] of [[randomUUID(), ids.b], [exp, ids.b], [unv, u], [pending, ids.b], [token, ids.a]])
      await assert.rejects(db.sql(`select public.redeem_invite(${q(tok)})`, who), /Invitation unavailable/);
    await assert.rejects(db.sql(`select public.redeem_invite(${q(unv)},${q(ids.ob)},'admin')`, u), /does not exist/);
    assert.equal(await db.sql(`select count(*) from public.org_members where user_id=${q(u)}`), '0');
    for (const role of ['anon', 'authenticated', 'review_auth_writer']) {
      assert.equal(await db.sql(`select has_function_privilege(${q(role)},'public.accept_mfda_invite(uuid,uuid)','execute')`), 'f');
      assert.equal(await db.sql(`select has_function_privilege(${q(role)},'public.protect_consumed_mfda_invite()','execute')`), 'f');
    }
  });
  await t.test('post-deletion valid redemption and simultaneous replay yield one success with no member upgrade', async () => {
    const u = randomUUID(), fresh = randomUUID(), escalation = randomUUID();
    await db.sql(`insert into auth.users values (${q(u)},'review-concurrent@example.invalid',clock_timestamp());
      insert into public.invites(org_id,email,token) values (${q(ids.oa)},'review-concurrent@example.invalid',${q(fresh)})`);
    const results = await Promise.allSettled(Array.from({length: 6}, () => db.sql(`select public.redeem_invite(${q(fresh)})`, u)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => /Invitation unavailable/.test(r.reason.message)));
    await db.sql(`insert into public.invites(org_id,email,role,token) values (${q(ids.oa)},'review-concurrent@example.invalid','admin',${q(escalation)})`);
    await db.sql(`select public.redeem_invite(${q(escalation)})`, u);
    assert.equal(await db.sql(`select role from public.org_members where user_id=${q(u)}`), 'member');
  });
  await t.test('NEW EDGE: pre-existing rent-estimate author FK still blocks deletion and rolls back inviter cleanup', async () => {
    const a = randomUUID(), tok = randomUUID();
    await db.sql(`insert into auth.users values (${q(a)},'review-rent-author@example.invalid',clock_timestamp());
      insert into public.invites(org_id,email,token,invited_by,accepted_at) values (${q(ids.oa)},'a@example.invalid',${q(tok)},${q(a)},clock_timestamp());
      insert into public.rent_estimates(org_id,addr_key,rent,source,created_by) values (${q(ids.oa)},'review-rent',1234,'rentcast',${q(a)})`);
    const before = await snapshot();
    await assert.rejects(db.sql(`set role review_auth_writer; delete from auth.users where id=${q(a)}`), /rent_estimates_created_by_fkey/);
    assert.equal(await snapshot(), before); assert.equal(await db.sql(`select count(*) from auth.users where id=${q(a)}`), '1');
    await db.sql(`update public.rent_estimates set created_by=null where created_by=${q(a)}`);
    await db.sql(`set role review_auth_writer; delete from auth.users where id=${q(a)}`);
    assert.equal(await db.sql(`select invited_by is null and accepted_at is not null from public.invites where token=${q(tok)}`), 't');
    const pre = await database({ baseline: true });
    try {
      await pre.sql(`insert into public.rent_estimates(org_id,addr_key,rent,source,created_by) values (${q(ids.oa)},'review-pre',1234,'rentcast',${q(ids.a)})`);
      await assert.rejects(pre.sql(`delete from auth.users where id=${q(ids.a)}`), /rent_estimates_created_by_fkey/);
    } finally { await pre.close(); }
    await record({ probe: 'rent-estimate-deletion', vulnerableBefore015: true, vulnerableInV2: true, invitationOnlyDeletionFixed: true });
  });
});

test('independent actual SPA completion and output probes', { timeout: 240000 }, async t => {
  const db = await database(); let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  h = await browserHarness(db);
  const bDeal=randomUUID();
  await db.sql(`update public.deals set zip='85001',state='AZ' where id=${q(ids.deal)};
    insert into public.rent_bands(org_id,zip,source,period,rent) values (${q(ids.oa)},'85001','zori','2026-01',1500);
    insert into public.deals(id,org_id,dedupe_key,address,status,price,units_count) values
      (${q(bDeal)},${q(ids.ob)},'independent-b','B ONLY INDEPENDENT POSITIVE','analyzing',500000,4);
    insert into public.scenarios(org_id,deal_id,label,inputs,outputs,calc_version)
      select ${q(ids.ob)},${q(bDeal)},'B ONLY INDEPENDENT SCENARIO',inputs,outputs,calc_version
      from public.scenarios where deal_id=${q(ids.deal)};`);

  async function pdfFixture(user = ids.a) {
    const f = await h.context(user), downloads = []; let rewrites = 0;
    f.page.on('download', d => downloads.push(d));
    await f.ctx.addInitScript(() => {
      window.reviewPdfReady = 0; window.reviewPdfReturned = 0; window.reviewPdfUrls = []; window.reviewPdfRevokes = []; window.reviewPdfEpoch = 0;
      const origins = new WeakMap();
      let release;
      const hold = new Promise(r => release = r);
      window.reviewReleasePDF = release;
      window.reviewDelayPDF = async promise => { const epoch=window.reviewPdfEpoch; const blob = await promise; origins.set(blob,epoch); window.reviewPdfReady++; await hold; window.reviewPdfReturned++; return blob; };
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = function(blob) { const url = create.call(this, blob); if (blob.type === 'application/pdf') window.reviewPdfUrls.push({url,startedEpoch:origins.get(blob),publishedEpoch:window.reviewPdfEpoch}); return url; };
      URL.revokeObjectURL = function(url) { window.reviewPdfRevokes.push(url); return revoke.call(this, url); };
    });
    // Delay only the actual installed renderer's promise result. The PDF
    // renderer, render queue, React cleanup and production link remain real.
    await f.ctx.route('**/@react-pdf_renderer.js*', async route => {
      const response = await route.fetch(); const source = await response.text();
      const marker = 'pdfInstance.current.toBlob()';
      assert.equal(source.split(marker).length - 1, 1, 'exact renderer interception must be present');
      rewrites++;
      await route.fulfill({ response, body: source.replace(marker, 'window.reviewDelayPDF(pdfInstance.current.toBlob())') });
    });
    await f.page.goto(h.base + `/deals/${ids.deal}`);
    await f.page.locator('a[download]').filter({hasText:'Building PDF…'}).waitFor();
    await f.page.waitForFunction(() => window.reviewPdfReady > 0);
    assert.equal(rewrites, 1); assert.deepEqual(await f.page.evaluate(() => window.reviewPdfUrls), []);
    assert.equal(await f.page.evaluate(retainLifetime), true);
    return { ...f, downloads, release: () => f.page.evaluate(() => window.reviewReleasePDF()), close: () => f.ctx.close() };
  }
  await t.test('real delayed PDF positive control releases valid bytes under unchanged A', async () => {
    const f = await pdfFixture();
    try {
      await f.release(); const link = f.page.getByRole('link', { name: 'PDF report', exact: true }); await link.waitFor();
      const next = f.page.waitForEvent('download'); await link.click(); const d = await next;
      const bytes = await readFile(await d.path()); assert.equal(bytes.subarray(0,5).toString(), '%PDF-');
      assert.equal(d.suggestedFilename(), 'a-only-security-canary-report.pdf');
      await record({ probe: 'delayed-pdf-positive', bytes: bytes.length, filename: d.suggestedFilename() });
    } finally { await f.close(); }
  });
  for (const mode of ['auth', 'org', 'auth-roundtrip']) {
    await t.test(`held renderer promise after ${mode} transition cannot publish URL/link/download`, async () => {
      const f = await pdfFixture(mode === 'org' ? ids.both : ids.a);
      try {
        await f.page.evaluate(()=>window.reviewPdfEpoch=1);
        if (mode === 'org') {
          await f.page.locator('header select').selectOption(ids.ob);
          await f.page.waitForFunction(id => document.querySelector('header select')?.value === id, ids.ob);
        } else { await h.changeUser(f.page, ids.b); await f.page.getByText('Synthetic Tenant B', {exact:true}).waitFor(); }
        assert.equal(await f.page.evaluate(() => window.reviewOldGuard()), false);
        const before = await f.page.evaluate(() => window.reviewPdfReturned);
        if (mode === 'auth-roundtrip') {
          await f.page.evaluate(()=>window.reviewPdfEpoch=2);
          await h.changeUser(f.page, ids.a);
          await f.page.locator('a[download]').filter({hasText:'Building PDF…'}).waitFor();
          await f.page.waitForFunction(() => window.reviewPdfReady >= 2);
        }
        await f.release(); await f.page.waitForFunction(n => window.reviewPdfReturned > n, before); await frames(f.page);
        assert.equal(await f.page.evaluate(() => window.reviewOldGuard()), false);
        assert.equal(await f.page.evaluate(() => window.reviewOldClient.getQueryCache().getAll().length), 0);
        assert.equal(f.downloads.length, 0);
        if (mode === 'auth-roundtrip') {
          await f.page.getByRole('link', {name:'PDF report',exact:true}).waitFor();
          const urls=await f.page.evaluate(()=>window.reviewPdfUrls);
          assert.ok(urls.length>0);
          assert.ok(urls.every(u=>u.startedEpoch===2&&u.publishedEpoch===2), 'every published Blob must originate from the new A renderer lifetime');
        } else {
          assert.deepEqual(await f.page.evaluate(() => window.reviewPdfUrls), []);
          assert.equal(await f.page.locator('a[download]').count(), 0);
          assert.doesNotMatch(await f.page.locator('body').innerText(), /A ONLY/);
        }
        await record({ probe: 'delayed-pdf-' + mode, downloads: f.downloads.length, publishedUrls: await f.page.evaluate(() => window.reviewPdfUrls) });
        if(mode==='auth') {
          // Positive B data prevents a fail-closed blank screen from proving isolation.
          await h.route(f.page,`/deals/${bDeal}`);
          const link=f.page.getByRole('link',{name:'PDF report',exact:true});await link.waitFor();
          const next=f.page.waitForEvent('download');await link.click();const d=await next;
          const bytes=await readFile(await d.path());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
          assert.equal(d.suggestedFilename(),'b-only-independent-positive-report.pdf');
          await record({probe:'pdf-b-positive-after-suppression',filename:d.suggestedFilename(),bytes:bytes.length});
        }
      } finally { await f.close(); }
    });
  }
  await t.test('ready A PDF URL is revoked on auth replacement and cannot be fetched afterward', async () => {
    const f = await pdfFixture();
    try {
      await f.release(); const link = f.page.getByRole('link', {name:'PDF report',exact:true}); await link.waitFor();
      const url = await link.getAttribute('href'); assert.match(url, /^blob:/);
      await h.changeUser(f.page, ids.b); await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      await f.page.waitForFunction(u => window.reviewPdfRevokes.includes(u), url);
      assert.equal(await f.page.evaluate(async u => { try { await fetch(u); return true; } catch { return false; } }, url), false);
      assert.equal(f.downloads.length, 0);
    } finally { await f.close(); }
  });
  await t.test('PDF promise resumed inside B auth publication cannot publish a pre-commit A URL', async () => {
    const f=await pdfFixture();
    try {
      await f.page.evaluate(async b=>{
        const {supabase}=await import('/src/lib/supabase.js');
        supabase.auth.onAuthStateChange((_event,session)=>{
          if(session?.user.id===b) { window.reviewPdfEpoch=1; window.reviewReleasePDF(); }
        });
      },ids.b);
      await h.changeUser(f.page,ids.b);await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      await f.page.waitForFunction(()=>window.reviewPdfReturned>0);await frames(f.page);
      assert.deepEqual(await f.page.evaluate(()=>window.reviewPdfUrls),[]);assert.equal(f.downloads.length,0);
      assert.equal(await f.page.evaluate(()=>window.reviewOldGuard()),false);
      await record({probe:'pdf-auth-publication-race',publishedUrls:[],downloads:0});
    }finally{await f.close();}
  });
  await t.test('completion predicate rejects B inside the auth subscriber before React commits', async () => {
    const f = await h.context();
    try {
      await f.page.goto(h.base + '/deals'); await f.page.getByText('A ONLY SECURITY CANARY', {exact:true}).waitFor();
      assert.equal(await f.page.evaluate(retainLifetime), true);
      await f.page.evaluate(async b => {
        const { supabase } = await import('/src/lib/supabase.js'); window.reviewSubscriberChecks = [];
        supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user.id === b) window.reviewSubscriberChecks.push({ allowed: window.reviewOldGuard(), body: document.body.innerText });
        });
      }, ids.b);
      await h.changeUser(f.page, ids.b); await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      const checks = await f.page.evaluate(() => window.reviewSubscriberChecks);
      assert.ok(checks.length > 0); assert.ok(checks.every(c => !c.allowed));
      await f.page.getByText('B ONLY INDEPENDENT POSITIVE',{exact:true}).waitFor();
      await record({probe:'auth-synchronous-guard', checks});
    } finally { await f.ctx.close(); }
  });
  await t.test('DealNew delayed edit response cannot issue units/scenario/log follow-ons or navigate B', async () => {
    const f = await h.context(); let release, begun;
    const hold = new Promise(r => release=r), start = new Promise(r => begun=r); const writes=[];
    await f.ctx.route('https://mfda-security.invalid/rest/v1/*', async route => {
      const req=route.request(), url=new URL(req.url()); if (['GET','HEAD','OPTIONS'].includes(req.method()) || url.pathname.includes('/rpc/')) return route.fallback();
      const table=url.pathname.split('/').at(-1); writes.push(table);
      if (table !== 'deals' || req.method() !== 'PATCH') return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'unexpected follow-on write'})});
      const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url')).sub;
      const row=req.postDataJSON();
      const result=await db.sql(`update public.deals set address=${q(row.address)} where id=${q(ids.deal)} returning to_jsonb(deals)`,uid);
      begun(); await hold; await route.fulfill({status:200,contentType:'application/json',body:result});
    });
    try {
      await f.page.goto(h.base+`/deals/${ids.deal}/edit`);
      await f.page.waitForFunction(() => [...document.querySelectorAll('input')].some(e=>e.value==='A ONLY SECURITY CANARY'));
      await f.page.getByRole('button',{name:/Save revision/}).click(); await start;
      await h.changeUser(f.page,ids.b); await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      const response=f.page.waitForResponse(r=>r.request().method()==='PATCH'); release(); await (await response).finished(); await frames(f.page);
      assert.deepEqual(writes,['deals']); assert.equal(new URL(f.page.url()).pathname,`/deals/${ids.deal}/edit`);
      assert.doesNotMatch(await f.page.locator('body').innerText(),/A ONLY/);
    } finally { release(); await f.ctx.close(); }
  });
  await t.test('OffMarketDeal held existing-deal lookup cannot navigate B to A edit', async () => {
    const f=await h.context(); let release,begun;
    const hold=new Promise(r=>release=r), start=new Promise(r=>begun=r);
    await db.sql(`update public.deals set dedupe_key='apn:04013:security' where id=${q(ids.deal)}`);
    await f.ctx.route('https://mfda-security.invalid/rest/v1/deals*',async route=>{
      const url=new URL(route.request().url()); if (!url.searchParams.has('dedupe_key')) return route.fallback();
      const uid=JSON.parse(Buffer.from(route.request().headers().authorization.split('.')[1],'base64url')).sub;
      const body=await db.sql(`select json_build_object('id',id,'status',status) from public.deals where org_id=${q(ids.oa)} and dedupe_key='apn:04013:security'`,uid);
      begun(); await hold; await route.fulfill({status:200,contentType:'application/json',body});
    });
    try {
      await f.page.goto(h.base+`/off-market/${ids.parcel}`); await f.page.getByRole('button',{name:/Analyze as deal/}).click(); await start;
      await h.changeUser(f.page,ids.b); await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      const response=f.page.waitForResponse(r=>new URL(r.url()).searchParams.has('dedupe_key')); release(); await (await response).finished(); await frames(f.page);
      assert.equal(new URL(f.page.url()).pathname,`/off-market/${ids.parcel}`); assert.doesNotMatch(await f.page.locator('body').innerText(),/A ONLY/);
    } finally { release(); await f.ctx.close(); }
  });
  await t.test('NEW LIFECYCLE GAP: A cache miss completed under B initiates A-address RentCast proxy request', async () => {
    const f=await h.context(); let release,begun;
    const hold=new Promise(r=>release=r), start=new Promise(r=>begun=r); const outbound=[],writes=[];
    await f.ctx.route('https://mfda-security.invalid/rest/v1/rent_estimates*',async route=>{
      if(route.request().method()!=='GET') return route.fallback();
      const uid=JSON.parse(Buffer.from(route.request().headers().authorization.split('.')[1],'base64url')).sub;
      assert.equal(uid,ids.a);
      const body=await db.sql(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.rent_estimates r where org_id=${q(ids.oa)}`,uid);
      assert.equal(body,'[]'); begun(); await hold;
      await route.fulfill({status:200,contentType:'application/json',body});
    });
    await f.ctx.route('**/.netlify/functions/rent-estimate?*',async route=>{
      const url=new URL(route.request().url());
      outbound.push({address:url.searchParams.get('address'),authorization:route.request().headers().authorization??null,
        header:await f.page.locator('header').innerText()});
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rent:9876,source:'rentcast',fetched_at:new Date().toISOString()})});
    });
    await f.ctx.route('https://mfda-security.invalid/rest/v1/*',async route=>{
      const req=route.request(); if(req.method()!=='POST' || req.url().includes('/rpc/')) return route.fallback();
      writes.push({table:new URL(req.url()).pathname.split('/').at(-1),uid:JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url')).sub,row:req.postDataJSON()});
      const uid=writes.at(-1).uid, row=req.postDataJSON(), table=writes.at(-1).table;
      assert.ok(['cost_ledger','rent_estimates'].includes(table));
      if(table==='cost_ledger') {
        await assert.rejects(db.sql(`insert into public.cost_ledger(org_id,kind,provider,description,amount_usd,created_by)
          values (${q(row.org_id)},${q(row.kind)},${q(row.provider)},${q(row.description)},0,${q(row.created_by)})`,uid),/row-level security/);
      } else {
        await assert.rejects(db.sql(`insert into public.rent_estimates(org_id,addr_key,rent,source,created_by)
          values (${q(row.org_id)},${q(row.addr_key)},${q(row.rent)},${q(row.source)},${q(row.created_by)})`,uid),/row-level security/);
      }
      await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'actual local RLS denial'})});
    });
    try {
      await f.page.goto(h.base+`/deals/${ids.deal}/edit`);
      await f.page.getByRole('button',{name:/Address-level \(RentCast\)/}).click(); await start;
      await h.changeUser(f.page,ids.b); await f.page.getByText('Synthetic Tenant B',{exact:true}).waitFor();
      release(); await until(()=>outbound.length===1); await until(()=>writes.length>=1); await frames(f.page);
      assert.match(outbound[0].address,/A ONLY SECURITY CANARY/); assert.match(outbound[0].header,/Synthetic Tenant B/);
      assert.equal(outbound[0].authorization,null); assert.equal(writes[0].uid,ids.b); assert.equal(writes[0].row.org_id,ids.oa);
      assert.doesNotMatch(await f.page.locator('body').innerText(),/A ONLY|9,876/);
      await record({probe:'stale-rentcast',outbound,writes,visibleTenantLeak:false,externalCallInitiatedAfterB:true});
    } finally { release(); await f.ctx.close(); }
  });
  assert.deepEqual(h.errors, [], 'all unexpected real SPA/SQL errors fail independent diagnostics');
});

test('NEW SERVER GAP: real RentCast handler forwards an unauthenticated request (synthetic upstream only)',async()=>{
  const {default:handler}=await import('../../../../mfda/netlify/functions/rent-estimate.mjs');
  const oldFetch=globalThis.fetch,oldKey=process.env.RENTCAST_API_KEY;const calls=[];
  process.env.RENTCAST_API_KEY='SYNTHETIC-INDEPENDENT-REVIEW';
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({rent:1234}),{status:200,headers:{'content-type':'application/json'}});};
  try{
    const request=new Request('http://localhost/.netlify/functions/rent-estimate?address=A%20ONLY%20SECURITY%20CANARY');
    assert.equal(request.headers.get('authorization'),null);
    const result=await handler(request);assert.equal(result.status,200);assert.equal(calls.length,1);
    assert.match(calls[0].url,/A\+ONLY\+SECURITY\+CANARY/);assert.equal((await result.json()).rent,1234);
    await record({probe:'rentcast-handler-no-auth',status:200,upstreamCalls:calls.length,synthetic:true});
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.RENTCAST_API_KEY;else process.env.RENTCAST_API_KEY=oldKey;}
});
