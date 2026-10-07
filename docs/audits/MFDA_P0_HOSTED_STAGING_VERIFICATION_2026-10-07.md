# MFDA P0 Controlled Hosted/Staging Verification — 2026-10-07

## Executive result

**HOSTED TARGET CLASSIFICATION: NOT VERIFIED.**

The mandatory hosted-write gate was not satisfied. No isolated non-production Supabase project, synthetic-only data authorization, or disposable/restore capability could be established from the repository, local configuration, process environment, or documented deployment mapping. The only documented MFDA deployment is the public `mfda.alot.land` site; that fact is not evidence that its backend is isolated staging.

Accordingly, this verification stopped before every hosted read requiring credentials and before every hosted mutation. Migration 015 was not applied. No hosted database rows, Auth users, memberships, functions, grants, policies, or migration ledger were accessed or changed. No hosted function was invoked or deployed. No RentCast request occurred.

Final verdicts remain **P0-1: CONDITIONAL PASS**, **P0-2: CONDITIONAL PASS**, and **Deployment gate B: HOSTED/STAGING VERIFICATION INCOMPLETE**.

## 1. Review branch and repository identity

- Repository: `alot-land/alot-land`
- Review branch: `audit/mfda-p0-hosted-staging-verification`
- Required and observed RC SHA: `ae5426a39e5a689a8eece17ae8f096edfd8924be`
- `origin/hardening/mfda-p0-closure-v3`: `ae5426a39e5a689a8eece17ae8f096edfd8924be`
- Merge base with `origin/hardening/mfda-p0-closure-v3`: `ae5426a39e5a689a8eece17ae8f096edfd8924be`
- Original vulnerable baseline: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`
- Remote: `https://github.com/alot-land/alot-land.git` for fetch and push
- Starting worktree: no tracked changes; only the pre-existing untracked `.netlify/` directory
- `.netlify/` was not read, changed, or used.

The observed five-commit log began:

```text
ae5426a Close MFDA stale rent-estimate continuation and proxy authorization gap
b9288e1 Close MFDA P0 independent audit blockers
9f8c6de Close MFDA P0 tenant isolation and invitation authorization defects
c800392 Read each county's own land-use vocabulary instead of guessing WHERE clauses
e413634 Click a county on Markets, get its parcels — automatic acquisition queue
```

## 2. Acceptance contract

The following records were read:

- `docs/audits/MFDA_P0_CLOSURE_V3_2026-10-07.md`
- `audit/mfda-p0-v3-independent-reaudit:docs/audits/MFDA_P0_V3_INDEPENDENT_REAUDIT_2026-10-07.md`

The independent review's exact next action requires separate authorization for an isolated staging environment using synthetic users and organizations, no real RentCast call, ordered migration application, inspection of effective grants/ownership and historical memberships, hosted Auth/PostgREST checks, deployed-proxy authorization checks with `RENTCAST_API_KEY` absent, and a rerun of the 142-check security suite. It expressly leaves merge/deployment approval pending that evidence. This report uses that requirement as the acceptance contract and does not reopen unrelated local remediation.

## 3. Hosted target discovery and classification

### Discovered project references

No MFDA hosted Supabase project reference was discovered.

- `mfda/.env.local`, `mfda/.env`, `mfda/.env.production`, and `mfda/.env.staging` are absent.
- The root `.env` is present but contains no Supabase, Netlify, database, PostgreSQL, or RentCast variables.
- The current process contains no Supabase, Netlify, database, PostgreSQL, or RentCast environment variables.
- The only checked-in MFDA environment file is `mfda/.env.local.example`, containing placeholders only.
- No repository occurrence identified a concrete Supabase host/project reference. Candidate searches were redacted and excluded `.netlify/`, dependencies, and evidence artifacts.
- No Supabase `config.toml`, `.supabase/project-ref`, or `supabase/.temp/project-ref` exists at the repository root or under `mfda/`.
- A Supabase CLI executable exists at `/opt/homebrew/bin/supabase`, but there is no repository-local project linkage. A version-only invocation could not complete because the sandbox denied its attempted telemetry-file write outside the workspace; it made no hosted request and provides no staging evidence.

### Deployment configuration

