# MFDA P0 independent re-audit — 2026-10-06

The completed remediation is **A. NOT SAFE TO DEPLOY** at the reviewed SHA. Independent checks found a migration regression that blocks deletion of an invitation author, and a delayed export that releases Tenant A records after the application has switched to Tenant B. Application code was left unchanged.

| Finding | Verdict | Reason |
| --- | --- | --- |
| P0-1: expired/invalid invitations grant inappropriate membership | **CONDITIONAL PASS** | Future membership authorization passed the inspected local database boundary checks. Actual Supabase Auth/PostgREST/schema/grants remain unverified. Invitation-author deletion regression R-1 separately blocks rollout. |
| P0-2: A data survives an identity/tenant change | **FAIL** | The rendered query-cache defect is corrected in the exercised paths, but shared-screen export completion remains outside the tenant lifetime: R-3 reproduces an A-only CSV arriving under B. |
| Deployment gate | **A. NOT SAFE TO DEPLOY** | R-1 and R-3 require source corrections and independent re-review. Migration 015 also remains unapplied to hosted Supabase. |

## 1. Baseline and repository verification

- Reviewed SHA: `9f8c6de4a71955d3dceb937da93fe14ff5c39722`.
- Original vulnerable SHA: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`.
- Review branch: `audit/mfda-p0-independent-reaudit`.
- Repository directory: `/Users/davidastone/code/alot-land/alot-land`.
- Fetch and push remote: `https://github.com/alot-land/alot-land.git`.
- `HEAD`, `origin/hardening/mfda-p0-security-closure`, and their merge-base all returned the reviewed SHA.
- `HEAD` directly follows the original vulnerable SHA. The first five commits printed were `9f8c6de`, `c800392`, `e413634`, `00393a5`, and `05eb3ff`.
- Initial status: no tracked changes; only the pre-existing untracked `.netlify/` directory.

The requested baseline prerequisite passed. Remote-tracking references were inspected locally; no fetch or claim about a freshly queried remote branch is made. No command read application data or changed files inside `.netlify/`.

## 2. Scope and independence

This review inspected the authoritative invitation functions, triggers, permissions, RLS and preceding migrations; auth/org/query lifecycle code; every MFDA query/cache call site; direct reads and export side effects; and the implementation team's test infrastructure. The closure document and original Round 0 branch report supplied claims and context. Their verdicts and saved logs were not accepted as evidence of current behavior.

The implementation team's suite was rerun unchanged. Additional checks were authored independently in a temporary file, then preserved as review evidence. Only its inspected disposable database/browser setup was reused. Additional browser cases retain the actual SPA and SDK; narrow adapter extensions exercise real authenticated-role SQL for selected mutations and a nested saved-list export. None of these checks replace application code.

All users, sessions, properties and organizations were synthetic. Database instances used new temporary directories and Unix sockets with TCP disabled. Browser requests outside localhost and `mfda-security.invalid` were blocked. No production customer data, real credentials, hosted Supabase, deployments, merges or financial Round 1 work were used.

## 3. Commands executed

The initial commands, in order, were:

```sh
pwd
git remote -v
git branch --show-current
git status
git rev-parse HEAD
git log --oneline -5
git merge-base HEAD origin/hardening/mfda-p0-security-closure
git rev-parse origin/hardening/mfda-p0-security-closure
```

Source inspection used `rg --files`, `rg -n`, `cat`, `sed -n`, `nl -ba`, `git show --stat HEAD`, and scoped `git diff c800392a3c57cb425dc9ab90ca3cda4893b2e5fd HEAD`. No applicable `AGENTS.md` was found in the repository or its inspected ancestors. The original report was read with:

```sh
git show audit/mfda-round0-2026-10-06:docs/audits/MFDA_ROUND0_CODEX_ADVERSARIAL_AUDIT_2026-10-06.md
```

Substantive validation commands were:

```sh
# cwd: mfda; unchanged package test:security command, explicit file expansion
node --test --test-concurrency=1 security/baseline.test.mjs security/invitations.test.mjs security/tenant-browser.test.mjs
# cwd: packages/mf-calc
npm test
npm run typecheck
# cwd: workers/scan
npm test
# cwd: mfda; independently authored diagnostics and build/baseline extraction
node --test --test-concurrency=1 /private/tmp/mfda-reaudit-extra.test.mjs
node /private/tmp/mfda-reaudit-build-and-baseline.mjs
```

