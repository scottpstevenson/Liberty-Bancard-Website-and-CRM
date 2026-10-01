/**
 * Bounded, operator-invoked materialization for an exact unlinked Sunbiz
 * identity already surfaced by contact-link coverage.
 *
 * This writes only the existing canonical Sunbiz source tuple and its
 * matching bootstrap claim. It never creates or reassigns a business, updates
 * contacts.business_id, records a verified contact decision, or satisfies
 * strict system-link policy by itself.
 */
import crypto from "node:crypto";
import { pool } from "../db";
import { CONTACT_LINK_COVERAGE_WORKFLOW, normalizeCoverageName } from "./contact-link-coverage";

export const CONTACT_LINK_SOURCE_RECOVERY_MAX_BATCH = 25;
export const CONTACT_LINK_SOURCE_RECOVERY_SOURCE_SYSTEM = "sunbiz";
export const CONTACT_LINK_SOURCE_RECOVERY_SOURCE_TYPE = "sunbiz_entity";

export interface ContactLinkSourceRecoveryIdentity {
  candidateId: string;
  contactId: number;
  businessId: number;
  sourceEntityId: number;
  filingNumber: string;
}

export interface ContactLinkSourceRecoveryApplyIdentity extends ContactLinkSourceRecoveryIdentity {
  expectedSnapshotHash: string;
}

export type ContactLinkSourceRecoveryPreviewStatus = "READY" | "ALREADY_MATERIALIZED" | "HOLD";
export type ContactLinkSourceRecoveryApplyStatus = "MATERIALIZED" | "ALREADY_MATERIALIZED" | "STALE_PREVIEW" | "HOLD";

export interface ContactLinkSourceRecoveryPreview {
  identity: ContactLinkSourceRecoveryIdentity;
  status: ContactLinkSourceRecoveryPreviewStatus;
  reasonCodes: string[];
  snapshotHash: string | null;
  source: {
    sourceEntityId: number;
    filingNumber: string;
    entityName: string;
    dba: string | null;
    source: string | null;
  } | null;
  canonicalBusiness: {
    businessId: number;
    canonicalName: string;
    normalizedName: string;
  } | null;
  exactNameKeys: string[];
  candidateBusinessIds: number[];
  canonicalSourceLinkId: string | null;
}

export interface ContactLinkSourceRecoveryApplyResult {
  identity: ContactLinkSourceRecoveryIdentity;
  status: ContactLinkSourceRecoveryApplyStatus;
  reasonCodes: string[];
  sourceLinkId: string | null;
  businessId: number | null;
  snapshotHash: string | null;
}

interface QueryResult {
  rows: any[];
  rowCount?: number | null;
}

export interface ContactLinkSourceRecoveryQueryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

interface RecoveryFacts {
  identity: ContactLinkSourceRecoveryIdentity;
  contact: any;
  business: any;
  candidate: any;
  source: any;
  sourceRowsForFiling: any[];
  sourceLinksForFiling: any[];
  bootstrapClaim: any | null;
  exactNameKeys: string[];
  candidateBusinessIds: number[];
  canonicalSourceLink: any | null;
  snapshotHash: string;
}

const CANONICAL_NAME_KEY_SQL = `btrim(regexp_replace(
  regexp_replace(
    lower(regexp_replace(coalesce(b.canonical_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
    '\\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\\M', ' ', 'g'
  ),
  '\\s+', ' ', 'g'
))`;
const NORMALIZED_NAME_KEY_SQL = `btrim(regexp_replace(
  regexp_replace(
    lower(regexp_replace(coalesce(b.normalized_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
    '\\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\\M', ' ', 'g'
  ),
  '\\s+', ' ', 'g'
))`;

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeIdentity(input: ContactLinkSourceRecoveryIdentity): ContactLinkSourceRecoveryIdentity {
  return {
    candidateId: String(input.candidateId ?? ""),
    contactId: Number(input.contactId),
    businessId: Number(input.businessId),
    sourceEntityId: Number(input.sourceEntityId),
    // Filing numbers are immutable source identifiers: do not trim, lowercase,
    // normalize punctuation, or otherwise repair the caller's key.
    filingNumber: String(input.filingNumber ?? ""),
  };
}

function validateIdentity(input: ContactLinkSourceRecoveryIdentity): string[] {
  const reasons: string[] = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.candidateId)) {
    reasons.push("invalid_candidate_id");
  }
  for (const [name, value] of [
    ["contact_id", input.contactId],
    ["business_id", input.businessId],
    ["source_entity_id", input.sourceEntityId],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) reasons.push(`invalid_${name}`);
  }
  if (!input.filingNumber || input.filingNumber.length > 250) reasons.push("invalid_immutable_filing_number");
  return reasons;
}

