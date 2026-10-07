# MFDA P0 closure V2 — 2026-10-06

This is a narrow local correction of independent re-audit blockers R-1 and R-3. Work was performed on October 7, 2026; the filename/date follows the requested closure-round identifier. It does not certify hosted or production closure, and does not authorize deployment.

## 1. Baseline and scope

- Repository: `alot-land/alot-land`; directory: `/Users/davidastone/code/alot-land/alot-land`.
- Branch: `hardening/mfda-p0-closure-v2`.
- Required and verified starting SHA: `9f8c6de4a71955d3dceb937da93fe14ff5c39722`.
- Original vulnerable baseline: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`.
- Fetch/push remote: `https://github.com/alot-land/alot-land.git`.
- Merge-base with `origin/hardening/mfda-p0-security-closure`: the required starting SHA.
- Initial status: no tracked modifications; only the pre-existing untracked `.netlify/` directory. That directory was not read or written by this remediation.
- The first five commits printed were `9f8c6de`, `c800392`, `e413634`, `00393a5`, `05eb3ff`. Remote-tracking references were inspected locally; no fetch was performed.

Before code edits, the requested `pwd`, remote, branch, status, HEAD, five-commit log and merge-base commands were printed and checked. The source prerequisite passed. HEAD remains the starting SHA because no commit was made.

The independent report was read directly with:

```sh
git show audit/mfda-p0-independent-reaudit:docs/audits/MFDA_P0_INDEPENDENT_REAUDIT_2026-10-06.md
```

The first remediation remains on `hardening/mfda-p0-security-closure`; the independent review remains on `audit/mfda-p0-independent-reaudit`. Its reviewed verdicts were P0-1 CONDITIONAL PASS, P0-2 FAIL and deployment gate A. NOT SAFE TO DEPLOY. Its report was evidence and reproduction guidance, not an acceptance oracle.

No financial calculations, scanner behavior, photos, bedroom/unit assumptions, production property data, UX redesign, historical membership cleanup or other Round 0 fixes were undertaken. A single existing browser assertion was corrected after reproducing the report's R-4 test-timing issue; no product change was made to repair that harmless request race. R-2's foreground draft loss remains a documented limitation.

## 2. Blocker A reproduction and root cause

Two independent reproduction tests were written and executed against the unchanged starting tree before source edits. Their program and successful transcript are retained in [the evidence directory](evidence/mfda-p0-v2-20261006/).

For A, an accepted invitation in a disposable database referenced a synthetic author. Authorized deletion of that author from `auth.users` raised `Consumed invitation is immutable`; both the user and invitation remained unchanged, proving transactional rollback.

`schema.sql` defines `invites.invited_by REFERENCES auth.users(id) ON DELETE SET NULL`. There is no invitation `created_by`, separate author field, or recipient-user FK. The recipient is recorded by `email`. The original nullable inviter reference intentionally permits user removal without removing the invitation.

Migration 015's BEFORE UPDATE trigger rejected every changed column once `accepted_at` was non-null. PostgreSQL's FK cleanup is an UPDATE too, so the trigger rejected the intended `invited_by → NULL` action. `org_members.user_id` separately cascades deletion of the deleted user's own memberships. Organizations have no author-user deletion cascade. Existing author references in deals/scenarios/notes/mail history use nullable author FKs; notes also retain their recorded author email.

Admin invitation/membership RLS does not authorize deletion from `auth.users`. Auth-user deletion remains a separate trusted operation. This correction changes neither membership RLS nor invitation redemption authority.

## 3. Blocker A remediation and audit semantics

Migration 015 now permits a consumed invitation update only when all of these conditions hold:

1. The old inviter reference is non-null and the new reference is null.
2. Every other column is identical, including future added columns, using JSONB row comparison with only `invited_by` excluded.
3. The old referenced user no longer exists in `auth.users`.

The lookup runs in a fully qualified SECURITY DEFINER trigger with empty `search_path`, because an authorized Auth writer need not have general SELECT access to Auth users. PUBLIC, anon and authenticated retain no execute permission on the trigger or private redemption helper. The trigger returns only the row; it exposes no Auth-user contents or client-callable cleanup RPC.

This preserves the schema's existing deletion semantics without a blanket exception for inviter edits, database roles or nested triggers. A living author's reference cannot be nulled or reassigned by an org admin. Nulling combined with a consumption reset, role change or any other edit still fails. First consumption and the authoritative validator are unchanged.

