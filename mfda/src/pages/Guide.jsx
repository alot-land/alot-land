import { useMemo, useState } from 'react';

/**
 * The MFDA manual — searchable, in-app. Content lives in a plain data
 * structure so the search box can filter entries live. No jargon left
 * undefined; written for someone opening the app for the first time.
 */
const MANUAL = [
  {
    section: 'Getting around',
    entries: [
      {
        t: 'What MFDA does',
        b: 'MFDA is the whole acquisition loop for 2–20 unit multifamily: rank every US county to pick markets (Markets), scan listings daily with photos and agents captured automatically (On-Market), surface owners before they list with real county data (Off-Market), underwrite any property in minutes — worth, four financing structures, taxes, max allowable offer — and tie every deal to a cash-flow goal with a computed timeline (Goals). Every analysis is saved forever and prints as a branded PDF report. The stack costs $0/month.',
      },
      {
        t: 'The tabs, left to right',
        b: 'MARKETS ranks ~3,000 US counties and adds pockets you like to the scan targets. ON-MARKET is the incoming listing queue (list or map). OFF-MARKET is county assessor parcels — owners, mailing addresses, equity — for direct outreach. DEALS is your working pipeline (plus "+ New deal" to enter any property by hand). GOALS holds your cash-flow targets and strategy timelines. GUIDE is this manual. SETTINGS has your organization, teammate invites, and market presets — the top bar also shows your org (with a switcher if you belong to several), your admin badge, and the dark/light toggle.',
      },
      {
        t: 'The daily rhythm',
        b: 'Every morning around 5am the system scans Redfin for new listings and sold comps, then trickles in photos and agent contacts through the day. At 7am you get an email digest of anything new. Your job starts there: open a property that looks interesting, hit Analyze, fill in rents, and read the verdict.',
      },
      {
        t: 'Where the data comes from',
        b: 'Listings and sold comps: Redfin, scanned daily. Market rents: Zillow ZORI per ZIP, refreshed monthly. Photos and listing agents: each listing\'s page. Off-market parcels: county assessor records (owner names, mailing addresses, REAL unit counts, appraised values, sale history), auto-imported and refreshed ~monthly. National market rankings: Zillow ZHVI/ZORI + Census ACS + FEMA risk + Census Gazetteer, refreshed ~quarterly. Operating expenses pre-fill with dollar estimates from the unit mix; rents you confirm per unit, guided by the reference cards. All of it costs $0/month.',
      },
    ],
  },
  {
    section: 'On-Market queue',
    entries: [
      {
        t: 'Searching, filtering, sorting',
        b: 'Search filters by address, city, ZIP, or MLS number as you type. Dropdowns filter by state, unit bucket (2–4 or 5+), rating (♥/👍/👎/unrated), and screen verdict (Pursue/Consider/Pass/needs data); a number box caps max price. Sorts: newest scan, best screen first, most equity first, price up/down, days on market, year built. The queue loads the newest 500 leads.',
      },
      {
        t: 'List vs Map',
        b: 'The List/Map toggle shows the same filtered properties either way. Map pins: green = active, gold = pending, blue = coming soon, grey = unknown — a legend sits on the map itself. Click a pin for a card with the photo, price, unit bucket, year built, total beds, a Redfin link, and an Analyze button.',
      },
      {
        t: 'What "2–4" and "5+" mean (and why not exact unit counts)',
        b: 'Redfin only publishes two multifamily size buckets — it never says exactly how many units. A "5+" building could be 5 units or 50. For real unit counts, check the Off-Market page (county assessor data carries them) or the listing itself via the Redfin link; you\'ll enter the real unit mix on the Analyze form.',
      },
      {
        t: '"Beds" is the building total',
        b: 'The Beds column is total bedrooms across the whole building, not per unit. An 8 might be four 2-bedroom units. It\'s useful for $/bed comparisons, not as a unit count.',
      },
      {
        t: 'The Screen column — every listing pre-scored',
        b: 'Each listing runs through the deal engine at its asking price: rent from the Zillow zip band, standard expenses, DSCR and cap-rate bars. Pursue/Consider/Pass tells you what to open first; hover the pill for the estimated NOI. Honest caveat: 2–4 unit listings screen with a 3-unit assumption (Redfin never states exact counts) and 5+ shows "needs data" until you underwrite with real units. Sort by "Best screen first" to work the top.',
      },
      {
        t: 'Rating listings: ♥ 👍 👎',
        b: 'Same three ratings as off-market leads, on every listing row: heart = strong, thumbs up = potential, thumbs down = pass for a reason. Click again to clear; filter by rating with the dropdown; shared across your org.',
      },
      {
        t: 'The Analyze button',
        b: 'Analyze moves the property from the queue into your Deals pipeline and opens the underwriting form, pre-filled with everything scraped: address, price, year built, coordinates (which power the auto-comps), and the market preset for its state.',
      },
      {
        t: 'The scan-health line',
        b: 'Top right of the queue shows the last scan: when it ran, how many actives and solds it found, and warnings like BLOCKED (Redfin refused — it retries next cycle) or "capped bands" (some listings may be missing — coverage was partial that run).',
      },
    ],
  },
  {
    section: 'Analyzing a deal — the form',
    entries: [
      {
        t: 'The live preview (top right)',
        b: 'NOI · DSCR · Score update as you type, so you can feel the deal move as you change assumptions. Ignore the score until you\'ve entered the real unit mix and rents — the form starts with placeholder units that mean nothing for the property in front of you.',
      },
      {
        t: 'Unit mix — the most important input',
        b: 'List each unit TYPE as a row: "2BR/1BA", how many of them, square feet, and two rents — ACTUAL (what the seller collects today, from the listing or rent roll) and MARKET (what it should rent for, guided by the rent-reference card). Get the mix from the Redfin listing or by asking the agent. Total income is computed per-unit × count — never enter one blended rent.',
      },
      {
        t: 'Market rent reference card',
        b: 'Shows the ZIP\'s Zillow rent index with its source, month, and confidence level. It blends all unit sizes, so treat it as an anchor: 1-bedrooms sit below it, 3-bedrooms above. Your entered rents are what actually get underwritten.',
      },
      {
        t: 'Actual vs market basis',
        b: '"Underwrite on" picks which rent column drives the analysis. Conservative discipline: the deal should pencil on ACTUAL rents — market-rent upside is why you negotiate, not why you overpay.',
      },
      {
        t: 'Why property tax is different here',
        b: 'MFDA re-computes property tax at YOUR purchase price using the county\'s rate and assessment ratio. The seller\'s current tax bill reflects their old assessed value — buying triggers reassessment, and copying the seller\'s number understates your biggest expense.',
      },
      {
        t: 'Tax rate vs assessment ratio — the trap',
        b: 'The engine charges rate × ratio × price. So the pair has to be consistent: either a MILLAGE rate with the county\'s statutory ratio (Nashville $3.05 per $100 with ratio 0.25), or an EFFECTIVE rate on full value with ratio 1 (0.75% with ratio 1). Mixing them — an effective rate AND a statutory ratio — quietly divides your tax bill by four or ten. Settings now shows a "Tax on price" column with the number the pro forma actually charges, and flags anything under 0.3% as suspicious. The starter AZ and TN presets shipped with exactly that mistake and are corrected by migration 012.',
      },
      {
        t: 'Auto-comps ("Sold comps")',
        b: 'Inside Valuation comps: sold multifamily comps from the scanned store — filtered by radius when the deal has coordinates (scraped listings do), falling back to STATEWIDE comps when it doesn\'t (off-market promotions and hand-entered deals), honestly labeled as the rougher guide. Median price, $/bed, and $/sqft show with sample sizes (n=); values with 3+ comps AUTO-FILL the empty valuation inputs on load and stay fully editable. Expand "Show nearest/recent" for the individual comps with Redfin links.',
      },
      {
        t: 'Operating expenses fill themselves — in dollars',
        b: 'Insurance, management, utilities, repairs, and capex reserve pre-fill with ANNUAL DOLLAR estimates computed from your unit count and rents (~$700/unit insurance, ~10% of income management, ~$300/unit utilities and reserves, ~8% of rent repairs). Replace any with real quotes — auto-fill never overwrites something you\'ve entered or saved. Only two fields on the whole form take percentages: property tax rate and vacancy. Everything else is dollars.',
      },
      {
        t: 'Every field has a tooltip',
        b: 'Hover (or tap) the small ⓘ next to any label for a plain-English explanation of what it is, what a typical value looks like, and why it matters.',
      },
      {
        t: 'Underwrite = save a version',
        b: 'Clicking "Underwrite deal" computes everything and saves an immutable snapshot. Re-running after changes creates a NEW version — the old one is never overwritten, so you can always compare and never lose an analysis.',
      },
    ],
  },
  {
    section: 'Reading the results',
    entries: [
      {
        t: 'Verdict bar',
        b: 'The one-glance summary: composite score (0–100) vs your buy-box, PURSUE flag if it clears 70, and the headline numbers — NOI, cap rate on your price, DSCR, cash-on-cash, and the solver\'s Max Offer in green.',
      },
      {
        t: 'Valuation panel',
        b: 'Up to seven independent estimates of worth: sales comps ($/unit, $/sqft, $/bed), GRM, direct cap (primary for 5+ units), the DSCR-constrained max (what a lender\'s coverage floor supports), and replacement cost (a ceiling). The "primary" tag marks the method that matters most for the building\'s size class. If the spread exceeds 15%, the panel tells you the likely reason.',
      },
      {
        t: 'Key terms in 20 seconds',
        b: 'NOI = income minus operating expenses, before the mortgage. Cap rate = NOI ÷ price (yield if bought cash). DSCR = NOI ÷ mortgage payments; 1.20+ means 20% cushion and is the standard lender floor. Cash-on-cash = year-1 cash flow ÷ cash invested. IRR = annualized return including sale. Equity multiple = total cash back ÷ cash in.',
      },
      {
        t: 'Financing comparison',
        b: 'The same building financed four ways: all-cash (the unlevered truth), DSCR loan (qualifies on the property\'s income), agency/conventional (2–4 units, qualifies on yours, usually cheapest), and seller finance. The 3-option seller-finance letter (full price/low rate · mid · cash discount) is your opener when the seller owns free and clear.',
      },
      {
        t: 'Investor proforma',
        b: 'The year-by-year table: income, expenses, NOI, mortgage split into interest vs principal paydown, cash flow, cumulative totals, and the exit waterfall (sale price − selling costs − loan payoff = net proceeds). It uses the same growth engine as the IRR, so the numbers never contradict each other. This is the page to show a lender or partner.',
      },
      {
        t: 'Solvers',
        b: 'Minimum down: the least cash that satisfies both your DSCR floor and CoC target. Max allowable offer: the highest price that still hits your targets — your negotiation ceiling. If either says "unreachable," the deal doesn\'t work at any price/structure in range.',
      },
      {
        t: 'Stress test',
        b: 'Rents −10%, vacancy +5 points, rate +1.5%, insurance +30% — each alone, then all combined. DSCR below 1.0 in a row means the building can\'t cover its own mortgage in that scenario. The combined row is the deal\'s true durability test.',
      },
      {
        t: 'Tax layer (and REP)',
        b: 'Cost segregation reclassifies ~30% of the building into short-life property eligible for 100% bonus depreciation — a large year-1 paper loss. REP = Real Estate Professional status (an IRS designation, ~750 hrs/yr in real estate): with it, that loss offsets your ACTIVE income; without it, the loss is suspended for later. Both are always shown. Exit tax models depreciation recapture at 25% plus capital gains. All of it is an estimate — verify with your CPA.',
      },
      {
        t: 'Prescreen flags',
        b: 'KILLER (red) = walk or verify hard — e.g. legal non-conforming zoning. CAUTION (gold) = budget for it — old roof/HVAC, master meters, septic. INFO (blue) includes pre-1980 asbestos, flagged prominently because remediation capability turns it into a discount opportunity.',
      },
      {
        t: 'Listing agent line',
        b: 'When captured, "Listed by [name] · [brokerage] · [phone]" appears under the address with a tap-to-call link, marked DNC-exempt (listing agents on active listings want buyer calls — no do-not-call concerns). It prints on the PDF too.',
      },
      {
        t: 'Provenance table',
        b: 'Every assumption with its source and a confidence level. When a deal looks too good, challenge the low-confidence rows first — outputs are only as good as these inputs.',
      },
    ],
  },
  {
    section: 'Pipeline: stages, goals, under contract',
    entries: [
      {
        t: 'Deal stages',
        b: 'Every deal\'s results page has a stage bar — analyzing · pursue · under contract · passed · closed — and any stage is one click away. The Deals page shows the stage on every row, so the pipeline reads at a glance.',
      },
      {
        t: 'Under contract',
        b: 'Click "under contract" on the stage bar and fields appear for the ACTUAL terms: contract price, contract date, expected close. Your underwritten scenarios stay frozen for comparison against what you really negotiated — that gap is your negotiation scorecard.',
      },
      {
        t: 'Committing a deal to a goal',
        b: 'The tracking card always shows the deal\'s underwritten monthly cash flow first (≈ $X/mo) — no typing needed. "Part of goal" assigns the deal to one of your active goals; enter "Want from this deal / mo" and the line switches to ✓ Makes it / ✗ Falls short with the exact gap.',
      },
      {
        t: 'Goal progress from real deals',
        b: 'The Goals page shows a progress bar per active goal: committed monthly cash flow from every assigned deal (underwritten numbers), what remains, and roughly how many more deals like yours it takes. Deals marked under contract or closed are labeled in the list.',
      },
    ],
  },
  {
    section: 'LTR vs STR',
    entries: [
      {
        t: 'Comparing long-term vs short-term returns',
        b: 'It\'s automatic: the ADR (average nightly rate) auto-seeds from the deal\'s market rent — roughly rent ÷ 12, since a short-term night grosses about 2.5× the long-term nightly equivalent — at a conservative 60% occupancy. So the "LTR vs STR" panel appears on the results page by default: the same building on the same loan, gross income, expenses, NOI, cash flow, cash-on-cash, and DSCR side by side, with a pill declaring the winner in $/yr. That\'s a glance-level estimate to tell you whether STR is worth a closer look; once a deal interests you, refine the ADR from AirDNA or nearby Airbnb comps and everything recomputes.',
      },
      {
        t: 'Why STR grosses more but keeps less',
        b: 'STR revenue = occupied nights × ADR, usually well above rent — but management runs 20–25% of revenue vs 8–10% for LTR, plus platform fees (~3%). Turn cleaning is modeled as a GUEST PASS-THROUGH by default: the cleaning fee you charge per stay offsets what the cleaner charges you, netting to $0 owner expense — lower the fee below your cost on the deal form only if you deliberately absorb part of it. The panel shows nights and turns per year so you can feel the operational load either way.',
      },
      {
        t: 'Permits and the STR tax lane',
        b: 'The panel warns when the market\'s STR permit status is restricted or closed — a great ADR means nothing where you can\'t operate legally. And when average stays are 7 nights or less, a blue pill flags the STR material-participation tax lane: losses can offset ACTIVE income without Real Estate Professional status. Confirm with your CPA.',
      },
    ],
  },
  {
    section: 'Versions, compare, and reports',
    entries: [
      {
        t: 'Scenario versions',
        b: 'Every underwrite is frozen forever with the calc-engine version that produced it. The dropdown on a deal page switches between versions; nothing is ever overwritten.',
      },
      {
        t: 'Compare view',
        b: 'The Compare button (appears once a deal has 2+ versions) puts up to five side by side: a results table with the best value per row in green, and a changed-inputs table showing ONLY what differs between versions, highlighted gold. Perfect for "what if I offer less" and "actual vs market rents" questions.',
      },
      {
        t: 'PDF report',
        b: 'One click builds a branded PDF: photo, listing agent, verdict, all valuation methods, financing comparison, stress panel, proforma, tax view, and the disclaimer block. Print it, send it to a partner or lender, or file it with the deal.',
      },
    ],
  },
  {
    section: 'Markets (finding the best pockets in the US)',
    entries: [
      {
        t: 'What the Markets page is',
        b: 'Every US county (~3,000) ranked for multifamily investing from free national data: Zillow home values and rents, Census population/taxes/vacancy, and FEMA natural-hazard risk. Pick a lens — Cash flow, Balanced, or Appreciation — and the ranking reorders instantly under the same data.',
      },
      {
        t: 'Reading the map and county card',
        b: 'Every county is a circle: color = score under the selected lens (red→gold→green, legend on the map), size = population. Click a circle or a table row for the county card: score, eight metrics (yield, 5-yr appreciation, rent growth, population growth, tax rate, rental vacancy, renter share, FEMA hazard risk), a "thin data" pill when under 85% of metrics are present, and the Add-to-targets button. Filter with the search box, state dropdown, and the min-population box (defaults to 25,000 — tiny counties make noisy statistics; lower it to explore rural markets).',
      },
      {
        t: 'How the score works',
        b: 'Each metric becomes a national percentile (direction-aware: high yield helps, high taxes hurt), then the profile\'s weights blend them 0–100. All arithmetic runs in the tested calc engine — the same frozen-math discipline as underwriting. A county missing some data is scored on what it has and flagged "thin data" rather than silently punished.',
      },
      {
        t: 'Gross yield — the cash-flow compass',
        b: 'Annual rent divided by home value. It\'s computed from all-homes data, not apartment buildings, so treat it as a compass: above ~7% markets usually pencil for cash flow, below 5% they rarely do. The deal math on real listings is always the final word.',
      },
      {
        t: 'The risk column',
        b: 'FEMA\'s National Risk Index: expected losses from hurricanes, tornadoes, wildfire, flood, quake and more. High-risk counties carry rising insurance costs — a direct hit to cash flow that listing photos never show.',
      },
      {
        t: 'Add to targets',
        b: 'Found a pocket you like? Add to targets generates a scan polygon for that county and the droplet starts pulling its Redfin listings and sold comps in the NEXT MORNING run — they land in On-Market with photos, agents, screens, and reports working automatically. Its tax rate and appreciation defaults seed the underwriting presets too. Off-market parcels are separate: those come from county assessor lanes (Davidson and Maricopa built; other counties importable manually via the assessor tool — ask in the build chat to add a county lane).',
      },
      {
        t: 'Where the data comes from and how fresh it is',
        b: 'Zillow research CSVs, the Census ACS API, FEMA NRI, and the Census gazetteer — all free, refreshed automatically every ~90 days (these series only update monthly). The data date shows top-right on the page.',
      },
    ],
  },
  {
    section: 'Off-Market (finding sellers before they list)',
    entries: [
      {
        t: 'What the Off-Market page is',
        b: 'County assessor records for multifamily parcels — every duplex-to-apartment building the county knows about, with the owner\'s real name and mailing address. Unlike Redfin data, these have REAL unit counts. Filter down to a target list and export it for a direct-mail campaign.',
      },
      {
        t: 'Getting parcels in — it\'s automatic',
        b: 'Nothing to do for the built-in lanes: the droplet auto-discovers, downloads, and imports county data (Nashville/Davidson live; Maricopa in progress) whenever the parcels table is empty or more than ~30 days old — no files to handle. For ANY other county, download its assessor file and run the manual importer with --inspect first (it writes nothing, just shows how the columns mapped), then without it to import; ask in the build chat to promote a county you use often into an automatic lane.',
      },
      {
        t: 'Which states appear in the Off-Market filter',
        b: 'The state and county dropdowns are built from the parcels you actually have — nothing is hardcoded. TN appears because Davidson County imported cleanly (8,842 multifamily parcels). AZ appears the moment a Maricopa import lands, and every off-market feature (screening, equity flags, ratings, mail lists, FreedomSoft export) works on it immediately with no further setup. Maricopa is the stubborn one: the assessor firewalls its bulk-file hosts from datacenters, so the importer now tries four routes in order — the county GIS REST directory, the county\'s own ArcGIS Online portals, the public ArcGIS search, then the assessor page scrape — and prints exactly why each failed, so one droplet run diagnoses the whole chain.',
      },
      {
        t: 'Absentee',
        b: 'The owner\'s mailing address differs from the property address — they don\'t live there. Absentee owners of aging multifamily are the classic direct-mail audience: they feel management pain and often respond to a credible offer.',
      },
      {
        t: 'Entity-owned',
        b: 'The owner name looks like an LLC, corporation, or trust. These are investors — the mail copy should talk numbers, not memories. Looking up the people behind an LLC via Secretary of State records is on the roadmap (not built yet); until then, the mailing address is the reliable channel.',
      },
      {
        t: 'Filtering the parcel list',
        b: 'Search matches owner, address, city, or APN as you type — results update live, no search button. Dropdowns: state, county, rating, screen verdict. Number boxes: min/max units and held ≥ years. Checkboxes: Absentee, Entity-owned, 💰 High equity. Sorts: best screen first, most units first, highest value first. One trap worth knowing: "Min units" silently drops apartment parcels whose county file doesn\'t state a unit count — the zero-results card reminds you.',
      },
      {
        t: 'The table shows 200; Export ships everything',
        b: 'The on-screen table renders the first 200 rows for speed, but Export FreedomSoft CSV and Save-as-mail-list always include ALL filtered matches (the button shows the true count). Above 10,000 matches the server caps out and the page says so — tighten filters for full coverage.',
      },
      {
        t: 'Held ≥ years',
        b: 'Filters to owners whose last recorded sale is at least that many years back. Long holds mean big equity and often depreciation that\'s fully used up — both classic reasons to sell, and seller-finance candidates since there\'s no mortgage to pay off.',
      },
      {
        t: 'The Screen column — every parcel pre-underwritten',
        b: 'Each parcel in the list runs through the deal engine automatically: estimated rent (Zillow zip band × units), standard expenses, county-appraised value. Pursue means it clears your DSCR and cap-rate bars at full county value; Consider is close; Pass doesn\'t pencil at these estimates. "Needs data" means a required input is missing — usually the unit count on apartment parcels. Sort by "Best screen first" to work the top of the pile.',
      },
      {
        t: 'The parcel report (click any row)',
        b: 'Opens the full numbers: max allowable offer (the highest price meeting your targets, with taxes re-assessed at every price tested), estimated NOI today, cash flow now and projected over five years with exit equity, seller-finance opener structures, and the owner\'s mailing details. The three assumptions at the top (units, rent, value) are editable — change any and everything recalculates through the same frozen engine. All estimates are provenance-labeled.',
      },
      {
        t: 'Rating leads: ♥ 👍 👎',
        b: 'Three ratings on every off-market lead, shared across your org: ♥ heart = strong, contact first; 👍 thumbs up = has potential; 👎 thumbs down = something\'s off. Click again to clear. Filter the list by rating (and by screen verdict) to work your shortlist, then export just those to FreedomSoft. When a conversation goes well, "Analyze as deal" promotes the parcel to a full deal.',
      },
      {
        t: 'Notes with timestamps',
        b: 'Every off-market lead and every analyzed deal has a Notes section — each note saves with a timestamp and who wrote it, visible to your whole org, deletable with the ✕. Call outcomes, drive-by impressions, seller conversations. Notes survive data refreshes. Cmd/Ctrl+Enter saves quickly.',
      },
      {
        t: 'Street View and the off-market map',
        b: 'Every lead links to Google Street View (exact position from county coordinates; address search as fallback). The List/Map toggle shows all filtered leads as pins colored by screen verdict — green pursue, gold consider, grey pass, blue needs-data (legend on the map), with ♥-rated parcels drawn bigger. Click an address in the list to jump to it on the map; click any pin for a summary card with Open report and Street View buttons. If pins are missing, the map says coordinates arrive with the next county refresh.',
      },
      {
        t: 'How fresh is the parcel data?',
        b: 'The droplet re-imports county data automatically about once a month (and immediately whenever the table is empty). Owner mailing addresses and sale dates update in place — your flags and lists survive refreshes.',
      },
      {
        t: 'FreedomSoft export',
        b: 'The Export button downloads a CSV with clean column names (Owner Name, Property Address, Mailing Address, Tags…). FreedomSoft\'s importer lets you map columns on upload, so it accepts this file directly. Tags like absentee/entity-owned/6u come along so you can segment campaigns inside FreedomSoft.',
      },
      {
        t: 'Saved mail lists',
        b: 'Save as mail list freezes the current filter results under a name. The lists live in a collapsible card at the top of the Off-Market page — expand it for each list\'s parcel count, date, its own Export CSV, and Delete. Re-exporting a saved list always gives the same parcels, even after fresh county imports, so a campaign\'s audience stays auditable; every export is logged, and deleting a list keeps its export history.',
      },
      {
        t: 'Calling hours are enforced by design',
        b: 'The database stores legal calling windows per state (federal telemarketing rule: 8am–9pm in the owner\'s local time). When the call queue lands in a later phase, it will refuse to surface numbers outside the window.',
      },
    ],
  },
  {
    section: 'Goals (the "why" behind the deals)',
    entries: [
      {
        t: 'Setting goals (as many as you want)',
        b: 'Goals → "+ New goal": enter the monthly cash flow you want (say $10,000), your starting cash, and optional monthly savings — the four strategy paths compute live right in the form before you even save. You can run MULTIPLE goals at once, each with its own assumptions and committed deals. Collapsed goal cards show the progress bar PLUS four timeline chips — Bank / Seller / BRRRR / Equity with time-to-goal, fastest in green, hover for exact months and deal counts — so you compare goals at a glance without expanding. Mark one achieved 🎉 and it moves to the trophy list.',
      },
      {
        t: 'Editing and duplicating goals',
        b: 'Expand a goal → "✎ Edit goal" changes anything — name, target, every assumption — and the strategy timelines recompute as you type. "⧉ Duplicate as new" copies a goal\'s numbers into a fresh goal, which is the scenario-comparison workflow: duplicate your $10k goal, change one assumption (seller terms, buy-at-% of value, savings rate), and compare the two cards side by side. Committed deals stay with the original.',
      },
      {
        t: 'Deals choose their goal',
        b: 'With multiple goals active, every deal\'s results page lists them all in the "Part of goal" dropdown — commit each deal to whichever goal it serves. A deal counts toward exactly one goal at a time; its underwritten monthly cash flow feeds that goal\'s progress bar.',
      },
      {
        t: '"Saving / month" is fuel, not part of the goal',
        b: 'The goal itself is pure rental cash flow — savings never count toward the $10,000. But every next purchase needs a down payment, and there are only three sources: money you add monthly, the cash flow of buildings you already own, and refi proceeds. At $0/month added, conventional 25%-down deals often never get off the ground (the first down payment alone can exceed your starting cash) while the low-down seller-finance path still converges — which is exactly why the off-market machine hunts seller-finance candidates.',
      },
      {
        t: 'How the timelines are computed',
        b: 'A month-by-month simulation, not a guess: your war chest grows from savings plus the cash flow of every deal you\'ve already bought (the snowball effect), and a new deal is bought the month you can afford one. No appreciation or rent growth is counted — real results should beat the projection.',
      },
      {
        t: 'The four paths',
        b: 'Conventional: bank loans at market price, 25% down. Seller finance: ~10% down with the owner carrying. Value-add + refi recycle (BRRRR): buy at market, improve, refi your cash out — assumes the rent bump covers the bigger loan. Equity capture: buy at a DISCOUNT to real value, cash-out refi against full value. The discount pays twice: the same rents carry a smaller loan (cash flow beats a full-price deal from day one) AND the refi returns your capital for the next purchase, honestly stepping cash flow down to the full-value loan afterward. Each card shows pre- and post-refi cash flow.',
      },
      {
        t: 'Finding equity-capture candidates (the 💰 pills)',
        b: 'On-Market: listings that match a county parcel show a 💰 "under value" pill when asking sits at least 8% below the county appraisal — sort by "Most equity first." Off-Market: the list pill appears at 50%+ owner equity (county value vs what they paid) and the 💰 High equity checkbox filters to exactly those; the parcel report shows the equity figure whenever it\'s positive. Two honest caveats: the off-market signal needs a recorded sale price (owners with none — often the longest holds with the MOST equity — won\'t show a pill; use Held ≥ years for those), and all of it is appraisal-based — verify with comps before counting the equity as real.',
      },
      {
        t: 'Make the assumptions yours',
        b: 'The defaults ($150k/unit, 8% cash-on-cash, 12% under seller terms) are editable under "Edit deal assumptions." Best practice: underwrite a few real deals first, then plug YOUR achieved cash-on-cash into the planner — the timeline becomes a plan instead of a hope.',
      },
    ],
  },
  {
    section: 'Behind the scenes (automation)',
    entries: [
      {
        t: 'The droplet does the work',
        b: 'A small always-on server runs the schedule: early-morning code update, 5:15/5:45am scans (Phoenix, Nashville), photos + agent capture every 2 hours from 6am–10pm, the 7am email digest, and a monthly rent refresh. The morning scan also chains the Phase 2/3 jobs automatically: county parcel import when the table is empty or >30 days old, national market stats when >90 days old, and scans of any counties you added from the Markets page. Logs live at /var/log/mfda-scan.log, mfda-photos.log, mfda-digest.log, and mfda-rents.log on the droplet.',
      },
      {
        t: 'The morning digest',
        b: 'Sent through GoHighLevel at 7am: every lead that\'s genuinely new since yesterday, with photo, price, agent when known, and a link straight into the app — plus a scan-health footer so you know the pipeline ran.',
      },
      {
        t: 'Why photos/agents arrive gradually',
        b: 'Redfin limits how many listing pages can be read per sitting (about 6), so the system takes 5 every 2 hours and stops politely when challenged. New listings usually have photos and agents within a day. This is deliberate good citizenship, not a bug.',
      },
      {
        t: 'If a scan says BLOCKED',
        b: 'Redfin refused that run. Nothing to do — the next scheduled cycle retries. Persistent blocks across days are worth mentioning in the build chat.',
      },
      {
        t: 'Costs',
        b: 'Every external call is logged to a cost ledger. The current stack is $0/month: Redfin and Zillow data are free, Supabase and Netlify are on free tiers, and the droplet was already paid for. Paid upgrades (RentCast property data, HelloData rent comps) are built but switched off until needed.',
      },
    ],
  },
  {
    section: 'FAQ & troubleshooting',
    entries: [
      {
        t: 'The score says 100 before I typed anything real',
        b: 'The form opens with placeholder units so the math has something to chew on. The score is meaningless until you\'ve entered the property\'s real unit mix and rents. Enter real numbers, then trust it.',
      },
      {
        t: 'Why didn\'t the Market dropdown fill itself?',
        b: 'It does now — a deal\'s state auto-selects its market preset (AZ → Phoenix/Maricopa) and applies the metro defaults. If you saw it empty, refresh; deals underwritten before this feature keep whatever their saved version had.',
      },
      {
        t: 'A property has no photo or agent yet',
        b: 'It\'s in the backfill queue — photos and agents arrive in small batches through the day. The Redfin link works immediately regardless.',
      },
      {
        t: 'No rent band shows for a ZIP',
        b: 'Zillow doesn\'t publish an index for every ZIP (thin rental markets get skipped). Use nearby ZIPs and the listing\'s own asking rents as your guide.',
      },
      {
        t: 'The map was blank for a while — what happened?',
        b: 'The original map engine drew with WebGL (GPU graphics), which some Mac graphics drivers silently refuse to paint — everything loads, nothing shows. The map now uses Leaflet, which renders plain image tiles with no GPU involvement, on the same engine the alot.land lot maps use. If tiles ever fail to appear, it\'s a network block on openstreetmap.org (VPN/DNS filters) — the pins and cards still work.',
      },
      {
        t: 'The magic-link email didn\'t arrive',
        b: 'Check spam first. The built-in mailer also rate-limits to a few links per hour — wait a bit and retry. Only invited emails can sign in at all.',
      },
      {
        t: 'Adding a teammate',
        b: 'Settings → Invites (admins only): enter their email and role. They sign in with a magic link and land in your org, seeing the same deals. Members can underwrite; admins can also invite and manage markets.',
      },
      {
        t: 'Dark mode',
        b: 'The moon/sun button in the top bar switches between light and dark themes. Your choice is remembered on this browser; first visit follows your device\'s setting. Printed PDF reports always stay light — they\'re built for paper.',
      },
      {
        t: 'The "Net / mo" column on Deals',
        b: 'Monthly cash flow after the mortgage, before income tax (CFBT ÷ 12) — green when positive, red when it bleeds. A solid figure comes from that deal\'s latest saved scenario: your rents, your expenses, your financing. An italic figure tagged "est" means the deal has no scenario yet, so it is screened like an off-market parcel — zip-band rent × unit count, standard expense rates, 75% LTV against the asking price. Underwrite the deal and the estimate is replaced by the real number. A dash means something essential is missing (hover it to see what: usually units, a price, or a rent band for that ZIP).',
      },
      {
        t: 'Hearting deals',
        b: 'Click the ♡ on any deal row or on a deal\'s results page to heart it. Hearted deals float to the top of the Deals page, and the ♥ Hearted button filters to just them. Hearts are shared across your org — everyone sees the same shortlist.',
      },
      {
        t: 'My underwrite from last week shows fewer panels than today\'s',
        b: 'Old snapshots are frozen with the engine version that made them — features added later (like the proforma) don\'t retroactively appear. Hit Edit / re-run to produce a fresh version with everything current.',
      },
    ],
  },
];

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-gold/40 rounded px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function Guide() {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return MANUAL;
    return MANUAL.map((sec) => ({
      ...sec,
      entries: sec.entries.filter(
        (e) => e.t.toLowerCase().includes(query) || e.b.toLowerCase().includes(query),
      ),
    })).filter((sec) => sec.entries.length > 0);
  }, [q]);

  const total = filtered.reduce((a, s) => a + s.entries.length, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display text-2xl font-semibold">Guide</h1>
      <p className="text-muted text-sm mb-4">Everything in MFDA, explained. Type to search.</p>

      <input
        className="input mb-2"
        type="search"
        autoFocus
        placeholder="Search the manual… (try: DSCR, asbestos, seller finance, blocked)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && <p className="text-xs text-muted mb-4">{total} result{total === 1 ? '' : 's'}</p>}

      {filtered.length === 0 && (
        <div className="card p-8 text-center text-muted mt-4">
          Nothing found for “{q}”. Try a broader term — or ask in the build chat and it'll get added here.
        </div>
      )}

      <div className="space-y-6 mt-4">
        {filtered.map((sec) => (
          <section key={sec.section}>
            <h2 className="font-display text-lg font-semibold mb-2">{sec.section}</h2>
            <div className="card divide-y divide-border">
              {sec.entries.map((e) => (
                <details key={e.t} open={Boolean(q)} className="group px-5 py-3">
                  <summary className="cursor-pointer font-medium text-sm list-none flex items-center justify-between">
                    <span>{highlight(e.t, q.trim())}</span>
                    <span className="text-muted group-open:rotate-90 transition-transform">›</span>
                  </summary>
                  <p className="text-sm text-ink-2 mt-2 leading-relaxed">{highlight(e.b, q.trim())}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted mt-8 pb-8">
        Estimates throughout are not offers or advice — verify tax with a CPA, legal/title with an attorney.
        Something missing from this manual? Say so in the build chat and it ships in the next update.
      </p>
    </div>
  );
}
