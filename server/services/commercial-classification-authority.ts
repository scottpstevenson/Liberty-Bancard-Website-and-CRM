/**
 * BT-06 — Commercial Classification Authority
 *
 * The ONLY path for reading or changing a subject's commercial record_class.
 * All KPI, payout, and outbound dispatch code must go through this module
 * rather than reading or writing record_class directly.
 *
 * Vocabulary:
 *   production  — evidence-backed real commercial record
 *   test        — synthetic/QA contact created for automated testing
 *   demo        — demo/showcase record not representing real business
 *   synthetic   — system-generated synthetic data (lead-pool seeds, etc.)
 *   unknown     — default; unreviewed; quarantined from production metrics
 *
 * Kill lines enforced here:
 *   - unknown is never treated as production
 *   - class transitions require immutable append-only evidence
 *   - marketing_outreach is blocked for any class except production
 *   - transactional_response is allowed for unknown (newly submitted forms)
 *   - PII (SSN, EIN, bank data, email bodies) must never appear in evidenceFields
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import {
  COMMERCIAL_CLASS_VALUES,
  contacts,
  deals,
  prospects,
  companies,
  commercialClassificationEvents,
  commercialClassificationCommands,
  CLASSIFICATION_POLICY_VERSION,
  type CommercialClass,
} from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type ClassificationPurpose =
  | "marketing_outreach"
  | "commercial_reporting"
  | "financial_payout"
  | "transactional_response"
  | "internal_test";

export type ClassificationSubjectType =
  | "contact"
  | "deal"
  | "prospect"
  | "company";

export interface ClassificationAuthResult {
  allowed: boolean;
  recordClass: CommercialClass;
  purpose: ClassificationPurpose;
  reasonCode?: "COMMERCIAL_CLASS_UNKNOWN" | "COMMERCIAL_CLASS_NOT_PRODUCTION" | "COMMERCIAL_CLASS_CONFLICT";
  reason?: string;
}

export interface ClassificationCommand {
  subjectType: ClassificationSubjectType;
  subjectId: number;
  targetClass: CommercialClass;
  eventNamespace: string;
  eventKey: string;
  // evidenceFields: allowlisted non-PII fields describing why this classification
  // was chosen. Must NOT contain SSN, EIN, bank account numbers, document bodies,
  // email message bodies, raw import payloads, or any credentials.
  evidenceFields: Record<string, unknown>;
  actorId?: string;
  approverId?: string;
}

export interface ClassificationPreviewCommand {
  idempotencyKey: string;
  subjectType: ClassificationSubjectType;
  subjectId: number;
  targetClass: CommercialClass;
  evidenceFields: Record<string, unknown>;
  requestedBy?: string;
}

export interface ApproveCommandParams {
  commandId: string;
  approvedBy: string;
  versionLock: number;
}

// Evidence is deliberately an allowlist. Classification needs provenance, not
// copies of documents, imports, emails, credentials, or financial identifiers.
const EVIDENCE_FIELD_ALLOWLIST = new Set([
  "review_source",
  "verified_at",
  "evidence_reference",
  "external_reference",
  "source_system",
  "approval_basis",
  "classification_reason",
  "attestation_id",
  "ticket_id",
  "command_id",
]);

function assertNoPii(fields: Record<string, unknown>): void {
  if (Object.keys(fields).length === 0) {
    throw new Error("BT-06 kill line: classification evidence must include at least one allowlisted non-PII reference.");
  }
  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[-\s]/g, "_");
    if (!EVIDENCE_FIELD_ALLOWLIST.has(normalizedKey)) {
      throw new Error(`BT-06 kill line: evidence field '${key}' is not allowlisted.`);
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 256 ||
      /(?:\b\d{3}-?\d{2}-?\d{4}\b)|(?:\b\d{2}-?\d{7}\b)/.test(value)
    ) {
      throw new Error(`BT-06 kill line: evidence '${key}' must be a short non-PII reference string.`);
    }
  }
}

function hashEvidence(fields: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(fields, Object.keys(fields).sort()))
    .digest("hex");
}

function assertCommercialClass(value: string): asserts value is CommercialClass {
  if (!(COMMERCIAL_CLASS_VALUES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid commercial class '${value}'. Expected one of: ${COMMERCIAL_CLASS_VALUES.join(", ")}.`
    );
  }
}

function assertSubjectType(value: string): asserts value is ClassificationSubjectType {
  if (!["contact", "deal", "prospect", "company"].includes(value)) {
    throw new Error(`Invalid classification subject type '${value}'.`);
  }
}

function rows(result: unknown): any[] {
  return ((result as { rows?: unknown[] })?.rows ?? []) as any[];
}

// ── Current class lookup ─────────────────────────────────────────────────────

/**
 * Read the current record_class for a subject directly from the root table.
 * Returns 'unknown' if the subject does not exist or has no class set.
 */
