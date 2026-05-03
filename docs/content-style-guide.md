# Liberty Bancard — Content Style Guide

This style guide governs every piece of editorial content Liberty Bancard publishes:
blog posts, LinkedIn updates, email newsletters, landing-page copy, and the
auto-generated drafts produced by the AI assist tools at `/dashboard/content` and
`/dashboard/social`.

If something in a draft conflicts with this guide, the guide wins.

---

## 1. Voice and tone

We are the calm, technically-literate friend in the room. Specific, useful,
and never breathless.

- **Voice**: confident, plain-spoken, second person ("you").
- **Tone**: direct without being cold; opinionated without being preachy.
- **Avoid**: marketing puffery, exclamation marks, hype words ("revolutionary",
  "game-changing", "unleash"), AI-flavored hedging ("It's important to note that...").
- **Prefer**: concrete numbers, real fee names, named card brand programs,
  industry-specific examples.

Read your draft out loud. If it sounds like a press release, rewrite it.

---

## 2. The four content pillars

Every blog post and LinkedIn draft must map to exactly one pillar and one
cluster. The four pillars are:

1. **Cost & Pricing** — interchange, effective rate, tiered vs interchange-plus,
   hidden fees, statement audits, switching cost math.
2. **Programs** — cash discount, surcharging, dual pricing, zero-cost
   processing, customer-facing implementation.
3. **Industry** — vertical-specific guidance: restaurants, med spas, dental,
   auto repair, e-commerce, B2B/wholesale, professional services.
4. **Compliance & Security** — PCI DSS, EMV, chargebacks, fraud controls,
   data storage, MATCH list, reserves and underwriting.

Cluster names are short topic labels that allow internal-linking groups to form
naturally over time (e.g. "Effective Rate", "Surcharging Compliance",
"Med Spa", "EMV & Chip").

---

## 3. Structure

### Blog posts
- **Length**: 1,200–2,000 words.
- **Structure**: hook paragraph → 4–6 H2 sections → at least one bulleted list
  → 3–5 FAQs → 1 closing CTA.
- **Slug**: lowercase, hyphenated, ≤ 60 characters, contains a primary keyword.
- **SEO title**: ≤ 60 characters, contains the target keyword near the front.
- **Meta description**: 140–160 characters, plain language, ends with a
  benefit or instruction.
- **Read time**: pre-calculated from word count (200 wpm).

### LinkedIn posts
- **Length**: 600–1,300 characters.
- **Structure**: hook in line 1 (≤ 100 characters) → 2–4 short paragraphs
  separated by single blank lines → one soft CTA.
- **Hashtags**: 2–4 max, lowercase, relevant to pillar.
- **Emojis**: avoid. One sparingly is acceptable; never more than one.

---

## 4. Numbers, claims, and disclaimers

- Always show the math when making a financial claim. ("On $30K/mo with 15%
  keyed unnecessarily, that's about $360/mo.")
- Range estimates ($X–$Y) are preferred over single point estimates.
- Cite the year for any rule that depends on it ("as of 2025").
- For state law differences, name the states (CT, MA, PR for surcharging).
- Disclaim where appropriate: "Always verify current state laws."
- Never claim regulatory approval or endorsement that does not exist.

---

## 5. Internal linking

Every post should link to:

1. At least one product or service page (`/upload-statement`,
   `/savings-calculator`, `/compare-rates`, `/why-liberty-bancard`).
2. At least one related blog post in the same pillar.
3. The primary CTA: `/upload-statement`.

Internal links are passed to the AI assist tool via the `internalLinks` array
on `/api/content/draft` so the model can weave them in naturally.

---

## 6. Author attribution

Posts are attributed to a single author. The two seed authors are:

- **Liberty Bancard Team** — for pillar surveys, "everyone needs to know"
  posts, and platform announcements.
- **Scott Hunter, Founder** — for opinion pieces, statement-audit walkthroughs,
  and anything with a personal POV.

Author bio pages live at `/authors/:slug`.

---

## 7. Editorial workflow

States, in order:
1. `draft` — anyone with content access can edit.
2. `needs_review` — AI-assist drafts land here automatically.
3. `scheduled` — approved by an editor, queued for publish at a specific time.
4. `published` — live; the scheduler promotes scheduled posts on a 5-minute
   tick.
5. `archived` — soft-deleted; not shown publicly but retained.

The editorial workflow lives at `/dashboard/content`. The LinkedIn composer
lives at `/dashboard/social`. The Operator dashboard exposes a **Content &
Organic** KPI tab.

---

## 8. Compliance and risk

- Never describe Liberty Bancard as a bank or chartered financial institution.
  We are a registered ISO of our acquiring bank partners.
- Never make rate guarantees. Use language like "typically saves 0.4%–0.9%"
  and tie it to the merchant's effective rate baseline.
- Never post screenshots that include real merchant identifiers, card
  numbers, or bank routing numbers — even in mocked-up form.
- For any post that mentions card brand rules (Visa, Mastercard, AmEx OptBlue,
  Discover), defer to the current published rule when ambiguous.

---

## 9. AI-assist usage

The `/api/content/draft` endpoint produces draft posts that always land in
`needs_review`. They are starting points, not finished articles.

Editor responsibilities for every AI-assist draft:
1. Verify all numbers and named programs.
2. Replace generic examples with named industries or real merchant scenarios.
3. Add at least one internal link the AI did not include.
4. Read the post out loud and rewrite anything that sounds like an LLM.
5. Move to `scheduled` (with a `scheduledAt`) or `draft` — never directly
   `published` from raw AI output.

The LinkedIn composer (`/api/social/generate`) follows the same rule: every
draft requires human approval before it can move to `scheduled` or `published`.

---

## 10. Cadence targets

- **Blog**: 2–3 published posts per week.
- **LinkedIn**: 4–5 published posts per week.
- **Pillar mix per month**: Cost & Pricing 40%, Programs 25%,
  Industry 25%, Compliance & Security 10%.

The Operator dashboard's Content & Organic tab tracks counts by pillar and
upcoming scheduled items so cadence drift is visible at a glance.
