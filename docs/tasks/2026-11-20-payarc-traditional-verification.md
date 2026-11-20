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

No real lead or signature request was submitted. Production partner application permissions are not proven by reporting reads. The named synthetic sandbox round trip still needs working partner access, and webhook verification needs Payarc's signing/registration contract. Owner corrections and dispute-evidence transport need provider contract clarification. Document upload automation is not implemented by this change.

No shared database migration, production activation, publication or sending-policy change was performed. The new migration was exercised only in disposable local databases. Signature/status worker flags remain unenabled in shared environments. Global outbound remains paused; campaigns and Google offline uploads remain off; the Outscraper cap is unchanged at $50.