function rawNameKeys(source: any): string[] {
  return [...new Set([source?.entity_name, source?.dba]
    .map(normalizeCoverageName)
    .filter((key) => key.length >= 4))].sort();
}

function snapshotFor(facts: Omit<RecoveryFacts, "snapshotHash">): unknown {
  return {
    workflow: CONTACT_LINK_COVERAGE_WORKFLOW,
    identity: facts.identity,
    candidate: {
      id: facts.candidate.id,
      contactId: Number(facts.candidate.contact_id),
      businessId: Number(facts.candidate.business_id),
      source: facts.candidate.source,
      sourceVersion: facts.candidate.source_version,
      candidateKey: facts.candidate.candidate_key,
      createdAt: facts.candidate.created_at,
    },
    contact: {
      companyName: facts.contact.company_name,
      recordClass: facts.contact.record_class,
      archivedAt: facts.contact.archived_at,
      doNotContact: facts.contact.do_not_contact,
      doNotAutoContact: facts.contact.do_not_auto_contact,
      optedOutEmail: facts.contact.opted_out_email,
      optOutStatus: facts.contact.opt_out_status,
      unsubscribeStatus: facts.contact.unsubscribe_status,
      bounceStatus: facts.contact.bounce_status,
      complaintStatus: facts.contact.complaint_status,
      suppressionReason: facts.contact.suppression_reason,
      projectedBusinessId: facts.contact.projected_business_id,
      currentDecisionId: facts.contact.current_decision_id,
      currentDecision: facts.contact.current_decision,
      currentDecisionBusinessId: facts.contact.current_decision_business_id,
      currentRevision: facts.contact.current_revision,
      currentDecisionCount: Number(facts.contact.current_decision_count ?? 0),
    },
    business: {
      id: Number(facts.business.id),
      canonicalName: facts.business.canonical_name,
      normalizedName: facts.business.normalized_name,
      recordClass: facts.business.record_class,
    },
    source: {
      id: Number(facts.source.id),
      filingNumber: facts.source.filing_number,
      entityName: facts.source.entity_name,
      dba: facts.source.dba,
      source: facts.source.source,
      website: facts.source.website,
      phone: facts.source.phone,
      ownerPhone: facts.source.owner_phone,
      principalAddress: facts.source.principal_address,
      principalCity: facts.source.principal_city,
      principalState: facts.source.principal_state,
      principalZip: facts.source.principal_zip,
    },
    sourceRowsForFiling: facts.sourceRowsForFiling.map((row) => ({
      id: Number(row.id),
      source: row.source,
    })),
    sourceLinksForFiling: facts.sourceLinksForFiling.map((row) => ({
      id: String(row.id),
      businessId: Number(row.business_id),
      sourceSystem: row.source_system,
      sourceType: row.source_type,
      stableKey: row.stable_key,
      rawEvidence: row.raw_evidence,
    })),
    bootstrapClaim: facts.bootstrapClaim ? {
      id: Number(facts.bootstrapClaim.id),
      sourceEntityId: facts.bootstrapClaim.sunbiz_entity_id == null
        ? null : Number(facts.bootstrapClaim.sunbiz_entity_id),
      businessId: facts.bootstrapClaim.business_id == null
        ? null : Number(facts.bootstrapClaim.business_id),
      status: facts.bootstrapClaim.status,
      retryCount: Number(facts.bootstrapClaim.retry_count ?? 0),
    } : null,
    exactNameKeys: facts.exactNameKeys,
    candidateBusinessIds: facts.candidateBusinessIds,
  };
}

