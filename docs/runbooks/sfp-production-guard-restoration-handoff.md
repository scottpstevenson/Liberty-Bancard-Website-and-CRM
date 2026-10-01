# SFP omitted production guards: platform/operator handoff

## Status and authority

Six required production triggers are missing and one existing guard function is
outdated. Production tables already exist. Publish reports an empty SQL diff.
This is a production schema-mechanism blocker, not permission to bypass the
guards or replay the migration journal.

A platform/database operator with a supported production-schema capability must
restore the reviewed objects. Agent's production SQL access is read-only.
This document is a scope/review handoff, **not an executable migration script**.
Do not add an application endpoint, startup hook, deployment-build DDL or custom
production migration runner.

## Exact reviewed source objects

Use the existing definitions in the following files. Select only the omitted
function/trigger objects, preserving function bodies exactly; do not execute
either whole migration against the partially reconciled database.

### `migrations/0314_sfp_verified_recipient_link_commitments.sql`

| Function | Trigger/table |
| --- | --- |
| `cro02_sfp_link_evidence_append_only()` | `contact_business_sfp_link_evidence_append_only` on `contact_business_sfp_link_evidence` |
| `enforce_reviewed_contact_business_link()` | Existing `contact_business_link_review_contract` on `contact_business_link_decisions`; replace its old function body with the reviewed SFP-aware body, retaining its admin and Sunbiz branches |
| `sfp_recipient_commitment_aliases_append_only()` | `sfp_recipient_commitment_aliases_append_only` on `sfp_recipient_commitment_aliases` |
| `sfp_recipient_commitment_transition()` | `sfp_recipient_commitment_transition` on `sfp_recipient_address_commitments` |
| `sfp_enrollment_bridge_holds_append_only()` | `sfp_enrollment_bridge_holds_append_only` on `sfp_enrollment_bridge_holds` |

### `migrations/0319_sfp_runtime_release_selector.sql`

| Function | Trigger/table |
| --- | --- |
| `guard_sfp_runtime_release_selector_mutation()` | `sfp_runtime_release_selector_mutation_guard` on `sfp_runtime_release_selectors` |
| `reject_sfp_runtime_release_selection_event_mutation()` | `sfp_runtime_release_selection_events_immutable` on `sfp_runtime_release_selection_events` |

Preserve all existing data, constraints, foreign keys, package mappings and
Sunbiz generated-column indexes. Do not truncate/recreate tables, modify
approval/review facts, create recipient rows, or fabricate migration hashes.
Function-body whitespace matters to the runtime fingerprint checks.

## Read-only postcheck

Run independently against production and development. Seven rows must appear,
with the intended enabled trigger/event definitions and matching reviewed
function bodies. Matching names alone do not establish readiness.

```sql
WITH expected(table_name, trigger_name) AS (
  VALUES
    ('contact_business_sfp_link_evidence',
     'contact_business_sfp_link_evidence_append_only'),
    ('contact_business_link_decisions',
     'contact_business_link_review_contract'),
    ('sfp_recipient_address_commitments',
     'sfp_recipient_commitment_transition'),
    ('sfp_recipient_commitment_aliases',
     'sfp_recipient_commitment_aliases_append_only'),
    ('sfp_enrollment_bridge_holds',
     'sfp_enrollment_bridge_holds_append_only'),
    ('sfp_runtime_release_selectors',
     'sfp_runtime_release_selector_mutation_guard'),
    ('sfp_runtime_release_selection_events',
     'sfp_runtime_release_selection_events_immutable')
)
SELECT x.table_name, x.trigger_name,
       t.oid IS NOT NULL AS installed, t.tgenabled,
       pg_get_triggerdef(t.oid) AS trigger_definition,
       p.proname, md5(p.prosrc) AS function_body_hash
FROM expected x
LEFT JOIN pg_namespace n ON n.nspname='public'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=x.table_name
LEFT JOIN pg_trigger t ON t.tgrelid=c.oid
  AND t.tgname=x.trigger_name AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid=t.tgfoid
ORDER BY x.table_name;
```

This catalog report supplements, not replaces, the complete runtime database
guard: typed source CHECKs, FKs, exact public-schema function definitions,
unconditional trigger events and uniqueness contracts must also pass.

## Continue after verification

The deployment-identity source fix uses the real per-build UUID described in
`sfp-publish-build-identity.md`; it requires a corrected Publish and independently
verified publisher evidence before audited release selection. It does not
install any database objects.

After both prerequisites pass, resume already-authorized SFP production work
within Task 2060. Keep outbound paused and record actual qualified recipients,
paused enrollments and at least two replenishment measurements. Restored guards,
passing tests or a Publish are not the requested production output.