export async function getCurrentClass(
  subjectType: ClassificationSubjectType,
  subjectId: number
): Promise<CommercialClass> {
  switch (subjectType) {
    case "contact": {
      const [row] = await db.select({ recordClass: contacts.recordClass }).from(contacts).where(sql`${contacts.id} = ${subjectId}`).limit(1);
      return (row?.recordClass as CommercialClass | undefined) ?? "unknown";
    }
    case "deal": {
      const [row] = await db.select({ recordClass: deals.recordClass }).from(deals).where(sql`${deals.id} = ${subjectId}`).limit(1);
      return (row?.recordClass as CommercialClass | undefined) ?? "unknown";
    }
    case "prospect": {
      const [row] = await db.select({ recordClass: prospects.recordClass }).from(prospects).where(sql`${prospects.id} = ${subjectId}`).limit(1);
      return (row?.recordClass as CommercialClass | undefined) ?? "unknown";
    }
    case "company": {
      const [row] = await db.select({ recordClass: companies.recordClass }).from(companies).where(sql`${companies.id} = ${subjectId}`).limit(1);
      return (row?.recordClass as CommercialClass | undefined) ?? "unknown";
    }
  }
}

// ── Purpose-aware authorization gate ─────────────────────────────────────────

/**
 * authorizeUse — the canonical purpose-aware classification gate.
 *
 * Must be called before evaluateContactability() at every marketing/outreach
 * dispatch boundary. Returns fail-closed for unknown purposes.
 *
 * Purpose semantics:
 *   marketing_outreach    — ONLY production allowed; blocks unknown/test/demo/synthetic
 *   commercial_reporting  — ONLY production counts in metrics; blocks others
 *   financial_payout      — ONLY production included in payouts
 *   transactional_response — allows unknown (newly-submitted form contacts); blocks non-production
 *   internal_test         — test-only harness work; never permitted in a
 *                           non-test process
 */
