#!/usr/bin/env node
/**
 * Weekly SEO metrics collector.
 *
 * Appends one dated record to seo-engine/history.json so progress is a trend
 * you can look at, not a number someone quotes once. Runs with no AI — it is
 * pure API calls and arithmetic, so it is cheap (~$0.10/week) and predictable.
 *
 * Reads DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD from the environment.
 * Locally:  set -a; . ~/.config/goldstone/dataforseo.env; set +a; node seo-engine/collect-metrics.mjs
 * In CI:    provided by repo secrets.
 *
 * Two hard-won details, both of which silently produce zeros if ignored:
 *   1. `aggregated_metrics` is an object of ARRAYS, each entry keyed by `key`.
 *      Treating it as nested objects returns 0 for every domain.
 *   2. llm_mentions accepts ONE task per request. Batching returns
 *      "You can set only one task at a time."
 * A control domain is measured every run so a real zero is distinguishable
 * from a broken call.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH   = join(HERE, 'state.json');
const HISTORY_PATH = join(HERE, 'history.json');

const API = 'https://api.dataforseo.com/v3';
const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;
const US = 2840;

if (!LOGIN || !PASSWORD) {
  console.error('Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** US mentions + AI search volume for one domain. One task per call. */
async function aiMentions(domain) {
  const json = await post('/ai_optimization/llm_mentions/target_metrics/live', [
    { target: [{ domain }] },
  ]);
  const task = json.tasks?.[0];
  const cost = json.cost ?? 0;
  const result = task?.result?.[0];
  if (!result) {
    return { domain, mentions: null, aiSearchVolume: null, cost, error: task?.status_message ?? 'no result' };
  }
  // aggregated_metrics.location is an ARRAY of { key, mentions, ai_search_volume }
  const byLocation = result.aggregated_metrics?.location ?? [];
  const us = byLocation.find(x => x.key === US) ?? {};
  const allMentions = byLocation.reduce((sum, x) => sum + (x.mentions ?? 0), 0);
  return {
    domain,
    mentions: us.mentions ?? 0,
    aiSearchVolume: us.ai_search_volume ?? 0,
    mentionsAllLocations: allMentions,
    cost,
  };
}

/** Current volume / CPC / difficulty for the tracked keyword list. */
async function keywordMetrics(keywords) {
  if (!keywords.length) return { keywords: [], cost: 0 };
  const json = await post('/dataforseo_labs/google/bulk_keyword_difficulty/live', [
    { keywords, location_code: US, language_code: 'en' },
  ]);
  const cost = json.cost ?? 0;
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  const difficultyByKw = new Map(items.map(i => [i.keyword, i.keyword_difficulty]));

  const vol = await post('/keywords_data/google_ads/search_volume/live', [
    { keywords, location_code: US, language_code: 'en' },
  ]);
  const volCost = vol.cost ?? 0;
  const volItems = vol.tasks?.[0]?.result ?? [];

  return {
    keywords: volItems.map(i => ({
      keyword: i.keyword,
      searchVolume: i.search_volume ?? null,
      cpc: i.cpc ?? null,
      difficulty: difficultyByKw.get(i.keyword) ?? null,
    })),
    cost: cost + volCost,
  };
}

/** How many pages the site actually publishes, read from the live sitemap. */
async function indexedPages(site) {
  try {
    const res = await fetch(`${site}/sitemap-0.xml`, { headers: { 'User-Agent': 'alot-land-seo-engine' } });
    if (!res.ok) return null;
    const xml = await res.text();
    return (xml.match(/<loc>/g) ?? []).length;
  } catch {
    return null;
  }
}

const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
const site = `https://${state.site}`;
const controlDomain = 'landwatch.com';

// Flatten every tracked cluster in state.json into one keyword list.
const clusters = state.target_cluster ?? {};
const tracked = [...new Set(
  Object.values(clusters)
    .filter(Array.isArray)
    .flatMap(list => list.map(k => k.kw).filter(Boolean))
)];

console.log(`Collecting metrics for ${state.site} — ${tracked.length} tracked keywords`);

const [self, control, kw, pages] = await Promise.all([
  aiMentions(state.site),
  aiMentions(controlDomain),
  keywordMetrics(tracked),
  indexedPages(site),
]);

const totalCost = (self.cost ?? 0) + (control.cost ?? 0) + (kw.cost ?? 0);

const record = {
  date: new Date().toISOString().slice(0, 10),
  site: state.site,
  cycle: state.cycle ?? null,
  ai: {
    mentions: self.mentions,
    aiSearchVolume: self.aiSearchVolume,
    ...(self.error ? { error: self.error } : {}),
  },
  // Measured every run: if the control is also zero, the API call is broken,
  // not the site. Without this a parsing bug reads as "you are invisible".
  control: {
    domain: control.domain,
    mentions: control.mentions,
    aiSearchVolume: control.aiSearchVolume,
    healthy: (control.mentions ?? 0) > 0,
  },
  indexedPages: pages,
  keywords: kw.keywords,
  apiCostUsd: Number(totalCost.toFixed(4)),
};

const history = existsSync(HISTORY_PATH)
  ? JSON.parse(readFileSync(HISTORY_PATH, 'utf8'))
  : { site: state.site, note: 'Weekly SEO metrics. Appended by seo-engine/collect-metrics.mjs.', records: [] };

// Same-day rerun replaces rather than duplicates.
history.records = history.records.filter(r => r.date !== record.date);
history.records.push(record);
history.records.sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');

console.log(`  AI mentions (US):   ${record.ai.mentions}`);
console.log(`  control (${control.domain}): ${record.control.mentions} ${record.control.healthy ? '— API healthy' : '— ⚠ CONTROL IS ZERO, treat this run as suspect'}`);
console.log(`  indexed pages:      ${record.indexedPages}`);
console.log(`  keywords measured:  ${record.keywords.length}`);
console.log(`  api cost:           $${record.apiCostUsd}`);
console.log(`  history now holds:  ${history.records.length} record(s)`);

if (!record.control.healthy) {
  console.error('Control domain returned zero mentions — the API or the parser is wrong, not the site.');
  process.exit(2);
}
