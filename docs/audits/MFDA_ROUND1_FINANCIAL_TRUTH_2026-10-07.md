# MFDA ROUND 1 — FINANCIAL / UNDERWRITING TRUTH

Branch `hardening/mfda-round1-financial-truth`; starting SHA
`ae5426a39e5a689a8eece17ae8f096edfd8924be`. Baseline re-run passed: `.netlify/`
was the only untracked directory. No commit/push/merge/deploy/hosted connection.

## 1. Branch and baseline gate

The gate was restarted after the user resolved the baseline exception. Before
any remediation: working directory `/Users/davidastone/code/alot-land/alot-land`;
origin fetch/push `https://github.com/alot-land/alot-land.git`; branch
`hardening/mfda-round1-financial-truth`; no tracked changes; only `.netlify/`
untracked. All seven requested commands were printed. `.netlify/` was not edited,
built into, or used as a database. No commit, push, merge, deployment, hosted
Supabase connection or production-data modification occurred.

## 2. Starting SHA

HEAD and merge-base with `hardening/mfda-p0-closure-v3` were both
`ae5426a39e5a689a8eece17ae8f096edfd8924be`. HEAD remains unchanged. Calculation
version changes from `1.14.0` to `1.15.0`; package and lock metadata agree.

## 3. Financial architecture

The following map was written before remediation.

| Boundary | Canonical source / observed starting behavior |
|---|---|
| Acquisition and initial equity | `property.totalCashInvested`; wrapper: price minus loan + price × closing rate + rehab + furnishing. No financing fees or initial-reserve funding. |
| Unit mix and income | `unitMix`: monthly per-unit rents × count, then ×12. Actual/market bases; loss-to-lease is informational, not deducted again. `finance.effectiveGrossIncome`: vacancy on rent only, fixed other income. No separate concessions/bad-debt inputs. |
| Expenses and NOI | `types.totalOperatingExpenses`, `finance.noi`; management annual dollars, estimates at 8% EGI; replacement reserve explicitly above NOI. Wrapper reassesses tax at price × assessment ratio × effective rate. |
| Debt and debt service | `finance` payment/balance/interest closed forms; `forward` and `buildProforma` duplicate constant annual debt service and exit payoff. IO boolean covers whole loan; seller balloon exists only in offer metadata. |
| Exit and returns | `financing.forward`, `proforma.buildProforma`: year N+1 NOI for exit pricing, selling costs then debt payoff; annual distributions; Newton/bisection `irr`; equity multiple nets operating deficits without increasing contributed-equity denominator. |
| Refinance | Goal planner `equityCapture` pays off original principal and estimates new service in `discountedEntryCashflows`; property projections have no refinance event. Goal strategies are heuristic simulations. |
| Tax | `tax.depreciation/taxYear/exitTax`; wrapper: price less land, scalar cost seg/bonus, full-year straight line, bonus tagged entirely 1245; rehab/basis timing absent. Taxes separate from pretax investment IRR. |
| Ratios | `finance` cap/DSCR/CoC/BEO; BEO divides by rent + other income, contrary to fixed-other-income EGI. No property debt-yield output. |
| Scenarios and sensitivity | Immutable `scenarios.inputs/outputs/calc_version`; stress uses copied shocked inputs. Latest scenario edit merges with mutable deal/units, then market/ZIP/expense defaults may intervene. Market context used in calculation is not stored with inputs. |
| Persistence | `DealNew`: deal save → unit delete/insert → scenario insert → advisory cost log. `OffMarketDeal`: deal then units. Partial failure/stale continuation can leave contradictory state. |
| Consumers | Results/Compare/PDF render persisted JSON; discovery uses `screenParcel`; goals consume snapshot CFBT and heuristic refi formulas. Current deal price can be shown with historical outputs. |
| Numerical conventions | USD numbers, decimal rates, annual income/expenses, monthly loan periods rounded; full precision internally, form seeding rounds dollars and reporting formats dollars/percentages. DSCR Infinity and IRR NaN serialize to null; `ratio(NaN)` prints infinity. |

