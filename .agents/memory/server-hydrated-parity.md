---
name: Server vs hydrated title/h1 parity
description: How public pages keep one headline and title before and after hydration, and how the browser check detects hydration
---
Every server-rendered public page takes its h1 and document title from one DB-free shared module that both `server/ssr/*` and the React page import; the check `scripts/check-public-server-hydrated-parity.ts` (registered in pre-deploy and the CI suite manifest) fails on any title/h1 difference.

- Shared record shape: `headingLead` + `headingAccent` (client renders two colours) and `heading`/`h1` derived as `lead + " " + accent` (server). A `<br />` in the React h1 needs a literal space before it or textContent loses the word break.
- A shared `title` that already contains " | Liberty Bancard" (or is a compare `metaTitle`) must be passed to `<SEO brandSuffix={false}>`; SSR `ssrHtmlShell` never appends the suffix, SEO.tsx does by default. Limit is 30-70 counting the suffix.
- Where server and client text disagreed, the server/shared (claim-reviewed) wording won; the client's older hard-coded string was dropped.
- Census findings under-reported: all five compare pages and the `/get-started` title also differed. Test the full route set, not only the routes the audit named.
- Hydration detection: wait until `#root` has no `.ssr-navbar`/`.ssr-hero` (React replaces the SSR chrome) and title/h1 are stable for ~1s; otherwise a premature read compares the server document to itself and passes falsely. Fetch the server document with in-page `fetch` + DOMParser (these routes are not crawler-gated).
**Why:** visitors and crawlers saw one headline first and another after JS loaded.
**How to apply:** new server-rendered public page → put title/h1 in a shared module, add the route to the check's route list.
