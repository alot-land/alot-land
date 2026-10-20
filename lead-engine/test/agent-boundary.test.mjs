import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Strip comments before asserting on source. The modules deliberately DESCRIBE
 * the old loophole — "lead-sweep → repairMissing() → notifyAll()" — and that
 * explanation is worth keeping. Asserting on raw text would force the fix to be
 * undocumented to stay green, which is the wrong trade.
 */
const code = (url) => readFileSync(url, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
import { assessEligibility, authorise, claimDelivery, AGENT_TRIGGER, eligibleLots } from '../policy.mjs';

const AGENTS = /tony|ryan|7316072221/i;
const sent = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = 'mock';
  process.env.LEAD_NOTIFY_OWNER = 'david@alot.land';
  process.env.LEAD_NOTIFY_AGENTS = 'tony.alcott@outlook.com,ryan.schuler216@outlook.com';
  process.env.LEAD_NOTIFY_SMS = '+17316072221';
  delete process.env.SMS_ENABLED;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts?.body ?? '{}') });
    return new Response(JSON.stringify({ id: 'mock' }), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY; });

const agentsWereContacted = () => sent.some(s => AGENTS.test(JSON.stringify(s.body)));

const lead = (over = {}) => ({
  id: 'a'.repeat(32), name: 'Dana Whitfield', phone: '+16155550188', email: 'dana@example.com',
  lot: eligibleLots()[0], lotName: 'Whitetail Ridge', inquiryType: 'showing',
  consent: { given: true, at: new Date().toISOString() }, stage: 'new',
  createdAt: new Date().toISOString(), history: [], notifications: [], ...over,
});

const memStore = () => { const m = new Map(); return {
  getFlag: async k => m.get(k) ?? null, setFlag: async (k, v) => void m.set(k, v) }; };

// ── eligibility ───────────────────────────────────────────────────────────
test('an eligible enquiry passes', () => {
  assert.equal(assessEligibility(lead(), { formName: 'stv-lead' }).ok, true);
});

test('ineligible enquiries are refused, each for its own reason', () => {
  const cases = [
    [{}, 'newsletter', /not the authorised intake form/],
    [{ lot: 'sugar-tree-vista-1-valley-view' }, 'stv-lead', /not a currently available/],
    [{ phone: '', email: '' }, 'stv-lead', /no contact method/],
    [{ consent: { given: false } }, 'stv-lead', /no consent/],
    [{ name: 'TEST Log Probe' }, 'stv-lead', /synthetic/],
  ];
  for (const [over, formName, re] of cases) {
    const r = assessEligibility(lead(over), { formName });
    assert.equal(r.ok, false);
    assert.match(r.reasons.join('; '), re);
  }
});

// ── authorisation is fail-closed ──────────────────────────────────────────
test('the sender refuses without an authorisation', async () => {
  const { notifyAgentsOfNewLead } = await import('../notify.mjs?b1');
  const r = await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land' });
  assert.equal(r[0].status, 'refused');
  assert.equal(agentsWereContacted(), false);
});

test('a forged authorisation is refused — the token cannot be hand-made', async () => {
  const { notifyAgentsOfNewLead } = await import('../notify.mjs?b2');
  for (const fake of [{ trigger: AGENT_TRIGGER }, { trigger: AGENT_TRIGGER, authorised: true }, true, 'yes']) {
    const r = await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land', authorisation: fake });
    assert.equal(r[0].status, 'refused', JSON.stringify(fake));
  }
  assert.equal(agentsWereContacted(), false);
});

test('a genuine authorised enquiry DOES reach the agents', async () => {
  const { notifyAgentsOfNewLead } = await import('../notify.mjs?b3');
  const auth = authorise({ trigger: AGENT_TRIGGER, submissionId: 'sub-1', destinations: { email: true, sms: true } });
  const r = await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land', authorisation: auth });
  const emails = sent.filter(s => s.url.includes('resend'));
  assert.equal(emails.length, 1, 'exactly one email');
  assert.deepEqual([...emails[0].body.to].sort(),
    ['david@alot.land', 'ryan.schuler216@outlook.com', 'tony.alcott@outlook.com']);
  assert.equal(r.find(a => a.channel === 'sms').status, 'skipped', 'SMS off until enabled');
});