Author deletion preserves the invitation row's ID, org, recipient email, role, token, creation/expiration timestamps and exact acceptance timestamp. A null inviter explicitly means its original Auth-user reference no longer exists; it does not mean a reusable invitation. No additional author PII or shadow identity is added. This is the existing application's historical record model, not a new tamper-proof audit ledger: pre-existing authorized invitation/org deletion policies remain unchanged.

Deleting a recipient removes only that user's memberships through the existing FK. The consumed invitation keeps its recipient email and consumption state. A replacement verified user with the same email cannot replay it. Existing memberships belonging to other users and unrelated org/security history are preserved. No invitation-history deletion or membership backfill is introduced.

## 4. Migration safety and P0-1 preservation

The isolated PostgreSQL checks exercise:

- The complete fresh migration chain, including 013a, 014 and corrected 015.
- An upgrade from the complete prior chain with existing users, memberships, consumed and pending invitations, and authored note history.
- Exact invitation/membership snapshots before and after upgrade.
- Rejection of consumed edits to ID, org, recipient, role, token, inviter, acceptance, expiry and creation timestamps; no-op updates remain allowed.
- Actual author deletion by a restricted synthetic Auth writer with only required Auth-table rights, no private helper grants and no general SELECT on the Auth table.
- Exact consumed-row preservation except the intended nullable inviter cleanup; pending invites remain pending.
- Preservation of other users' memberships, organizations, a deal and note history; only the deleted user's memberships cascade.
- Recipient deletion, same-email replacement, consumption preservation and denied replay.
- Subsequent valid redemption, existing-member non-escalation and replay rejection.
- Reapplication of 015 twice with identical row snapshots and correct effective function permissions.

The original 21 invitation leaf tests were rerun: expired/deleted/invalid/row-ID tokens, wrong recipient and client identity substitution, wrong-org/role forging, unverified email, confirmation onboarding, exact and delayed expiration, validation locks, consumed replay/retargeting, existing-member non-escalation, eight concurrent redemptions, revocation ordering, transactional rollback on membership failure, uninvited users, valid new/returning users, actual RLS and private helper permissions.

The authoritative boundary is still the locked private validator, followed by membership insertion and consumption in one transaction. No UI decision becomes membership authority. No hosted migration was applied.

## 5. Blocker B reproduction and root cause

As A, the unchanged actual SPA opened `/off-market` and initiated the synthetic saved list's Export CSV operation. The nested parcel SQL ran under A's real local RLS and captured A-only rows. Its browser response was held. The real SDK then replaced A with B; Synthetic Tenant B rendered, A markers were absent and B's direct parcel read returned zero. Releasing the held response downloaded `v2-a-only-export.csv` containing `A ONLY PARCEL CANARY`.

The path was:

```text
Saved-list Export CSV click
→ OffMarket.exportSavedList(list)
→ listParcelsForMailList(list.id, captured org.id)
→ paged mail_list_items read with nested parcels and A's org predicate
→ resumed old async closure
→ exportCSV / freedomsoftCSV
→ downloadCSV / Blob / object URL
→ temporary anchor click
→ browser download; export-history write
```

The original read used the correct initiating org predicate. Tenant-boundary unmount and QueryClient clearing protected current component/query state but could not stop the direct awaited continuation. The old function retained A rows and invoked a global document download after B became active. Hiding/unmounting UI alone was insufficient.

## 6. Completion guard and export remediation

`tenant-completion.js` supplies one shared completion lifetime. Initiation captures the boundary lifetime/generation. Completion compares authenticated user ID, auth generation, organization ID, role and organization generation against current authorized scope. Layout cleanup invalidates the old lifetime; reactivation during StrictMode cannot revive previously captured work. Auth expiry, signout, missing membership and validation/loading return no authorized scope.

`auth.jsx` exposes its synchronous auth snapshot to the guard. `org.jsx` publishes an immediately readable scope before scheduling React state; org/role/availability transitions advance its generation, including background changes. This closes the interval before React commits a new boundary and prevents A → B → A from making an old operation current again. Same-identity token renewal and unchanged background polling preserve the existing scope.

`exportSavedList` captures at initiation and checks before CSV preparation. A stale success or error is silently discarded. An actual current-scope failure displays an export error and can be retried. `downloadCSV` requires the same predicate before Blob/URL creation and again before the final anchor click. Filtered-parcel CSV uses the same download boundary. Only a released CSV logs a completed mail export; cancelled work creates no export-history row. Filenames are prepared after the initiating scope check.

