# Intake Center

Approved by Matt: one CRM destination with five tabs: Form submissions, Merchant applications, Agent & partner applications, Partner introductions, Merchant referrals. Base: `1f33cf5b91eb2da123ef4bfbaf2d915403502bc6`; branch `codex/intake-center`.

## Design and implementation

- Add `/dashboard/intake` to employee navigation for admins/managers. Use Liberty's existing CRM presentation tokens, responsive accessible tabs, one page heading, and a short description of each source.
- Reuse the actual operational panels and current APIs. Extract the website request panel from Lead Ops and the merchant referral panel from Referral Program so the old and new screens share one implementation. Reuse the partner application and introduction components directly. Make the merchant application list embeddable while preserving its detail view.
- Keep legacy URLs working. Preserve source-specific filters and deep links in the URL without letting the outer tab selector collide with embedded selectors. Only mount the selected panel. Do not fetch unrelated maintenance, commission or lead-pool readers.
- Existing detail/review endpoints, role checks, CSRF controls, record classes and approval semantics remain authoritative. The new shell does not automatically approve, send, replay or import anything. Do not merge distinct records or invent combined counts.
- No migration or new persistence. No provider configuration change. Uploads/campaigns remain off, outbound paused and the $50 Outscraper cap unchanged. Do not push, sync or publish this new task without a subsequent instruction.

## Validation

Run TypeScript, production build, route/navigation and URL-state regressions, focused existing panel tests, and a mounted browser acceptance with synthetic records on a private non-production target. Verify five tab routes, independent filters, detail/review entry points, loading/denied/error/empty states, history/reload, and desktop/mobile layout. Preserve prior check evidence; do not label partial local checks a full release gate.