Output was redirected to `/private/tmp/mfda-reaudit-*.log`, then copied into this report's [evidence directory](evidence/mfda-p0-independent-20261006/manifest.json). Exact independent test/build programs are retained there. The test runner was repeated once after its first substantive assertion failure. Independent diagnostic runs were extended as new source concerns were identified. The final independent run is `independent-review.txt`.

The build program invokes the configured Vite production build, with environment-file loading disabled, synthetic Supabase values and output in a new temporary directory. It extracts every tracked `packages/mf-calc` file from the immutable vulnerable SHA using `git ls-tree`/`git show`, links the existing local dependencies, and runs that copy's configured typecheck. `diff -u` of its output against the current typecheck returned zero. `rg -c 'error TS'` counted 35 in each. A scoped Git comparison independently established that calculation/scanner source and all preceding SQL files are unchanged.

Harness child commands include `initdb`, `pg_ctl`, and `psql -X -qAt -v ON_ERROR_STOP=1`, with the unique temporary socket directory explicitly supplied. Synthetic client SQL sets `role authenticated` and a fixture identity; anonymous/restricted-auth role checks are explicit. Normal cleanup stops only the clusters created by these tests and removes their temporary fixture directories. Final `ps -axo pid,ppid,stat,etime,command` inspection found one cluster left by the interrupted first diagnostic. It was explicitly stopped with `pg_ctl -D /private/var/folders/v8/pxztscbj2rl_5_r28_5bzm2w0000gn/T/mfda-security-qQVv3L/data stop -m fast`; the sandbox denied the signal and approved execution completed the stop. No pre-existing local cluster was stopped.

The sandbox initially denied PostgreSQL shared memory. Approved local execution was required for the substantive PostgreSQL/Chromium runs. Two independent setup attempts also exposed infrastructure constraints: running from repository root missed the frontend Tailwind configuration, and concurrent browser harnesses collided on port 5173 despite the harness supplying `port: 0`. Those attempts were interrupted, recorded, and rerun sequentially from `mfda/`. They do not establish application failures. No assertions or application source were weakened or changed.

## 4. Files inspected

Authoritative and lifecycle source inspected:

- `mfda/supabase/schema.sql`: invitation/membership definitions, FKs, RLS, helpers and original bootstrap trigger.
- `mfda/supabase/migration_012_tax_presets.sql`: vulnerable bootstrap replacement and founder market seeds.
- `mfda/supabase/migration_015_p0_invitation_authorization.sql`: entire forward migration.
- Preceding migration chain: `002_sourcing`, `003_photos`, `004_rent_bands`, `005_contacts_brokerage`, `006_offmarket`, `007_usmarkets`, `008_favorites`, `009_ratings_notes`, `010_goals`, `011_deal_tracking`, `012_tax_presets`, `013_rent_estimates`, `013a_fix_rent_estimates_index`, `014_parcel_coverage`. The chain was executed locally; function/trigger/policy/permission definitions and relevant parent/author relationships were inspected.
- Entire `mfda/src/lib/tenant-query.jsx`, `auth.jsx`, `org.jsx`, `queries.js`, `supabase.js`, `main.jsx`, and the routing/protection/shell code in `App.jsx`.
- Changed query consumers: pages `Compare`, `DealNew`, `DealResults`, `Deals`, `Goals`, `Markets`, `OffMarket`, `OffMarketDeal`, `OnMarket`, `Settings`; components `CompsAssist`, `DealTrackingCard`, `HeartButton`, `NotesCard`, `RentBandsCard`, `RentEstimator`. All changed hunks and their query/cache/read/action paths were examined.
- `mfda/src/lib/freedomsoft.js`, `theme.js`, `lazyReload.js`; `mfda/src/pdf/ReportButton.jsx`.
- All five `mfda/security/*.mjs` files, package scripts for frontend/calc/scanner, `mfda/vite.config.js`, and relevant installed Supabase Auth/React Query implementation paths.
- Both requested audit documents. Other historical audit conclusions were context, without carrying their acceptance forward.

