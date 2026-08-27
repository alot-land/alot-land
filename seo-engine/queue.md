# Work queue

Everything waiting on a person. The weekly cycle adds to this; clearing it is
the job. Content awaiting approval shows up as a **pull request** instead —
this file is for things a machine cannot do.

This file drives the "Your move" section of the dashboard at `/seo`. Editing it
changes that page. Tick something off by moving its row to **Done**.

**Status:** `todo` · `doing` · `blocked` · `done`
**Owner:** David, or whoever is hired to run this.

---

## Now

| # | Item | Why it matters | Owner | Status |
|---|------|----------------|-------|--------|
| 1 | **Record the 5 priority FAQ videos** — how to buy land · how much is my land worth · how do I sell my land · buy land & build a house · buy land with no money | Phone camera, ~60 seconds each, you answering the question out loud. This is the single biggest lever left. Everything written is generic until a page is built from your own words; a transcript puts material in the index that exists nowhere else, and that is what actually gets quoted. Nothing else on this list comes close. | David | todo |
| 2 | **Upload each to YouTube (Public or Unlisted) and paste the link** into `/admin` → FAQs → *Video Answer URL* | Pasting the link is your only manual step. It embeds the clip, emits VideoObject schema attributing the answer to a named person, **and pulls the transcript automatically**. Do not wait for captions — the job retries every six hours until they exist. Private videos will not work. | David | todo |
| 3 | **Audit GHL workflow triggers** | A seller who used the sell-land form received buyer nurture emails. The website is correct — every form has its own ID. A GHL workflow is firing on "any form submitted" or "contact created". This is costing credibility with real sellers right now, and it is independent of everything else here. | David | todo |

## Next

| # | Item | Why it matters | Owner | Status |
|---|------|----------------|-------|--------|
| 4 | **SPF cleanup** — drop MailerLite and ProtonMail, add GoHighLevel | Do this *before* publishing the GHL workflows. Those emails send from `@alot.land`, and without GHL's SPF and DKIM they can land in spam. Confirm nothing still sends via MailerLite/Proton first. MailerLite is still named in `/privacy` — update that page in the same pass. | David | todo |
| 5 | **Publish the three GHL workflows** (showing, consult, area guide) | Built and drafted, not published. Both calendars and all eight forms are already wired into the site and returning 200. | David | todo |
| 6 | **Set Sugar Tree lot statuses to Available** | Currently "coming soon". Flip when the sale opens — the badge, page title, social stamp and the AggregateOffer price range all follow the field. | David | todo |
| 7 | **Add vendors** to Preferred Vendors | The page is linked in the nav and empty. The CMS is ready. | David | todo |
| 8 | **Self-host 4 things-to-do photos** (Ponderosa, Mousetail, Natchez Trace, Parsons) | Currently hotlinked from third parties — they can break or raise rights questions. | David | todo |
| 9 | **Google Business Profile for Goldstone** at 7301 N 16th St | alot.land is a national play and does not need a GBP; Goldstone is local and does. Use the real office, never a registered-agent address — Google rejects those. | David | todo |

## Waiting on something

| # | Item | Blocked by | Owner | Status |
|---|------|-----------|-------|--------|
| 10 | **Rewrite `/guides/how-to-buy-land` from the transcript** | Item 1 | Claude | blocked |
| 11 | **Rewrite the 5 FAQ answers from their transcripts** | Items 1–2 | Claude | blocked |
| 12 | **Record the remaining 12 FAQ videos** | Items 1–2 proving the loop works | David | blocked |
| 13 | **Second guide — "unrestricted land" cluster** (2,400/mo, difficulty 0) | A free cycle after the transcript work | Claude | blocked |
| 14 | **Port the rig to Goldstone clients** | ~3 clean cycles on alot.land | Claude + David | blocked |

---

## Done

| Item | Cycle |
|------|-------|
| Crawl audit, `llms.txt`, AI-mention baseline recorded | 0 |
| FAQs split by intent; 3 demand-driven FAQs added | 1 |
| `PostalAddress` removed from schema; `Service` schema added | 1 |
| Structured data added to the Sugar Tree Vista page | 1 |
| `RealEstateAgent` removed sitewide — David is an investor, not an agent | 1 |
| Video field + VideoObject schema on every FAQ | 1 |
| `/listings` retargeted to the Tennessee transactional cluster | 2 |
| `/guides/how-to-buy-land` published | 2 |
| Weekly metrics collection automated | 3 |
| SEO dashboard at `/seo`, linked from `/admin` | 3 |
| Operations handbook at `/handbook` | 3 |
| Open reviews surfaced on the dashboard | 3 |
| Weekly cycle scheduled, gated behind a pull request | 3 |
| `/seo` and `/handbook` password-gated at the edge | 3 |
| YouTube transcript puller merged and verified against live YouTube | 3 |
| FAQ transcripts pull automatically when a video link is pasted | 3 |
| Queue surfaced on the dashboard — one place for manual work | 3 |
| Full front/back-end audit | 3 |
| Entity consolidated — was five unlinked Organizations, now one | 3 |
| FAQ questions promoted from spans to real headings | 3 |
| Registered-agent address removed from the footer of all 34 pages | 3 |
| Dead `@DavidBuysLand` YouTube link removed from `/about` | 3 |
| Question-shaped H2s on `/sell-land`, `/find-land`, `/listings`, `/sold` | 3 |
| Heading outline fixed sitewide — no page skips a level | 3 |
| Lazy loading on 142 more images | 3 |
