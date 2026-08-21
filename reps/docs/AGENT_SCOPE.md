# REPS Log — Agent Integration Scope

How an external agent (David's Chief-of-Staff) reads and writes the REPS hours
log. **There is no custom server to build** — the REPS app is a static site, and
its data lives in the same Supabase project as the Time Audit app. The agent
talks directly to Supabase's auto-generated REST API for the `reps_entries`
table, exactly like the Time Audit agent talks to `time_entries`.

Three operations cover everything the agent needs:

| Tool | Method + path |
|------|---------------|
| **List entries** (read the log) | `GET /rest/v1/reps_entries` |
| **Log entry** (write / "post") | `POST /rest/v1/reps_entries` |
| **Get summary** (750 / 50% dashboard) | `POST /rest/v1/rpc/reps_summary` |

---

## Connection

- **Base URL:** `https://whkoayhvqskmiixbehhv.supabase.co/rest/v1/`
- **Auth headers (every request):**
  ```
  apikey: <SERVICE_ROLE_KEY>
  Authorization: Bearer <SERVICE_ROLE_KEY>
  Content-Type: application/json
  ```
  The **service_role key** is secret (Supabase → Project Settings → API →
  `service_role`). It bypasses RLS, so the agent MUST scope every read by
  `user_id` and set `user_id` on every write. Give it to the agent's server
  securely — never commit it or put it in a prompt/log.
- **`user_id`:** David's Supabase user UUID (provided to David separately, not in
  this doc). Referred to below as `<USER_ID>`.

This is the *same* Supabase project and service_role key already used for the
Time Audit agent — if that one is connected, the credentials are identical.

---

## 1. List entries  (GET)

```
GET /rest/v1/reps_entries?user_id=eq.<USER_ID>&order=entry_date.desc
```
Filter by date range for a daily check:
```
GET /rest/v1/reps_entries?user_id=eq.<USER_ID>&entry_date=gte.2026-08-01&entry_date=lte.2026-08-31&order=entry_date.asc
```
Returns an array of rows (see schema below).

## 2. Log entry  (POST)  — the daily logging call

```
POST /rest/v1/reps_entries
Prefer: return=representation
{
  "user_id": "<USER_ID>",
  "entry_date": "2026-08-21",
  "category": "Site Visits",
  "description": "Drove to Sugar Tree Vista, walked lots with logger",
  "hours": 5.0,
  "is_real_estate": true,
  "reps_qualifying": true,
  "needs_review": false,
  "source_tier": "strong",
  "source_ref": "Chief-of-Staff daily check-in 2026-08-21"
}
```
- **Required:** `user_id`, `entry_date` (YYYY-MM-DD calendar day), `category`,
  `description`, `hours` (decimal).
- **Recommended for agent-logged entries:** `source_tier: "strong"` — these are
  contemporaneous logs, David's strongest evidence. Set `source_ref` to note the
  agent + date so it's auditable.
- **Defaults if omitted:** `is_real_estate=true`, `reps_qualifying=true`,
  `needs_review=false`, `source_tier='weak'`. So the agent should always send
  `source_tier` and set `reps_qualifying`/`is_real_estate` per the category (see
  taxonomy). For anything the agent is unsure about, send `needs_review: true`
  so David reviews it in the app.
- Batch insert: send an array of objects to log multiple activities at once.

## 3. Get summary  (RPC)

```
POST /rest/v1/rpc/reps_summary
{ "p_user_id": "<USER_ID>", "p_year": 2026 }
```
Returns the full dashboard as JSON:
```json
{
  "year": 2026, "count": 252, "total_hours": 630.8,
  "qualifying_hours": 511.4, "re_hours": 560.0, "non_re_hours": 70.8,
  "review_count": 128,
  "tiers": [
    {"tier":"strong_only","qualifying_hours":171.4,"total_work_hours":266.3,"re_share_pct":64.4,"meets_750":false,"meets_50pct":true},
    {"tier":"strong_medium","qualifying_hours":205.4,"total_work_hours":316.8,"re_share_pct":64.8,"meets_750":false,"meets_50pct":true},
    {"tier":"all","qualifying_hours":511.4,"total_work_hours":630.8,"re_share_pct":81.1,"meets_750":false,"meets_50pct":true}
  ],
  "by_category": [{"category":"...","hours":0,"qualifying_hours":0}],
  "big_days": [{"date":"2026-07-21","hours":11.5}]
}
```
`tiers[0]` (**strong_only**) is the defensible floor — the number that matters.
Requires the `reps_summary` function (`supabase/agent_summary_rpc.sql`) to be run
once in the SQL Editor.

---

## `reps_entries` schema

| column | type | notes |
|--------|------|-------|
| `id` | uuid | auto |
| `user_id` | uuid | **always set to `<USER_ID>`** |
| `entry_date` | date | the calendar day the work happened |
| `category` | text | REPS taxonomy (below) |
| `description` | text | what was done |
| `hours` | numeric | decimal hours |
| `is_real_estate` | bool | real-property trade/business activity |
| `reps_qualifying` | bool | counts toward the 750-hour test |
| `needs_review` | bool | flag for David's manual review |
| `source_tier` | text | `strong` \| `medium` \| `weak` (evidence strength) |
| `source_ref` | text | where it came from |

## REPS category taxonomy (use these exact strings)

`Acquisitions & Underwriting`, `Subdivision & Entitlement`, `Property Management`,
`Direct Mail & Marketing`, `Investor Relations`, `Site Visits`,
`Closings & Transactions`, `Admin`, `Coaching/Education`, `Non-REPS`.

Guidance for the agent when logging:
- Real-estate work (deals, site visits, subdivision, closings, investor/lender
  work, seller lead follow-up, property marketing) → the matching RE category,
  `is_real_estate=true`, `reps_qualifying=true`.
- **Coaching / courses / masterminds** → `Coaching/Education`,
  `reps_qualifying=false`, `needs_review=true` (IRS treatment is inconsistent).
- **Software / app / book building** (AI agents, analyzers, writing) → `Non-REPS`,
  `is_real_estate=false`, `reps_qualifying=false`, `needs_review=true` — likely a
  separate trade or business.
- **Non-real-estate work** David does (ECS, video, movie, BuilDefi, etc.) →
  `Non-REPS`, `is_real_estate=false`, `reps_qualifying=false`. Still log it: it's
  the denominator for the 50% test.

## Rules
- Always set `user_id`; always scope reads by `user_id`.
- REPS is tested **per calendar year** — the log and summary are 2026-scoped.
- Never insert into `auth.users`. Never expose the service_role key.
- When unsure how something classifies, log it with `needs_review: true`.

---
*Source of truth is the SQL in `reps/supabase/` and `reps/src/lib/reps.js`.
Last updated 2026-08-21.*
