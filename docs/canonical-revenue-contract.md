# Canonical Revenue Read Contract

This contract describes the read boundaries implemented by
`server/services/revenue-read-authority.ts`. Canonical reporting is database
aggregated; it does not derive totals from a paginated client result.

## Scope and population

* Privileged users (`admin`, `manager`) read the full applicable population.
* An `agent` reads records they own plus unassigned records. For contacts, an
  agent also sees a contact with a non-archived deal owned by that agent.
* **People** defaults to every non-archived contact, across all record
  classes. A record-class filter is opt-in, not the People default.
* Canonical pipeline reporting is limited to non-archived, `production` deals
  in that request's deal scope. Its `asOf`, retained in authority metadata, is
  the database statement snapshot time.

## Canonical Lead

A Lead is a **contact**, not a deal. A non-archived contact is a canonical
Lead when it has at least one non-archived, `production`, `sales` deal whose
stage is one of the executable `OPEN_SALES_LEAD_STAGES` values:

The single canonical list route is `GET /api/revenue/leads`.

Prospect conversion is a durable CRM conversion, not a classification
promotion. Newly written `unknown` roots remain outside revenue sets until the
existing classification authority approves them; CRO-01 never bypasses that gate.

1. `New Lead`
2. `Enriched`
3. `Statement Received`
4. `Review In Progress`
5. `Call Booked`
6. `Proposal Sent`
7. `Negotiation / Follow-Up`
8. `Verbal Commit`
9. `Promise to Submit`

The ordered list is conceptually imported from that executable shared
constant; this document does not create a second authority. A contact with
multiple qualifying deals still contributes one Lead. A qualifying deal does
not create a separate Lead without a contact.

## Merchant

A Merchant is also a **contact**, counted once when it has at least one
`merchant_mids` record with `status = 'active'` and a non-null
`activated_at`. Multiple active MIDs for the same contact remain one Merchant.
Merchant and Lead sets are deliberately distinct and may overlap: the same
contact can have an activated MID and a qualifying open sales deal.

## Reconciliation buckets

The reconciliation endpoint is privileged-only and reports these contact
counts: non-archived contacts, non-archived production contacts, canonical
Lead contacts, contacts with a noncanonical production sales stage, and
activated-MID Merchant contacts. These are diagnostic, **overlapping**
buckets—not a partition and not values that may be summed. For example, a
production contact may also be a Lead and a Merchant; a contact may have both
a qualifying and noncanonical sales deal.