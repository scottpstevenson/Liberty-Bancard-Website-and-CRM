import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { IDENTITY_NORMALIZATION_VERSION } from "./contact-identity";
import { sanitizeAuditPayload } from "./audit-sanitizer";
import { lockCommercialGraph } from "./commercial-graph-locks";

export const CONTACT_MERGE_MANIFEST_VERSION = 2;
export type Disposition = "transfer" | "immutable_retain" | "terminalize" | "authority_handoff" | "manual_block";
export type ManifestEntry = { key: string; table?: string; column?: string; rowIdColumn?: string; disposition: Disposition };

// This is deliberately source-code owned. It is never assembled from database
// metadata or an operator supplied table name. The checker compares this list
// against PostgreSQL's FK catalog on every CI run.
export const CONTACT_MERGE_MANIFEST: readonly ManifestEntry[] = [
  ...["calendar_events","call_logs","chargebacks","co_branded_proposals","contact_ai_cache","contact_companies",
    "contact_lead_scoring_jobs","deals","documents","enrichment_runs","equipment_orders","equipment_shipments",
    "ghl_activity_log","health_alerts","inbox_items","lead_sources","live_chats","merchant_applications",
    "merchant_health_scores","merchant_mids","merchant_profiles","merchant_residuals","mid_daily_stats",
    "nps_responses","promotional_enrollment_jobs","prospects","rate_review_requests","referrals",
    "review_requests","rfis","save_cases","sdr_lead_state","statement_proposals","statement_requests","statement_reviews",
    "sync_conflicts","tasks","testimonial_submissions","tickets","contact_nba"].map(table => ({ key: table, table, column: "contact_id", disposition: "transfer" as const })),
  // Sequence history and active work are never reassigned by a contact merge.
  // Active deprecated work is an explicit preflight block; completed history
  // stays attached to the original contact.
  { key: "sequence_enrollments", table: "sequence_enrollments", column: "contact_id", disposition: "immutable_retain" },
  { key: "statement_upload_commands", table: "statement_upload_commands", column: "contact_id", disposition: "transfer" },
  { key: "ma_events_counterparty", table: "ma_events", column: "counterparty_contact_id", disposition: "transfer" },
  { key: "merchant_referrals_referred", table: "merchant_referrals", column: "referred_contact_id", disposition: "transfer" },
  { key: "prospects_conversion", table: "prospects", column: "conversion_contact_id", disposition: "transfer" },
  { key: "contacts_parent", table: "contacts", column: "parent_contact_id", disposition: "manual_block" },
  { key: "communication_events", table: "communication_events", column: "contact_id", disposition: "immutable_retain" },
  { key: "email_logs", table: "email_logs", column: "contact_id", disposition: "immutable_retain" },
  { key: "consent_audit_logs", table: "consent_audit_logs", column: "contact_id", disposition: "immutable_retain" },
  { key: "contact_source_events", table: "contact_source_events", column: "contact_id", disposition: "immutable_retain" },
  { key: "contact_lifecycle_history", table: "contact_lifecycle_history", column: "contact_id", disposition: "immutable_retain" },
  { key: "ai_decision_log", table: "ai_decision_log", column: "contact_id", disposition: "immutable_retain" },
  { key: "ai_corrections", table: "ai_corrections", column: "contact_id", disposition: "immutable_retain" },
  { key: "nba_recommendation_history", table: "nba_recommendation_history", column: "contact_id", disposition: "immutable_retain" },
  { key: "contact_identity_observations", table: "contact_identity_observations", column: "contact_id", disposition: "immutable_retain" },
  // CRO-02 append-only graph evidence is retained against the deprecated
  // identity; readers resolve it through BT-07 redirects. Candidates are not
  // promoted by a merge and are retained for audit/review rather than silently
  // transferred into a new assertion.
  { key: "contact_business_link_decisions", table: "contact_business_link_decisions", column: "contact_id", disposition: "immutable_retain" },
  { key: "contact_business_link_decisions_evidence_identity", table: "contact_business_link_decisions", column: "id", disposition: "immutable_retain" },
  { key: "commercial_relationship_candidates", table: "commercial_relationship_candidates", column: "contact_id", disposition: "immutable_retain" },
  { key: "commercial_relationship_candidates_evidence_identity", table: "commercial_relationship_candidates", column: "id", disposition: "immutable_retain" },
  { key: "commercial_relationship_reviews", table: "commercial_relationship_reviews", column: "contact_id", disposition: "immutable_retain" },
  { key: "commercial_relationship_reviews_evidence_identity", table: "commercial_relationship_reviews", column: "id", disposition: "immutable_retain" },
  { key: "import_row_dispositions", table: "import_row_dispositions", column: "contact_id", disposition: "immutable_retain" },
  { key: "eligibility_snapshots", table: "eligibility_snapshots", column: "contact_id", disposition: "immutable_retain" },
  { key: "contact_provider_projections", table: "contact_provider_projections", column: "contact_id", disposition: "terminalize" },
  { key: "validation_intents", table: "validation_intents", column: "contact_id", disposition: "terminalize" },
  // A frozen campaign preview is immutable queue authority. Reassigning it
  // would change a reviewed audience, while retaining it could enqueue the
  // archived identity later, so an operator must resolve it before merging.
  { key: "campaign_preview_members", table: "campaign_preview_members", column: "contact_id", rowIdColumn: "preview_id", disposition: "manual_block" },
  { key: "contact_merge_operations_survivor", table: "contact_merge_operations", column: "survivor_contact_id", disposition: "immutable_retain" },
  { key: "contact_merge_operations_deprecated", table: "contact_merge_operations", column: "deprecated_contact_id", disposition: "immutable_retain" },
  { key: "contact_merge_redirects_survivor", table: "contact_merge_redirects", column: "survivor_contact_id", disposition: "immutable_retain" },
  { key: "contact_merge_redirects_deprecated", table: "contact_merge_redirects", column: "deprecated_contact_id", disposition: "immutable_retain" },
  // Legacy delivery history table retained in deployed databases. It is
  // immutable evidence and is never touched by a reviewed merge.
  { key: "outbound_send_log", table: "outbound_send_log", column: "contact_id", disposition: "immutable_retain" },
  { key: "outbound_messages", table: "outbound_messages", column: "contact_id", disposition: "terminalize" },
  { key: "consent_subject_graph", disposition: "authority_handoff" },
  { key: "record_class", disposition: "manual_block" },
] as const;

