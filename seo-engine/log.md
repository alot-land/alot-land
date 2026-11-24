# SEO engine log

Newest first. One entry per cycle. **The rule: max one new indexable page per run.**
Anything needing David's review is listed under *Needs you*.

---

## Cycle 4 — 13 Oct 2026
**Move:** internal-linking pass. No new pages.

- Found `/guides/how-to-buy-land/` — the only guide, aimed at "how to buy land"
  (4,400/mo, difficulty 0) — had **zero inbound internal links**. Only the
  sitemap pointed at it. Crawlers and models weigh an orphan page as unimportant.
- Linked it in context from `/listings` (intro), `/find-land` (hero), every
  listing page (under the description), and `llms.txt` → Key pages.
- Indexed pages: **29**. The drop from 30 on 16 Sep is the Chapel Hill listing
  being hidden — explained.
- AI mentions still **0**; control healthy (landwatch.com = 15,730).
- Note: no cycle pull request had opened since 27 Aug. This run treats itself
  as the current week, not a make-up of the missed ones.

**Needs you:** the FAQ videos are still the biggest lever. Nothing in the
transcript pipeline has arrived yet.

---

## Cycle 2 — 19 Aug 2026
**Moves:** retarget `/listings`; publish one new guide.

- `/listings` retitled from "Available Land" to **"Unrestricted Land for Sale in
  Tennessee"**, with an intro answer block covering unrestricted, hunting,
  homestead and rural. Stale "Arizona & Tennessee" copy removed.
- **New page:** `/guides/how-to-buy-land/` — Article + FAQPage + BreadcrumbList
  schema, David's byline, six question-shaped H2s, each opening with a
  self-contained answer block.
- Indexed pages: 29 → **30**.

**Needs you:** record the "how to buy land" video. The guide is written from
existing knowledge and will be rewritten from your transcript, which is the
stronger version.

---

## Cycle 1 — 19 Aug 2026
**Move:** FAQ distribution + demand-driven additions. No new pages.

- FAQs split by intent: seller FAQs and FAQPage schema now on `/sell-land`,
  buyer FAQs on `/find-land` and `/listings`. Previously all ten sat only on the
  homepage and `/sell-land` had no FAQ schema at all.
- Three FAQs written against verified demand: *how much is my land worth*
  (~1,590/mo, difficulty 0), *how to sell land without a realtor* (170/mo),
  *can I sell part of my land* (90/mo).
- Removed `PostalAddress` in favour of `areaServed`; added `Service` schema.
- Added structured data to the Sugar Tree Vista page, which had none.
- **RealEstateAgent removed sitewide** — David is an investor, not a licensed
  agent, and the site says so in writing. Now `Organization`.
- FAQs gained an optional video field with VideoObject schema.

---

## Cycle 0 — 19 Aug 2026
**Move:** audit and baseline. No new pages.

- All six crawlers permitted; Netlify serves 200 to GPTBot, ClaudeBot,
  PerplexityBot. `llms.txt` published.
- Baseline: **0 US AI mentions**, verified against a working control
  (landwatch.com = 4,036).
