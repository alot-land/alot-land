# MFDA P0 Local Isolated Supabase Acceptance — 2026-10-07

## Executive result

**P0-1 local acceptance: PASS.**

**P0-2 local acceptance: PASS.**

**Overall local P0 status: LOCAL P0 ACCEPTED.**

**Hosted status: PRE-LAUNCH HOSTED ACCEPTANCE REQUIRED.**

This result applies only to the disposable local Supabase stack described below. It does not claim hosted acceptance, production certification, commercial deployment approval, or permission to begin financial Round 1.

## 1. Branch and reviewed source

- Repository: `alot-land/alot-land`
- Branch: `audit/mfda-p0-local-isolated-acceptance`
- Reviewed HEAD: `ae5426a39e5a689a8eece17ae8f096edfd8924be`
- Merge base with `hardening/mfda-p0-closure-v3`: `ae5426a39e5a689a8eece17ae8f096edfd8924be`
- Original vulnerable baseline: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`
- Starting worktree: no tracked changes; only the pre-existing untracked `.netlify/` directory
- `.netlify/` was not read, used, or changed.

The required V3 closure report, V3 independent re-audit, and halted hosted-staging report were read and used as the acceptance contract. No unrelated remediation was reopened.

## 2. Environment classification

```text
LOCAL TARGET CLASSIFICATION:
VERIFIED LOCAL / DISPOSABLE / NON-HOSTED
```

Evidence:

- Supabase CLI project ID was `mfda-p0-local-isolated`; there was no project ref, link, login, cloud profile use, or hosted URL.
- The accepted host listeners were exclusively `127.0.0.1:55421` (API/Auth/PostgREST) and `127.0.0.1:55422` (PostgreSQL).
- Containers carried `com.supabase.cli.project=mfda-p0-local-isolated` and the repository `mfda` workdir label.
- All identities, organizations, invitations, deals, units, scenarios, notes, lists, and rent estimates used obvious `example.invalid` or synthetic markers.
- No production, hosted, customer, RentCast, or Netlify credential was read or used.
- The state was disposable and was reconstructed from repository SQL, then removed with `supabase stop --no-backup`.

The CLI initially advertised DB `127.0.0.1:55422`, API `http://127.0.0.1:55421`, Studio `http://127.0.0.1:55423`, and mail UI `http://127.0.0.1:55424`. Colima's first host forwarding used wildcard listeners despite those loopback URLs. Before any MFDA migration or fixture, Studio/mail were stopped and the acceptance-owned DB/API gateway containers were recreated with explicit `127.0.0.1` publishes. `lsof`, Docker port metadata, Auth health, PostgREST reachability, and a PostgreSQL query then passed. Studio/mail were not used for acceptance.

## 3. Tooling

| Tool | Observed version/state |
| --- | --- |
| Supabase CLI | 2.114.0 |
| Docker Engine client | 29.7.2, local `colima` context |
| Local Supabase PostgreSQL | 17.6 container image |
| PostgreSQL client | 17.10 |
| Node | 22.17.0 |
| npm | 11.4.2 |
| Dependencies | Root and `mfda` dependencies already installed; nothing installed globally |

Local generated API/JWT/service keys were synthetic and are redacted. Tests received only runtime environment variables. No key was added to source or the report.

## 4. Local configuration and grant model

`mfda/supabase/config.toml` is local-only, has no hosted project ref, uses dedicated `5542x` ports, and disables CLI-managed migrations/seeding because this repository predates the CLI `migrations/` naming convention. `mfda/security/local-supabase-rebuild.sh` applies `schema.sql` followed by lexical `migration_*.sql` with `ON_ERROR_STOP`.

The current CLI defaults new public objects to no API-role table privileges. The repository SQL and README were authored for Supabase's earlier SQL-Editor/default exposure model, and the existing security DB harness explicitly grants authenticated CRUD for the same reason. The local config therefore makes `api.auto_expose_new_tables = true` explicit, and the rebuild driver establishes the corresponding legacy public-schema default privileges before applying repository SQL. RLS remains enabled on every MFDA table. This is a local compatibility assumption, not evidence of hosted grants; hosted effective grants remain mandatory in the pre-launch gate.

