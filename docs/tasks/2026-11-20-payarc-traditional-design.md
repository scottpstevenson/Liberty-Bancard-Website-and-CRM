# Payarc Traditional completion — proposed design

Date: November 20, 2026. Source: `/Users/matt/Developer/liberty-launch-readiness-fixes`, base `550c9e127d9edaab2c89c37a411938c542314a90`, branch `codex/payarc-traditional-completion`. Proposal for Matt's review; no implementation or live activation is claimed.

## Objective and boundaries

Complete Liberty's reviewed merchant application → Payarc Traditional lead → signature → underwriting → boarded/MID workflow, with durable case identity, observable recovery and real sandbox evidence. Preserve existing Intake Center work and protected merchant-data, role, CSRF, review and activation authority. Keep global outbound paused, campaigns and Google offline uploads off, and the Outscraper cap at $50. No publication, production migration, real merchant submission, transaction, live contract signing, new access grant or provider message is authorized by this implementation. A sandbox signature request is a transactional provider action, not permission for cold outreach.

## Current independently inspected facts

- Main and Replit source were synced to base 550c9e12; both Payarc adapter and boarding route contents matched at the preceding audit. Recheck freshness before implementation and remote action.
- Current Traditional adapter uses POST `/applications`, GET/PATCH `/applications/:id`, flattened snake-case payloads and object_id/id responses. Its code maps active and approved to one approved state.
- Official Traditional references instead specify POST `/agent-hub/apply/add-lead`, PATCH `/agent-hub/apply/lead/{MerchantCode}/`, POST `/agent-hub/apply/submit-for-signature`, and POST `/agent-hub/apply/lead-status`. Lead and Owners have structured schemas; MerchantCode identifies the application. Status, LeadStatus, LeadModule, LeadCode, AccountCode, AccountMID and AccountStatus have distinct meanings.
- Existing outbox has claim fencing, pre-dispatch review checks, ambiguous outcome holds and transactional local settlement. Preserve these guarantees through every new provider step.
- Webhook route currently records bounded object payloads, acknowledges 200 and never changes canonical status. No signature verifier exists. Manual refresh owns status application; no recurring provider status reconciliation was found.
- Workspace DB at prior read: no boarding outbox attempts, no provider IDs on deals, no webhook events; snapshots authorize sandbox reporting reads only. This is not production evidence. Credential variables exist but were not freshly authenticated or environment-bound. The default API URL is production while read snapshots are sandbox.
- Browser verification subsequently established access to Test Merchant at testdashboard.payarc.net, merchant email scott+1@libertybancard.com, assigned MID and an existing active token. Merchant webhook list is empty. PartnerHub earlier showed Scott's email and partner 000703 but application authorization errors. Merchant access does not prove PartnerHub API entitlements.
- Existing 67 codec and 119 reporting checks pass with simulated transports; their old onboarding fixtures do not certify the documented API.

## Approaches considered

1. Recommended: durable multi-step workflow with persisted MerchantCode and step receipts, authenticated polling as status authority, optional verified webhook hints. More work than a URL replacement; handles partial success and maintains case continuity.
2. Replace adapter URLs inside the existing single-call submission. Smaller diff, but local failure between lead creation and signature request can duplicate a lead or lose recovery identity. Rejected.
3. Keep manual PartnerHub onboarding and import results. Short-term operational fallback; does not fulfill automated CRM onboarding. Retain as a clearly labelled fallback, not the build target.

## Data and transport design

Add a versioned Payarc lifecycle owner keyed to the existing deal and merchant application revision, explicit environment, program, and stable attempt identity. Store MerchantCode immediately after lead creation; distinguish provider lead/account identifiers from MID. Existing processorApplicationId remains a compatible projection, with a recorded contract version so old IDs are never silently reinterpreted as MerchantCode. Existing unknown legacy IDs enter reconciliation instead of being auto-resubmitted.

Use separate durable commands/receipts for create/update lead and request signature. Commit each outcome under a claim fence before a later step is dispatched. Known MerchantCode prevents another add-lead. Network loss or a crash after dispatch is uncertain and requires reconciliation, not a blind retry; do not assert Payarc supports an idempotency header without provider proof. Definite validation errors retain the lead and expose safe field names/codes for correction. Resend or regeneration is explicit and versioned. No raw tax IDs, bank details, provider bodies or bearer URLs in ordinary logs, tasks or notifications. Encrypt/protect signing links and restrict access; browser return_url parameters are hints, never proof of signature.

Implement complete typed Lead, Owners/BeneficialOwners, reviewed pricing, questionnaire and document mapping from current protected application owners. Missing required information blocks the specific step with actionable field requirements; never invent ownership, percentages, pricing, account data or processor IDs. Validate document formats/limits against Payarc's referenced contract before transmission. Keep current review/readiness fencing and authorized-purpose decryption.

## Lifecycle and case UI

Preserve raw bounded provider status fields alongside normalized display state. Distinguish lead created, awaiting signature, signed, submitted to underwriting, documents needed, declined, boarded/MID assigned, processing-ready, suspended/closed and reconciliation required. Stage/module context matters: an approved value within one module does not by itself mean fully boarded or processing-ready. Require provider-correlated AccountMID for MID assignment; AccountCode/LeadCode are never MIDs. Unknown fields/states produce a visible held observation, not an invented state. Preserve evidence and current ownership/review boundaries on out-of-order or stale observations.

