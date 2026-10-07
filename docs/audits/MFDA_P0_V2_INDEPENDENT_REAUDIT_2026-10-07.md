# MFDA P0 V2 second independent re-audit — 2026-10-07

**Deployment gate: A. NOT SAFE TO DEPLOY.** Both named first-review blockers are corrected locally. The wider tenant-completion claim fails on another continuation: a held A rent-cache miss initiates an A-address RentCast request after B is active. The actual proxy handler has no authentication or organization authorization check before forwarding that request. No real upstream request was made in this review.

| Required verdict | Verdict | Basis |
| --- | --- | --- |
| BLOCKER A | **PASS** | Authorized deletion is no longer blocked merely by authoring a consumed invitation; the invitation and exact consumption timestamp survive. |
| BLOCKER B | **PASS** | Pending saved-list CSVs are suppressed through preparation, Blob/URL creation, download and logging after auth/org/lifetime changes. |
| P0-1 | **CONDITIONAL PASS** | Trusted local SQL authorization remains corrected. Real hosted Auth/PostgREST/ownership/grants and historical membership disposition are unverified. |
| P0-2 | **FAIL** | Query-cache isolation and the named CSV defect pass, but RentEstimator retains an unguarded externally observable continuation, N-1 below. |

PASS for a named blocker is a conclusion about the independently exercised local defect, not hosted deployment certification. This review changed only its report and evidence. Application code, supplied tests, migrations and lockfiles remain unchanged.

## 1. Review branch and baseline verification

Review branch: `audit/mfda-p0-v2-independent-reaudit`. Repository: `alot-land/alot-land`.

Before reviewing, the eight requested commands were printed. They returned:

```text
pwd
/Users/davidastone/code/alot-land/alot-land
git remote -v
origin https://github.com/alot-land/alot-land.git (fetch)
origin https://github.com/alot-land/alot-land.git (push)
git branch --show-current
audit/mfda-p0-v2-independent-reaudit
git status
No tracked changes. Only untracked .netlify/.
git rev-parse HEAD
b9288e13f83b2dd5a36718165cf84c8aab1cb6a5
git log --oneline -5
b9288e1 Close MFDA P0 independent audit blockers
9f8c6de Close MFDA P0 tenant isolation and invitation authorization defects
c800392 Read each county's own land-use vocabulary instead of guessing WHERE clauses
e413634 Click a county on Markets, get its parcels — automatic acquisition queue
00393a5 Record the field-verified statewide parcel findings (TN, VA, IN)
git rev-parse origin/hardening/mfda-p0-closure-v2
b9288e13f83b2dd5a36718165cf84c8aab1cb6a5
git merge-base HEAD origin/hardening/mfda-p0-closure-v2
b9288e13f83b2dd5a36718165cf84c8aab1cb6a5
```

The prerequisite passed. The review branch starts directly at the committed V2 remediation, with no intervening review commit. Remote-tracking refs were inspected locally; no fetch or assertion about freshly queried remote state is made. The permitted pre-existing `.netlify/` directory was not read, modified or removed.

## 2. Reviewed SHA

`b9288e13f83b2dd5a36718165cf84c8aab1cb6a5`. HEAD remained that SHA throughout the review.

## 3. Original vulnerable SHA

`c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`.

## 4. First remediation SHA

`9f8c6de4a71955d3dceb937da93fe14ff5c39722`, the immediate parent of V2.

## 5. Scope and independence

This reviewer did not implement V2. Prior reports, implementation comments and existing green transcripts were treated as claims, not proof. The supplied suite was run unchanged; independently authored diagnostics reused only the inspected disposable PostgreSQL/browser setup. They exercise the real SPA, SDK, SQL, renderer, browser downloads and mutation handlers.

All identities, tokens, organizations, properties, addresses and invitation rows were synthetic. PostgreSQL ran in fresh temporary clusters through Unix sockets, with TCP disabled. Browser requests outside localhost and the intercepted synthetic `.invalid` API were blocked. The RentCast frontend request was intercepted locally; the server-handler diagnostic replaced only upstream fetch and set a synthetic key. No production data, customer credentials, hosted migrations, deployment, merge or financial Round 1 work occurred.

## 6. Prior findings reviewed

Read `docs/audits/MFDA_P0_CLOSURE_V2_2026-10-06.md`, the original `MFDA_P0_SECURITY_CLOSURE_2026-10-06.md`, and the first independent report directly with:

```sh
git show audit/mfda-p0-independent-reaudit:docs/audits/MFDA_P0_INDEPENDENT_REAUDIT_2026-10-06.md
```

The earlier R-1 author-deletion blocker and R-3 delayed saved-list export were the named acceptance targets. R-2 foreground draft loss remains acknowledged and unchanged. R-4's former request-identity assertion was inspected against the V2 replacement. Prior reports' uncommitted-work descriptions are historical; the verified committed SHA above is authoritative here.

