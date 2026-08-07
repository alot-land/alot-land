# Time Audit — Full Application Scope

> Canonical reference for the Time Audit web app. Hand this to any system,
> agent, or developer that needs a complete understanding of what the app does
> and how to read from or write to it.

---

## 1. Overview

**Time Audit** is a private dark-themed web app for tracking time against value tiers ($10K / $1K / $10–$99 / $0 per hour). The goal is to maximize the share of your week spent on $10K/hour activities. It runs at **`https://time.alot.land`** and stores data in Supabase.

- **Origin**: Built for David Stone (`david@alot.land`) starting 2026-05-14; live since 2026-05-15.
- **Source repo**: `alot-land/alot-land` on GitHub, in the `time-audit/` subfolder.
- **Multi-user**: Yes. Access is gated by a database-managed allow-list (`allowed_emails`). Each user's data is fully isolated by Postgres Row-Level Security; users never see each other's data.
- **Mobile**: Fully responsive (sidebar on desktop, bottom-tab nav on phone). Designed to be added to the iOS home screen as a PWA-style icon.

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite 6, Tailwind 3 |
| Server state | TanStack Query 5 (cache invalidation on mutations) |
| Charts | recharts |
| PDFs | @react-pdf/renderer (lazy-loaded chunk) |
| Dates | date-fns 4 |
| Database / Auth | Supabase (Postgres + Auth + RLS) |
| Email | Resend SMTP (alot.land verified sender domain) |
| Hosting | Netlify (auto-deploy from `main`) |
| Custom domain | `time.alot.land` (CNAME at GoDaddy → Netlify) |

## 3. Live Infrastructure

| Resource | Value |
|---|---|
| Production URL | `https://time.alot.land` |
| Fallback URL | `https://alot-time-audit.netlify.app` |
| Supabase project ref | `whkoayhvqskmiixbehhv` |
| Supabase REST base | `https://whkoayhvqskmiixbehhv.supabase.co/rest/v1/` |
| Supabase Auth base | `https://whkoayhvqskmiixbehhv.supabase.co/auth/v1/` |
| Supabase publishable key | `sb_publishable_69lMXWDJY1AXohHFYtqOhg_bROl9Lj1` (safe for client) |
| Netlify site ID | `51e62d07-92ce-4651-ac11-b404b39a3a42` |
| Email sender | `Time Audit <noreply@alot.land>` |

The publishable key is safe to expose in client code. The Supabase **secret/service-role** key is NOT in this document; it lives only in the Supabase dashboard. Treat it like a root password.

## 4. Core Concepts

### 4.1 Value Tiers
Every activity belongs to exactly one tier. Tiers are hard-coded; they don't live in the database as their own table.

| Key | Label | Color |
|---|---|---|
| `tier_10k` | $10,000 / hour | `#F5B800` gold |
| `tier_1k` | $1,000 / hour | `#3CB054` green |
| `tier_mid` | $10–$99 / hour | `#5B9BD5` blue |
| `tier_zero` | $0 / hour | `#5A5A5A` grey |

The headline metric is **$10K share**: `tier_10k minutes / total tracked minutes`.

### 4.2 Week Convention
Weeks run **Thursday → Wednesday** (matches the original source spreadsheet).
- `src/lib/dates.js` exports `WEEK_STARTS_ON = 4` (Thursday).
- Week-keyed tables (`week_notes`, `hidden_weeks`) use a `week_start` date that is always a Thursday.
- The Reports / Week / weekly-PDF views all use this convention.

### 4.3 Time Entry Sources
The `time_entries.source` column distinguishes how a row was created:
- `manual` — minutes typed in the Buckets view. No `started_at` / `ended_at`.
- `timer` — created when a live timer is stopped. Has `started_at` (when the timer started) and `ended_at` (when stopped).
- `block` — a Timeline block. Has both `started_at` and `ended_at` set explicitly by the user.

### 4.4 Seed Behavior
The first time a new user signs in (any row inserted into `auth.users`), a database trigger automatically inserts **39 default activities** for that user across all four tiers, so the new account is ready to log on day one.

