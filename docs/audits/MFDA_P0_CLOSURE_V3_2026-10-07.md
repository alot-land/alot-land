# MFDA P0 Closure V3 — 2026-10-07

| Required verdict | Local verdict | Basis |
| --- | --- | --- |
| N-1 | **CLOSED** | Independently reproduced before editing. Held cache/usage/session continuations cannot initiate the obsolete proxy request; late results/errors/writes are suppressed. Proxy independently requires verified Auth identity and authorized org membership. |
| P0-1 local | **CLOSED** | All original invitation authorization, consumption, concurrency, populated migration and invitation-author deletion assertions remain unchanged and pass. |
| P0-2 local | **CLOSED** | N-1 and the previously named tenant cache/export/report/navigation defects pass the local regression matrix. This is not certification of every compound helper or cancellation of already initiated server work. |

**No hosted or production closure is claimed.** No commit, push, merge, deployment or hosted migration occurred. V3 stops here; financial Round 1 was not started.

## 1. Branch and starting SHA

Repository: `alot-land/alot-land`. Branch: `hardening/mfda-p0-closure-v3`.

Required and observed starting HEAD: `b9288e13f83b2dd5a36718165cf84c8aab1cb6a5`. HEAD remains unchanged because this remediation is uncommitted.

The baseline commands were printed and executed before any edits:

```text
pwd
/Users/davidastone/code/alot-land/alot-land
git remote -v
origin https://github.com/alot-land/alot-land.git (fetch)
origin https://github.com/alot-land/alot-land.git (push)
git branch --show-current
hardening/mfda-p0-closure-v3
git status
No tracked changes; only untracked .netlify/.
git rev-parse HEAD
b9288e13f83b2dd5a36718165cf84c8aab1cb6a5
git log --oneline -5
b9288e1 Close MFDA P0 independent audit blockers
9f8c6de Close MFDA P0 tenant isolation and invitation authorization defects
c800392 Read each county's own land-use vocabulary instead of guessing WHERE clauses
e413634 Click a county on Markets, get its parcels — automatic acquisition queue
00393a5 Record the field-verified statewide parcel findings (TN, VA, IN)
git merge-base HEAD origin/hardening/mfda-p0-closure-v2
b9288e13f83b2dd5a36718165cf84c8aab1cb6a5
```

Remote-tracking refs were inspected locally; no fetch or assertion about current remote state is made. `.netlify/` contents were not read or used. A metadata-only inventory of 1,027 entries compared unchanged at the final safety check.

## 2. Re-audit evidence and pre-fix N-1 reproduction

Read the full second re-audit directly from:

```sh
git show audit/mfda-p0-v2-independent-reaudit:docs/audits/MFDA_P0_V2_INDEPENDENT_REAUDIT_2026-10-07.md
```

Its verdicts were BLOCKER A PASS, BLOCKER B PASS, P0-1 CONDITIONAL PASS, P0-2 FAIL and deployment gate A, NOT SAFE TO DEPLOY. The report informed reproduction targets; the implementation was derived from the inspected application, SDK and schema.

Before application edits, a newly authored diagnostic used the actual SPA, Auth SDK, disposable PostgreSQL, synthetic A/B users and orgs, and an intercepted proxy:

1. A opened its synthetic deal edit and clicked Address-level RentCast.
2. The actual A-authorized empty cache result was held.
3. SDK identity changed to B; the header and SDK session both showed B.
4. Releasing the cache miss initiated a proxy request with `A ONLY SECURITY CANARY, AZ, 85001`, no Authorization header, while B remained active.
5. A separate import of the actual pre-fix proxy returned HTTP 200 to an unauthenticated synthetic request and invoked the RentCast stub exactly once.

Both reproduction assertions passed. No real upstream fetch occurred. [Program](evidence/mfda-p0-v3-20261007/pre-fix-reproduction.test.mjs) and [transcript](evidence/mfda-p0-v3-20261007/pre-fix-reproduction.txt) are preserved. This program intentionally expects vulnerability and is for the starting SHA, not the remediated working tree.

## 3. Complete flow and root cause

`DealNew` passes its current org/user and form address/unit inputs to `RentEstimator`. ZIP reference data and the initial rent usage query use the tenant-query wrapper. The direct paid action previously bypassed the completion guard:

```text
UI action → RentEstimator.fetchApi
  → getRentEstimate(org, normalized address + ZIP, bedroom sentinel)
  → cache miss → fresh countRentcastCalls(org)
  → fetchRentEstimate(full address, bedrooms, squareFootage)
  → Netlify rent-estimate → RentCast
  → cost_ledger write + usage invalidation
  → local result → rent_estimates upsert → Apply UI
```