The requested Round 0 path is absent at the starting SHA. The original report was
located and read at `/private/tmp/mfda-reaudit-original-round0.md`; its financial
findings P1-01/02/03/04/05/15 and adjacent snapshot/refi defects guide reproductions,
not implementation. Relevant P0 reports constrain authorization, tenant-scoped
reads/cache, stale completions, invitations, and rent proxy. Those controls are retained.

After remediation the canonical path is:

`property/units + operator assumptions → hydrate/validate → underwrite → mf-calc
monthly debt/proforma/equity ledger → finite snapshot → transactional RPC →
immutable scenario → Results / Compare / PDF / pipeline / goals`.

`debtSchedule` owns amortization, IO, maturity, early payoff and refinance;
`buildProforma` owns operating/exit/equity timing; `forward` consumes that ledger
instead of maintaining a different exit/return algorithm. The wrapper still
invokes the same proforma function for the investor panel; golden tests reconcile
it with forward outputs. Inverse solvers, DSCR valuation and STR now share the
annualized first-period debt basis. Refinance inverse solvers/DSCR ceiling are
withheld rather than applying a mismatched per-dollar loan approximation.

Other inspected calculation paths: discovery/list estimates (`screenParcel`,
`parcelDealInput`, `dealMonthlyNet`); rent references (`rents` and RentEstimator);
comps/valuation; market percentile ranking (`markets`); scoring/plausibility;
goal simulations (`goalScenarios`, `equityCapture`, `simulateGoal`). Market
ranking and estimated listing screens are not full property underwriting.
Pipeline/tracking/goals convert the saved first-period annualized CFBT to monthly
by dividing by 12. Goal projections remain heuristic, as detailed below.

Stored truth: new `scenarios.inputs` contains resolved defaults, selected unit
assumptions, market context and refinance sizing; `outputs` includes version,
monthly ledgers, conventions and unavailable-value metadata. Deal/unit rows are
mutable current facts. Historical display price/address use selected snapshot
inputs; older snapshots receive a version warning, not silent recalculation.
Frontend arithmetic is limited to aggregation/input preparation, percentage and
monthly display conversion, estimate seeding and scoring inputs. Expenses are
stored annual dollars, not recalculated management percentages on every rent edit.

## 4. Round 0 financial findings and verdicts

Each of the seven requested financial defects has exactly one verdict here.

| Requested finding | Original inventory | Verdict | Evidence / disposition |
|---|---|---|---|
| R0-1 Debt service after payoff | P1-02 | CLOSED | Monthly ledger, zero post-payoff service; independent amortization oracle. |
| R0-2 Seller balloon timing ignored | P1-02 | CLOSED | Payoff at contractual month; cash flows, coverage, debt totals and returns respond. |
| R0-3 Non-finite IRR becomes 1,000% | P1-04 | CLOSED | Nullable return plus explicit status; range/finite checks and display guards. |
| R0-4 Other-income break-even inconsistency | P1-15 | CLOSED | Fixed-income collections equation used across forward and stress/display. |
| R0-5 Incomplete tax basis/timing/class model | P1-03 | PARTIALLY CLOSED | Basis/timing/pool corrections and explicit simplified limits; no advanced-tax certification. |
| R0-6 Non-atomic deal/unit/scenario saves | P1-05 | CLOSED | Single invoker transaction, rollback/stale/concurrent failure tests. |
| R0-7 Assumptions/default mix replace known facts | P1-01, related P1-05 | CLOSED | Unknowns preserved, known counts reconciled, snapshots replayed without default contamination. |

These verdicts apply to the supported new calculation/save workflows. They do not
repair historical snapshots or certify externally sourced property/tax facts.

## 5. Pre-fix reproductions

Before source fixes, [pre-fix-regressions.txt](evidence/mfda-round1-20261007/pre-fix-regressions.txt)
records seven failing calc regressions, including six known/adjacent calculation
checks. [pre-fix-persistence.txt](evidence/mfda-round1-20261007/pre-fix-persistence.txt)
records the seventh known finding through the actual query adapter and local
authenticated SQL. [pre-fix-browser.txt](evidence/mfda-round1-20261007/pre-fix-browser.txt)
records the actual starting-SHA form loaded from an immutable Git extraction.