## 5. Database Schema

All tables live in the `public` schema. Every table has RLS enabled and an owner-only policy except `allowed_emails` (admin-managed).

### 5.1 `activities`
```sql
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  tier        text not null check (tier in ('tier_10k','tier_1k','tier_mid','tier_zero')),
  sort_order  int  not null default 0,
  archived_at timestamptz,   -- null = active, set = archived (soft delete)
  created_at  timestamptz not null default now()
);
```
- One row per activity per user (e.g. "Email", "Deal negotiation/preparation", "Gym").
- Each user gets their own private copy of all activities.
- Archive instead of delete: archived activities still show in PDF reports for past time_entries.

### 5.2 `time_entries`
```sql
create table public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  occurred_on  date not null,                                   -- which calendar day the time belongs to
  minutes      int  not null check (minutes >= 0),
  notes        text,
  source       text not null default 'manual'
               check (source in ('manual','timer','block')),
  started_at   timestamptz,                                     -- set for 'timer' and 'block'
  ended_at     timestamptz,                                     -- set for 'timer' and 'block'
  created_at   timestamptz not null default now()
);
```
- Indexed by `(user_id, occurred_on)` and `(activity_id)`.
- A single logged event = one row. There is no aggregation table.

### 5.3 `week_notes`
```sql
create table public.week_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,                                   -- always a Thursday
  focus       text,
  reflection  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, week_start)
);
```
Holds the "focus this week" and "reflection" prompts the user fills in on the Week page.

### 5.4 `active_timers`
```sql
create table public.active_timers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  started_at  timestamptz not null default now()
);
```
- **Singleton per user** (UNIQUE on `user_id`): only one timer can be running at a time.
- When the user stops the timer, the app inserts a `time_entries` row with `source = 'timer'` and deletes the `active_timers` row.

### 5.5 `day_journal`
```sql
create table public.day_journal (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  wake_at     timestamptz,
  sleep_at    timestamptz,   -- prior night's bedtime (migration 005)
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);
```
Per-day record keyed by `day` = the morning you woke up.
- `wake_at` — that morning's wake time (a timestamp on `day`). The Timeline view requires a `wake_at` to start.
- `sleep_at` — the prior night's bedtime. Usually a timestamp on `day - 1` evening (e.g. 23:00) or early `day` after midnight (e.g. 00:30). Sleep **duration** is derived as `wake_at - sleep_at`; the app shows it on the wake card and in the daily PDF header ("Slept 7h 30m"). Nullable — rows without it just omit the sleep figures.

### 5.6 `hidden_weeks`
```sql
create table public.hidden_weeks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,
  hidden_at   timestamptz not null default now(),
  unique (user_id, week_start)
);
```
Soft-hide a week from the Reports list. Data is preserved; the row only marks the week as hidden.

### 5.7 `allowed_emails`
```sql
create table public.allowed_emails (
  email      text primary key,
  is_admin   boolean not null default false,
  added_by   uuid references auth.users(id) on delete set null,
  added_at   timestamptz not null default now(),
  note       text
);
```
DB-managed allow-list. Sign-in is rejected for any email not in this table.

## 6. RLS Policies (Summary)

All user-data tables have **owner-only** policies:
```sql
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id)
```
Tables: `activities`, `time_entries`, `week_notes`, `active_timers`, `day_journal`, `hidden_weeks`.

`allowed_emails` is **admin-only**, gated via a SECURITY DEFINER function (`is_current_user_admin`) so the policy doesn't recurse on itself:
```sql
for all to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin())
```

The publishable (`sb_publishable_...`) key only sees rows allowed by RLS. The secret/service-role key bypasses RLS.

## 7. Triggers & Functions

### 7.1 Seed trigger
```sql
-- Fires AFTER INSERT on auth.users.
-- Inserts ~39 default activities for the new user across all 4 tiers.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_user_activities();
```
The list is hard-coded in `seed_user_activities()` (see `supabase/schema.sql`).

