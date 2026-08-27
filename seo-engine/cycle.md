# The weekly cycle — runbook for the automated run

This is what the scheduled cycle runner follows. It lives in the repo, not in
the task prompt, so David can change how the routine behaves by editing this
file and the change is versioned like anything else.

The governing method is the `citation-engineering` skill. **Invoke it and follow
it.** This file only records the things specific to alot.land and the safety
rules that apply because the run is unattended.

---

## The gate — the part that must not be got wrong

**Never push to `main`. Never merge. Never deploy.**

Every cycle produces exactly one pull request against `main`, and stops there.
David merges it or closes it. That is the whole approval queue.

The skill permits low-risk changes (schema, FAQ text, internal links) to commit
straight to `main`. **We do not do that here.** Two reasons, both learned on
this site:

1. A saved value that does not match the content schema fails the build, and
   Netlify keeps serving the last good deploy — so the site looks *frozen*
   rather than broken, and nobody notices for hours.
2. The run happens unattended, possibly while David is asleep. A single review
   step costs him two minutes and removes the entire class of problem.

One pull request per cycle also means the dashboard banner shows one item, not
a list, which is the difference between a queue he clears and a queue he
ignores.

---

## Before doing anything — preflight

Stop and report instead of proceeding if any of these fail:

- `git status` is clean and the branch is `main`, up to date with `origin`.
- `npm run build` passes **before** any edits. If it is already broken, that is
  the only thing worth fixing this week; say so and stop.
- `seo-engine/review.json` lists no open entry with `"isCycle": true`. **If a
  previous cycle is still waiting on David, do not open a second one.** Report
  that the queue is blocked and stop. A stack of unreviewed pull requests is
  how this stops being used.

  Only the cycle's own pull requests gate the run. Unrelated ones — a feature
  branch, an app someone parked — are listed on the dashboard but must not
  block the routine, or one forgotten branch stalls it indefinitely.

---

## The run

1. **Read the state.** `seo-engine/state.json` for the cycle number, targets and
   what has already run. `seo-engine/log.md` for recent moves. `queue.md` for
   what is blocked on David.
2. **Read the last measurement** in `seo-engine/history.json`. If the control
   domain returned zero, the measurement is broken — note it, and do not draw
   conclusions from the numbers.
3. **Pick one move**, rotating so it does not repeat the last two cycles: new
   guide · listing/service-page upgrade · FAQ expansion · schema pass ·
   internal-linking pass.
4. **Draft it**, following the skill: answer blocks of 40–60 self-contained
   words, question-shaped headings, the voice blocklist, and the cadence of the
   live site.
5. **Argue against the draft.** Ship at 85%+ confidence, not below.
6. **Verify.** `npm run build` must pass. Check the new or changed page in
   `dist/` actually contains what was intended, and that any new indexable page
   is in the sitemap while private pages are not.
7. **Open the pull request** from a branch named `seo/cycle-<n>-<slug>`, and
   **label it `seo-cycle`** — that label is what gates the following week's run.
   An unlabelled pull request will be reviewed but will not stop the next cycle
   from opening another.
8. **Update** `state.json`, `log.md` and `queue.md` in the same pull request.

## Writing the pull request

David is reviewing this on a phone as often as not. The description must let him
decide without reading the diff:

- What changed, in one sentence.
- Which keyword or question it targets, with the volume and difficulty.
- Whether it adds an indexable page (and it must be at most one).
- What he should look at specifically if he only reads one thing.
- Anything it now needs from him.

---

## Ship nothing — a valid and expected outcome

If no move clears the bar, **open no pull request** and say plainly that nothing
shipped and why. Automated SEO degrades because it feels obliged to produce
something every week. A quiet week is a feature.

Reasons to ship nothing, all legitimate:

- The best remaining move is blocked on David (most often: the FAQ videos).
- An existing page already answers the query and cannot honestly be improved
  this week.
- The measurement is broken and the next move depends on reading it.

---

## Specific to alot.land

- **David is a land investor, not a real estate agent.** He hires agents. Never
  describe him or the business as an agent or brokerage, and never reintroduce
  `RealEstateAgent` schema.
- **No sale price in any description prose.** The price is a field and it
  changes; prose goes stale and makes the site look wrong.
- **Publish no street address.** The one on file is the registered agent's, not
  the office. The business is national and uses `areaServed`.
- **Never touch GoHighLevel.** Forms, calendars and phone numbers are embedded
  by URL. Changing site copy or schema must not change any of them.
- **Adding a content field is always two files** — `src/content/config.ts` and
  `public/admin/config.yml`. One without the other silently drops data or fails
  the build.
- **Do not change `public/admin/config.yml` casually.** Duplicate names or bad
  indentation take the whole CMS offline, not just one field.