const TRANSFER_ENTRIES = CONTACT_MERGE_MANIFEST.filter((entry) => entry.disposition === "transfer" && entry.table && entry.column);
const DEPENDENCY_FINGERPRINT_ENTRIES = CONTACT_MERGE_MANIFEST.filter((entry) =>
  entry.table && entry.column
  && !entry.key.endsWith("_evidence_identity")
  && !entry.key.startsWith("contact_merge_operations")
  && !entry.key.startsWith("contact_merge_redirects"),
);
function dbIdLiteral(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}
type ResultRows = { rows?: any[] };
const rows = (result: unknown) => ((result as ResultRows).rows ?? []) as any[];
const rowIdColumn = (entry: ManifestEntry) => entry.rowIdColumn ?? "id";
const nowRevision = (contact: any) => new Date(contact.updated_at ?? contact.updatedAt ?? contact.created_at ?? contact.createdAt ?? 0).toISOString();
const contactFingerprint = (contact: any) => crypto.createHash("sha256").update(JSON.stringify({
  id: contact.id, revision: nowRevision(contact), recordClass: contact.record_class,
  ghlContactId: contact.ghl_contact_id, archivedAt: contact.archived_at,
  // GHL inbound synchronization can intentionally preserve updated_at. Raw
  // compatibility identities therefore belong in the optimistic fingerprint.
  email: contact.email ?? null, phone: contact.phone ?? null,
})).digest("hex");
const previewHash = (payload: unknown) => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
async function blockMergeOperation(tx: any, operationId: string, reason: string) {
  await tx.execute(sql`
    UPDATE contact_merge_operations
    SET status = 'blocked', conflict_reason = ${reason}, updated_at = now()
    WHERE id = ${operationId} AND status IN ('previewed', 'approved')
  `);
}

export class ContactMergeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export type MergePreview = {
  operationId: string;
  previewHash: string;
  survivorContactId: number;
  deprecatedContactId: number;
  relationshipCounts: Record<string, number>;
  conflicts: string[];
  contactVersions: Record<string, string>;
  evidence: Array<{ identityKind: string; lookupToken: string; confidence: number }>;
  relationshipFingerprints: Record<string, string>;
};

function assertPair(survivorContactId: number, deprecatedContactId: number) {
  if (!Number.isInteger(survivorContactId) || !Number.isInteger(deprecatedContactId) || survivorContactId <= 0 || deprecatedContactId <= 0 || survivorContactId === deprecatedContactId) {
    throw new ContactMergeError("INVALID_CONTACT_PAIR", "A distinct survivor and deprecated contact are required");
  }
}

async function readContactsForUpdate(tx: any, a: number, b: number) {
  const [first, second] = [a, b].sort((x, y) => x - y);
  const locked = rows(await tx.execute(sql`SELECT * FROM contacts WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`));
  if (locked.length !== 2) throw new ContactMergeError("CONTACT_NOT_FOUND", "Both contacts must exist");
  return new Map(locked.map((contact: any) => [Number(contact.id), contact]));
}

async function relationshipCounts(executor: any, deprecatedContactId: number) {
  const result: Record<string, number> = {};
  for (const entry of CONTACT_MERGE_MANIFEST.filter(
    e => e.table && e.column && !e.key.endsWith("_evidence_identity"),
  )) {
    const table = entry.table!;
    const column = entry.column!;
    const countRows = rows(await executor.execute(sql.raw(`SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" = ${Number(deprecatedContactId)}`)));
    result[entry.key] = Number(countRows[0]?.count ?? 0);
  }
  return result;
}

