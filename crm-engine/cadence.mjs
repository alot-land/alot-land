/**
 * Follow-up cadence engine.
 *
 * Two rules that exist because of how GHL went wrong:
 *
 *  1. **Enrolment is always explicit.** Nothing here reacts to a form
 *     submission or a contact being created. David puts a person into a
 *     cadence by hand. A trigger firing at the wrong person is the failure
 *     this is designed to make impossible.
 *  2. **A reply cancels everything.** The moment someone answers, the cadence
 *     stops. Nothing is worse than a "just following up!" text arriving after
 *     a real conversation has started.
 *
 * State lives in GHL contact tags, so there is no database and GHL stays the
 * single source of truth:
 *     cadence:<cadenceId>:<enrolledISODate>
 * Progress is derived from the enrolment date, not stored, so a missed run
 * catches up rather than losing its place.
 */

export const TAG_PREFIX = 'cadence:';

export const enrolmentTag = (cadenceId, date) =>
  `${TAG_PREFIX}${cadenceId}:${new Date(date).toISOString().slice(0, 10)}`;

export function parseEnrolment(tags = []) {
  for (const t of tags) {
    if (!String(t).startsWith(TAG_PREFIX)) continue;
    const [, cadenceId, day] = String(t).split(':');
    if (!cadenceId || !day) continue;
    const enrolledAt = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(enrolledAt.getTime())) continue;
    return { tag: t, cadenceId, enrolledAt };
  }
  return null;
}

const daysBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 864e5);

/**
 * What should happen for one contact right now.
 * Returns { action: 'none'|'send'|'task'|'finished'|'cancelled', ... }
 */
export function nextAction({ contact, cadences, lastInboundAt, sentSteps = [] }, now = new Date()) {
  const enrolment = parseEnrolment(contact.tags);
  if (!enrolment) return { action: 'none' };

  const cadence = cadences.find(c => c.id === enrolment.cadenceId);
  if (!cadence) return { action: 'none', reason: 'unknown-cadence' };

  // A human replied after enrolment — stop, and say so.
  if (lastInboundAt && new Date(lastInboundAt) > enrolment.enrolledAt) {
    return { action: 'cancelled', reason: 'they-replied', tag: enrolment.tag, cadenceId: cadence.id };
  }

  const elapsed = daysBetween(enrolment.enrolledAt, now);
  const due = cadence.steps
    .map((s, i) => ({ ...s, index: i }))
    .filter(s => s.day <= elapsed && !sentSteps.includes(s.index));

  if (!due.length) {
    const last = cadence.steps[cadence.steps.length - 1];
    if (elapsed > last.day) return { action: 'finished', tag: enrolment.tag, cadenceId: cadence.id };
    return { action: 'none', nextInDays: Math.min(...cadence.steps.filter(s => s.day > elapsed).map(s => s.day - elapsed)) };
  }

  // Only ever act on ONE step per run, the earliest outstanding one. If a run
  // was missed, this catches up a day at a time instead of firing a backlog
  // of three messages at someone at once.
  const step = due.sort((a, b) => a.day - b.day)[0];

  return {
    action: step.channel === 'call' ? 'task' : 'send',
    cadenceId: cadence.id,
    cadenceName: cadence.name,
    stepIndex: step.index,
    channel: step.channel,
    dayOffset: step.day,
    ...(step.channel === 'call'
      ? { note: step.note }
      : { subject: fill(step.subject, contact), body: fill(step.body, contact) }),
  };
}

export function fill(text, contact) {
  if (!text) return text;
  const first = (contact.name ?? contact.firstName ?? '').trim().split(/\s+/)[0] || 'there';
  return text
    .replace(/\{\{\s*first\s*\}\}/g, first)
    .replace(/\{\{\s*name\s*\}\}/g, (contact.name ?? '').trim() || first);
}
