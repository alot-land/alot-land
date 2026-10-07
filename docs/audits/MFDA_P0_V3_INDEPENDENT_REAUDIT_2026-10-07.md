# MFDA P0 V3 independent re-audit — 2026-10-07

| Required verdict | Verdict | Basis |
| --- | --- | --- |
| N-1 | **PASS** | The initiating tenant lifetime is checked across every client await that can lead to a new RentCast request or publish/write continuation, and the proxy independently requires verified Auth identity plus RLS-visible organization membership before RentCast. Independent response-body and revocation-timing probes found no pre-authorization bypass. |
| P0-1 | **CONDITIONAL PASS** | All local invitation authorization, consumption, concurrency, populated-upgrade and invitation-author deletion protections remain intact. Hosted Auth/PostgREST grants, migration order and historical memberships are still unverified. |
| P0-2 | **CONDITIONAL PASS** | The named cache, export, report, navigation and rent-estimate completion defects are closed in the exercised local production paths. Hosted behavior and deferred compound-helper/initiated-work boundaries are not certified. |

**Deployment gate: B. SAFE FOR CONTROLLED HOSTED/STAGING VERIFICATION.** This is not approval to merge or deploy. No production credentials, real RentCast call, hosted migration, commit, push, merge, deployment or financial Round 1 work occurred.

## 1. Review branch

`audit/mfda-p0-v3-independent-reaudit`

The mandatory baseline check passed before review work began:

```text
pwd
/Users/davidastone/code/alot-land/alot-land
git remote -v
origin  https://github.com/alot-land/alot-land.git (fetch)
origin  https://github.com/alot-land/alot-land.git (push)
git branch --show-current
audit/mfda-p0-v3-independent-reaudit
git status --short --branch
## audit/mfda-p0-v3-independent-reaudit
?? .netlify/
git rev-parse HEAD
ae5426a39e5a689a8eece17ae8f096edfd8924be
git rev-parse origin/hardening/mfda-p0-closure-v3
ae5426a39e5a689a8eece17ae8f096edfd8924be
git merge-base HEAD origin/hardening/mfda-p0-closure-v3
ae5426a39e5a689a8eece17ae8f096edfd8924be
```

The local remote-tracking ref was used as requested; no fetch or statement about current hosted remote state is made. There were no tracked changes. The permitted untracked `.netlify/` directory was not read, modified or removed.

## 2. Reviewed SHA

`ae5426a39e5a689a8eece17ae8f096edfd8924be`

The review branch started directly at and exactly matched `origin/hardening/mfda-p0-closure-v3`.

## 3. Source baseline

- Original vulnerable baseline: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`
- First P0 remediation: `9f8c6de4a71955d3dceb937da93fe14ff5c39722`
- V2 remediation: `b9288e13f83b2dd5a36718165cf84c8aab1cb6a5`
- V3 remediation reviewed: `ae5426a39e5a689a8eece17ae8f096edfd8924be`

The V3 report and the prior independent V2 report were read as claims and reproduction guidance. Source, actual local PostgreSQL/RLS, the production SPA path and independently executed diagnostics were treated as authoritative.

## 4. Prior findings

The previous independent review found that an A cache miss could resume after B activation, issue a new A-address request using the replacement session context, and reach an unauthenticated rent proxy. It also retained two non-N-1 limitations: the `rent_estimates.created_by` deletion FK and incomplete cancellation/atomicity inside compound helpers.

The prior invitation-only author deletion blocker and saved-list CSV completion defect had already passed locally in V2. V3 did not change the six earlier security test files, calculation package, scanner, SQL migrations or lockfiles.

## 5. N-1 independent reproduction attempts

The re-audit attempted the required timing variations through the actual bound RentEstimator UI, production helper and real server handler:

| Attempt | Observed result |
| --- | --- |
| A unchanged, cache miss | One A bearer/A org proxy request; exact A ledger/cache attribution; current result rendered. |
| Same-scope cache hit | Cached result rendered; zero new proxy or ledger call. |
| Hold cache read, user A → B | No usage follow-on, proxy, cache write, ledger write, result or stale error. |
| Hold cache read, org A → B | Same; no A request after B activation. |
| Hold usage read, user/org A → B | No proxy or subsequent write/publication. |
| Hold session lookup, user/org A → B | No obsolete bearer/address request. |
| Hold proxy request/response, user/org A → B | Already-started request can settle privately; no result, error, ledger or cache continuation. |
| Independently hold successful response body, A → B | No result, cache, usage, error or busy-state corruption. |
| Independently hold error response body, A → B | No stale error or metering continuation. |
| A → B → A with held body/result | Original ticket remains invalid; no obsolete result or `Fetching` state is revived. |
| Logout during cache miss | No follow-on request or write. |
| Same-user token renewal | Pending valid estimate completes. |
| Already-started A ledger write, then B | The captured A write may finish as A; no B attribution, cache write or result follow-on. |
| Fresh B operation | B can immediately issue a valid B-address/B-org estimate. |

No reproduction of the original N-1 defect succeeded on V3. No real RentCast request was made.

## 6. Client-side completion review

`RentEstimator.fetchApi` captures one `useTenantCompletionGuard` predicate at action initiation and retains that exact predicate through the operation. The predicate binds user ID, auth generation, org ID, role, org generation, component lifetime and the synchronous current Auth/org snapshots. Returning to the same IDs cannot revive an invalidated ticket.

The production sequence is:

```text
capture initiating lifetime
  → cache read → lifetime check
  → fresh usage read → lifetime check
  → session lookup → lifetime + exact initiating-user check
  → proxy fetch/body
  → lifetime check before ledger continuation
  → lifetime check before result publication
  → lifetime check before cache write
  → lifetime check before stale error or busy-state completion
