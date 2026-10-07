import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, ids, quote as q } from '../../../../mfda/security/db-harness.mjs';
import { browserHarness } from '../../../../mfda/security/browser-harness.mjs';

async function until(check) { const end=Date.now()+15000; while(!check()) { assert.ok(Date.now()<end); await new Promise(r=>setTimeout(r,20)); } }
test('independent paged CSV tests exercise actual 1000-row boundary and final browser output', {timeout:120000}, async t=>{
  const db=await database(); let h;
  t.after(async()=>{try{await h?.close();}finally{await db.close();}});
  h=await browserHarness(db);
  const list=randomUUID();
  await db.sql(`insert into public.mail_lists(id,org_id,name) values (${q(list)},${q(ids.oa)},'REVIEW PAGED A');
    insert into public.parcels(org_id,state,county_fips,apn,dedupe_key,situs_address,units)
      select ${q(ids.oa)},'AZ','04013','REVIEW'||n,'review-page-'||n,'A ONLY PAGED '||n,4 from generate_series(1,1001) n;
    insert into public.mail_list_items(list_id,org_id,parcel_id)
      select ${q(list)},${q(ids.oa)},id from public.parcels where dedupe_key like 'review-page-%';`);
  async function fixture() {
    const f=await h.context(ids.both),requests=[],downloads=[],logs=[];let held=false,release;
    const hold=new Promise(r=>release=r);
    f.page.on('download',d=>downloads.push(d));
    await f.ctx.addInitScript(()=>{
      window.reviewCsvBlobs=0;window.reviewCsvUrls=0;window.reviewCsvConsumed=0;
      const Native=Blob;window.Blob=class extends Native{constructor(parts,options){super(parts,options);if(options?.type?.includes('csv'))window.reviewCsvBlobs++;}};
      const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type.includes('csv'))window.reviewCsvUrls++;return create.call(this,blob);};
      const orig=fetch;window.fetch=async(...args)=>{const response=await orig(...args);if(String(args[0]).includes('/mail_list_items')){const text=response.text.bind(response);response.text=async()=>{const value=await text();window.reviewCsvConsumed++;return value;};}return response;};
    });
    await f.ctx.route('https://mfda-security.invalid/rest/v1/mail_list_items*',async route=>{
      const req=route.request(),url=new URL(req.url());
      const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url')).sub;
      const org=url.searchParams.get('org_id')?.slice(3),l=url.searchParams.get('list_id')?.slice(3);
      const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
      assert.equal(l,list);assert.equal(org,ids.oa);assert.ok([0,1000].includes(offset));assert.equal(limit,1000);
      const body=await db.sql(`select coalesce(jsonb_agg(jsonb_build_object('parcels',to_jsonb(p))),'[]')
        from (select i.parcel_id from public.mail_list_items i where i.list_id=${q(l)} and i.org_id=${q(org)} order by i.parcel_id limit ${limit} offset ${offset}) i
        join public.parcels p on p.id=i.parcel_id`,uid);
      requests.push({uid,org,offset,rows:JSON.parse(body).length});
      if(held&&offset===0)await hold;
      await route.fulfill({status:200,contentType:'application/json',body});
    });
    await f.ctx.route('https://mfda-security.invalid/rest/v1/mail_exports*',async route=>{
      const req=route.request(),row=req.postDataJSON();
      const uid=JSON.parse(Buffer.from(req.headers().authorization.split('.')[1],'base64url')).sub;
      await db.sql(`insert into public.mail_exports(org_id,list_id,format,row_count,created_by) values
        (${q(row.org_id)},${q(row.list_id)},${q(row.format)},${Number(row.row_count)},${q(row.created_by)})`,uid);
      logs.push(row);await route.fulfill({status:201,contentType:'application/json',body:'null'});
    });
    await f.page.goto(h.base+'/off-market');await f.page.getByRole('button',{name:/Saved mail lists/}).click();
    const start=async()=>{await f.page.getByRole('row').filter({hasText:'REVIEW PAGED A'}).getByRole('button',{name:/CSV/}).click();await until(()=>requests.length>0);};
    const finish=async()=>{await f.page.waitForFunction(()=>window.reviewCsvConsumed===2);await f.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
    return{...f,requests,downloads,logs,start,finish,hold:()=>held=true,release:()=>release(),close:async()=>{release();await f.ctx.close();}};
  }
  await t.test('unchanged A exports all 1001 authorized parcel rows with actual CSV bytes',async()=>{
    const f=await fixture();try{
      const next=f.page.waitForEvent('download');await f.start();const d=await next;
      const csv=await readFile(await d.path(),'utf8');assert.equal(csv.split('\r\n').length-2,1001);
      assert.match(csv,/A ONLY PAGED 1001/);assert.equal(d.suggestedFilename(),'review-paged-a.csv');
      assert.deepEqual(f.requests.map(r=>[r.offset,r.rows]),[[0,1000],[1000,1]]);await until(()=>f.logs.length===1);assert.equal(f.logs[0].row_count,1001);
    }finally{await f.close();}
  });
  await t.test('A first page held across org A → B → A cannot release obsolete two-page CSV or filename',async()=>{
    const f=await fixture();try{
      f.hold();await f.start();
      await f.page.locator('header select').selectOption(ids.ob);await f.page.waitForFunction(id=>document.querySelector('header select')?.value===id,ids.ob);
      await f.page.locator('header select').selectOption(ids.oa);await f.page.waitForFunction(id=>document.querySelector('header select')?.value===id,ids.oa);
      f.release();await f.finish();assert.deepEqual(f.requests.map(r=>[r.offset,r.rows]),[[0,1000],[1000,1]]);
      assert.equal(f.downloads.length,0);assert.equal(f.logs.length,0);
      assert.equal(await f.page.evaluate(()=>window.reviewCsvBlobs),0);assert.equal(await f.page.evaluate(()=>window.reviewCsvUrls),0);
    }finally{await f.close();}
  });
  assert.deepEqual(h.errors,[]);
});