export async function authorizeUse(params: {
  contactId?: number;
  subjectType?: ClassificationSubjectType;
  subjectId?: number;
  purpose: ClassificationPurpose;
}): Promise<ClassificationAuthResult> {
  const { purpose } = params;

  // `internal_test` must never become a production escape hatch. It exists only
  // for isolated test harnesses, whose database is separately verified before
  // application imports. A caller-controlled purpose string is not sufficient
  // authorization outside NODE_ENV=test.
  if (purpose === "internal_test") {
    if (process.env.NODE_ENV !== "test") {
      return {
        allowed: false,
        recordClass: "unknown",
        purpose,
        reasonCode: "COMMERCIAL_CLASS_CONFLICT",
        reason: "internal_test authorization is available only in NODE_ENV=test",
      };
    }
    return {
      allowed: true,
      recordClass: "unknown",
      purpose,
    };
  }

  const subjectType = params.subjectType ?? "contact";
  const subjectId = params.subjectId ?? params.contactId;

  if (!subjectId) {
    return {
      allowed: false,
      recordClass: "unknown",
      purpose,
      reasonCode: "COMMERCIAL_CLASS_UNKNOWN",
      reason: "No subject ID provided to authorizeUse",
    };
  }

  let recordClass: CommercialClass;
  try {
    recordClass = await getCurrentClass(subjectType, subjectId);
  } catch {
    // Fail closed on DB errors
    return {
      allowed: false,
      recordClass: "unknown",
      purpose,
      reasonCode: "COMMERCIAL_CLASS_CONFLICT",
      reason: "Classification lookup failed — failing closed",
    };
  }

  // Transactional response: allow unknown (form submissions), block everything else non-production
  if (purpose === "transactional_response") {
    if (recordClass === "production" || recordClass === "unknown") {
      return { allowed: true, recordClass, purpose };
    }
    return {
      allowed: false,
      recordClass,
      purpose,
      reasonCode: "COMMERCIAL_CLASS_NOT_PRODUCTION",
      reason: `Transactional response blocked for class '${recordClass}' — only production and unknown are permitted`,
    };
  }

  // All other purposes require production class
  if (recordClass !== "production") {
    if (recordClass === "unknown") {
      return {
        allowed: false,
        recordClass,
        purpose,
        reasonCode: "COMMERCIAL_CLASS_UNKNOWN",
        reason: `Subject is unclassified (unknown) — must be promoted to production before ${purpose}`,
      };
    }
    return {
      allowed: false,
      recordClass,
      purpose,
      reasonCode: "COMMERCIAL_CLASS_NOT_PRODUCTION",
      reason: `Commercial class '${recordClass}' is not eligible for ${purpose}`,
    };
  }

  return { allowed: true, recordClass, purpose };
}

// ── Classification transitions (requires approver for production) ─────────────

/**
 * applyClassification — single canonical write path for classification events.
 *
 * Idempotent: if (eventNamespace, eventKey) already exists, returns the
 * existing event without re-applying. Caller must verify evidence before calling.
 *
 * Role requirements: caller must have already verified admin role before calling.
 */
