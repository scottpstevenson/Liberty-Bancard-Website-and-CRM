# Stage 5 protected native packet (PREPARED — NOT EXECUTED)

Nothing here was run. It is for the owner/operator after the Stage 5 code is published. Do not run anything below against production without owner approval.

Preconditions: global and channel outbound pauses stay on; outgoing GHL stays disabled (epoch 16); incoming GHL stays enabled. No provider traffic is part of this packet.

## Read-only checks (production, read-only role)

1. Boarding rows that may have been written by the old worker:
   `SELECT status, count(*) FROM deal_boarding_outbox GROUP BY 1;` and `SELECT boarding_status, count(*) FROM deals WHERE boarding_status IS NOT NULL GROUP BY 1;`
2. Deals marked `delivered`/`submitted` while the outbox row is `dead_letter` (ambiguous-then-delivered drift):
   `SELECT d.id FROM deals d JOIN deal_boarding_outbox o ON o.deal_id = d.id WHERE o.status = 'dead_letter' AND d.boarding_status IN ('submitted','approved');`
3. Duplicate canonical MID rows per deal (decides whether a uniqueness rule is safe):
   `SELECT deal_id, count(*) FROM merchant_mids WHERE deal_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`
4. Alias drift: `SELECT d.id FROM deals d JOIN merchant_mids m ON m.deal_id = d.id WHERE d.mid IS DISTINCT FROM m.mid;` (report counts only; never print MIDs).
5. Idempotency keys bound to more than one deal: `SELECT idempotency_key FROM deal_boarding_outbox GROUP BY 1 HAVING count(DISTINCT deal_id) > 1;` (expected zero; the column is unique).

## Owner decisions needed before any write

- Whether to add one-active-MID-per-deal uniqueness (depends on query 3).
- Whether any alias-drift rows (query 4) are reconciled and by whom.
- Activation snapshot for the documented sandbox host is created only by the owner through the admin route.

## Acceptance (not met)

No native acceptance exists. A real MID, boarding submission or e-sign is not part of this packet and must not be reported as done.
