import { pool, db } from "../db";
import { assertSystemLinkDatabaseGuard, assertSfpLinkDatabaseGuard, assertSfpPipelineDatabaseGuard } from "./commercial-link-authority";
import { assertSfpRecipientCapacityDatabaseGuard } from "./cro03/sfp-recipient-capacity";
import { effectiveBusinessVerticalStatusSql } from "@shared/effective-vertical";
import type { CanonicalEnrichmentStatus } from "@shared/canonical-enrichment-status";
import {assertCanonicalPreparationDatabaseGuard} from "./canonical-recipient-preparation";
import {assertCanonicalAddressReceiptContract} from "./canonical-address-receipt-contract";

/** Observational projection only. Counts are not enrollment, transport,
 * qualification or completion authority. Failed reads never become zeroes. */
export async function readCanonicalEnrichmentStatus(): Promise<CanonicalEnrichmentStatus> {
  const importOutcomes = (exceptions: boolean) => pool.query(`
    SELECT accounting.execution_id,accounting.source_row_number,accounting.disposition,
      accounting.reason_code,accounting.contact_id,
      CASE WHEN accounting.diagnostic->>'businessId' ~ '^[0-9]+$'
        THEN (accounting.diagnostic->>'businessId')::integer END business_id,
      source_item.terminal_code fulfillment_state,source_item.next_attempt_at::text next_attempt_at,
      (COALESCE(jsonb_typeof(execution.source_payload->(accounting.source_row_number-1))='object',FALSE)
        OR EXISTS(SELECT 1 FROM cro03_enrichment_batches raw_batch
          JOIN cro03_batch_memberships raw_member ON raw_member.batch_id=raw_batch.id
          JOIN cro03_source_observations original ON original.id=raw_member.source_observation_id
          WHERE raw_batch.idempotency_key='csv-source-raw-v2:'||execution.id::text||':'||accounting.source_row_number::text
            AND jsonb_typeof(original.payload->'rawSourceRow')='object')) original_available,
      accounting.completed_at::text completed_at
    FROM import_row_dispositions accounting JOIN import_executions execution ON execution.id=accounting.execution_id
    LEFT JOIN LATERAL(
      SELECT item.terminal_code,item.next_attempt_at,item.state
      FROM cro03_enrichment_batches batch JOIN cro03_enrichment_items item ON item.batch_id=batch.id
      WHERE batch.idempotency_key='csv-source:'||execution.id::text||':'||accounting.source_row_number::text
      ORDER BY item.id LIMIT 1
    ) source_item ON TRUE
    ${exceptions ? `WHERE accounting.disposition IN ('deferred','failed','rejected')
      AND source_item.terminal_code IS DISTINCT FROM 'CANONICAL_LOCAL_IMPORT_FULFILLED'` : ""}
    ORDER BY accounting.completed_at DESC,accounting.id DESC LIMIT 25`);
  const [contacts, businesses, preparations, imports, providers, nativeContracts, preparationCursor, validationQueue,
    recentImportOutcomes, importExceptions, projection] = await Promise.all([
    pool.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE email_status='valid')::int valid,
      count(*) FILTER (WHERE email_status IS NULL OR email_status IN ('active','unvalidated'))::int unvalidated,
      count(*) FILTER (WHERE do_not_contact OR do_not_auto_contact OR opted_out_email
        OR email_status IN ('bounced','invalid','opted_out','unsafe'))::int blocked
      FROM contacts WHERE record_class='production' AND archived_at IS NULL`),
    pool.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE vertical_status='mapped')::int mapped,
      count(*) FILTER (WHERE vertical_status='excluded')::int excluded,
      count(*) FILTER (WHERE vertical_status NOT IN ('mapped','excluded'))::int unresolved
      FROM (SELECT ${effectiveBusinessVerticalStatusSql("b")} vertical_status
        FROM businesses b WHERE b.record_class='canonical') current_businesses`),
    pool.query(`SELECT state,sum(n)::int n FROM (
      SELECT 'historical_sfp:'||state AS state,count(*)::int n
        FROM sfp_campaign_staging_intents GROUP BY state
      UNION ALL
      SELECT preparation_state AS state,count(*)::int n FROM cr04_enrollment_intents
        WHERE program_id IS NOT NULL GROUP BY preparation_state
    ) preparation_states GROUP BY state`),
    pool.query("SELECT status AS state,count(*)::int n FROM import_executions GROUP BY status"),
    pool.query("SELECT state,count(*)::int n FROM provider_operations GROUP BY state"),
    Promise.all([
      assertSystemLinkDatabaseGuard(db), assertSfpLinkDatabaseGuard(db),
      assertSfpPipelineDatabaseGuard(db), assertSfpRecipientCapacityDatabaseGuard(db),
      assertCanonicalPreparationDatabaseGuard(db),assertCanonicalAddressReceiptContract(db),
    ]).then(() => ({
      state: "verified" as const, reason: null,
    })).catch(error => ({
      state: "blocked" as const,
      reason: /DATABASE_GUARD_MISSING/.test(String(error?.message))
        ? String(error.message).slice(0, 250) : "Native contract verification unavailable",
    })),
    pool.query("SELECT value FROM system_settings WHERE key='canonical_recipient_preparation_cursor'"),
    pool.query(`SELECT count(*) FILTER(WHERE state='pending')::int pending,
      count(*) FILTER(WHERE state='processing')::int processing,
      min(created_at) FILTER(WHERE state='pending')::text oldest_pending_at
      FROM validation_intents WHERE state IN ('pending','processing')
        AND EXISTS(SELECT 1 FROM cr04_enrollment_intents prepared
          WHERE prepared.contact_id=validation_intents.contact_id
            AND prepared.normalized_email_hash=validation_intents.normalized_email_token_hash
            AND prepared.preparation_state IN ('pending_validation','ready_held'))`),
    importOutcomes(false),
    importOutcomes(true),
    pool.query("SELECT value FROM system_settings WHERE key='crm_effective_vertical_projection_v1'"),
  ]);
  const outcomeRows=(result:{rows:any[]})=>result.rows.map(row=>({
    executionId:String(row.execution_id),sourceRowNumber:Number(row.source_row_number),
    disposition:String(row.disposition),reasonCode:String(row.reason_code),
    contactId:row.contact_id == null ? null : Number(row.contact_id),
    businessId:row.business_id == null ? null : Number(row.business_id),
    fulfillmentState:row.fulfillment_state ?? null,nextAttemptAt:row.next_attempt_at ?? null,
    originalAvailable:row.original_available === true,completedAt:String(row.completed_at),
  }));
  const states = (result: { rows: any[] }) => ({
    total: result.rows.reduce((total, row) => total + Number(row.n), 0),
    byState: Object.fromEntries(result.rows.map(row => [String(row.state), Number(row.n)])),
  });
  const coverage=projection.rows[0]?.value?.coverageVersion===2 ? projection.rows[0].value : null;
  return {
    observedAt: new Date().toISOString(), scope: "production_records_with_historical_work",
    contacts: contacts.rows[0], businesses: businesses.rows[0],
    preparations: states(preparations), imports: states(imports), providers: states(providers),
    recentImportOutcomes:outcomeRows(recentImportOutcomes),importExceptions:outcomeRows(importExceptions),
    nativeContracts,
    automaticProgress:{
      projection:{
        observed:coverage!=null,scope:"all_record_classes",verifiedCycles:Number(coverage?.verifiedCycles ?? 0),
        businessCursor:Number(coverage?.businessCursor ?? 0),contactCursor:Number(coverage?.contactCursor ?? 0),
        populationBusinesses:Number(coverage?.populationBusinesses ?? 0),
        populationContacts:Number(coverage?.populationContacts ?? 0),
        businessesScanned:Number(coverage?.businessesScanned ?? 0),contactsScanned:Number(coverage?.contactsScanned ?? 0),
        lastCompletedCoverage:coverage?.lastCompletedCoverage ?? null,
      },
      preparation:{
        observed:preparationCursor.rows.length>0,
        cycles:Number(preparationCursor.rows[0]?.value?.cycles ?? 0),
        afterContactId:Number(preparationCursor.rows[0]?.value?.afterContactId ?? 0),
        scanned:Number(preparationCursor.rows[0]?.value?.scanned ?? 0),
        prepared:Number(preparationCursor.rows[0]?.value?.prepared ?? 0),
        held:Number(preparationCursor.rows[0]?.value?.held ?? 0),
        lastCycleAt:preparationCursor.rows[0]?.value?.lastCycleAt ?? null,
        reasons:preparationCursor.rows[0]?.value?.reasons ?? {},
      },
      validation:{pending:Number(validationQueue.rows[0].pending),processing:Number(validationQueue.rows[0].processing),
        oldestPendingAt:validationQueue.rows[0].oldest_pending_at},
    },
    limitations: [
      "Contact, business, import, provider and preparation totals describe different populations.",
      "Valid email status alone does not establish current recipient eligibility or sending permission.",
      "Native contracts verify database safeguards, not deployed progression or full completion.",
      "Provider operation state and recorded usage do not prove vendor credits or invoices.",
      "Preparation, import and provider state totals include historical work; they are not a production-only cohort.",
      "Automatic preparation counters are cumulative pass transitions, not distinct qualified contacts; local cycle receipts do not certify deployed scheduled progression.",
      "Projection coverage includes all record classes in a frozen ID range; it does not prove identity linking, qualification or paid queue admission.",
      "Preparation-linked validation intent counts do not prove fresh dispatch eligibility; current canonical selection is rechecked before provider I/O.",
    ],
  };
}