## 7. Source review and output inventory

Inspected the complete auth/org/completion/query modules, `main.jsx`, `App.jsx`, `freedomsoft.js`, `queries.js`, `ReportButton`, `ReportDocument`, and tenant read/write call sites in DealNew, OffMarket, OffMarketDeal, OnMarket, DealResults, Compare, Deals, Goals, Markets and Settings. Inspected NotesCard, HeartButton, DealTrackingCard, RentEstimator, CompsAssist, reference-data cards, map callbacks, tooltip portals, theme and lazy reload behavior. Searched all `mfda/src` for downloads, Blobs, object URLs, clipboard, file APIs, promises, timers, navigation, storage and React Query imports.

The entire preceding SQL chain was executed; invitation/auth/org functions, triggers, policies and every Auth-user FK were inspected. The order is `schema.sql`, 002–012, 013, **013a**, 014, then 015. Earlier SQL is unchanged from the vulnerable commit. Migration 012 replaces the bootstrap and must precede 015.

| Output/action path | Classification | Independent justification |
| --- | --- | --- |
| Saved-list CSV, saved campaign export | **SAFE** | Initiating lifetime retained through paged read; final preparation/download guard; negative artifacts/history and positive bytes exercised. Campaign export uses the same saved-list handler. |
| Filtered parcel FreedomSoft CSV | **SAFE** | Synchronous current-view preparation plus guarded native Blob/URL/anchor boundary. Actual bytes exercised by supplied suite. |
| FreedomSoft integration | **SAFE** | In this app it is CSV formatting and download, with guarded callers. No separate FreedomSoft API integration or queue exists. |
| Deal PDF/report | **SAFE** | Installed renderer queue cancels obsolete success; URL revocation and capture-phase click guard supplement tenant unmount. Held real renderer results independently exercised. |
| PDF photos/image fetches | **SAFE** for tenant-visible report completion | A pending image/render may finish computing privately; cancelled renderer cannot publish its obsolete PDF URL. Public listing image downloads themselves are not protected tenant records. Photo-network cancellation is not certified. |
| DealNew final navigation; OffMarketDeal promotion/lookup; OnMarket Analyze | **SAFE** at final visible boundary | Captured predicate before follow-ons/final navigation and stale error paths; independent held edit/lookup checks plus supplied held Analyze passed. |
| Favorite/rating/tracking/note/goal/settings/market success and cache callbacks | **SAFE** for current B UI/cache | Old subtree/local setters remain detached; wrapper refuses obsolete cache writes/invalidations. Existing server operations still require current RLS. These are not generic cancellation of every server write. |
| Compound `upsertDeal`, `replaceUnits`, `createMailList`, `deleteDeals` internals | **POTENTIALLY VULNERABLE** to continued work | No per-await lifetime predicate within helpers. An operation may initiate another old-org write after transition, particularly for a user authorized in both orgs. No B artifact/navigation was reproduced; final callers guard or remain detached. Atomicity and cancellation are not certified. |
| RentEstimator cached-result local state | **SAFE** for B component state | Old component is detached; old local setters cannot populate the newly mounted B form. This does not protect its subsequent requests. |
| RentEstimator cache/usage miss → RentCast proxy → cost/cache writes | **VULNERABLE** | Independent held-cache probe observed A address in a new proxy request under B; N-1. |
| Existing synchronous listing/contact/Street View/map links | **SAFE** for reviewed transition class | No awaited global continuation; tenant subtree/map is disposed. Map “Open report” is synchronous navigation to parcel detail, not another file generator. |
| Static guide/theme/tooltip placement/lazy chunk reload | **NOT TENANT SCOPED** | No asynchronous tenant artifact release. Tooltip portal belongs to the disposed React subtree. Lazy import failure may reload the current app, not restore A data. |
| Sign-in gate/OTP request | **NOT TENANT SCOPED** | Authentication workflow on entered email; membership authority remains SQL, not the sign-in gate. |
| Clipboard export, other generated files, standalone deal CSV, campaign PDF, queued report worker | No corresponding MFDA frontend flow found | Source search found only the CSV helper and installed PDF download link as file-artifact producers. No invented flow is classified as exercised. |

No tenant-scoped React Query consumer imports TanStack directly: the only import/re-export is in `tenant-query.jsx`. Searches and migration references are retained as `source-inventory.txt` and `migration-inventory.txt` in the evidence directory.

## 8. Blocker A independent analysis

`invites.invited_by` remains nullable with `REFERENCES auth.users(id) ON DELETE SET NULL` (`schema.sql:38`). **V2 alters no FK.** The correction is the BEFORE UPDATE trigger at `migration_015_p0_invitation_authorization.sql:118`.

