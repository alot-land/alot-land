# MFDA application-correctness closure — 2026-10-06

P0-1 — **CLOSED** in the local working tree: invitation authorization is validated at the database boundary before membership creation.

P0-2 — **CLOSED** in the local working tree: authenticated identity, active organization, and role scope query caches and component state. Automated browser tests reproduce the original defect and verify isolation after remediation.

These verdicts describe the tested implementation and forward migration. No production system was inspected or changed; the migration has not been deployed.

## Repository and preserved work

- Repository: `alot-land/alot-land`.
- Branch: `hardening/mfda-p0-security-closure`.
- Original base and unchanged HEAD: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`.
- Initial working tree: 22 modified tracked files, five existing untracked test/harness files, a tenant-query module, migration 015, and unrelated `.netlify/` content.
- Initial tracked diff: 200 insertions, 118 deletions. Final tracked application diff: 212 insertions, 121 deletions in the same 22 files. Git diff statistics exclude untracked files.
- The interrupted implementation was inspected before editing. No reset, revert, checkout, commit, push, merge, or deployment occurred.
- The existing migration and all query-import adoptions were retained. This continuation corrected a baseline locator and fixture/teardown issues, narrowed routine lifecycle invalidation, guarded delayed form hydration, expanded regression coverage, and produced this report.
- `.netlify/` has 991 files with identical before/after SHA-256 fingerprints. It was never used as a test database or runtime.

## Invitation defect reproduction and root cause

The immutable-source control in `mfda/security/baseline.test.mjs` runs the original migration chain in a disposable PostgreSQL cluster. An expired synthetic administrative invitation makes `is_email_allowed` return false, yet inserting its confirmed synthetic recipient into the local auth fixture grants administrative membership. This control passes because it demonstrates the original incorrect behavior.

The original `bootstrap_new_user`, including the replacement installed by migration 012, selected an unconsumed invitation by email without checking expiration. It also created a personal organization with an administrative membership when no invitation matched. The browser sign-in gate therefore did not establish the authoritative membership decision, and could not make invalid onboarding safe.

## Invitation remediation and migration

`mfda/supabase/migration_015_p0_invitation_authorization.sql` is a forward migration applied after the complete earlier chain. It preserves starter market values from migration 012 and existing memberships.

The private `accept_mfda_invite(token, user)` helper requires a confirmed email from `auth.users`, locks the authoritative invitation row, and validates token, recipient, consumption, expiration, and allowed role before writing membership. Expiration uses `clock_timestamp()` after acquiring the lock, including transactions started before expiration. Organization and role come from that row. Existing membership is never upgraded by invitation redemption. Membership creation and consumption occur in the same transaction.

`redeem_invite(token)` derives the user from `auth.uid()` and accepts no client organization or role. `accept_pending_mfda_invites()` preserves email-based onboarding for verified new and returning users without caller-supplied identity or authorization fields. The bootstrap and email-confirmation trigger use the same private validator. Invalid/uninvited users receive no default membership; the pre-existing founder allowlist remains the explicit personal-organization exception.

The private helper is not executable by public, anonymous, or authenticated client roles. Public redemption RPCs are available only to authenticated callers. A trigger prevents changes to consumed invitations, including resetting consumption or retargeting them. Existing RLS remains in place. The frontend organization provider calls the authoritative pending-invitation RPC before reading its own memberships; frontend checks are not the membership enforcement boundary.

Apply migration 015 after all earlier migrations and before the new client in any separately authorized rollout. Replaying migration 012 afterward would replace the corrected bootstrap. No rollout was performed here.

## Tenant-state defect reproduction and root cause

The browser baseline control extracts original source into a temporary directory using read-only Git commands and runs the actual SPA. Synthetic A loads an A-only deal, signs out, and B signs in. Opening the known deal route shows the cached A-only deal while B's actual PostgreSQL query returns zero rows. The delayed unauthorized response eventually replaces the stale display. The control asserts both the visible defect and the database denial.

The baseline created one query client for the entire application lifetime. Detail/scenario/note keys did not contain authenticated identity or active organization. Signing out did not dispose of that cache. Organization state could outlive identity transitions, membership reads returned other users' rows in shared organizations, and detail reads filtered by record ID alone. A user independently authorized in both organizations could consequently retrieve an A record while B was the selected organization. Form hydration and component-local state also needed a lifecycle boundary beyond query keys.

## Tenant-state remediation and query/state changes

- `AuthProvider` publishes identity changes through `useSyncExternalStore`. A generation changes when identity changes, including sign-out/sign-in; unchanged token renewal preserves forms. Late initial session reads cannot override newer auth events. Sign-out hides private state immediately. Expiration hides it locally, and an obsolete expiration timer cannot clear a replacement session.
- Organization state is keyed by auth generation. Membership requests filter by the current `user_id`; stale/unmounted responses are ignored. Stored organization IDs are preferences scoped to that user and must match freshly loaded membership. Legacy organization IDs do not authorize access. Sign-out removes organization preferences.
- Organization switching hides the old view before checking membership. Foreground, route, realtime, and explicit revalidation fail closed. A 30-second background check detects changes even without realtime; an unchanged result preserves forms. Changed organization or role creates a new tenant boundary; failures hide the view.
- `TenantBoundary` keys a separate query client and the component subtree by user, auth generation, organization, role, and organization generation. Cleanup cancels queries and clears the old client. Late old requests or callbacks hold only the discarded cache/component instance. They cannot populate the new tenant's state.
- The tenant-query wrapper prefixes query keys and cache updates/invalidations consistently. Same-tenant `keepPreviousData` behavior remains available; a new tenant receives a fresh observer/client.
- Detail/contact/unit/scenario/parcel/mail-list reads and scenario attachments explicitly filter by active `org_id`, in addition to database RLS. This matters for users independently authorized in multiple organizations.
- The edit hydration effect checks its lifetime before setting form/error state and includes active organization in its dependencies. Form contents and draft notes reset with the tenant subtree. No financial formulas, unit transformations, photographs, or production property records were changed.
- Tenant records are not persisted by the query abstraction. Browser tests check local/session storage, Cache Storage, IndexedDB, service workers, reload, and history. The SDK's synthetic persisted auth session and authorized organization preference are handled separately from tenant records.

## Per-file scope review

All retained application changes are required or justified adoption of the shared abstraction. No unnecessary page/component churn was found. Excessive invalidation on unchanged token renewal and background polling was removed during this continuation.

| File | Classification | Purpose |
| --- | --- | --- |
| `mfda/package.json` | required | Regression command and pinned browser test dependency. |
| `mfda/package-lock.json` | required | Reproducible Playwright dependencies. |
| `mfda/src/lib/auth.jsx` | required | Identity generation, session event ordering, immediate local hiding, expiration. |
| `mfda/src/lib/org.jsx` | required | Current-user membership, organization validation, response ordering. |
| `mfda/src/lib/queries.js` | required | Explicit active-organization read predicates. |
| `mfda/src/lib/tenant-query.jsx` (new) | required | Tenant subtree, query keys, cache lifecycle and cache operations. |
| `mfda/src/main.jsx` | required | Install the boundary under auth and organization providers. |
| `mfda/src/pages/Compare.jsx` | required | Scope detail/scenario queries to the active organization. |
| `mfda/src/pages/DealNew.jsx` | required | Scope edit/contact reads and ignore stale hydration. |
| `mfda/src/pages/DealResults.jsx` | required | Scope detail/scenario/contact reads. |
| `mfda/src/pages/Deals.jsx` | justified shared abstraction adoption | Identity-scoped lists and invalidation. |
| `mfda/src/pages/Goals.jsx` | justified shared abstraction adoption | Goals and linked-deal caches. |
| `mfda/src/pages/Markets.jsx` | justified shared abstraction adoption | Tenant-owned stats, coverage and targets. |
| `mfda/src/pages/OffMarket.jsx` | required | Scoped cached parcel/lists and saved-list reads. |
| `mfda/src/pages/OffMarketDeal.jsx` | required | Active-organization parcel details and cache operations. |
| `mfda/src/pages/OnMarket.jsx` | justified shared abstraction adoption | Listing, scanner, reference-data caches and updates. |
| `mfda/src/pages/Settings.jsx` | justified shared abstraction adoption | Membership/admin-invitation cache and role lifecycle. |
| `mfda/src/components/CompsAssist.jsx` | justified shared abstraction adoption | Tenant-owned comparison rows. |
| `mfda/src/components/DealTrackingCard.jsx` | justified shared abstraction adoption | Goal lookup and deal invalidation. |
| `mfda/src/components/HeartButton.jsx` | justified shared abstraction adoption | Prefix optimistic cache updates consistently. |
| `mfda/src/components/NotesCard.jsx` | justified shared abstraction adoption | Tenant/identity-scoped notes and updates. |
| `mfda/src/components/RentBandsCard.jsx` | justified shared abstraction adoption | Tenant-owned reference rows. |
| `mfda/src/components/RentEstimator.jsx` | justified shared abstraction adoption | Tenant-owned reference/usage caches; calculation logic unchanged. |
| `mfda/supabase/migration_015_p0_invitation_authorization.sql` (new) | required | Trusted invitation authorization. |
| `mfda/security/baseline.test.mjs` (new) | required | Reproduce both original defects without changing this tree. |
| `mfda/security/db-harness.mjs` (new) | required | Disposable PostgreSQL and synthetic auth/RLS fixtures. |
| `mfda/security/browser-harness.mjs` (new) | required | Real SPA/SDK/browser with a PostgreSQL-backed local adapter. |
| `mfda/security/invitations.test.mjs` (new) | required | Authoritative invitation regressions. |
| `mfda/security/tenant-browser.test.mjs` (new) | required | Browser tenant/session/state regressions. |
| This report and `evidence/mfda-p0-20261006/*` (new) | required | Closure record, command inventory and reproducible result evidence. |

The only direct React Query imports remaining in MFDA source are inside the abstraction. Static guide content and other components without tenant queries were not mechanically modified. `packages/mf-calc` and `workers/scan` match the original baseline, as do financial/UI/data transformation modules outside the listed lifecycle/read changes.

## Tests and harness review

All five inherited `mfda/security/` files are now completed test infrastructure or regression tests; none were deleted or left as temporary placeholders. The database harness requires local `initdb`, `pg_ctl`, and `psql`. The browser harness requires Node 20+ and Playwright Chromium, or `MFDA_TEST_BROWSER` pointing to an installed compatible browser. This run used Node v22.17.0 and the installed Playwright Chromium. No dependency installation or external lookup was needed.

The database harness strips database/Supabase environment overrides, uses a unique temporary Unix socket directory, disables PostgreSQL TCP, applies the real migration chain, and executes requests as the actual authenticated database role. Its minimal synthetic auth schema supplies `auth.uid()` and `auth.jwt()`; authorization functions, row locks, triggers, and RLS are real PostgreSQL behavior.

The actual SPA uses the real Supabase SDK with synthetic tokens. The browser adapter intercepts the synthetic `.invalid` host and translates the exercised reads/RPC into local SQL under RLS. It blocks other external browser requests. Vite environment files are disabled or isolated from the repository. Synthetic scenarios exercise rendering using the unchanged calculation engine.

Harness corrections retained assertions: the original SPA's duplicate organization options required observing the selected organization rather than an ambiguous text locator; original auto-created fixture organizations were removed before assigning the explicit synthetic memberships; browser/server teardown now completes before PostgreSQL/temp-directory cleanup. Request barriers have bounded waits. Markets received a synthetic marker; failures/retries and delayed/failing logout are explicit adapter controls. No application assertion was weakened to get a pass.

Initial sandbox execution reported three setup failures before any substantive test because macOS denied PostgreSQL shared memory. The authorized local rerun reported 44 passes and two failures: one ambiguous baseline locator and its parent container. All 20 invitation checks and 21 tenant-browser checks already passed. After repairs/expansion, the review run passed 62 checks; the final run after the last harness change passed 63.

## Required coverage mapping

| Requirement | Automated evidence |
| --- | --- |
| 1. Valid unexpired invitation | Member redemption, confirmed-new-user administrative invitation, returning-user pending RPC. |
| 2. Expired invitation | Expired bootstrap/RPC, exact boundary/timezone, transaction/lock expiration. |
| 3. Invalid invitation | Missing token, row ID, deleted/revoked row, wrong recipient, unconfirmed recipient. |
| 4. Consumed invitation cannot be reused | Repeat redemption rejection and consumed-row immutability. |
| 5. Wrong-org substitution fails | No extra organization parameter, RLS row change denial, authoritative returned organization and absence of foreign membership. |
| 6. Unauthorized role elevation fails | No caller role parameter, RLS denial, existing member remains member with fresh administrative invite. |
| 7. No membership before validation | Empty membership while row lock blocks validation; failure/expiry leaves it empty; consumption rolls back with membership failure. |
| 8. Enforcement beyond UI | Direct PostgreSQL RPC, trigger, role permission and RLS tests. |
| 9–11. A loads A-only deal; auth changes to B; B never renders it | Baseline reproduction plus sign-out/login and direct replacement tests, immediate absence and DOM observer assertions. |
| 12. Organization switching | Multi-org user switches across all shared screens; repeated edit transitions; known-ID reads contain active `org_id`. |
| 13–15. Reload, history and persistence | Back/forward, route changes, reload, fresh B session with stale A preference, storage/cache/database/service-worker checks. |
| 16. Delayed A responses | Held edit/data responses and delayed membership responses released after B becomes active. |
| 17. Failed/retried request | Actual repeated B detail requests, failure control, tenant predicates, DOM observer. |
| 18. Repeated transitions | Authenticated A → B → A → B and organization A → B → A → B. |
| 19. Shared tenant-scoped screens | Deals, results/contact/notes/tracking, compare, edit/reference/comps/usage, on-market, off-market/detail, goals, settings, markets; query-prefix inspection. |

Additional checks cover concurrent redemption (one success/seven rejections), revocation ordering, anonymous/private helper permissions, forward migration reapplication, database read/write isolation, role downgrade, membership removal, polling fallback, cross-tab auth changes, expiration, delayed/failing logout with persisted-session removal, and preservation of forms during unchanged renewal/polling.

## Final test matrix and counts

All final commands ran after the last code/harness change. Documentation/evidence writes afterward do not change executable source; source hashes are recorded in [source-review.json](evidence/mfda-p0-20261006/source-review.json).

| Target | Result | Passing | Failing | Skipped | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| Baseline controls | PASS | 2 leaf checks | 0 | 0 | [regression.txt](evidence/mfda-p0-20261006/regression.txt) |
| Invitation authorization | PASS | 21 leaf checks | 0 | 0 | Same regression log |
| Actual SPA browser integration | PASS | 37 leaf checks | 0 | 0 | Same regression log |
| Combined new regression command | PASS | 63 Node-reported checks | 0 | 0 | 60 leaves plus 3 parent containers, 3 test files |
| Existing `packages/mf-calc` tests | PASS | 244 tests | 0 | 0 | [calc-tests.txt](evidence/mfda-p0-20261006/calc-tests.txt), 17 files |
| Existing `workers/scan` tests | PASS | 186 tests | 0 | 0 | [scan-tests.txt](evidence/mfda-p0-20261006/scan-tests.txt), 12 files |
| Frontend production build | PASS | — | — | — | [build.txt](evidence/mfda-p0-20261006/build.txt) |
| Configured calculation typecheck | Pre-existing FAIL (exit 2) | — | 35 diagnostics | — | [typecheck.txt](evidence/mfda-p0-20261006/typecheck.txt) |
| Immutable baseline typecheck | Same pre-existing FAIL (exit 2) | — | Identical 35 diagnostics | — | [baseline-typecheck.txt](evidence/mfda-p0-20261006/baseline-typecheck.txt) |

Total: **493 reported passes, 0 failed tests, 0 skipped tests, across 32 test files**. Excluding Node parent containers, this is **490 individual checks/tests**. The unchanged existing suites still contribute 430 tests across 29 files. Typecheck is a separate failing check, not 35 failed runtime tests. MFDA had no pre-existing frontend test script or frontend typecheck configuration; the new command provides frontend browser/integration coverage. Scanner has no configured typecheck.

The frontend build uses the configured Vite production build API with synthetic Supabase URL/key and `envFile: false`; this is the same build operation as the configured `vite build` script with repository environment loading disabled. It exits 0, with the large-chunk advisory. No bundle optimization or UI redesign was attempted.

The 35 type diagnostics occur in unchanged calculation test files: comps, goals, offmarket, plausibility, proforma, and str. A separately extracted copy of the original SHA produces byte-identical typecheck output (`diff -u` exit 0). They are not introduced by this work and were deliberately left outside scope. No introduced test or build failure remains.

## Commands and final review

[commands.md](evidence/mfda-p0-20261006/commands.md) records the commands used in this continuation, including inspection, attempted sandbox execution, successful local runs, immutable baseline validation, evidence preparation, and final review. Test-source files contain the SQL fixture/assertion operations and child-process command templates. The previous interrupted session's complete command history is unavailable and is not reconstructed as a claim.

The final tracked diff and new modules/migration/tests were inspected. `git diff --check` passes. Pattern scanning of changed/new source found no private keys, AWS access keys, GitHub tokens, or Slack tokens; manual review confirms the test URL and token/key values are synthetic. Recorded source hashes correspond to the tested files. Baseline comparisons show no calculation, scanner, UI styling, photograph, or production property/unit-data changes. No production credentials/data were used. Existing `.netlify/` content remains byte-identical. The working tree remains uncommitted.

## Remaining limitations and unverified behavior

- Local PostgreSQL and a synthetic browser API adapter are exercised, not a deployed Supabase Auth/PostgREST stack. Hosted auth email delivery, deployed RPC exposure/schema-cache refresh, and production migration application are unverified. No production access was requested or used.
- Historical memberships granted before migration 015 are preserved and were not audited or removed. This report establishes correct future authorization after migration application, not a retrospective review of real memberships.
- Membership/role revocation is discovered through foreground/route checks, realtime where available, or a 30-second background poll. Without notification, an already-authorized idle view may remain until the next check; subsequent database operations still enforce current RLS. Instant server-pushed revocation is not claimed.
- Foreground/route/explicit revalidation intentionally discards the tenant subtree and unsaved local drafts while checking authorization. Unchanged token renewal and unchanged background polling preserve forms. This is a lifecycle behavior change, not a financial or UI redesign.
- Browser tests use Chromium. Firefox/WebKit, browser process restart, true cross-document back-forward-cache restoration, every individual mutation/export/PDF interaction, and hosted realtime delivery are not exhaustively tested. SPA history, reload, storage, SDK events, queries, delayed hydration, and cross-tab auth are covered.
- The auth fixtures are minimal and synthetic. The local test harness requires installed PostgreSQL tools/browser binaries and platform permission for PostgreSQL shared memory/browser startup. No assertion is silently skipped when these prerequisites are missing.
- The pre-existing 35-diagnostic calculation typecheck failure remains. Secret pattern checks plus manual review are evidence of this diff review, not a claim of an exhaustive repository-wide credential audit.

No financial Round 1 or unrelated Round 0 remediation was begun.