The tenant query wrapper also rejects obsolete imperative cache writes/invalidations, preventing late mutation callbacks from repopulating an old cleared cache. Scoped React Query reads retain the original independent clients, query prefixes, cancellation and clearing.

Three existing awaited mutation paths could navigate the shared browser after unmount: DealNew save, OffMarketDeal promotion/existing-deal lookup, and OnMarket Analyze. They now use the same initiating predicate before follow-on work and navigation. Stale completion/error state is suppressed where applicable. This does not roll back a write already authorized and completed on the server or redesign compound saves.

## 7. Artifact and callback inventory

Searches covered all MFDA source for CSV/export/download/PDF/report/blob/object-URL flows, awaits, promises, timers, navigation and global browser actions.

| Path | Classification before V2 | V2 disposition |
| --- | --- | --- |
| Saved mail-list/campaign CSV (`OffMarket`, `listParcelsForMailList`, `freedomsoft`) | Tenant-scoped; vulnerable stale continuation | Guard initiation, preparation, Blob/URL and download; silent cancellation; no stale export log |
| Filtered off-market parcel CSV | Tenant-scoped; synchronous current-view export | Uses the shared guarded download boundary |
| Deal PDF/report (`ReportButton`, `ReportDocument`, renderer) | Tenant-scoped; already detached on tenant unmount with queue cancellation | Retain renderer and add shared scope check in click capture before browser/legacy save behavior; positive actual PDF download tested |
| Deal save / off-market promotion / on-market Analyze | Tenant-scoped; vulnerable delayed global navigation class | Shared guard before follow-on work and final navigation |
| Ordinary delayed query hydration and component-local success/error callbacks | Tenant-scoped; already safe through scoped client/subtree lifetime and existing hydration checks | Preserve existing behavior and rerun coverage |
| Optimistic mutation cache writes and invalidations | Tenant-scoped; old client already separate, but obsolete callbacks could repopulate it | Shared guard also suppresses imperative writes to obsolete clients |
| Auth startup/session-expiry callbacks and membership loads | Tenant lifecycle; existing generation/alive/request checks | Preserve source checks; deterministic obsolete-request regression |
| Listing/Street View/contact/map links and filenames in the current subtree | Tenant-scoped synchronous links; no delayed artifact continuation | No broad rewrite |
| Theme, field tooltip positioning, lazy module reload | Not tenant-scoped artifacts / unrelated | Unchanged |
| Separate saved-deal CSV, campaign PDF, queued report worker or additional browser file-download API | Not present in MFDA source | No invented implementation or certification |

Installed renderer inspection confirms `usePDF` ends its render queue on unmount. The queue increments its session and refuses late promise success from an obsolete session; discarded PDF work cannot attach its URL to B's new component. Ready PDF links additionally validate current scope in capture phase, before native download or the renderer's legacy save handler. No renderer dependency or report/calculation content was changed. A specifically held PDF renderer promise was not exercised end-to-end; the held CSV is the representative durable async artifact flow.

## 8. New regression coverage

`invitation-lifecycle.test.mjs`: 8 leaves plus its parent. `tenant-completion.test.mjs`: 6 leaves plus its parent. `export-browser.test.mjs`: 15 leaves plus its parent. Total new reported checks: 32 (29 individual leaves).

The browser suite uses the actual SPA, SDK, CSV code, DOM download and installed PDF renderer. Narrow test-only routes implement nested saved-list reads and export-history writes with real authenticated-role SQL. Responses are captured before being held. It asserts downloaded bytes, filenames, export logs, current and retained-old caches, a B-view DOM observer, CSV Blob construction, object URLs and anchor download clicks.

Covered export cases:

1. A remains A: delayed CSV succeeds with correct contents/name/history.
2. Auth A → B: held A response produces no artifact or cache/state disclosure; B export succeeds.
3. Org A → B with a multi-org user: same guarantees and successful B export.
4. Auth A → B → A: first export stays cancelled; a fresh A export works.
5. Org A → B → A: first export stays cancelled.
6. Held failed response after auth replacement: silent cancellation and working B export.
7. Active A failure followed by an A retry that resolves after B replacement: no artifact or error restored under B.
8. Real SDK retry of a failed A request after B becomes active: the SDK uses B's token with the obsolete A filter, actual RLS returns no A rows, and the guard suppresses even an empty stale CSV/A filename; B's next export works.
9. Same org/role, different authenticated user: old export cancelled.
10. Same identity token renewal: pending authorized export succeeds.
11. Role downgrade within the same user/org: old export cancelled.
12. Membership removal: already authorized held result cancelled.
13. Current filtered CSV still downloads using the same guarded boundary.
14. Held successful OnMarket mutation cannot navigate B to A's result.
15. Current-tenant PDF produces a browser download with `%PDF-` bytes and expected filename.