- `mfda/netlify.toml` defines the MFDA build, publish directory, functions directory, SPA redirect, and security headers. It contains no site ID, Supabase project mapping, deploy-context mapping, or staging declaration.
- Root `netlify.toml` configures the public land site and does not establish an MFDA staging backend.
- `mfda/README.md` documents `mfda.alot.land` and manual Netlify/Supabase setup. It does not identify a staging/test project or distinguish a staging project from production.
- Migration tooling in `mfda/security/db-harness.mjs` is explicitly disposable local PostgreSQL. It is not hosted linkage or hosted migration tooling.

### Classification evidence

| Candidate | Classification | Evidence |
| --- | --- | --- |
| MFDA hosted Supabase | **Not identified** | No URL, project ref, environment binding, CLI link, or documented mapping was found. |
| Public `mfda.alot.land` deployment | **Production/public-facing or ambiguous; not staging proof** | It is the only documented deployment. No backend reference or isolation evidence was available. |
| Local disposable PostgreSQL harness | **Test, local only** | The harness explicitly removes hosted environment values and uses a temporary local cluster. It is not a hosted target. |

Whether real customer/user data exists in any hosted MFDA project is **unknown**. Because no target could be identified, absence of customer data cannot be established. The current repository CLI/config is **not linked to a hosted project** through any inspected local Supabase linkage file.

## 4. Mandatory hosted-write gate

```text
HOSTED TARGET CLASSIFICATION:
- NOT VERIFIED
```

Missing evidence required to proceed:

1. A concrete Supabase project reference and URL supplied through an approved, secret-safe channel.
2. Independent administrative evidence that the project is isolated non-production staging—not merely a suggestive project name.
3. Confirmation that the project contains synthetic-only test data and no real users/customers.
4. Authorization to create and modify synthetic Auth identities, organizations, invitations, and memberships in that project.
5. A verified backup/restore procedure or confirmation that the staging project is disposable and resettable.
6. The expected migration ledger/order and a credentialed read-only path to compare it before migration.
7. If proxy testing is desired, an existing staging function deployment demonstrably bound to that same isolated backend, with `RENTCAST_API_KEY` absent.

The hard stop was enforced. No hosted SQL, Supabase API, Netlify API, Auth, PostgREST, or function request was made.

## 5. Pre-migration staging state

**Not captured — blocked by target classification.**

Applied migration versions, relevant schema/table existence, function definitions/signatures, ownership, grants/revokes, triggers, foreign keys, RLS state/policies, and row counts remain unknown. It could not be determined whether migration 015 is already applied. No row data or row counts were queried.

## 6. Migration ordering assessment

The repository contains the expected forward migration `mfda/supabase/migration_015_p0_invitation_authorization.sql`, whose source states that it must run after all previous migrations and that migration 012 must not be replayed afterward. Repository ordering is available locally, but hosted migration history was unavailable. Therefore hosted prerequisite/order compatibility is **unable to determine**, and applying migration 015 was prohibited.

## 7. Historical membership inspection

**Result: unable to determine.**

No `org_members`, invitation, or Auth rows were queried. No personal emails or other user data were accessed or exposed. No membership was deleted or changed. Historical reconciliation remains required in verified isolated staging, with any cleanup deferred to a separately reviewed remediation plan.

## 8. Migration 015 application result

- Applied: **No**
- Command: **None**
- Exit result: **Not applicable**
- Migration state before/after: **Unknown / unchanged by this review**
- Errors/warnings: **Not attempted because the target was not verified isolated staging**
- Elapsed time: **Not applicable**
- Migration source modified: **No**

## 9. Effective grants, ownership, and functions

**Hosted verification not run.** Function ownership, `SECURITY DEFINER`, effective `search_path`, EXECUTE grants/revokes, trigger inventory, PostgREST RPC visibility, and schema-cache state remain pending. Local source expectations were already assessed by V3 and are not substituted here for effective hosted evidence.

## 10. Hosted RLS, PostgREST, and Auth checks

**Not run.** No synthetic hosted identities could safely be created or used because no isolated target was established. Permitted membership visibility, cross-org denial, forged-org denial, revoked/no-membership denial, role behavior, and RPC exposure remain pending.

## 11. Invitation authorization and lifecycle checks

**Not run hosted.** Valid redemption, expired/invalid/wrong-user/forged-org-or-role rejection, replay rejection, unverified-identity rejection, non-escalation of existing membership, returning-user behavior, concurrency, accepted-row preservation, author deletion, `accepted_at` preservation, and consumed-field immutability remain pending hosted verification.

## 12. Rent-estimate proxy authorization checks

