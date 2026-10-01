# SFP contact-link production schema readiness

The SFP contact-link **preview remains read-only** when contracts are missing:
it returns HTTP 200 with `schemaReady=false`, `writes=0`, and `paidProviderCalls=0`.
Its identity-qualified rows are not permission to write. The **apply** endpoint
stays blocked unless the published database has **both** the contact-source SFP constraints from
`migrations/0309_sfp_verified_contact_source.sql` and the separate system-link
evidence, decision trigger, and immutable-evidence trigger from
`migrations/0312_contact_business_system_links.sql`.

The development database and the published database are separate. An application
restart or a successful development migration is **not** proof that the published
database has these contracts. Publishing may reconcile tables/columns without
installing SQL trigger functions or replacing existing CHECK definitions. Do not
run migrations against production from application startup, and do not enable
link writes while either contract is absent.

## Read-only catalog checks

Run these against the **published** database, not the development database:

```sql
SELECT to_regclass('public.contact_business_system_link_evidence') AS evidence_table;

SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
WHERE (c.relname, con.conname) IN (
  ('sfp_outreach_eligibility', 'sfp_outreach_eligibility_source_ref_one_of_chk'),
  ('sfp_campaign_staging_intents', 'sfp_campaign_staging_intents_source_ref_one_of_chk')
);
-- Both CHECK definitions must explicitly allow source_kind='contact' with
-- contact_id, contact_business_link_decision_id, revision, and normalized hash.

SELECT t.tgname, t.tgenabled, p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE (c.relname, t.tgname) IN (
  ('contact_business_link_decisions', 'contact_business_link_review_contract'),
  ('contact_business_system_link_evidence', 'contact_business_system_link_evidence_append_only')
);
-- Both triggers must be enabled. The reviewed-link function must contain
-- COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED and keep its admin reviewer branch.
```

Use `docs/runbooks/sfp-contact-link-schema-checks.md` for exact read-only
prechecks and postchecks. Its final `schema_ready` must be true before link
apply. It checks public-schema function fingerprints, unconditional enabled
trigger/event definitions, evidence FKs with RESTRICT deletion, and both exact
typed-source CHECK expressions. PL/pgSQL bodies must match the reviewed
definitions exactly; whitespace-only function-body edits fail closed. CHECK
expression deparser changes on a PostgreSQL upgrade also require certification.

If any check fails, stop link writes. This is a Replit-managed production
database: Publish owns schema reconciliation. Do not add startup DDL,
deployment-build migrations, a custom production migration executor, or
fabricated migration-history rows. **Do not blindly replay either full
migration** against a partially reconciled database or edit an applied migration.
Read the actual Publish diff; if required contracts are omitted, that diff is
not an executable plan for completing this repair. Obtain a supported
deployment/operator resolution for those omitted objects and re-run the
postchecks before proceeding.

Missing contracts do **not** cause a preview HTTP 409; preview returns
`schemaReady=false` and remains useful for explicit review. Apply returns HTTP
409 when the database guard is missing, before per-item work or a batch audit
write. Apply is a separate,
explicit, max-25-link action and rechecks every row under graph locks.

Link verification does **not** validate recipient email addresses or authorize
outreach. SFP validation/policy/staging remain separate gates.

## Inspected production state — 2026-09-30

- Both SFP tables already have typed-contact columns and restrictive contact/link
  foreign keys. Preserve those objects.
- Both source-reference CHECKs still contain only free/paid branches.
- System-link evidence storage, the decision's `system_evidence_id`, and the two
  application triggers are absent.
- The ledger includes the exact content hash of 0308, but not the exact hashes
  of 0309 or 0312. Object presence is not proof of full migration application.
- The platform-generated Publish diff has 13 additive statements, no structural
  data-loss warning, and no CHECK replacements or trigger/function statements.
  Two provider-cost columns, their checks and an index are also in that diff;
  they belong to the already-merged upstream changes, not contact linking.
  Do not claim publishing that diff makes the link contract ready.
- The published admin preview route currently returns 404: the workspace repair
  has not been published. The same current preview service was run through a
  SELECT-only platform-query replay against production, without a production
  connection string or mutation.
- The first 25-contact page had zero eligible rows. A separate SQL identity
  shortlist found one possible match; a targeted 25-contact service preview
  confirmed one identity-eligible row, still with `schemaReady=false`. These
  bounded previews are not a full-population eligibility census.
- Pool diagnostic counts: 154,418 contacts, 16,628 website-domain matches,
  10,863 matching email/business domains. These are identity inputs, not
  verified relationships. Keep non-qualifying records available for explicit
  review; do not weaken corporate-email or independent-source checks.

## Disposable certification before production writes

```bash
npx tsx scripts/run-sfp-contact-links-integration-disposable.ts
npx tsx scripts/run-sfp2056-contact-certification-disposable.ts
```

Both launchers create isolated socket-only PostgreSQL clusters, scrub inherited
credentials, and destroy their clusters. The first certifies system linking,
rollback, stale snapshots, concurrent/repeated apply, immutable evidence,
admin-reviewed links, weakened/missing/conditional/shadow-schema contracts, and
the actual HTTP handlers' read-only preview / no-audit blocked apply behavior.
The second certifies the contact-source downstream path through fake
validation, master lead, v2 ready-held, and exactly one paused enrollment.
Neither is a claim that the live production chain has run.

## Bounded live continuation after the deployment blocker is resolved

1. Confirm the published release exposes the corrected admin preview and apply
   handlers. Re-run the read-only schema checks against production; all required
   readiness flags must pass.
2. Fetch a fresh bounded preview. Do not reuse the inspection snapshot hash.
   Apply only operator-selected eligible rows (maximum 25); start with one.
3. Check the verified decision, immutable evidence, restrictive lineage, contact
   projection, and actual unified SFP candidate selection for that contact.
4. Use the frozen cohort's validation preview. Live validation requires its own
   current provider authority and spend budget; do not bypass a closed gate or
   substitute fake validation in production.
5. Preview then explicitly execute v2 staging with the exact eligibility IDs,
   snapshot and payload hashes. Check the master lead and package-pinned
   `ready_held` intent.
6. Only use the explicit ready-held-to-paused bridge when its pinned sequence is
   paused. Confirm exactly one paused enrollment and idempotent replay. Do not
   activate campaigns, unpause sequences/enrollments, dispatch, or sync to GHL.
7. Record real provider receipt/spend and outbound before/after evidence.
   A blocked step is a blocker, not successful live certification.