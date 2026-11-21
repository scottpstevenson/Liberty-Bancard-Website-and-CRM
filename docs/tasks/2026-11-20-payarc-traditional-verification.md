# Payarc Traditional verification — November 20, 2026

Implementation branch: `codex/payarc-traditional-completion`. This is local implementation evidence, not Payarc certification or proof of live onboarding.

## Implemented

- Documented Traditional lead creation, durable MerchantCode, separate signature dispatch, strict lifecycle decoding and bounded authenticated status reconciliation.
- Revision-bound encrypted preparation, reviewed business/pricing corrections, ambiguous-result holds, per-operation activation checks and CRM preparation/lifecycle controls.
- Existing unauthenticated Payarc webhook ingress now refuses requests without storing them. Authenticated webhook processing still requires Payarc's signing contract; no signing scheme was invented.
- Owner changes are held because the published PATCH Owners schema differs from create. No guessed owner correction is sent.

## Executed checks

- Disposable database + actual CRM HTTP/worker integration: 41 checks passed.
- Existing status-apply certification: 14 checks passed; boarding-worker certification: 76 checks passed.
- Traditional codec/adapter contract checks: 61 passed; reporting regressions: 119 passed; processor kill lines: 18 passed.
- Static checks: 108 passed. Migration checks: 1,057 passed with two historical duplicate-timestamp warnings. CI manifest validation passed.
- Actual BoardingPanel/preparation UI inspected at desktop and 390px mobile widths using a local synthetic backend; no horizontal overflow. No SMTP/provider delivery occurred.
- TypeScript passed. Production build passed for implementation commit `af89ab694976a20d3b64530231cd66838cd69e91` (build ID `796befd3-16b5-44f1-a324-d772d1d5567a`). Dependency inventory and the redacting artifact credential scan passed. Build warnings remain for Zod annotation placement, bundle size, and the existing CommonJS `import.meta` use in email-pre-filter; no runtime verification of that fallback is claimed here.

## Actual provider access

Scott's visible sandbox merchant token matches the privately saved Replit merchant credential and differs from the partner credential. Read-only sandbox checks returned HTTP 200 for charges (empty), webhook subscriptions (empty), disputes (empty), and a populated dispute-chart response with 26 aggregate metrics. Individual dispute mappings and uploads remain unproven.

Matt selected the production partner API after the sandbox PartnerHub sign-in failed. Bounded reads used the existing partner credential against `api.payarc.net`, with environment declarations limited to the individual read processes:

- Residual details for October 2026: HTTP 200, zero records. This proves access to that endpoint, not populated-field mapping or onboarding entitlement.
- Batch reports for November 1–20: HTTP 422, provider reports no merchants attached to the agent account.
- The existing identity probe returned HTTP 422; this is inconclusive and is not evidence that the key is invalid.

Private, redacted receipts remain outside Git under Matt's local Liberty development directory. No keys or provider response bodies are committed.

## Remaining external acceptance

Before the subsequently authorized production draft test below, no real lead or signature request had been submitted. Reporting reads alone did not prove production application permissions. The named synthetic sandbox round trip still needs working partner access, and webhook verification needs Payarc's signing/registration contract. Owner corrections and dispute-evidence transport need provider contract clarification. Document upload automation is not implemented by this change.

No shared database migration, production activation, publication or sending-policy change was performed. The new migration was exercised only in disposable local databases. Signature/status worker flags remain unenabled in shared environments. Global outbound remains paused; campaigns and Google offline uploads remain off; the Outscraper cap is unchanged at $50.

## Production partner follow-up

Matt authorized production permission verification while explicitly prohibiting live applications and publication. Bounded probes on November 20 established:

| Probe | Executed result | What it proves |
| --- | --- | --- |
| GET /v1/agent-hub/sub-agents | 200; data array empty | Authenticated Traditional partner read access; no sub-agents is valid. |
| POST /v1/agent-hub/apply/submit-for-signature, validate=true, generate_form=false, nonexistent reference | 422 with errors.apply_app_id | Authenticated validation route reached. No valid case, signature email or submission was created. |
| Same validation route without authentication | 401 | The production key passes authentication that the control fails. |
| OPTIONS /v1/agent-hub/apply/add-lead | 200, Allow: POST | Route availability only; this does not prove permission to create an application. |

Payarc documents validate=true as checking validation rules without submission. No documented add-lead dry run or permission-introspection endpoint was found. At this permission-only stage, creation and actual signature-delivery entitlement were unconfirmed. A reporting or validation read must not be promoted to onboarding authorization. The later expressly authorized draft test below supplies actual creation evidence; signature delivery remains untested.

The signature worker now performs provider validation before delivery. It binds signature delivery to a keyed fingerprint of the payload actually sent to Payarc, rechecks application review/revision and claim ownership after validation, and rechecks operation activation before sending. A changed application must first go through the explicit correction workflow. Validation rejection and uncertain delivery produce distinct deduplicated CRM tasks. Partner health now uses the documented GET sub-agents endpoint and requires its data array instead of the failing /accounts/me probe.

Release configuration remains unactivated. After separate sync/migration authorization, use PAYARC_PARTNER_KEY_ENVIRONMENT=production with the existing production partner key and production operation-specific snapshot URLs. Keep the verified merchant credential declared sandbox and routed to its separate sandbox host. Keep PAYARC_SIGNATURE_ENABLED=false and PAYARC_STATUS_SYNC_ENABLED=false until the relevant operation authority and acceptance are recorded. Never infer write entitlement from these receipts or enable historical bulk sending.

Follow-up checks passed: 70 codec/adapter checks, 55 actual HTTP/worker workflow checks in a disposable database, 14 status-apply checks, 76 boarding-worker checks, 119 reporting checks, 1,057 migration checks (the same two historical warnings), processor kill lines and the 319-suite manifest. Workflow coverage includes provider validation rejection, no duplicate lead creation, changed payloads after lead creation, application revision changes during validation, revocation during validation and ambiguous signature delivery. The additive migration has still not been applied to a shared database.

Final TypeScript, production build, dependency inventory and redacting artifact scan passed for code commit `9e995028b098eaf88b44f51b13da4e1c1eafade8`; build ID `ac652146-e734-430c-907d-5779ef9224dc`. Existing build warnings described above remain. This follow-up is committed locally on the same branch; no main push, Replit source sync, shared migration or publication occurred.

Fresh Replit workspace readback: outbound paused at epoch 750; no stored budget override and the existing $50 default; Google offline uploads false; Payarc signature dispatch and status-sync flags false. No settings were written by these reads.

References: https://docs.payarc.net/reference/submit-for-signature-traditional and https://docs.payarc.net/reference/list-sub-agents.

## User-authorized synthetic production draft

Matt subsequently selected: "One synthetic production application; no signature or underwriting submission." The operation ran November 20, 2026 at 7:27 PM America/New_York (November 21 UTC), using the actual committed adapter from source `2a8b3fc2` in an isolated, checksum-verified operator bundle on Replit. The existing application source, environment settings and databases were not deployed or migrated for this test. No credential left Replit.

- Initial create attempt with a long TEST ONLY label returned definite HTTP 422, flagging name and MerchantLegalName, with no MerchantCode. The receipt did not capture the field-message text, so no exact maximum length is asserted.
- One controlled correction shortened the label to `TEST ONLY LIBERTY 1120`. Payarc returned HTTP 200 and MerchantCode `vajm67vrropgbxrl`.
- An immediate authenticated lead-status read returned HTTP 200, echoed that MerchantCode and decoded Status 0 / lead_created (draft).
- Two create calls total: one rejected, one accepted. Exactly one provider draft was created. Each attempt had an exclusive durable dispatch marker; no automatic retry or replay was performed.
- Synthetic names/address, reserved fictional phone and zero-filled invalid tax, SSN and bank identifiers were used. No actual person's identity or financial account was supplied. The business summary explicitly says TEST ONLY / DO NOT UNDERWRITE / DO NOT SEND SIGNATURES.
- The operator transport allowed add-lead and one status read only. It had no signature, document, transaction or underwriting transport. No signature request or underwriting submission was sent.

