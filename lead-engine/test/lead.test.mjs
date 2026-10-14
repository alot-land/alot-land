import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validate, normalisePhone, normaliseEmail, dedupeKey, looksLikeSpam,
  newLead, applyStage, isUnacknowledged, isOverdue, businessMinutesBetween, STAGES,
} from '../lead.mjs';

const base = { name: 'Dana Whitfield', phone: '(615) 555-0188', email: 'Dana@Example.com ', lot: 'sugar-tree-vista-4-whitetail-view', consent: true, renderedAt: Date.now() - 9000 };

test('phone normalises to one stable form', () => {
  for (const v of ['6155550188', '(615) 555-0188', '615-555-0188', '+1 615 555 0188', '1-615-555-0188'])
    assert.equal(normalisePhone(v), '+16155550188', v);
  assert.equal(normalisePhone('555-0188'), null);
  assert.equal(normalisePhone('015 555 0188'), null, 'invalid area code');
});

test('email lowercases and trims; obvious nonsense rejected', () => {
  assert.equal(normaliseEmail(' Dana@Example.COM '), 'dana@example.com');
  assert.equal(normaliseEmail('dana@example'), null);
  assert.equal(normaliseEmail('not an email'), null);
});

test('a real submission validates', () => {
  const r = validate(base);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.value.phone, '+16155550188');
  assert.equal(r.value.email, 'dana@example.com');
});

test('either phone OR email is enough — never demand both', () => {
  assert.ok(validate({ ...base, email: '' }).ok);
  assert.ok(validate({ ...base, phone: '' }).ok);
  const neither = validate({ ...base, phone: '', email: '' });
  assert.equal(neither.ok, false);
  assert.ok(neither.errors.contact);
});

test('consent is required and recorded', () => {
  const r = validate({ ...base, consent: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.consent);
});

test('missing lot is rejected — a lead with no lot is useless', () => {
  assert.equal(validate({ ...base, lot: '' }).ok, false);
});

test('dedupe key is the same person about the same lot', () => {
  const a = dedupeKey({ lot: 'lot4', phone: '+16155550188', email: 'dana@example.com' });
  const b = dedupeKey({ lot: 'lot4', phone: '+16155550188', email: 'other@example.com' });
  assert.equal(a, b, 'phone wins, so a typo in email is still the same person');
  assert.notEqual(a, dedupeKey({ lot: 'lot7', phone: '+16155550188' }), 'different lot is a different lead');
  assert.equal(dedupeKey({ lot: 'lot4' }), null, 'no contact method = no key');
  assert.equal(dedupeKey({ lot: 'lot4', email: 'dana@example.com' }), 'lot4::e:dana@example.com');
});

test('spam traps catch bots without catching people', () => {
  assert.equal(looksLikeSpam(base), null, 'a real submission passes');
  assert.equal(looksLikeSpam({ ...base, company: 'Acme' }), 'honeypot');
  assert.equal(looksLikeSpam({ ...base, renderedAt: Date.now() - 200 }), 'too-fast');
  assert.equal(looksLikeSpam({ ...base, message: 'check http://spam.ru' }), 'link-in-text');
  assert.equal(looksLikeSpam({ ...base, message: 'Is there road frontage on the north side?' }), null,
    'a genuine detailed question must never be flagged');
});

test('a new lead carries consent evidence and starts at new', () => {
  const l = newLead({ id: 'abc', value: validate(base).value, attribution: { utm_source: 'facebook' }, meta: { lotName: 'Whitetail Ridge', consentText: 'I agree…' } });
  assert.equal(l.stage, 'new');
  assert.equal(l.consent.given, true);
  assert.ok(l.consent.at);
  assert.equal(l.consent.text, 'I agree…');
  assert.equal(l.attribution.utm_source, 'facebook');
  assert.equal(l.history.length, 1);
});

test('stage changes are recorded with who and when', () => {
  const l = newLead({ id: 'abc', value: validate(base).value });
  const after = applyStage(l, { stage: 'contacted', by: 'tony@example.com', note: 'left voicemail' });
  assert.equal(after.stage, 'contacted');
  const h = after.history.at(-1);
  assert.equal(h.by, 'tony@example.com');
  assert.equal(h.from, 'new');
  assert.equal(h.to, 'contacted');
  assert.equal(h.note, 'left voicemail');
  assert.equal(l.stage, 'new', 'original is not mutated');
});

test('an unknown stage is refused rather than silently stored', () => {
  const l = newLead({ id: 'abc', value: validate(base).value });
  assert.throws(() => applyStage(l, { stage: 'nonsense', by: 'x' }));
  assert.equal(STAGES.length, 10);
});

test('escalation counts business hours, not wall-clock', () => {
  // 11pm Tuesday → 7am Wednesday is eight hours of clock, zero of business time.
  const night = new Date('2026-10-13T23:00:00');
  const morning = new Date('2026-10-14T07:00:00');
  assert.equal(businessMinutesBetween(night, morning, { start: 8, end: 20 }), 0);
  const l = newLead({ id: 'a', value: validate(base).value, now: night });
  assert.equal(isUnacknowledged(l, { now: morning }), false, 'nobody is late for an overnight lead');
  const later = new Date('2026-10-14T09:30:00');
  assert.equal(isUnacknowledged(l, { now: later }), true, '90 business minutes in, it is late');
});

test('acknowledging stops the alarm', () => {
  const created = new Date('2026-10-13T09:00:00');
  const l = applyStage(newLead({ id: 'a', value: validate(base).value, now: created }), { stage: 'contacted', by: 'tony' });
  assert.equal(isUnacknowledged(l, { now: new Date('2026-10-13T17:00:00') }), false);
});

test('overdue flags only leads nobody has actually contacted', () => {
  const created = new Date('2026-10-12T09:00:00');
  const now = new Date('2026-10-13T12:00:00');
  const untouched = newLead({ id: 'a', value: validate(base).value, now: created });
  assert.equal(isOverdue(untouched, { now }), true);
  const called = applyStage(untouched, { stage: 'contacted', by: 'tony' });
  assert.equal(isOverdue(called, { now }), false);
  const lost = applyStage(untouched, { stage: 'lost', by: 'david' });
  assert.equal(isOverdue(lost, { now }), false, 'a dead lead is not chased');
});
