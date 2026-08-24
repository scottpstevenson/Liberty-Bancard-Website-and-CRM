import type { PersistedCsvProcessor } from "./csv-import-recovery";
import { storage } from "../storage";
import { writeContact } from "./contact-writer";
import {
  completeImportExecution,
  heartbeatImportExecution,
  recordImportRowDisposition,
} from "./import-execution";
import { computeFileHash } from "./import-normalizer";

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
 * Startup recovery is intentionally independent of Express.  A process can
 * restart before any request has registered the richer interactive importer;
 * this path consumes the same retained rows through the canonical local-first
 * writer and immutable ledger rather than requiring the customer to upload
 * the file a second time.
 */
async function recoverPersistedCsvImport(args: Parameters<PersistedCsvProcessor>[0]) {
  const { records, executionClaim, importRecord, sourceFormat, actor, filename } = args;
  const executionId = executionClaim.execution.id;
  const claimToken = executionClaim.claimToken;
  if (!claimToken) throw new Error("CSV_IMPORT_RECOVERY_MISSING_CLAIM");

  let inserted = 0;
  let duplicatesSkipped = 0;
  let invalidRows = 0;
  let errors = 0;

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
      invalidRows++;
      continue;
    }

    try {
      const contact = await writeContact({
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
      if (contact._intakeOutcome === "created") inserted++;
      else duplicatesSkipped++;
    } catch (error: any) {
      await recordImportRowDisposition({
        executionId, claimToken, sourceRowNumber, rowFingerprint,
        disposition: "failed", reasonCode: "RECOVERY_CONTACT_WRITE_FAILED",
        diagnostic: { error: String(error?.code ?? "write_failed") },
      });
      errors++;
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

  await storage.updateCsvImport(importRecord.id, {
    newRecords: completion.counts.created ?? inserted,
    duplicatesSkipped: completion.counts.matched_noop ?? duplicatesSkipped,
    invalidRows: completion.counts.rejected ?? invalidRows,
    skippedRows: completion.counts.deferred ?? 0,
    errorsCount: completion.counts.failed ?? errors,
    processedRows: completion.total,
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
    inserted: completion.counts.created ?? inserted,
    updated: completion.counts.updated ?? 0,
    duplicatesSkipped: completion.counts.matched_noop ?? duplicatesSkipped,
    invalidRows: completion.counts.rejected ?? invalidRows,
    skippedRows: completion.counts.deferred ?? 0,
    errors: completion.counts.failed ?? errors,
    dealsCreated: 0,
    verticalBreakdown: {},
    sourceFormat,
    optOutPreserved: 0,
    optOutApplied: 0,
  };
}