This proves real production partner lead-creation and status-read access through the current adapter. It does not prove signature delivery, underwriting acceptance or the deployed CRM worker/UI flow: that branch and its migration are still local/unpublished. Keep this draft as the single test case; do not recreate it. Signature actions remain prohibited under this authorization.

## Subsequent authorized signature-email test — actual delivery and contract discrepancies

Matt subsequently authorized testing the signature email for the same draft at scott@libertybancard.com, explicitly forbidding signing, underwriting submission and publication. This supersedes the earlier no-signature boundary only for this named test.

Production evidence on November 20, 2026:

1. Lead-status returned Status 0 / draft. A call with the documented `validate:true, generate_form:false` returned 200 and the correct MerchantCode. However, a Payarc merchant-application/signature invitation subsequently appeared in Scott's inbox at **7:41 PM**, addressed to the draft's original scott+1@libertybancard.com. The application changed to Status 1. **The observed production behavior contradicts the assumption that this call is side-effect-free. Do not use it as a dry-run or permission probe.** Existing simulated validation tests do not establish the provider's actual behavior.
2. Production PartnerHub was already authenticated as Scott Stevenson. Its owner editor allowed changing the synthetic signer's email to scott@libertybancard.com; Save Owner completed. The Merchant Contact Email field was read-only in the UI, so it was not saved through that field. No signing page, agreement acceptance or underwriting action was opened.
3. A further status read returned `Status:1`, `LeadStatus:submitted_to_boarding`, `LeadModule:application`, no AccountCode and no MID. `submitted_to_boarding` is absent from the inspected public Lead Status contract and is rejected by the strict current decoder. The initial delivery runner stopped before any PATCH or send for that reason. This mismatch must be reconciled before automatic status processing is enabled; do not translate the phrase into underwriting approval.
4. A narrowly bounded operator correction updated the existing lead's ContactEmail to scott@libertybancard.com through the actual adapter (HTTP 200), retaining the synthetic identity and invalid zero-filled identifiers. No new lead was created. One explicit `validate:false, generate_form:false` signature request then returned HTTP 200 and the same MerchantCode. No further validation-only call was made.
5. Gmail's scott@libertybancard.com session showed the second invitation at **7:49 PM**. Expanded message headers confirmed sender `Payarc <support@payarc.net>`, recipient **scott@libertybancard.com**, subject `TEST ONLY LIBERTY 1120, please complete your Merchant Application.`, mailed-by and signed-by mail.payarc.net. The body invites an e-signature. The signing link was not opened, signed, forwarded or committed.
6. Immediate post-send status remained Status 1, module application, no AccountCode/MID. No underwriting-submission endpoint was called. The application remains unsigned. Two invitations exist: the unexpected validation-triggered one to the original plus alias and the explicit test to the exact requested address. Do not resend either automatically.

This confirms production signature endpoint acceptance and real inbox delivery for the named synthetic case. It does **not** certify the automatic CRM workflow: its current validation preflight is unsafe against observed production behavior, and its strict decoder holds the new lead status. Both are outstanding implementation issues. Automatic signature/status flags remain off, so these issues are contained; no activation, main push, shared migration, Replit source sync or publication occurred during this test.

Readback after the test: Replit workspace outbound remained paused at epoch 750; effective Outscraper cap $50; Google offline uploads false; Payarc automatic signature dispatch and status-sync flags false. Private operator receipts contain no keys and remain outside Git. The SSH home had been recreated since the prior test, so the original acceptance journal was recovered from the retained local evidence rather than assuming its remote files survived.