**Not run hosted.** No isolated staging function deployment bound to an isolated staging Supabase backend was identified. The function was not deployed automatically and no URL was invoked. Missing/malformed/expired token behavior, membership and forged-org denials, valid-member authorization, and the expected no-key 501 boundary remain pending.

`RENTCAST_API_KEY` was neither configured nor read. **No RentCast call occurred.** No external response body or credential material was obtained.

## 13. Hosted tenant-isolation smoke tests

**Not run.** Synthetic Tenant A/Tenant B reads, auth replacement, org change, and revocation checks require a verified isolated staging backend. No real customer rows were accessed.

## 14. Local release-candidate rerun

**Not run in this halted verification.** The contract requires the local rerun after hosted staging verification. The mandatory hard stop occurred before hosted verification could begin, and its instruction is to create this report and stop.

The accepted V3 evidence (not a new run) reports:

| Matrix item | Prior V3 result only | Current hosted-verification rerun |
| --- | ---: | ---: |
| Complete MFDA P0/security | 142 pass | Not run |
| Prior diagnostics | 22 pass | Not run |
| `packages/mf-calc` | 244 pass | Not run |
| `workers/scan` | 186 pass | Not run |
| Frontend production build | PASS | Not run |
| Calc typecheck | 35 pre-existing diagnostics | Not run |

These prior totals are provenance, not claimed as fresh results for this branch.

## 15. Discrepancies

No hosted behavior was observed, so no hosted-versus-local behavioral discrepancy could be classified. The release-blocking evidence gap is environmental: the required isolated staging target and authorization were not available. No application or migration code was patched.

## 16. Remaining limitations

- Hosted migration order/state and application of migration 015 are unknown.
- Historical memberships remain uninspected.
- Hosted Auth, PostgREST, RLS, RPC exposure, grants, ownership, triggers, schema cache, and invitation lifecycle remain unverified.
- Hosted/deployed proxy behavior and runtime environment binding remain unverified.
- Hosted tenant isolation remains unverified.
- No fresh post-hosted local matrix was run.
- The V3-known `rent_estimates.created_by` deletion-FK limitation, compound-helper cancellation/atomicity limits, already-initiated work limits, and 35 pre-existing calc diagnostics remain as documented by the acceptance records.

## 17. External-call and data-access accounting

- Real RentCast call: **No**
- Any RentCast call: **No**
- Hosted Supabase/Auth/PostgREST call: **No**
- Hosted Netlify function/API call: **No**
- Production/customer data accessed: **No**
- Hosted data mutated: **No**
- Local synthetic test data created: **No**
- Commit/push/merge/deployment: **No**
- Financial Round 1 begun: **No**

## 18. Final P0-1 verdict

**CONDITIONAL PASS.** The V3 local invitation controls remain the accepted evidence, but hosted migration order, effective grants/ownership/Auth behavior, and historical memberships were not verified. The missing staging classification does not disprove the local result; it prevents promotion to PASS.

## 19. Final P0-2 verdict

**CONDITIONAL PASS.** The V3 local tenant-continuation and proxy-authorization controls remain the accepted evidence, but hosted Auth/PostgREST, deployed proxy binding/authorization, and tenant-isolation behavior were not verified. The missing staging classification prevents promotion to PASS.

## 20. Deployment gate

**B. HOSTED/STAGING VERIFICATION INCOMPLETE.**

Gate C is not justified because none of the required hosted evidence was obtained. Gate A is not selected because this review found no new release-blocking implementation defect; it found an unmet environment/authorization prerequisite and performed the mandated safe stop.

## 21. Exact next action

Provision or positively identify an isolated, non-production Supabase staging project and provide independent evidence of its isolation, synthetic-only contents/permission, project reference, credentialed read-only access, and disposable reset or tested restore capability. If proxy verification is required, also identify an already deployed staging function bound to that same backend and prove `RENTCAST_API_KEY` is absent without exposing secrets. Then repeat this controlled verification from the unchanged RC, beginning with migration-ledger and schema inspection before any write. Do not infer staging status from the project name.

Only after all hosted checks pass and the 142-check security suite plus the remaining local matrix are rerun should merge or controlled deployment review be reconsidered.

## 22. Stop confirmation

This verification stops at the mandatory classification gate. It does not commit, push, merge, deploy frontend or production code, apply a hosted migration, alter memberships, create users, or begin financial Round 1.