For reproducibility after edits, [baseline-financial.mjs](evidence/mfda-round1-20261007/baseline-financial.mjs)
extracts and executes unchanged starting-SHA calc/wrapper sources. Its observations
are retained in [immutable-starting-financial.json](evidence/mfda-round1-20261007/immutable-starting-financial.json).

| Case | Starting behavior | Financially required behavior |
|---|---|---|
| $12,000, 0%, 12-month loan; two-year hold | Year 2 principal/service $12,000 despite zero balance | Year 2 both zero. |
| Seller balloon 3 versus 9 years, ten-year hold | Both IRRs 0.5008340083809709 | Payoffs at different months and different equity flows/returns, or explicit invalid-root status. |
| IRR `[-100, NaN, 200]` | Numeric 10 (1,000%) | Unavailable/invalid, never a financial percentage. |
| $60,000 rent, $12,000 fixed other, $36,000 cost | Production forward BEO 50% | 40%; $24,000 rent + $12,000 other covers costs. |
| Add $100,000 rehab | Depreciable basis stays $400,000 | Basis includes capital improvement assumption. |
| Delete old units; injected insert failure | Prior 12-unit row lost; empty mix remains | Entire replacement rolls back. |
| Known 12 units, no rent roll | Form invents 4 units, 850 SF, $1,200 actual/$1,400 market | Preserve 12; rents/SF unknown; refuse incomplete underwriting. |
| Positive sale after half-year hold | Sale proceeds $200 but IRR NaN because no annual terminal row | Include month-6 sale in timed equity ledger. |

The initial low-level BEO regression passed a new fourth argument to the old
three-argument API and recorded 60%. The immutable production-wrapper reproduction
separately establishes the actual original 50% display defect above. The seller
regression was strengthened after remediation to test explicit multiple-sign IRR
unavailability; golden D separately proves numeric IRRs change when both ledgers
have conventional signs. No inspection-only closure is used.

## 6. Debt schedule findings/fixes

End-of-month regular payment precedes payoff/refinance. A fully amortizing loan
stops at zero balance; full-term IO repays principal at contractual maturity.
An explicit IO-month period precedes a full amortization period (amortization
years exclude IO months). Balloon or early payoff settles remaining principal
once and stops subsequent interest/principal. Balances are nonnegative; numerical
residuals below a sub-cent tolerance are normalized to zero.

Tests cover fully amortizing, zero/tiny interest, IO then amortization, fully IO,
balloons, early payoff, sale before maturity, maturity before sale, refi coincident
with maturity, six-month and forty-year holds, monthly sums and annual rows.
The independent oracle finds payment by binary-searching a simulated loan; it
does not call the implementation's payment formula. Dollar tolerances are
typically $0.000001–$0.0000001, tighter than displayed cents.

Coverage denominator includes contractual principal/payoff obligations during
the period, including refinance payoff; it is not an interest-only coverage
ratio or lender covenant certification. Replacement proceeds are shown separately.

## 7. Seller balloon findings/fixes

Seller terms now reach forward/proforma debt construction instead of remaining
offer-letter metadata. Golden D independently checks the month-36 payoff against
the oracle, zero month-37 service, and month-108 payoff for the alternative.
Debt totals, equity cash flows and equity multiples differ. Positive operating
cash flows large enough to cover both balloons yield different valid IRRs; each
passes an independent discounted-cash-flow residual check. When funding a balloon
causes additional sign changes, IRR is explicitly unavailable rather than selecting
an arbitrary root. The equity multiple still reflects additional contributions.

## 8. IRR findings/fixes

`timedIrr` returns `{value: number|null, status}`. It aggregates coincident flows,
requires an initial negative investment and conventional signs, and solves in
log(1+r) using scaled bisection. Timing is years; monthly flows produce an annual
effective IRR. Legacy `irr` remains a numeric primitive returning NaN internally;
application models use the nullable status result.

