# SFP contact-link production schema readiness

The SFP contact-link preview and apply endpoints refuse to operate unless the
published database has **both** the contact-source SFP constraints from
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

If any check fails, use the normal governed production schema-change process
to reconcile the exact statements in 0309 and 0312, accounting for objects
that publishing may already have created. **Do not blindly replay either full
migration** against a partially reconciled database. Verify the catalog again
afterward. The admin preview returns HTTP 409 until the guard passes; a passing
preview is read-only and makes no provider calls. Apply is a separate,
explicit, max-25-link action and rechecks every row under graph locks.

Link verification does **not** validate recipient email addresses or authorize
outreach. SFP validation/policy/staging remain separate gates.