## 5. Independent P0-1 analysis

The new private helper is the membership authorization boundary. It reads the supplied user's confirmed email from `auth.users`, locks the token's authoritative invitation, checks consumption, wall-clock expiration, recipient and role, then inserts membership and marks the invite consumed in the same transaction. The public token RPC derives identity from `auth.uid()` and accepts no organization, role or user argument. The pending-invitation RPC and both bootstrap trigger paths reuse the private helper. The former uninvited personal-admin default is removed; the pre-existing verified founder exception remains explicit.

| Required invariant | Independent evidence and conclusion |
| --- | --- |
| Expired invitation cannot create membership | Direct RPC, insert bootstrap, exact expiry, transaction begun before expiry, and expiry while blocked on invitation row lock reject. The immutable baseline control independently reproduced the former admin grant. |
| Invalid/revoked invitation cannot create membership | Missing token, invite row ID, deleted invitation, wrong recipient and null token reject without new membership. |
| Consumed invitation cannot be reused | Row locking serializes redemption; replay rejects. Consumption reset/retarget attempts reject. |
| Invitation cannot be redirected to another org | Org comes from the locked row; RPC lacks an org parameter; unauthorized row updates are denied by RLS. |
| Caller cannot substitute another identity | Public RPC uses `auth.uid()`; authenticated callers cannot execute the two-argument helper. Anonymous pending/redemption calls are denied. |
| Unauthorized role cannot be requested | Role comes from the locked invitation and its constrained allowed values. Membership/invitation forging by a member is denied. Authorized admins retain their explicit management policy. |
| Existing lower membership is not elevated | `ON CONFLICT DO NOTHING` preserves the existing role. An independent conflicting member/admin invitation sequence consumes both while preserving member. |
| Unverified email cannot consume | Pending RPC and bootstrap leave both invites and membership unchanged until confirmation. Confirmation then admits the verified recipient. |
| Membership follows authoritative validation | No membership appears while validation waits on the invitation lock. Membership failure rolls back consumption. |
| Database/server enforcement | Actual PostgreSQL functions, privileges, triggers, row locks and RLS ran under client roles. Frontend gate success is never used as membership authority. |
| Concurrent/replayed privilege remains consistent | Eight simultaneous redemptions yield one success and seven rejections; deletion/expiry lock cases reject; existing role remains unchanged. |
| Valid invitations still work | Verified new-user admin, verified returning-user member and delayed confirmation succeed. An independently restricted synthetic Auth writer successfully executes insert/confirmation triggers without helper execute grants. |

No future expired/invalid-invitation privilege grant was reproduced in the reviewed local code. The original INSERT trigger still points to the replaced bootstrap function, and the added confirmation trigger handles users inserted unverified. Qualified relations and the empty definer `search_path` avoid resolving membership/invitation objects through caller namespaces.

Two rollout conditions remain material. First, R-1 demonstrates that the consumed-row trigger breaks the existing inviter-deletion relationship. Second, an independently created baseline user received an expired-invite admin membership; applying 015 preserved that same admin membership. This migration changes future authorization and performs no historical membership reconciliation. An authorized operator must establish how previously inappropriate grants will be identified and corrected before affected customer access is accepted. No real membership inventory was inspected.

**P0-1 verdict: CONDITIONAL PASS**, restricted to the future-grant authorization defect. An isolated Supabase stack must verify real Auth confirmation/signup, PostgREST RPC exposure, ownership, effective grants, triggers, and schema compatibility before deployment. R-1 blocks deploying this particular migration even with that conditional authorization verdict.

## 6. Independent P0-2 analysis

The cache change is substantive. A tenant scope contains authenticated user ID, auth generation, active organization ID, role and organization generation. It keys a separate QueryClient and the whole application subtree. Loading/revalidation hides that subtree. Cleanup cancels queries and clears the old client. Old query observers and ordinary local state callbacks retain the obsolete component/client instance, which is detached from the new tenant.