export async function applyClassification(
  command: ClassificationCommand
): Promise<{ eventId: number; applied: boolean; duplicate: boolean }> {
  assertSubjectType(command.subjectType);
  assertCommercialClass(command.targetClass);
  assertNoPii(command.evidenceFields);
  if (
    command.targetClass === "production" &&
    (!command.actorId || !command.approverId || command.approverId === command.actorId)
  ) {
    throw new Error(
      "Production classification requires a distinct authorized approver and immutable evidence."
    );
  }

  const evidenceHash = hashEvidence(command.evidenceFields);

  return db.transaction(async (tx) => {
    // The event key is globally unique, not unique per subject. Lock it before
    // looking up or changing a root so conflicting reuse on different subjects
    // cannot leave an unjournaled projection update behind.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`${command.eventNamespace}:${command.eventKey}`}))
    `);

    // A same replay returns duplicate; a same key with different commercial
    // facts is an error before any projection can be changed.
    const existing = rows(await tx.execute(sql`
      SELECT id, subject_type, subject_id, new_class, evidence_hash, actor_id, approver_id
      FROM commercial_classification_events
      WHERE event_namespace = ${command.eventNamespace}
        AND event_key = ${command.eventKey}
      LIMIT 1
    `))[0];

    if (existing) {
      const matches =
        existing.subject_type === command.subjectType &&
        Number(existing.subject_id) === command.subjectId &&
        existing.new_class === command.targetClass &&
        existing.evidence_hash === evidenceHash &&
        (existing.actor_id ?? null) === (command.actorId ?? null) &&
        (existing.approver_id ?? null) === (command.approverId ?? null);
      if (!matches) {
        throw new Error("Classification idempotency key collision: replay payload differs from the immutable event.");
      }
      return { eventId: existing.id as number, applied: false, duplicate: true };
    }

    // Lock and verify the real root only after the global event-key reservation.
    const priorClass = await getCurrentClassInTransaction(tx, command.subjectType, command.subjectId);
    if (command.targetClass === "production") {
      const linkedClasses = await getLinkedClassesInTransaction(tx, command.subjectType, command.subjectId);
      if (linkedClasses.some((value) => value !== "production")) {
        throw new Error(
          "COMMERCIAL_CLASS_CONFLICT: production promotion requires every linked commercial root to be independently classified production."
        );
      }
    }

    // Update first. The event insertion below is in the same transaction, so
    // a failed immutable event rolls this projection back with no silent drift.
    await applyClassToSubject(tx, command.subjectType, command.subjectId, command.targetClass as CommercialClass);

    // Insert immutable event only after the subject projection has changed.
    const [event] = rows(await tx.execute(sql`
      INSERT INTO commercial_classification_events
        (subject_type, subject_id, event_namespace, event_key, policy_version,
         prior_class, new_class, evidence_hash, evidence_fields, actor_id, approver_id, created_at)
      VALUES
        (${command.subjectType}, ${command.subjectId}, ${command.eventNamespace},
         ${command.eventKey}, ${CLASSIFICATION_POLICY_VERSION},
         ${priorClass}, ${command.targetClass}, ${evidenceHash},
         ${JSON.stringify(command.evidenceFields)}::jsonb,
         ${command.actorId ?? null}, ${command.approverId ?? null}, now())
      RETURNING id
    `));

    if (!event) {
      // The advisory lock makes this impossible for authority callers. Throwing
      // rolls back the projection if an out-of-band writer races us.
      throw new Error("Could not reserve immutable commercial classification event.");
    }

    return { eventId: event.id as number, applied: true, duplicate: false };
  });
}

/** Resolve an inherited class for a new deal. Any absent or disagreeing source
 * remains quarantined; production is inherited only from verified production roots. */
export async function deriveLinkedDealClass(
  contactId?: number | null,
  companyId?: number | null,
): Promise<CommercialClass> {
  const classes: CommercialClass[] = [];
  if (contactId) classes.push(await getCurrentClass("contact", contactId));
  if (companyId) classes.push(await getCurrentClass("company", companyId));
  return classes.length > 0 && classes.every((value) => value === "production")
    ? "production"
    : "unknown";
}

async function getLinkedClassesInTransaction(
  tx: any,
  subjectType: ClassificationSubjectType,
  subjectId: number,
): Promise<CommercialClass[]> {
  if (subjectType === "deal") {
    const row = rows(await tx.execute(sql`
      SELECT c.record_class AS contact_class, co.record_class AS company_class
      FROM deals d
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN companies co ON co.id = d.company_id
      WHERE d.id = ${subjectId}
      FOR UPDATE
    `))[0];
    return [row?.contact_class, row?.company_class]
      .filter((value): value is CommercialClass => typeof value === "string");
  }
  if (subjectType === "prospect") {
    const row = rows(await tx.execute(sql`
      SELECT c.record_class AS contact_class
      FROM prospects p LEFT JOIN contacts c ON c.id = p.contact_id
      WHERE p.id = ${subjectId} FOR UPDATE
    `))[0];
    return typeof row?.contact_class === "string" ? [row.contact_class as CommercialClass] : [];
  }
  return [];
}

async function getCurrentClassInTransaction(
  tx: any,
  subjectType: ClassificationSubjectType,
  subjectId: number
): Promise<CommercialClass> {
  const tableName = {
    contact: "contacts",
    deal: "deals",
    prospect: "prospects",
    company: "companies",
  }[subjectType];
  const result = rows(await tx.execute(sql`
    SELECT record_class FROM ${sql.identifier(tableName)}
    WHERE id = ${subjectId}
    FOR UPDATE
  `))[0];
  if (!result) {
    throw new Error(`Commercial classification subject ${subjectType}:${subjectId} does not exist.`);
  }
  return (result.record_class as CommercialClass | undefined) ?? "unknown";
}

async function applyClassToSubject(
  tx: any,
  subjectType: ClassificationSubjectType,
  subjectId: number,
  newClass: CommercialClass
): Promise<void> {
  let updated: any[];
  switch (subjectType) {
    case "contact":
      updated = rows(await tx.execute(sql`UPDATE contacts SET record_class = ${newClass} WHERE id = ${subjectId} RETURNING id`));
      break;
    case "deal":
      updated = rows(await tx.execute(sql`UPDATE deals SET record_class = ${newClass} WHERE id = ${subjectId} RETURNING id`));
      break;
    case "prospect":
      updated = rows(await tx.execute(sql`UPDATE prospects SET record_class = ${newClass} WHERE id = ${subjectId} RETURNING id`));
      break;
    case "company":
      updated = rows(await tx.execute(sql`UPDATE companies SET record_class = ${newClass} WHERE id = ${subjectId} RETURNING id`));
      break;
  }
  if (!updated?.length) {
    throw new Error(`Commercial classification subject ${subjectType}:${subjectId} disappeared before update.`);
  }
}

// ── Preview/approve/execute workflow ─────────────────────────────────────────

/**
 * createPreviewCommand — creates a preview command for admin review before execution.
 * Returns 409 if versionLock conflicts with existing command status.
 */
export async function createPreviewCommand(
  params: ClassificationPreviewCommand
): Promise<{ commandId: string; status: "created" | "duplicate" }> {
  assertNoPii(params.evidenceFields);

  const inserted = await db
    .insert(commercialClassificationCommands)
    .values({
      idempotencyKey: params.idempotencyKey as any,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      targetClass: params.targetClass,
      status: "preview",
      requestedBy: params.requestedBy ?? null,
      evidenceFields: params.evidenceFields,
      versionLock: 0,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return { commandId: inserted[0].id, status: "created" };
  }

  const [existing] = await db
    .select({ id: commercialClassificationCommands.id })
    .from(commercialClassificationCommands)
    .where(sql`idempotency_key = ${params.idempotencyKey}`)
    .limit(1);

  return { commandId: existing?.id ?? "", status: "duplicate" };
}

/**
 * approveCommand — admin-role gate; moves command from preview → approved.
 * Uses optimistic version locking; returns 409 on stale version.
 */
export async function approveCommand(
  params: ApproveCommandParams
): Promise<{ approved: boolean; conflict: boolean }> {
  const result = rows(await db.execute(sql`
    UPDATE commercial_classification_commands
    SET status = 'approved',
        approved_by = ${params.approvedBy},
        approved_at = now(),
        version_lock = version_lock + 1,
        updated_at = now()
    WHERE id = ${params.commandId}
      AND version_lock = ${params.versionLock}
      AND status = 'preview'
    RETURNING id
  `));

  if (result.length === 0) {
    return { approved: false, conflict: true };
  }
  return { approved: true, conflict: false };
}

/**
 * executeApprovedCommand — executes an approved command, producing a classification event.
 * Idempotent: safe to retry on network failure.
 */
export async function executeApprovedCommand(
  commandId: string,
  actorId: string
): Promise<{ executed: boolean; eventId?: number; reason?: string }> {
  const cmdResult = rows(await db.execute(sql`
    SELECT id, subject_type, subject_id, target_class, evidence_fields, requested_by, approved_by, version_lock
    FROM commercial_classification_commands
    WHERE id = ${commandId} AND status = 'approved'
    LIMIT 1
  `))[0];

  if (!cmdResult) {
    return { executed: false, reason: "Command not found or not in approved state" };
  }

  const eventNamespace = "bt06:command";
  const eventKey = `cmd:${commandId}`;
  const evidenceFields = (cmdResult.evidence_fields as Record<string, unknown>) ?? {};

  assertNoPii(evidenceFields);

  const { eventId, applied, duplicate } = await applyClassification({
    subjectType: cmdResult.subject_type as ClassificationSubjectType,
    subjectId: cmdResult.subject_id as number,
    targetClass: cmdResult.target_class as CommercialClass,
    eventNamespace,
    eventKey,
    evidenceFields: { ...evidenceFields, commandId },
    // The immutable event actor is the original requester; the invoking admin
    // is the executor and the independently recorded approver is preserved
    // separately. This prevents an approve+execute action from erasing the
    // requester/approver separation required for a production promotion.
    actorId: (cmdResult.requested_by as string | undefined) ?? actorId,
    approverId: cmdResult.approved_by as string | undefined,
  });

  if (applied || duplicate) {
    // Mark command as executed
    await db.execute(sql`
      UPDATE commercial_classification_commands
      SET status = 'executed',
          executed_at = now(),
          updated_at = now(),
          version_lock = version_lock + 1
      WHERE id = ${commandId}
    `);
    return { executed: true, eventId };
  }

  return { executed: false, reason: "Classification event conflict" };
}

// ── Reconciliation helpers ────────────────────────────────────────────────────

export interface ReconciliationReport {
  aggregateType: string;
  aggregateKey: string;
  policyVersion: number;
  sourceRowCount: number;
  productionCount: number;
  excludedCount: number;
  unknownCount: number;
  lineageHwm: Date | null;
  computedAt: Date;
}

/**
 * recordAggregateLineage — stores lineage metadata for one KPI rebuild.
 * Call once per rebuild after computing production-only aggregates.
 */
export async function recordAggregateLineage(params: {
  aggregateType: string;
  aggregateKey: string;
  sourceRowCount: number;
  productionCount: number;
  excludedCount: number;
  unknownCount: number;
  lineageHwm?: Date;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO commercial_aggregate_lineage
      (aggregate_type, aggregate_key, policy_version,
       source_row_count, production_count, excluded_count, unknown_count,
       lineage_hwm, computed_at)
    VALUES
      (${params.aggregateType}, ${params.aggregateKey}, ${CLASSIFICATION_POLICY_VERSION},
       ${params.sourceRowCount}, ${params.productionCount}, ${params.excludedCount},
       ${params.unknownCount}, ${params.lineageHwm ?? null}, now())
  `);
}

/**
 * getReconciliationReport — read-only summary of lineage for a key.
 */
export async function getReconciliationReport(
  aggregateType: string,
  aggregateKey: string
): Promise<ReconciliationReport | null> {
  const result = rows(await db.execute(sql`
    SELECT aggregate_type, aggregate_key, policy_version,
           source_row_count, production_count, excluded_count, unknown_count,
           lineage_hwm, computed_at
    FROM commercial_aggregate_lineage
    WHERE aggregate_type = ${aggregateType} AND aggregate_key = ${aggregateKey}
    ORDER BY computed_at DESC
    LIMIT 1
  `))[0];

  if (!result) return null;

  return {
    aggregateType: result.aggregate_type as string,
    aggregateKey: result.aggregate_key as string,
    policyVersion: result.policy_version as number,
    sourceRowCount: result.source_row_count as number,
    productionCount: result.production_count as number,
    excludedCount: result.excluded_count as number,
    unknownCount: result.unknown_count as number,
    lineageHwm: result.lineage_hwm ? new Date(result.lineage_hwm as string) : null,
    computedAt: new Date(result.computed_at as string),
  };
}

// ── Bulk classification count helpers ─────────────────────────────────────────

/**
 * getClassificationCounts — admin-only read of class distribution.
 * Returns counts by class for contacts (redacted for non-admin display).
 */
export async function getContactClassCounts(): Promise<Record<CommercialClass, number>> {
  const result = rows(await db.execute(sql`
    SELECT record_class, COUNT(*)::int AS cnt
    FROM contacts
    WHERE archived_at IS NULL
    GROUP BY record_class
  `));

  const counts: Record<string, number> = {
    production: 0, test: 0, demo: 0, synthetic: 0, unknown: 0,
  };
  for (const row of result) {
    const cls = row.record_class as string;
    counts[cls] = (counts[cls] ?? 0) + (row.cnt as number);
  }
  return counts as Record<CommercialClass, number>;
}
