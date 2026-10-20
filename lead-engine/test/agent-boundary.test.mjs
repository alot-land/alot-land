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
import { assessEligibility, requestAgentNotification, settleDelivery, unresolvedDeliveries,
         dispatchAgentAlerts, isAuthorised, AGENT_TRIGGER, eligibleLots } from '../policy.mjs';
import * as policy from '../policy.mjs';

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

/**
 * Models the ONE guarantee the real store gives us: setJSON with onlyIfNew is a
 * single atomic compare-and-set. getFlag/setFlag deliberately yield to the event
 * loop, so any claim built from a separate read then write would interleave and
 * lose — which is exactly the defect being fixed here.
 */
const memStore = () => { const m = new Map(); return {
  _m: m,
  async createFlagIfAbsent(k, v) { if (m.has(k)) return false; m.set(k, v); return true; },
  async getFlag(k) { await null; return m.get(k) ?? null; },
  async setFlag(k, v) { await null; m.set(k, v); },
}; };

const claim = (lead_, over = {}) =>
  requestAgentNotification(lead_, { formName: 'stv-lead', channel: 'email', ...over });

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
  const s = memStore();
  const req = await claim(lead(), { submissionId: 'sub-1', channel: 'email', store: s });
  assert.equal(req.ok, true, JSON.stringify(req));
  const r = await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land', authorisation: req.authorisation });
  const emails = sent.filter(x => x.url.includes('resend'));
  assert.equal(emails.length, 1, 'exactly one email');
  assert.deepEqual([...emails[0].body.to].sort(),
    ['david@alot.land', 'ryan.schuler216@outlook.com', 'tony.alcott@outlook.com']);
  assert.equal(r[0].channel, 'email');
  assert.equal(r.some(a => a.channel === 'sms'), false, 'an email authorisation sends email only');
});

test('SMS goes once to Tony when enabled, and only on its own authorisation', async () => {
  process.env.SMS_ENABLED = 'true';
  process.env.SMS_PROVIDER_URL = 'https://sms.example/send';
  process.env.SMS_PROVIDER_TOKEN = 'mock';
  const { notifyAgentsOfNewLead } = await import('../notify.mjs?b4');
  const s = memStore();
  const req = await claim(lead(), { submissionId: 'sub-2', channel: 'sms', store: s });
  await notifyAgentsOfNewLead(lead(), { siteUrl: 'https://alot.land', authorisation: req.authorisation });
  const sms = sent.filter(x => x.url.includes('sms.example'));
  assert.equal(sms.length, 1, 'exactly one text');
  assert.equal(sms[0].body.to, '+17316072221');
  assert.equal(sent.filter(x => x.url.includes('resend')).length, 0, 'no email on an SMS authorisation');
  delete process.env.SMS_ENABLED;
});

// ── the token cannot be obtained except by passing the checks ─────────────
test('there is no way to mint an authorisation without being eligible', async () => {
  assert.equal(typeof policy.authorise, 'undefined',
    'authorise() must not be exported — importing it was a way to skip every check');
  const s = memStore();
  const bad = await claim(lead({ lot: 'nope' }), { submissionId: 'sub-x', store: s });
  assert.equal(bad.ok, false);
  assert.equal(bad.stage, 'eligibility');
  assert.equal(s._m.size, 0, 'an ineligible lead does not even take a claim');
});

// ── the claim is atomic, and per channel ──────────────────────────────────
test('two concurrent events for one submission produce exactly ONE winner', async () => {
  const s = memStore();
  const racers = Array.from({ length: 8 }, () =>
    claim(lead(), { submissionId: 'sub-race', channel: 'email', store: s }));
  const results = await Promise.all(racers);
  assert.equal(results.filter(r => r.ok).length, 1, 'exactly one claim may win');
  for (const r of results.filter(r => !r.ok)) {
    assert.equal(r.stage, 'claim');
    assert.match(r.reasons.join(' '), /already claimed/);
  }
});

test('the claim is a single atomic write, not a read followed by a write', () => {
  const src = code(new URL('../policy.mjs', import.meta.url));
  assert.ok(!/getFlag/.test(src),
    'policy.mjs must not read-then-write to claim; that window is the race');
  assert.ok(/createFlagIfAbsent/.test(src), 'it uses the create-only primitive');
  const store = code(new URL('../store.mjs', import.meta.url));
  assert.match(store, /createFlagIfAbsent[\s\S]*?onlyIfNew:\s*true/,
    'createFlagIfAbsent must delegate to the platform compare-and-set');
});