Policy: no sign change/all-positive/all-negative → unavailable; zero investment
→ unavailable; absolute investment below $1e-8 or relative investment below 1e-12
of the largest flow → near-zero unavailable; multiple sign changes →
`non_conventional` (conservative, including some uniquely rooted nonconventional
series); nonfinite values → `invalid_input`; root outside log-rate [-30,30] →
`out_of_range`; iteration exhaustion → `non_convergence`. Tests include the
two-root series [-100,230,-132], extreme scaled amounts, negative returns and
forced zero iterations. A genuinely valid finite 1,000% return is allowed; invalid
data can no longer fabricate it. Results/Compare use status/unavailability;
formatters and PDF use em dashes for unavailable values.

## 9. Break-even occupancy findings/fixes

Product definition is physical rent occupancy at which collections cover
recurring expenses and required debt payments:

`BEO = max(0, OpEx + debt service + concessions + bad debt − fixed other income) / GPR`.

Other income is fixed, not vacancy-dependent. OpEx includes replacement reserves.
Losses are explicit annual dollars, separate from vacancy. Do not apply the
assumed vacancy rate again: occupancy is the unknown being solved. Above 100%
means break-even is impossible at full occupancy. Zero GPR is unavailable.
Forward, stress, Results/Compare/PDF consume the same engine metric.

## 10. NOI, income and expense findings

`GPR = sum(count × selected monthly per-unit rent) × 12`.
`EGI = GPR × (1−vacancy) + fixed other income − concessions − bad debt`.
`NOI = EGI − recurring OpEx`.

Actual versus market basis is explicit. Loss-to-lease is the informational gap
between complete actual/market rent rolls; it is not deducted again. Missing
actual rents cannot become market rents or zero loss-to-lease. Taxes, insurance,
management, utilities, repairs, payroll, other recurring costs and replacement
reserve are above NOI. Debt, acquisition rehab, furnishings, financing costs,
sale/refi proceeds and investor income taxes are below/outside NOI.

Management is an explicit annual dollar assumption. Initial estimates use 8% of
EGI including other income and income losses, repairs 8% GPR, other per-unit
allowances; estimates are not verified contracts and are rounded only when
seeding editable dollar fields. Existing saved zero expenses are not overwritten.
Property-tax convention is price × assessment ratio × assumed effective rate;
it is not a jurisdiction-specific reassessment-law engine. Operator selection
of a market preserves valid zero rate/growth defaults.

## 11. Sources and uses findings

Initial equity equals price minus acquisition loan proceeds + acquisition closing
costs + upfront rehab + furnishings + financing fees + lender costs + initial
reserves − seller credits. Fees/lender costs are omitted for a zero-loan structure;
the inverse down solver likewise excludes them at all-cash. Financing results now
expose `cash_invested` so the denominator can be inspected. Golden B reconciles
$209,000 initial equity exactly across the equity ledger, CoC and proforma.

Closing percentage excludes separately entered financing costs; labels say so.
Initial reserves are assumed unspent and returned at exit; recurring replacement
reserve remains a separate annual expense. No reserve draw ledger or staged rehab
funding is implied. Excess credits producing negative initial equity are rejected;
zero/near-zero return denominators are unavailable, not fictitious zero returns.

## 12. Exit findings

Forward annual NOI at sale is year-1 NOI × (1+growth)^hold_years: integer N-year
holds use year N+1 annual NOI. Monthly operations apply annual growth steps;
partial final years are prorated. Exit value = max(0, forward NOI / exit cap).
Selling costs subtract once; the post-event month-end debt balance is paid once;
unspent initial reserves return once. Terminal equity flow includes that month's
operations plus sale proceeds. A negative NOI does not create a negative
hypothetical property price; debt liabilities can still make net proceeds negative.

Tests cover sale before maturity, after paid-off balloon, after refinance and
fractional holds. Taxes are displayed separately and excluded from net pretax
sale proceeds/IRR. Prepayment penalties, sale proration/closing dates and asset
transaction allocation are not modeled.

## 13. Refinance findings

One explicit refinance event is supported per property debt structure. New loan
amount can be specified directly or resolved from supplied valuation × LTV and
then stored. Current-month payment occurs first; actual remaining old balance
is paid, new proceeds/costs booked once, and replacement debt starts next month.
Negative net proceeds are cash-in, not suppressed. New loan balance governs exit.