test('SMS goes once to Tony when enabled', async () => {
  process.env.SMS_ENABLED = 'true';
  process.env.SMS_PROVIDER_URL = 'https://sms.example/send';
  process.env.SMS_PROVIDER_TOKEN = 'mock';
  const { notifyAgentsOfNewLead } = await import('../notify.mjs?b4');
  const auth = authorise({ trigger: AGENT_TRIGGER, submissionId: 'sub-2', destinations: { email: true, sms: true } });
  await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land', authorisation: auth });
  const sms = sent.filter(s => s.url.includes('sms.example'));
  assert.equal(sms.length, 1, 'exactly one text');
  assert.equal(sms[0].body.to, '+17316072221');
  delete process.env.SMS_ENABLED;
});

// ── idempotency ───────────────────────────────────────────────────────────
test('a replayed submission cannot be delivered twice', async () => {
  const s = memStore();
  const first = await claimDelivery(s, { submissionId: 'sub-9', destination: 'agents' });
  const replay = await claimDelivery(s, { submissionId: 'sub-9', destination: 'agents' });
  assert.equal(first.claimed, true);
  assert.equal(replay.claimed, false);
  assert.match(replay.reason, /already delivered/);
});

test('idempotency is per destination, and fails CLOSED if the store is down', async () => {
  const s = memStore();
  await claimDelivery(s, { submissionId: 'sub-9', destination: 'agents' });
  assert.equal((await claimDelivery(s, { submissionId: 'sub-9', destination: 'buyer' })).claimed, true);
  const broken = { getFlag: async () => { throw new Error('store down'); }, setFlag: async () => {} };
  const r = await claimDelivery(broken, { submissionId: 'sub-9', destination: 'agents' });
  assert.equal(r.claimed, false, 'if we cannot prove it was not sent, we do not send');
  assert.equal((await claimDelivery(s, { submissionId: '', destination: 'agents' })).claimed, false);
});

// ── the indirect path the review found ────────────────────────────────────
test('THE LOOPHOLE: reconciliation cannot reach an agent, directly or not', async () => {
  const src = code(new URL('../reconcile.mjs', import.meta.url));
  assert.ok(!/notifyAll|notifyAgentsOfNewLead|acknowledgeBuyer/.test(src),
    'reconcile.mjs must not import or call any agent/buyer-facing sender');
  assert.ok(/notifyOwner/.test(src), 'it reports to the owner instead');
});

test('the scheduled sweep cannot reach an agent, directly or not', async () => {
  const sweep = code(new URL('../../netlify/functions/lead-sweep.mjs', import.meta.url));
  assert.ok(!/notifyAgentsOfNewLead|notifyAll|acknowledgeBuyer|authorise\(/.test(sweep),
    'the sweep must not call an agent sender or mint an authorisation');
  const imports = [...sweep.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)]
    .filter(m => m[2].includes('notify')).map(m => m[1]);
  assert.deepEqual(imports.map(i => i.trim()), ['notifyOwner, sendReport'],
    'the sweep may import owner-facing senders only');
});

test('every agent-capable call site in the codebase is the intake path', () => {
  const files = ['../notify.mjs', '../reconcile.mjs', '../store.mjs',
    '../../netlify/functions/lead-sweep.mjs', '../../netlify/functions/lead-admin.mjs',
    '../../netlify/functions/submission-created.mjs'];
  const callers = [];
  for (const f of files) {
    const src = code(new URL(f, import.meta.url));
    if (/(?<!export async function )notifyAgentsOfNewLead\(/.test(src)) callers.push(f);
  }
  assert.deepEqual(callers, ['../../netlify/functions/submission-created.mjs'],
    'exactly one caller, and it is the authorised intake');
});

test('escalations, reports and owner alerts never carry an agent address', async () => {
  const { escalate, sendReport, notifyOwner } = await import('../notify.mjs?b5');
  await escalate(lead(), { siteUrl: 'https://alot.land' });
  await sendReport('daily');
  await notifyOwner({ subject: 'health', text: 'x' });
  assert.equal(sent.length, 3);
  assert.equal(agentsWereContacted(), false);
  sent.forEach(s => assert.deepEqual(s.body.to, ['david@alot.land']));
});
