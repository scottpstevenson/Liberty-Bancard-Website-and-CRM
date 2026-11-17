# Partner attribution: precedence and storage rules

One rule is used by every in-site partner link, the application form and the stored application snapshot.
Source of truth: `shared/partner-application.ts` (`pickPartnerAttribution`, `resolvePartnerAttribution`, `partnerLink`) and `client/src/lib/partner-application-client.ts` (`capturePartnerFirstTouch`, `currentPartnerAttribution`, `partnerRouteWithAttribution`).

## What can be attributed

Only the allowlisted keys `ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, and only values that are 1 to 100 plain characters (letters, digits and `_ . ~ : + -` and spaces, starting with a letter or digit). A token, a URL, a personal value, an unknown key or a malformed value is dropped and never stored, carried in a link or sent to the server.

## Precedence

1. **Current touch wins.** If the page the visitor is on carries any allowlisted value, that whole set is the attribution. Sets are never merged key by key, so a stored `ref` can never be paired with a different campaign's UTM values.
2. **Otherwise the session's first touch.** The first allowlisted set seen on a partner route is saved in `sessionStorage` under `lb_partner_first_touch` (first write wins for the whole browser session; it is never overwritten by a later page). A visitor who reaches an application page by a full page load with no query string is still attributed to how they arrived.
3. **Otherwise nothing.** An application with no attribution stores none.

The first touch is captured only on the partner routes in `PARTNER_SOURCE_PAGES` (hub, referral, sales-agent, CPA, bookkeeper, insurance, affiliate). It is session-scoped, not a cookie, and is not sent anywhere until an application is submitted.

## Where it is applied

- Every in-site partner link (hub calls to action, path cards, path-switch links, calculator links, profession pages' compare link, affiliate links) uses `partnerRouteWithAttribution`, which applies the rule above.
- The application form sends the resolved set. The server runs `pickPartnerAttribution` again on the body and stores the result in the application's acquisition snapshot, so a client that sends extra keys cannot widen what is stored.
- The server-rendered partner pages carry no per-visitor attribution; attribution is a browser-side concern.

## How it is proven

- `scripts/test-partner-application-browser.ts` (disposable database, real Chromium): six hub clicks, journey switching in both directions and the keyboard flow keep the current set; the 200% zoom session lands on the hub with `ref`, `utm_source`, a `token` and an unknown key, stores only `{ref, utm_source}` as the first touch, then submits from a page with no query string and the stored acquisition equals that first touch exactly. The keyboard flow stores only its own `utm_source`, which proves the current set wins and nothing is merged.
- `scripts/test-partner-program-contracts.ts`: the allowlist, the precedence function and the server re-filter.
