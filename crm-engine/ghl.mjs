/**
 * GoHighLevel API v2 client.
 *
 * Runs ONLY server-side, inside Netlify Functions. The token is a location-level
 * Private Integration token and must never reach the browser — if you find
 * yourself importing this from anything under src/pages, stop.
 *
 * Env:
 *   GHL_TOKEN        Private Integration token (secret)
 *   GHL_LOCATION_ID  The sub-account this operates on
 *
 * With no token configured every call throws NotConfigured, which the functions
 * turn into a clear "connect GHL" state rather than a stack trace.
 */

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export class NotConfigured extends Error {
  constructor() { super('GHL is not connected yet.'); this.code = 'NOT_CONFIGURED'; }
}
export class GhlError extends Error {
  constructor(status, body, path) {
    super(`GHL ${status} on ${path}: ${String(body).slice(0, 300)}`);
    this.status = status; this.path = path;
  }
}

export function config(env = process.env) {
  return { token: env.GHL_TOKEN, locationId: env.GHL_LOCATION_ID };
}
export function isConfigured(env = process.env) {
  const { token, locationId } = config(env);
  return Boolean(token && locationId);
}

async function call(path, { method = 'GET', body, query, env = process.env } = {}) {
  const { token, locationId } = config(env);
  if (!token || !locationId) throw new NotConfigured();

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) throw new GhlError(res.status, text, path);
  return text ? JSON.parse(text) : {};
}

const loc = (env = process.env) => config(env).locationId;

// ── Reads ──────────────────────────────────────────────────────────────────
export const searchContacts = (opts = {}, env) =>
  call('/contacts/search', {
    method: 'POST', env,
    body: { locationId: loc(env), pageLimit: opts.limit ?? 100, ...(opts.query ? { query: opts.query } : {}) },
  });

export const getContact = (id, env) => call(`/contacts/${id}`, { env });

export const searchConversations = (opts = {}, env) =>
  call('/conversations/search', {
    env,
    query: { locationId: loc(env), limit: opts.limit ?? 100, ...(opts.status ? { status: opts.status } : {}) },
  });

export const getMessages = (conversationId, env, limit = 50) =>
  call(`/conversations/${conversationId}/messages`, { env, query: { limit } });

export const searchOpportunities = (opts = {}, env) =>
  call('/opportunities/search', {
    env,
    query: { location_id: loc(env), limit: opts.limit ?? 100, ...(opts.pipelineId ? { pipeline_id: opts.pipelineId } : {}) },
  });

export const getPipelines = (env) =>
  call('/opportunities/pipelines', { env, query: { locationId: loc(env) } });

export const getAppointments = ({ startTime, endTime, calendarId } = {}, env) =>
  call('/calendars/events', { env, query: { locationId: loc(env), startTime, endTime, calendarId } });

export const getCalendars = (env) => call('/calendars/', { env, query: { locationId: loc(env) } });

export const getNotes = (contactId, env) => call(`/contacts/${contactId}/notes`, { env });

// ── Writes ─────────────────────────────────────────────────────────────────
/** type: 'SMS' | 'Email' */
export const sendMessage = ({ contactId, type, message, subject, html }, env) =>
  call('/conversations/messages', {
    method: 'POST', env,
    body: {
      type, contactId,
      ...(type === 'SMS' ? { message } : {}),
      ...(type === 'Email' ? { subject, html: html ?? message, emailTo: undefined } : {}),
    },
  });

export const addNote = ({ contactId, body, userId }, env) =>
  call(`/contacts/${contactId}/notes`, { method: 'POST', env, body: { body, ...(userId ? { userId } : {}) } });

export const upsertContactTag = ({ contactId, tags }, env) =>
  call(`/contacts/${contactId}/tags`, { method: 'POST', env, body: { tags } });

export const removeContactTag = ({ contactId, tags }, env) =>
  call(`/contacts/${contactId}/tags`, { method: 'DELETE', env, body: { tags } });