async function loadFacts(
  queryable: ContactLinkSourceRecoveryQueryable,
  input: ContactLinkSourceRecoveryIdentity,
  lockRows = false,
): Promise<RecoveryFacts | null> {
  const lock = lockRows ? " FOR UPDATE OF c, b" : "";
  const candidateResult = await queryable.query(`
    SELECT
      candidate.id, candidate.contact_id, candidate.business_id, candidate.source,
      candidate.source_version, candidate.candidate_key, candidate.created_at,
      c.company_name, c.record_class AS contact_record_class, c.archived_at,
      COALESCE(c.do_not_contact, false) AS do_not_contact,
      COALESCE(c.do_not_auto_contact, false) AS do_not_auto_contact,
      COALESCE(c.opted_out_email, false) AS opted_out_email,
      c.opt_out_status, c.unsubscribe_status, c.bounce_status, c.complaint_status,
      c.suppression_reason, c.business_id AS projected_business_id,
      d.id AS current_decision_id, d.decision AS current_decision,
      d.business_id AS current_decision_business_id, COALESCE(d.revision, 0) AS current_revision,
      COALESCE(d.current_decision_count, 0) AS current_decision_count,
      b.id AS joined_business_id, b.canonical_name, b.normalized_name, b.record_class AS business_record_class
    FROM current_contact_business_link_candidates candidate
    JOIN contacts c ON c.id = candidate.contact_id
    JOIN businesses b ON b.id = candidate.business_id
    LEFT JOIN LATERAL (
      SELECT current_decision.id, current_decision.decision, current_decision.business_id,
        current_decision.revision,
        (
          SELECT COUNT(*)
          FROM contact_business_link_decisions active_decision
          WHERE active_decision.contact_id = c.id AND active_decision.superseded_at IS NULL
        ) AS current_decision_count
      FROM contact_business_link_decisions current_decision
      WHERE current_decision.contact_id = c.id AND current_decision.superseded_at IS NULL
      ORDER BY current_decision.created_at DESC, current_decision.id
      LIMIT 1
    ) d ON true
    WHERE candidate.id = $1::uuid
      AND candidate.contact_id = $2::integer
      AND candidate.business_id = $3::integer
      AND candidate.source = 'sdr_orchestration'
      AND candidate.source_version = $4::text
    ${lock}`,
  [input.candidateId, input.contactId, input.businessId, CONTACT_LINK_COVERAGE_WORKFLOW]);
  const row = candidateResult.rows[0];
  if (!row) return null;

  const sourceResult = await queryable.query(`
    SELECT id, filing_number, entity_name, dba, source, website, phone, owner_phone,
           principal_address, principal_city, principal_state, principal_zip
    FROM sunbiz_entities
    WHERE id = $1::integer AND filing_number = $2::text
    ${lockRows ? "FOR UPDATE" : ""}
  `, [input.sourceEntityId, input.filingNumber]);
  const source = sourceResult.rows[0];
  if (!source) return null;

  const filingSourcesResult = await queryable.query(`
    SELECT id, source
    FROM sunbiz_entities
    WHERE filing_number = $1::text
    ORDER BY id
    ${lockRows ? "FOR UPDATE" : ""}
  `, [input.filingNumber]);
  const sourceRowsForFiling = filingSourcesResult.rows;

  const sourceLinksResult = await queryable.query(`
    SELECT id, business_id, source_system, source_type, stable_key, raw_evidence
    FROM canonical_source_links
    WHERE stable_key = $1::text
    ORDER BY source_system, source_type, id
    ${lockRows ? "FOR UPDATE" : ""}
  `, [input.filingNumber]);
  const sourceLinksForFiling = sourceLinksResult.rows;
  const canonicalSourceLink = sourceLinksForFiling.find((link) =>
    link.source_system === CONTACT_LINK_SOURCE_RECOVERY_SOURCE_SYSTEM
    && link.source_type === CONTACT_LINK_SOURCE_RECOVERY_SOURCE_TYPE,
  ) ?? null;

  const claimResult = await queryable.query(`
    SELECT id, sunbiz_entity_id, business_id, status, retry_count
    FROM sunbiz_bootstrap_claims
    WHERE filing_number = $1::text
    ${lockRows ? "FOR UPDATE" : ""}
  `, [input.filingNumber]);
  const bootstrapClaim = claimResult.rows[0] ?? null;

  const exactNameKeys = rawNameKeys(source);
  const matchingBusinessesResult = exactNameKeys.length
    ? await queryable.query(`
        SELECT b.id
        FROM businesses b
        WHERE b.record_class = 'canonical'
          AND (
            ${CANONICAL_NAME_KEY_SQL} = ANY($1::text[])
            OR ${NORMALIZED_NAME_KEY_SQL} = ANY($1::text[])
          )
        ORDER BY b.id
      `, [exactNameKeys])
    : { rows: [] };
  const candidateBusinessIds = [...new Set(matchingBusinessesResult.rows
    .map((candidate) => Number(candidate.id)))].sort((a, b) => a - b);
  const facts: Omit<RecoveryFacts, "snapshotHash"> = {
    identity: input,
    candidate: row,
    contact: {
      ...row,
      record_class: row.contact_record_class,
    },
    business: {
      id: row.joined_business_id,
      canonical_name: row.canonical_name,
      normalized_name: row.normalized_name,
      record_class: row.business_record_class,
    },
    source,
    sourceRowsForFiling,
    sourceLinksForFiling,
    bootstrapClaim,
    exactNameKeys,
    candidateBusinessIds,
    canonicalSourceLink,
  };
  return { ...facts, snapshotHash: stableHash(snapshotFor(facts)) };
}

