# Payarc Traditional implementation plan

Matt approved the proposed design and named sandbox testing on November 20, 2026. Branch: codex/payarc-traditional-completion. No publish, live applications, production activation or global sending changes.

1. Capture official request/response schemas and implement a dependency-free Traditional codec. Preserve the reporting interface and explicitly reject unsupported program/legacy onboarding contracts.
2. Add additive durable lifecycle and per-step attempt persistence. Lead creation commits MerchantCode before any signature dispatch. Retain current review, linkage and claim fencing. Ambiguous outcomes hold; no blind retry.
3. Add a separate signature step and shared status observation owner, plus bounded periodic status reconciliation independent of outbound sending. Explicit per-operation sandbox authorization remains required.
4. Extend existing webhook ingress with authenticated-contract admission and replay controls only when a verified Payarc contract is available; otherwise fail closed and rely on polling. Do not invent cryptography.
5. Expose actual lifecycle/synchronization and next actions in current case UI. Preserve protected-link access, role and CSRF rules.
6. Reconcile sandbox credentials with private redacted read receipts. Exercise a named synthetic case only after environment, fixture and partner authority are verified. Inspect dispute-evidence multipart contract and integrate only provider-confirmed case-bound behavior.
7. Run focused codec, HTTP, disposable database/worker, TypeScript, migration, manifest, static and production build checks. Keep local simulated results distinct from real sandbox and provider certification.

The writing-plans skill referenced by brainstorming is not installed in either available skill root; this explicit implementation plan follows the approved design directly without installing new tools or adding another approval stage.
