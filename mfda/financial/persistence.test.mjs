import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { database, ids, quote as q, root } from '../security/db-harness.mjs';

test('R0-6: failed unit replacement preserves the prior financial truth', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.sql(`insert into units(org_id,deal_id,type,count,sqft,actual_rent,market_rent)
    values (${q(ids.oa)},${q(ids.deal)},'prior truth',12,900,1100,1300)`);
  // A real delete under local RLS, followed by a deterministic insertion failure.
  const client = {
    from(table) {
      assert.equal(table, 'units');
      return {
        delete() {
          const filters = [];
          return { eq(k,v) { filters.push(`${k}=${q(v)}`); return this; },
            async then(resolve) { await db.sql(`delete from units where ${filters.join(' and ')}`, ids.a); resolve({error:null}); } };
        },
        insert() { return { select: async () => ({data:null,error:new Error('injected insert failure')}) }; },
      };
    },
    async rpc(name, args) {
      const result = await db.sql(`select public.${name}(${q(args.p_org_id)}::uuid,${q(args.p_deal_id)}::uuid,${q(JSON.stringify(args.p_units))}::jsonb)`, ids.a);
      return { data: JSON.parse(result), error: null };
    },
  };
  globalThis.round1Client = client;
  const outfile = path.join(db.dir,'queries.mjs');
  await build({entryPoints:[path.join(root,'src/lib/queries.js')],outfile,bundle:true,platform:'node',format:'esm',
    plugins:[{name:'local-synthetic-db',setup(b){b.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'synthetic'}));
      b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export const supabase=globalThis.round1Client;',loader:'js'}));}}]});
  const { replaceUnits } = await import(pathToFileURL(outfile));
  // NOT NULL/type validation fails in the transaction as well as in the old adapter.
  await assert.rejects(replaceUnits(ids.oa,ids.deal,[{count:4,sqft:0,actual_rent:0,market_rent:0} ]));
  const after = await db.sql(`select count from units where deal_id=${q(ids.deal)}`,ids.a);
  console.log('R0-6 prior unit count after failed replacement:',JSON.stringify(after));
  assert.equal(after,'12');
});