The original closure retained A's props across awaits. Tenant unmount disposed A's query client and form, but did not stop the old action from initiating global network work. The SDK selects its bearer asynchronously; a later A-filtered usage read under B could return zero through RLS, enabling the unguarded proxy continuation. The proxy checked only key configuration, address and upstream response, so later RLS write denials could not undo the outbound request.

Inspected auth's synchronous snapshot, org's current ref, user/org/role generations, lifetime invalidation and the tenant query wrapper. The existing completion infrastructure already handles auth/org transitions before React commit, unmount, expiry/loading, role changes and A → B → A; it needed adoption by this action.

## 4. Client remediation

`RentEstimator` captures the initiating `useTenantCompletionGuard` ticket before asynchronous work. It checks that same ticket after cache/usage awaits and before proxy initiation, result publication, cache writes, usage writes/invalidation, errors and busy-state completion. Apply and consent callbacks also require a current authorized lifetime. Returning to A cannot revive the first A action.

`fetchRentEstimate` requires initiating org/user and the captured predicate. It reads the SDK session, then rechecks both lifetime and session user before the actual fetch. This closes the additional async session-lookup interval. It sends `Authorization: Bearer <session token>` and explicit `orgId` with `cache: no-store`.

After an already initiated upstream attempt settles under another scope, no new ledger/cache write or result/error UI is released. A ledger/cache operation initiated while authorized can finish later; its captured payload remains attributed to A, and subsequent continuations are guarded. Existing RLS remains independent.

Cache hits still publish authorized cached results without upstream usage. Same-scope misses, failures and fresh quota checks retain their behavior. Proxy refusals before RentCast do not create misleading usage entries: the proxy reports whether it attempted upstream contact, and the client meters only reported attempts within a current lifetime.

## 5. Proxy authorization remediation

The function accepts GET with a bearer and explicit UUID `orgId`. Trusted server configuration supplies `SUPABASE_URL` / `SUPABASE_ANON_KEY`, with existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as compatible fallbacks. These must be available to the function runtime; absent configuration fails closed.

Before RentCast:

1. Reject missing/malformed bearer and missing/malformed org.
2. Call the configured Supabase `/auth/v1/user` using the bearer and public anon key. Identity comes from this trusted Auth result; caller `userId` is ignored.
3. Read `org_members` through PostgREST with the same bearer/RLS, filtering both verified user and supplied org. Require an exact matching membership row.
4. Reject invalid Auth, absent/revoked/forged membership, unavailable services or malformed responses before upstream contact.

Any existing member may estimate for its org, matching the current rent-cache/ledger RLS model. No service-role key or migration is introduced. Auth, membership and RentCast fetches reject redirects. Responses use `Cache-Control: no-store`. Auth/PostgREST bodies and exception details are never echoed. Upstream credential failures also use fixed messages rather than raw bodies or key length.

RentCast receives only address/property type/bedroom/bathroom/area lookup parameters and its server API key. The bearer, org and user identifiers are not forwarded. Manual new-deal addresses are free-form; membership authorizes use in that org, not ownership of a persisted property row.

## 6. New deterministic tests

[rent-browser.test.mjs](../../mfda/security/rent-browser.test.mjs) adds **23 individual browser checks**, plus its parent report. They use the actual bound UI action, providers, SDK, query clients and authenticated local SQL. Explicit response barriers hold cache, usage, proxy, session and ledger stages. Tests await the action's full promise settlement for negative assertions.

| Required rent case | Coverage |
| --- | --- |
| A remains A; same-scope miss | Actual success, bearer/org payload, exact cache/ledger attribution and rendered result. |
| Cache miss across user switch | No obsolete proxy or usage follow-on. |
| Cache miss across org switch | Same assertion for a user authorized in both orgs. |
| Request already initiated, then transition | User/org held proxy success cannot publish result or write cache/ledger. |
| Late failure | User/org proxy failures and cache failure produce no stale error or usage write. |
| A → B → A | First result remains obsolete; fresh second-A estimate succeeds, for both user and org transitions. |
| Fresh B estimate | User/org B success, B address and B org/write attribution after suppressing A. |
| B state/query/cache | No A markers; obsolete query client empty and current query keys scoped to B. |
| Usage/metering | No cancelled A writes under B; already initiated A log has no later cache/result follow-on. |
| Same-scope cache hit | Actual saved cache read; no additional proxy or ledger write. |
| Session interval / logout / renewal | User/org changes during helper session read suppress fetch; logout suppresses continuation; same-user token renewal succeeds. |
| Quota and errors | Fresh quota refusal, non-metered authorization refusal and metered same-scope upstream failure. |