Golden E checks $6,000 payoff, $9,000 proceeds, $300 fees and $5,200 month-6
equity flow on a zero-rate example. Coverage and annual reporting separate the
payoff from proceeds. Refinance must precede sale. Multiple refis, dynamic DSCR
loan sizing, floating rates and a dedicated refi form editor are outside scope;
the tested engine/save/replay accepts explicit stored terms. Inverse offers and
DSCR valuation ceiling are withheld for refi structures.

Goal refi now uses amortized original balance and the entire new-minus-old
payment delta, not original principal/service on incremental principal only.
It records cash-in, costs and post-refi equity. Goal planning remains a heuristic
monthly accumulation/acquisition model, not a full portfolio debt/exit schedule.

## 14. Tax-model findings

Retained scope is explicitly a simplified optional-to-use estimate, not tax
advice. Default cost segregation and bonus assumptions are now zero. Depreciable
basis includes purchase less land plus assumed capital improvements and explicitly
capitalized property acquisition costs. A user-selected service month controls
monthly straight-line exposure; remaining unbonused short-life basis also
depreciates. Building and short-life pools stop at their basis limits. All
upfront rehab is assumed ready at the same service month. Furnishings are excluded
from these tax pools and disclosed as a limitation.

Year-1 tax uses actual projection interest (including IO/refi/payoff) and partial
hold NOI/depreciation; replacement reserve is added back because reserve funding
is not treated as a deductible expense here. REP-on/off are assumption-based
illustrations, not eligibility determinations. Sale basis includes retained
improvements/capitalized costs minus capped accumulated depreciation. The assumed
1245 fraction is explicit; bonus elections do not silently establish asset class.
Exit assumed recapture/capital-gain rates are user inputs; loss tax benefits are
not invented. Tax timing is the first modeled period and terminal sale, separate
from pretax investment returns.

Independent tests cover land exclusion, rehab/capitalized basis, service month 7,
partial hold, bonus and remaining short-life pool, basis exhaustion, reserve
addback, sale gains/losses and assumed recapture slices. Unmodeled: MACRS/mid-month
conventions, actual asset sale allocation/recovery classes, bonus eligibility and
elections, later capex/service dates, passive-loss carryforward/release, tax filing
dates, NIIT, state-specific rules and short-versus-long-term gain eligibility.
Qualified tax review is still necessary. No comprehensive after-tax IRR is offered.

## 15. Numerical and rounding findings

USD numbers, not integer cents; decimal rates, not whole percentages; monthly
per-unit rents; annual dollar income/expenses; whole-month hold/loan events (up
to 1,200 months); growth uses decimal annual factors. Percent fields display
whole percents and store decimals. Internal schedules do not round payments
before aggregation. `expm1/log1p` avoid small-rate cancellation; zero-rate loans
use straight principal. Reporting uses dollar/percent formatting and half-away-
from-zero rounding with negative zero normalized.

Input validation rejects nonfinite amounts, impossible LTV/vacancy/rates, zero
exit cap, invalid timing, inconsistent known counts, negative expenses and invalid
STR/target/assessment assumptions. Discovery screens independently reject
nonfinite/invalid assumptions and withhold overflow results. Financial snapshot
serialization recursively maps any remaining nonfinite output to explicit null
with `unavailable_metrics` paths. Primitive Infinity/NaN conventions are internal,
not investor JSON/formatting. Zero debt DSCR/debt yield and zero equity return
ratios are unavailable. Golden tests assert finite JSON round trips and replay.

## 16. Scenario findings

Base/Upside/Downside-equivalent input copies reproduce identical outputs and
never mutate the base. All six stress cases use the same debt terms, losses and
fixed-other-income model; vacancy shocks cannot exceed 100%. Persisted snapshots
own their price/units/market context. Edit hydration does not automatically apply
a new market, rent estimate, replacement mix, expense estimate or STR suggestion
over saved assumptions. Valid saved zeros survive. An intentional market/rent
reference action remains an operator change.

New snapshots persist resolved defaults/context, not the sparse pre-default form.
The real browser saves and replays JSON inputs through production underwrite and
asserts exact output equality. Historical v1.14 snapshots lack this guarantee;
they are immutable and visibly historical, not automatically migrated or replayed
through an unimplemented historical engine dispatcher.