All negative CSV cases assert no download event, CSV Blob, object URL, download click or completed-export log. B's cache/state contains no A marker; the retained old client is empty. Scope cancellation produces no alert. Held fetches are consumed and browser continuations settled before negative assertions.

## 9. Existing suite preservation and test reliability

The original baseline controls and all invitation tests are unchanged. The tenant suite retains all 37 leaf cases covering signout/login, direct session replacement, repeated auth/org switches, ten shared screens, reload/history/persistence, delayed hydration, actual failure/retry, token renewal, unchanged polling, membership removal, role downgrade, expiry, cache prefixes, delayed membership and cross-tab auth.

The first approved complete V2 run reproduced the independent report's R-4 aggregate request assertion failure: 93 reported passes, one failed leaf and its failed parent (2 reported failures). It did not reproduce a stale UI/download result.

That single test now deliberately holds A's foreground membership RPC until B is current, then releases it and observes an A-filtered request with B's JWT. It asserts actual B RLS returns an empty result, the obsolete response cannot replace B's authoritative memberships, A markers never render, the old cache stays empty, the current client differs and every current key has B's user/org/role. It also requires a real B-filtered membership load. This replaces the inaccurate claim about all historical request filters with a deterministic authorization/lifetime invariant; no security case was removed.

Initial new-test development also corrected a DOM observer that mistook an unselected B org option for active B, and distinguished SDK automatic retry behavior from manual retry counts. A stricter experimental retry assertion expected A rows on the second request; the actual SDK uses B's current token and RLS returns zero. The final assertion verifies that observed behavior and suppression of the stale empty artifact. These preliminary test failures are not represented as green runs.

## 10. Commands, counts, build and typecheck

All tests used local/synthetic users, emails, sessions, organizations, deals and parcels. PostgreSQL clusters used unique temporary directories and Unix sockets with TCP disabled. Browser routes block non-local traffic other than the intercepted synthetic `mfda-security.invalid` service, and block its realtime connection. No dependencies were installed and no production credentials/data or hosted Supabase were used.

Verification programs are retained with the transcripts. The security command expands the configured `security/*.test.mjs` script into the six explicit files and runs Node with `--test --test-concurrency=1`. Calculation/scanner commands are their configured `npm test`; calculation typecheck is `npm run typecheck`.

The sandbox denied PostgreSQL shared memory in a recorded infrastructure attempt (7 guard checks passed, 5 database/browser setup containers failed). Approved execution reran the local security checks. This infrastructure failure and the earlier R-4 failure are retained separately and are not aggregated into final test totals.

| Final validation | Result | Reported passes | Failures | Skips |
| --- | --- | ---: | ---: | ---: |
| Complete MFDA P0 suite, 6 files | PASS | 95 | 0 | 0 |
| Calculation tests, 17 files | PASS | 244 | 0 | 0 |
| Scanner tests, 12 files | PASS | 186 | 0 | 0 |
| Frontend Vite production build | PASS, exit 0 | — | — | — |
| Configured calculation typecheck | FAIL, exit 2; unchanged baseline failure | — | 35 diagnostics | — |
| Fresh immutable baseline calculation typecheck | FAIL, exit 2; identical output | — | 35 diagnostics | — |

The final complete run passed all 95 reported security checks: the retained 63 checks and 32 new checks, comprising 89 individual leaves and 6 parent containers. Calculation/scanner add 430 leaves. Final matrix: **525 reported passes, 0 failures, 0 skips, 0 cancellations**, or **519 individual passing checks**, across 35 files. Counts do not aggregate repeated attempts or the separate pre-fix expected-defect reproductions. New focused coverage also passed 32/32 before the subsequent test-reliability correction. The final full run includes that deterministic correction and all new coverage.