async function explainMissingFacts(
  queryable: ContactLinkSourceRecoveryQueryable,
  identity: ContactLinkSourceRecoveryIdentity,
): Promise<string> {
  const candidate = await queryable.query(`
    SELECT 1
    FROM current_contact_business_link_candidates
    WHERE id = $1::uuid
      AND contact_id = $2::integer
      AND business_id = $3::integer
      AND source = 'sdr_orchestration'
      AND source_version = $4::text
  `, [identity.candidateId, identity.contactId, identity.businessId, CONTACT_LINK_COVERAGE_WORKFLOW]);
  if (!candidate.rows.length) return "candidate_not_current_or_contact_business_identity_changed";
  const source = await queryable.query(`
    SELECT 1 FROM sunbiz_entities
    WHERE id = $1::integer AND filing_number = $2::text
  `, [identity.sourceEntityId, identity.filingNumber]);
  if (!source.rows.length) return "source_entity_id_and_filing_number_pair_not_found";
  return "candidate_contact_business_source_join_missing";
}

export function evaluateExactSunbizSourceNameBinding(input: {
  contactCompanyName: string | null | undefined;
  sourceEntityName: string | null | undefined;
  sourceDba: string | null | undefined;
  canonicalName: string | null | undefined;
  normalizedName: string | null | undefined;
  candidateBusinessIds: number[];
  targetBusinessId: number;
}): { reasonCodes: string[]; exactNameKeys: string[]; contactMatchedNameKey: string | null; businessMatchedNameKeys: string[] } {
  const exactNameKeys = [...new Set([input.sourceEntityName, input.sourceDba]
    .map(normalizeCoverageName)
    .filter((key) => key.length >= 4))].sort();
  const contactKey = normalizeCoverageName(input.contactCompanyName);
  const contactMatchedNameKey = exactNameKeys.includes(contactKey) ? contactKey : null;
  const businessKeys = [...new Set([input.canonicalName, input.normalizedName]
    .map(normalizeCoverageName)
    .filter((key) => key.length >= 4))];
  const businessMatchedNameKeys = exactNameKeys.filter((key) => businessKeys.includes(key));
  const reasons = new Set<string>();
  if (!contactMatchedNameKey) reasons.add("contact_raw_sunbiz_name_identity_not_exact");
  if (!businessMatchedNameKeys.length) {
    reasons.add("raw_sunbiz_name_not_exactly_equal_to_target_canonical_business");
  }
  if (input.candidateBusinessIds.length > 1) {
    reasons.add("raw_sunbiz_identity_maps_to_multiple_canonical_businesses");
  }
  if (input.candidateBusinessIds.length === 0) {
    reasons.add("raw_sunbiz_identity_has_no_exact_canonical_business");
  }
  if (input.candidateBusinessIds.length === 1 && input.candidateBusinessIds[0] !== input.targetBusinessId) {
    reasons.add("exact_canonical_business_differs_from_selected_candidate");
  }
  return {
    reasonCodes: [...reasons].sort(),
    exactNameKeys,
    contactMatchedNameKey,
    businessMatchedNameKeys: businessMatchedNameKeys.sort(),
  };
}

