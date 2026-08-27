/**
 * Everything the CRM dashboard needs, in one call.
 *
 * Runs server-side so GHL_TOKEN never reaches the browser. The response is
 * deliberately shaped for the UI — the page does no GHL-specific parsing, which
 * keeps the API's quirks in one file.
 */
import * as ghl from '../../crm-engine/ghl.mjs';
import { triage } from '../../crm-engine/triage.mjs';
import { parseEnrolment } from '../../crm-engine/cadence.mjs';
import cadenceFile from '../../crm-engine/cadences.json' with { type: 'json' };

const ok  = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const err = (status, message, extra = {}) => new Response(JSON.stringify({ error: message, ...extra }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const str = v => (v == null ? '' : String(v));
const pickArray = (o, ...keys) => { for (const k of keys) if (Array.isArray(o?.[k])) return o[k]; return []; };

const name = c => str(c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone).trim();

export default async (req) => {
  if (!ghl.isConfigured()) {
    return ok({
      connected: false,
      message: 'GHL is not connected. Add GHL_TOKEN and GHL_LOCATION_ID in Netlify, then redeploy.',
      today: [], followUp: [], counts: { today: 0, unanswered: 0, newLeads: 0, appointments: 0, followUp: 0 },
      cadences: cadenceFile.cadences.map(({ id, name, for: forWho, steps }) => ({ id, name, for: forWho, steps: steps.length })),
    });
  }

  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 14 * 864e5);
    const back = new Date(now.getTime() - 7 * 864e5);

    const [contactsRes, convRes, oppRes, apptRes, pipelinesRes] = await Promise.all([
      ghl.searchContacts({ limit: 100 }).catch(e => ({ _error: e.message })),
      ghl.searchConversations({ limit: 100 }).catch(e => ({ _error: e.message })),
      ghl.searchOpportunities({ limit: 100 }).catch(e => ({ _error: e.message })),
      ghl.getAppointments({ startTime: back.getTime(), endTime: soon.getTime() }).catch(e => ({ _error: e.message })),
      ghl.getPipelines().catch(e => ({ _error: e.message })),
    ]);

    const contacts = pickArray(contactsRes, 'contacts').map(c => ({
      id: c.id, name: name(c), email: str(c.email), phone: str(c.phone),
      createdAt: c.dateAdded ?? c.createdAt, tags: c.tags ?? [],
      source: str(c.source || c.attributionSource?.utmSessionSource || ''),
      enrolment: parseEnrolment(c.tags ?? []),
    }));

    const conversations = pickArray(convRes, 'conversations').map(c => ({
      id: c.id, contactId: c.contactId,
      lastMessageAt: c.lastMessageDate ?? c.dateUpdated,
      // GHL reports direction of the LAST message; "inbound" means they spoke last.
      lastMessageDirection: str(c.lastMessageDirection).toLowerCase() === 'inbound' ? 'inbound' : 'outbound',
      lastMessageBody: str(c.lastMessageBody),
      unreadCount: c.unreadCount ?? 0,
    }));

    const opportunities = pickArray(oppRes, 'opportunities').map(o => ({
      id: o.id, contactId: o.contact?.id ?? o.contactId, name: str(o.name),
      pipelineId: o.pipelineId, stageName: str(o.pipelineStageName || o.stageName),
      status: str(o.status).toLowerCase(), updatedAt: o.updatedAt ?? o.dateUpdated,
      monetaryValue: o.monetaryValue ?? null,
    }));

    const appointments = pickArray(apptRes, 'events', 'appointments').map(a => ({
      id: a.id, contactId: a.contactId, title: str(a.title),
      startTime: a.startTime, endTime: a.endTime,
      status: str(a.appointmentStatus || a.status),
      calendar: str(a.calendarName || ''),
    }));

    // "Has a human contacted them?" — an outbound message carrying a userId was
    // sent by a person; workflow sends do not carry one. This is the distinction
    // the whole Today list depends on: an automated email is NOT a reply.
    const humanTouches = {};
    const withInbound = conversations.filter(c => c.contactId).slice(0, 40);
    await Promise.all(withInbound.map(async conv => {
      try {
        const res = await ghl.getMessages(conv.id, undefined, 20);
        const msgs = pickArray(res?.messages ?? res, 'messages') .length
          ? pickArray(res?.messages ?? res, 'messages') : pickArray(res, 'messages');
        for (const m of msgs) {
          const outbound = str(m.direction).toLowerCase() === 'outbound';
          if (outbound && m.userId) {
            const at = m.dateAdded ?? m.dateCreated;
            if (!humanTouches[conv.contactId] || new Date(at) > new Date(humanTouches[conv.contactId])) {
              humanTouches[conv.contactId] = at;
            }
          }
        }
      } catch { /* one unreadable conversation must not break the dashboard */ }
    }));

    const result = triage({ contacts, conversations, opportunities, appointments, humanTouches }, now);

    return ok({
      connected: true,
      generatedAt: now.toISOString(),
      ...result,
      pipelines: pickArray(pipelinesRes, 'pipelines').map(p => ({
        id: p.id, name: str(p.name),
        stages: (p.stages ?? []).map(s => ({ id: s.id, name: str(s.name) })),
      })),
      opportunities,
      contacts,
      cadences: cadenceFile.cadences.map(({ id, name, for: forWho, steps }) => ({ id, name, for: forWho, steps: steps.length })),
      warnings: [contactsRes, convRes, oppRes, apptRes, pipelinesRes].map(r => r?._error).filter(Boolean),
    });
  } catch (e) {
    return err(502, 'Could not reach GoHighLevel.', { detail: String(e.message ?? e).slice(0, 300) });
  }
};

export const config = { path: '/api/crm/data' };