Expose lifecycle progress, last successful synchronization, next retry, safe failure, provider identifiers under existing permissions, and explicit allowed next actions in the existing BoardingPanel/case workspace. Preserve the new Intake Center and links; no second intake inbox or unrelated CRM redesign. Staff tasks/CRM alerts are idempotent by failure/transition episode. Existing email delivery policy remains authoritative; do not introduce a new global sending bypass.

## Synchronization and webhook contract

Extract shared status observation/application service from the HTTP route, preserving transaction fencing and downstream MID/underwriting effects. Manual refresh and a bounded recurring cloud worker call this same owner. Poll only known, contract-versioned applications with the correct per-operation activation snapshot and verified credential environment. Use durable leases, bounded batches, rate limits/backoff, stale-health reporting and idempotent transition effects. Runs independently of the user's Mac and paused cold outreach; enabling this worker never authorizes application creation.

Payarc's public webhook page lists events and instructs partners to arrange registration with implementations support, but the inspected page contains no cryptographic signing contract. Do not invent HMAC headers/algorithms or label a shared local fixture provider-certified. Implement authenticated verification only against an actual documented/provider-supplied delivery contract and authentic signed fixture; unknown/unconfigured authentication stays disabled. Bound requests and reject unauthenticated deliveries before durable work; dedupe authenticated events, correlate to environment/case and enqueue a provider status read. Webhooks do not directly approve/board a merchant. Authenticated polling remains operational if webhook certification/registration is unavailable. Report this provider dependency separately from completed polling; do not claim end-to-end webhook acceptance until proven.

## Configuration and sandbox verification

First reconcile partner and merchant credential provenance privately, without revealing or rotating tokens. Bind each to its known sandbox environment and test only documented bounded identity/reporting reads with the matching key class. Record redacted HTTP/schema/count receipts, distinguishing denied entitlement, empty result and populated contract success. Do not send an environment-unknown credential to alternate hosts to guess its origin.

Sandbox boarding gets separate explicit operation authority and is restricted to one named synthetic test case. No broad production or existing-customer activation. Proposed synthetic case: `Liberty Payarc Sandbox Acceptance 2026-11-20`, email scott+1@libertybancard.com, sandbox-issued test identity/bank fixtures only. Reuse an appropriate existing test MerchantCode when available instead of creating a duplicate. Confirm any provider-required test values and correct parent account before a mutating request. Exercise validation, signature request, status return, correction/retry and restart recovery. The user completes any signature/account approval required by the platform. Never sign a merchant agreement on their behalf. Provider-controlled underwriting transitions that cannot be triggered by the test are reported unverified and covered separately by fixtures.

Inspect the dispute-evidence contract and implement a case-bound, reviewed, protected document-upload path only if its actual multipart schema and sandbox entitlement can be verified. It must target an existing provider case and preserve explicit user approval; no new chargeback creation. If the provider cannot supply an eligible synthetic dispute, complete local contract/authorization coverage and identify the exact missing live evidence rather than simulate certification.

## Required validation and rollout evidence

Use sanitized official-contract fixtures and real exported transport code; update tests that currently assert the obsolete /applications flow. Register new suites in canonical manifests. Cover add-lead success then local crash; signature timeout; known MerchantCode reuse; ambiguous create; validation corrections; status numeric/bit values and module context; multi-owner signature; mismatched identities/environment; duplicate/out-of-order webhooks; forged signatures/replays; stale claims; worker concurrency/restart; revoked activation; roles/CSRF/protected links; no provider egress during deterministic tests; task dedupe and pause/cap preservation.

Run TypeScript, production build, migration integrity, manifest parity, affected deterministic suites and real disposable PostgreSQL/Redis worker/route tests. Inspect the actual BoardingPanel on desktop/mobile with synthetic records. Keep fixture acceptance, real sandbox receipts, production availability and provider certification as separate conclusions. New migrations are additive and have no automatic backfill, production activation or historical signature sending.

Keep all implementation on this branch. Do not push to main, sync Replit, apply shared migrations, change production settings or publish without subsequent authorization. Sandbox-only configuration/operation activation within this approved design may proceed after exact target/credential/fixture checks; provider permission/terms confirmations remain with Matt.

## Source references

- https://docs.payarc.net/docs/apply-wizard-traditional
- https://docs.payarc.net/reference/add-traditional-lead
- https://docs.payarc.net/reference/patch-traditional-lead
- https://docs.payarc.net/reference/submit-for-signature-traditional
- https://docs.payarc.net/reference/lead-status
- https://docs.payarc.net/reference/add-documents
- https://docs.payarc.net/reference/webhook
- https://docs.payarc.net/docs/api-authentication

## Preparation checklist

- [x] Inspect current source, branch, SHA, remote state and affected owners.
- [x] Compare alternatives and define recommended durable workflow.
- [x] Review proposal for invented contracts, permission changes and ambiguous acceptance claims.
- [ ] Matt reviews this written design.
- [ ] Prepare implementation plan and execute after design approval.
