import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triage, REASONS } from '../triage.mjs';

const NOW = new Date('2026-08-27T17:00:00Z');
const ago = h => new Date(NOW.getTime() - h * 36e5).toISOString();
const ahead = h => new Date(NOW.getTime() + h * 36e5).toISOString();

const person = (id, over = {}) => ({ id, name: `P${id}`, email: `${id}@x.com`, phone: '+1615', createdAt: ago(100), ...over });

test('someone waiting on a reply is urgent', () => {
  const r = triage({
    contacts: [person('a')],
    conversations: [{ id: 'c1', contactId: 'a', lastMessageAt: ago(3), lastMessageDirection: 'inbound', lastMessageBody: 'Is lot 4 still open?' }],
    humanTouches: { a: ago(50) },
  }, NOW);
  assert.equal(r.counts.unanswered, 1);
  assert.deepEqual(r.today[0].reasons, [REASONS.UNANSWERED]);
  assert.equal(r.today[0].details.unanswered.waitingHours, 3);
});

test('a reply from David clears it', () => {
  const r = triage({
    contacts: [person('a')],
    conversations: [{ id: 'c1', contactId: 'a', lastMessageAt: ago(3), lastMessageDirection: 'outbound' }],
    humanTouches: { a: ago(3) },
  }, NOW);
  assert.equal(r.counts.today, 0);
});

test('a new lead is urgent, and automation does NOT count as contact', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(2), source: 'Sell Your Land - Cash Offer Request' })],
    conversations: [{ id: 'c1', contactId: 'a', lastMessageAt: ago(1), lastMessageDirection: 'outbound' }],
    humanTouches: {},           // automation sent something; no human did
  }, NOW);
  assert.equal(r.counts.newLeads, 1, 'an automated email must not mark a lead as handled');
  assert.equal(r.today[0].details['new-lead'].source, 'Sell Your Land - Cash Offer Request');
});

test('a lead David has actually contacted drops off', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(5) })],
    humanTouches: { a: ago(4) },
  }, NOW);
  assert.equal(r.counts.today, 0);
});

test('new lead older than a day is flagged overdue', () => {
  const r = triage({ contacts: [person('a', { createdAt: ago(30) })], humanTouches: {} }, NOW);
  assert.equal(r.today[0].details['new-lead'].overdue, true);
});

test('appointment inside 48h is urgent; beyond it is not', () => {
  const near = triage({ contacts: [person('a')], humanTouches: { a: ago(1) },
    appointments: [{ id: 'ap1', contactId: 'a', title: 'Showing', startTime: ahead(20), status: 'confirmed' }] }, NOW);
  assert.equal(near.counts.appointments, 1);
  const far = triage({ contacts: [person('a')], humanTouches: { a: ago(1) },
    appointments: [{ id: 'ap1', contactId: 'a', title: 'Showing', startTime: ahead(200), status: 'confirmed' }] }, NOW);
  assert.equal(far.counts.appointments, 0);
});

test('a passed appointment with no outcome comes back as urgent', () => {
  const r = triage({ contacts: [person('a')], humanTouches: { a: ago(1) },
    appointments: [{ id: 'ap1', contactId: 'a', title: 'Consult', startTime: ago(5), status: 'confirmed' }] }, NOW);
  assert.equal(r.counts.appointments, 1);
  assert.equal(r.today[0].details.appointment.needsOutcome, true);
});

test('a passed appointment already marked showed is done', () => {
  const r = triage({ contacts: [person('a')], humanTouches: { a: ago(1) },
    appointments: [{ id: 'ap1', contactId: 'a', title: 'Consult', startTime: ago(5), status: 'showed' }] }, NOW);
  assert.equal(r.counts.today, 0);
});

test('gone quiet goes to Follow-up, never to Today', () => {
  const r = triage({
    // created long ago and contacted since — an established lead, not a new one
    contacts: [person('a', { createdAt: ago(24 * 40) })], humanTouches: { a: ago(24 * 12) },
    opportunities: [{ id: 'o1', contactId: 'a', name: 'Lot 4', stageName: 'Offer Out', status: 'open', updatedAt: ago(24 * 12), monetaryValue: 79000 }],
  }, NOW);
  assert.equal(r.counts.today, 0, 'quiet must not pollute the urgent list');
  assert.equal(r.counts.followUp, 1);
  assert.equal(r.followUp[0].details.quiet.quietDays, 12);
  assert.equal(r.followUp[0].details.quiet.stage, 'Offer Out');
});

test('a won or lost deal is not chased', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(24 * 60) })], humanTouches: { a: ago(24 * 30) },
    opportunities: [{ id: 'o1', contactId: 'a', stageName: 'Closed', status: 'won', updatedAt: ago(24 * 30) }],
  }, NOW);
  assert.equal(r.counts.followUp, 0);
});

test('someone urgent today is not also listed as quiet', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(24 * 40) })], humanTouches: { a: ago(24 * 20) },
    conversations: [{ id: 'c1', contactId: 'a', lastMessageAt: ago(2), lastMessageDirection: 'inbound' }],
    opportunities: [{ id: 'o1', contactId: 'a', stageName: 'Offer Out', status: 'open', updatedAt: ago(24 * 20) }],
  }, NOW);
  assert.equal(r.counts.today, 1);
  assert.equal(r.counts.followUp, 0, 'no one should appear in two lists');
});

test('ordering: waiting-on-a-reply outranks new leads and appointments', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(2) }), person('b'), person('c')],
    conversations: [{ id: 'c1', contactId: 'b', lastMessageAt: ago(1), lastMessageDirection: 'inbound' }],
    appointments: [{ id: 'ap', contactId: 'c', startTime: ahead(4), title: 'Showing', status: 'confirmed' }],
    humanTouches: { b: ago(9), c: ago(9) },
  }, NOW);
  assert.deepEqual(r.today.map(i => i.contact.id), ['b', 'a', 'c']);
});

test('one person with several problems appears once, with all reasons', () => {
  const r = triage({
    contacts: [person('a', { createdAt: ago(2) })],
    conversations: [{ id: 'c1', contactId: 'a', lastMessageAt: ago(1), lastMessageDirection: 'inbound' }],
    appointments: [{ id: 'ap', contactId: 'a', startTime: ahead(6), title: 'Showing', status: 'confirmed' }],
    humanTouches: {},
  }, NOW);
  assert.equal(r.today.length, 1);
  assert.equal(r.today[0].reasons.length, 3);
});

test('empty data does not throw', () => {
  const r = triage({}, NOW);
  assert.equal(r.counts.today, 0);
  assert.equal(r.counts.followUp, 0);
});

test('a conversation for an unknown contact is ignored, not crashed on', () => {
  const r = triage({ contacts: [], conversations: [{ id: 'c1', contactId: 'ghost', lastMessageAt: ago(1), lastMessageDirection: 'inbound' }] }, NOW);
  assert.equal(r.counts.today, 0);
});