test('email and SMS are claimed independently — one cannot suppress the other', async () => {
  const s = memStore();
  const e1 = await claim(lead(), { submissionId: 'sub-7', channel: 'email', store: s });
  const s1 = await claim(lead(), { submissionId: 'sub-7', channel: 'sms', store: s });
  assert.equal(e1.ok, true);
  assert.equal(s1.ok, true, 'the SMS claim is its own key');
  assert.notEqual(e1.key, s1.key);
  assert.equal((await claim(lead(), { submissionId: 'sub-7', channel: 'email', store: s })).ok, false);
});

test('a claim fails CLOSED when the store is unavailable, and without an id', async () => {
  const down = { createFlagIfAbsent: async () => { throw new Error('store down'); } };
  const r = await claim(lead(), { submissionId: 'sub-8', store: down });
  assert.equal(r.ok, false, 'if we cannot prove it was not sent, we do not send');
  assert.match(r.reasons.join(' '), /store unavailable/);
  assert.equal((await claim(lead(), { submissionId: '', store: memStore() })).ok, false);
});

// ── a failed send is flagged, never silently retried ──────────────────────
test('a failed delivery is recorded on the claim and never auto-resent', async () => {
  const s = memStore();
  const req = await claim(lead(), { submissionId: 'sub-fail', channel: 'email', store: s });
  await settleDelivery(s, req.key, { status: 'failed', detail: 'provider 500' });
  const flag = await s.getFlag(req.key);
  assert.equal(flag.status, 'failed');
  assert.equal(flag.detail, 'provider 500');
  // The claim stands. Nothing re-attempts it to an agent on its own; the owner
  // is told instead. A stale alert arriving later looks like a fresh buyer.
  const again = await claim(lead(), { submissionId: 'sub-fail', channel: 'email', store: s });
  assert.equal(again.ok, false, 'a failure must not reopen the claim for an automatic resend');
});

test('a failed or refused attempt is surfaced, a skipped one is not noise', () => {
  const unresolved = unresolvedDeliveries([
    { channel: 'email', status: 'failed', error: 'boom' },
    { channel: 'sms', status: 'skipped', reason: 'SMS not enabled' },
    { channel: 'email', status: 'sent' },
    { channel: 'sms', status: 'refused', reason: 'claim: already claimed' },
  ]);
  assert.deepEqual(unresolved.map(a => a.status), ['failed', 'refused']);
});

// ── the whole dispatch path, exercised for real against mocks ─────────────
const mocks = (over = {}) => {
  const owner = [];
  return {
    owner,
    store: memStore(),
    alertOwner: async (m) => void owner.push(m),
    send: async (_l, { authorisation }) => {
      assert.equal(isAuthorised(authorisation), true, 'the sender is only ever handed a real token');
      const ch = authorisation.destinations.email ? 'email' : 'sms';
      return [{ channel: ch, to: 'agents', at: new Date().toISOString(), status: 'sent' }];
    },
    ...over,
  };
};
const dispatch = (lead_, m, over = {}) => dispatchAgentAlerts(lead_, {
  formName: 'stv-lead', submissionId: 'sub-d1', siteUrl: 'https://alot.land',
  store: m.store, send: m.send, alertOwner: m.alertOwner, ...over });

test('a real enquiry: both channels claimed, sent and settled, owner left alone', async () => {
  const m = mocks();
  const attempts = await dispatch(lead(), m);
  assert.deepEqual(attempts.map(a => `${a.channel}:${a.status}`), ['email:sent', 'sms:sent']);
  assert.equal(m.owner.length, 0, 'nothing to action, so David is not pestered');
  assert.equal(await m.store.getFlag('notify:sub-d1:email').then(f => f.status), 'sent');
  assert.equal(await m.store.getFlag('notify:sub-d1:sms').then(f => f.status), 'sent');
});

test('a replay of the same submission sends NOTHING a second time', async () => {
  const m = mocks();
  let calls = 0;
  const counted = { ...m, send: async (...a) => { calls++; return m.send(...a); } };
  await dispatch(lead(), counted);
  assert.equal(calls, 2);
  const replay = await dispatch(lead(), counted);
  assert.equal(calls, 2, 'the provider is not called again');
  assert.deepEqual(replay.map(a => a.status), ['refused', 'refused']);
});