A consumed row may change only when old `invited_by` is non-null, new author is null, every other field is identical, and the old author no longer exists. The JSONB comparison excludes only `invited_by`, including future columns. The lookup is SECURITY DEFINER with empty search path and qualified relations. A client cannot null a living author's reference or invoke the private cleanup function/helper. During an authorized FK cleanup, the DELETE is visible to its own transaction, so the lookup sees the author absent. Any later failure rolls back both deletion and cleanup.

The independent probes created populated consumed/pending history before applying 015, compared complete snapshots and FK catalog definitions, reapplied 015, and deleted through a restricted Auth writer in SERIALIZABLE isolation. The consumed row remained byte-equivalent as JSON except `invited_by: null`, including its microsecond acceptance timestamp. An added synthetic future history column could not be changed through a combined nulling operation; that diagnostic-only column existed solely in the disposable database.

| Required invariant | Evidence and result |
| --- | --- |
| 1. Otherwise-authorized author deletion | Independent restricted-writer deletion succeeded; supplied restricted Auth writer also passed. |
| 2–3. Row and accepted_at preserved | Exact full-row comparison, fixed microsecond timestamp, no invitation deletion. |
| 4–7. Replay, retarget, role and security-field edits denied | Independent replay/combined edits/future-column check; supplied all-column ID/org/email/role/token/author/acceptance/expiry/creation checks. |
| 8–9. Author deletion neither deletes nor reactivates invitation | Row remains consumed and replay rejects afterward. Pending invitation remains pending with null author. |
| 10. Memberships unchanged | All other users' memberships remain exact. Deleted user's own membership cascades through the pre-existing user FK; that intended change is not described as “no memberships changed.” |
| 11. Unrelated organization history preserved | Independent org and other-author/other-org note snapshots unchanged; supplied deal/note histories retained. There is no Auth-user → organization cascade. |
| 12–16. Valid, expired, unverified, substituted and existing-member flows | Independent direct DB probes plus authoritative supplied cases pass. Existing member stays member even when consuming an admin invitation. |
| 17. Concurrency/replay | Six independent simultaneous redemptions yield one success/five explicit rejections; supplied eight-way race, lock/expiry/revocation/rollback cases pass. |
| 18. Populated upgrade | Independent pre-015 row/FK snapshots unchanged; supplied populated/fresh chains and repeated migration pass. |
| 19. Ordering | Actual full chain includes 013a before 014/015; 012 is the last earlier bootstrap replacement. |
| 20. In-place 015 revision | Appropriate for the stated unapplied-hosted migration. A site with an earlier 015 installed needs separately reviewed migration tracking, not an assumption that its ledger will reapply this file. |

Consumed history is not a tamper-proof ledger: existing org-admin invitation DELETE and organization cascades are unchanged. The guarantee tested is preservation during author deletion and denial of consumed-row UPDATE/redeem, not irrevocable retention against a trusted organization administrator.

The new restrictive rent-estimate FK deletion edge is documented separately in N-2. It does not disprove the specific claim “deletion no longer fails merely because of a consumed invitation.”

## 9. Blocker B independent analysis

The complete path is click → `exportSavedList` capture → `listParcelsForMailList`/`fetchPaged` → old async continuation → guarded `exportCSV` → `freedomsoftCSV` → `downloadCSV` → native Blob/object URL → anchor click → export history.

The guard binds user ID, auth generation, org ID, role, org generation and component lifetime. Auth publishes a synchronous snapshot before React commits. Organization scope is read from a synchronously updated ref. Layout cleanup invalidates lifetime and advances its ticket; StrictMode reactivation cannot restore an old ticket. Returning to A does not restore the old auth/org generation. Loading, expired auth and absent membership return no authorized current scope.

An independent SDK auth subscriber observed the old guard return false while the DOM still showed A, proving enforcement before React committed B. This closes the stale-closure/pre-render interval, rather than relying solely on eventual subtree removal.

`downloadCSV` checks before Blob/URL creation and again before clicking. Preparation and download are synchronous native JavaScript with no intervening await; normal auth events cannot run between those lines. Obsolete success/error paths are dropped. Only a released download starts `logMailExport`; payload retains initiating A org/user and cannot be relabeled B by a later token. RLS applies independently. Logging of a previously released A download may finish later; that is not a cancelled-export log or a B attribution.

