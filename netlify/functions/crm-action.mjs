/**
 * The write side: send a text or email, save a note, start or stop a follow-up.
 *
 * Every send is something David pressed. Nothing in this file fires on a
 * trigger — the scheduled cadence runner is the only automated sender, and it
 * stops the moment anyone replies.
 */
import * as ghl from '../../crm-engine/ghl.mjs';
import { enrolmentTag, parseEnrolment } from '../../crm-engine/cadence.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!ghl.isConfigured()) return json(503, { error: 'GHL is not connected yet.' });

  let payload;
  try { payload = await req.json(); } catch { return json(400, { error: 'Body must be JSON.' }); }

  const { action, contactId } = payload ?? {};
  if (!contactId) return json(400, { error: 'contactId is required.' });

  try {
    switch (action) {
      case 'sms': {
        const message = String(payload.message ?? '').trim();
        if (!message) return json(400, { error: 'Message is empty.' });
        const res = await ghl.sendMessage({ contactId, type: 'SMS', message });
        return json(200, { ok: true, sent: 'sms', id: res?.messageId ?? null });
      }
      case 'email': {
        const subject = String(payload.subject ?? '').trim();
        const message = String(payload.message ?? '').trim();
        if (!subject) return json(400, { error: 'Email needs a subject.' });
        if (!message) return json(400, { error: 'Message is empty.' });
        const res = await ghl.sendMessage({
          contactId, type: 'Email', subject,
          html: message.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''),
        });
        return json(200, { ok: true, sent: 'email', id: res?.messageId ?? null });
      }
      case 'note': {
        const body = String(payload.body ?? '').trim();
        if (!body) return json(400, { error: 'Note is empty.' });
        await ghl.addNote({ contactId, body });
        return json(200, { ok: true, saved: 'note' });
      }
      case 'enrol': {
        const cadenceId = String(payload.cadenceId ?? '');
        if (!cadenceId) return json(400, { error: 'cadenceId is required.' });
        const contact = await ghl.getContact(contactId);
        const existing = parseEnrolment(contact?.contact?.tags ?? []);
        if (existing) await ghl.removeContactTag({ contactId, tags: [existing.tag] });
        await ghl.upsertContactTag({ contactId, tags: [enrolmentTag(cadenceId, new Date())] });
        return json(200, { ok: true, enrolled: cadenceId });
      }
      case 'unenrol': {
        const contact = await ghl.getContact(contactId);
        const existing = parseEnrolment(contact?.contact?.tags ?? []);
        if (existing) await ghl.removeContactTag({ contactId, tags: [existing.tag] });
        return json(200, { ok: true, stopped: existing?.cadenceId ?? null });
      }
      case 'history': {
        const [contact, notes] = await Promise.all([
          ghl.getContact(contactId).catch(() => null),
          ghl.getNotes(contactId).catch(() => ({ notes: [] })),
        ]);
        let messages = [];
        if (payload.conversationId) {
          const res = await ghl.getMessages(payload.conversationId, undefined, 50).catch(() => null);
          const raw = res?.messages?.messages ?? res?.messages ?? [];
          messages = (Array.isArray(raw) ? raw : []).map(m => ({
            id: m.id,
            direction: String(m.direction ?? '').toLowerCase(),
            type: String(m.messageType ?? m.type ?? ''),
            body: String(m.body ?? m.message ?? ''),
            subject: String(m.subject ?? ''),
            at: m.dateAdded ?? m.dateCreated,
            // No userId on an outbound message means a workflow sent it, not a person.
            byAutomation: String(m.direction ?? '').toLowerCase() === 'outbound' && !m.userId,
          })).sort((a, b) => new Date(a.at) - new Date(b.at));
        }
        return json(200, {
          ok: true,
          contact: contact?.contact ?? null,
          notes: (notes?.notes ?? []).map(n => ({ id: n.id, body: n.body, at: n.dateAdded ?? n.createdAt })),
          messages,
        });
      }
      default:
        return json(400, { error: `Unknown action "${action}".` });
    }
  } catch (e) {
    return json(502, { error: 'GoHighLevel rejected that.', detail: String(e.message ?? e).slice(0, 300) });
  }
};

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const config = { path: '/api/crm/action' };