The organization provider is keyed by auth generation, filters membership reads by the current user, and discards late/unmounted requests. Selected organization IDs are preferences validated against freshly loaded membership. Detail/units/scenarios/contact/parcel reads and scenario attachments now include the active organization in their database predicates, covering users independently authorized in both organizations.

Independently retaining the actual old QueryClient showed that identity replacement produced a different current client, emptied the old cache, and kept B's positive record visible after a held successful A response was released. A same-org, same-admin-role identity change also reset an unsaved user draft. These cases extend the inherited suite's negative A-marker checks.

| Required lifecycle | Evidence and result |
| --- | --- |
| Identity, organization and role cache scope | Source plus runtime key inspection; passed. |
| Old client clearing and late query completion | Independent retained-client/held-response check and inherited delayed query/hydration checks; passed for QueryClient/component state. |
| Logout/login and direct replacement | Actual SPA/SDK inherited cases; direct replacement independently exercised with B positive data. |
| Org A → B and repeated A → B → A → B | Multi-org known-ID reads, forms and all shared screens passed. |
| SPA navigation/history and reload | Inherited cases passed with B's database denial and stale preferences. |
| Browser persistence | Source contains no tenant-record persistence; exercised local/session storage, Cache Storage, IndexedDB and service-worker checks passed. The adapter disables ordinary HTTP caching; deployed response caching and true cross-document BFCache remain unverified. |
| Removed membership and role downgrade | Foreground checks hide the view before delayed validation; polling detects removal/downgrade without realtime. Local SQL rejects subsequent unauthorized reads. |
| Wrapper adoption | `rg -n '@tanstack/react-query' mfda/src` found only import/re-export lines in `tenant-query.jsx`. Every React Query consumer uses the wrapper. |
| Shared action/direct-read lifetime | **Failed for delayed saved-list export, R-3.** Query wrapper adoption does not protect the direct awaited read and global download side effect. |

The session-expiry, cross-tab auth, late startup/session ordering, failed logout, unchanged renewal/polling, and delayed membership tests passed on repeat. The implementation deliberately preserves forms during unchanged token renewal and background polling, but discards them on focus/visibility/path revalidation; R-2 independently reproduced the latter.

**P0-2 verdict: FAIL.** The original visible cached-deal path passed independently, but the requested tenant-lifetime coverage is incomplete: an old export response can release A records after the identity boundary has moved to B. This is a client continuation defect; B's fresh database read remains denied.

## 7. Test design review

The invitation suite exercises real PostgreSQL authorization and concurrency, includes positive onboarding, and checks transactional rollback. Its useful coverage exceeds a source-string or UI-only test. It omitted invitation-author FK cleanup, which independently fails after 015.

The baseline browser control extracts real frontend/calc files from `c800392` and reproduces the stale cache disclosure. Its database control loads the current preceding SQL chain while omitting 015; the Git comparison established that every preceding SQL file is byte-identical to the vulnerable commit. Thus this control is equivalent for the reviewed baseline, though the helper itself does not pin every prior SQL read to Git.

The browser suite runs the real SPA, SDK and calculation code, with a PostgreSQL-backed adapter. It covers ten shared screens and both auth/org changes. The adapter is a useful local oracle for RLS and application lifetime; it supplies minimal Auth and only selected PostgREST behavior. It ignores some projection, pagination/order/filter semantics, returns a synthetic saved-list count, rejects ordinary writes, and blocks realtime. It cannot certify every mutation, export, hosted auth, realtime behavior or HTTP cache policy. The ten logout cases' names mention error/retry although those cases only inject delay; a separate test does exercise an actual failed request/retry.

The DOM observer detects `A ONLY` markers under a B organization header/select and samples input values. It does not establish comprehensive absence of all possible record fields or all transient property-only changes. Source inspection and the independent old-client/B-positive checks supplement this limitation.

The first approved inherited run failed its aggregate request-identity assertion at `tenant-browser.test.mjs:296`. An independently authored rapid replacement probe recorded old A-filtered membership requests sent with B's replacement JWT, and vice versa. The SDK chooses its bearer token when the request executes; an old component can have already constructed its filter. Generation/request-lifetime checks discard the response, and current B UI stayed isolated. The suite's aggregate assertion treats these harmless obsolete requests as a failure. A repeat passed unchanged. This is evidence of a timing-sensitive test, not evidence that the first run had zero failures. The implementation and assertion were left intact.

