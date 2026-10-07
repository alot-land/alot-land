# Review commands and reproducibility

Baseline: `pwd`, `git remote -v`, `git branch --show-current`, `git status`, `git rev-parse HEAD`, `git log --oneline -5`, `git rev-parse origin/hardening/mfda-p0-closure-v2`, `git merge-base HEAD origin/hardening/mfda-p0-closure-v2`. Results are printed in report section 1. No fetch was used.

Prior reports: `cat docs/audits/MFDA_P0_CLOSURE_V2_2026-10-06.md`; `git show audit/mfda-p0-independent-reaudit:docs/audits/MFDA_P0_INDEPENDENT_REAUDIT_2026-10-06.md`; `cat docs/audits/MFDA_P0_SECURITY_CLOSURE_2026-10-06.md`.

Source reads/searches used `rg --files`, scoped `rg -n`, `cat`, `sed -n`, `nl -ba`, `git show --stat b9288e1`, `git diff 9f8c6de b9288e1 -- mfda/security/tenant-browser.test.mjs`, and `git diff c800392 b9288e1 -- packages/mf-calc workers/scan` and preceding SQL/estimate files. Installed renderer/queue/SDK source was read locally. No production connection or external documentation lookup was used.

All redirected logs below are in `docs/audits/evidence/mfda-p0-v2-independent-20261007/`.

```sh
# cwd mfda, first sandbox attempt -> security-first.txt
npm run test:security
# cwd mfda, authorized substantive local rerun -> security.txt
npm run test:security
# cwd packages/mf-calc -> calc.txt and typecheck.txt
npm test
npm run typecheck
# cwd workers/scan -> scanner.txt
npm test
# cwd repository; build script changes to mfda, env files disabled, synthetic values
node docs/audits/evidence/mfda-p0-v2-independent-20261007/build.mjs
# -> build-review.txt; prior wrong-cwd attempt is build.txt
node docs/audits/evidence/mfda-p0-v2-independent-20261007/baseline-typecheck.mjs
# -> baseline-typecheck.txt and baseline-typecheck-comparison.json
# cwd mfda; final independent command -> independent-acceptance.txt
node --test --test-concurrency=1 ../docs/audits/evidence/mfda-p0-v2-independent-20261007/independent.test.mjs ../docs/audits/evidence/mfda-p0-v2-independent-20261007/csv-pages.test.mjs
```

Independent development attempts are separately retained as `independent-first.txt`, `independent-review.txt`, `independent-final.txt`, `independent-verified.txt`, and `independent-complete.txt`; see report section 16 for each failure/correction. The first command used the repository cwd, subsequent commands the required mfda cwd. The first two ran only independent.test.mjs; later commands added csv-pages.test.mjs. No application source or supplied test was changed. Earlier diagnostic revisions were replaced by the final preserved program, while failure transcripts remain.

Harness child commands are visible in the inspected `mfda/security/db-harness.mjs` and `browser-harness.mjs`: `initdb -A trust --no-locale -E UTF8`, `pg_ctl` with unique temporary socket directory and disabled TCP, and `psql -X -qAt -v ON_ERROR_STOP=1` with fixture role/identity. Database/browser tests require approved local execution because the sandbox denies PostgreSQL shared memory. Test teardown closes the created browser/server and stops/removes only the created database cluster. Baseline extraction uses read-only Git and links existing local dependencies; it makes no dependency download.

Final checks: `git diff --check`, `git status`, `git diff --stat`, `git rev-parse HEAD`, and a filtered process listing for the review's disposable processes. `node .../manifest.mjs` records current source/evidence fingerprints and verifies unchanged tracked files/HEAD. The manifest excludes `.netlify/` entirely.
