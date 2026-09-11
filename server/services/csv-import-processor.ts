import type { PersistedCsvProcessor } from "./csv-import-recovery";
import { storage } from "../storage";
import { writeContact } from "./contact-writer";
import { createCro03SourceBatch } from "./cro03/source-staging";
import {
  completeImportExecution,
  heartbeatImportExecution,
  recordImportRowDisposition,
} from "./import-execution";
import { computeFileHash } from "./import-normalizer";
import { importDispositionCompatibility } from "@shared/import-disposition-summary";

let registeredProcessor: PersistedCsvProcessor | null = null;

/**
 * Express registers the worker once while routes are built. Both uploads and
 * recovery subsequently call this request-free processor boundary.
 */
export function registerPersistedCsvProcessor(processor: PersistedCsvProcessor): void {
  registeredProcessor = processor;
}

export async function processPersistedCsvImport(args: Parameters<PersistedCsvProcessor>[0]) {
  if (registeredProcessor) return registeredProcessor(args);
  return recoverPersistedCsvImport(args);
}

/**
 * Provider-format source formats that route through createCro03SourceBatch()
 * in the interactive import path. Recovery must use the same path.
 */
const PROVIDER_CSV_SOURCE_FORMATS = new Set(["google_maps_outscraper", "apollo_lead_list"]);

/**
 * Startup recovery is intentionally independent of Express.  A process can
 * restart before any request has registered the richer interactive importer;
 * this path consumes the same retained rows through the canonical local-first
 * writer and immutable ledger rather than requiring the customer to upload
 * the file a second time.
 *
 * For provider-format CSVs (Apollo, Outscraper) the rows must go through
 * createCro03SourceBatch() — not writeContact() — to match the interactive path.
 */
async function recoverPersistedCsvImport(args: Parameters<PersistedCsvProcessor>[0]) {
  const { records, executionClaim, importRecord, sourceFormat, actor, filename } = args;
  const executionId = executionClaim.execution.id;
  const claimToken = executionClaim.claimToken;
  if (!claimToken) throw new Error("CSV_IMPORT_RECOVERY_MISSING_CLAIM");

  // Route provider-format CSVs through createCro03SourceBatch, not writeContact.
  if (PROVIDER_CSV_SOURCE_FORMATS.has(sourceFormat)) {
    await recoverProviderCsvImport(args);
    return;
  }

  for (const [index, row] of records.entries()) {
    if (!await heartbeatImportExecution(executionId, claimToken)) {
      throw new Error(`IMPORT_EXECUTION_LEASE_LOST:${executionId}`);
    }
    const sourceRowNumber = index + 1;
    const rowFingerprint = computeFileHash(Buffer.from(JSON.stringify(row)));
    const companyName = String(row.companyName ?? row.company ?? row.name ?? row.business_name ?? "").trim();
    const firstName = String(row.firstName ?? row.first_name ?? row["first name"] ?? "").trim();
    const lastName = String(row.lastName ?? row.last_name ?? row["last name"] ?? "").trim();
    const email = String(row.email ?? row.email_address ?? "").trim().toLowerCase();
    const phone = String(row.phone ?? row.telephone ?? row.mobile_phone ?? row["mobile phone"] ?? "").trim();

    if (!companyName && !firstName && !email && !phone) {
      await recordImportRowDisposition({
        executionId, claimToken, sourceRowNumber, rowFingerprint,
        disposition: "rejected", reasonCode: "NO_USABLE_IDENTITY",
      });
      continue;
    }

    try {
      await writeContact({
        mode: "local_only",
        mutation: {
          firstName: firstName || companyName,
          lastName,
          email: email || `no-email-${executionId}-${sourceRowNumber}@no-email.libertybancard.internal`,
          phone,
          companyName,
          leadSource: sourceFormat,
          sourceCategory: "csv_import",
          primarySourceCategory: "csv_import",
          primarySourceType: "csv_contact",
          importBatchId: executionId,
        },
        provenance: {
          sourceCategory: "csv_import",
          sourceType: "csv_contact",
          eventKey: `import:${executionId}:row:${sourceRowNumber}`,
          importExecutionId: executionId,
          importClaimToken: claimToken,
          sourceRowNumber,
          rowFingerprint,
          actorType: actor.actorType,
          actorId: actor.actorId,
        },
        actor,
        rowDisposition: {
          createdReasonCode: "LOCAL_CONTACT_CREATED",
          matchedReasonCode: "EXACT_ELIGIBLE_IDENTITY_MATCH",
        },
      });
    } catch (error: any) {
      await recordImportRowDisposition({
        executionId, claimToken, sourceRowNumber, rowFingerprint,
        disposition: "failed", reasonCode: "RECOVERY_CONTACT_WRITE_FAILED",
        diagnostic: { error: String(error?.code ?? "write_failed") },
      });
    }
  }

  const completion = await completeImportExecution({
    executionId,
    claimToken,
    expectedRows: records.length,
  });
  if (!completion.completed) {
    throw new Error(`CSV_IMPORT_RECOVERY_LEDGER_MISMATCH:${completion.total}/${records.length}`);
  }
  const outcomes = importDispositionCompatibility(completion.counts);

  await storage.updateCsvImport(importRecord.id, {
    newRecords: outcomes.created,
    updatedRecords: outcomes.updated,
    duplicatesSkipped: outcomes.matched_noop,
    invalidRows: outcomes.rejected,
    skippedRows: outcomes.deferred,
    errorsCount: outcomes.failed,
    processedRows: outcomes.total,
    status: "completed",
    completedAt: new Date(),
    lastProgressAt: new Date(),
  });

  await storage.createAuditLog({
    action: "csv_import_recovered",
    entityType: "csv_import",
    entityId: importRecord.id,
    actorType: actor.actorType,
    actorId: actor.actorId,
    details: { executionId, filename, totalRows: records.length },
  } as any);

  return {
    import: await storage.getCsvImport(importRecord.id),
    ...outcomes,
    dealsCreated: 0,
    verticalBreakdown: {},
    sourceFormat,
    optOutPreserved: 0,
    optOutApplied: 0,
  };
}

