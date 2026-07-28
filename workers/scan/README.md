# MFDA Scanner · Redfin lane

Fills the app's **On-Market** queue (active listings → `deals` as leads) and
the comps store (sold listings → `comps`). Runs on the operator's laptop or the
droplet — **never** in the browser app, because it uses the Supabase
service-role key and talks to Redfin directly.

Scraping internals are generalized from `AlotOfLand/redfin-comps`
(`HANDOFF-MFDA.md` there). Inherited hard rules: normal-browser UA, 1 request
per 1.5s globally, no CAPTCHA solving / proxies / evasion, stop on block.

## Known data limits (from the handoff — not bugs)

- **No unit counts.** Redfin only says `2-4` or `5+`. A "5+" row can be 5 or
  200 units — verify before underwriting. The app labels this.
- Phoenix hits Redfin's 350-row cap instantly → the scanner auto-splits by
  price bands and records any still-capped bands in `scan_runs.capped_bands`.
- No listing-agent name/phone in the CSV; no APN. Sqft ~9% filled in Phoenix;
  sold dates absent for Nashville MF.

## One-time setup

```bash
cd workers/scan
npm install
cp .env.example .env && chmod 600 .env
# Fill in:
#   SUPABASE_URL              (same as the app's)
#   SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API → service_role)
```

The service-role key bypasses RLS. It lives in this `.env` and on the droplet
only. If it ever leaks, rotate it in the same dashboard page.

## Run

The bin scripts load `.env` themselves now, so sourcing it is optional.

```bash
set -a; source .env; set +a           # optional — scripts read .env directly
npm run scan -- --market phoenix   --status both      # active + sold(1yr)
npm run scan -- --market nashville --status both
npm run scan -- --market phoenix --status sold --days 730
npm run scan -- --market phoenix --status active --dry-run   # no DB writes
```

### Off-market parcels

```bash
node bin/parcelqueue.mjs --dry-run       # what it would attempt, no writes
node bin/parcelqueue.mjs                 # work 3 targeted counties
node bin/parcelqueue.mjs --limit 10
node bin/parcelqueue.mjs --county 47093  # force one
node bin/parcelqueue.mjs --retry-failed  # re-attempt past failures
```

Adding a county on the **Markets** page is the only action needed. This job
finds targeted counties with no parcels, tries every discovery route (county
REST directory → county ArcGIS portal → ArcGIS Hub → public ArcGIS search →
statewide), and records the outcome in `parcel_coverage`, which the Markets
page shows against each target.

Deliberately incremental — a few counties per night behind the same 1.5s
throttle as every other lane. Counties differ wildly in what they publish, so
**expect failures**: the recorded reason is what tells you whether to retry,
email the assessor for a bulk file, or buy that one county.

Nightly cron: `node bin/parcelqueue.mjs --limit 3`

### Rent data

```bash
node bin/rents.mjs                      # Zillow ZORI zip bands — monthly, free
node bin/hudfmr.mjs --dry-run           # HUD SAFMR bedroom shape — annual, free
node bin/hudfmr.mjs                     # …then import it
```

ZORI gives an accurate rent **level** per ZIP but blends all bedroom counts
together. HUD SAFMR gives an accurate bedroom **shape** but at policy levels,
not market. Storing both lets the app reshape the ZORI level to a unit's
bedroom count — neither source is used for the job it is bad at. `hudfmr`
needs a free `HUD_API_TOKEN` (see `.env.example`) and only needs re-running
when HUD publishes a new vintage (October 1).

Then refresh the app → **On-Market** shows the lead queue; each **Analyze**
click moves a lead into underwriting. Sold rows land in `comps`. Every run
writes a `scan_runs` health row (requests, rows, capped bands, blocked flag)
and a $0 `cost_ledger` entry.

**If it prints BLOCKED:** stop. Don't re-run in a loop. Wait an hour and try
once; if persistent we fall back to manual CSV download from redfin.com (same
parser) — ask in the build chat.

## Morning digest

```bash
node bin/digest.mjs                  # preview only: writes digest-preview.html
node bin/digest.mjs --transport ghl  # send via GoHighLevel (env above)
```

New leads created in the last 26h (one line each: photo, address, bucket,
price, agent when captured, link into the app) + scan-health footer.

## Off-market imports (Phase 2)

County assessor files → the `parcels` table → the app's **Off-Market** page
(filter → FreedomSoft CSV export). Run migration_006 in Supabase first.

### Zero-operator path (default)

`bin/parcels.mjs` discovers, downloads, and imports county data by itself:

- **maricopa** — the Assessor's free bulk downloads (launched 2026-03):
  scrapes the Data Downloads page for the *Apartment Master* file (duplex →
  apartment, REAL unit counts), backfills owner mailing addresses from the
  ownership bulk file when needed (APN join).
- **nashville** — Davidson Co runs its own CAMA outside the state system;
  its assessor data is on data.nashville.gov (Socrata). The catalog API
  picks the best assessor dataset at runtime; CSV is paged down in 50k rows.