function evaluateFacts(facts: RecoveryFacts): {
  status: ContactLinkSourceRecoveryPreviewStatus;
  reasonCodes: string[];
  exactNameKeys: string[];
  candidateBusinessIds: number[];
} {
  const reasons = new Set<string>();
  const { identity, contact, business, source, sourceRowsForFiling, sourceLinksForFiling, bootstrapClaim } = facts;
  if (sourceRowsForFiling.length !== 1 || Number(sourceRowsForFiling[0]?.id) !== identity.sourceEntityId) {
    reasons.add("filing_number_is_not_a_unique_immutable_source_identity");
  }
  if (!["cordata", "corevt", "sunbiz"].includes(String(source.source ?? ""))) {
    reasons.add("unsupported_sunbiz_entity_source");
  }
  if (business.record_class !== "canonical") reasons.add("target_business_not_canonical");
  if (contact.archived_at != null || ["test", "demo", "synthetic"].includes(String(contact.record_class))) {
    reasons.add("contact_out_of_scope");
  }
  if (contact.do_not_contact || contact.do_not_auto_contact || contact.opted_out_email
      || contact.opt_out_status === "opted_out" || contact.unsubscribe_status === "unsubscribed"
      || contact.bounce_status === "hard" || contact.complaint_status === "reported"
      || contact.suppression_reason != null) {
    reasons.add("contact_suppressed_or_excluded");
  }
  if (contact.projected_business_id != null && Number(contact.projected_business_id) !== identity.businessId) {
    reasons.add("contact_projection_targets_other_business");
  }
  if (contact.current_decision_id
      && (contact.current_decision !== "verified"
        || Number(contact.current_decision_business_id) !== identity.businessId)) {
    reasons.add("current_contact_link_decision_conflict");
  }
  if (Number(contact.current_decision_count ?? 0) > 1) {
    reasons.add("multiple_current_contact_link_decisions");
  }

  for (const reason of evaluateExactSunbizSourceNameBinding({
    contactCompanyName: contact.company_name,
    sourceEntityName: source.entity_name,
    sourceDba: source.dba,
    canonicalName: business.canonical_name,
    normalizedName: business.normalized_name,
    candidateBusinessIds: facts.candidateBusinessIds,
    targetBusinessId: identity.businessId,
  }).reasonCodes) reasons.add(reason);

  const legacyLink = sourceLinksForFiling.find((link) =>
    link.source_system === "sunbiz_entities" && link.source_type === "sunbiz_filing",
  );
  const unsupportedLinks = sourceLinksForFiling.filter((link) =>
    !((link.source_system === CONTACT_LINK_SOURCE_RECOVERY_SOURCE_SYSTEM
      && link.source_type === CONTACT_LINK_SOURCE_RECOVERY_SOURCE_TYPE)
      || (link.source_system === "sunbiz_entities" && link.source_type === "sunbiz_filing")),
  );
  if (unsupportedLinks.length) reasons.add("filing_number_claimed_in_another_source_namespace");
  if (legacyLink && Number(legacyLink.business_id) !== identity.businessId) {
    reasons.add("legacy_sunbiz_crosswalk_targets_other_business");
  }
  if (facts.canonicalSourceLink && Number(facts.canonicalSourceLink.business_id) !== identity.businessId) {
    reasons.add("canonical_sunbiz_source_link_targets_other_business");
  }
  const existingSourceIdentity = facts.canonicalSourceLink?.raw_evidence?.immutableSourceIdentity;
  if (existingSourceIdentity?.sourceEntityId != null
      && Number(existingSourceIdentity.sourceEntityId) !== identity.sourceEntityId) {
    reasons.add("canonical_sunbiz_source_link_entity_id_conflict");
  }
  if (existingSourceIdentity?.filingNumber != null
      && existingSourceIdentity.filingNumber !== identity.filingNumber) {
    reasons.add("canonical_sunbiz_source_link_filing_number_conflict");
  }

  if (bootstrapClaim) {
    if (bootstrapClaim.sunbiz_entity_id != null
        && Number(bootstrapClaim.sunbiz_entity_id) !== identity.sourceEntityId) {
      reasons.add("bootstrap_claim_source_entity_id_conflict");
    }
    if (bootstrapClaim.business_id != null && Number(bootstrapClaim.business_id) !== identity.businessId) {
      reasons.add("bootstrap_claim_targets_other_business");
    }
    if (bootstrapClaim.status === "claimed") reasons.add("sunbiz_bootstrap_claim_active");
    if (["dead_letter", "deferred_collision"].includes(String(bootstrapClaim.status))) {
      reasons.add("sunbiz_bootstrap_claim_terminal_hold");
    }
    if (bootstrapClaim.status === "failed" && Number(bootstrapClaim.retry_count ?? 0) >= 5) {
      reasons.add("sunbiz_bootstrap_claim_terminal_hold");
    }
    if (!["claimed", "dead_letter", "deferred_collision", "failed", "created", "matched_existing"]
      .includes(String(bootstrapClaim.status))) {
      reasons.add("sunbiz_bootstrap_claim_state_unsupported");
    }
  }

  if (reasons.size) {
    return {
      status: "HOLD",
      reasonCodes: [...reasons].sort(),
      exactNameKeys: facts.exactNameKeys,
      candidateBusinessIds: facts.candidateBusinessIds,
    };
  }
  if (facts.canonicalSourceLink) {
    return {
      status: "ALREADY_MATERIALIZED",
      reasonCodes: ["canonical_sunbiz_source_link_already_materialized"],
      exactNameKeys: facts.exactNameKeys,
      candidateBusinessIds: facts.candidateBusinessIds,
    };
  }
  return {
    status: "READY",
    reasonCodes: [],
    exactNameKeys: facts.exactNameKeys,
    candidateBusinessIds: facts.candidateBusinessIds,
  };
}