Independent mutation extensions executed authenticated-role SQL for heart toggles, stage changes and notes. Optimistic prefix updates, invalidation and visible refetch passed. Export testing added the actual nested parcel SQL shape omitted by the inherited adapter, held its authorized A response, and observed its real browser download after B became active.

## 8. Independent results and counts

Runtime: Node `v22.17.0`; PostgreSQL `17.10` (Homebrew); installed Playwright Chromium. No dependency installation occurred.

| Check | Result | Reported passes | Failures | Skips |
| --- | --- | ---: | ---: | ---: |
| Inherited regression, first approved substantive run | FAIL, one leaf assertion plus parent | 61 | 2 | 0 |
| Inherited regression, unchanged repeat | PASS | 63 | 0 | 0 |
| Independently authored final review checks | PASS, includes expected-defect reproductions | 14 | 0 | 0 |
| `packages/mf-calc` | PASS, 17 files | 244 | 0 | 0 |
| `workers/scan` | PASS, 12 files | 186 | 0 | 0 |
| Frontend production build | PASS, exit 0 | — | — | — |
| Configured calculation typecheck | FAIL, exit 2 | — | 35 diagnostics | — |
| Immutable baseline calculation typecheck | FAIL, exit 2, identical output | — | 35 diagnostics | — |

The inherited 63 reports comprise 60 leaves (2 baseline, 21 invitation, 37 browser) and 3 parent containers. The independent 14 comprise 12 leaves (6 database, 6 browser) and 2 parents. The inherited repeat plus calc/scanner confirms the claimed **493 reported passes / 490 individual leaves** on that run, across 32 files. Including the independent final file gives **507 reported passes / 502 individual checks**, across 33 files. Counts do not aggregate repeated attempts. The first substantive run had **491 reported passes and 2 failures** with calc/scanner included. The blanket zero-failure claim is therefore not reproducible across both runs.

Passing expected-defect controls establish the undesirable behavior; they do not turn R-1 or R-3 into safe behavior. The independent suite also intentionally asserts the known unsaved-draft reset and preservation of a historical invalid grant.

Build produced the normal large-chunk advisory, with no compilation failure. MFDA and scanner have no configured frontend/scanner typecheck script; the configured calculation typecheck is the one tested. All 35 diagnostics are in unchanged calculation tests and exactly match the independently extracted baseline.

Logs and tested programs are preserved in [evidence/mfda-p0-independent-20261006](evidence/mfda-p0-independent-20261006/manifest.json). SHA-256 fingerprints identify reviewed source and artifacts. The final independent transcript is [independent-review.txt](evidence/mfda-p0-independent-20261006/independent-review.txt).

## 9. Migration safety review

Migration 015 applies successfully after the entire local prior chain, including 013a and 014. Its explicit transaction encloses function replacement, revocation/grants and trigger installation. Populated upgrade and reapplication preserve existing memberships and consumed invitations. It introduces no membership backfill or mass deletion. Existing confirmed users can consume new invites through the pending RPC; unverified users await confirmation. The least-authority synthetic Auth-writer check establishes local trigger execution despite private function revokes.

Both INSERT and confirmation triggers use the same replaced function. Trigger events are distinct; normal redemption sees `accepted_at` null before its update, so the protection trigger permits first consumption. Invalid/expired/concurrently consumed invites produce rejection through the validator; only the rejection class is suppressed in pending/bootstrap loops. Other unexpected errors can abort onboarding and are not silently converted to membership.

The helper and public definer RPCs fully qualify sensitive relations and use empty `search_path`. PUBLIC/anon/authenticated cannot execute the private helper; authenticated alone has the intended public RPC grants in the local role model. Hosted ownership, inherited/custom grants, actual Auth hooks and PostgREST schema exposure must still be checked externally.

**Application is unsafe as written for the existing inviter FK behavior.** The protection trigger rejects every changed field on a consumed invitation. `schema.sql:38` specifies `invited_by REFERENCES auth.users ON DELETE SET NULL`. That referential update is also an UPDATE and triggers the immutability exception. A legitimate Auth-user deletion fails and rolls back. The issue depends only on an accepted invitation pointing to that author, which is a normal populated-data condition. It does not need schema drift or a malicious caller.