| Required case | Result |
| --- | --- |
| 1. A remains A | Actual CSV bytes/name/history pass, including independent 1001-row positive control. |
| 2–3. User/org A → B | Supplied held responses produce no artifacts; successful B CSV afterward. |
| 4. A → B → A | Supplied auth/org cases and independent two-page org roundtrip discard the obsolete first operation. |
| 5. Delayed success | Captured authorized A response released under B produces no download. |
| 6. Failed/retried A | Held failure, manual retry and actual SDK automatic retry suppressed; no stale alert/artifact. |
| 7. B operation afterward | Positive B CSV and independent positive B PDF pass. |
| 8. Cache/state | B keys/DOM contain no A marker; retained old client empty and current client distinct. |
| 9–11. Download/Blob/URL/filename | Instrumented native artifact boundaries and download events remain empty for cancelled CSV; actual filenames/bytes asserted for legitimate downloads. |
| 12. Export history | Cancelled operations create no history; successful A/B payloads retain their own org/user. |
| 13. Backend/RLS | Real authenticated-role reads/inserts enforce membership. This verdict covers CSV; the separate RentCast proxy lacks such enforcement. |
| 14. SDK retry | SDK chooses bearer at send/retry time. Old A filter can be sent with B token; B RLS returns zero A rows. Guard also suppresses empty stale CSV/A filename. |
| 15. Repeated generation/stale closure | Source generations, real synchronous-snapshot probe, multi-page roundtrip and stale renderer tickets prevent reactivation. |

The independent 1001-row test uses actual offset/limit SQL under RLS, observes pages of 1000 and 1, and reads real downloaded CSV bytes. This supplements the supplied adapter's one-row exports and simplified pagination. A cancelled two-page response still completes its old reads but produces no CSV Blob, URL, download or log.

## 10. PDF/report completion review

This review resolved the stated delayed-renderer coverage gap locally. Installed versions: `@react-pdf/renderer 4.5.1`, `queue 6.0.2`. The diagnostic intercepts the locally served installed renderer module at exactly one `pdfInstance.current.toBlob()` call and wraps its real promise result in a controlled barrier. It does not replace the renderer, render queue, ReportButton, React boundary, cleanup or browser download with mocks. An assertion requires exactly one interception; a positive control reads the actual `%PDF-` file.

The installed `usePDF` creates a render queue. Unmount calls `renderQueue.end()`, which clears queued jobs and advances the queue session. A late promise's `next` checks the captured session before emitting success; obsolete success therefore never calls the URL-producing callback. Previously ready URLs are revoked by the hook's URL effect cleanup. ReportButton's capture-phase predicate prevents stale clicks before native download or the renderer's legacy `msSaveBlob` handler. There is no application `onRender` callback that releases a second artifact.

Independent results:

- Delayed A result while remaining A: valid 7036-byte PDF and expected A filename.
- Delayed result released after auth B or org B: no PDF object URL, report download link, browser download or A UI marker; old query client remains empty.
- A → B → A: every subsequently published Blob originates in the new A renderer lifetime; none originates in the obsolete first A operation.
- A promise released inside the B auth subscriber, before normal B-render waiting: no obsolete URL or download.
- A ready URL retained by the diagnostic: revoked after B replacement; fetching it afterward fails.
- After suppressing A, B's actual report downloads with `%PDF-` bytes and B filename.

The A → B → A diagnostic initially assumed exactly one new URL. Fresh authorized rendering can create two URLs during legitimate document updates. The corrected assertion tracks each Blob's initiation epoch through a WeakMap and requires every published URL to originate in the new A lifetime. It strengthens provenance evidence rather than tolerating an old A URL. The failed count assertion is retained, not called a product failure or added to green totals.

The shared click predicate alone would not stop a renderer from producing a URL. The justification is the full combination of queue-session cancellation, tenant unmount, URL revocation and final click guard. Discarded rendering may still allocate a private Blob or finish layout after transition; no claim is made that computation or memory allocation is cancelled. Tested obsolete results cannot produce a usable browser URL or user-visible report.

## 11. Mutation/navigation completion review

DealNew checks after upsert, unit replacement, scenario save and cost logging, and immediately before navigation. Its stale catch does not restore error state. Independent testing held an actual edit PATCH after A authorization, activated B, then resumed it: no units/scenario/cost follow-ons and no navigation. The already-completed A database update is not rolled back by client cancellation.

OffMarketDeal checks after existing-deal lookup, deal creation and unit replacement, before navigation and in catch/finally. Independent held lookup with an actual A existing result could not navigate B to that edit route. OnMarket checks the initiating predicate after its status write and before cache invalidation/navigation; supplied actual delayed SQL mutation passed.

OffMarket saved-list success/error/download boundaries are guarded. Save-list/delete-list/rating continuations retain old local component state; cache callbacks pass through the guarded wrapper. Other simple mutation callbacks in Goals, Settings, Markets, tracking and notes follow this same detached-subtree/cache pattern, with no awaited global navigation/download found.

The guards surround helper calls, not every request inside them. `upsertDeal` may insert after an awaited dedupe read; `replaceUnits` inserts after DELETE (and its DELETE error is not inspected); `createMailList` continues chunks; `deleteDeals` performs a later deal deletion. These existing compound behaviors deserve separate cancellation/atomicity verification. They are recorded as potential continuation risks, not falsely claimed tested at every stage or proven B data release. RLS remains the server boundary, and multi-org users may legitimately retain old-org authorization. RentEstimator's follow-on external call is the concrete failed path, N-1.

## 12. Original P0-1 regression review