Runtime directories `.temp/` and `.branches/` are ignored under `mfda/supabase/`. No generated database volume or runtime state is a deliverable.

## 5. Reset and rebuild proof

The first CLI `db reset` attempt stopped before changing application state because a retained acceptance snapshot container still referenced the disposable volume. That path was not reused because it would also recreate wildcard port mappings.

The accepted reset path preserves the real Supabase Auth/PostgREST infrastructure, drops and recreates only the disposable `public` application schema, establishes the explicit local API-grant baseline, and applies the repository chain in order. It was run repeatedly from zero. Each accepted cycle ended with:

```text
public_tables=23
rls_tables=23
```

PostgreSQL 17 adds a random `\restrict`/`\unrestrict` nonce to each schema dump. After removing only those wrapper lines, two consecutive clean rebuilds produced the identical public-schema SHA-256:

```text
4f6b97ee5234b97f8b113e8d3866ba55d9ebaeea4009e5a44fcf722fd8712f99
```

This proves deterministic reconstruction of the MFDA public schema from the checked-in chain plus the explicit local Supabase grant baseline.

## 6. Migration chain and migration 015

Observed order:

```text
schema.sql
migration_002_sourcing.sql
migration_003_photos.sql
migration_004_rent_bands.sql
migration_005_contacts_brokerage.sql
migration_006_offmarket.sql
migration_007_usmarkets.sql
migration_008_favorites.sql
migration_009_ratings_notes.sql
migration_010_goals.sql
migration_011_deal_tracking.sql
migration_012_tax_presets.sql
migration_013_rent_estimates.sql
migration_013a_fix_rent_estimates_index.sql
migration_014_parcel_coverage.sql
migration_015_p0_invitation_authorization.sql
```

Every application used `ON_ERROR_STOP` and completed. Migration 012 was before 015 and was never replayed after 015. Reapplying 015 over populated synthetic invitations/memberships succeeded without changing membership counts or reopening consumption.

Effective migration-015 metadata in the actual local Supabase database:

| Function | Owner | Security definer | `search_path` | anon execute | authenticated execute |
| --- | --- | --- | --- | --- | --- |
| `accept_mfda_invite(uuid,uuid)` | postgres | yes | empty | no | no |
| `redeem_invite(uuid)` | postgres | yes | empty | no | yes |
| `accept_pending_mfda_invites()` | postgres | yes | empty | no | yes |
| `bootstrap_new_user()` | postgres | yes | empty | no | no |
| `protect_consumed_mfda_invite()` | postgres | yes | empty | no | no |

The local schema contained ten public functions and four relevant non-internal MFDA triggers. PostgREST exposed only the intended authenticated invitation RPCs; private helpers were unavailable to client roles.

## 7. Synthetic fixtures

Fixtures included Tenant A, Tenant B, a multi-org user, a no-membership user, a revoked user, a returning user, wrong-recipient and unverified identities, live/expired/consumed invitations, two deals and unit mixes, scenarios, notes, saved mail lists, and rent estimates. All email addresses ended in `example.invalid`; all row content was marked `A ONLY`, `B ONLY`, or `Synthetic`.

## 8. Auth and PostgREST result

The dedicated real-stack suite passed **11/11 reported tests** (10 leaf checks), zero failures/skips. It used GoTrue-issued local sessions and the actual local PostgREST endpoint.

- Permitted A and B reads returned only their organizations' rows.
- Cross-tenant and forged-org filters returned no protected rows.
- No-membership and revoked users returned no protected rows.
- The multi-org user received A rows for an A request, B rows for a B request, and only its two authorized organizations without an org filter.
- Anonymous reads returned no protected data and anonymous writes/RPC execution were denied.
- A member could not create an admin invitation or alter its organization; zero rows changed.
- RPC exposure matched migration 015's intended grants.

## 9. Invitation authorization result

Actual local Auth/PostgREST and trusted database assertions passed for:

- valid new and returning-user invitation acceptance;
- expired, malformed/invalid, wrong-recipient, extra/wrong-org, and role-forging rejection;
- unverified identity rejection;
- consumed replay, retarget, role change, and reactivation rejection;
- existing-member non-escalation;
- eight-way concurrent redemption with exactly one success, one membership, and one consumption;
- preserved consumed row and `accepted_at`;
- authorized Auth-user deletion nulling only `invited_by` without deleting/reactivating the consumed row;
- correct membership cardinality after every case.

## 10. Tenant isolation result

The actual API stack independently enforced backend isolation for:

- deals, including tracking/status-bearing rows;
- units;
- scenarios;
- notes;
- saved mail lists;
- rent estimates;
- memberships.

This was independent of React Query cache isolation. The existing 142-check suite separately reconfirmed cache/client lifecycle isolation across the full SPA.

## 11. Rent-estimate proxy result

The actual handler was bound to local GoTrue and PostgREST/RLS. Results:

| Case | Result |
| --- | --- |
| No Authorization | 401 |
| Malformed bearer | 401 |
| Invalid session | 401 |
| Expired signed local session | 401 |
| Valid user without membership | 403 |
| Forged org | 403 |
| Missing org | 403 |
| Revoked membership | 403 |
| Valid user + valid org, no `RENTCAST_API_KEY` | 501 expected configuration boundary |
| Caller-supplied forged `userId` | ignored; identity came from Auth |

Responses did not reveal tokens, keys, database credentials, or internal exceptions. No real RentCast request occurred. The browser matrix used a synthetic server key only inside the test process and intercepted the external RentCast hostname; Supabase authorization remained real.

## 12. RentEstimator tenant-completion result

The new browser suite passed **10/10 reported tests** (9 leaf checks), zero failures/skips, against the actual local GoTrue/PostgREST/RLS stack. Only the external RentCast response boundary was stubbed.

- A remained A and completed with exact A cache/meter attribution.
- A cache miss held across switch to B initiated no A proxy.
- A usage read held across switch to B initiated no obsolete continuation.
- Session lookup held across switch to B initiated no stale call.
- A proxy result held across switch to B published no result and wrote no cache/meter.
- A → B → A did not revive the first A operation; a fresh A action worked.
- A suppressed, then a fresh B estimate worked with B-only attribution.
- Logout suppressed every continuation.
- Membership revocation during the action failed closed.
- No A result, cache row, or metering row appeared under B.

The accepted historical 23-case RentEstimator suite also passed and covers both user and organization transitions, late errors, cache hits, token renewal, quota behavior, and already-initiated usage writes.

## 13. Historical-membership simulation

An uninvited verified user created after migration 015 received no organization or administrative membership, proving future vulnerable bootstrap creation is closed. A synthetic historical administrative membership was then inserted by the trusted fixture and migration 015 was reapplied. The row remained unchanged, proving 015 intentionally does not reconcile historical memberships.

No cleanup was invented. Real hosted production historical membership inspection remains a mandatory pre-launch hosted task.

## 14. Deferred issues

| Item | Result |
| --- | --- |
| `rent_estimates.created_by` NO ACTION FK | Reproduced: deleting its Auth author fails and rolls back. This remains bounded P2 lifecycle/retention debt, not a P0 tenant leak or invitation bypass. |
| Compound-helper continuation/atomicity | No concrete cross-tenant artifact or integrity failure was reproduced. Remains deferred and is not promoted to P0. |
| Calc type diagnostics | Exactly 35 at reviewed HEAD and original baseline; diagnostic lines are byte-identical. Unchanged debt. |
| Real hosted historical memberships | Not inspected locally and explicitly deferred to the pre-launch hosted gate. |
| Legacy API-exposure assumption | Made explicit in the local config/rebuild driver. Hosted effective grants must be inspected; future new-project SQL should eventually express required grants directly. |

## 15. Full regression matrix

| Validation | Result | Reported passes | Failures | Skips |
| --- | --- | ---: | ---: | ---: |
| Accepted MFDA P0/security, original 8 files | PASS | 142 | 0 | 0 |
| Prior independent regressions, 2 files | PASS | 22 | 0 | 0 |
| New local Auth/PostgREST/invitation/proxy acceptance | PASS | 11 | 0 | 0 |
| New actual-stack RentEstimator browser acceptance | PASS | 10 | 0 | 0 |
| `packages/mf-calc`, 17 files | PASS | 244 | 0 | 0 |
| `workers/scan`, 12 files | PASS | 186 | 0 | 0 |
| Frontend production build | PASS | — | 0 | 0 |
| Calc configured typecheck | Expected baseline failure | 35 diagnostics | unchanged | — |