```

The session-to-fetch check has no intervening `await`; a normal Auth/org event cannot interleave in that synchronous interval. If scope changes while `fetch` or response JSON consumption is pending, the caller's retained ticket suppresses all later client effects. Query clients are keyed and disposed by user/org/role generations, so obsolete A work cannot populate B's cache.

An already-initiated A database request is not rolled back by client cancellation. Its payload remains A org/A creator and RLS remains independently applicable. This is not B attribution, but it is also not a general server-work cancellation guarantee.

## 7. Proxy authorization review

The actual handler in `mfda/netlify/functions/rent-estimate.mjs` performs these steps before RentCast:

1. Require GET, a syntactically valid bearer header and UUID-shaped `orgId`.
2. Use trusted server Supabase URL/public anon configuration to call `/auth/v1/user` with the bearer.
3. Take identity only from the verified Auth response; ignore caller `userId`.
4. Query `org_members` for both the verified user and requested org using the same bearer, public anon key and RLS.
5. Require an exact matching membership row.
6. Only then read the server RentCast key and invoke RentCast.

The exercised matrix rejects missing/malformed bearer, invalid/expired session, missing/malformed/forged org, no membership, mismatched membership response, invalid Auth shape and Auth/PostgREST failure. Every rejection asserted zero RentCast calls. A valid user/org succeeds. Caller-supplied identity does not affect the verified identity or reach RentCast.

The proxy uses no service-role key. The bearer, org and user IDs are not forwarded to RentCast. Redirects are rejected, responses are `no-store`, and Auth/PostgREST/upstream bodies, exceptions, tokens and key length are not echoed. Authorization precedes every billable/external RentCast request.

The local proxy tests use synthetic Auth HTTP because no hosted Supabase Auth service was authorized. One supplied case and the new independent timing probe execute membership decisions through actual disposable PostgreSQL RLS. Hosted Auth token validation and PostgREST behavior remain a staging condition.

## 8. Bypass attempts

No pre-authorization bypass was found.

The independent revocation diagnostic held three distinct server stages:

- Revocation while Auth lookup was held: membership read observed revocation; HTTP 403; zero RentCast calls.
- Revocation before the held membership SQL read: HTTP 403; zero RentCast calls.
- Revocation after the membership result had already been read and authorized: the already-authorized server operation made one synthetic RentCast call.

The last case is the expected authorization-to-use time-of-check window, not a caller-forged tenant bypass. The server has already completed its trusted membership decision; a later revocation cannot retroactively cancel that invocation. Eliminating the window would require a materially different server-side reservation/job design. It does not block controlled staging, but the system must not claim atomic revocation of already-authorized work.

Same-user token replacement remains authorized only if Auth accepts the presented token. A different user, logout, expired session, role/org generation change, and A → B → A invalidate the client ticket. A user who legitimately belongs to two orgs may call the proxy for either org; the server authorizes membership, not the browser's active UI selection. The client lifetime guard enforces active-view selection.

## 9. Prior P0 regression review

The complete unchanged prior security suite passed. The following protections remain intact:

- invitation identity/org/role authority at the database boundary;
- expired, revoked, consumed, wrong-recipient and unverified invite rejection;
- concurrent redemption and rollback atomicity;
- consumed invitation immutability and invitation-author deletion behavior;
- tenant cache isolation across logout, replacement, repeated user/org transitions and token renewal;
- stale CSV/Blob/object-URL/download/history suppression, including 1,001-row pagination;
- delayed PDF renderer completion and ready-URL revocation;
- mutation and navigation completion guards;
- user/org/role generation-scoped query keys and disposed old clients.

The prior independent diagnostic again reproduced the separate `rent_estimates.created_by` deletion FK edge. That does not regress the invitation-only deletion fix.

## 10. Test-design assessment

`mfda/security/rent-browser.test.mjs` uses the real production SPA, bound click handler, Auth SDK, providers, query clients and authenticated local SQL/RLS. Its explicit barriers hold cache, usage, session, proxy and ledger stages. It awaits the action promise for negative assertions, verifies actual outbound suppression and positive A/B behavior, and has no silent skips. The proxy route is intercepted, so this suite proves the client path rather than the handler; the handler is tested separately.

The browser fixture defines a cache-save barrier but does not use it in a named test. Source tracing shows no visible continuation after that save other than guarded completion, and the earlier result belongs to the still-current old component at publication time. This is a coverage gap, not a reproduced bypass. The independent response-body test adds the missing split between fetch resolution and JSON completion.

`mfda/security/rent-proxy.test.mjs` imports the actual handler and stubs external fetch. It verifies order and zero RentCast calls on rejection rather than replacing the handler's authorization decision. Auth HTTP is synthetic; the final supplied case backs membership with actual local RLS. Failures are deterministic, global fetch is restored by the test framework, and no tests were skipped.

The source-only secret test is narrow: it scans three browser sources and the server file. The separate production-bundle scan is the meaningful release check. This re-audit rebuilt with synthetic server-only canaries and scanned all nine emitted JS/HTML/CSS/map artifacts; no RentCast/service-role secret, service-role name, `X-Api-Key`, or RentCast endpoint leaked.

## 11. Independent diagnostics

New review-only diagnostic: `docs/audits/evidence/mfda-p0-v3-independent-20261007/independent-rent.test.mjs`.

It reported **8/8** Node tests, zero failures/skips/cancellations (**6 leaf checks plus 2 parent containers**):

- actual local RLS revocation while Auth is held;
- actual local RLS revocation before membership read;
- documented revocation after completed authorization read;
- verified identity overriding forged caller identity;
- delayed successful response body under B;
- delayed error response body under B;
- A → B → A non-revival and busy-state integrity.

The V2 reviewer regression programs also passed **22/22 reported tests / 19 leaf checks**, including actual invitation lifecycle SQL, deletion FK reproduction, delayed PDFs, navigation, paged CSV and the V3 N-1 regression.

## 12. Full test matrix

| Validation | Result | Reported passes | Failures | Skips/cancellations |
| --- | --- | ---: | ---: | ---: |
| Complete MFDA P0/security, 8 files | PASS | **142** | 0 | 0 |
| Of those: V3 rent browser + proxy | PASS | **47** | 0 | 0 |
| Prior-review diagnostic regressions, 2 files | PASS | **22** | 0 | 0 |
| New independent rent diagnostics | PASS | **8** | 0 | 0 |
| `packages/mf-calc`, 17 files | PASS | **244** | 0 | 0 |
| `workers/scan`, 12 files | PASS | **186** | 0 | 0 |
| Frontend production build | PASS, exit 0 | — | 0 | — |
| Emitted browser server-secret scan | PASS, 9 artifacts | — | 0 | — |
| Calc `npm run typecheck` | Expected FAIL, exit 2 | — | **35 diagnostics** | — |
| Fresh `c800392` calc extraction typecheck | Expected FAIL, exit 2 | — | **same 35 diagnostics** | — |

The V3 claimed aggregate is confirmed exactly: **594 reported passes / 583 individual checks in 39 test files** (`142 + 22 + 244 + 186`). The new independent diagnostic is additional and is not retroactively included in that claim. Including it yields **602 reported passes / 589 individual checks**.

Calculation and scanner trees are unchanged from `c800392` through reviewed HEAD. A fresh baseline extraction using the installed dependencies emitted the same 35 TypeScript diagnostics as current HEAD. The typecheck remains red, but V3 introduced no diagnostic.

## 13. Deferred-item assessment

| Deferred item | Assessment |
| --- | --- |
| `rent_estimates.created_by` deletion FK | Reproduced P2 lifecycle/deletion dependency. It can block deletion for a rent-estimate author but does not reopen invitation authorization or N-1. Does not block controlled staging; requires an explicit retention/deletion policy before promising universal Auth-user deletion. |
| Compound-helper cancellation/atomicity | Potential continuation/partial-write risk remains. No B artifact, privilege escalation or named P0 regression was reproduced. Not promoted to P0 without a concrete tenant leak or integrity failure. |
| Already-initiated server work | Confirmed limitation. Client cancellation suppresses later publication/follow-ons but cannot retract a completed server authorization or already-sent write. Independent server authorization limits the risk. Not a P0 blocker for controlled staging. |
| Historical membership reconciliation | Future authorization is locally closed; prior inappropriate rows, if any, are not automatically removed. Must be inspected in hosted staging/production data before rollout. This is a condition on P0-1 acceptance. |
| Hosted verification | Required. Local synthetic Auth/PostgREST cannot certify hosted schema cache, grants, ownership, runtime configuration or migration order. This caps the gate at B. |
| 35 calc diagnostics | Byte-equivalent behavior at original baseline and reviewed HEAD; no V3 regression. Technical debt, not this P0 gate. |

## 14. New findings

**No new P0 defect was found.**

Two known/deferred limitations were independently bounded rather than promoted:

1. Membership authorization and the subsequent RentCast call are not atomic. Revocation after the membership result has been read cannot retract already-authorized server work.
2. The 50-call usage meter is client-advisory, not a server-side quota reservation. A valid member can invoke the proxy directly or concurrently, and stale already-started calls can be absent from the client ledger. This can undercount cost but did not produce cross-tenant attribution in the exercised paths. Server-side quota/metering is recommended before treating the limit as a commercial enforcement control.

These limitations were already disclosed by the V3 report in substance. Neither permits an unauthenticated or non-member caller to reach RentCast in the reviewed handler.

## 15. Remaining limitations

- No real hosted Supabase Auth, PostgREST, grants/ownership, schema cache, runtime environment or migration ledger was exercised.
- No production credentials, production data or real RentCast request was used.
- No Firefox/WebKit, deployed CDN behavior, BFCache or live migration locking was tested.
- The proxy has no server-side concept of the browser's active org; it intentionally authorizes any requested org of which the verified caller is a member.
- Membership and upstream use are not one transaction, and already-initiated writes/calls are not cancelled.
- Compound mutation helpers are not certified atomic at every await.
- The known rent-estimate author FK and foreground revalidation draft-loss edges remain outside P0 closure.
- Typecheck still fails with the same 35 pre-existing diagnostics.

## 16. N-1 verdict

**PASS.** The original post-transition A-address initiation is closed locally at both boundaries: the client refuses obsolete continuations before a new proxy request, and the proxy independently rejects invalid identity/org membership before RentCast. Late success/error bodies and writes cannot populate B state/cache or be relabeled B.

## 17. P0-1 verdict

**CONDITIONAL PASS.** Invitation authorization, consumption, concurrency, populated migration and invitation-author deletion remain correct under trusted local PostgreSQL behavior. Hosted migration order, effective grants/Auth behavior and historical memberships must still be verified.

## 18. P0-2 verdict

**CONDITIONAL PASS.** The named cache, CSV/export-history, PDF/report, navigation and N-1 rent-estimate paths pass locally with generation-scoped completion. The condition is controlled hosted verification; this verdict does not certify every compound helper or cancellation of already-initiated server work.

## 19. Deployment gate

**B. SAFE FOR CONTROLLED HOSTED/STAGING VERIFICATION.** Gate A is no longer required by a reproduced local P0 defect. Gate C is not justified because hosted Auth/PostgREST/migration/runtime behavior remains unverified.

## 20. Exact next action

Obtain separate authorization for an isolated staging verification using synthetic users/orgs and no real RentCast call. Apply the ordered migrations only in that staging environment, inspect effective grants/ownership and historical memberships, verify valid/invalid/expired Auth tokens and same-/cross-org PostgREST membership behavior, and exercise the deployed proxy with `RENTCAST_API_KEY` absent: unauthorized/non-member calls must return 401/403 with no upstream attempt, while a valid member must pass authorization and stop at the expected 501 configuration boundary. Re-run the 142-check security suite against the release candidate. Only after that evidence should merge/deployment approval be reconsidered.

This review stops here. Do not begin financial Round 1.