The private validator reads a confirmed Auth email, locks the authoritative token row, checks wall-clock expiry after locking, recipient, consumption and allowed role, then inserts membership and consumes the invitation in one transaction. Client identity comes from `auth.uid()` in public RPCs. Org/role come only from the locked invitation. `ON CONFLICT DO NOTHING` prevents upgrading an existing member.

Expired, invalid/deleted, consumed, wrong-recipient, role/org/identity forgery and unverified cases all reject through real SQL without new membership. Valid new/returning/confirmation paths pass. The only automatic personal-admin exception is the explicit verified founder address already intended in the original design. PUBLIC/anon/authenticated cannot execute the private helper/trigger; authenticated has only intended public redemption/pending RPC grants in the local role model.

Local future authorization remains closed. Historical memberships are preserved rather than reconciled; deploying a future validator does not remove earlier inappropriate grants. No claim about actual customer memberships is made. Real hosted Auth lifecycle, ownership/inherited grants and RPC exposure remain acceptance conditions for P0-1.

## 13. Original P0-2 regression review

| Lifecycle | Evidence and result |
| --- | --- |
| A → logout → B | Supplied ten-screen SPA/SQL cases pass; immediate local hide and persisted-session removal exercised. |
| Direct replacement; repeated A → B → A → B | SDK cases pass; independent synchronous predicate and positive B deal/render cases supplement them. |
| Org A → B; repeated org transitions | Active-org predicates on detail/units/scenarios/contacts/parcels; generation/subtree reset; held two-page export passes. |
| Reload/history/storage | Supplied actual reload, SPA back/forward, stale org preference, storage/cache/IndexedDB/service-worker checks pass. No tenant-record persistence found in source. |
| Delayed hydration/startup/membership | Form hydration lifetime, auth event/version ordering, membership request/alive checks; held response cases pass. |
| Failed/retried requests | Supplied real SDK retries and current-key/client assertions pass; stale final CSV suppression verified. |
| Token renewal | Same-identity renewal preserves forms and pending authorized CSV; identity/generation changes cancel old work. |
| Membership removal/role downgrade | Focus/revalidation hides before held membership reads; polling cases fail closed; current SQL RLS rejects revoked membership. |
| Polling/revalidation | 30-second fallback exercised; unchanged background polling preserves form, changed scope invalidates boundary. |
| Cross-tab auth | Supplied real SDK cross-tab signout/replacement case passes. Hosted realtime remains unverified. |
| Query keys/disposal/in-flight completion | Identity/org/role/generations prefixed; distinct clients; old cache cleared/cancelled; late old data cannot populate B client. |
| Wrapper bypass | No direct tenant TanStack consumer found outside wrapper. Direct actions still require their own lifetime checks. |
| Non-query external continuation | **FAIL**, independently reproduced RentCast request after B activation, despite protected query/local state. |

The original cached-deal display defect remains corrected in exercised local paths. That narrower success does not establish completion isolation for all tenant data/output. N-1 disproves the broader P0-2 local closure claim. Idle cached-view revocation remains bounded by local notification/polling discovery; the guard does not magically learn server changes before that discovery.

## 14. Test design assessment

The supplied suite uses real PostgreSQL locks, triggers, definer functions and RLS rather than mocked membership decisions. The Auth schema/JWT functions and HTTP adapter are minimal synthetic approximations. Authenticated users are granted broad table privileges so RLS is actually exercised; these grants and synthetic token issuance do not certify hosted Supabase permissions or Auth.

The browser adapter runs actual SPA/SDK code but simplifies projection, sorting, pagination and some PostgREST shapes, returns synthetic list counts, blocks realtime and rejects ordinary writes. Export-specific routes translate the actual nested read/history writes into authenticated SQL. They do not bypass the production export handler. Independent paged SQL tests repair the important one-page coverage limitation without modifying the adapter or application.

Export negatives observe native CSV Blob creation, object URLs, anchor clicks, browser downloads, export-history inserts, caches and DOM. Positives read bytes and filenames. Held response bodies are consumed before completion assertions, followed by browser frames. The assertions would fail on the original unguarded download. Marker-based DOM observation alone is not universal proof of absence of every field; source lifetime tracing and actual artifact instrumentation supplement it.

R-4 correction is an improvement: it deliberately holds A's pending-invite RPC, changes SDK identity, then resumes the obsolete A-filtered membership read with B's token. It requires actual B RLS denial, an independent authoritative B membership load, unchanged B scope, empty discarded cache, a different current client, current B keys and no A display. It replaces an inaccurate universal historical request/JWT equality claim with observable authorization/lifetime properties. This review's complete supplied run passed that test without retrying it.

Some inherited timing tests still use 100ms sleeps to let a lock holder start, short expiration windows and fixed browser waits. They are not fully deterministic barriers under arbitrary load. The new R-4 path and held exports use explicit request barriers; independent diagnostics use bounded waits and renderer/result barriers. No inherited substantive timing failure occurred in this run; the earlier report's failure is not erased or reclassified as a new pass.