## 17. Persistence and atomicity findings

Migration 016 implements the smallest transaction boundary for the affected
workflows: `save_mfda_underwriting` updates/inserts deal, replaces units and inserts
optional immutable scenario in one PostgreSQL invocation. `replace_mfda_units`
also becomes atomic. Both are SECURITY INVOKER with pinned search path, membership
and same-tenant locked parent checks; authenticated-only execution; existing RLS
and P0 parent/author controls remain effective. Author is derived from auth.uid.

Payload price, units, calc version and resolved input/output snapshot must agree.
An expected latest-scenario id prevents stale edit overwrites; parent locking
serializes simultaneous saves, with exactly one allowed for the same revision.
Unit, scenario and new-deal failure injection leaves previous rows unchanged/no
orphans. DealNew computes valid outputs before any write; no independent advisory
cost write follows. Off-market promotion also saves deal/mix atomically.

Scope limitation: authenticated direct table writers/legacy exported helpers
still exist under existing RLS; this is not a redesign that revokes all table
writes or recomputes trusted mathematics server-side. Transaction payload checks
do not prove that an authorized client computed every output correctly. Migration
has been applied only to disposable test databases, never a hosted environment.

## 18. Unit-mix integrity findings

Trace: imported property count/unit rows → snapshot-aware hydration → nullable
form fields → validated selected rent basis → transactional unit persistence →
resolved snapshot → calculation. Known 12-unit facts no longer become four units.
Unknown SF/actual/market rents stay null/blank through persistence; summary says
Unknown, not $0. With unknown selected rents, save/analysis stops before writing.
If only market rent is assumed, actual GPR/loss-to-lease/SF metrics stay unknown.

Manual new mix entries are labeled operator assumptions; property-count-only
rows identify unknown mix/rents; off-market estimates identify their assumed
market rent and unknown actual rent. Row provenance is retained/displayed.
Intentional count differences require a reason stored in the resolved snapshot.
Imported legacy numbers cannot be retroactively proven sourced; no bulk rewrite
of property data was performed.

## 19. Golden fixtures

[round1-golden.test.ts](../../packages/mf-calc/test/round1-golden.test.ts) contains
54 checks; [round1-regressions.test.ts](../../packages/mf-calc/test/round1-regressions.test.ts)
contains seven. Fixtures use literal arithmetic, a separately simulated loan
oracle and independent discounted cash-flow residuals, not snapshots copied from
implementation outputs.

| Fixture | Independent key expectations |
|---|---|
| A Stabilized | GPR $60,000, EGI $66,000, NOI $42,000, cap/CoC 14%, BEO 20%, sale $420,000 less $21,000 cost; EM $483,000/$300,000. |
| B Value-add | $209,000 equity; $280,000 depreciable basis; $5,000 debt service; 8.4 DSCR; 28% debt yield; $5,000 reserve return. |
| C IO | $100,000 at 6%: $6,000 annual interest, zero principal, $100,000 exit payoff. |
| D Seller balloon | Month 36 vs 108 payoffs, no service after payoff, independent balance and IRR residuals, differing EM/IRR. |
| E Refinance | $6,000 old payoff + $9,000 new loan − $300 cost; $5,200 month-6 equity CF; no overlapping debt. |
| F Early sale | Six principal payments leave $6,000 payoff; $393,000 net sale; positive fractional exit participates in IRR. |
| G High other income | $60,000 GPR + $12,000 fixed income, $36,000 costs → 40% occupancy. |
| H No IRR | Negative NOI/no positive flow → no-sign unavailable, no invented negative sale price. |
| I Zero denominator | Zero/$1e-10 initial equity → unavailable IRR and return denominators. |
| J Incomplete units | Known 12, unknown rents/SF; incomplete save rejected; assumed market rents do not establish actual rents. |

Additional checks reconcile NOI, cap, CoC, DSCR, debt yield, BEO, EM, IRR, exit
payoff/proceeds, sources/uses, inverse solver coverage, STR debt, tax limits and
goal refi. EM convention: positive equity cash returned divided by initial equity
plus subsequent negative equity cash contributions. CoC uses first-period
annualized CFBT / initial equity; partial annual report rows themselves show
actual period distributions. Appreciation and acquisition rehab are assumptions,
not independently verified property performance.

