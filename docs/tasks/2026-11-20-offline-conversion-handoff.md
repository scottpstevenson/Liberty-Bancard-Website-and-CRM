# Liberty offline conversion handoff

November 20, 2026. Work is on `codex/launch-readiness-fixes`; no GitHub push, Replit sync, publication or production migration has been performed. No campaign was enabled, no outbound control was changed, and the $50 Outscraper policy was not modified. Google uploads are off by default and were not enabled in a live environment.

## Implemented source

Google Data Manager v1 is the delivery owner for new offline measurement. Google now directs new integrations to that API; this implementation does not depend on grandfathered Google Ads upload access or a developer-token-only flag. Official contracts:

- [Offline conversion workflow](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline)
- [Event ingestion](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest)
- [Asynchronous status](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve)
- [Authorization](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access)

The new additive migration `0395_google_offline_conversions.sql` creates encrypted occurrence attribution, anonymous revocation tombstones and a durable conversion outbox. It adds no historical backfill, modifies no existing budget or messaging policy, and creates no native trigger/function requiring a separate startup owner. Migration/Drizzle constraints are aligned, including a short explicit attribution foreign-key name.

An accepted website intake can capture GCLID, GBRAID and WBRAID only with a separately versioned Google campaign-outcome preference and an unguessable first-party revocation capability. Existing marketing consent is not silently expanded: old marketing visitors are shown the new preference, initially ungranted. Marketing and the new outcome-sharing preference must both be enabled. No email, phone, name, document content, IP address, estimated processing volume or fabricated revenue enters a Google payload. Browser `ad_user_data` and personalization settings remain unchanged; the new server-side click-sharing permission is specific to this explicitly described preference. Anonymous revocations are idempotent, retained and retried; rapid consent changes retain all pending revocation capabilities. Revocation blocks future dispatch. An already dispatched request is not falsely reported as recalled.

Attribution is encrypted and pinned to the accepted inbound request and the deal's own request/contact linkage, not read from a later mutable contact GCLID. Production classification and accepted-request checks remain in force. Normal valid intake is never rejected because measurement encryption/capture is unavailable; that failure is logged and no unproven offline attribution is manufactured.

A qualified-lead outcome requires an explicit administrator/manager staff review command with the exact current deal stage and a reason. It records measurement evidence without moving the CRM deal or granting email/SMS permission. Enrichment scores, address verification and channel eligibility cannot automatically qualify a sales lead. Closed Won is reconciled from the existing append-only canonical `deal_transition` evidence. Browser analytics events cannot supply either authority. Repeated commands, reconciliation and reopening/closing a deal do not duplicate the outcome.

One event per Google request preserves per-event diagnostics. Atomic claims, claim fencing and a stable transaction ID prevent concurrent duplicate dispatch. The destination/action is frozen when validated or dispatched. Validation never claims ingestion or consumes a send attempt. Accepted-for-processing, processing success, processing warnings, failure, uncertain delivery and revocation are separate retained states. A socket loss, expired dispatch lease or provider 5xx is uncertain and is not automatically resent. Explicit rate-limit rejection backs off with a five-attempt cap. A failed/interrupted status poll retains the original request ID and resumes polling without uploading again. Processing success is not represented as click matching or campaign attribution.

## Actual operator entry

Reports / Sales & Growth / Conversion Funnel:
`/dashboard/reporting?tab=growth&growthView=conversion-funnel`

The Google CRM outcome panel exposes configuration presence, uploads off/on, persisted state counts, bounded validation/processing commands, staff qualification and retained provider states. The retired acquisition route redirects elsewhere, so the new controls are mounted in the current reporting owner. These commands operate on the account-wide eligible pending outbox; report cohort filters do not select an upload batch. The legacy review CSV remains separate and is not the automated source.

Endpoints:

- `GET /api/acquisition/offline-conversions/status` — administrator/manager, no click IDs or capabilities returned.
- `POST /api/acquisition/offline-conversions/qualify` — administrator/manager, explicit reviewed qualification and stale-stage protection.
- `POST /api/acquisition/offline-conversions/process` — administrator only, explicit validation or send command; send still requires server opt-in.
- `POST /api/public/ads-measurement/revoke` — bounded first-party revocation capability only, idempotent and rate-limited.

`GOOGLE_OFFLINE_UPLOAD_ENABLED=true` opts into the dedicated non-sending measurement worker. It does not select outreach, change the global pause, enable campaigns or alter budgets. Keep it unset/off during this no-publish setup. The job is classified in the logical job manifest as external data synchronization that can run while customer outbound remains paused.