Node counts include parent containers: supplied **95 = 89 leaves + 6 parents**; independent **22 = 19 leaves + 3 parents**. Guard unit tests with synthetic scope arrays are useful limited tests, not proof of actual SPA adoption. Independent probes cover actual provider tickets before React commit and renderer lifecycle. Expected-vulnerability assertions can pass while proving an unsafe product, as N-1/N-2 do.

## 15. Independent diagnostics and evidence

Final programs and logs are under [evidence/mfda-p0-v2-independent-20261007](evidence/mfda-p0-v2-independent-20261007/).

| Diagnostic | Independent evidence |
| --- | --- |
| Populated migration/author deletion | `independent.test.mjs`: snapshots, effective private privileges, FK catalog comparison, SERIALIZABLE restricted writer, exact accepted_at. |
| Immutability/future fields | Same program: real temporary extra column, combined cleanup attacks, replay and no membership escalation. |
| Concurrent redemption | Six actual independent PostgreSQL sessions; one successful redemption. |
| Other author FK | Rent-estimate deletion failure before and after 015; complete rollback; synthetic row author nulling then allows deletion. |
| PDF renderer | Controlled real `toBlob` promise result, auth/org/roundtrip/same-task race, URL provenance/revocation, real A/B PDF bytes. |
| Mutation navigation | Real held DealNew PATCH and OffMarketDeal existing-deal read; no old navigation/follow-ons. |
| Synchronous guard | Old ticket false inside B auth callback while old A DOM still exists. |
| Paged CSV | `csv-pages.test.mjs`: actual SQL pages 1000 + 1, full positive CSV bytes; obsolete org roundtrip produces no artifacts/log. |
| RentCast continuation | Real SPA sends A address after B header active; actual local RLS denies later A writes. |
| RentCast server boundary | Actual handler accepts request without authorization and invokes a synthetic upstream fetch with synthetic key. |

The final independent transcript is `independent-acceptance.txt`; structured observed values are `observations.json`. Runtime: Node `v22.17.0`, PostgreSQL `17.10` Homebrew, installed Playwright Chromium; no dependency installation. Supabase JS installed version `2.110.8` was inspected for bearer selection/retry behavior.

## 16. Full test matrix and attempt accounting

| Final validation | Result | Reported passes | Failures | Skips/cancellations |
| --- | --- | ---: | ---: | ---: |
| Supplied full P0 suite, 6 files | PASS | 95 | 0 | 0 |
| Independent diagnostics, 2 files | Assertions PASS, includes reproduced defects | 22 | 0 | 0 |
| `packages/mf-calc`, 17 files | PASS | 244 | 0 | 0 |
| `workers/scan`, 12 files | PASS | 186 | 0 | 0 |
| Frontend Vite production build | PASS, exit 0 | — | — | — |
| Calculation typecheck | FAIL, exit 2 | — | 35 diagnostics | — |
| Independently extracted original baseline typecheck | FAIL, exit 2, byte-identical output | — | Same 35 | — |

The claimed original matrix is confirmed **on the substantive supplied run**: **525 reported passes = 95 + 244 + 186**, zero failures/skips/cancellations, **519 individual checks**, 35 test files. Adding the final independent run gives **547 reported passes / 538 individual checks**, 37 files. Security alone is **117 reported checks / 108 leaves**, including nine parents. Repeated attempts are not aggregated. The assertion totals do not mean P0-2 is safe.

Build used the repository Vite config, synthetic Supabase settings, disabled environment-file loading and output under `/private/tmp`; it produced the normal large-chunk advisory. The configured calculation typecheck has exactly 35 diagnostics in unchanged test files. Every calculation file was freshly extracted from `c800392` using `git ls-tree`/`git show`, with existing dependencies linked; its transcript is byte-identical. Calculation and scanner trees are unchanged in Git. No new diagnostic is introduced; the check remains failing.

Recorded non-final attempts, excluded from green totals:

- `security-first.txt`: sandbox denied PostgreSQL shared memory; seven pure guard reports passed and five setup containers failed. The approved full local rerun is `security.txt`.
- `build.txt` and `independent-first.txt`: review runner used repository root, missing the frontend Tailwind configuration. Build failed; independent run reported 7 passes/10 failures. Correct frontend working directory restores the configured build/SPA.
- `independent-review.txt`: loading PDF anchor has no href and thus no link accessibility role. The diagnostic's incorrect link locator produced 11 passes/6 failures. It was changed to the actual `a[download]` loading anchor; product code did not change.
- `independent-final.txt`: 18 passes/2 failures from the over-specific “one new A URL” assertion and parent. Replaced with per-Blob origin tracking, with no tolerance for obsolete URLs.
- `independent-verified.txt`: 22/22, before adding positive B report coverage; not counted in addition to the final run.
- `independent-complete.txt`: 20 passes/2 failures from placing a B-list marker assertion on A's detail route, where it cannot display. Moved that assertion to the B Deals list; final `independent-acceptance.txt` passes 22/22, including positive B PDF.

