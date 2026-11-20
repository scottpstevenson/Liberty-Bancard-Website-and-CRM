# Liberty measurement and statement review handoff — November 20, 2026

Work remains on `codex/launch-readiness-fixes`. No push, Replit sync, publication, production migration, campaign activation, outbound unpause or budget-policy mutation was performed in this task. Meta is explicitly deferred by Matt. Reference documents supplied requirements, not authorization to publish or activate.

## Implemented candidate

The statement-review page now has a wide Liberty navy split hero, a visible desktop upload form, two-column fields, red primary action, one fee-category graphic, alternating sections and compact disclosures. Both empty worksheets were removed. Existing intake, limits, optional phone consent, receipt recovery and actual processing states remain the owners. SSR and client share the headline. The existing brand tokens and typography supply the design.

One public tracker owns consent and route views. No vendor loads before consent; withdrawal clears measurement storage and suppresses dispatch. Analytics and advertising preferences remain separate; ad user-data and personalization remain denied. Approved public routes and machine-readable campaign labels are allowed; private routes, arbitrary queries, sensitive referrer contents and form/document values are excluded. Production destinations never collect local/dev acceptance traffic. Accepted saves emit a deduplicated lead without fabricated revenue. Scheduler/phone clicks express intent; browser booking-return URLs cannot create appointments. The authenticated GHL callback remains the confirmed appointment owner.

Browser first/latest campaign touches are distinct. CRM uses existing attribution fields and intake occurrence context; no new first/last-touch database columns or migration were introduced. Review CSV excludes unmatched click IDs, browser-claimed appointments, contact details and fabricated money. It is not an upload-certified offline integration.

## Authenticated Google changes observed

- Liberty Ads customer `345-511-8578`, Scott's account. All ads off, account banner explicitly confirmed paused/removed campaigns.
- Removed exactly the three campaigns Matt confirmed: Liberty Bancard - Search Ads - Phone; Liberty Bancard - Lead Gen 8/8; PMAX - Q4. Readback showed Removed. Existing removed campaigns were untouched.
- Primary conversion: `Liberty CRM - Saved Website Lead`, action ID `7910681195`, destination `AW-17130296245/cKygCOvUjbwdELWnrug_`. Count One, no value, enhanced conversions off. Awaiting real conversion receipts.
- Eight enabled legacy goals now Secondary: old hash-confirmed page goal, HubSpot - Lead, Submit lead form - HS - 9/22, Hubspot Lead Submission, Calls from ads, Phone Calls, YouTube channel subscriptions and YouTube follow-on views. Already-removed historical goals were untouched.
- Auto-tagging Yes. Removed the account-level legacy HubSpot `hsa_*` tracking template. Saved and reopened the new final URL suffix: `utm_source=google&utm_medium=cpc&utm_campaign=gads_{campaignid}&utm_content=ad_{creative}&utm_term={keyword}`. Future campaign/ad overrides still require review when new campaigns are built.
- GA4 property `505841395`, stream `12184605870`, measurement ID `G-L2VK5474GD`. Previously approved Ads link saved with auto-tagging on, personalization off and Analytics editing access from Ads off.
- Disabled enhanced history page changes and automatic form, outbound click, site-search and file-download measurement. Manual router views remain the source. Scroll/video engagement unchanged. `generate_lead` created as code-driven key event, no value, once per event. No duplicate GA4-to-Ads import was created.
- Event dimensions created: Liberty form (`form_name`), Liberty journey stage (`journey_stage`).

## Explicit remaining acceptance

1. **Later authorized deployment and live receipts:** this no-publish task cannot prove production collection. After deployment, verify exact SHA, consent reject/grant/revoke, one accepted form and one Google lead receipt, CRM record/owner, replay suppression, no private-route events, and auto-tagged attribution through the accepted intake. No customer data or fake revenue was uploaded to Google during preparation.
2. **Search Console:** Scott's current account has no owned Liberty property. A genuine HTML verification token is prepared in initial HTML/SSR, but unpublished and unverified. Existing owner access or later authorized publication and ownership verification is needed, followed by the GA4 Search Console link and actual sitemap-processing evidence. No ownership, sitemap acceptance or indexing success is claimed.
3. **Offline qualification/won outcomes (superseded finding):** the later continuation implements Google Data Manager delivery and durable qualification/won evidence; see [current handoff](2026-11-20-offline-conversion-handoff.md) for the required Google acknowledgment/authorization and executed checks. No spend connector exists. A developer token alone is insufficient. Exact offline action names, event-time click lineage/consent, authenticated provider credentials, stable deduplication and provider acceptance must be established before upload. Historical review CSV names are not verified account mappings. No invented qualification, appointments or revenue.
4. **Auto-apply (resolved in the continuation):** all 13 formerly enabled types are now disabled through the History controls. Reloaded Manage readback showed 0 of 7 and 0 of 14 selected. Keep auto-apply disabled during setup. All campaigns remain off.
5. **Meta:** deliberately unconfigured; no account, dataset or pixel was invented.
6. **Native browser upload acceptance:** required-field validation/layout were observed; PDF attachment was blocked by the Chrome extension's missing file-URL permission. The user was given the exact extension permission handoff. Do not claim that native upload was completed. Independent real-session HTTP intake tests passed with provider delivery denied.

## Executed evidence

- TypeScript passed; production client/server build passed. Existing Zod annotations, bundle-size and CJS `import.meta` warnings remain visible in logs.
- 108/108 deterministic-static suites passed during implementation. Subsequent focused checks cover final tracker and conversion-export edits; this is not a claim that all repository integration suites or production acceptance passed.
- Final compiled tracker/attribution acceptance: 142 assertions passed. Cookie consent: 8 passed.
- Final disposable real-session HTTP suite: 22 passed. Separate public intake/staff-handoff suite: 415 passed. No provider calls, paid requests, emails or outbound messages during those tests. Pause/epoch and budget records preserved in the fixture.
- Browser desktop 1698px: one form, zero tables, scroll width equals viewport. Earlier 390px mobile acceptance showed no overflow and stacked fields. Final desktop screenshot retained; the final mobile screenshot was discarded because its viewport override did not apply to the intended tab. No unverified final mobile image is delivered.
- `git diff --check` passed. No package/lockfile changes or new application dependencies.

Evidence logs/screenshots are in `/Users/matt/.local/share/liberty-dev/measurement-*.log` and `statement-redesign-desktop.jpg`. Build receipts from a dirty worktree prove build execution, not a releasable source identity; use the post-commit build receipt for the final candidate. Production outbound/cap settings were not mutated; local test preservation does not independently re-attest the current production database state.
