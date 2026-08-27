import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAction, enrolmentTag, parseEnrolment, fill } from '../cadence.mjs';

const cadences = [{
  id: 'seller-followup', name: 'Seller follow-up',
  steps: [
    { day: 0, channel: 'sms', body: 'Hi {{first}} — checking in.' },
    { day: 2, channel: 'call', note: 'First call attempt.' },
    { day: 4, channel: 'email', subject: 'Your land', body: 'Hi {{first}},\n\nDetails?' },
  ],
}];
const NOW = new Date('2026-08-27T17:00:00Z');
const daysAgo = d => new Date(NOW.getTime() - d * 864e5);
const person = (tags, over = {}) => ({ id: 'a', name: 'Jane Fielding', tags, ...over });

test('nobody is enrolled unless a tag says so', () => {
  assert.equal(nextAction({ contact: person([]), cadences }, NOW).action, 'none');
  assert.equal(nextAction({ contact: person(['lead', 'seller']), cadences }, NOW).action, 'none');
});

test('enrolment tag round-trips', () => {
  const tag = enrolmentTag('seller-followup', daysAgo(3));
  const parsed = parseEnrolment(['other', tag]);
  assert.equal(parsed.cadenceId, 'seller-followup');
  assert.equal(parsed.enrolledAt.toISOString().slice(0, 10), daysAgo(3).toISOString().slice(0, 10));
});

test('day 0 step sends immediately on enrolment', () => {
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', NOW)]), cadences }, NOW);
  assert.equal(r.action, 'send');
  assert.equal(r.channel, 'sms');
  assert.equal(r.body, 'Hi Jane — checking in.', 'first name is filled in');
});

test('a call step becomes a task, never an automatic dial', () => {
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', daysAgo(2))]), cadences, sentSteps: [0] }, NOW);
  assert.equal(r.action, 'task');
  assert.equal(r.channel, 'call');
  assert.equal(r.note, 'First call attempt.');
});

test('THE important one: any reply cancels the whole cadence', () => {
  const r = nextAction({
    contact: person([enrolmentTag('seller-followup', daysAgo(3))]),
    cadences, sentSteps: [0], lastInboundAt: daysAgo(1),
  }, NOW);
  assert.equal(r.action, 'cancelled');
  assert.equal(r.reason, 'they-replied');
});

test('a reply from BEFORE enrolment does not cancel it', () => {
  const r = nextAction({
    contact: person([enrolmentTag('seller-followup', daysAgo(2))]),
    cadences, sentSteps: [0], lastInboundAt: daysAgo(10),
  }, NOW);
  assert.equal(r.action, 'task');
});

test('a step already sent is never sent twice', () => {
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', NOW)]), cadences, sentSteps: [0] }, NOW);
  assert.equal(r.action, 'none');
});

test('a missed run catches up ONE step at a time, not a burst', () => {
  // Enrolled 10 days ago, nothing ever sent: all three steps are overdue.
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', daysAgo(10))]), cadences, sentSteps: [] }, NOW);
  assert.equal(r.stepIndex, 0, 'must start at the earliest outstanding step');
  const r2 = nextAction({ contact: person([enrolmentTag('seller-followup', daysAgo(10))]), cadences, sentSteps: [0] }, NOW);
  assert.equal(r2.stepIndex, 1);
});

test('nothing fires before its day', () => {
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', daysAgo(1))]), cadences, sentSteps: [0] }, NOW);
  assert.equal(r.action, 'none');
  assert.equal(r.nextInDays, 1);
});

test('the cadence reports finished once past the last step', () => {
  const r = nextAction({ contact: person([enrolmentTag('seller-followup', daysAgo(9))]), cadences, sentSteps: [0,1,2] }, NOW);
  assert.equal(r.action, 'finished');
});

test('an unknown cadence id does nothing rather than throwing', () => {
  const r = nextAction({ contact: person([enrolmentTag('deleted-cadence', NOW)]), cadences }, NOW);
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'unknown-cadence');
});

test('a contact with no name still gets a usable greeting', () => {
  assert.equal(fill('Hi {{first}} —', { name: '' }), 'Hi there —');
});

test('every shipped cadence parses and fills without throwing', async () => {
  const { cadences: real } = JSON.parse(
    await (await import('node:fs/promises')).readFile(new URL('../cadences.json', import.meta.url), 'utf8'));
  for (const c of real) {
    assert.ok(c.steps.length, `${c.id} has steps`);
    let prev = -1;
    for (const s of c.steps) {
      assert.ok(s.day >= prev, `${c.id} steps must be in day order`);
      prev = s.day;
      assert.ok(['sms', 'email', 'call'].includes(s.channel), `${c.id} channel ${s.channel} is valid`);
      if (s.channel === 'email') assert.ok(s.subject, `${c.id} email step needs a subject`);
      if (s.channel !== 'call') assert.ok(s.body, `${c.id} ${s.channel} step needs a body`);
      const filled = fill(s.body ?? '', { name: 'Jane Fielding' });
      assert.ok(!/\{\{/.test(filled), `${c.id} step has an unfilled placeholder`);
    }
  }
});