These failed diagnostic development attempts are visible in evidence. They were not silently skipped, passed off as infrastructure successes, or used to mask a product defect. No supplied application/test assertion was edited. The renderer URL-count observation is recorded separately from setup/locator mistakes; no product timing flake was reproduced in the supplied run.

## 17. Migration safety assessment

015's explicit transaction encloses definer-function replacement, revokes/grants and trigger replacement. Local fresh/populated/repeat application succeeds. It adds no table, FK alteration, constraint rewrite, mass invitation update, membership backfill or deletion. Therefore there is no new FK-validation/table-rewrite rollout cost to approve. Nullable inviter behavior follows the existing schema; consumed rows need no conversion.

Replacement functions qualify sensitive relations and use empty search path. PUBLIC/anon/authenticated are denied private helper/trigger execution; authenticated receives intended public RPC grants. The pre-existing INSERT trigger still references the replaced bootstrap, and the distinct email-confirmation UPDATE trigger is recreated. 015 does not remove other hosted/custom grants or certify role inheritance/ownership; effective hosted privileges must be checked explicitly.

Repeat execution is locally idempotent for function/trigger definitions and rows. It is not an invitation to replay the entire historical chain: replaying schema or 012 afterward restores older bootstrap behavior. Existing memberships remain unchanged, including historical grants. The new client depends on `accept_pending_mfda_invites`; absent/missing RPC fails organization load closed even for legitimate users. Ordered migration/RPC visibility must precede client rollout.

Trigger DROP/CREATE takes strong relation locks on `auth.users` and `public.invites`; long open transactions can delay application and hold up Auth/invitation activity. No live lock duration or table-size estimate was collected. Operational verification should use bounded lock/statement timeouts and an inspected rollback/ledger procedure. Author deletion can scan invitations because `invited_by` has no dedicated index in this chain; consumed-row JSONB comparison and Auth existence lookup run per affected row. Those are scaling considerations, not a reproduced correctness failure.

Revising unapplied 015 in place is appropriate for the stated deployment history. A controlled staging migration exercise is technically suitable for the SQL correction, subject to actual schema/owner/Auth/RPC verification and N-2 deletion dependencies. **The application as a whole still receives gate A because N-1 remains open.** No hosted migration was applied and no production migration safety certification is issued.

## 18. New findings

### N-1 — Stale RentEstimator continuation sends A address after B activation

**Classification: VULNERABLE; P1 deployment-blocking tenant-completion gap for the configured address-estimate feature.** Source: `mfda/src/components/RentEstimator.jsx:104`, `:112`, `:125`; `mfda/src/lib/queries.js:521`; `mfda/netlify/functions/rent-estimate.mjs:51`.

Reproduction with actual SPA:

1. A opens the known synthetic deal edit, with ZIP/reference rents that enable the address-estimate button.
2. Click Address-level (RentCast); execute the A-authorized rent-cache read and hold its empty response.
3. Replace auth through the real SDK with B and wait for Synthetic Tenant B to render. A record access is denied by local RLS.
4. Release the held cache miss. The unmounted A closure calls `countRentcastCalls(A)` using B's bearer; zero visible rows become count zero.
5. It then initiates a new same-origin proxy request containing `A ONLY SECURITY CANARY, AZ, 85001`, after B is active, without an authorization header or any completion predicate.
6. The synthetic proxy response leads to A-org cost/cache write attempts with B's bearer. Actual authenticated-role SQL rejects both through RLS. No A result enters B's form/cache; those later denials do not undo the earlier outbound address request.

The independent handler test imports the actual serverless function, submits an unauthenticated Request with synthetic address, sets a synthetic key and intercepts only upstream fetch. Handler returns 200 and invokes that fetch once. Source checks only configured key/address/upstream response; it performs no authenticated tenant authorization. Thus this is not a frontend-route mock asserting its own security behavior. When no key is configured the actual handler returns 501; this review did not inspect hosted configuration. With the intended feature enabled, the source forwards the stale address and spends an upstream call. The independently observed local request and source boundary justify the finding without contacting RentCast.

The continuation and unauthenticated proxy predate V2; V2 did not add them. The component adopted the tenant-query wrapper in the first remediation, but wrapping its cached queries does not guard direct action continuations. This is the same broader defect class as the first saved-list finding: unmounted async work still performs a global external side effect. The observed leak is outbound A data under the B lifetime, **not** a demonstrated A report/CSV shown in B's UI.