function toPreview(
  identity: ContactLinkSourceRecoveryIdentity,
  facts: RecoveryFacts | null,
  missingReason = "candidate_source_or_target_identity_not_found",
): ContactLinkSourceRecoveryPreview {
  if (!facts) {
    return {
      identity,
      status: "HOLD",
      reasonCodes: [missingReason],
      snapshotHash: null,
      source: null,
      canonicalBusiness: null,
      exactNameKeys: [],
      candidateBusinessIds: [],
      canonicalSourceLinkId: null,
    };
  }
  const evaluation = evaluateFacts(facts);
  return {
    identity,
    status: evaluation.status,
    reasonCodes: evaluation.reasonCodes,
    snapshotHash: facts.snapshotHash,
    source: {
      sourceEntityId: Number(facts.source.id),
      filingNumber: String(facts.source.filing_number),
      entityName: String(facts.source.entity_name),
      dba: facts.source.dba ?? null,
      source: facts.source.source ?? null,
    },
    canonicalBusiness: {
      businessId: Number(facts.business.id),
      canonicalName: String(facts.business.canonical_name),
      normalizedName: String(facts.business.normalized_name),
    },
    exactNameKeys: evaluation.exactNameKeys,
    candidateBusinessIds: evaluation.candidateBusinessIds,
    canonicalSourceLinkId: facts.canonicalSourceLink ? String(facts.canonicalSourceLink.id) : null,
  };
}

export async function previewContactLinkSourceRecoveryWithQueryable(
  queryable: ContactLinkSourceRecoveryQueryable,
  rawIdentity: ContactLinkSourceRecoveryIdentity,
): Promise<ContactLinkSourceRecoveryPreview> {
  const identity = normalizeIdentity(rawIdentity);
  const invalid = validateIdentity(identity);
  if (invalid.length) {
    return toPreview(identity, null, invalid[0]);
  }
  const facts = await loadFacts(queryable, identity);
  return facts
    ? toPreview(identity, facts)
    : toPreview(identity, null, await explainMissingFacts(queryable, identity));
}

export async function previewContactLinkSourceRecovery(
  identity: ContactLinkSourceRecoveryIdentity,
): Promise<ContactLinkSourceRecoveryPreview> {
  return previewContactLinkSourceRecoveryWithQueryable(pool, identity);
}

function resultFromPreview(
  preview: ContactLinkSourceRecoveryPreview,
  status: ContactLinkSourceRecoveryApplyStatus,
  sourceLinkId: string | null = preview.canonicalSourceLinkId,
): ContactLinkSourceRecoveryApplyResult {
  return {
    identity: preview.identity,
    status,
    reasonCodes: preview.reasonCodes,
    sourceLinkId,
    businessId: preview.canonicalBusiness?.businessId ?? null,
    snapshotHash: preview.snapshotHash,
  };
}

/**
 * Apply the transaction body using a caller-owned transaction. Exported so
 * disposable SQL certification can seed temp fixtures, exercise the exact
 * same writes, and roll the transaction back.
 */
