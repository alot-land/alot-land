# REPS Log · Alot.Land

Real Estate Professional Status (REPS) hour documentation. Repurposes the Time
Audit design system into a compliance tracker: import a multi-source activity
log, auto-classify each row by REPS category and **evidence strength**, then see
your defensible **Strong-only floor** vs. your full claimed total for the
750-hour and >50% tests — tax-year scoped.

> Not tax advice. This tool documents and structures hours; the REPS
> determination is your CPA's call. It surfaces the distinctions (weak evidence,
> software/education hours) so that call is informed.

## Stack
React 19 + Vite + Tailwind + TanStack Query. Uses the **same Supabase project**
as the Time Audit app (shared login / allow-list). New table: `reps_entries`.

## One-time setup
1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor
   (creates `reps_entries` + owner-only RLS).
2. Add the app's URL to **Supabase → Authentication → URL Configuration →
   Redirect URLs** (`http://localhost:4327/**` for local, `https://reps.alot.land/**` for prod).

## Local dev
```bash
cd reps && npm install && npm run dev   # http://localhost:4327
```
`.env.local` holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (both shared
with Time Audit) and is gitignored.

## How it works
- **Import** — paste or upload your CSV (`Date, Day, Activity Category,
  Description, Hours, Source`). Each row is auto-classified:
  - **Source tier** (evidence): emails/signings/invoices/Time-Audit → Strong;
    calendar → Medium; "pattern"/"memory est."/"Context" → Weak.
  - **REPS category**, `is_real_estate`, `reps_qualifying`, `needs_review`.
    Software/app/book builds → Non-REPS + review; coaching → non-qualifying +
    review; ambiguous "working on the business" → qualifying + review.
  - Replace-all or append (dedupes on date+description+hours).
- **Entries** — filter and retag everything inline (category, evidence tier,
  qualifying, real-estate, review). This is where you override the first pass.
- **Add** — log new activities going forward, including non-RE work (ECS,
  video, movie, etc.) so the 50% test denominator is real.
- **Dashboard** — tax-year scoped. Three side-by-side totals (Strong /
  Strong+Medium / All) with the Strong floor as the headline, the >50% test at
  each tier, >10-hr/day flags, and a category breakdown. Exports summary + entries CSV.

## Classification logic
All defaults live in [`src/lib/reps.js`](./src/lib/reps.js) — transparent and
fully overridable in the UI.