// ── Column maps mirror imports.ts interactive path exactly ───────────────────
// These are intentionally duplicated (not imported from the route file) so that
// recovery remains independent of Express route loading order.
const GOOGLE_MAPS_COLUMN_MAP: Record<string, string> = {
  "name": "companyName", "telephone": "phone", "phone": "phone",
  "category": "industry", "rating": "rating", "review_count": "reviewCount",
  "reviews": "reviewCount", "keyword": "keyword", "address": "address",
  "website": "website", "city": "city", "state": "state",
};
const APOLLO_COLUMN_MAP: Record<string, string> = {
  "first_name": "firstName", "first name": "firstName", "firstname": "firstName",
  "last_name": "lastName", "last name": "lastName", "lastname": "lastName",
  "email": "email", "email_address": "email",
  "mobile_phone": "phone", "mobile phone": "phone", "corporate_phone": "phone",
  "corporate phone": "phone", "phone": "phone",
  "company": "companyName", "company_name": "companyName", "company name": "companyName",
  "title": "title", "industry": "industry", "keywords": "keywords",
  "#_employees": "employeeCount", "# employees": "employeeCount", "employees": "employeeCount",
  "annual_revenue": "annualRevenue", "annual revenue": "annualRevenue",
  "company_address": "address", "company address": "address", "address": "address",
  "city": "city", "company_city": "city", "company city": "city",
  "state": "state", "company_state": "state", "company state": "state",
  "website": "website",
  "person_linkedin_url": "linkedinUrl", "person linkedin url": "linkedinUrl",
  "facebook_url": "facebookUrl", "facebook url": "facebookUrl",
};
const GENERIC_COLUMN_MAP: Record<string, string> = {
  ...APOLLO_COLUMN_MAP, ...GOOGLE_MAPS_COLUMN_MAP,
  "business_name": "companyName", "business name": "companyName", "business": "companyName",
  "zip": "zip", "zipcode": "zip", "zip_code": "zip", "postal": "zip", "postal_code": "zip",
  "vertical": "vertical", "type": "vertical",
};

function mapProviderCsvRow(
  row: Record<string, unknown>,
  sourceFormat: string
): Record<string, string> {
  const colMap = sourceFormat === "google_maps_outscraper"
    ? { ...GENERIC_COLUMN_MAP, ...GOOGLE_MAPS_COLUMN_MAP }
    : sourceFormat === "apollo_lead_list"
      ? { ...GENERIC_COLUMN_MAP, ...APOLLO_COLUMN_MAP }
      : GENERIC_COLUMN_MAP;
  const mapped: Record<string, string> = {};
  for (const [csvCol, value] of Object.entries(row)) {
    if (!value || typeof value !== "string") continue;
    const normCol = csvCol.toLowerCase().trim().replace(/\s+/g, "_");
    const field = colMap[normCol] || colMap[csvCol.toLowerCase().trim()];
    if (field) mapped[field] = value.trim();
  }
  return mapped;
}

/**
 * Recovery path for provider-format CSVs (Apollo, Outscraper).
 *
 * Matches the interactive import path in imports.ts exactly:
 *   1. Applies the same column map to normalize field names.
 *   2. Uses providerCsvSourceSubject() to build canonical subject drafts with
 *      candidate values (business_name, email, phone, city, state, category, etc.)
 *      for CRO-03B arbitration.
 *   3. Calls createCro03SourceBatch() per row with idempotency key
 *      `csv-source:${executionId}:${sourceRowNumber}` — matching the interactive key.
 *   4. Records each row as 'deferred' / 'cro03_staging_review_required' so ledger
 *      counts remain truthful (no contacts created, staging review pending).
 */