[rent-proxy.test.mjs](../../mfda/security/rent-proxy.test.mjs) adds **22 individual function checks**, plus its parent report. Synthetic opaque token/Auth fixtures validate the trusted boundary; one check uses actual authenticated local PostgreSQL RLS for accepted, cross-org and revoked membership. Every rejected request asserts zero RentCast calls. Tests cover missing/malformed bearer, invalid/expired session, no access, forged/missing/malformed org, mismatched membership rows, ignored forged user identity, valid access, service/configuration failures, malformed responses, unsupported method, unconfigured key, missing address, generic credential-safe errors and absence of browser/server-role secrets. Global fetch is stubbed and restored; no production credentials are used.

## 7. Prior P0 preservation and independent diagnostics

All six supplied P0 files are byte-unchanged from the starting SHA and pass: **95 reported tests / 89 individual checks**. Invitation authorization, consumed lifecycle, invitation-author deletion, tenant cache isolation, stale CSV suppression, export history, PDF/report guards, navigation and role/org/user generations remain intact. No migration, calculation, scanner, package/lockfile, CI, underwriting, photo, unit-data or product-polish change was made.

The second reviewer’s two diagnostic files also ran: **22 reported tests / 19 individual checks**. Its CSV program is byte-identical. Its SQL, PDF renderer, synchronous snapshot and navigation assertions remain unchanged. Only its two N-1 expected-vulnerability assertions were strengthened to require zero stale outbound/writes and unauthenticated HTTP 401 with zero upstream calls; full source transformation is preserved in [verify.mjs](evidence/mfda-p0-v3-20261007/verify.mjs). This is a regression reuse of reviewer diagnostics, not a third independent review.

Actual delayed renderer controls still produce valid A/B PDF bytes, reject old-lifetime URLs and revoke ready A URLs. Actual paged CSV still exports 1,001 rows under A and suppresses the obsolete two-page org roundtrip.

## 8. Full matrix, build and typecheck

| Final validation | Result | Passes | Failures | Skips/cancellations |
| --- | --- | ---: | ---: | ---: |
| Complete MFDA P0/security, 8 files | PASS | **142** | 0 | 0 |
| Of those: original supplied suite | PASS | **95** | 0 | 0 |
| Of those: new rent continuation + proxy suites | PASS | **47** | 0 | 0 |
| Second-review diagnostic regressions, 2 files | PASS | **22** | 0 | 0 |
| `packages/mf-calc`, 17 files | PASS | **244** | 0 | 0 |
| `workers/scan`, 12 files | PASS | **186** | 0 | 0 |
| Frontend production build | PASS, exit 0 | — | 0 | — |
| Browser build server-secret scan | PASS | — | 0 | — |
| Configured calc `npm run typecheck` | FAIL, exit 2 | — | **35 pre-existing diagnostics** | — |
| Fresh original-baseline typecheck | FAIL, exit 2; byte-identical transcript | — | **Same 35** | — |

Final aggregate: **594 reported passes / 583 individual checks in 39 test files**. Security counts include 11 parent containers across the supplied/new/reviewer tests. Subset rows and repeated runs are not added again.

Calc and scanner use their configured `npm test`; calc uses its configured `npm run typecheck`. The complete security command and all matrix commands are captured in [results.json](evidence/mfda-p0-v3-20261007/results.json). The current typecheck transcript is byte-identical to a fresh extraction of every committed calc file at `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`, using the installed dependencies. Calc/scanner trees are unchanged from both that original baseline and the V3 starting SHA. No new diagnostic was introduced; typecheck remains failing.

Vite built from the MFDA working directory with `envDir: false`, synthetic public settings and temporary output outside the repository. Synthetic server-secret canaries were absent from all generated JS/HTML/CSS/maps; no service-role variable, server RentCast endpoint or API-key header entered the browser bundle. The existing chunk-size advisory remains.

## 9. Attempt accounting

Non-final attempts are excluded from green totals and documented rather than skipped:

- Initial reproduction was denied PostgreSQL shared memory by the sandbox (one pure proxy probe passed). The permitted local rerun used the MFDA working directory; an earlier root-directory run encountered the known Tailwind configuration issue. The successful pre-fix transcript is preserved.
- New-test development first reported 34 pass / 11 fail (including parents): initial-usage count assumption, incorrect sign-in locator and a secret regex matching the safe word “Authorization.” Those harness assertions were corrected; no supplied assertion changed. A second run reported 45 pass / 2 fail because the synthetic cross-origin count header was not exposed. The adapter now exposes it; standalone rent acceptance passed 47/47.
- Two diagnostic-extraction attempts failed before tests because literal `$` in a replacement string was interpreted by `String.replace`; replacement now uses a callback.
- The first combined matrix ran both browser programs concurrently. Vite's default port collided (`Port 5173 is already in use`); cleanup removed the temporary baseline while the failed server retained watchers. Only that owned stalled test child was terminated to release its buffered error. This attempt reported 140 pass / 1 fail, not closure. The complete suite was rerun alone and passed 142/142; future runner phases are sequential.
- The first production compilation succeeded, but an overbroad secret-name scan flagged the existing Guide text naming `RENTCAST_API_KEY`. Inspection confirmed zero canary secrets, service-role references or RentCast server endpoints. The corrected scan and fresh build pass.