The build uses the repository's Vite config from `mfda/`, disables environment-file loading, supplies only synthetic Supabase values and writes outside the repo into a temporary directory. Normal large-chunk advisories remain; no compilation failure occurred. It was rerun after the final source edit.

Every tracked calculation file was freshly extracted from `c800392` using `git ls-tree`/`git show` into an isolated directory with existing dependencies linked. Its configured typecheck transcript is byte-identical to the current transcript: exactly 35 diagnostics in each, both exit 2. Git comparison also proves the calculation and scanner trees unchanged from that immutable baseline. This is no new typecheck regression; the configured check remains failing. MFDA and scanner have no separate configured typecheck script.

The review's 14 independently authored checks were not presented as new green evidence: its two expected-blocker assertions intentionally describe the old defects. V2 independently reproduced the two blockers before editing and adds the durable corrected-behavior checks above. Another independent review is still required.

## 11. Change review

The tracked diff and each new source/test file were inspected, including migration functions, permissions and the preceding FK/RLS definitions. `git diff --check` passed. Final source/secret-pattern review and fingerprints are recorded in the evidence manifest. Only the invitation trigger, completion-scope plumbing, affected artifact/navigation paths, tests, report and evidence are in scope.

The calculation/scanner trees, report document content, underwriting/parcel-screen math, photo and unit editors, and migrations preceding 015 are unchanged. No production configuration, credentials, data files, lockfiles or styles were edited. `.netlify/` remains the pre-existing untracked entry and was untouched. No commit, push, merge, deployment or hosted migration occurred. `git diff --stat` lists tracked modifications only; new files remain untracked and are listed by `git status --short` and the evidence inventory.

## 12. Deployment ordering, limitations and unverified work

In a separately authorized future rollout:

1. Independently review this uncommitted V2 diff and rerun its disposable tests.
2. Verify real Supabase schema/ownership/drift, Auth insert/confirmation/delete behavior, effective grants, RPC exposure and RLS in an isolated staging stack.
3. Apply the complete earlier schema/migration chain through 014, including 013a, then this corrected 015 in its transaction, before releasing the client that requires `accept_pending_mfda_invites()`.
4. Verify effective grants/triggers, legitimate author deletion, valid/invalid/expired/unverified/replayed invitations and PostgREST schema cache/RPC visibility before enabling that client.
5. Do not replay `schema.sql` or migration 012 after 015; they can reinstall an earlier bootstrap. Track migration ordering explicitly.
6. Separately disposition historical memberships potentially granted by the vulnerable bootstrap with an authorized operator; migration 015 deliberately preserves them.

015 was corrected in place because it has not been applied to hosted Supabase. No new FK/table/backfill or migration 016 is necessary. Populated upgrade and repeat application were tested locally. An installation with a different migration history requires a separately reviewed plan; no hosted state was inspected here.

Remaining limitations:

- Actual Supabase Auth, email delivery, PostgREST, live grants/ownership/schema drift and hosted migration application remain unverified. Local fixtures are real PostgreSQL authorization but a minimal Auth/API model.
- Existing historical inappropriate memberships remain untouched; no actual membership inventory or reconciliation was performed.
- Chromium coverage does not certify Firefox/WebKit, deployed HTTP caching or cross-document BFCache.
- Idle revocation still depends on existing realtime/focus/polling detection (up to the 30-second polling fallback). Current database RLS remains the server boundary. The guard immediately rejects a changed authorization scope once observed locally.
- Existing foreground revalidation still discards unsaved drafts, as R-2 described. This round does not repair or imply product acceptance of it.
- A specifically delayed PDF renderer promise and every compound mutation stage are not exhaustively exercised end-to-end. Renderer queue cleanup was inspected, a normal PDF download passed, and the shared guard plus held CSV/representative navigation are durable coverage.
- A download already released while A was authorized cannot be recalled. A server write already completed before scope change is not rolled back by client cancellation.
- The 35 pre-existing calculation diagnostics remain. Financial Round 1 and broader Round 0 correctness remain outside scope.

## 13. Local verdicts

- BLOCKER A: **CLOSED**
- BLOCKER B: **CLOSED**
- P0-1 local: **CLOSED**
- P0-2 local: **CLOSED**

These verdicts follow the complete passing local suite. They apply to the two requested defect classes and preservation of the first remediation, not historical or hosted/production acceptance. No deployment approval is issued. Stop after this local V2 remediation; no commit/push/merge/deploy/hosted migration or financial Round 1 action is authorized or performed.