DDL success alone therefore does not establish a safe migration. The trigger needs a narrowly authorized treatment of author cleanup while retaining token/recipient/org/role/consumption immutability. Ordinary users must not acquire a consumption-reset or retarget path through the correction. That correction was not implemented here.

The frontend now requires `accept_pending_mfda_invites()` before membership loading; an unapplied/missing RPC causes even existing legitimate users to see no organization access. Install and verify the corrected migration before releasing the client. Replaying `schema.sql` or migration 012 after 015 can reinstall an earlier bootstrap and undo enforcement. A controlled migration ledger/order must prevent this. Hosted drift, extension layout, extra triggers, live schema cache and historical data compatibility remain unverified.

Historical inappropriate grants survive the migration. Independent synthetic proof is retained. Production reconciliation requires a separate authorized operator action and evidence; this review makes no claim that any actual customer's membership was inappropriate.

## 10. Regressions and residual issues

### R-1 — Invitation immutability blocks legitimate Auth-user deletion

Priority: deployment-blocking migration regression (P1). Source: `mfda/supabase/migration_015_p0_invitation_authorization.sql:118`, interacting with `mfda/supabase/schema.sql:38`.

Independent reproduction:

1. Create a consumed invitation with `invited_by` pointing to a synthetic admin.
2. Before 015, delete that user: deletion succeeds and invitation author becomes null.
3. After 015, repeat: `Consumed invitation is immutable` aborts the deletion.
4. The user and author reference both remain, proving full rollback.

The final independent database test reproduces both versions. Do not accept this migration unchanged. Preserve authorization-critical immutable fields while allowing required trusted author cleanup, and test authenticated attempts to reset/retarget consumption alongside the FK lifecycle.

### R-2 — Foreground validation silently discards an unchanged tenant's draft

Priority: P2 operational/UX regression, already acknowledged by the implementation report. Source: `mfda/src/lib/org.jsx:44` and focus/visibility handlers at lines 56–58.

Independent check loaded an edit, entered a unique unsaved address, dispatched focus with the same identity/org/role/membership, and observed the saved original replace that draft. The whole subtree is removed before revalidation. Path changes also reset the client/application; focus and visibility can cause redundant resets. Unchanged token refresh/background polling preserve forms, as the suite verifies.

This behavior does not reopen query-cache access, but it is an actual loss of work. No explicit product acceptance of silent loss was supplied in this review. It should be addressed or expressly accepted with a user-facing safeguard before routine use. Theme preferences survive; sign-out deliberately deletes organization-ID preferences. No other necessary persisted preference loss was identified in the inspected source.

### R-3 — Delayed A saved-list export releases tenant records under B

Priority: deployment-blocking residual tenant-lifetime gap in P0-2. Source: `mfda/src/pages/OffMarket.jsx:189`, `mfda/src/lib/queries.js:587`, and `mfda/src/lib/freedomsoft.js` download side effect.

Independent reproduction:

1. As A, load `/off-market` and click the synthetic saved list's **Export CSV**.
2. The nested parcel read executes under A's real local RLS and captures A-only data. Hold its response.
3. Replace the session with B through the real SDK; wait until **Synthetic Tenant B** renders. Assert A markers are absent and B's database parcel read returns zero.
4. Release A's response. The unmounted export continuation invokes `downloadCSV` against the current document.
5. B receives `a-only-export-review.csv`; its bytes contain `A ONLY PARCEL CANARY`.

The read carries the correct A org predicate. The missing control is a tenant-lifetime check before the global side effect; unmounting a component does not stop its async function. React Query cancellation/clearing cannot cancel this direct action. This path existed before remediation and remains open in a modified shared-screen consumer. It is newly reproduced in this review, rather than introduced by the org predicate itself. The finding concerns an export still pending at transition; no requirement to retract previously completed downloads is implied.