Development and infrastructure transcripts remain in the evidence directory, including `security-infrastructure.txt` and `build-first.txt`.

## 10. Adjacent external continuation review

Searched MFDA for direct fetches, third-party URLs, async callbacks, serverless functions, geocoding, maps, exports and integrations. The only application-native tenant action directly fetching a third-party proxy is the rent helper; the only MFDA serverless function is this proxy.

CompsAssist reads stored comps through the tenant wrapper; it does not geocode or call an external comps API. Google Maps/Street View/listing/contact links are synchronous. Leaflet requests public tile coordinates and removes its map on tenant unmount. FreedomSoft is local CSV generation/download, with the existing guarded callers; there is no separate integration API/queue. PDF image/render work may finish privately, but the installed renderer/lifetime output checks still pass. No additional exact held-tenant-read → third-party-request exploit was proved, and no unrelated path was edited. Photo/tile network cancellation is not certified.

## 11. Deferred compound-helper risk

Inspected `upsertDeal` (lookup then insert), `replaceUnits` (delete then insert), `createMailList` (list then item batches), `deleteDeals` (notes then deals), and paged reads. They do not carry a per-await lifetime ticket internally. Their final visible callers/query boundaries use the shared guard, and SQL RLS still applies, but an operation can continue old-org work for a user authorized in both orgs.

The rent action now reuses the existing shared completion infrastructure. No transactional helper rewrite was needed to close N-1. No additional B artifact or privilege leak was reproduced from these helpers; their atomicity and cancellation remain **POTENTIALLY VULNERABLE / deferred**, not certified safe by this report.

## 12. Remaining limitations and unverified work

- Hosted Supabase Auth/PostgREST, runtime configuration, grants/ownership, RPC visibility, schema drift, historical memberships, realtime and production rollout remain unverified. Local Auth/HTTP adapters are synthetic; actual hosted acceptance is still required.
- The server validates membership in the explicitly requested org. It has no server-side registry of the browser's active-org generation; a member of both orgs may legitimately request either. The client guard enforces active-view lifetime. Membership and upstream HTTP are not one atomic transaction.
- Already initiated proxy/server operations are not retroactively revoked by a browser transition. Obsolete results and new client follow-ons are suppressed. Already initiated writes can settle with their original payload/RLS.
- Metering remains a client advisory, not global/account-wide quota enforcement. Suppressing stale writes, client transport failures and concurrent users can undercount attempts. Server metering, quota reservation and accounting reconciliation were not added.
- N-2 remains: the pre-existing `rent_estimates.created_by` NO ACTION FK can block Auth-user deletion independently of invitations. The reviewer diagnostic reproduces its rollback again. No author-retention/deletion migration was made.
- Compound-helper continuation/atomicity remains deferred. Known foreground draft loss during revalidation also remains outside V3.
- Chromium/local SDK and actual local SQL were exercised. Firefox/WebKit, hosted caching/BFCache, legacy native download behavior, live migration locks and real external RentCast behavior were not exercised.

## 13. Final safety review and changed files

Reviewed the complete diff and all changed/new code, tests, diagnostic transformations and evidence summaries. `git diff --check` and whitespace checks on new files pass. Changed/new files were scanned for private keys, cloud credentials, secret tokens and credential-bearing database URLs; no credential findings. Server-secret response tests and the production-bundle canary scan also pass.

Application changes are limited to:

- `mfda/src/components/RentEstimator.jsx`
- `mfda/src/lib/queries.js` (rent request contract and meter documentation)
- `mfda/netlify/functions/rent-estimate.mjs`

New deliverables:

- `mfda/security/rent-browser.test.mjs`
- `mfda/security/rent-proxy.test.mjs`
- This report and [V3 evidence](evidence/mfda-p0-v3-20261007/).

All identities, orgs, deals, addresses, invitation rows, sessions and keys used in tests are synthetic. PostgreSQL uses disposable local Unix-socket clusters with TCP disabled; browser external traffic is intercepted/blocked. The actual server-handler tests replace upstream fetch. **No real RentCast call, production data/credential use, hosted migration, commit, push, merge or deployment occurred.** `.netlify/` remains the pre-existing untracked directory, untouched.
