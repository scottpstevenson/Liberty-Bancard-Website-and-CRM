# Stage 5 protected native packet (PREPARED — NOT EXECUTED)

Updated 2026-11-05 after the published completion audit (first prepared 2026-11-04). Nothing here was run. It is for the owner/operator after the corrected Stage 5 code is published. Do not run anything below against production without owner approval. This packet is not native acceptance.

Preconditions: global and channel outbound pauses stay on (epoch 1); outgoing GHL stays disabled (epoch 16, permissions enabled); incoming GHL stays enabled. No provider traffic is part of this packet. No form submission, MID edit, snapshot write, send, booking, backfill, reclassification or native enablement is part of it either.

## A. Read-only checks (production, read-only role; report counts only, never MIDs or personal data)

1. Boarding rows that may have been written by the old worker:
   `SELECT status, count(*) FROM deal_boarding_outbox GROUP BY 1;` and `SELECT boarding_status, count(*) FROM deals WHERE boarding_status IS NOT NULL GROUP BY 1;`
2. Deals marked `submitted`/`approved` while an outbox row is `dead_letter` (includes ambiguous rows; drift check):
   `SELECT d.id FROM deals d JOIN deal_boarding_outbox o ON o.deal_id = d.id WHERE o.status = 'dead_letter' AND d.boarding_status IN ('submitted','approved');`
3. **Ambiguity conservation (extended).** In the outbox an ambiguous provider outcome is stored as `status = 'dead_letter'` with `last_error = 'ambiguous_reconciliation_required'` (there is no outbox status of that name); the deal's `boarding_status` is `'ambiguous_reconciliation_required'`. A row that began provider I/O and has not settled carries `last_error = 'DISPATCH_STARTED'` (normally `processing`). Held/ambiguous rows must stay held, and neither a delivered outbox row nor an ambiguous deal may have been overwritten by a later status. Report aggregate counts only:
   - Counts by state: `SELECT status, count(*) FILTER (WHERE last_error = 'ambiguous_reconciliation_required') AS ambiguous, count(*) FILTER (WHERE last_error = 'DISPATCH_STARTED') AS dispatch_started, count(*) FROM deal_boarding_outbox GROUP BY 1;`
   - Deals with a delivered outbox row while another outbox row for the same deal is ambiguous (count): `SELECT count(*) FROM deal_boarding_outbox o JOIN deal_boarding_outbox a ON a.deal_id = o.deal_id AND a.id <> o.id WHERE o.status = 'delivered' AND a.status = 'dead_letter' AND a.last_error = 'ambiguous_reconciliation_required';`
   - Deals whose `boarding_status` is no longer `ambiguous_reconciliation_required` although an outbox row for them still is (count): `SELECT count(*) FROM deals d JOIN deal_boarding_outbox o ON o.deal_id = d.id WHERE o.status = 'dead_letter' AND o.last_error = 'ambiguous_reconciliation_required' AND d.boarding_status IS DISTINCT FROM 'ambiguous_reconciliation_required';`
   - Unsettled dispatch markers (count): `SELECT count(*) FROM deal_boarding_outbox WHERE last_error = 'DISPATCH_STARTED';`
   - Deals that are `ambiguous_reconciliation_required` and also carry a later `submitted`/`approved`/`declined` observation in `boarding_log`: inspect the count only.
   Expected: zero for each ambiguity/conflict count. Any non-zero count is reported to the owner and is not repaired by this packet. Read-only reference observation on 2026-11-05: production `deal_boarding_outbox` had 0 rows (0 ambiguous, 0 `DISPATCH_STARTED`).
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

Before `0380`, `underwriting_conditions.created_by` / `updated_by` were integer columns while user ids are strings, so no real operator id could be stored; the only non-null values ever written were contact ids written by the auto-initializer. `0380` converted both columns to `varchar` and **cleared** the old values rather than reinterpret contact ids as actors. Consequence: for conditions created before `0380` the original actor is unrecoverable (NULL), and the service does not invent one. `0380` is applied and is not edited; later schema changes are new migrations (`0381`, chase versioning). Rows written after the migration carry real string actor ids. Reverting the application does **not** restore the cleared values: they were destroyed by the migration, not hidden by code, and only a database restore from before `0380` would recover them (not part of this packet and not recommended, since they were contact ids rather than actors). Read-only observation 2026-11-05: production `underwriting_conditions` has 0 rows, so nothing was cleared there.

## E. Normal publish handoff and native acceptance sequence (PREPARED — NOT EXECUTED)

Handoff (owner): publish through the normal Publish flow only. Publish applies the schema diff and routine startup reconciliation; no agent-run production migration, backfill or write is part of it. After Publish: read the served build identity, then run section A (read-only).

Native acceptance remains **unmet** until the owner approves and records each of these, in order, with no provider traffic beyond what each step names:
1. Section A results reported (aggregate counts); non-zero conflict counts resolved by the owner first.
2. Section B snapshot correction (only if query 7 returns rows), then the readback.
3. Owner records `boarding.policy.matrix.v1` (section C); readiness then stops reporting `policy_unresolved`.
4. Owner-approved sandbox boarding submission for one named test deal against `https://testapi.payarc.net/v1`, with the processor activation gate verified; evidence is the outbox row, receipt and `boarding_log` aggregate for that deal, with MIDs masked.
5. Owner decision on any live (`api.payarc.net`) use. Not implied by any earlier step.
No step enables outbound sending, outgoing GHL or native flows; those pauses stay in place.

## Acceptance (not met)

No native acceptance exists. A real MID, boarding submission or e-sign is not part of this packet and must not be reported as done.