Required remediation: bind the direct estimate action to its initiating authorization/lifetime before follow-on requests and result/write boundaries, and enforce trusted identity/organization authorization at the proxy. Server metering/disposition belongs to that review; no financial calculations were changed or Round 1 started here. Add deterministic held-cache/usage tests across auth/org/logout, positive same-scope behavior and unauthorized-proxy rejection. No remediation was implemented in this audit.

### N-2 — Rent-estimate author FK independently blocks Auth-user deletion

**Classification: reproduced pre-existing lifecycle/deletion edge; P2, separate from the closed invitation-only blocker.** Source: `mfda/supabase/migration_013_rent_estimates.sql:35`.

`rent_estimates.created_by REFERENCES auth.users(id)` uses default NO ACTION. An otherwise authorized deletion of a synthetic user with both consumed invitation authorship and an authored rent estimate fails on `rent_estimates_created_by_fkey`. The user and invitation stay unchanged, proving transaction rollback. The same failure occurs in the complete pre-015 chain. Nulling only the synthetic rent-estimate author's reference permits deletion and the consumed invitation then survives with its author null.

V2's invitation fix is valid but cannot support a broader claim that every history-bearing Auth user can now be deleted. A separately reviewed author-retention/deletion policy for rent estimates is required for that guarantee. Do not delete invitation/org histories to work around this. Application/migration code was left unchanged.

### N-3 — Compound-helper cancellation remains incomplete

**Classification: POTENTIALLY VULNERABLE / coverage limitation**, not a reproduced B artifact or privilege escalation. Helper-level follow-ons are not governed at every await; see sections 7 and 11. Final navigation/download and B-state boundaries are guarded in the named V2 paths. This distinction should remain explicit in future closure claims.

Earlier foreground draft loss (R-2) remains a known P2 operational regression: focus/visibility/path revalidation drops the tenant subtree and can discard unchanged-scope drafts. No fix or product acceptance is implied here.

## 19. Remaining limitations

No real hosted Supabase Auth, email confirmation delivery, PostgREST schema cache, custom grants/ownership, schema drift, production-shaped data size or migration lock timing was tested. Minimal Auth/JWT and HTTP fixtures prove selected PostgreSQL/client behavior. Hosted realtime was blocked; polling/focus and real SDK cross-tab auth were exercised. Chromium evidence does not certify Firefox/WebKit, native legacy IE save, deployed HTTP caching, browser-process restart or cross-document BFCache. SPA history and reload pass.

The PDF barrier holds the real render result, not every image/font/stream phase; full installed queue/source inspection supplements it. Every compound mutation stage and concurrency ordering is not exhaustively exercised. Existing historical memberships and foreground draft loss remain unresolved. Typecheck still fails with 35 pre-existing diagnostics. These limitations are not explanations that dismiss N-1 or N-2, which are independently reproduced.

## 20. Blocker A verdict

**PASS.** Consumed-invitation authorship alone no longer prevents otherwise-authorized user deletion. History, acceptance and security-critical immutability remain intact locally. N-2 is a distinct pre-existing FK dependency.

## 21. Blocker B verdict

**PASS.** The identified stale saved-list/export path is closed through actual browser artifact release, including generations, SDK retry and multiple pages. This is not acceptance of every other direct action.

## 22. P0-1 verdict

**CONDITIONAL PASS.** No original invitation authorization regression was found in local trusted DB behavior. Hosted lifecycle/effective privileges/RPC verification and historical membership disposition remain conditions.

## 23. P0-2 verdict

**FAIL.** Original cache display and the named CSV export pass, but the broader tenant-output/completion claim is disproved by N-1's post-transition A-address external request.

## 24. Deployment gate

**A. NOT SAFE TO DEPLOY.** N-1 requires correction and independent re-review before accepting application closure. Migration 015 remains unverified hosted. Its locally correct SQL may be exercised later in a separately authorized isolated staging migration workflow; this review neither performs nor approves a rollout. Gate C is not justified.

## 25. Exact next action and final workspace

Return reviewed SHA `b9288e13f83b2dd5a36718165cf84c8aab1cb6a5` with N-1 reproduction to remediation. Correct the RentEstimator/proxy authorization lifetime and add direct-action regressions, preserve the successful invitation/CSV/PDF/cache behavior, and separately disposition N-2 and the compound-helper/draft limitations. Independently audit the corrected commit locally. Only afterward seek separately authorized controlled Supabase staging verification of ordered migrations, Auth insert/confirmation/delete, grants/RPC/RLS and historical membership handling.

Final HEAD is unchanged. The only new files are this report and its evidence directory; `.netlify/` remains untouched. `git diff --check` passes. `git status --short`:

```text
?? .netlify/
?? docs/audits/MFDA_P0_V2_INDEPENDENT_REAUDIT_2026-10-07.md
?? docs/audits/evidence/mfda-p0-v2-independent-20261007/
```

`git diff --stat` has no output because review additions are untracked and tracked application files are unchanged. No commit, merge, deployment or hosted migration was performed. This review stops here; no financial Round 1 begins.