### 7.2 Public RPC: `is_email_allowed(p_email text)`
- SECURITY DEFINER, grant EXECUTE to `anon, authenticated`.
- Returns true if `p_email` is in `allowed_emails`.
- Called by the sign-in page **before** sending a magic link, so unauthorized emails never get an email.

### 7.3 Authenticated RPC: `is_current_user_admin()`
- SECURITY DEFINER, grant EXECUTE to `authenticated`.
- Looks up the JWT email in `allowed_emails.is_admin`.
- Used by the Settings page to conditionally render the admin panel and by the `allowed_emails` RLS policy.

## 8. Authentication

- **Method**: Magic link (email OTP) via Supabase Auth + Resend SMTP.
- **Allow-list**: Sign-in is gated by `is_email_allowed(email)`. New invites are added to `allowed_emails` by an admin via the Settings → Admin Access list panel; that same insert also fires a magic-link email via `signInWithOtp` so the invitee gets a one-click sign-in immediately.
- **Email templates** (configured in Supabase dashboard, all branded with gold/black HTML using `time.alot.land/favicon-192.png` as the logo):
  - "Magic link" — for returning users
  - "Confirm signup" — for first-time sign-ups (invitee accounts)
- **Session**: Standard Supabase JWT in localStorage. Auto-refresh handled by `@supabase/supabase-js`.
- **Sign-out**: `supabase.auth.signOut()`. Sidebar (desktop) and Mobile header expose this.

## 9. Pages & Features

### 9.1 Today (`src/pages/Today.jsx`)
- Shows the selected day (defaults to today, navigable to any past day via `‹ Today ›` buttons or a native date picker).
- Two view modes (top-right toggle):
  - **Timeline**: vertical chained blocks. Each block has a start time, duration (entered as hours + minutes), an activity (typeahead via `ActivityCombobox`), optional notes. Requires a wake-up time first (`WakeTimeCard` → `day_journal.wake_at`).
  - **Buckets**: classic tier-grouped quick-tap. Each activity has a `min` input + Log button (creates `time_entries` with `source = 'manual'`) and a hover-revealed ▶ that starts the live timer.
