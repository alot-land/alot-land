import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTestLead } from '../lead.mjs';

const SWEEP = readFileSync(new URL('../../netlify/functions/lead-sweep.mjs', import.meta.url), 'utf8');
const NOTIFY = readFileSync(new URL('../notify.mjs', import.meta.url), 'utf8');

test('a synthetic record is recognised', () => {
  for (const n of ['TEST Log Probe', 'TEST — please ignore', 'TEST LEAD — Dana Whitfield', 'test user'])
    assert.equal(isTestLead({ name: n }), true, n);
  assert.equal(isTestLead({ name: 'Dana', test: true }), true, 'explicit flag');
});

test('a real buyer is NEVER mistaken for a test', () => {
  for (const n of ['Dana Whitfield', 'Marcus Ellery', 'Testa Rossa', 'Protest Organiser', 'Tess Harding'])
    assert.equal(isTestLead({ name: n }), false, n);
  // The message body is never consulted — a buyer may legitimately write this.
  assert.equal(isTestLead({ name: 'Priya Raman', message: 'this is a test of the soil, is it clay?' }), false);
});

test('THE P0: the scheduled sweep sends no email or SMS at all', () => {
  for (const banned of ['escalate(', 'sendReport(', 'notifyAll(', 'retryFailures(']) {
    assert.ok(!SWEEP.includes(banned), `lead-sweep must not call ${banned} — that is how Tony got mailed`);
  }
  assert.ok(!/from '\.\.\/\.\.\/lead-engine\/notify\.mjs'/.test(SWEEP),
    'lead-sweep must not import the notifier at all');
});

test('the sweep runs daily, not hourly', () => {
  const m = SWEEP.match(/schedule:\s*'([^']+)'/);
  assert.ok(m, 'a schedule is declared');
  assert.notEqual(m[1], '0 * * * *', 'hourly is what made it a stream of noise');
  assert.match(m[1], /^\d+\s+\d+\s+\*\s+\*\s+\*$/, 'once a day at a fixed hour');
});

test('escalation reaches the owner only — never a listing agent', () => {
  const fn = NOTIFY.slice(NOTIFY.indexOf('export async function escalate'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(/const to = \[\.\.\.r\.owner\]/.test(body), 'owner only');
  assert.ok(!/r\.agents/.test(body), 'escalation must not include agents');
});

test('the daily report goes to the owner only', () => {
  const fn = NOTIFY.slice(NOTIFY.indexOf('export async function sendReport'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(!/r\.agents/.test(body), 'reports must not reach agents');
});

test('new-lead alerts still reach the agents — that is the one message allowed', () => {
  const fn = NOTIFY.slice(NOTIFY.indexOf('export async function notifyAll'));
  const body = fn.slice(0, fn.indexOf('\n  return attempts;'));
  assert.ok(/\[\.\.\.r\.owner, \.\.\.r\.agents\]/.test(body),
    'a genuine new buyer lead must still notify David, Tony and Ryan');
  assert.ok(/isTestLead\(lead\)/.test(body), 'guarded against synthetic records');
});
