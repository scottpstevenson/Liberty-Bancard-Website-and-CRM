# SendGrid feedback and observed coverage

The owner confirmed SendGrid in chat. This branch implements its Event Webhook adapter and forward observation owner. No SendGrid account was connected, queried or changed during implementation; provider responses and signatures in certification are disposable fixtures. No mailbox was opened or historical messages replayed.

## Runtime prerequisites

Configure these through the existing runtime secret/configuration owner, never repository files:

| Setting | Contract |
|---|---|
| `PHASE7_MEASUREMENT_ENABLED` | Defaults off. Explicit `true` starts only the non-sending measurement owner at a 60-second cadence; it grants no sending, enrollment, pause-release or content approval. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Actual SendGrid transport (`smtp.sendgrid.net`, `apikey`, existing SendGrid SMTP key). The key ID is checked against the account registry; secrets are never retained in evidence. |
| `SENDGRID_API_KEY` | Runtime key with read access to Event Webhook settings/signing-key metadata and API-key metadata. Only fixed-host GET requests are issued; no settings or keys are created or changed. |
| `SENDGRID_EVENT_WEBHOOK_ID` | The exact Event Webhook ID under that account. |
| `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` | Its ECDSA P-256 public verification key, DER/base64 or PEM. This is a public key, not a private key. |
| `CRO07_SEQUENCE_FEEDBACK_SOURCE` | `sendgrid`. |
| `CRO07_SEQUENCE_FEEDBACK_ACCOUNT` | Exact frozen cold-outreach From account. |
| `APP_URL` | Intended HTTPS origin. The checked callback is `/api/webhooks/cro07/sendgrid` on this origin. |
| Existing Gmail reader | Actual reply mailbox must be active, authenticated, fully caught up, error-free and successful within five minutes. Opening/resyncing creates a new generation. This branch does not open it. |

Required Event Webhook flags are `processed`, `delivered`, `bounce`, `spam_report`, `unsubscribe`, `group_unsubscribe`, and `dropped`. The owner verifies the settings and signed-key endpoints, the configured public-key identity and the SMTP key ID's `mail.send` scope under the same account. API credentials with insufficient read scope produce a hold, not a successful probe.

## Authorities and limits

`phase7-sendgrid-contract.ts` verifies SHA-256/ECDSA over the original timestamp plus raw request bytes, following SendGrid's official SDK contract. Payloads are bounded to 1 MiB and 1,000 events. The timestamp window permits SendGrid's 24-hour retry period, while immutable event IDs and payload hashes refuse conflicting replay. No browser session or CSRF token substitutes for the provider signature.

`smtp-id` links to the accepted SMTP receipt. Where a later event omits it, a prior signed event must establish the exact SendGrid message ID, sender account, recipient and original SMTP ID. IDs are never shortened and no nearest-address/time matching supplies attribution. Provider times have one-second resolution and must follow the immutable pre-dispatch envelope within that precision. Unsupported, blocked, temporary, malformed and unmatched events stay retained; blocked/temporary DSNs are not hard bounces. Unresolved possible safety events hold evaluation. Receipt repair replays only retained signed observations after accepted-receipt projection; it never re-reads historical mail or resends a message.

Health observations are append-only and use database time. Each captures verified public configuration hashes, SMTP key-ID hash, reader generation and successful fully drained cursor evidence. A recent healthy observation is required before collection and final dispatch. Sender account, reply account and sanitized display name are frozen; the exact composed From header is hashed immediately before SMTP transport.

Complete measurement also requires exact signed SendGrid delivery or hard-bounce evidence for every accepted exposure; an enabled subscription with missing receipt events is insufficient. Complete measurement is evaluated per experiment, from a healthy observation before collection through outcome maturity plus the fixed 24-hour SendGrid retry grace. Consecutive probe gaps may not exceed ten minutes; an unhealthy observation, setting/key/reader-generation change or unresolved safety evidence breaks completeness. A probe observed today never certifies earlier history. There is no admin complete toggle or manual sample input. Observed health is a sampling contract, not proof that no provider incident occurred between probes; the report retains that limit.

`GET /api/admin/cro07/phase7/feedback-status` is admin-only, read-only and makes no provider call. The Reports view displays this current readiness separately from full experiment measurement coverage. Qualified business replies still require the existing authenticated mailbox lineage and durable human qualification.

## Provider contract references

- [Official SendGrid Node Event Webhook signature implementation](https://github.com/sendgrid/sendgrid-nodejs/blob/main/packages/eventwebhook/src/eventwebhook.js)
- [Twilio SendGrid API-key metadata contract](https://github.com/twilio/sendgrid-oai/blob/main/spec/json/tsg_api_keys_v3.json): GET the SMTP key ID under the same account and verify `mail.send` scope.
- [Twilio SendGrid official webhook OpenAPI](https://github.com/twilio/sendgrid-oai/blob/main/spec/json/tsg_webhooks_v3.json): GET settings by ID and GET signed-key metadata by ID.
- [SendGrid Event Webhook reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event): event fields, message IDs, event types and retry semantics.

Local tests use generated signing keys and injected provider reads. Live API scopes, subscription delivery, configured SMTP identity, connected mailbox continuity and elapsed experiment coverage still require authorized runtime readback after publication.