Aggregate executable results: **615 reported passes / 602 leaf checks in 41 test files**, zero failures, zero skips. The 21 new local-stack reported passes are in addition to, not substitutions for, the accepted 142 and 22 gates.

## 16. Build and typecheck

Vite 6.4.3 transformed 350 modules and completed the production build successfully. The existing large-chunk advisory remained. Output was written under `/private/tmp`, not the repository. A bundle scan found no local JWT secret, local database credential, synthetic RentCast stub value, service-role setting, RentCast server endpoint, or `X-Api-Key`; the only `RENTCAST_API_KEY` string is existing user-facing Guide text. The intentionally injected local public build key is not a secret.

`npm run typecheck` exits 2 with 35 diagnostics. A fresh extraction of `packages/mf-calc` at `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd` was run with the same installed toolchain. Both runs emitted 35 diagnostics, and their diagnostic lines were byte-identical.

## 17. Attempt accounting

Non-final attempts are not counted as passes:

- The first CLI reset stopped before schema change because an acceptance snapshot held the volume. The accepted schema-reset driver replaced this unsafe path.
- The first actual-stack API suite expected PostgREST PATCH status 200; the real zero-row response was 204. A second attempt assumed an absent `Content-Range`; the real response used `*/*`. Database assertions showed no row changed. Those response-shape assumptions were corrected; the final suite passed 11/11.
- Initial actual-stack browser attempts exposed harness readiness issues: the first multi-org load selected B before the requested A preference, and single-org users render a label rather than a select. The harness now waits/selects through the real UI. The final suite passed 10/10.
- Raw PostgreSQL 17 schema hashes differed only because of generated dump safety nonces. Removing only `\restrict`/`\unrestrict` lines produced matching hashes.
- The prior independent regression rewrote randomized observation evidence during execution. That tracked file was restored exactly to HEAD before final status.

No application or migration code was patched in response to these harness/infrastructure attempts.

## 18. Shutdown and cleanup

- `supabase stop --workdir mfda --no-backup` completed successfully for project `mfda-p0-local-isolated`.
- No acceptance container, database volume, Docker network, or listener on ports 55421–55424 remained.
- The two temporary loopback snapshot images were removed.
- The unrelated `gtl-postgres` container remained running and was not modified. No command targeted unrelated containers.
- Local generated runtime directories are ignored; source tests/config/report remain for reproducibility.
- No production or hosted secret was added. `.netlify/` remained the same pre-existing untracked path and was not touched.

## 19. Remaining hosted gate

The only remaining release gate is **PRE-LAUNCH HOSTED ACCEPTANCE**, requiring:

1. real hosted migration ledger/order, including proof that 012 is not replayed after 015;
2. hosted effective grants, ownership, security-definer/search-path state, triggers, RLS, and RPC/schema-cache exposure;
3. hosted Auth/PostgREST behavior with synthetic identities and organizations;
4. production historical membership inspection and separately reviewed cleanup only if evidence requires it;
5. deployed proxy environment binding to the intended hosted Supabase project;
6. no-real-RentCast authorization smoke tests where feasible, with the key absent and valid authorization stopping at the configuration boundary.

This local result does not certify any hosted environment.

## 20. Final verdicts

- **P0-1 local acceptance: PASS**
- **P0-2 local acceptance: PASS**
- **Overall local P0 status: LOCAL P0 ACCEPTED**
- **Hosted status: PRE-LAUNCH HOSTED ACCEPTANCE REQUIRED**

## 21. Exact next action

Stop this phase. Do not commit, push, merge, deploy, connect to hosted Supabase, or begin financial Round 1. When an isolated hosted target is later authorized and positively identified, run only the narrowly defined pre-launch hosted acceptance above from reviewed SHA `ae5426a39e5a689a8eece17ae8f096edfd8924be`.
