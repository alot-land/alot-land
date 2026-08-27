/**
 * Decides what needs David today, and what has gone quiet.
 *
 * Deliberately pure: it takes already-fetched data and returns lists. That
 * means the rules can be tested exactly, without the API, and the rules are the
 * part most likely to need tuning once real volume arrives.
 *
 * His three "urgent" rules, in his words:
 *   new lead · unanswered inbound message · upcoming appointment
 * Anything gone quiet is NOT urgent — it goes to Follow-up, a separate list, so
 * the urgent list stays short enough to actually clear.
 */

export const REASONS = {
  UNANSWERED: 'unanswered',
  NEW_LEAD:   'new-lead',
  APPOINTMENT: 'appointment',
  QUIET:      'quiet',
};

export const DEFAULTS = {
  newLeadHours: 24,        // uncontacted this long = still "new", show it
  appointmentHours: 48,    // booked within this window = urgent
  quietDays: 7,            // no contact this long on an open deal = follow up
  staleAppointmentHours: 2 // passed this long ago with no outcome = urgent
};

const hours = ms => ms / 36e5;
const days  = ms => ms / 864e5;

/**
 * @param {object} data
 *   contacts[]      { id, name, email, phone, createdAt, tags[], source }
 *   conversations[] { id, contactId, lastMessageAt, lastMessageDirection, lastMessageBody, unreadCount }
 *   appointments[]  { id, contactId, title, startTime, endTime, status }
 *   opportunities[] { id, contactId, name, pipelineId, stageName, status, updatedAt, monetaryValue }
 *   humanTouches    { [contactId]: isoString }  last OUTBOUND message from a person
 * @param {Date} now
 */
export function triage(data, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const t = now.getTime();

  const contacts = new Map((data.contacts ?? []).map(c => [c.id, c]));
  const convByContact = new Map();
  for (const c of data.conversations ?? []) {
    const prev = convByContact.get(c.contactId);
    if (!prev || new Date(c.lastMessageAt) > new Date(prev.lastMessageAt)) convByContact.set(c.contactId, c);
  }
  const oppByContact = new Map();
  for (const op of data.opportunities ?? []) {
    if (op.status && op.status !== 'open') continue;
    oppByContact.set(op.contactId, op);
  }

  const items = new Map(); // contactId → { contact, reasons[], sortAt, ... }
  const add = (contactId, reason, at, detail) => {
    const contact = contacts.get(contactId);
    if (!contact) return;
    const cur = items.get(contactId) ?? { contact, reasons: [], details: {}, sortAt: at };
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    cur.details[reason] = detail;
    // Sort by the most urgent (earliest) thing on the card.
    if (at && (!cur.sortAt || new Date(at) < new Date(cur.sortAt))) cur.sortAt = at;
    items.set(contactId, cur);
  };

  // 1. Unanswered inbound — someone is waiting on a human.
  for (const [contactId, conv] of convByContact) {
    if (conv.lastMessageDirection !== 'inbound') continue;
    add(contactId, REASONS.UNANSWERED, conv.lastMessageAt, {
      waitingHours: Math.max(0, Math.round(hours(t - new Date(conv.lastMessageAt).getTime()))),
      preview: (conv.lastMessageBody ?? '').slice(0, 140),
      conversationId: conv.id,
    });
  }

  // 2. New lead with no HUMAN outreach yet. Automated sends do not count —
  //    that is the entire point: a nurture email is not a reply.
  for (const c of data.contacts ?? []) {
    const created = new Date(c.createdAt).getTime();
    if (!Number.isFinite(created)) continue;
    const touched = data.humanTouches?.[c.id];
    if (touched && new Date(touched).getTime() >= created) continue;
    const ageH = hours(t - created);
    if (ageH < 0) continue;
    add(c.id, REASONS.NEW_LEAD, c.createdAt, {
      ageHours: Math.round(ageH),
      source: c.source ?? 'unknown',
      overdue: ageH > o.newLeadHours,
    });
  }

  // 3. Appointments — coming up soon, or passed with no outcome recorded.
  for (const a of data.appointments ?? []) {
    const start = new Date(a.startTime).getTime();
    if (!Number.isFinite(start)) continue;
    const inH = hours(start - t);
    const upcoming = inH >= 0 && inH <= o.appointmentHours;
    const needsOutcome = inH < 0 && hours(t - start) > o.staleAppointmentHours
      && !['showed', 'noshow', 'cancelled', 'invalid'].includes(String(a.status ?? '').toLowerCase());
    if (!upcoming && !needsOutcome) continue;
    add(a.contactId, REASONS.APPOINTMENT, a.startTime, {
      title: a.title, startTime: a.startTime,
      inHours: Math.round(inH),
      needsOutcome, status: a.status ?? null,
    });
  }

  const today = [...items.values()].sort(byUrgency);

  // 4. Gone quiet — separate list, never mixed into today.
  const followUp = [];
  for (const [contactId, opp] of oppByContact) {
    if (items.has(contactId)) continue;         // already needs attention today
    const conv = convByContact.get(contactId);
    const last = data.humanTouches?.[contactId] ?? conv?.lastMessageAt ?? opp.updatedAt;
    const quietDays = days(t - new Date(last).getTime());
    if (!(quietDays >= o.quietDays)) continue;
    const contact = contacts.get(contactId);
    if (!contact) continue;
    followUp.push({
      contact, reasons: [REASONS.QUIET],
      details: { [REASONS.QUIET]: {
        quietDays: Math.round(quietDays),
        stage: opp.stageName, value: opp.monetaryValue ?? null,
      } },
      sortAt: last,
    });
  }
  followUp.sort((a, b) => new Date(a.sortAt) - new Date(b.sortAt)); // longest quiet first

  return { today, followUp, counts: {
    today: today.length,
    unanswered: today.filter(i => i.reasons.includes(REASONS.UNANSWERED)).length,
    newLeads:   today.filter(i => i.reasons.includes(REASONS.NEW_LEAD)).length,
    appointments: today.filter(i => i.reasons.includes(REASONS.APPOINTMENT)).length,
    followUp: followUp.length,
  }};
}

// A person waiting on a reply outranks a new lead, which outranks an
// appointment reminder. Within the same reason, oldest first.
const RANK = { [REASONS.UNANSWERED]: 0, [REASONS.NEW_LEAD]: 1, [REASONS.APPOINTMENT]: 2 };
function byUrgency(a, b) {
  const ra = Math.min(...a.reasons.map(r => RANK[r] ?? 9));
  const rb = Math.min(...b.reasons.map(r => RANK[r] ?? 9));
  if (ra !== rb) return ra - rb;
  return new Date(a.sortAt) - new Date(b.sortAt);
}