export async function applyContactLinkSourceRecoveryInTransaction(
  queryable: ContactLinkSourceRecoveryQueryable,
  rawInput: ContactLinkSourceRecoveryApplyIdentity,
): Promise<ContactLinkSourceRecoveryApplyResult> {
  const identity = normalizeIdentity(rawInput);
  const invalid = validateIdentity(identity);
  if (invalid.length || !/^[a-f0-9]{64}$/i.test(String(rawInput.expectedSnapshotHash ?? ""))) {
    return resultFromPreview(toPreview(identity, null, invalid[0] ?? "invalid_expected_snapshot_hash"), "HOLD", null);
  }
  const facts = await loadFacts(queryable, identity, true);
  if (!facts) {
    return resultFromPreview(
      toPreview(identity, null, await explainMissingFacts(queryable, identity)),
      "HOLD",
      null,
    );
  }

  const preview = toPreview(identity, facts);
  if (preview.status === "ALREADY_MATERIALIZED") {
    return resultFromPreview(preview, "ALREADY_MATERIALIZED");
  }
  if (preview.status === "HOLD") return resultFromPreview(preview, "HOLD", null);
  if (facts.snapshotHash !== rawInput.expectedSnapshotHash) {
    return resultFromPreview({
      ...preview,
      status: "HOLD",
      reasonCodes: ["preview_snapshot_changed"],
    }, "STALE_PREVIEW", null);
  }

  const nowEvidence = {
    materializer: "contact_link_source_recovery_v1",
    sourceContract: {
      sourceSystem: CONTACT_LINK_SOURCE_RECOVERY_SOURCE_SYSTEM,
      sourceType: CONTACT_LINK_SOURCE_RECOVERY_SOURCE_TYPE,
      stableKey: identity.filingNumber,
    },
    immutableSourceIdentity: {
      sourceEntityId: identity.sourceEntityId,
      filingNumber: identity.filingNumber,
      source: facts.source.source,
    },
    identityBasis: {
      exactNameKeys: facts.exactNameKeys,
      candidateId: identity.candidateId,
      contactId: identity.contactId,
      businessId: identity.businessId,
      previewSnapshotHash: facts.snapshotHash,
    },
    sunbizEvidence: {
      entityName: facts.source.entity_name,
      dba: facts.source.dba,
      website: facts.source.website,
      phone: facts.source.phone,
      ownerPhone: facts.source.owner_phone,
      principalAddress: facts.source.principal_address,
      principalCity: facts.source.principal_city,
      principalState: facts.source.principal_state,
      principalZip: facts.source.principal_zip,
    },
  };

  const existingClaim = facts.bootstrapClaim;
  if (!existingClaim) {
    const insertedClaim = await queryable.query(`
      INSERT INTO sunbiz_bootstrap_claims
        (filing_number, sunbiz_entity_id, status, business_id, completed_at)
      VALUES ($1::text, $2::integer, 'matched_existing', $3::integer, now())
      ON CONFLICT (filing_number) DO NOTHING
      RETURNING id
    `, [identity.filingNumber, identity.sourceEntityId, identity.businessId]);
    if (!insertedClaim.rows.length) {
      const racedClaimResult = await queryable.query(`
        SELECT id, sunbiz_entity_id, business_id, status, retry_count
        FROM sunbiz_bootstrap_claims
        WHERE filing_number = $1::text
        FOR UPDATE
      `, [identity.filingNumber]);
      const racedClaim = racedClaimResult.rows[0];
      if (!racedClaim
          || (racedClaim.sunbiz_entity_id != null && Number(racedClaim.sunbiz_entity_id) !== identity.sourceEntityId)
          || (racedClaim.business_id != null && Number(racedClaim.business_id) !== identity.businessId)
          || !["created", "matched_existing"].includes(String(racedClaim.status))) {
        throw new Error("CONTACT_LINK_SOURCE_RECOVERY_BOOTSTRAP_CLAIM_RACE_HOLD");
      }
    }
  } else if (existingClaim.status === "failed") {
    const updated = await queryable.query(`
      UPDATE sunbiz_bootstrap_claims
      SET sunbiz_entity_id = $2::integer,
          business_id = $3::integer,
          status = 'matched_existing',
          deferred_reason_code = NULL,
          completed_at = now()
      WHERE filing_number = $1::text
        AND id = $4::integer
        AND status = 'failed'
        AND (sunbiz_entity_id IS NULL OR sunbiz_entity_id = $2::integer)
        AND (business_id IS NULL OR business_id = $3::integer)
      RETURNING id
    `, [identity.filingNumber, identity.sourceEntityId, identity.businessId, existingClaim.id]);
    if (!updated.rows.length) {
      throw new Error("CONTACT_LINK_SOURCE_RECOVERY_BOOTSTRAP_CLAIM_CAS_FAILED");
    }
  } else if (existingClaim.sunbiz_entity_id == null || existingClaim.business_id == null) {
    const updated = await queryable.query(`
      UPDATE sunbiz_bootstrap_claims
      SET sunbiz_entity_id = $2::integer,
          business_id = $3::integer
      WHERE filing_number = $1::text
        AND id = $4::integer
        AND sunbiz_entity_id IS NULL
        AND status IN ('created', 'matched_existing')
        AND (business_id IS NULL OR business_id = $3::integer)
      RETURNING id
    `, [identity.filingNumber, identity.sourceEntityId, identity.businessId, existingClaim.id]);
    if (!updated.rows.length) {
      throw new Error("CONTACT_LINK_SOURCE_RECOVERY_BOOTSTRAP_CLAIM_CAS_FAILED");
    }
  }

  const inserted = await queryable.query(`
    INSERT INTO canonical_source_links
      (business_id, source_system, source_type, stable_key, raw_evidence, first_seen_at, last_confirmed_at)
    VALUES ($1::integer, 'sunbiz', 'sunbiz_entity', $2::text, $3::jsonb, now(), now())
    ON CONFLICT (source_system, source_type, stable_key) DO NOTHING
    RETURNING id, business_id
  `, [identity.businessId, identity.filingNumber, JSON.stringify(nowEvidence)]);
  let sourceLink = inserted.rows[0];
  if (!sourceLink) {
    const current = await queryable.query(`
      SELECT id, business_id
      FROM canonical_source_links
      WHERE source_system = 'sunbiz'
        AND source_type = 'sunbiz_entity'
        AND stable_key = $1::text
      FOR UPDATE
    `, [identity.filingNumber]);
    sourceLink = current.rows[0];
  }
  if (!sourceLink || Number(sourceLink.business_id) !== identity.businessId) {
    throw new Error("CONTACT_LINK_SOURCE_RECOVERY_CANONICAL_LINK_CAS_FAILED");
  }
  return {
    identity,
    status: inserted.rows.length ? "MATERIALIZED" : "ALREADY_MATERIALIZED",
    reasonCodes: inserted.rows.length ? ["canonical_sunbiz_source_link_materialized"] : ["canonical_sunbiz_source_link_already_materialized"],
    sourceLinkId: String(sourceLink.id),
    businessId: identity.businessId,
    snapshotHash: facts.snapshotHash,
  };
}

