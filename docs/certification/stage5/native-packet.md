# Stage 5 protected native packet (PREPARED — NOT EXECUTED)

Updated 2026-11-04 after the published-source audit. Nothing here was run. It is for the owner/operator after the corrected Stage 5 code is published. Do not run anything below against production without owner approval. This packet is not native acceptance.

Preconditions: global and channel outbound pauses stay on (epoch 1); outgoing GHL stays disabled (epoch 16, permissions enabled); incoming GHL stays enabled. No provider traffic is part of this packet. No form submission, MID edit, snapshot write, send, booking, backfill, reclassification or native enablement is part of it either.

## A. Read-only checks (production, read-only role; report counts only, never MIDs or personal data)

1. Boarding rows that may have been written by the old worker:
   `SELECT status, count(*) FROM deal_boarding_outbox GROUP BY 1;` and `SELECT boarding_status, count(*) FROM deals WHERE boarding_status IS NOT NULL GROUP BY 1;`
2. Deals marked `delivered`/`submitted` while the outbox row is `dead_letter` (ambiguous-then-delivered drift):
   `SELECT d.id FROM deals d JOIN deal_boarding_outbox o ON o.deal_id = d.id WHERE o.status = 'dead_letter' AND d.boarding_status IN ('submitted','approved');`
3. **Ambiguity conservation (extended).** Held/ambiguous rows must stay held, and neither a delivered outbox row nor an ambiguous deal may have been overwritten by a later status:
   - Outbox rows that are `delivered` while another outbox row for the same deal is `ambiguous_reconciliation_required`:
     `SELECT o.deal_id FROM deal_boarding_outbox o JOIN deal_boarding_outbox a ON a.deal_id = o.deal_id AND a.id <> o.id WHERE o.status = 'delivered' AND a.status = 'ambiguous_reconciliation_required';`
   - Deals whose `boarding_status` is no longer `ambiguous_reconciliation_required` although an outbox row for them still is:
     `SELECT d.id FROM deals d JOIN deal_boarding_outbox o ON o.deal_id = d.id WHERE o.status = 'ambiguous_reconciliation_required' AND d.boarding_status IS DISTINCT FROM 'ambiguous_reconciliation_required';`
   - Deals that are `ambiguous_reconciliation_required` and also carry a later `submitted`/`approved`/`declined` observation in `boarding_log`: inspect the count only.
   Expected: zero rows for each. Any row is reported to the owner and is not repaired by this packet.
4. Duplicate canonical MID rows per deal. Multiple MIDs per deal are now allowed; this query only sizes how many deals have more than one:
   `SELECT deal_id, count(*) FROM merchant_mids WHERE deal_id IS NOT NULL AND status <> 'closed' GROUP BY 1 HAVING count(*) > 1;`
5. Alias drift (deals.mid is only a primary alias): `SELECT d.id FROM deals d WHERE d.mid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM merchant_mids m WHERE m.deal_id = d.id AND m.mid = d.mid AND m.status <> 'closed');`
6. Idempotency keys bound to more than one deal: `SELECT idempotency_key FROM deal_boarding_outbox GROUP BY 1 HAVING count(DISTINCT deal_id) > 1;` (expected zero).
7. **Existing activation snapshots with a base URL that no longer validates** (stored without `/v1`, or a non-Payarc host). The transport gate now fails closed on these with `ACTIVATION_SNAPSHOT_URL_INVALID`:
   `SELECT id, status, authorized_base_url FROM processor_activation_snapshots WHERE processor_name = 'payarc' AND authorized_base_url NOT IN ('https://testapi.payarc.net/v1','https://api.payarc.net/v1');`
   (The URL is not secret; do not print any credential column.)
8. Boarding policy matrix state: `SELECT value->>'version', value->>'recordedAt' FROM system_settings WHERE key = 'boarding.policy.matrix.v1';` (no row = unrecorded; readiness reports `policy_unresolved` and submission fails closed).
9. Legacy actor limit (migration `0380`): `SELECT count(*) FILTER (WHERE created_by IS NULL) AS no_creator, count(*) FILTER (WHERE updated_by IS NULL) AS no_updater, count(*) FROM underwriting_conditions;` — see section D.

## B. Prepared protected operation (do not run until the owner approves each step)

Purpose: replace a snapshot whose URL no longer validates with a correct one, without any provider call.

1. **Operation (owner, through the admin route only):** `POST /api/admin/processor-activation-snapshots` (login + CSRF) with `authorizedBaseUrl` exactly `https://testapi.payarc.net/v1` (sandbox) or `https://api.payarc.net/v1` (production), the supported operations the owner intends, and the matching entitlement. The route refuses any other host, scheme, port, userinfo, query, fragment or path. Snapshots are append-only: the new row supersedes the old one; the old row is not edited.
2. **Readback (read-only):** `SELECT id, status, authorized_base_url, supported_operations, created_at FROM processor_activation_snapshots WHERE processor_name = 'payarc' ORDER BY created_at DESC, id DESC LIMIT 3;` Expect the new row first with the exact URL. Then `GET /api/admin/processor-activation-snapshots` (admin) shows the same rows through the application; neither read calls the provider.
3. **Cleanup / rollback:** if the new snapshot is wrong, the owner records another snapshot with the corrected URL (or marks the newest row expired/held with `PATCH /api/admin/processor-activation-snapshots/:id/expire`). Never delete rows. No boarding submission is made during this packet, so there is nothing to unwind in `deal_boarding_outbox`.

Existing production snapshots written without `/v1` now fail closed. Preparing this correction is not executing it: the snapshot has not been replaced and the gate state in production has not been verified.

## C. Owner decisions needed before any write

- **Boarding policy matrix (`boarding.policy.matrix.v1`).** Code fails closed until the owner records it. Proposed shape for review (not recorded anywhere): `{ "version": "<owner version>", "recordedBy": "<owner>", "recordedAt": "<ISO time>", "programs": { "<exact preferred_program value>": { "requiredDocuments": ["<document type>", …], "esignRequired": true|false } } }`. Open questions: the list of program names, which document types each requires (for example a voided check or processing statements), and whether a signed agreement is required before boarding. Until recorded, readiness reports `policy_unresolved:*`, the panel says requirements are not yet recorded, and submission is refused at enqueue and at dispatch.
- Whether to add a one-active-MID-per-deal rule. Not recommended now: multiple MIDs per deal are supported and the registry is one row per deal.
- Whether alias-drift rows (query 5) are reconciled and by whom.
- Who triggers the snapshot correction in section B.

## D. Known limit — migration 0380 legacy actors

Before `0380`, `underwriting_conditions.created_by` / `updated_by` were integer columns while user ids are strings, so no real operator id could be stored; the only non-null values ever written were contact ids written by the auto-initializer. `0380` converted both columns to `varchar` and **cleared** the old values rather than reinterpret contact ids as actors. Consequence: for conditions created before `0380` the original actor is unrecoverable (NULL), and the service does not invent one. `0380` is applied and is not edited; later schema changes are new migrations (`0381`, chase versioning). Rows written after the migration carry real string actor ids.

## Acceptance (not met)

No native acceptance exists. A real MID, boarding submission or e-sign is not part of this packet and must not be reported as done.
