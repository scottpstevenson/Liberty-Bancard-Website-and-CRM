---
name: Intake Provenance System
description: writeContact() canonical writer, import_executions, contact_source_events — how all intake paths record origin.
---

## The Write Contract

`writeContact()` in `server/services/contact-writer.ts` is the **single authority** for creating contacts with provenance.

**3 modes:**
- `ghl_upsert_first` — standard public-form path; creates contact then syncs to GHL
- `ghl_inbound_no_echo` — GHL inbound sync only; does NOT echo back to GHL
- `local_only` — manual CRM create; no GHL push

**Transaction pattern (A→B→C):**
1. INSERT contact with `primarySourceEventId = NULL`
2. INSERT contact_source_events row (gets UUID id)
3. UPDATE contact SET primarySourceEventId = <event_uuid>

The DEFERRABLE FK allows step 1 to succeed before step 2 creates the target row.

## VALID_SOURCE_COMBOS

Only these `(sourceCategory, sourceType)` pairs are allowed:
- `public_form / statement_upload | estimate_form | support_form | get_started_form | integration_request | callback_form | equipment_order | testimonial_submit | newsletter_signup`
- `manual_crm / dashboard`
- `ghl_sync / inbound`
- `csv_import / csv_contact | outscraper | apollo`
- `sunbiz_upload / sunbiz_csv | corevt`
- `legacy_unknown / historical_backfill`

## stripProvenanceFields()

Defense-in-depth: PUT route (layer 1) and `updateContact()` storage (layer 2) both strip provenance fields before any write. The source fields are immutable after contact creation.

## upsertContactSourceEvent()

Idempotent — uses `ON CONFLICT DO NOTHING` on the `(contact_id, event_key)` UNIQUE index. Safe to call fire-and-forget with `.catch()`. Used by ghl-sync existing-contact update path.

## Backward-compat wrapper

`createContactGhlFirst()` still works for the routes not yet migrated (live-chat, partner-orgs, merchants, sdr, partners). It calls `writeContact` with `legacy_unknown / historical_backfill` provenance so those contacts get a source event even with no real provenance data.

## CSV Bulk Import (imports.ts)

One `import_executions` row is created before the batch loop. `sourceCategory / primarySourceCategory / primarySourceType` are stamped on every `contactInserts` entry. After bulk insert, `contactSourceEvents` rows are fire-and-forget created (batches of 100). `import_executions` is marked `completed` at end.

**csvSourceType mapping:**
- `google_maps_outscraper` → `outscraper`
- `apollo_lead_list` → `apollo`
- `custom` → `csv_contact`

## Sunbiz Uploads (prospects.ts)

Both `/api/sunbiz/upload` and `/api/sunbiz/upload-corevt` create an `import_executions` row (importType `sunbiz_csv` / `sunbiz_corevt`) before processing. The `importExecutionId` UUID is propagated to every entity payload passed to `createSunbizEntitiesBulk` / `upsertSunbizEntitiesBulk`.

**Why:** `sunbiz_entities.importExecutionId` is how we trace which upload batch originated each prospect row.

## Migration

`migrations/0065_provenance_schema.sql`, journal idx 69, `when = 1785800000000`.
Backfill: all pre-existing contacts → `sourceCategory = 'legacy_unknown'`, `primarySourceType = 'historical_backfill'`.