```bash
node bin/parcels.mjs                    # both lanes
node bin/parcels.mjs --source maricopa
node bin/parcels.mjs --discover-only    # print what it found; no writes
```

The daily scan (`bin/scan.mjs`) runs this automatically whenever the
parcels table is empty, so a fresh install self-populates on the next
morning cron — no operator action. Disable with `MFDA_PARCELS_AUTO=0`.
Each lane writes a `scan_runs` row (`parcels-maricopa`, `parcels-nashville`)
so the outcome shows in the app header and the morning digest.

**Safety valve:** a lane that cannot confidently resolve APN + owner +
mailing-address columns imports NOTHING — it prints a full parse report
(headers, field mapping, samples). Paste that report into the build chat;
the mapping gets extended and the next run imports. Same iterate loop as
`--inspect` below. Requires `unzip` on the machine (droplets have it).

### Manual path (any county, any file)

Where the files come from (free public records, one-time manual download):

- **Maricopa, AZ** — [Maricopa County Open Data](https://data-maricopa.opendata.arcgis.com/)
  → search "parcels" → download the full parcel/assessor table as CSV. The
  PUC field drives the multifamily filter (03xx = MF residential).
- **Tennessee** — the Comptroller's [Real Estate Assessment Data](https://www.assessment.cot.tn.gov/RE_Assessment/)
  publishes per-county CAMA extracts; some counties (Davidson, Shelby) also
  post their own downloads. One file per county — pass `--county-fips`
  (Davidson 47037, Shelby 47157, Hamilton 47065, Knox 47093).

First contact with ANY new file — inspect before importing (writes nothing):

```bash
node bin/assessor.mjs --source maricopa --file ~/Downloads/parcels.csv --inspect
```

It prints the delimiter, headers, which logical fields resolved (APN, owner,
mailing address, units…), sample rows, and a multifamily-filter preview.
If fields show `✗ NOT FOUND`, paste the whole output into the build chat —
the column candidates get extended and you re-run. When the mapping looks
right:

```bash
node bin/assessor.mjs --source maricopa --file ~/Downloads/parcels.csv
node bin/assessor.mjs --source tn --file ~/Downloads/davidson.csv --county-fips 47037
node bin/assessor.mjs --source custom --file other.csv --state AR --county-fips 05007
```

Re-running is safe: parcels upsert on `apn:<fips>:<apn>`, so a fresh county
file updates in place. Assessor files change yearly at most — no cron needed.

## US market finder (Phase 3)

`bin/usmarkets.mjs` pulls national county-level data (~6 requests, ~3,000
rows) into `market_stats`: Zillow ZHVI/ZORI series snapshots, Census ACS
(population, tenure counts, tax/value medians), FEMA National Risk Index,
and Census Gazetteer centroids. RAW values only — every derived number
(yields, CAGRs, scores) is computed by `@alot/mf-calc` in the app, so the
arithmetic has one home. Run migration_007 first.

```bash
node bin/usmarkets.mjs           # no-ops if data is <90 days old
node bin/usmarkets.mjs --force
```

The morning phoenix scan runs this automatically (it self-skips when
fresh), then runs `bin/targets.mjs`, which scans any counties added from
the app's **Markets → Add to targets** button (scan polygon generated from
the county centroid + land area). Disable both with `MFDA_USMARKETS_AUTO=0`.

## Droplet cron (later)

```cron
# staggered per spec: one state per run
15 5 * * *  cd /opt/alot/alot-land/workers/scan && /usr/bin/node bin/scan.mjs --market phoenix   --status both >> /var/log/mfda-scan.log 2>&1
45 5 * * *  cd /opt/alot/alot-land/workers/scan && /usr/bin/node bin/scan.mjs --market nashville --status both >> /var/log/mfda-scan.log 2>&1
# photos trickle (5/run under Redfin's observed ~6-page window limit)
15 6-22/2 * * *  cd /opt/alot/alot-land/workers/scan && /usr/bin/node bin/photos.mjs >> /var/log/mfda-photos.log 2>&1
# morning digest at 7:00 local
0 7 * * *  cd /opt/alot/alot-land/workers/scan && /usr/bin/node bin/digest.mjs --transport ghl >> /var/log/mfda-digest.log 2>&1
# rent bands monthly
0 4 5 * *  cd /opt/alot/alot-land/workers/scan && /usr/bin/node bin/rents.mjs >> /var/log/mfda-rents.log 2>&1
```

Env for cron: put the same two variables in `/etc/environment` or a systemd
unit — not in the crontab line.

## Tests

```bash
npm test   # 78 tests: CSV quirks (PAST SALE trap, disclaimer row, non-MF
           # leakage), URL contract, band splitting, photo/agent extraction,
           # rents, digest, assessor parsing (delimiters, column mapping,
           # absentee/entity detection, MF filters)
```

Adding a market = one entry in `lib/markets.js` (closed polygon ring
"lng lat,..." — corners of a bounding box). No code changes.
