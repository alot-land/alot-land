import { chromium } from 'playwright';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ids, quote as q, root } from './db-harness.mjs';

export async function browserHarness(db, { appRoot = root } = {}) {
  const inputs = { price: 500000, land_value: 100000, units: [{ type: '2BR', count: 4, sqft: 850, actual_rent: 1500, market_rent: 1500 }], expenses: { insurance: 3500, management: 5000, utilities: 2400, repairs_maintenance: 3000, capex_reserve: 1200 }, property_tax_rate: 0.009 };
  const bundle = path.join(db.dir, 'underwrite.mjs');
  await build({ entryPoints: [path.join(root, 'src/lib/underwrite.js')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', alias: { '@alot/mf-calc': path.join(root, '../packages/mf-calc/src/index.ts') } });
  const { underwrite } = await import(pathToFileURL(bundle));
  const outputs = underwrite(inputs);
  await db.sql(`insert into public.scenarios(org_id,deal_id,label,inputs,outputs,calc_version) values
    (${q(ids.oa)},${q(ids.deal)},'A ONLY ANALYSIS CANARY',${q(JSON.stringify(inputs))},${q(JSON.stringify(outputs))},'1.14.0');
    insert into public.markets(org_id,state,name) values (${q(ids.oa)},'AZ','A ONLY MARKET CANARY');
    insert into public.market_stats(org_id,geo_id,name,state,population) values
      (${q(ids.oa)},'04013','A ONLY MARKET STATS CANARY','AZ',50000);
    insert into public.goals(org_id,name,target_monthly) values (${q(ids.oa)},'A ONLY GOAL CANARY',1000);
    insert into public.notes(org_id,entity_type,entity_id,body) values (${q(ids.oa)},'deal',${q(ids.deal)},'A ONLY NOTE CANARY');
    insert into public.mail_lists(org_id,name) values (${q(ids.oa)},'A ONLY CAMPAIGN CANARY');
    insert into public.deals(org_id,dedupe_key,address,status) values (${q(ids.oa)},'security-lead','A ONLY LISTING CANARY','lead');
    insert into public.contacts(org_id,deal_id,source,owner_name) values (${q(ids.oa)},${q(ids.deal)},'listing','A ONLY CONTACT CANARY');`);
  process.env.VITE_SUPABASE_URL = 'https://mfda-security.invalid';
  process.env.VITE_SUPABASE_ANON_KEY = 'SYNTHETIC';
  const server = await createServer({ root: appRoot, configFile: path.join(appRoot, 'vite.config.js'), cacheDir: path.join(db.dir, 'vite-cache'), envDir: db.dir, optimizeDeps: { include: ['@react-pdf/renderer', 'leaflet'] }, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false, fs: { allow: [path.dirname(appRoot), root] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ ...(process.env.MFDA_TEST_BROWSER ? { executablePath: process.env.MFDA_TEST_BROWSER } : {}), headless: true });
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const user = (id) => ({ id, email: ({ [ids.a]: 'a', [ids.b]: 'b', [ids.both]: 'both' }[id] ?? 'admin') + '@example.invalid', aud: 'authenticated', role: 'authenticated' });
  const token = (id, version = 0) => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: expiry, role: 'authenticated', version })).toString('base64url'), 'U1lOVEhFVElD'].join('.');
  const session = (id) => ({ access_token: token(id), refresh_token: 'SYNTHETIC', expires_at: expiry, expires_in: 3600, token_type: 'bearer', user: user(id) });
  const requests = [], errors = [];
  const control = { delay: 0, fail: false, membershipDelay: 0, hold: null, logoutDelay: 0, logoutFail: false };
  const allowedTables = new Set(['invites','org_members','deals','scenarios','contacts','notes','units','markets','goals','parcels','mail_lists','mail_list_items','mail_exports','rent_bands','rent_estimates','cost_ledger','comps','scan_runs','market_stats','parcel_coverage']);
  async function context(id = ids.a) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(({ s, org }) => {
      if (!localStorage.getItem('security.initialized')) {
        localStorage.setItem('sb-mfda-security-auth-token', JSON.stringify(s));
        localStorage.setItem(`mfda.activeOrg:${s.user.id}`, org);
        localStorage.setItem('mfda.activeOrg', org); // legacy ID must never authorize
        localStorage.setItem('security.initialized','true');
      }
    }, { s: session(id), org: ids.oa });
    await ctx.routeWebSocket(/mfda-security\.invalid/, (socket) => socket.close());
    await ctx.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === base) return route.continue();
      if (url.hostname !== 'mfda-security.invalid') return route.abort();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      const finish = (data, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(data) }).catch(() => {});
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '' });
      const bearer = req.headers().authorization?.replace(/^Bearer /, '');
      let uid;
      try { uid = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub; } catch { return finish({ message: 'Synthetic authentication required' }, 401); }
      if (![ids.a,ids.b,ids.both,ids.admin].includes(uid)) return finish({ message: 'Unknown synthetic user' }, 401);
      if (url.pathname.startsWith('/auth/')) {
        if (url.pathname.endsWith('/logout')) {
          requests.push({ table: 'logout', uid, search: url.search, method: req.method() });
          if (control.logoutDelay) await new Promise((r) => setTimeout(r, control.logoutDelay));
          if (control.logoutFail) return finish({ message: 'Synthetic failed logout' }, 500);
        }
        return finish(user(uid));
      }
      const table = url.pathname.split('/').at(-1);
      requests.push({ table, uid, search: url.search, method: req.method() });
      try {
        if (url.pathname.includes('/rpc/')) {
          if (table !== 'accept_pending_mfda_invites') return finish({ message: 'Unknown RPC' }, 404);
          await db.sql('select public.accept_pending_mfda_invites()', uid);
          return finish(null);
        }
        if (!allowedTables.has(table) || !['GET','HEAD'].includes(req.method())) return finish({ message: 'Read-only synthetic adapter' }, 405);
        const clauses = [];
        for (const [column, value] of url.searchParams) {
          if (!/^[a-z_]+$/.test(column) || ['select','order','limit','offset','or'].includes(column)) continue;
          if (value.startsWith('eq.')) clauses.push(`t.${column}=${q(value.slice(3))}`);
          else if (value.startsWith('neq.')) clauses.push(`t.${column}<>${q(value.slice(4))}`);
          else if (value === 'not.is.null') clauses.push(`t.${column} is not null`);
          else if (value === 'is.null') clauses.push(`t.${column} is null`);
          else if (value.startsWith('in.(')) clauses.push(`t.${column} in (${value.slice(4,-1).split(',').map(q).join(',')})`);
        }
        const where = clauses.length ? ' where ' + clauses.join(' and ') : '';
        let expression = 'to_jsonb(t)', from = `public.${table} t`;
        if (table === 'org_members' && url.searchParams.get('select')?.includes('org:')) {
          expression = "jsonb_build_object('role',t.role,'org',to_jsonb(o))";
          from += ' join public.orgs o on o.id=t.org_id';
        }
        if (table === 'mail_lists') expression = "to_jsonb(t)||jsonb_build_object('mail_list_items',jsonb_build_array(jsonb_build_object('count',0)))";
        let data = JSON.parse(await db.sql(`select coalesce(jsonb_agg(v),'[]'::jsonb) from (select ${expression} v from ${from}${where}) s`, uid));
        // Capture A's response BEFORE delay: models a request authorized before
        // identity/membership changes, finishing afterward. Actual SQL RLS ran.
        if (table === 'org_members' && control.membershipDelay) await new Promise((r) => setTimeout(r, control.membershipDelay));
        if (table !== 'org_members') {
          if (control.hold) await control.hold;
          if (control.delay) await new Promise((r) => setTimeout(r, control.delay));
          if (control.fail) return finish({ message: 'Synthetic failed request' }, 500);
        }
        headers['content-range'] = `0-${Math.max(0,data.length-1)}/${data.length}`;
        if (req.headers().accept?.includes('vnd.pgrst.object')) {
          if (data.length !== 1) return finish({ message: 'Record unavailable', code: 'PGRST116' }, 406);
          data = data[0];
        }
        return finish(data);
      } catch (e) { errors.push(e.message); return finish({ message: 'Synthetic SQL adapter failed' }, 500); }
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push('frontend: '+e.message));
    return { ctx, page };
  }
  async function changeUser(page, id, version = 0) {
    await page.evaluate(async (t) => {
      const { supabase } = await import('/src/lib/supabase.js');
      const { error } = await supabase.auth.setSession({ access_token: t, refresh_token: 'SYNTHETIC' });
      if (error) throw error;
    }, token(id, version));
  }
  async function route(page, pathname) {
    await page.evaluate((p) => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')); }, pathname);
  }
  return { base, context, changeUser, route, requests, errors, control, close: async () => { await browser.close(); await server.close(); } };
}
