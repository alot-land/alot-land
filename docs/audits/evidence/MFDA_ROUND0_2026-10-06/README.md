# MFDA Round 0 evidence

Audited SHA: `c800392a3c57cb425dc9ab90ca3cda4893b2e5fd`. These are audit artifacts, not application changes or a financial certification.

* `test-summary.json`: current existing-test counts/files and dependency-audit severity totals; 430 passing tests, 29 files, no failures/skips.
* `calc-typecheck.log`: failing configured typecheck, 35 diagnostics.
* `diagnostics.json`: synthetic calculation, parser, photograph extraction, proxy and CSV observations. RentCast fetches were mocked; no actual provider request occurred.
* `parcel-probes.json`: mocked transfer-limited page and all-rejected import observations.
* `db-probes.log`: selected PostgreSQL probes against an isolated temporary instance with synthetic auth/users/bucket stubs; not production Supabase.
* `browser-probes.json`: local real-SPA checks with synthetic sessions and mocked Supabase; external requests blocked. Tenant B's deal read was denied after a delay, but cached tenant A data appeared first.
* Screenshots: synthetic results, mobile overflow, edit defaults, and cached tenant exposure. No customer data or third-party photographs are included. External fonts were blocked.
* `*.mjs.txt` and `*.sql.txt`: exact text archives of the executed diagnostic harnesses and isolated-database setup/probes. Their original temporary absolute paths are preserved as evidence. They are not executable production scripts or installed regression suites; adapt them into later regression assets in a disposable local environment. The Vite harness uses synthetic environment settings, and provider/database requests in the JS probes are mocked.

Temporary harness/database/preview files and audit-installed dependencies/build output were cleaned after capture. See the audit's commands, source references, limitations and reproduction details. These selected diagnostic observations are separate from the existing Vitest pass count. Do not apply the synthetic database setup to an existing or production database.