async function withSerializableTransaction<T>(
  operation: (client: ContactLinkSourceRecoveryQueryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function applyContactLinkSourceRecovery(
  input: ContactLinkSourceRecoveryApplyIdentity,
): Promise<ContactLinkSourceRecoveryApplyResult> {
  try {
    return await withSerializableTransaction((client) =>
      applyContactLinkSourceRecoveryInTransaction(client, input),
    );
  } catch (error: any) {
    if (["40001", "40P01"].includes(String(error?.code ?? ""))) {
      return resultFromPreview(
        toPreview(normalizeIdentity(input), null, "concurrent_identity_snapshot_changed"),
        "STALE_PREVIEW",
        null,
      );
    }
    if (String(error?.message ?? "").startsWith("CONTACT_LINK_SOURCE_RECOVERY_")) {
      return resultFromPreview(
        toPreview(normalizeIdentity(input), null, String(error.message).toLowerCase()),
        "HOLD",
        null,
      );
    }
    throw error;
  }
}

export async function previewContactLinkSourceRecoveryBatch(
  identities: ContactLinkSourceRecoveryIdentity[],
): Promise<{ denominator: number; results: ContactLinkSourceRecoveryPreview[] }> {
  if (!Array.isArray(identities) || identities.length > CONTACT_LINK_SOURCE_RECOVERY_MAX_BATCH) {
    throw new Error(`CONTACT_LINK_SOURCE_RECOVERY_BATCH_LIMIT_${CONTACT_LINK_SOURCE_RECOVERY_MAX_BATCH}`);
  }
  const normalized = identities.map(normalizeIdentity);
  const filingGroups = new Map<string, number[]>();
  normalized.forEach((identity, index) => {
    if (!filingGroups.has(identity.filingNumber)) filingGroups.set(identity.filingNumber, []);
    filingGroups.get(identity.filingNumber)!.push(index);
  });
  const results: ContactLinkSourceRecoveryPreview[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const identity = normalized[index];
    const duplicateFiling = (filingGroups.get(identity.filingNumber)?.length ?? 0) > 1;
    if (duplicateFiling) {
      results.push(toPreview(identity, null, "duplicate_filing_number_in_batch"));
    } else {
      results.push(await previewContactLinkSourceRecovery(identity));
    }
  }
  return { denominator: identities.length, results };
}

export async function applyContactLinkSourceRecoveryBatch(
  items: ContactLinkSourceRecoveryApplyIdentity[],
): Promise<{ denominator: number; results: ContactLinkSourceRecoveryApplyResult[] }> {
  if (!Array.isArray(items) || items.length > CONTACT_LINK_SOURCE_RECOVERY_MAX_BATCH) {
    throw new Error(`CONTACT_LINK_SOURCE_RECOVERY_BATCH_LIMIT_${CONTACT_LINK_SOURCE_RECOVERY_MAX_BATCH}`);
  }
  const normalized = items.map((item) => normalizeIdentity(item));
  const filingGroups = new Map<string, number[]>();
  normalized.forEach((identity, index) => {
    if (!filingGroups.has(identity.filingNumber)) filingGroups.set(identity.filingNumber, []);
    filingGroups.get(identity.filingNumber)!.push(index);
  });
  const results: ContactLinkSourceRecoveryApplyResult[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const identity = normalized[index];
    if ((filingGroups.get(identity.filingNumber)?.length ?? 0) > 1) {
      results.push(resultFromPreview(
        toPreview(identity, null, "duplicate_filing_number_in_batch"),
        "HOLD",
        null,
      ));
    } else {
      results.push(await applyContactLinkSourceRecovery(items[index]));
    }
  }
  return { denominator: items.length, results };
}