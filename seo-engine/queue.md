# Work queue

Everything waiting on a person. The weekly cycle adds to this; clearing it is
the job. Content awaiting approval shows up as a **pull request** instead —
this file is for things a machine cannot do.

**Status:** `todo` · `doing` · `blocked` · `done`
**Owner:** David, or whoever is hired to run this.

---

## Now

| # | Item | Why it matters | Owner | Status |
|---|------|----------------|-------|--------|
| 1 | **Record the 5 priority FAQ videos** — how to buy land · how much is my land worth · how do I sell my land · buy land & build a house · buy land with no money | The written pages are live and ranking-ready but generic. A page written from your transcript contains material that exists nowhere else, which is what actually gets cited. Biggest single lever available. | David | todo |
| 2 | **Paste each YouTube link** into `/admin` → FAQs → *Video Answer URL* | Embeds the clip in the FAQ and emits VideoObject schema, attributing the answer to a named person. | David | todo |
| 3 | **Audit GHL workflow triggers** | A seller who used the sell-land form received buyer nurture emails. The website is correct — every form has its own ID. A GHL workflow is firing on "any form submitted" or "contact created". Costing credibility with real sellers now. | David | todo |
| 4 | **Google Business Profile for Goldstone** at 7301 N 16th St | alot.land is a national play and does not need a GBP; Goldstone is local and does. Use the real office, never the registered-agent address — Google rejects those. | David | todo |

## Next

| # | Item | Why it matters | Owner | Status |
|---|------|----------------|-------|--------|
| 5 | **SPF cleanup** — drop MailerLite and ProtonMail, add GoHighLevel | GHL workflow email will send from `@alot.land`. Without GHL's SPF and DKIM those messages can land in spam. Do this *before* publishing the Sugar Tree workflows. Confirm nothing still sends via MailerLite/Proton first. | David | todo |
| 6 | **Publish the three GHL workflows** (showing, consult, area guide) | Built and drafted, not published. Calendars and forms are already wired into the site. | David | todo |
| 7 | **Fix the site's published address** — currently the registered-agent suite | Contradicts the Tennessee service area and competes with Goldstone for that address. `PostalAddress` is already removed from schema; the footer still shows it. | Claude + David | todo |
| 8 | **Add vendors** to Preferred Vendors | The page is linked in the nav and empty. CMS is ready. | David | todo |
| 9 | **Self-host 4 things-to-do photos** (Ponderosa, Mousetail, Natchez Trace, Parsons) | Currently hotlinked from third parties — they can break or raise rights questions. | David | todo |

## Waiting on something

| # | Item | Blocked by | Owner | Status |
|---|------|-----------|-------|--------|
| 10 | **Rewrite `/guides/how-to-buy-land` from transcript** | Item 1 | Claude | blocked |
| 11 | **Second guide — "unrestricted land" cluster** (2,400/mo, difficulty 0) | Cycle 3 | Claude | blocked |
| 12 | **Set Sugar Tree lot statuses** to Available | The sale opening | David | blocked |

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
