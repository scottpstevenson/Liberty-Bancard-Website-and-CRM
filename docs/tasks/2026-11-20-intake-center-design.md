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

## Approved expansion: correspondence and follow-up

Matt approved a per-record Review & next steps drawer with timeline, task/staff-alert/receipt states, branded preview and sending. Automatic acknowledgments cover new submissions only and use the existing first-party `/book` resolver to GHL. Referrals acknowledge the referrer, never enroll or email the referred business merely because another person submitted it. Cold outreach, sequences, campaigns and offline conversion uploads stay off; no publishing.

Reuse the receipt sender and its durable recipient/content/claim checks, bounded retries and uncertain-outcome handling. Extend its versioned source contract for merchant submissions/referrer receipts and explicit staff follow-up. Preserve all older manifest hashes. A local reconciliation owner creates missing tasks/CRM alerts and receipt occurrences idempotently from durable source records; its activation cutoff prevents historical catch-up. Existing website and partner receipts keep their owner. Read-only record detail projections expose operational metadata, never protected merchant fields. Manual correspondence is source-addressed, previewed, explicitly submitted and idempotent; it cannot accept a caller-supplied recipient or opt anyone into marketing. Settings remain explicit and report actual worker health. Test all real API paths on disposable Postgres/Redis with providers denied before any live activation. Production activation is separate from unpublished code.