test('a dead SMS provider does not stop the EMAIL reaching the agents', async () => {
  const m = mocks({ send: async (_l, { authorisation }) => {
    if (authorisation.destinations.sms) throw new Error('sms gateway timeout');
    return [{ channel: 'email', to: 'agents', status: 'sent' }];
  } });
  const attempts = await dispatch(lead(), m);
  assert.deepEqual(attempts.map(a => `${a.channel}:${a.status}`), ['email:sent', 'sms:failed']);
  assert.equal(m.owner.length, 1, 'David is told about the channel that failed');
  assert.match(m.owner[0].subject, /ACTION NEEDED/);
  assert.match(m.owner[0].text, /sms gateway timeout/);
  assert.match(m.owner[0].text, /Nothing is retried automatically/);
});

test('a total provider outage is reported to David, never retried to an agent', async () => {
  const m = mocks({ send: async () => { throw new Error('resend 503'); } });
  const attempts = await dispatch(lead(), m);
  assert.deepEqual(attempts.map(a => a.status), ['failed', 'failed']);
  assert.equal(m.owner.length, 1, 'ONE actionable alert, not one per channel');
  assert.match(m.owner[0].text, /email: resend 503[\s\S]*sms: resend 503/);
  assert.match(m.owner[0].text, /Dana Whitfield/);
  assert.match(m.owner[0].text, /Call or text Tony with the details above/);
  assert.match(m.owner[0].text, /no resend button/, 'the alert must not promise a button we do not have');
  // And the failure must not reopen the claim for an automatic resend later.
  const again = await dispatch(lead(), { ...m, send: async () => [{ channel: 'email', status: 'sent' }] });
  assert.deepEqual(again.map(a => a.status), ['refused', 'refused']);
});

test('an ineligible submission reaches no agent and raises no alarm', async () => {
  const m = mocks({ send: async () => assert.fail('must not be called') });
  const attempts = await dispatch(lead({ name: 'TEST probe' }), m);
  assert.deepEqual(attempts.map(a => a.status), ['skipped', 'skipped']);
  assert.match(attempts[0].reason, /eligibility: synthetic/);
  assert.equal(m.owner.length, 0, 'a test record is not an incident');
  assert.equal(m.store._m.size, 0, 'and it takes no claim');
});

test('a store outage blocks the send AND tells David, rather than failing silently', async () => {
  const m = mocks({ store: { createFlagIfAbsent: async () => { throw new Error('blobs down'); } },
                    send: async () => assert.fail('must not send when the claim cannot be proven') });
  const attempts = await dispatch(lead(), m);
  assert.deepEqual(attempts.map(a => a.status), ['refused', 'refused']);
  assert.match(attempts[0].reason, /claim: claim store unavailable: blobs down/);
  assert.deepEqual(unresolvedDeliveries(attempts).length, 2, 'both show in the exception report');
});

test('the intake delegates to the engine and injects the owner alert', () => {
  const src = code(new URL('../../netlify/functions/submission-created.mjs', import.meta.url));
  assert.match(src, /dispatchAgentAlerts\(/, 'the intake uses the tested path');
  assert.match(src, /alertOwner: notifyOwner/, 'and wires a real owner alert into it');
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

test('exactly one module anywhere can reach the agent sender, and it is the intake', () => {
  const files = ['../notify.mjs', '../reconcile.mjs', '../store.mjs', '../policy.mjs',
    '../../netlify/functions/lead-sweep.mjs', '../../netlify/functions/lead-admin.mjs',
    '../../netlify/functions/submission-created.mjs'];
  const holders = [];
  for (const f of files) {
    const src = code(new URL(f, import.meta.url));
    // Any mention at all — called, imported, or passed by reference. The sender
    // is now INJECTED into dispatchAgentAlerts, so looking only for a call
    // "notifyAgentsOfNewLead(" would miss a module handing it somewhere else.
    if (/(?<!export async function )\bnotifyAgentsOfNewLead\b/.test(src)) holders.push(f);
  }
  assert.deepEqual(holders, ['../../netlify/functions/submission-created.mjs'],
    'exactly one holder, and it is the authorised intake');
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