## Google changes actually verified

All 13 formerly enabled auto-apply recommendation types were disabled through their persisted History status controls. Google showed "Auto-apply preferences updated." After a full reload and return to Manage, the account showed **0 of 7 Maintain your ads** and **0 of 14 Grow your business**, with the no-ads-running banner still present. The earlier Manage-checkbox changes had not persisted; that issue is now resolved. Evidence: `/Users/matt/.local/share/liberty-dev/measurement-auto-apply-disabled.jpg`.

## Required external handoff, not missing implementation

Two specific Google steps are pending the user:

1. **Google customer-data acknowledgment.** Creating the offline actions requires affirming compliance with Google's EU user consent and Customer data policies. This has not been checked or accepted by the agent. The action-time confirmation question is pending, and the Ads dialog is retained. Once confirmed, create and verify `Liberty CRM - Qualified Lead` and `Liberty CRM - Closed Won` as Website (Import from clicks) / `UPLOAD_CLICKS`, Count One, no default monetary value, Secondary during setup. Do not repurpose the browser saved-lead action or old HubSpot actions. Record the actual numeric IDs; none is invented.
2. **Cloud passkey and project authorization.** The Cloud tab is signed to `scott@libertybancard.com` but is stopped at Google's passkey verification. The user must complete that verification and identify the Liberty-owned project. Then enable/verify Data Manager API and authorize a supported credential with `https://www.googleapis.com/auth/datamanager`; any material account grant or policy acceptance requires its specific user confirmation. No browser auth caches, Gmail tokens or another project's credentials are reused.

After those steps, install the authorized secret via the normal secret-management path without printing it, set the verified action IDs below, and perform validate-only preflight with the actual authorized account. A valid token or a 200 ingestion acknowledgment alone is not final processing/matching proof. Publication, migration and real forward conversion acceptance remain separately authorized steps; they were prohibited in this task. No synthetic conversion was uploaded to Google.

## Server configuration

| Setting | Purpose |
| --- | --- |
| `GOOGLE_OFFLINE_CREDENTIALS_JSON` | Private supported Google `authorized_user` or `service_account` credential JSON; keep in secrets, never source/logs. Google Cloud API and Ads account access must be authorized. |
| `GOOGLE_OFFLINE_QUALIFIED_ACTION_ID` | Actual verified numeric Qualified Lead offline action in customer `3455118578`. |
| `GOOGLE_OFFLINE_WON_ACTION_ID` | Actual verified numeric Closed Won offline action in that same customer. |
| `CREDENTIAL_ENCRYPTION_KEY` | Existing authenticated encryption owner for retained click identifiers. |
| `GOOGLE_OFFLINE_UPLOAD_ENABLED` | Defaults off. Explicit future opt-in for this measurement worker only. |

The Google Ads customer is fixed to Liberty `3455118578`; no cross-account destination is accepted. Neither setting these values nor compiling the client enables campaigns or outbound.

## Executed acceptance

- Dedicated disposable offline suite: 49 checks passed, using actual PostgreSQL migrations, public intake, Passport/CSRF sessions and qualification routes; fake Google transport plus the real HTTP adapter contract. Covers encryption, immutable GCLID/braid lineage, concurrent claims/commands, validation isolation, stable deduplication, canonical Closed Won recovery, consent revocation/tombstones, status diagnostics, network-loss/5xx uncertainty, bounded 429 retries, interrupted polling, role restrictions and pause/budget preservation.
- Existing launch-readiness HTTP: 22 passed. Existing public intake/staff handoff: 415 passed. All three ran on separate disposable databases with provider denial. No real provider calls, paid requests or queued/sent outbound messages.
- Compiled client consent/attribution acceptance: 147 passed. Cookie consent: 8 passed. Deterministic-static roster: 108/108 passed after documenting the capability-authenticated public revocation call for the CSRF scanner. TypeScript and suite-manifest registration passed. Final build logs are retained under `/Users/matt/.local/share/liberty-dev/offline-*.log`; consult the completion receipt for their exact final results.
- Native browser: synthetic administrator opened the actual reporting route; status truthfully showed uploads off and missing Google configuration, processing buttons disabled; a nonexistent deal was rejected without creating qualification; reload retained the expected state. Evidence: `/Users/matt/.local/share/liberty-dev/offline-crm-controls.jpg`. This was a local synthetic environment, not a production or Google ingestion receipt.

No full-roster release approval or live Google acceptance is claimed. Complete the two explicit Google handoffs before claiming that the account connection is configured.