## 20. Validation matrix

Final commands/logs are generated by [capture.mjs](evidence/mfda-round1-20261007/capture.mjs)
with provider/database environment variables removed. Tests use synthetic local
fixtures and the accepted disposable PostgreSQL/browser harness. No external
browser/provider requests are permitted; no environment files are loaded.

| Validation | Reported passes | Leaf checks | Result |
|---|---:|---:|---|
| Complete calc, 19 files | 305 | 305 | PASS |
| Of calc: Round 1 financial, 2 files | 61 | 61 | PASS (subset, not added twice) |
| Round 1 SQL/browser/query integrity, 3 files | 19 | 17 | PASS |
| Configured P0/security, 8 files | 142 | 134 | PASS |
| Accepted reviewer regressions, 2 files | 22 | 19 | PASS |
| Scanner, 12 files | 186 | 186 | PASS |
| Production Vite build and server-secret canary scan | — | — | PASS |
| Calc configured typecheck | — | — | PASS; zero diagnostics |

Aggregate: **674 reported passes / 661 leaf checks**, zero failures, skips or
cancellations. New Round 1 tests: **80 reported / 78 leaf**. Security regression
total: **164 reported / 153 leaf**. Parent test containers are not leaf checks;
repeated runs/subsets are not double counted. The user's accepted 615/602 local
Supabase run remains the supplied starting acceptance; these are fresh repository
suite totals, not a claim to rerun its separate external acceptance program.

Evidence: `final-calc.txt`, `final-financial.txt`, `final-security.txt`,
`final-independent.txt`, `final-scanner.txt`, `final-typecheck.txt`, `final-build.txt`
and `final-results.json` in `evidence/mfda-round1-20261007/`. Original expected
pre-fix failures remain separate. The initial security/reviewer attempt logs are
also retained; they are not the final acceptance results.

## 21. Typecheck state

All 35 original diagnostics were test-only strict-null/index access issues:

| File | Count | Classification and treatment |
|---|---:|---|
| comps.test.ts | 2 | Version split possibly undefined; numeric fallback. |
| goals.test.ts | 3 | Nullable achievement month/strategy; explicit successful-fixture guards. |
| offmarket.test.ts | 1 | Nullable DSCR passed as numeric argument; valid-fixture assertion. |
| plausibility.test.ts | 2 | Possibly missing first flag; assert presence before access. |
| proforma.test.ts | 2 | Version split possibly undefined; numeric fallback. |
| str.test.ts | 25 | Nullable optional STR comparison; explicit valid-fixture assertions/guards. |

None was a production arithmetic diagnostic, but leaving them broken obscured
future financial type regressions. The pre-fix transcript includes two additional
temporary signature diagnostics in new BEO tests against the old API; these are
not counted among the 35. The exact original 35 are retained in the accepted
[baseline typecheck transcript](evidence/mfda-p0-v3-20261007/baseline-typecheck.txt).
All are eliminated with unchanged compiler strictness; no excluded tests or
skipped diagnostics. Materially modified engine files typecheck. No debt remains.

## 22. Security regression results

All 142 configured tests and 22 accepted reviewer diagnostics pass. Tenant
isolation, invitation authorization/lifecycle, stale completions, PDF/CSV output
guards and rent proxy/continuation authorization remain intact. New RPC tests
also deny anon, tenant B and mixed-org parent requests, with valid-auth positives.

Only security fixture changes: rent-browser synthetic A explicitly supplies AZ;
synthetic B supplies the known four-unit 2BR row required for the rent action.
These formerly depended on removed invented defaults; all assertions remain.
The copied reviewer stale-save probe now intercepts a nested atomic RPC URL and
executes real local SQL instead of the obsolete deal PATCH. It still requires
exactly one authorized initiating write and no stale navigation or follow-ons.
Its bounded barrier reports failures promptly; other assertions and CSV test
source are preserved. This is reuse of accepted diagnostics, not an independent
new security review. No P0 authorization/guard/proxy implementation was changed.

## 23. Remaining limitations

