# @alot/mf-calc

The MFDA multifamily underwriting **calc engine**. Pure TypeScript financial
math — the *only* place arithmetic is allowed to live in the product.

> **Engineering Rule #1 — LLMs never do arithmetic.** LLMs populate inputs and
> write narrative text. Every financial calculation is a pure function here.

> **Engineering Rule #2 — this module is Vitest-locked.** Once the suite is
> green the module is **frozen**. Changing any formula requires (a) a new test
> first and (b) a `CALC_VERSION` bump. Scenario snapshots record the version
> they were computed under so historical results stay reproducible.

## Status

- **CALC_VERSION `1.12.0`** (see `src/types.ts` — always the source of truth)
- **217 tests** across 15 suites, including **two fully hand-verified
  reference deals** (`test/referenceDeals.test.ts`).
- Version history: 1.1 comps/$-per-bed · 1.2 proforma · 1.3 US market scoring ·
  1.4 off-market parcel screening · 1.5–1.8 goal planner (snowball sim, goal
  progress, equity capture, discounted-entry cash flows) · 1.9–1.11 LTR-vs-STR
  (ADR suggestion, cleaning pass-through) · 1.12 audit round: §1245 vs §1250
  recapture split at exit, refi-month clamp in the goal sim, $700/unit
  insurance default, 1.2 screen DSCR aligned with the solver.

```bash
cd packages/mf-calc
npm install
npm test        # vitest run
npm run typecheck
```

## What it computes

| Area | Functions | File |
|------|-----------|------|
| Primitives | mortgage payment (+0% edge), amort balance, interest split, NOI/EGI, cap rate, DSCR, CoC, GRM, break-even occupancy, NPV, IRR (Newton + bisection), equity multiple | `finance.ts` |
| Unit mix | Σ(units × per-unit rent) roll-up, actual vs market basis, loss-to-lease | `unitMix.ts` |
| Property | **property tax re-assessed at purchase price** (never seller's), cash-invested | `property.ts` |
| Valuation | sales comps ($/unit, $/sqft), GRM, direct cap, DSCR-constrained max price, replacement cost — side-by-side panel with a **>15% divergence flag** | `valuation.ts` |
| Financing | forward (CoC/DSCR/CFBT/IRR/EM/break-even), **Inverse A** (min down for DSCR≥1.20 & CoC target), **Inverse B** (max offer for target returns), seller-finance 3-option offer | `financing.ts` |
| Tax | cost-seg + 100% bonus (OBBBA), **REP-on vs REP-off both ways**, STR material-participation gate, depreciation recapture + LTCG at exit | `tax.ts` |
| Stress | rents −10%, vacancy +5pp, rate +150bps, insurance +30%, combined worst case | `stress.ts` |
| Prescreen | zoning, metering, septic/well, roof/HVAC age, rent-control, pre-1978 lead, pre-1980 asbestos, STR permit status | `prescreen.ts` |
| Scoring | composite 0–100 vs a configurable buy-box (cash flow / appreciation / cost-seg / bottom line) → `pursue` flag | `scoring.ts` |
| Comps | haversine radius filter, $/bed + $/sqft medians with sample sizes | `comps.ts` |
| Proforma | year-by-year investor proforma reconciling exactly with `forward()` | `proforma.ts` |
| US markets | county metrics (yield, CAGRs, tax, risk), percentile scoring under weight profiles, scan-polygon bbox | `markets.ts` |
| Off-market | standard-rate expense estimate, fast parcel screen (pursue/consider/pass/insufficient) | `offmarket.ts` |
| Goals | month-by-month snowball simulation, four strategy scenarios (incl. equity capture w/ refi cash-back + honest debt-service delta), goal progress from assigned deals, equity spread/capture | `goals.ts` |
| STR | LTR-vs-STR comparison (ADR × occupancy revenue, guest-paid cleaning pass-through, STR-grade management), rent-derived ADR suggestion | `str.ts` |

## Conventions baked in

- **Vacancy** is applied to gross potential rent only; other income is not
  vacancy-adjusted.
- **Capex reserve** is treated as an above-the-line operating expense (reduces
  NOI) — the conservative choice that keeps DSCR honest.
- **Property tax** is always re-assessed at the purchase price
  (`reassessedPropertyTax`), never the seller's in-place assessed value.
- **RentCast MF estimates are per-unit** — always model the unit mix
  (`annualGrossPotentialRent(mix, basis)`), never a single blended rent.
- Every **tax output is an estimate** — the report layer must print
  "estimate — verify with CPA".

## Provenance

Rule #3: no naked numbers. The app stores every model input as
`Provenanced<T>` (`{value, source, retrieved_at, confidence, is_override}`) and
renders the provenance table on reports. The calc engine operates on plain
numbers; the data layer unwraps `.value` before calling in and keeps the
provenance for display. Use `pv(value, source, opts)` to construct one.

## Reference deals (hand-verified)

1. **Maple Fourplex** — $500k, 4×$1,500. NOI $48,800, cap 9.76%. Agency (25%
   down, 7%/30yr): DSCR 1.630, CoC 13.97%. All-cash CoC 9.57%. Comps primary.
2. **Cedar 10-Plex** — $1.0M, value-add, 14.5% loss-to-lease. Stabilized NOI
   $79,760 (in-place $61,904). DSCR loan (75% @ 7.5%/30yr): DSCR 1.267. 5-yr
   exit @ 8% cap with 3% NOI growth → exit value ≈ $1.156M. Cost-seg year-1
   depreciation $260,364; REP-on offsets active income, REP-off suspended.

Every figure above is derived by hand in the test comments and asserted against
the engine. Break one → a formula moved → bump `CALC_VERSION`.