- Floating **live timer** (singleton per user via `active_timers`) lives in the bottom-right; "Stop" inserts a `time_entries` row with `source = 'timer'`.
- **"Day PDF"** button exports a daily report for the currently selected day.
- Loads the whole Thu→Wed week containing the selected day (not just one day's entries).

### 9.2 Week (`src/pages/Week.jsx`)
- Thu→Wed editable grid: rows = activities, columns = 7 days, cells = minutes.
- Edits commit on blur via `setCellMinutes` (deletes existing entries for that activity+day and inserts a single `manual` row at the new total).
- **Tier totals bar** at top.
- **Focus + Reflection** text areas (saved to `week_notes` on blur).
- **PDF** button (weekly).

### 9.3 Trends (`src/pages/Trends.jsx`)
- Range toggles: 4w / 8w / 12w (weekly charts) and 7d / 14d / 30d (daily chart).
- Stat cards: avg $10K share, total tracked, weeks with data.
- **Donut**: where your N weeks went, by tier.
- **Weekly stacked bar**: hours per week by tier.
- **Daily stacked bar**: hours per day by tier (independent range toggle).
- **$10K share line chart**: weekly trend.

### 9.4 Reports (`src/pages/Reports.jsx`)
- List of the last 12 weeks. Each row shows quick stats and has a **PDF** button (weekly multi-page report) + a **trash** icon that hides the week (sets a row in `hidden_weeks`).
- "Show hidden (N)" checkbox toggles visibility of hidden rows; clicking the restore icon removes the `hidden_weeks` row.

### 9.5 Settings (`src/pages/Settings.jsx`)
- **Admin · Access list** (admins only): table of `allowed_emails` with invite-by-email form, note field, promote/demote toggle, remove-with-confirm. Inserting a row also fires a magic-link email to the new user automatically.
- **Activity management**: 4 tier sections; add / rename / re-tier (`<select>`) / archive activities. "Show archived" checkbox to view+restore archived ones.

## 10. PDF Reports

PDFs are generated client-side via `@react-pdf/renderer`, lazy-loaded so the main bundle stays under ~280KB gzipped.

- Entry point: `src/components/PdfDownloadButton.jsx`
- Data shaping: `src/pdf/reportData.js` → `buildReportData({ rangeStart, rangeEnd, entries, prevEntries, activities, journals })`
- Layout: `src/pdf/ReportDocument.jsx`

### Two modes

| Mode | Trigger | Range | Pages |
|---|---|---|---|
| `'week'` | Reports / Week PDF buttons | Thu→Wed (7 days) | 1 snapshot + N detail pages |
| `'day'` | Today's "Day PDF" button | single day | 1 snapshot + 1+ detail pages |

### Page 1 (snapshot)
- Brand header + date range
- Three headline cards: total hours tracked, $10K share %, $10K+$1K combined
- By-tier table (hours, %, delta vs prior period)
- Top activities (bars)
- (week mode only) Hours-per-day bar chart + Focus / Reflection prompts

### Detail pages
- For each day with entries: a date header (with wake time + day total) and a table of items.
- Each item row: **time range** (started_at → ended_at) | **duration** | **activity name + notes** | **tier**.
- Sorted by start time; manual entries (no start time) sink to the bottom.
- Auto-paginates via react-pdf — a busy week can run 3–5 pages.
- "Page X of Y" footer on detail pages.

## 11. Frontend Architecture

### Folder map
```
time-audit/
├── index.html
├── netlify.toml
├── package.json
├── public/                       (favicons, brand-mark.png, apple-touch-icon)
├── scripts/
│   ├── build-favicons.mjs        (sharp-based icon pipeline)
│   └── magic-link.mjs            (CLI to generate magic-link URL via Admin API)
├── supabase/
│   ├── schema.sql                (base tables + seed trigger)
│   ├── seed_existing_user.sql    (one-off backfill)
│   ├── migration_002_timeline.sql
│   ├── migration_003_hidden_weeks.sql
│   └── migration_004_allowed_emails.sql
└── src/
    ├── main.jsx                  (QueryClient, BrowserRouter, AuthProvider mount)
    ├── App.jsx                   (Auth gate, routes, Sidebar + MobileNav layout)
    ├── index.css                 (Tailwind directives + global resets)
    ├── lib/
    │   ├── supabase.js           (singleton createClient + ALLOWED_EMAIL constant)
    │   ├── auth.jsx              (AuthProvider + useAuth + signOut)
    │   ├── dates.js              (Thu-Wed week math, format helpers, daysInRange)
    │   ├── tiers.js              (TIERS array, tierByKey map)
    │   └── queries.js            (every Supabase read/write — see §13)
    ├── components/               (UI building blocks; one file per component)
    ├── pages/                    (one file per route)
    └── pdf/                      (ReportDocument + reportData)
```

### Data flow
- TanStack Query owns all server data. Cache keys are stable strings (e.g. `['entries', '2026-05-14']`, `['week-note', '2026-05-14']`).
- Mutations invalidate cache prefixes (e.g. invalidating `['entries']` refreshes every entry-range query).
- `refetchOnWindowFocus: true` + `staleTime: 10_000` give near-live cross-device sync.

### Auth gate
`App.jsx` waits for `useAuth().loading`, renders `<SignIn />` if no session, else the full app with `<Sidebar />` (desktop) + `<MobileNav />` (mobile).

## 12. Constraints, Validation, Invariants

| Constraint | Where |
|---|---|
| `activities.tier ∈ {tier_10k, tier_1k, tier_mid, tier_zero}` | DB CHECK |
| `time_entries.source ∈ {manual, timer, block}` | DB CHECK |
| `time_entries.minutes >= 0` | DB CHECK |
| One running timer per user | UNIQUE on `active_timers.user_id` |
| One journal row per (user, day) | UNIQUE |
| One week_note per (user, week_start) | UNIQUE |
| One hidden_weeks row per (user, week_start) | UNIQUE |
| `week_start` must be a Thursday | App-side; not enforced in DB |
| User can only see their own data | RLS `auth.uid() = user_id` |
| Sign-in is restricted to allow-listed emails | App calls `is_email_allowed()` before OTP |

## 13. Query Library (`src/lib/queries.js`)

Every read/write goes through one of these. Names map 1:1 to the page that calls them.

| Function | Purpose |
|---|---|
| `fetchActivities()` | All non-archived activities, ordered by tier + sort_order |
| `fetchAllActivities()` | Same but includes archived (used by Settings + PDF) |
| `createActivity({ name, tier, sort_order })` | New activity (user_id auto from session) |
| `updateActivity(id, patch)` | Rename / re-tier / archive (`archived_at` set) |
| `archiveActivity(id)` / `unarchiveActivity(id)` | Convenience wrappers |
| `fetchEntriesForRange(start, end)` | `time_entries` between two dates inclusive |
| `fetchEntriesForWeek(date)` | The Thu-Wed week containing `date` |
| `addEntry({ activityId, occurredOn, minutes, source, startedAt?, endedAt?, notes? })` | Insert any source (`manual` default) |
| `addTimelineBlock({ activityId, startedAt, minutes, notes? })` | Convenience for Timeline (`source='block'`, computes ended_at) |
| `updateEntry(id, patch)` / `updateTimelineBlock(id, ...)` | Edit |
| `deleteEntry(id)` | Hard delete |
| `fetchActiveTimer()` | `maybeSingle` — null when no timer running |
| `startTimer(activityId)` | Delete any existing timer, insert new one |
| `stopTimerAndLog(timer)` | Insert `time_entries` (source='timer'), delete timer |
| `cancelTimer(timerId)` | Delete timer without logging |
| `fetchDayJournal(date)` / `fetchDayJournalsForRange(start, end)` | Wake-up data |
| `upsertDayJournal(date, patch)` | Set wake_at / notes for a day |
| `fetchWeekNote(weekStart)` / `upsertWeekNote(weekStart, patch)` | Focus + reflection |
| `fetchHiddenWeeks()` / `hideWeek(weekStart)` / `unhideWeek(weekStart)` | Hide/show on Reports list |
| `isEmailAllowed(email)` | Public RPC, called before sending magic link |
| `isCurrentUserAdmin()` | RPC, gates the admin panel |
| `fetchAllowedEmails()` / `addAllowedEmail({email, isAdmin?, note?})` / `updateAllowedEmail(email, patch)` / `deleteAllowedEmail(email)` | Admin-only |
| `sendInviteEmail(email)` | Fires a magic-link email at someone you just invited |

## 14. Public API for Agents (writing to the app programmatically)

### 14.1 Auth options

**Option A — Service-role key (server-side agents you control)**
- Get the secret key from Supabase dashboard → Project Settings → API → "secret" / service_role. **Never expose to clients.**
- Headers on every request:
  ```
  apikey: <service_role>
  Authorization: Bearer <service_role>
  Content-Type: application/json
  ```
- **Bypasses RLS** — you must set `user_id` explicitly on every insert, or the row will have null `user_id` and break RLS for the user.
- Use this for trusted backend agents.

**Option B — User-scoped JWT (impersonating a real user)**
- Have the user sign in via magic link, capture the access token from the Supabase session.
- Headers:
  ```
  apikey: <sb_publishable_...>
  Authorization: Bearer <user-access-token>
  Content-Type: application/json
  ```
- RLS applies automatically. `user_id` will be filled by `auth.uid()` if you omit it from inserts (where the DB default applies). Cleanest to set it explicitly to the user's UUID.

Both options use the same REST endpoints.

### 14.2 REST endpoints (PostgREST)

Base URL: `https://whkoayhvqskmiixbehhv.supabase.co/rest/v1/`

Every table is exposed as `/<table>`:
- `/activities`
- `/time_entries`
- `/day_journal`
- `/week_notes`
- `/hidden_weeks`
- `/active_timers`
- `/allowed_emails`

RPC endpoints: `/rpc/<function_name>`:
- `/rpc/is_email_allowed` (body: `{ "p_email": "..." }`)
- `/rpc/is_current_user_admin` (no body)

Add `Prefer: return=representation` to GET back the inserted/updated row.

### 14.3 Common writes

**Get the user's activities (to find activity_id by name)**
```
GET /rest/v1/activities?select=id,name,tier&user_id=eq.<user_uuid>&archived_at=is.null&order=tier,sort_order
```

**Log a manual time entry**
```
POST /rest/v1/time_entries
Prefer: return=representation
Body:
{
  "user_id": "<user_uuid>",
  "activity_id": "<activity_uuid>",
  "occurred_on": "2026-05-21",
  "minutes": 30,
  "source": "manual",
  "notes": "morning email triage"
}
```

**Log a timeline block (with start + end)**
```
POST /rest/v1/time_entries
Body:
{
  "user_id": "<user_uuid>",
  "activity_id": "<activity_uuid>",
  "occurred_on": "2026-05-21",
  "minutes": 60,
  "source": "block",
  "started_at": "2026-05-21T09:00:00-07:00",
  "ended_at":   "2026-05-21T10:00:00-07:00",
  "notes": "Deal call with X"
}
```
The app accepts either `Z` or offset-based timestamps; Supabase stores them in UTC.

**Create a new activity** (if the agent needs a category that doesn't exist yet)
```
POST /rest/v1/activities
Body:
{
  "user_id": "<user_uuid>",
  "name": "Workout with trainer",
  "tier": "tier_zero",
  "sort_order": 999
}
```
`tier` must be one of the four enum values exactly.

**Set wake-up time and bedtime for a day** (upsert)
```
POST /rest/v1/day_journal
Prefer: resolution=merge-duplicates,return=representation
Body:
{
  "user_id": "<user_uuid>",
  "day": "2026-05-21",
  "wake_at":  "2026-05-21T06:00:00-07:00",
  "sleep_at": "2026-05-20T22:30:00-07:00"
}
```
- `day` is the morning the user woke up. `wake_at` is a timestamp on that day.
- `sleep_at` is the **prior night's bedtime** — almost always a timestamp on `day - 1` evening (or early `day` after midnight). The agent should write the explicit full timestamp; do NOT rely on the in-app hour heuristic.
- Sleep duration is computed downstream as `wake_at - sleep_at`. If `sleep_at >= wake_at` (bad data) the app shows no duration.
- Either field can be omitted; merge-duplicates means you can set `wake_at` in the morning and `sleep_at` later without overwriting the other.

**Set focus / reflection for a week** (upsert; `week_start` must be Thursday)
```
POST /rest/v1/week_notes
Prefer: resolution=merge-duplicates,return=representation
Body:
{
  "user_id": "<user_uuid>",
  "week_start": "2026-05-14",
  "focus": "Close the Olson deal",
  "reflection": "Email stole too much Tuesday — block it next week"
}
```

**Start a live timer**
```
POST /rest/v1/active_timers
Body:
{
  "user_id": "<user_uuid>",
  "activity_id": "<activity_uuid>"
}
```
There can only be one active timer per user. If one exists, delete it first:
```
DELETE /rest/v1/active_timers?user_id=eq.<user_uuid>
```

**Stop a timer and log it** (do these as two requests):
1. Read the active timer: `GET /rest/v1/active_timers?user_id=eq.<user_uuid>&select=*` → get `started_at` and `activity_id`.
2. Compute `minutes = ceil((now - started_at) / 60s)`, then `POST /rest/v1/time_entries` with `source='timer'`, `started_at`, `ended_at = now`, and finally `DELETE /rest/v1/active_timers?id=eq.<timer_id>`.

### 14.4 Common reads

**Find a user_id by email** (service-role only; auth.users isn't exposed to publishable key)
```sql
SELECT id FROM auth.users WHERE email = '...';
```

**All entries for a date range**
```
GET /rest/v1/time_entries?user_id=eq.<uuid>&occurred_on=gte.2026-05-14&occurred_on=lte.2026-05-20&select=*,activity:activities(name,tier)&order=occurred_on,started_at
```

**Activities + entry counts per tier (custom roll-up)** — fetch separately and aggregate client-side, or write a SQL view via migration.

### 14.5 Rules for agents

- **Always set `user_id`** when using service-role; never assume defaults.
- **`occurred_on` is required** — `time_entries` won't insert without it.
- **Don't manually insert into `auth.users`** — go through Supabase Auth (`/auth/v1/otp` or admin `/auth/v1/admin/users`).
- **Don't delete activities** that have referenced `time_entries` you want to keep — set `archived_at` instead. Cascade DELETE on activities would wipe their entries.
- **`tier` and `source`** are CHECK-constrained — typos are rejected, not silently fixed.
- **Respect the Thursday convention** for `week_start` and `week_notes`.
- **One timer per user** — enforce in code, not just at the DB.
- **Allow-list bypass**: service-role can insert into `auth.users` without going through the allow-list check, but that's almost never what you want. For new users, add to `allowed_emails` first, then call `signInWithOtp` so the standard flow runs.
- **Time entries are immutable in spirit** — the Week grid's edit-cell behavior is "delete all entries for (activity, day) and insert one". Mirror that pattern if your agent needs to overwrite vs append.

### 14.6 Worked example: "Log 45 min of email at 9am yesterday"

```js
// pseudo-code in any language, using service_role
const userId = '<known uuid>'                            // or look up by email
const yesterday = '2026-05-20'

// 1. Find the activity
const acts = await GET('/rest/v1/activities', {
  user_id: `eq.${userId}`, name: 'eq.Email', select: 'id'
})
const activityId = acts[0].id

// 2. Insert as a block with start+end so it shows on the Timeline
await POST('/rest/v1/time_entries', {
  user_id: userId,
  activity_id: activityId,
  occurred_on: yesterday,
  minutes: 45,
  source: 'block',
  started_at: '2026-05-20T09:00:00-07:00',
  ended_at:   '2026-05-20T09:45:00-07:00',
  notes: 'morning inbox sweep',
})
```

The Timeline on Today will now show that block at 9 AM yesterday; the Week grid will show 45 min in the Email row under Wednesday; the Day PDF for 2026-05-20 will list it with start–end times.

## 15. Recent History (migration order)

If you're standing up a fresh Supabase project against this codebase, run the SQL files in order:

1. `supabase/schema.sql` — base tables + seed trigger
2. `supabase/seed_existing_user.sql` *(only if you already had users created before the trigger existed)*
3. `supabase/migration_002_timeline.sql` — `day_journal` + `'block'` source on `time_entries`
4. `supabase/migration_003_hidden_weeks.sql` — `hidden_weeks` table
5. `supabase/migration_004_allowed_emails.sql` — DB-managed allow-list + RPCs
6. `supabase/migration_005_sleep.sql` — adds `day_journal.sleep_at` (bedtime)

There's no automated migration runner; these are pasted into the Supabase SQL Editor.

## 16. Known Limitations / Round-2 Backlog

- No xlsx export.
- No two-week side-by-side comparison view.
- No team / coach sharing (read-only shareable weekly report URL).
- Allow-list is enforced client-side (gracefully) and via RLS (firmly), but there's no Supabase **Auth Hook** preventing service-level signup; a determined client using `/auth/v1/otp` directly could create an empty account. Their data would be empty (RLS) but the row would exist. Hardening this needs a custom Auth Hook.
- No Supabase Realtime subscriptions yet — sync between devices is via refetch-on-focus + 10s staleTime, not push.

---

*Last updated 2026-05-21 (added `day_journal.sleep_at` for sleep-duration; see migration 005). The canonical version of this doc lives at `time-audit/docs/AGENT_SCOPE.md` in the `alot-land/alot-land` repo. If you need details that aren't here, the source of truth is the SQL in `time-audit/supabase/` and the query library in `time-audit/src/lib/queries.js`.*
