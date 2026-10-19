/**
 * The lead record, and the rules about it.
 *
 * Pure functions only — no network, no storage. That keeps the rules that
 * decide "is this a duplicate", "is this overdue", "what may change" testable
 * exactly, which is the part that must not be wrong when money is going into
 * advertising.
 */

export const STAGES = [
  'new', 'acknowledged', 'contacted', 'qualified',
  'showing_requested', 'showing_scheduled', 'offer', 'under_contract', 'closed', 'lost',
];

export const STAGE_LABEL = {
  new: 'New', acknowledged: 'Acknowledged', contacted: 'Contacted', qualified: 'Qualified',
  showing_requested: 'Showing requested', showing_scheduled: 'Showing scheduled',
  offer: 'Offer', under_contract: 'Under contract', closed: 'Closed', lost: 'Lost',
};

/** Stages that mean a human has engaged — these stop the no-acknowledgement alarm. */
export const ACKNOWLEDGED_STAGES = new Set([
  'acknowledged', 'contacted', 'qualified', 'showing_requested',
  'showing_scheduled', 'offer', 'under_contract', 'closed', 'lost',
]);

/** Stages where chasing is pointless. */
export const CLOSED_STAGES = new Set(['closed', 'lost']);

export const INQUIRY_TYPES = {
  details: 'Requested property details',
  showing: 'Requested a showing',
  packet:  'Downloaded the buyer packet',
  question: 'Asked a question',
};

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = v => String(v ?? '').replace(/[^0-9]/g, '');

/** US phone → E.164, or null. Used for the dedupe key, so it must be stable. */
export function normalisePhone(raw) {
  let d = digits(raw);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  if (d[0] === '0' || d[0] === '1') return null;      // invalid US area code
  return '+1' + d;
}

export function normaliseEmail(raw) {
  const e = clean(raw, 160).toLowerCase();
  // Deliberately permissive: rejecting a real buyer's address is far worse than
  // storing an odd one. This only catches obvious nonsense.
  return /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(e) ? e : null;
}

export function validate(input) {
  const errors = {};
  const name = clean(input.name, 80);
  const phone = normalisePhone(input.phone);
  const email = normaliseEmail(input.email);
  const lot = clean(input.lot, 80);

  if (name.length < 2) errors.name = 'Please give us a name.';
  if (!phone && !email) errors.contact = 'We need a phone number or an email so we can reply.';
  if (input.phone && !phone) errors.phone = 'That does not look like a 10-digit US number.';
  if (input.email && !email) errors.email = 'That email address looks incomplete.';
  if (!lot) errors.lot = 'Missing which lot this is about.';
  if (!input.consent) errors.consent = 'Please tick the box so we may contact you.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name, phone, email, lot,
      inquiryType: INQUIRY_TYPES[input.inquiryType] ? input.inquiryType : 'details',
      message: clean(input.message, 1000),
      consent: Boolean(input.consent),
    },
  };
}

/**
 * Dedupe key: the same person asking about the same lot.
 *
 * Phone first because it is the identifier people type consistently; email as
 * fallback. Deliberately NOT time-boxed here — the caller decides the window,
 * so a second enquiry three weeks later can still be treated as new.
 */
export function dedupeKey({ lot, phone, email }) {
  const who = phone || (email ? 'e:' + email : null);
  return who ? `${lot}::${who}` : null;
}

/** Hidden fields a bot fills in and a person never sees. */
export function looksLikeSpam(input) {
  if (clean(input.company, 100)) return 'honeypot';          // hidden field, must stay empty
  const started = Number(input.renderedAt);
  if (Number.isFinite(started) && Date.now() - started < 2500) return 'too-fast';
  const text = `${input.name} ${input.message}`.toLowerCase();
  if (/\b(https?:\/\/|www\.)/.test(text)) return 'link-in-text';
  if (/\b(crypto|seo services|backlink|viagra|casino)\b/.test(text)) return 'spam-terms';
  return null;
}

export function newLead({ id, value, attribution, meta, now = new Date() }) {
  const ts = now.toISOString();
  return {
    id,
    createdAt: ts,
    updatedAt: ts,
    stage: 'new',
    assignedTo: meta?.assignedTo ?? 'tony',
    name: value.name,
    phone: value.phone,
    email: value.email,
    lot: value.lot,
    lotName: meta?.lotName ?? '',
    lotPrice: meta?.lotPrice ?? '',
    inquiryType: value.inquiryType,
    message: value.message,
    // Consent evidence, kept for the life of the record.
    consent: { given: value.consent, at: ts, text: meta?.consentText ?? '', ip: meta?.ipHash ?? null },
    attribution: attribution ?? {},
    source: meta?.source ?? 'website',
    notifications: [],      // { channel, to, at, status, error }
    acknowledgement: null,  // buyer auto-reply attempt
    history: [{ at: ts, by: 'system', action: 'created', to: 'new' }],
    flags: [],
  };
}

/** Has nobody picked this up in time? Business hours only. */
export function isUnacknowledged(lead, { now = new Date(), minutes = 60, hours = { start: 8, end: 20 } } = {}) {
  if (ACKNOWLEDGED_STAGES.has(lead.stage)) return false;
  const created = new Date(lead.createdAt);
  const elapsed = businessMinutesBetween(created, now, hours);
  return elapsed >= minutes;
}

/** No recorded human contact after a day. */
export function isOverdue(lead, { now = new Date(), hours = 24 } = {}) {
  if (CLOSED_STAGES.has(lead.stage)) return false;
  const contacted = lead.history.some(h => h.action === 'stage' && ['contacted', 'qualified', 'showing_scheduled', 'offer', 'under_contract'].includes(h.to));
  if (contacted) return false;
  return (now - new Date(lead.createdAt)) / 36e5 >= hours;
}

/**
 * Minutes between two instants, counting only configured operating hours.
 * A lead arriving at 11pm must not be "overdue" by 7am.
 */
export function businessMinutesBetween(from, to, { start = 8, end = 20 } = {}) {
  if (to <= from) return 0;
  let mins = 0;
  const cur = new Date(from);
  cur.setSeconds(0, 0);
  while (cur < to) {
    const h = cur.getHours();
    if (h >= start && h < end) mins++;
    cur.setMinutes(cur.getMinutes() + 1);
    if (mins > 60 * 24 * 30) break;             // safety valve
  }
  return mins;
}

export function applyStage(lead, { stage, by, note, now = new Date() }) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  const ts = now.toISOString();
  return {
    ...lead,
    stage,
    updatedAt: ts,
    history: [...lead.history, { at: ts, by, action: 'stage', from: lead.stage, to: stage, ...(note ? { note } : {}) }],
  };
}