async function recoverProviderCsvImport(args: Parameters<PersistedCsvProcessor>[0]): Promise<{
  import: any; created: number; updated: number; matched_noop: number; rejected: number;
  deferred: number; failed: number; total: number;
  dealsCreated: number; verticalBreakdown: Record<string, number>;
  sourceFormat: string; optOutPreserved: number; optOutApplied: number;
}> {
  const { records, executionClaim, importRecord, sourceFormat, actor, filename } = args;
  const executionId = executionClaim.execution.id;
  const claimToken = executionClaim.claimToken;
  if (!claimToken) throw new Error("CSV_IMPORT_RECOVERY_MISSING_CLAIM");

  const { providerCsvSourceSubject } = await import("../services/cro03a/adapters");
  const csvSourceSystem: "outscraper" | "apollo" =
    sourceFormat === "google_maps_outscraper" ? "outscraper" : "apollo";

  for (const [index, rawRow] of records.entries()) {
    if (!await heartbeatImportExecution(executionId, claimToken)) {
      throw new Error(`IMPORT_EXECUTION_LEASE_LOST:${executionId}`);
    }
    const sourceRowNumber = index + 1;
    const rowFingerprint = computeFileHash(Buffer.from(JSON.stringify(rawRow)));
    // Apply the canonical column map so field names match what providerCsvSourceSubject() reads.
    const mapped = mapProviderCsvRow(rawRow, sourceFormat);

    try {
      const draft = providerCsvSourceSubject({
        importExecutionId: executionId,
        sourceRowNumber,
        sourceSystem: csvSourceSystem,
        row: {
          ...mapped,
          // Mirror the interactive path's extra field aliases.
          ...(mapped.vertical ? { industry: mapped.vertical } : {}),
          ...(mapped.status  ? { status: mapped.status }     : {}),
        },
      });

      await createCro03SourceBatch({
        // Idempotency key matches the interactive import path exactly.
        idempotencyKey: `csv-source:${executionId}:${sourceRowNumber}`,
        actorType: "import",
        actorId: actor.actorId ?? executionId,
        purpose: "staging_review",
        subjects: [{
          ...draft,
          payload: {
            ...draft.payload,
            sourceRowNumber, rowFingerprint, sourceFormat,
          },
          provenance: {
            ...draft.provenance,
            rowFingerprint, sourceFormat,
          },
        }],
      });

      // Record as deferred (not created) — no contact was created, staging pending.
      await recordImportRowDisposition({
        executionId, claimToken, sourceRowNumber, rowFingerprint,
        disposition: "deferred",
        reasonCode: "cro03_staging_review_required",
        diagnostic: { sourceFormat, promotion: "not_performed", providerTransport: "disabled" },
      });
    } catch (error: any) {
      await recordImportRowDisposition({
        executionId, claimToken, sourceRowNumber, rowFingerprint,
        disposition: "failed",
        reasonCode: "RECOVERY_PROVIDER_STAGING_FAILED",
        diagnostic: { error: String(error?.message ?? "staging_failed").slice(0, 200) },
      }).catch(() => {});
    }
  }

  const completion = await completeImportExecution({
    executionId,
    claimToken,
    expectedRows: records.length,
  });
  if (!completion.completed) {
    throw new Error(`CSV_IMPORT_RECOVERY_LEDGER_MISMATCH:${completion.total}/${records.length}`);
  }
  const outcomes = importDispositionCompatibility(completion.counts);

  await storage.updateCsvImport(importRecord.id, {
    newRecords: outcomes.created,         // 0 — no contacts created by staging
    updatedRecords: outcomes.updated,
    duplicatesSkipped: outcomes.matched_noop,
    invalidRows: outcomes.rejected,
    skippedRows: outcomes.deferred,       // count of rows sent to staging review
    errorsCount: outcomes.failed,
    processedRows: outcomes.total,
    status: "completed",
    completedAt: new Date(),
    lastProgressAt: new Date(),
  });

  await storage.createAuditLog({
    action: "csv_import_recovered_provider",
    entityType: "csv_import",
    entityId: importRecord.id,
    actorType: actor.actorType,
    actorId: actor.actorId,
    details: {
      executionId, filename, totalRows: records.length,
      sourceFormat, csvSourceSystem,
      stagedForReview: outcomes.deferred,
      failedRows: outcomes.failed,
    },
  } as any);

  return {
    import: await storage.getCsvImport(importRecord.id),
    ...outcomes,
    dealsCreated: 0,
    verticalBreakdown: {},
    sourceFormat,
    optOutPreserved: 0,
    optOutApplied: 0,
  };
}