Adjacent defects addressed beyond the seven-item inventory: fractional holds
omitted terminal IRR flows; additional equity contributions were excluded from
the multiple denominator; goal refi used original rather than amortized payoff
and incremental-principal rather than full payment delta; invoice/fee denominators
could disagree at zero debt; IO/event debt diverged across inverse/DSCR/STR paths;
management estimation ignored other income/losses; snapshot price and market
context could drift; reserves were treated as immediately tax-deductible; nested
STR eligibility/closed-permit inputs were not consistently wired. The strengthened
golden and browser tests cover these secondary cases. Discovery nonfinite input
and zero-debt coverage are also explicitly guarded.

- Simplified tax estimates are not advanced tax calculations or advice; obtain
  qualified tax review before reliance on tax benefits/exit estimates.
- Historical snapshots can retain earlier defects. Re-underwrite relevant deals
  with v1.15 before investment decisions; no production snapshots were modified.
- One upfront rehab assumption, one explicit refinance, fixed annual growth,
  unspent initial reserves and fixed other income are modeling conventions, not
  construction/lease-up/reserve-draw forecasts. No floating rates or prepayment
  penalties. Confirm lender-specific coverage definitions.
- Conservative IRR policy withholds nonconventional series even if they happen
  to have one root. Financial outputs may legitimately be unavailable.
- Goal projections and discovery/market ranking remain clearly distinct heuristic
  or estimate paths, not portfolio underwriting schedules or investment advice.
- Authorized-client math is not independently recomputed by the database. The
  transactional boundary secures the actual app save workflows, not arbitrary
  direct-table authoring by an authorized tenant user.
- Hosted migration application and hosted Supabase acceptance are not performed.
  They remain mandatory pre-launch gates; local P0 acceptance is not reopened.
- Build retains the existing large-chunk advisory; it is not a build failure.

## 24. Deferred Round 2 data quality

Import/acquisition completeness, accurate unit ranges/mixes, rent-roll evidence,
source timestamps/confidence, property matching, property photos/licensing,
assessment jurisdiction verification, parcel acquisition retry/health and broader
coverage work remain Round 2. Listing bucket estimates are disclosed screening
assumptions; they are not promoted into authoritative rent-roll facts. Existing
invented/legacy rows require operator/source reconciliation, not automatic guessing.

## 25. Exact next action

Review this uncommitted Round 1 diff and evidence, especially migration 016 and
the simplified-tax limitations. Then authorize a separate Round 2 data-quality
round if desired. Do not launch commercially/publicly until the separate hosted
Supabase acceptance and migration/re-underwriting rollout have been explicitly
authorized and passed. Stop here: no commit, push, merge, deployment or hosted
connection is authorized in this round.

### Changed-file inventory

Engine/config: `packages/mf-calc/src/{debt,finance,financing,goals,index,offmarket,
proforma,property,str,stress,tax,types,valuation}`; package/lock version;
vitest alias. Tests: existing comps/financing/goals/offmarket/plausibility/proforma/
referenceDeals/str tests, new round1-regressions and round1-golden.

MFDA: `src/lib/{underwriting-inputs,underwrite,queries,format,parcelscreen}`;
`src/components/{UnitMixEditor,results}`; `src/pages/{DealNew,DealResults,Compare,
OffMarketDeal}`; `src/pdf/ReportDocument`; nullable/atomic migration 016;
three `financial/*.test.mjs`; rent-browser fixture only. Documentation: this
report plus the Round 1 evidence directory (generators, copied reviewer probes,
immutable baseline observations, pre-fix/final logs and result manifest).

Final Git status remains an uncommitted Round 1 worktree. `.netlify/` is the
pre-existing untracked directory; all other new paths belong to this round.
`git diff --check` passes. Standard `git diff --stat` excludes untracked additions;
the final response reports that exact tracked statistic separately from new files.

Raw final status and tracked diff-stat output are preserved in
[git-status-and-diff-stat.txt](evidence/mfda-round1-20261007/git-status-and-diff-stat.txt).
Tracked statistic: **35 files changed, 567 insertions, 418 deletions**. New source,
tests, migration, report and evidence are untracked and therefore excluded from
that standard Git statistic. No tracked user changes predated this round.