Correct this continuation with scope/lifetime enforcement and add assertions that a pending A response produces no download after auth/org/role revocation, while a valid same-tenant export still works. Review similar asynchronous global side effects. No analogous PDF leak was reproduced; the PDF component unmounts with the subtree and further PDF interactions remain a coverage limit.

### R-4 — Regression suite has a timing-sensitive request-identity assertion

Priority: P2 test reliability. Source: `mfda/security/tenant-browser.test.mjs:296`.

The first full approved run failed; a repeat passed unchanged. The independent probe recorded obsolete membership requests with a replacement identity's JWT and confirmed discarded responses/current-tenant isolation. An adequate invariant should prove stale responses cannot authorize or render the current identity, accounting for request cancellation/obsolescence. Do not merely remove the assertion; retain meaningful isolation evidence. No test edit was made here.

No newly broken optimistic favorite update, stage invalidation or note refetch was found in the independently exercised legitimate paths. Current wrapper operations prefix query keys consistently. Some pre-existing writes filter only by record ID, and compound saves remain non-atomic; this review did not repair or certify those broader Round 0 issues. Pending writes/global side effects require broader lifetime coverage than the inherited read-only adapter provides.

## 11. Remaining limitations and acceptance implications

| Limitation | Assessment |
| --- | --- |
| Hosted Supabase unverified; 015 unapplied | Prevents deployment acceptance and a P0-1 unconditional verdict. External verification follows source correction; none was performed here. |
| Actual Auth/PostgREST/grants/schema | Minimal synthetic fixtures prove selected SQL behavior, not real token issuance, RPC exposure, auth hooks, drift or operational upgrade safety. |
| Historic invalid memberships retained | Verified locally. Authorized reconciliation/disposition is necessary before declaring installed access corrected. |
| Chromium-only browser suite | Acceptable evidence for the exercised SPA paths; no Firefox/WebKit or cross-document BFCache certification. It does not explain away R-3, which was reproduced in Chromium. |
| Up-to-30-second polling fallback | Acceptable bounded cached-view revocation limitation for this narrowly reviewed P0 when documented: current RLS denies new reads/writes after removal. No instantaneous idle-view revocation is certified. |
| Foreground revalidation clears unsaved drafts | Actual regression R-2. Security isolation holds in that check; routine workflow acceptance needs a safeguard or explicit product decision. |
| Existing 35 typecheck diagnostics | Proven pre-existing; does not negate this narrow code evidence. The configured check is still failing and cannot be represented as a green release gate. |
| Not every mutation/export/PDF interaction covered | Material test gap. R-3 demonstrates why direct-action lifetime needs coverage. Selected mutations passed; exhaustive correctness is unclaimed. |
| General financial and broader tenancy correctness | Outside this remediation review; prior open findings receive no acceptance here. |

## 12. Exact next action

Return the reviewed SHA to the remediation team for **R-1 and R-3 corrections with regression coverage**, plus a deterministic investigation/correction of R-4's assertion. Preserve the new authorization checks, consumption immutability and valid onboarding/export behavior. Address or explicitly disposition R-2's draft loss.

Independently review and rerun the corrected commit in disposable local fixtures. Only after those source blockers are closed should a separately authorized isolated Supabase staging verification confirm the complete ordered migration chain, real Auth confirmation, effective RPC/grants/RLS, legitimate inviter deletion, valid invitations, historical membership disposition and delayed tenant actions. No merge/deploy approval is issued by this review. Do not apply 015 to hosted Supabase or begin financial Round 1 from this report.

## 13. Final workspace state

The reviewed application SHA remains unchanged. This report and its evidence directory are new untracked review artifacts; the pre-existing `.netlify/` directory remains untouched. No application code, tracked test, migration, dependency lockfile or hosted state was changed. `git diff --check` passes and all 65 reviewed source fingerprints plus the retained evidence fingerprints match. Final `git status --short`:

```text
?? .netlify/
?? docs/audits/MFDA_P0_INDEPENDENT_REAUDIT_2026-10-06.md
?? docs/audits/evidence/mfda-p0-independent-20261006/
```

`git diff --stat` has no output: all review additions are untracked, and tracked files are unchanged. Review-created PostgreSQL/browser test processes are stopped. Temporary synthetic evidence/build directories remain outside the repository for reproducibility.