async function relationshipSetFingerprint(executor: any, contactId: number) {
  const parts: string[] = [];
  for (const entry of DEPENDENCY_FINGERPRINT_ENTRIES) {
    const identityColumn = rowIdColumn(entry);
    const records = rows(await executor.execute(sql.raw(
      `SELECT "${identityColumn}" AS id, md5(row_to_json(t)::text) AS record_hash FROM "${entry.table}" t WHERE "${entry.column}" = ${contactId} ORDER BY "${identityColumn}"`,
    )));
    parts.push(`${entry.key}:${records.map((record: any) => `${record.id}:${record.record_hash}`).join(",")}`);
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}
async function lockRelationshipRows(executor: any, survivorContactId: number, deprecatedContactId: number) {
  // Preview/execution relationship state is safety-critical: lock every
  // classified pointer before comparing fingerprints so no new source row can
  // appear between stale detection and transfer.
  for (const entry of DEPENDENCY_FINGERPRINT_ENTRIES) {
    const identityColumn = rowIdColumn(entry);
    await executor.execute(sql.raw(
      `SELECT "${identityColumn}" FROM "${entry.table}" WHERE "${entry.column}" IN (${survivorContactId}, ${deprecatedContactId}) FOR UPDATE`,
    ));
  }
}

async function buildPreviewData(executor: any, survivorContactId: number, deprecatedContactId: number) {
  // This is deliberately the same identity-bearing field set as the locked
  // execution read. Inbound GHL updates may preserve updated_at, so the
  // optimistic fingerprint must still invalidate a changed raw identity.
  const contacts = rows(await executor.execute(sql`SELECT id, email, phone, updated_at, created_at, record_class, ghl_contact_id, archived_at FROM contacts WHERE id IN (${survivorContactId}, ${deprecatedContactId})`));
  if (contacts.length !== 2) throw new ContactMergeError("CONTACT_NOT_FOUND", "Both contacts must exist");
  const byId = new Map(contacts.map((contact: any) => [Number(contact.id), contact]));
  const survivor = byId.get(survivorContactId)!;
  const deprecated = byId.get(deprecatedContactId)!;
  const evidence = rows(await executor.execute(sql`
    SELECT a.identity_kind, a.lookup_token, LEAST(a.confidence, b.confidence)::int AS confidence
    FROM contact_identity_observations a
    JOIN contact_identity_observations b
      ON b.identity_kind = a.identity_kind AND b.lookup_token = a.lookup_token
    WHERE a.contact_id = ${survivorContactId} AND b.contact_id = ${deprecatedContactId}
      AND a.eligibility = 'eligible' AND b.eligibility = 'eligible'
      AND a.superseded_at IS NULL AND b.superseded_at IS NULL
  `));
  // Candidate groups are connected components, not a one-hop token lookup:
  // A—B and B—C evidence must remain reviewable as one operator-visible set.
  // This does not automatically merge transitive contacts; it only permits an
  // explicit reviewed pair to be previewed with its graph evidence.
  const sameComponent = rows(await executor.execute(sql`
    WITH RECURSIVE component(contact_id) AS (
      SELECT ${survivorContactId}::integer
      UNION
      SELECT matched.contact_id
      FROM component member
      JOIN contact_identity_observations source
        ON source.contact_id = member.contact_id
       AND source.eligibility = 'eligible' AND source.superseded_at IS NULL
      JOIN contact_identity_observations matched
        ON matched.identity_kind = source.identity_kind
       AND matched.lookup_token = source.lookup_token
       AND matched.eligibility = 'eligible' AND matched.superseded_at IS NULL
    )
    SELECT count(*)::int AS count FROM component
    WHERE contact_id IN (${survivorContactId}, ${deprecatedContactId})
  `))[0];
  const conflicts: string[] = [];
  if (survivor.archived_at || deprecated.archived_at) conflicts.push("ARCHIVED_CONTACT");
  if (survivor.record_class !== deprecated.record_class) conflicts.push("RECORD_CLASS_MISMATCH");
  if (survivor.ghl_contact_id && deprecated.ghl_contact_id) {
    conflicts.push(survivor.ghl_contact_id === deprecated.ghl_contact_id ? "SAME_GHL_ID_MANUAL_REVIEW" : "DISTINCT_GHL_IDS");
  }
  if (evidence.length === 0 && Number(sameComponent?.count ?? 0) !== 2) conflicts.push("INSUFFICIENT_ELIGIBLE_IDENTITY_EVIDENCE");
  const activeEnrollment = rows(await executor.execute(sql`
    SELECT 1 FROM sequence_enrollments
    WHERE contact_id = ${deprecatedContactId} AND status IN ('active','paused') LIMIT 1
  `))[0];
  if (activeEnrollment) conflicts.push("ACTIVE_ENROLLMENT_REQUIRES_REVIEW");
  // statement_proposals has a partial unique index on deal_id. A blind
  // transfer could turn two valid proposal records into an opaque database
  // error, so surface the exact conflict during review and block execution.
  const proposalDealConflict = rows(await executor.execute(sql`
    SELECT 1
    FROM statement_proposals deprecated_proposal
    JOIN statement_proposals survivor_proposal
      ON survivor_proposal.deal_id = deprecated_proposal.deal_id
     AND survivor_proposal.deal_id IS NOT NULL
    WHERE deprecated_proposal.contact_id = ${deprecatedContactId}
      AND survivor_proposal.contact_id = ${survivorContactId}
    LIMIT 1
  `))[0];
  if (proposalDealConflict) conflicts.push("STATEMENT_PROPOSAL_DEAL_UNIQUENESS_CONFLICT");
  const blockedPointers = CONTACT_MERGE_MANIFEST.filter(entry => entry.disposition === "manual_block" && entry.table && entry.column);
  for (const entry of blockedPointers) {
    const blocked = rows(await executor.execute(sql.raw(`SELECT 1 FROM "${entry.table}" WHERE "${entry.column}" = ${deprecatedContactId} LIMIT 1`)))[0];
    if (blocked) conflicts.push(`MANUAL_BLOCK_${entry.key.toUpperCase()}`);
  }
  const relationshipFingerprints = {
    [survivorContactId]: await relationshipSetFingerprint(executor, survivorContactId),
    [deprecatedContactId]: await relationshipSetFingerprint(executor, deprecatedContactId),
  };
  return {
    evidence: evidence.length
      ? evidence.map((row: any) => ({ identityKind: row.identity_kind, lookupToken: row.lookup_token, confidence: Number(row.confidence) }))
      : [{ identityKind: "component_path", lookupToken: "redacted", confidence: 0 }],
    conflicts,
    relationshipCounts: await relationshipCounts(executor, deprecatedContactId),
    contactVersions: {
      [survivorContactId]: `${nowRevision(survivor)}:${contactFingerprint(survivor)}`,
      [deprecatedContactId]: `${nowRevision(deprecated)}:${contactFingerprint(deprecated)}`,
    },
    relationshipFingerprints,
  };
}

export async function findIdentityCandidates(contactId: number) {
  return rows(await db.execute(sql`
    WITH RECURSIVE component(contact_id) AS (
      SELECT ${contactId}::integer
      UNION
      SELECT matched.contact_id
      FROM component member
      JOIN contact_identity_observations source
        ON source.contact_id = member.contact_id
       AND source.eligibility = 'eligible' AND source.superseded_at IS NULL
      JOIN contact_identity_observations matched
        ON matched.identity_kind = source.identity_kind
       AND matched.lookup_token = source.lookup_token
       AND matched.eligibility = 'eligible' AND matched.superseded_at IS NULL
    )
    SELECT DISTINCT candidate.id, candidate.first_name, candidate.last_name, candidate.company_name,
      candidate.record_class, candidate.archived_at,
      'component_path'::text AS identity_kind, 'redacted'::text AS lookup_token, 0::int AS confidence
    FROM component
    JOIN contacts candidate ON candidate.id = component.contact_id
    WHERE candidate.id <> ${contactId} AND candidate.archived_at IS NULL
    ORDER BY candidate.id
  `));
}

export async function previewContactMerge(input: {
  survivorContactId: number; deprecatedContactId: number; idempotencyKey: string; actorId: string; actorRole: "admin" | "manager"; fieldDecisions: Record<string, string>;
}): Promise<MergePreview> {
  assertPair(input.survivorContactId, input.deprecatedContactId);
  if (!input.fieldDecisions || Object.keys(input.fieldDecisions).length === 0) {
    throw new ContactMergeError("FIELD_DECISIONS_REQUIRED", "Explicit field decisions are required before a merge preview");
  }
  return db.transaction(async (tx) => {
    const existing = rows(await tx.execute(sql`SELECT * FROM contact_merge_operations WHERE idempotency_key = ${input.idempotencyKey} FOR UPDATE`))[0];
    if (existing) {
      if (Number(existing.survivor_contact_id) !== input.survivorContactId || Number(existing.deprecated_contact_id) !== input.deprecatedContactId) {
        throw new ContactMergeError("IDEMPOTENCY_KEY_REUSED", "The operation key has already been used for another contact pair");
      }
      const data = await buildPreviewData(tx, input.survivorContactId, input.deprecatedContactId);
      return { operationId: existing.id, previewHash: existing.preview_hash, survivorContactId: input.survivorContactId, deprecatedContactId: input.deprecatedContactId, ...data };
    }
    const data = await buildPreviewData(tx, input.survivorContactId, input.deprecatedContactId);
    // A new explicit review supersedes any unresolved prior review of this
    // unordered pair. Evidence remains durable, but the partial unique pair
    // fence is released so stale/conflicted work never dead-ends the operator.
    await tx.execute(sql`
      UPDATE contact_merge_operations
      SET status = 'blocked', conflict_reason = 'SUPERSEDED_BY_FRESH_PREVIEW', updated_at = now()
      WHERE status IN ('previewed', 'approved')
        AND LEAST(survivor_contact_id, deprecated_contact_id) = LEAST(${input.survivorContactId}::integer, ${input.deprecatedContactId}::integer)
        AND GREATEST(survivor_contact_id, deprecated_contact_id) = GREATEST(${input.survivorContactId}::integer, ${input.deprecatedContactId}::integer)
    `);
    const hash = previewHash({ survivor: input.survivorContactId, deprecated: input.deprecatedContactId, versions: data.contactVersions, relationships: data.relationshipFingerprints, fieldDecisions: input.fieldDecisions, manifest: CONTACT_MERGE_MANIFEST_VERSION });
    const initialStatus = data.conflicts.length ? "blocked" : "previewed";
    const initialConflict = data.conflicts[0] ?? null;
    const op = rows(await tx.execute(sql`
      INSERT INTO contact_merge_operations (
        idempotency_key, survivor_contact_id, deprecated_contact_id, status, actor_id, actor_role,
        manifest_version, normalization_version, preview_hash, contact_versions, field_decisions
      ) VALUES (
        ${input.idempotencyKey}, ${input.survivorContactId}, ${input.deprecatedContactId}, ${initialStatus},
        ${input.actorId}, ${input.actorRole}, ${CONTACT_MERGE_MANIFEST_VERSION}, ${IDENTITY_NORMALIZATION_VERSION},
        ${hash}, ${{
          ...data.contactVersions,
          relationshipFingerprints: data.relationshipFingerprints,
        }}, ${input.fieldDecisions}
      ) RETURNING id
    `))[0];
    if (initialConflict) {
      await tx.execute(sql`UPDATE contact_merge_operations SET conflict_reason = ${initialConflict} WHERE id = ${op.id}`);
    }
    return { operationId: op.id, previewHash: hash, survivorContactId: input.survivorContactId, deprecatedContactId: input.deprecatedContactId, ...data };
  });
}

export async function approveContactMerge(operationId: string, actorId: string) {
  const result = rows(await db.execute(sql`
    UPDATE contact_merge_operations
    SET status = 'approved', approved_at = now(), updated_at = now()
    WHERE id = ${operationId} AND status = 'previewed'
    RETURNING *
  `))[0];
  if (!result) throw new ContactMergeError("OPERATION_NOT_APPROVABLE", "The merge preview is no longer approvable");
  // Actor attribution on the operation remains the preview creator; immutable
  // audit details attribute approval to the authenticated admin.
  await db.execute(sql`INSERT INTO audit_logs (action, entity_type, entity_key, actor_type, actor_id, details)
    VALUES ('contact_merge_approved', 'contact_merge', ${operationId}, 'user', ${actorId},
      ${JSON.stringify(sanitizeAuditPayload({ operationId }))}::jsonb)`);
  return result;
}

export async function executeContactMerge(operationId: string, actorId: string) {
  let operation: any;
  try {
  operation = await db.transaction(async (tx) => {
    const hint = rows(await tx.execute(sql`SELECT survivor_contact_id,deprecated_contact_id
      FROM contact_merge_operations WHERE id=${operationId}`))[0];
    if (!hint) throw new ContactMergeError("OPERATION_NOT_FOUND", "Merge operation was not found");
    await lockCommercialGraph(tx, [
      { type: "contact", id: Number(hint.survivor_contact_id) },
      { type: "contact", id: Number(hint.deprecated_contact_id) },
    ], ["contact_redirect"]);
    const initial = rows(await tx.execute(sql`SELECT * FROM contact_merge_operations WHERE id = ${operationId} FOR UPDATE`))[0];
    if (!initial) throw new ContactMergeError("OPERATION_NOT_FOUND", "Merge operation was not found");
    if (["committed", "reconciliation_pending", "completed"].includes(initial.status)) return initial;
    if (initial.status !== "approved") throw new ContactMergeError("OPERATION_NOT_APPROVED", "Merge operation must be approved before execution");

    const survivorId = Number(initial.survivor_contact_id);
    const deprecatedId = Number(initial.deprecated_contact_id);
    const contacts = await readContactsForUpdate(tx, survivorId, deprecatedId);
    const survivor = contacts.get(survivorId)!;
    const deprecated = contacts.get(deprecatedId)!;
    const expected = initial.contact_versions as Record<string, string>;
    if (expected[String(survivorId)] !== `${nowRevision(survivor)}:${contactFingerprint(survivor)}` || expected[String(deprecatedId)] !== `${nowRevision(deprecated)}:${contactFingerprint(deprecated)}`) {
      await blockMergeOperation(tx, operationId, "STALE_PREVIEW");
      throw new ContactMergeError("STALE_PREVIEW", "One or both contacts changed after preview");
    }
    const overlap = rows(await tx.execute(sql`
      SELECT 1 FROM contact_merge_redirects WHERE active AND deprecated_contact_id IN (${survivorId}, ${deprecatedId}) LIMIT 1
    `))[0];
    if (overlap) {
      await blockMergeOperation(tx, operationId, "OVERLAPPING_MERGE");
      throw new ContactMergeError("OVERLAPPING_MERGE", "A contact already has an active merge redirect");
    }
    const activeOperation = rows(await tx.execute(sql`
      SELECT 1 FROM contact_merge_operations
      WHERE id <> ${operationId} AND status IN ('approved', 'executing', 'committed', 'reconciliation_pending', 'completed')
        AND (${survivorId} IN (survivor_contact_id, deprecated_contact_id) OR ${deprecatedId} IN (survivor_contact_id, deprecated_contact_id))
      LIMIT 1 FOR UPDATE
    `))[0];
    if (activeOperation) {
      const conflict = rows(await tx.execute(sql`
        SELECT id, status FROM contact_merge_operations
        WHERE id <> ${operationId} AND status IN ('approved', 'executing', 'committed', 'reconciliation_pending', 'completed')
          AND (${survivorId} IN (survivor_contact_id, deprecated_contact_id) OR ${deprecatedId} IN (survivor_contact_id, deprecated_contact_id))
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE
      `))[0];
      if (conflict?.status === "approved") {
        await tx.execute(sql`UPDATE contact_merge_operations SET status = 'blocked', conflict_reason = 'OVERLAPPING_MERGE_SUPERSEDED', updated_at = now() WHERE id = ${conflict.id}`);
      } else {
        await blockMergeOperation(tx, operationId, "OVERLAPPING_MERGE");
        throw new ContactMergeError("OVERLAPPING_MERGE", "Another reviewed merge already includes one of these contacts");
      }
    }
    await lockRelationshipRows(tx, survivorId, deprecatedId);
    const current = await buildPreviewData(tx, survivorId, deprecatedId);
    if (current.conflicts.length) {
      await blockMergeOperation(tx, operationId, current.conflicts[0]);
      throw new ContactMergeError(current.conflicts[0], "Merge is blocked by current contact safety checks");
    }
    if (Number(initial.manifest_version) !== CONTACT_MERGE_MANIFEST_VERSION || Number(initial.normalization_version) !== IDENTITY_NORMALIZATION_VERSION) {
      await blockMergeOperation(tx, operationId, "STALE_POLICY_VERSION");
      throw new ContactMergeError("STALE_POLICY_VERSION", "The merge review was created under an obsolete policy version");
    }
    const decisions = initial.field_decisions as Record<string, string>;
    if (decisions.email !== "survivor" || decisions.phone !== "survivor") {
      await blockMergeOperation(tx, operationId, "UNSAFE_FIELD_DECISION");
      throw new ContactMergeError("UNSAFE_FIELD_DECISION", "Identity fields must explicitly remain with the survivor");
    }
    const expectedPreviewHash = previewHash({ survivor: survivorId, deprecated: deprecatedId, versions: current.contactVersions, relationships: current.relationshipFingerprints, fieldDecisions: decisions, manifest: CONTACT_MERGE_MANIFEST_VERSION });
    if (initial.preview_hash !== expectedPreviewHash) {
      await blockMergeOperation(tx, operationId, "STALE_PREVIEW");
      throw new ContactMergeError("STALE_PREVIEW", "The reviewed preview payload no longer matches the locked records");
    }

    await tx.execute(sql`UPDATE contact_merge_operations SET status = 'executing', updated_at = now() WHERE id = ${operationId}`);
    for (const entry of TRANSFER_ENTRIES) {
      const predicate = `"${entry.column}" = ${deprecatedId}`;
      const recordIds = rows(await tx.execute(sql.raw(`SELECT id, md5(row_to_json(t)::text) AS record_hash FROM "${entry.table}" t WHERE ${predicate} FOR UPDATE`)));
      if (!recordIds.length) continue;
      await tx.execute(sql.raw(`UPDATE "${entry.table}" SET "${entry.column}" = ${survivorId} WHERE ${predicate}`));
      for (const record of recordIds) {
        const recordId = String(record.id);
        const after = rows(await tx.execute(sql.raw(`SELECT md5(row_to_json(t)::text) AS record_hash FROM "${entry.table}" t WHERE id = ${dbIdLiteral(record.id)}`)))[0];
        await tx.execute(sql`
          INSERT INTO contact_merge_relationship_actions (
            operation_id, manifest_version, relation_key, source_record_id, action, before_snapshot, after_snapshot
          ) VALUES (${operationId}, ${CONTACT_MERGE_MANIFEST_VERSION}, ${entry.key}, ${recordId}, 'transfer',
            ${JSON.stringify({ contactId: deprecatedId, recordHash: record.record_hash })}::jsonb,
            ${JSON.stringify({ contactId: survivorId, recordHash: after?.record_hash })}::jsonb)
          ON CONFLICT (operation_id, relation_key, source_record_id) DO NOTHING
        `);
      }
    }
    // Pending campaign work is terminalized rather than transferred. Its
    // history remains on its original subject; this intentionally makes undo
    // fail closed instead of resurrecting a potential duplicate send.
    await tx.execute(sql`
      UPDATE outbound_messages
      SET status = 'skipped', error = 'superseded_by_merge'
      WHERE contact_id = ${deprecatedId} AND status IN ('queued', 'sending')
    `).catch(() => { throw new ContactMergeError("PENDING_SEND_DISPOSITION_FAILED", "Pending campaign messages could not be terminalized"); });
    await tx.execute(sql`
      UPDATE contact_provider_projections
      SET state = 'terminal', terminal_reason = 'superseded_by_merge',
          last_error_code = 'contact_merged', claim_token = NULL,
          lease_expires_at = NULL, completed_at = now(), updated_at = now()
      WHERE contact_id = ${deprecatedId} AND state IN ('pending', 'retry', 'processing')
    `).catch(() => { throw new ContactMergeError("PENDING_PROVIDER_WORK_DISPOSITION_FAILED", "Pending provider projections could not be terminalized"); });
    await tx.execute(sql`
      UPDATE validation_intents
      SET state = 'superseded', terminal_code = 'superseded_by_merge',
          claim_token = NULL, lease_expires_at = NULL,
          completed_at = now(), updated_at = now()
      WHERE contact_id = ${deprecatedId} AND state IN ('pending', 'processing')
    `).catch(() => { throw new ContactMergeError("PENDING_PROVIDER_WORK_DISPOSITION_FAILED", "Pending validation intents could not be terminalized"); });
    if (!survivor.ghl_contact_id && deprecated.ghl_contact_id) {
      // This durable intent is part of the same local commit as the redirect.
      // No GHL mutation is attempted here; the operator-facing reconciliation
      // queue owns the distributed-state follow-up.
      await tx.execute(sql`
        INSERT INTO contact_merge_reconciliations (operation_id, reason)
        VALUES (${operationId}, 'deprecated_only_ghl_id')
        ON CONFLICT (operation_id) DO NOTHING
      `);
    }
    await tx.execute(sql`
      INSERT INTO contact_merge_redirects (deprecated_contact_id, survivor_contact_id, operation_id)
      VALUES (${deprecatedId}, ${survivorId}, ${operationId})
    `);
    await tx.execute(sql`UPDATE contacts SET archived_at = now(), updated_at = now() WHERE id = ${deprecatedId}`);
    const postContacts = await readContactsForUpdate(tx, survivorId, deprecatedId);
    await tx.execute(sql`
      INSERT INTO contact_merge_relationship_actions (
        operation_id, manifest_version, relation_key, source_record_id, action, status, before_snapshot, after_snapshot
      ) VALUES (
        ${operationId}, ${CONTACT_MERGE_MANIFEST_VERSION}, 'contact_pair', ${`${survivorId}:${deprecatedId}`}, 'archive', 'committed',
        ${JSON.stringify({ survivorFingerprint: contactFingerprint(survivor), deprecatedFingerprint: contactFingerprint(deprecated) })}::jsonb,
        ${JSON.stringify({
          survivorFingerprint: contactFingerprint(postContacts.get(survivorId)),
          deprecatedFingerprint: contactFingerprint(postContacts.get(deprecatedId)),
          relationshipSetFingerprint: await relationshipSetFingerprint(tx, survivorId),
        })}::jsonb
      )
    `);
    const ghlDisposition = survivor.ghl_contact_id && !deprecated.ghl_contact_id
      ? "survivor_only"
      : !survivor.ghl_contact_id && deprecated.ghl_contact_id
        ? "deprecated_requires_reconciliation"
        : "none";
    const reconciliationStatus = ghlDisposition === "deprecated_requires_reconciliation" ? "pending" : "not_required";
    await tx.execute(sql`
      UPDATE contact_merge_operations
      SET status = 'committed', executed_at = now(), updated_at = now(),
          ghl_disposition = ${ghlDisposition},
          reconciliation_status = ${reconciliationStatus}
      WHERE id = ${operationId}
      RETURNING *
    `);
    return rows(await tx.execute(sql`SELECT * FROM contact_merge_operations WHERE id = ${operationId}`))[0];
  });
  } catch (error) {
    // Throwing from the transaction rolls back its in-transaction status
    // update. Persist the terminal review outcome separately so the pair can
    // receive a fresh reviewed preview instead of remaining reserved.
    if (error instanceof ContactMergeError && [
      "STALE_PREVIEW", "STALE_POLICY_VERSION", "UNSAFE_FIELD_DECISION",
      "OVERLAPPING_MERGE", "CONTACT_NOT_FOUND", "INSUFFICIENT_ELIGIBLE_IDENTITY_EVIDENCE",
      "ARCHIVED_CONTACT", "RECORD_CLASS_MISMATCH", "DISTINCT_GHL_IDS",
      "SAME_GHL_ID_MANUAL_REVIEW", "ACTIVE_ENROLLMENT_REQUIRES_REVIEW",
      "STATEMENT_PROPOSAL_DEAL_UNIQUENESS_CONFLICT",
      "MANUAL_BLOCK_CAMPAIGN_PREVIEW_MEMBERS",
      "MANUAL_BLOCK_CONTACT_MERGE_REDIRECTS_SURVIVOR", "MANUAL_BLOCK_CONTACT_MERGE_REDIRECTS_DEPRECATED",
    ].includes(error.code)) {
      await db.execute(sql`
        UPDATE contact_merge_operations
        SET status = 'blocked', conflict_reason = ${error.code}, updated_at = now()
        WHERE id = ${operationId} AND status IN ('previewed', 'approved')
      `);
    }
    throw error;
  }

  // No provider call occurs above. The authority handoff adds only restrictive
  // survivor facts with a stable merge event key and leaves source subjects intact.
  const { carryRestrictiveConsentForContactMerge } = await import("./consent-authority");
  try {
    await carryRestrictiveConsentForContactMerge(Number(operation.survivor_contact_id), Number(operation.deprecated_contact_id), operationId);
  } catch {
    return rows(await db.execute(sql`
      UPDATE contact_merge_operations
      SET status = 'reconciliation_pending', reconciliation_status = 'consent_handoff_retry_required',
          conflict_reason = 'CONSENT_HANDOFF_RETRY_REQUIRED', updated_at = now()
      WHERE id = ${operationId} RETURNING *
    `))[0];
  }
  return rows(await db.execute(sql`
    UPDATE contact_merge_operations SET status = CASE WHEN reconciliation_status = 'pending' THEN 'reconciliation_pending' ELSE 'completed' END, updated_at = now()
    WHERE id = ${operationId} RETURNING *
  `))[0];
}

/** Durable operator/worker retry entry point for a failed authority handoff. */
export async function retryContactMergeConsentHandoff(operationId: string, actorId: string) {
  const operation = rows(await db.execute(sql`SELECT * FROM contact_merge_operations WHERE id = ${operationId} FOR UPDATE`))[0];
  if (!operation || operation.status !== "reconciliation_pending" || operation.reconciliation_status !== "consent_handoff_retry_required") {
    throw new ContactMergeError("CONSENT_RETRY_NOT_REQUIRED", "This merge is not awaiting a consent handoff retry");
  }
  // The local merge is already committed. Retrying must not replay its
  // transfers or redirects; the authority routine is keyed by operation ID
  // and performs only restrictive, idempotent carry-forward.
  const { carryRestrictiveConsentForContactMerge } = await import("./consent-authority");
  try {
    await carryRestrictiveConsentForContactMerge(
      Number(operation.survivor_contact_id),
      Number(operation.deprecated_contact_id),
      operationId,
    );
  } catch {
    await db.execute(sql`UPDATE contact_merge_operations SET updated_at = now() WHERE id = ${operationId}`);
    throw new ContactMergeError("CONSENT_HANDOFF_RETRY_REQUIRED", "Consent handoff retry did not complete");
  }
  return rows(await db.execute(sql`
    UPDATE contact_merge_operations
    SET status = CASE WHEN reconciliation_status = 'pending' THEN 'reconciliation_pending' ELSE 'completed' END,
        reconciliation_status = CASE WHEN reconciliation_status = 'consent_handoff_retry_required' THEN 'not_required' ELSE reconciliation_status END,
        conflict_reason = NULL, updated_at = now()
    WHERE id = ${operationId}
    RETURNING *
  `))[0];
}

export async function undoContactMerge(operationId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const hint = rows(await tx.execute(sql`SELECT survivor_contact_id,deprecated_contact_id
      FROM contact_merge_operations WHERE id=${operationId}`))[0];
    if (!hint) throw new ContactMergeError("UNDO_BLOCKED", "This operation cannot be undone");
    await lockCommercialGraph(tx, [
      { type: "contact", id: Number(hint.survivor_contact_id) },
      { type: "contact", id: Number(hint.deprecated_contact_id) },
    ], ["contact_redirect"]);
    const op = rows(await tx.execute(sql`SELECT * FROM contact_merge_operations WHERE id = ${operationId} FOR UPDATE`))[0];
    if (op?.status === "undone") return op;
    if (!op || !["completed", "reconciliation_pending"].includes(op.status)) throw new ContactMergeError("UNDO_BLOCKED", "This operation cannot be undone");
    const survivorId = Number(op.survivor_contact_id); const deprecatedId = Number(op.deprecated_contact_id);
    const lockedContacts = await readContactsForUpdate(tx, survivorId, deprecatedId);
    const redirect = rows(await tx.execute(sql`SELECT * FROM contact_merge_redirects WHERE operation_id = ${operationId} AND active FOR UPDATE`))[0];
    if (!redirect) throw new ContactMergeError("UNDO_BLOCKED", "The active redirect is missing or changed");
    const later = rows(await tx.execute(sql`
      SELECT 1 FROM contact_merge_operations
      WHERE id <> ${operationId} AND status IN ('committed','reconciliation_pending','completed')
        AND (${survivorId} IN (survivor_contact_id, deprecated_contact_id) OR ${deprecatedId} IN (survivor_contact_id, deprecated_contact_id))
      LIMIT 1
    `))[0];
    if (later) throw new ContactMergeError("UNDO_BLOCKED", "A later merge makes restoration ambiguous");
    const terminalizedPendingWork = rows(await tx.execute(sql`
      SELECT (
        EXISTS (
          SELECT 1 FROM outbound_messages
          WHERE contact_id = ${deprecatedId} AND status = 'skipped' AND error = 'superseded_by_merge'
        )
        OR EXISTS (
          SELECT 1 FROM contact_provider_projections
          WHERE contact_id = ${deprecatedId} AND state = 'terminal' AND terminal_reason = 'superseded_by_merge'
        )
        OR EXISTS (
          SELECT 1 FROM validation_intents
          WHERE contact_id = ${deprecatedId} AND state = 'superseded' AND terminal_code = 'superseded_by_merge'
        )
      ) AS found
    `))[0]?.found;
    if (terminalizedPendingWork) {
      throw new ContactMergeError("UNDO_BLOCKED", "Pending campaign work was terminalized by this merge and cannot be safely recreated");
    }
    const actions = rows(await tx.execute(sql`SELECT * FROM contact_merge_relationship_actions WHERE operation_id = ${operationId} AND action = 'transfer' AND undone_at IS NULL FOR UPDATE`));
    const pairAction = rows(await tx.execute(sql`
      SELECT * FROM contact_merge_relationship_actions
      WHERE operation_id = ${operationId} AND relation_key = 'contact_pair' AND action = 'archive'
      FOR UPDATE
    `))[0];
    if (!pairAction
      || contactFingerprint(lockedContacts.get(survivorId)) !== pairAction.after_snapshot?.survivorFingerprint
      || contactFingerprint(lockedContacts.get(deprecatedId)) !== pairAction.after_snapshot?.deprecatedFingerprint
      || await relationshipSetFingerprint(tx, survivorId) !== pairAction.after_snapshot?.relationshipSetFingerprint) {
      throw new ContactMergeError("UNDO_BLOCKED", "Contacts or survivor relationships changed after the merge");
    }
    // Fully preflight every mutable row before the first restore. A changed
    // record, sequence advance, or new dependency blocks atomically.
    for (const action of actions) {
      const entry = CONTACT_MERGE_MANIFEST.find(candidate => candidate.key === action.relation_key && candidate.disposition === "transfer");
      if (!entry?.table || !entry.column) throw new ContactMergeError("UNDO_BLOCKED", "Relationship action is not reversible");
      const current = rows(await tx.execute(sql.raw(`SELECT md5(row_to_json(t)::text) AS record_hash FROM "${entry.table}" t WHERE id = ${dbIdLiteral(action.source_record_id)} AND "${entry.column}" = ${survivorId} FOR UPDATE`)))[0];
      if (!current || current.record_hash !== action.after_snapshot?.recordHash) {
        throw new ContactMergeError("UNDO_BLOCKED", "A transferred relationship changed after the merge");
      }
    }
    for (const action of actions) {
      const entry = CONTACT_MERGE_MANIFEST.find(candidate => candidate.key === action.relation_key && candidate.disposition === "transfer");
      if (!entry?.table || !entry.column) throw new ContactMergeError("UNDO_BLOCKED", "Relationship action is not reversible");
      await tx.execute(sql.raw(`UPDATE "${entry.table}" SET "${entry.column}" = ${deprecatedId} WHERE id = ${dbIdLiteral(action.source_record_id)} AND "${entry.column}" = ${survivorId}`));
      await tx.execute(sql`UPDATE contact_merge_relationship_actions SET undone_at = now(), status = 'undone' WHERE id = ${action.id}`);
    }
    await tx.execute(sql`UPDATE contact_merge_redirects SET active = false, retired_at = now() WHERE id = ${redirect.id}`);
    await tx.execute(sql`UPDATE contacts SET archived_at = NULL, updated_at = now() WHERE id = ${deprecatedId}`);
    await tx.execute(sql`INSERT INTO contact_merge_undo_records (operation_id, requested_by, status, completed_at) VALUES (${operationId}, ${actorId}, 'completed', now())`);
    return rows(await tx.execute(sql`UPDATE contact_merge_operations SET status = 'undone', undone_at = now(), updated_at = now() WHERE id = ${operationId} RETURNING *`))[0];
  });
}