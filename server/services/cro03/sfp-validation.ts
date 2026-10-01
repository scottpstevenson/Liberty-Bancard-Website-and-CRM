/**
 * sfp-validation.ts
 *
 * ZeroBounce validation for the South Florida Prospecting program.
 *
 * Task #2000 contract:
 *  - Reads unified free+paid candidates (getUnifiedSfpCandidates); never
 *    free-only.
 *  - Applies the canonical free-candidate prefilter (rejectEmailCandidate)
 *    and an authoritative MX/DNS check BEFORE any provider reservation or
 *    decryption. no_mx = ineligible, zero spend. dns_indeterminate = retryable,
 *    never treated as invalid or paid-ready.
 *  - Opens plaintext only through the audited openSfpCandidatePlaintext
 *    boundary; the real decrypted address (never masked_value) is what
 *    reaches the transport/ZeroBounce.
 *  - Applies the versioned policy evaluator (DBPR, existing-customer,
 *    consent-tier, suppression) in addition to role-inbox classification.
 *  - Reuses a fresh (within-TTL) provider observation instead of re-calling
 *    the provider, but still re-runs every mutable safety gate.
 *  - Settlement + eligibility write + stage-item + counters happen in one
 *    transaction (settleSfpProviderOperation is passed the same `tx`).
 *
 * SPF/DKIM/DMARC are sender-domain release controls and are never consulted
 * here — this module validates recipient addresses only.
 *
 * No runtime DDL — all tables created via migrations.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { businessHasDbprLineageSql } from "../dbpr";
import { type OutreachEligibilityStatus, isSfpValidationPromotionEnabled } from "./south-florida-prospecting";
import {
  assertCurrentSfpProviderReservation,
  assertSfpRuntimeAuthority,
  currentSfpUnitPrice,
  reserveSfpProviderOperation,
  settleSfpProviderOperation,
} from "./sfp-provider-operations";
import {
  assertSfpContactCandidateCurrent,
  getUnifiedSfpCandidates,
  openSfpCandidatePlaintext,
  type ResolvedSfpCandidateReference,
  type UnifiedSfpCandidateView,
} from "./sfp-paid-evidence-writer";
import { rejectEmailCandidate, checkMxRecord } from "./candidate-selector";
import {
  getActiveSfpOutreachPolicy,
  evaluateSfpMutableSafetyGates,
  isCanonicallySuppressed,
  lookupConsentTierByEmailHash,
  findFreshProviderObservation,
  evaluateSfpEmailTypePolicy,
  type SfpActivePolicy,
} from "./sfp-outreach-policy";
import {
  SFP_SELECTED_CONTACTS_MAX,
  normalizeFrozenContactScope,
  normalizeSelectedContactIds,
  resolveVerifiedSfpContactTargets,
  type SfpSelectedContactTarget,
} from "./sfp-contact-scope";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const SFP_VALIDATION_MAX = 25;

export type SfpZbOutcome =
  | "valid" | "invalid" | "catch-all" | "spamtrap" | "abuse"
  | "do_not_mail" | "unknown" | "failed";

/**
 * The single input snapshot computation shared by preview and execute.
 * Covers the cohort manifest, ranked winner references/hashes selected from
 * the unified free+paid pool, the active policy document's id/hash, and the
 * requested maximum. Pricing and financial headroom are deliberately not
 * part of provider authorization or this freshness fence.
 * Preview and execute must derive this identically — execute recomputes it
 * fresh and requires it to match the hash the caller captured from preview,
 * so a cohort/candidate/policy change between preview and execute
 * fails closed instead of silently validating against stale state.
 */
export async function computeSfpValidationSnapshot(
  cohortRunId: string,
  maxValidations: number,
  selectedContactIds?: number[],
): Promise<{ snapshotHash: string; payload: Record<string, unknown> }> {
  const selection = await buildSfpValidationSelectionSnapshot(
    cohortRunId,
    maxValidations,
    selectedContactIds,
  );
  return { snapshotHash: selection.snapshotHash, payload: selection.payload };
}

interface SfpValidationSelectionSnapshot {
  snapshotHash: string;
  payload: Record<string, unknown>;
  selected: Array<[number, UnifiedSfpCandidateView]>;
  completedContactReceipts: Array<{
    eligibilityId: string;
    contactId: number;
    businessId: number;
    status: string;
    zbOutcome: string | null;
    decisionReason: string | null;
    normalizedAddressHash: string;
    updatedAt: string;
    linkDecisionId: string;
    linkRevision: number;
  }>;
  scopeCoverageComplete: boolean;
  selectedContactIds?: number[];
  resolvedTargets?: SfpSelectedContactTarget[];
  businessIds: number[];
  totalWinners: number;
}

async function buildSfpValidationSelectionSnapshot(
  cohortRunId: string,
  maxValidations: number,
  selectedContactIds?: number[],
): Promise<SfpValidationSelectionSnapshot> {
  const run = rows(await db.execute(sql`
    SELECT cohort_hash,request_payload FROM sfp_cohort_runs WHERE id=${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!run) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  const policy = await getActiveSfpOutreachPolicy();
  const scope = await resolveRunContactScope(cohortRunId, run.request_payload, selectedContactIds);
  const cohortBizIds = await getUndecidedCohortBizIds(cohortRunId);
  const bizIds = scope
    ? scope.resolvedTargets.map((target) => target.businessId)
    : cohortBizIds;
  const winners = await selectWinnersPerBusiness(
    bizIds,
    cohortRunId,
    policy.version,
    scope?.resolvedTargets,
  );
  const durableReceipts = scope
    ? await getDurableScopedContactReceipts(cohortRunId, scope.resolvedTargets, policy)
    : [];
  const receiptByContact = new Map(durableReceipts.map((receipt) => [receipt.contactId, receipt]));
  const actionableWinners = Array.from(winners.entries()).filter(([businessId, candidate]) => {
    if (!scope || candidate.sourceKind !== "contact") return true;
    const contactId = Number(candidate.evidenceId.replace(/^contact:/, ""));
    const receipt = receiptByContact.get(contactId);
    return !receipt || receipt.businessId !== businessId ||
      receipt.normalizedAddressHash !== String(candidate.normalizedValueHash ?? "") ||
      receipt.linkDecisionId !== String(candidate.contactBusinessLinkDecisionId ?? "") ||
      receipt.linkRevision !== Number(candidate.contactBusinessLinkRevision);
  });
  const selected = actionableWinners.slice(0, maxValidations);
  const pendingTargetIds = new Set(selected.map(([, candidate]) =>
    candidate.sourceKind === "contact" && candidate.evidenceId.startsWith("contact:")
      ? Number(candidate.evidenceId.slice("contact:".length)) : NaN));
  const coveredTargetIds = new Set<number>([
    ...pendingTargetIds,
    ...durableReceipts.map((receipt) => receipt.contactId),
  ]);
  const scopeCoverageComplete = !scope || (
    actionableWinners.length === selected.length &&
    scope.selectedContactIds.every((contactId) => coveredTargetIds.has(contactId))
  );
  const payload = {
    cohortRunId,
    cohortHash: String(run.cohort_hash ?? ""),
    maxValidations,
    policyId: policy.id,
    policyDocumentHash: policy.documentHash,
    batchMaxItems: SFP_VALIDATION_MAX,
    ...(scope ? {
      selectedContactScope: {
        selectedContactIds: scope.selectedContactIds,
        resolvedTargets: scope.resolvedTargets,
        completedContactReceipts: durableReceipts,
        scopeCoverageComplete,
      },
    } : {}),
    winners: selected
      .map(([bizId, cand]) => ({
        businessId: bizId, evidenceId: cand.evidenceId, sourceKind: cand.sourceKind,
        candidateRevision: (cand as CandidateWithPin)._candidateRevision ?? cand.createdAt,
        normalizedAddressHash: (cand as CandidateWithPin)._normalizedHash ?? null,
        sourceReference: cand.candidateReference,
      }))
      .sort((a, b) => a.businessId - b.businessId),
  };
  const snapshotHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    snapshotHash,
    payload,
    selected,
    completedContactReceipts: durableReceipts,
    scopeCoverageComplete,
    selectedContactIds: scope?.selectedContactIds,
    resolvedTargets: scope?.resolvedTargets,
    businessIds: bizIds,
    totalWinners: scope ? actionableWinners.length + durableReceipts.length : winners.size,
  };
}

async function resolveRunContactScope(
  cohortRunId: string,
  rawRequestPayload: unknown,
  requestedContactIds?: number[],
): Promise<{ selectedContactIds: number[]; resolvedTargets: SfpSelectedContactTarget[] } | undefined> {
  let requestPayload: any = rawRequestPayload;
  if (typeof requestPayload === "string") {
    try { requestPayload = JSON.parse(requestPayload); } catch {
      throw new Error("SFP_FROZEN_CONTACT_SCOPE_CORRUPT");
    }
  }
  const frozenIds = normalizeFrozenContactScope(requestPayload?.selectedContactIds);
  const requestedIds = normalizeSelectedContactIds(requestedContactIds);
  if (frozenIds && requestedIds &&
      (frozenIds.length !== requestedIds.length || frozenIds.some((id, index) => id !== requestedIds[index]))) {
    throw new Error("SFP_SELECTED_CONTACT_SCOPE_MISMATCH:must_match_immutable_frozen_scope");
  }
  const selectedContactIds = frozenIds ?? requestedIds;
  if (!selectedContactIds) return undefined;
  const resolvedTargets = await resolveVerifiedSfpContactTargets(selectedContactIds);
  if (frozenIds) {
    const frozenTargets = Array.isArray(requestPayload?.selectedContactTargets)
      ? requestPayload.selectedContactTargets as SfpSelectedContactTarget[]
      : [];
    const frozenById = new Map(frozenTargets.map((target) => [Number(target.contactId), target]));
    const drifted = resolvedTargets.filter((target) => {
      const frozen = frozenById.get(target.contactId);
      return !frozen ||
        Number(frozen.businessId) !== target.businessId ||
        String(frozen.linkDecisionId) !== target.linkDecisionId ||
        Number(frozen.linkRevision) !== target.linkRevision;
    });
    if (frozenTargets.length !== resolvedTargets.length || drifted.length) {
      throw new Error(`SFP_SELECTED_CONTACT_FROZEN_LINK_DRIFT:${(drifted.length ? drifted : resolvedTargets).map((target) => target.contactId).join(",")}`);
    }
  }
  const memberRows = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members WHERE cohort_run_id=${cohortRunId}::uuid
  `));
  const memberIds = new Set(memberRows.map((row: any) => Number(row.business_id)));
  const nonMembers = resolvedTargets.filter((target) => !memberIds.has(target.businessId));
  if (nonMembers.length) {
    throw new Error(`SFP_SELECTED_CONTACT_NOT_COHORT_MEMBER:${nonMembers.map((target) => target.contactId).join(",")}`);
  }
  return { selectedContactIds, resolvedTargets };
}

async function assertValidationReplayScopeMatches(
  cohortRunId: string,
  requestedContactIds: number[] | undefined,
  storedResultValue: unknown,
): Promise<void> {
  const run = rows(await db.execute(sql`
    SELECT request_payload FROM sfp_cohort_runs WHERE id=${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!run) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  const currentScope = await resolveRunContactScope(cohortRunId, run.request_payload, requestedContactIds);
  let storedResult: any = storedResultValue;
  if (typeof storedResult === "string") {
    try { storedResult = JSON.parse(storedResult); } catch {
      throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:stored_result_corrupt");
    }
  }
  const storedScope = storedResult?.selectedContactScope;
  if (!currentScope) {
    if (storedScope) throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:scope_mismatch");
    return;
  }
  const storedIds = normalizeFrozenContactScope(storedScope?.selectedContactIds);
  const storedTargets = Array.isArray(storedScope?.resolvedTargets) ? storedScope.resolvedTargets : [];
  const idsMatch = !!storedIds &&
    storedIds.length === currentScope.selectedContactIds.length &&
    storedIds.every((id, index) => id === currentScope.selectedContactIds[index]);
  const targetById = new Map(storedTargets.map((target: any) => [Number(target.contactId), target]));
  const targetsMatch = storedTargets.length === currentScope.resolvedTargets.length &&
    currentScope.resolvedTargets.every((target) => {
      const stored = targetById.get(target.contactId) as any;
      return !!stored &&
        Number(stored.businessId) === target.businessId &&
        String(stored.linkDecisionId) === target.linkDecisionId &&
        Number(stored.linkRevision) === target.linkRevision;
    });
  if (!idsMatch || !targetsMatch) {
    throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:scope_mismatch");
  }
}

export interface SfpValidationPreview {
  cohortRunId: string;
  cohortFrozenHash: string;
  cohortSize: number;
  addressesForValidation: number;
  businessesWithoutCandidate: number;
  provider: "zerobounce";
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  pricingAvailable: boolean;
  maxValidations: number;
  selectedCandidates: Array<{
    businessId: number;
    candidateId: string;
    maskedValue: string;
    confidence: number;
    contactBusinessLinkDecisionId?: string | null;
    contactBusinessLinkRevision?: number | null;
  }>;
  selectedContactScope?: {
    selectedContactIds: number[];
    resolvedTargets: SfpSelectedContactTarget[];
    completedContactReceipts: SfpValidationSelectionSnapshot["completedContactReceipts"];
    scopeCoverageComplete: boolean;
  };
  scopeCapabilities: {
    selectedContactIds: true;
    selectedContactIdsMax: number;
    exactTargetOnlyTransport: true;
    frozenScopeCannotBeBroadened: true;
  };
  gateOpen: boolean;
  gateBlockedReason: string | null;
  capturedAt: string;
  /** Must be passed back verbatim to executeSfpValidation. */
  snapshotHash: string;
}

export interface SfpValidationResult {
  cohortRunId: string;
  idempotencyKey: string;
  addressesValidated: number;
  providerRequests: number;
  validCount: number;
  catchAllCount: number;
  invalidCount: number;
  failedCount: number;
  eligibilityRowsCreated: number;
  /** Always true — no outreach is sent */
  zeroOutreachConfirmed: true;
  completedAt: string;
  selectedContactScope?: {
    selectedContactIds: number[];
    resolvedTargets: SfpSelectedContactTarget[];
    completedContactReceipts: SfpValidationSelectionSnapshot["completedContactReceipts"];
    scopeCoverageComplete: boolean;
  };
}

/**
 * Keep every frozen member in ROI order. Whether an address is exhausted is
 * candidate-specific: a later email/contact revision must be allowed to
 * reopen a business whose previous address was rejected or required review.
 */
async function getUndecidedCohortBizIds(cohortRunId: string): Promise<number[]> {
  const members = rows(await db.execute(sql`
    SELECT cm.business_id FROM sfp_cohort_members cm
     WHERE cm.cohort_run_id = ${cohortRunId}::uuid
      ORDER BY cm.roi_score DESC,cm.business_id ASC
  `));
  return members.map((m: any) => Number(m.business_id));
}

type CandidateWithPin = UnifiedSfpCandidateView & { _normalizedHash?: string | null; _candidateRevision?: string; _retryAttempt?: number };

function candidateSourceId(candidate: Pick<UnifiedSfpCandidateView, "sourceKind" | "evidenceId">): string {
  return candidate.sourceKind === "contact" ? candidate.evidenceId.replace(/^contact:/, "") : candidate.evidenceId;
}

async function getDurableScopedContactReceipts(
  cohortRunId: string,
  targets: SfpSelectedContactTarget[],
  policy: SfpActivePolicy,
): Promise<SfpValidationSelectionSnapshot["completedContactReceipts"]> {
  if (targets.length === 0) return [];
  const businessIds = [...new Set(targets.map((target) => target.businessId))];
  const found = rows(await db.execute(sql`
    SELECT e.id AS eligibility_id,e.contact_id,e.business_id,e.status,e.zb_outcome,e.decision_reason,
           e.normalized_value_hash,e.normalized_value_hash_version,e.updated_at,
           e.contact_business_link_decision_id,e.contact_business_link_revision,
           c.email,c.email_token_hash
      FROM sfp_outreach_eligibility e
      JOIN contacts c ON c.id=e.contact_id
     WHERE e.cohort_run_id=${cohortRunId}::uuid
       AND e.business_id=ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`),sql`, `)}]::integer[])
       AND e.source_kind='contact'
       AND e.status NOT IN ('validation_pending','discovery_required')
       AND e.policy_version=${policy.version}
       AND e.policy_document_id=${policy.id}::uuid
       AND e.policy_document_hash=${policy.documentHash}
  `));
  const targetByContact = new Map(targets.map((target) => [target.contactId, target]));
  return found.map((row: any) => {
    const contactId = Number(row.contact_id);
    const target = targetByContact.get(contactId);
    const hashVersion = Number(row.normalized_value_hash_version);
    const currentAddressHash = hashVersion === 1 && row.email
      ? createHash("sha256").update(`email\0${String(row.email).trim().toLowerCase()}`).digest("hex")
      : hashVersion === 0 ? String(row.email_token_hash ?? "") : "";
    if (!target || target.businessId !== Number(row.business_id) ||
        target.linkDecisionId !== String(row.contact_business_link_decision_id) ||
        target.linkRevision !== Number(row.contact_business_link_revision) ||
        currentAddressHash !== String(row.normalized_value_hash)) return null;
    return {
      eligibilityId: String(row.eligibility_id),
      contactId,
      businessId: target.businessId,
      status: String(row.status),
      zbOutcome: row.zb_outcome == null ? null : String(row.zb_outcome),
      decisionReason: row.decision_reason == null ? null : String(row.decision_reason),
      normalizedAddressHash: String(row.normalized_value_hash),
      updatedAt: String(row.updated_at),
      linkDecisionId: target.linkDecisionId,
      linkRevision: target.linkRevision,
    };
  }).filter((receipt: any): receipt is SfpValidationSelectionSnapshot["completedContactReceipts"][number] => receipt !== null)
    .sort((a, b) => a.businessId - b.businessId);
}

/** Best currently actionable candidate per business, retaining justified alternatives. */
async function selectWinnersPerBusiness(
  bizIds: number[],
  cohortRunId: string,
  policyVersion: number,
  selectedContactTargets?: SfpSelectedContactTarget[],
): Promise<Map<number, UnifiedSfpCandidateView>> {
  const unified = await getUnifiedSfpCandidates(bizIds) as CandidateWithPin[];
  if (!unified.length) return new Map();
  for (const cand of unified) {
    cand._normalizedHash = cand.normalizedValueHash;
    cand._candidateRevision = [
      cand.createdAt,
      cand.contactBusinessLinkDecisionId ?? "",
      cand.contactBusinessLinkRevision ?? "",
    ].join(":");
  }
  if (selectedContactTargets) {
    const targetsByContact = new Map(selectedContactTargets.map((target) => [target.contactId, target]));
    for (let index = unified.length - 1; index >= 0; index--) {
      const candidate = unified[index];
      const contactId = candidate.sourceKind === "contact" && candidate.evidenceId.startsWith("contact:")
        ? Number(candidate.evidenceId.slice("contact:".length))
        : NaN;
      const target = targetsByContact.get(contactId);
      if (!target ||
          candidate.businessId !== target.businessId ||
          candidate.contactBusinessLinkDecisionId !== target.linkDecisionId ||
          Number(candidate.contactBusinessLinkRevision) !== target.linkRevision) {
        unified.splice(index, 1);
      }
    }
  }
  if (!unified.length) return new Map();
  const history = rows(await db.execute(sql`
    SELECT business_id,source_kind,candidate_id::text AS candidate_id,
           paid_candidate_evidence_id::text AS paid_id,contact_id::text AS contact_id,
           normalized_value_hash,status,updated_at,decision_reason
      FROM sfp_outreach_eligibility
     WHERE cohort_run_id=${cohortRunId}::uuid
       AND business_id=ANY(ARRAY[${sql.join(bizIds.map(x=>sql`${x}`),sql`, `)}]::integer[])
       AND policy_version=${policyVersion}
  `));
  const lastByBiz = new Map<number, any>();
  for (const row of history) lastByBiz.set(Number(row.business_id), row);
  const candidateWorkRows = rows(await db.execute(sql`
    SELECT i.business_id,i.state,i.attempt_count,i.next_attempt_at,i.lease_expires_at,i.redacted_result,i.updated_at
      FROM sfp_stage_items i JOIN sfp_stage_runs s ON s.id=i.stage_run_id
     WHERE s.cohort_run_id=${cohortRunId}::uuid AND i.provider='zerobounce'
       AND i.business_id=ANY(ARRAY[${sql.join(bizIds.map(x=>sql`${x}`),sql`, `)}]::integer[])
      ORDER BY i.updated_at DESC
  `));
  const latestCandidateWork = new Map<string, any>();
  for (const row of candidateWorkRows) {
    let result: any = row.redacted_result;
    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch { result = {}; }
    }
    const candidateId = result?.sourceKind === "free" ? result.candidateId
      : result?.sourceKind === "paid" ? result.paidCandidateEvidenceId
      : result?.sourceKind === "contact" ? result.contactId : null;
    if (!result?.sourceKind || !candidateId || !result?.normalizedAddressHash ||
        Number(result.policyVersion) !== policyVersion) continue;
    const hashVersion = Number(result.normalizedAddressHashVersion ?? 1);
    const key = `${row.business_id}:${result.sourceKind}:${candidateId}:${result.normalizedAddressHash}:${hashVersion}:${result.candidateRevision ?? ""}:${policyVersion}`;
    if (!latestCandidateWork.has(key)) latestCandidateWork.set(key, { ...row, result });
  }
  const now = Date.now();
  const ranked = unified
    .filter((cand) => cand.field === "email" && ["staged", "validation_admitted"].includes(cand.disposition) && !cand.duplicateOfEvidenceId)
    .sort((a, b) => b.confidence - a.confidence || a.businessId - b.businessId || a.evidenceId.localeCompare(b.evidenceId));
  const winners = new Map<number, UnifiedSfpCandidateView>();
  for (const cand of ranked) {
    if (winners.has(cand.businessId)) continue;
    const candidateKey = `${cand.businessId}:${cand.sourceKind}:${candidateSourceId(cand)}:${cand._normalizedHash ?? ""}:${cand.normalizedValueHashVersion ?? ""}:${cand._candidateRevision ?? cand.createdAt}:${policyVersion}`;
    const candidateWork = latestCandidateWork.get(candidateKey);
    if (candidateWork) {
      if (candidateWork.state === "claimed" && Date.parse(String(candidateWork.lease_expires_at)) <= now) {
        // A worker died after its durable claim; the claim helper below can
        // atomically take over this expired lease.
      } else if (candidateWork.state === "claimed") {
        continue;
      } else if (candidateWork.state === "retry") {
        if (now < Date.parse(String(candidateWork.next_attempt_at))) continue;
        cand._retryAttempt = Number(candidateWork.attempt_count ?? 0) + 1;
      } else {
        continue;
      }
    }
    const prior = lastByBiz.get(cand.businessId);
    if (!candidateWork && cand.sourceKind !== "contact" && prior && prior.source_kind === cand.sourceKind && prior.normalized_value_hash &&
        String(prior.normalized_value_hash) === String(cand._normalizedHash)) {
      if (prior.status === "validation_pending") {
        cand._retryAttempt = Number(String(prior.decision_reason ?? "").match(/attempt:(\d+)/)?.[1] ?? 1) + 1;
        const retryAt = Date.parse(String(prior.updated_at)) + retryDelayMs(String(prior.decision_reason ?? ""));
        if (now < retryAt) continue;
      } else {
        continue; // terminal only for this exact address revision
      }
    }
    winners.set(cand.businessId, cand);
  }
  return winners;
}

function retryDelayMs(reason: string): number {
  const attempt = Number(reason.match(/attempt:(\d+)/)?.[1] ?? 1);
  return Math.min(24 * 60 * 60_000, 15 * 60_000 * 2 ** Math.max(0, attempt - 1));
}

function candidateClaimKey(cand: UnifiedSfpCandidateView, policyVersion: number): string {
  return createHash("sha256").update(JSON.stringify({
    sourceKind: cand.sourceKind,
    candidateId: cand.evidenceId,
    businessId: cand.businessId,
    normalizedAddressHash: cand.normalizedValueHash,
    normalizedAddressHashVersion: cand.normalizedValueHashVersion,
    candidateRevision: [
      cand.createdAt,
      cand.contactBusinessLinkDecisionId ?? "",
      cand.contactBusinessLinkRevision ?? "",
    ].join(":"),
    policyVersion,
  })).digest("hex");
}

/**
 * Claim a candidate across stage runs before decryption/provider work. A
 * transaction-scoped advisory lock serializes the absent-row race; the
 * durable stage-item lease then prevents a second worker from spending while
 * the first worker is outside the transaction. The key is redacted evidence
 * identity, never plaintext.
 */
/** @internal Durable candidate-scoped claim used by the validation worker and concurrency certification. */
export async function claimValidationCandidate(input: {
  stageRunId: string;
  cohortRunId: string;
  businessId: number;
  candidate: UnifiedSfpCandidateView;
  policyVersion: number;
}): Promise<boolean> {
  const { candidate } = input;
  const claimKey = candidateClaimKey(candidate, input.policyVersion);
  const reference = candidate.sourceKind === "free"
    ? { candidateId: candidate.evidenceId, paidCandidateEvidenceId: null, contactId: null }
    : candidate.sourceKind === "paid"
      ? { candidateId: null, paidCandidateEvidenceId: candidate.evidenceId, contactId: null }
      : { candidateId: null, paidCandidateEvidenceId: null, contactId: candidate.evidenceId.replace(/^contact:/, "") };
  // sfp_stage_items intentionally restricts paid-evidence FKs to discovery
  // providers (outscraper/apollo). Validation work stores its paid/contact
  // identity in redacted_result instead; only a free candidate can populate
  // the generic candidate_id FK on a zerobounce item.
  const stageCandidateId = candidate.sourceKind === "free" ? candidate.evidenceId : null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`sfp-validation-candidate:${claimKey}`},0))
    `);
    const active = rows(await tx.execute(sql`
      SELECT 1
        FROM sfp_stage_items i
        JOIN sfp_stage_runs s ON s.id=i.stage_run_id
       WHERE s.cohort_run_id=${input.cohortRunId}::uuid
         AND s.stage='validation'
         AND i.business_id=${input.businessId}
         AND i.provider='zerobounce'
         AND i.state='claimed'
         AND i.lease_expires_at>NOW()
         AND i.redacted_result->>'candidateClaimKey'=${claimKey}
       LIMIT 1
    `))[0];
    if (active) return false;
    const claimed = rows(await tx.execute(sql`
      INSERT INTO sfp_stage_items
        (stage_run_id,business_id,provider,candidate_id,paid_candidate_evidence_id,state,
         claim_token,lease_expires_at,attempt_count,next_attempt_at,redacted_result)
      VALUES (
        ${input.stageRunId}::uuid,${input.businessId},'zerobounce',
         ${stageCandidateId}::uuid,NULL,'claimed',
        gen_random_uuid(),NOW()+INTERVAL '30 minutes',1,NOW(),
        ${JSON.stringify({
          sourceKind: candidate.sourceKind,
          ...reference,
          candidateClaimKey: claimKey,
          candidateRevision: [
            candidate.createdAt,
            candidate.contactBusinessLinkDecisionId ?? "",
            candidate.contactBusinessLinkRevision ?? "",
          ].join(":"),
          normalizedAddressHash: candidate.normalizedValueHash,
          normalizedAddressHashVersion: candidate.normalizedValueHashVersion,
          policyVersion: input.policyVersion,
        })}::jsonb
      )
      ON CONFLICT (stage_run_id,business_id,provider) DO UPDATE
        SET candidate_id=EXCLUDED.candidate_id,
            paid_candidate_evidence_id=EXCLUDED.paid_candidate_evidence_id,
            state='claimed',claim_token=EXCLUDED.claim_token,
            lease_expires_at=EXCLUDED.lease_expires_at,
            attempt_count=sfp_stage_items.attempt_count+1,
            next_attempt_at=NOW(),redacted_result=EXCLUDED.redacted_result,
            completed_at=NULL,updated_at=NOW()
        WHERE sfp_stage_items.state<>'claimed' OR sfp_stage_items.lease_expires_at<=NOW()
      RETURNING id
    `))[0];
    return Boolean(claimed);
  });
}

// ── Preview (read-only) ───────────────────────────────────────────────────────

export async function previewSfpValidation(
  cohortRunId: string,
  opts: { selectedContactIds?: number[] } = {},
): Promise<SfpValidationPreview> {
  const runRow = rows(await db.execute(sql`
    SELECT * FROM sfp_cohort_runs WHERE id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (runRow.cohort_state !== "frozen" || runRow.voided_at || runRow.superseded_at) {
    throw new Error(`SFP_VALIDATION_PREVIEW:cohort_not_usable:state=${runRow.cohort_state}`);
  }

  const selection = await buildSfpValidationSelectionSnapshot(
    cohortRunId,
    SFP_VALIDATION_MAX,
    opts.selectedContactIds,
  );
  const bizIds = selection.businessIds;
  const allMembers = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members WHERE cohort_run_id = ${cohortRunId}::uuid
  `));

  const selected = selection.selected;

  let gateBlockedReason: string | null = null;
  try {
    if (selection.selectedContactIds && !selection.scopeCoverageComplete) {
      throw new Error("SFP_SELECTED_CONTACTS_NOT_ALL_ACTIONABLE");
    }
    if (!(await isSfpValidationPromotionEnabled())) {
      throw new Error("FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED");
    }
    await assertSfpRuntimeAuthority(cohortRunId);
    const { assertPaidBudgetAuthorized } = await import("../mi09-pilot-authority");
    await assertPaidBudgetAuthorized();
    const control = rows(await db.execute(sql`
      SELECT enabled,circuit_state
        FROM provider_controls WHERE provider='zerobounce'
    `))[0];
    if (!control?.enabled || control.circuit_state !== "closed") throw new Error("ZEROBOUNCE_PROVIDER_DISABLED");
  } catch (error: any) {
    gateBlockedReason = String(error?.message ?? error);
  }
  const unitPrice = await currentSfpUnitPrice("zerobounce");

  return {
    cohortRunId,
    cohortFrozenHash: String(runRow.cohort_hash),
    cohortSize: allMembers.length,
    addressesForValidation: selected.length,
    businessesWithoutCandidate: bizIds.length - selection.totalWinners,
    provider: "zerobounce",
    estimatedCostMicros: selected.length * (unitPrice ?? 0),
    worstCaseCostMicros: SFP_VALIDATION_MAX * (unitPrice ?? 0),
    pricingAvailable: unitPrice !== null,
    maxValidations: SFP_VALIDATION_MAX,
    selectedCandidates: selected.map(([businessId, c]) => ({
      businessId,
      candidateId: c.evidenceId,
      maskedValue: c.maskedValue,
      confidence: c.confidence,
      ...(c.sourceKind === "contact" ? {
        contactBusinessLinkDecisionId: c.contactBusinessLinkDecisionId,
        contactBusinessLinkRevision: c.contactBusinessLinkRevision,
      } : {}),
    })),
    ...(selection.selectedContactIds && selection.resolvedTargets ? {
      selectedContactScope: {
        selectedContactIds: selection.selectedContactIds,
        resolvedTargets: selection.resolvedTargets,
        completedContactReceipts: selection.completedContactReceipts,
        scopeCoverageComplete: selection.scopeCoverageComplete,
      },
    } : {}),
    scopeCapabilities: {
      selectedContactIds: true,
      selectedContactIdsMax: SFP_SELECTED_CONTACTS_MAX,
      exactTargetOnlyTransport: true,
      frozenScopeCannotBeBroadened: true,
    },
    gateOpen: gateBlockedReason === null,
    gateBlockedReason,
    capturedAt: new Date().toISOString(),
    snapshotHash: selection.snapshotHash,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeSfpValidation(
  cohortRunId: string,
  opts: {
    idempotencyKey: string;
    actorId: string;
    maxValidations?: number;
    selectedContactIds?: number[];
    /** The snapshotHash returned by previewSfpValidation for this exact run. Required. */
    snapshotHash: string;
    /** Fake transport for tests. (candidateId, REAL decrypted email) → ZbOutcome */
    zbTransport?: (candidateId: string, realEmail: string) => Promise<SfpZbOutcome>;
    /** Test seam for MX checks; production always uses the real DNS resolver. */
    mxCheck?: typeof checkMxRecord;
  },
): Promise<SfpValidationResult> {
  if (!opts.snapshotHash) throw new Error("SFP_VALIDATION_BLOCKED:snapshotHash_required");
  const maxValidations = Math.max(1, Math.min(opts.maxValidations ?? SFP_VALIDATION_MAX, SFP_VALIDATION_MAX));
  const existingStage = rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='validation' AND idempotency_key=${opts.idempotencyKey} LIMIT 1
  `))[0];
  if (existingStage?.state === "completed" && existingStage.stored_result) {
    if (String(existingStage.cohort_run_id) !== String(cohortRunId) ||
        String(existingStage.preview_snapshot_hash ?? "") !== String(opts.snapshotHash) ||
        Number(existingStage.max_items) !== maxValidations) {
      throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:immutable_request_mismatch");
    }
    await assertValidationReplayScopeMatches(cohortRunId, opts.selectedContactIds, existingStage.stored_result);
    return existingStage.stored_result as SfpValidationResult;
  }

  const runRow = rows(await db.execute(sql`
    SELECT r.*,p.is_active FROM sfp_cohort_runs r JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id = ${cohortRunId}::uuid LIMIT 1
  `))[0];
  if (!runRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (runRow.cohort_state !== "frozen" || runRow.voided_at || runRow.superseded_at) {
    throw new Error(`SFP_VALIDATION_BLOCKED:cohort_not_usable:state=${runRow.cohort_state}`);
  }

  if (!runRow.is_active) throw new Error("SFP_VALIDATION_BLOCKED:program_inactive");
  if (!opts.zbTransport && !(await isSfpValidationPromotionEnabled())) {
    throw new Error("SFP_VALIDATION_BLOCKED:FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED");
  }

  const policy = await getActiveSfpOutreachPolicy();

  // Input-bound execution: recompute the candidate/policy snapshot preview
  // and require it to still match. A pricing schedule is not a prerequisite
  // or part of the authorization snapshot.
  const currentSelection = await buildSfpValidationSelectionSnapshot(
    cohortRunId,
    maxValidations,
    opts.selectedContactIds,
  );
  const currentSnapshot = {
    snapshotHash: currentSelection.snapshotHash,
    payload: currentSelection.payload,
  };
  if (currentSnapshot.snapshotHash !== opts.snapshotHash) {
    throw new Error("SFP_VALIDATION_SNAPSHOT_MISMATCH:preview_stale_reissue_preview");
  }
  if (currentSelection.selectedContactIds && !currentSelection.scopeCoverageComplete) {
    throw new Error("SFP_VALIDATION_BLOCKED:SFP_SELECTED_CONTACTS_NOT_ALL_ACTIONABLE");
  }
  if (currentSelection.selectedContactIds && currentSelection.resolvedTargets) {
    const targetsByContact = new Map(currentSelection.resolvedTargets.map((target) => [target.contactId, target]));
    const scopeDrift = currentSelection.selected.some(([businessId, candidate]) => {
      const contactId = candidate.sourceKind === "contact" && candidate.evidenceId.startsWith("contact:")
        ? Number(candidate.evidenceId.slice("contact:".length)) : NaN;
      const target = targetsByContact.get(contactId);
      return !target || target.businessId !== businessId ||
        candidate.contactBusinessLinkDecisionId !== target.linkDecisionId ||
        Number(candidate.contactBusinessLinkRevision) !== target.linkRevision;
    });
    if (scopeDrift) throw new Error("SFP_VALIDATION_BLOCKED:SFP_SELECTED_CONTACT_SCOPE_DRIFT");
  }
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...currentSnapshot.payload, idempotencyKey: opts.idempotencyKey }))
    .digest("hex");

  // Same idempotency key with a materially different payload (different
  // cohort, snapshot, policy, or requested max) fails closed with a
  // conflict — it must never silently execute the new payload under the old
  // key's identity, nor silently replay the old result for a new request.
  if (existingStage && existingStage.payload_hash && existingStage.payload_hash !== payloadHash) {
    throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:payload_mismatch");
  }
  if (existingStage?.state === "completed") {
    // Idempotency keys are stage-scoped, not cohort-scoped: fail closed on a
    // replay whose cohort doesn't match the run this key was created under,
    // rather than silently returning another cohort's stored result.
    if (String(existingStage.cohort_run_id) !== String(cohortRunId)) {
      throw new Error("SFP_VALIDATION_IDEMPOTENCY_CONFLICT:cohort_mismatch");
    }
    if (existingStage.stored_result) {
      // A replay must never surface a decision that mutable safety gates
      // would now reject — re-evaluate DBPR/existing-customer/consent-tier
      // for every row this run marked outreach-eligible, and downgrade any
      // that no longer pass before returning the (otherwise unchanged) counts.
      const eligibleNow = rows(await db.execute(sql`
        SELECT id, business_id, consent_tier FROM sfp_outreach_eligibility
        WHERE cohort_run_id = ${cohortRunId}::uuid AND status = 'validated_outreach_eligible'
      `));
      for (const row of eligibleNow) {
        const recheck = await evaluateSfpMutableSafetyGates({
          businessId: Number(row.business_id), consentTier: row.consent_tier ?? null, policy,
        });
        if (!recheck.eligible) {
          await db.execute(sql`
            UPDATE sfp_outreach_eligibility
            SET status = ${recheck.status}, decision_reason = ${`replay_regate_failed:${recheck.reasonCode}`},
                updated_at = NOW()
            WHERE id = ${String(row.id)}::uuid
          `);
        }
      }
      return existingStage.stored_result as SfpValidationResult;
    }
    // Legacy pre-Task-2000 completed run with no stored result: reconstruct
    // exact counts from the eligibility rows it produced (best-effort replay).
    const counts = rows(await db.execute(sql`
      SELECT status,zb_outcome,COUNT(*)::int AS cnt FROM sfp_outreach_eligibility
      WHERE cohort_run_id = ${cohortRunId}::uuid GROUP BY status,zb_outcome
    `));
    const byStatus: Record<string, number> = {};
    let providerValidCount = 0;
    for (const r of counts) {
      byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + Number(r.cnt);
      if (r.zb_outcome === "valid") providerValidCount += Number(r.cnt);
    }
    return {
      cohortRunId,
      idempotencyKey: opts.idempotencyKey,
      addressesValidated: Number(existingStage.processed_count),
      providerRequests: Number(existingStage.processed_count),
      validCount: providerValidCount,
      catchAllCount: byStatus["catch_all_review"] ?? 0,
      invalidCount: byStatus["invalid"] ?? 0,
      failedCount: 0,
      eligibilityRowsCreated: 0,
      zeroOutreachConfirmed: true,
      completedAt: new Date().toISOString(),
    };
  }

  const bizIds = currentSelection.businessIds;
  if (bizIds.length === 0) {
    const totalMembers = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM sfp_cohort_members WHERE cohort_run_id = ${cohortRunId}::uuid
    `))[0];
    if (Number(totalMembers?.cnt ?? 0) === 0) throw new Error("SFP_VALIDATION_BLOCKED:EMPTY_COHORT");
    throw new Error("SFP_VALIDATION_BLOCKED:COHORT_FULLY_DECIDED");
  }

  const stageRun = existingStage ?? rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash,preview_snapshot_hash,started_at,last_heartbeat_at)
    VALUES (${cohortRunId}::uuid,'validation',${opts.idempotencyKey},${opts.actorId},
            'authorized',${maxValidations},'["zerobounce"]'::jsonb,
            ${payloadHash},${opts.snapshotHash},NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];
  const claim = rows(await db.execute(sql`
    UPDATE sfp_stage_runs
       SET state='running',claim_token=gen_random_uuid(),lease_expires_at=NOW()+INTERVAL '30 minutes',
           started_at=COALESCE(started_at,NOW()),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${String(stageRun.id)}::uuid AND (
       state IN ('authorized','pending','partial') OR (state='running' AND lease_expires_at<NOW())
     )
     RETURNING claim_token
  `))[0];
  if (!claim) throw new Error("SFP_STAGE_ALREADY_RUNNING");
  const claimToken = String(claim.claim_token);

  const selectedEntries = currentSelection.selected;

  let validationAttempts = 0, validCount = 0, catchAllCount = 0, invalidCount = 0, failedCount = 0, eligibilityRowsCreated = 0;

  for (const [bizId, cand] of selectedEntries) {
    const candidateClaimed = await claimValidationCandidate({
      stageRunId: String(stageRun.id), cohortRunId, businessId: bizId, candidate: cand, policyVersion: policy.version,
    });
    if (!candidateClaimed) continue;
    // Authoritative subject-type classification comes from the persisted
    // source row (free_discovery_candidates.subject_type /
    // sfp_paid_candidate_evidence.subject_type) — never inferred from
    // whether person-name evidence happens to be populated, since an
    // Apollo person-sourced candidate can lack a captured name and would
    // otherwise be misclassified as a business/role address.
    const subjectTypeForPrefilter: "business" | "person" = cand.subjectType === "person" ? "person" : "business";
    let providerDispatchedForCandidate = false;

    // ── Audited plaintext open (real email only — never masked_value) ──────
    // Contact-source correction: the outer tx is also passed into
    // openSfpCandidatePlaintext and retains its FOR SHARE ownership locks
    // through DNS, provider dispatch, post-provider rechecks, settlement,
    // eligibility writes, and business projection. Provider reservation uses
    // its own short transaction and commits before dispatch; settlement below
    // is deliberately given this same outer executor (never a nested
    // finalization transaction).
    //
    // F-13 correction: EVERY plaintext-dependent step — prechecks, MX/DNS,
    // suppression, safety-gate evaluation, freshness reuse, the ZeroBounce
    // transport call, the eligibility decision, and the eligibility/business
    // writes — now runs INSIDE this callback, using the decrypted address
    // only as a local variable of the callback's own stack frame. Nothing
    // plaintext-derived is ever returned across the boundary; the callback
    // resolves to `true` and mutates only the outer numeric counters via
    // closure. This replaces the prior `async (plaintext) => plaintext`
    // call site, which handed the decrypted address back to this function's
    // own scope — exactly the escape the audited boundary exists to
    // prevent, and which openSfpCandidatePlaintext() itself now also
    // refuses at runtime (see SFP_PLAINTEXT_ESCAPE_BLOCKED).
    try {
      await db.transaction(async (tx) => openSfpCandidatePlaintext(
        { reference: cand.candidateReference, cohortRunId, actorId: opts.actorId, purpose: "sfp_email_validation" },
        async (realEmail, resolvedReference) => {
          await assertSfpContactCandidateCurrent(resolvedReference, realEmail, tx);
          const contactEmailTokenHash = createHash("sha256").update(realEmail.trim().toLowerCase()).digest("hex");
          const candidateIdentityHash = cand.normalizedValueHash ??
            createHash("sha256").update(`email\0${realEmail.trim().toLowerCase()}`).digest("hex");
          const retryAttempt = (cand as CandidateWithPin)._retryAttempt ?? 1;

          // Real-address rejection (placeholder/synthetic/disposable-domain/
          // role-for-person), verified against the decrypted address before any
          // spend — this is the SAME canonical filter used by the free-discovery
          // winner-selection path (rejectEmailCandidate), never a second
          // implementation.
          const realRejection = rejectEmailCandidate(realEmail, subjectTypeForPrefilter);
          if (realRejection) {
            invalidCount++;
            await writeEligibilityRow({
              cohortRunId, bizId, cand, policyVersion: policy.version, status: "invalid",
              policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
              decisionReason: `precheck_${realRejection}:zero_provider_spend`, reasonCodes: [`precheck_${realRejection}`],
            }, tx);
            eligibilityRowsCreated++;
            return true;
          }

          // Authoritative MX/DNS check on the REAL domain, before any reservation.
          const realDomain = realEmail.split("@")[1]?.toLowerCase() ?? "";
          let mx: "ok" | "no_mx" | "dns_indeterminate" = "dns_indeterminate";
          try {
            mx = realDomain ? await (opts.mxCheck ?? checkMxRecord)(realDomain) : "no_mx";
          } catch {
            mx = "dns_indeterminate";
          }
          if (mx === "no_mx") {
            invalidCount++;
            await writeEligibilityRow({
              cohortRunId, bizId, cand, policyVersion: policy.version, status: "invalid",
              policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
              decisionReason: "precheck_no_mx:authoritative_ineligible:zero_provider_spend", reasonCodes: ["precheck_no_mx"],
            }, tx);
            eligibilityRowsCreated++;
            return true;
          }
          if (mx === "dns_indeterminate") {
            const exhausted = retryAttempt >= 5;
            if (exhausted) catchAllCount++;
            else failedCount++;
            await writeEligibilityRow({
              cohortRunId, bizId, cand, policyVersion: policy.version,
              policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
              status: exhausted ? "validated_review_required" : "validation_pending",
              decisionReason: exhausted ? "precheck_dns_indeterminate:exhausted:operator_review" :
                `precheck_dns_indeterminate:retryable:zero_provider_spend:attempt:${retryAttempt}`,
              reasonCodes: ["precheck_dns_indeterminate"], normalizedValueHash: candidateIdentityHash,
            }, tx);
            eligibilityRowsCreated++;
            return true;
          }

          // Canonical suppression check.
          const emailHash = createHash("sha256").update(`email\0${realEmail.toLowerCase().trim()}`).digest("hex");
          await assertSfpContactCandidateCurrent(resolvedReference, realEmail, tx);
          if (await isCanonicallySuppressed([emailHash, contactEmailTokenHash], tx)) {
            await writeEligibilityRow({
              cohortRunId, bizId, cand, policyVersion: policy.version, status: "validated_suppressed",
              policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
              decisionReason: "canonical_suppression_match", reasonCodes: ["policy_suppressed"],
              suppressionStatus: "suppressed",
            }, tx);
            eligibilityRowsCreated++;
            return true;
          }

          const consentTier = await lookupConsentTierByEmailHash(contactEmailTokenHash, tx);

          // Mutable safety gates (DBPR / existing-customer / consent-tier) —
          // re-run even on a freshness-reuse hit below.
          const gate = await evaluateSfpMutableSafetyGates({ businessId: bizId, consentTier, policy }, tx);
          if (!gate.eligible) {
            await writeEligibilityRow({
              cohortRunId, bizId, cand, policyVersion: policy.version, status: gate.status, decisionReason: gate.reasonCode,
              policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
              reasonCodes: [gate.reasonCode], consentTier,
            }, tx);
            eligibilityRowsCreated++;
            return true;
          }

          // ── Freshness reuse ──────────────────────────────────────────────────
          const fresh = await findFreshProviderObservation({
            businessId: bizId, emailTokenHash: contactEmailTokenHash, ttlDays: policy.validationTtlDays,
          }, tx);

          let zbOutcome: SfpZbOutcome = "failed";
          let reservation: Awaited<ReturnType<typeof reserveSfpProviderOperation>> | null = null;
          let rawStatus: string | null = null;
          let rawSubstatus: string | null = null;
          let reusedFromOperationId: string | null = null;
          let observationAt: string | null = null;
          const reasonCodes: string[] = [];

          if (fresh) {
            reusedFromOperationId = fresh.operationId;
            observationAt = fresh.observedAt;
            zbOutcome = fresh.outcome === "valid" ? "valid" : fresh.outcome === "invalid" ? "invalid" : "unknown";
            reasonCodes.push("policy_stale_reused");
          } else {
            try {
              if (opts.zbTransport) {
                validationAttempts++;
                providerDispatchedForCandidate = true;
                zbOutcome = await opts.zbTransport(String(cand.evidenceId), realEmail);
              } else {
                reservation = await reserveSfpProviderOperation({
                  stageRunId: String(stageRun.id), cohortRunId, businessId: bizId,
                  candidateId: cand.sourceKind === "free" ? cand.evidenceId : undefined,
                  provider: "zerobounce", purpose: "sfp_email_validation",
                  idempotencyKey: `${opts.idempotencyKey}:zerobounce:${cand.evidenceId}`, actorId: opts.actorId,
                });
                await assertCurrentSfpProviderReservation(reservation);
                await tx.execute(sql`
                  UPDATE sfp_stage_items
                     SET lease_expires_at=NOW()+INTERVAL '30 minutes',updated_at=NOW()
                   WHERE stage_run_id=${String(stageRun.id)}::uuid
                     AND business_id=${bizId} AND provider='zerobounce' AND state='claimed'
                     AND redacted_result->>'candidateClaimKey'=${candidateClaimKey(cand,policy.version)}
                `);
                const { verifyEmail } = await import("../sdr/zerobounce");
                validationAttempts++;
                providerDispatchedForCandidate = true;
                const result = await verifyEmail(realEmail);
                rawStatus = (result as any).status ?? null;
                rawSubstatus = (result as any).subStatus ?? null;
                if (result.skipped || result.outcome !== "completed") zbOutcome = "failed";
                else if (result.status === "valid") zbOutcome = "valid";
                else if (result.status === "invalid") zbOutcome = "invalid";
                else if (result.status === "unsafe") zbOutcome = "do_not_mail";
                else if (result.status === "unverified") zbOutcome = result.subStatus === "catch-all" ? "catch-all" : "unknown";
                else zbOutcome = "unknown";
              }
            } catch {
              zbOutcome = "failed";
            }
          }

          // Re-check under the same transaction and still-held contact/link
          // locks after any provider wait. A changed identity or new
          // suppression can never be promoted from the result of this call.
          let contactIdentityCurrentAfterProvider = true;
          try {
            await assertSfpContactCandidateCurrent(resolvedReference, realEmail, tx);
          } catch (error: any) {
            if (String(error?.message ?? error) === "SFP_CONTACT_SOURCE_PIN_STALE") {
              contactIdentityCurrentAfterProvider = false;
            } else {
              throw error;
            }
          }
          const suppressedAfterProvider = await isCanonicallySuppressed([emailHash, contactEmailTokenHash], tx);
          const consentTierAfterProvider = await lookupConsentTierByEmailHash(contactEmailTokenHash, tx);
          const gateAfterProvider = await evaluateSfpMutableSafetyGates({
            businessId: bizId,
            consentTier: consentTierAfterProvider,
            policy,
          }, tx);

          const validationAt = observationAt ?? new Date().toISOString();
          // Role-inbox / named-contact decision is driven by the same persisted
          // subject_type used for the pre-check above, never re-inferred from
          // whether name evidence happens to be present.
          const isNamedContact = subjectTypeForPrefilter === "person";
          const isRoleInbox = !isNamedContact;
          const roleEligibleForColdB2b = policy.roleInboxPolicy?.role_inbox_eligible_for_cold_b2b !== false;
          const namedRequiresReview = policy.roleInboxPolicy?.named_or_unclassified_requires_review !== false;

          // The active policy document's accepted/retryable outcome lists govern
          // whether a given ZeroBounce outcome can ever produce eligibility —
          // never a hardcoded switch independent of policy activation.
          const isAccepted = policy.acceptedOutcomes.includes(zbOutcome);
          const isRetryable = policy.retryableOutcomes.includes(zbOutcome);

          let status: OutreachEligibilityStatus = "invalid";
          let decisionReason = "";
          let suppressionStatus = "not_suppressed";

          if (!contactIdentityCurrentAfterProvider) {
            status = "validated_review_required";
            decisionReason = "contact_identity_changed_after_provider_dispatch";
            reasonCodes.push("contact_identity_changed_after_provider_dispatch");
          } else if (suppressedAfterProvider) {
            status = "validated_suppressed";
            decisionReason = "canonical_suppression_match_after_provider";
            reasonCodes.push("policy_suppressed");
            suppressionStatus = "suppressed";
          } else if (!gateAfterProvider.eligible) {
            status = gateAfterProvider.status;
            decisionReason = gateAfterProvider.reasonCode;
            reasonCodes.push(gateAfterProvider.reasonCode);
          } else if (zbOutcome === "valid" && isAccepted) {
            const roleOk = isRoleInbox && roleEligibleForColdB2b;
            const emailTypePolicy = evaluateSfpEmailTypePolicy({
              namedContact: isNamedContact, roleInbox: isRoleInbox, policy,
            });
            const eligibleByPolicy = emailTypePolicy.status === "eligible_for_staging_review";
            status = eligibleByPolicy ? "validated_outreach_eligible" : "validated_review_required";
            decisionReason = roleOk
              ? "zb_valid:first_party_role_inbox:policy_eligible"
              : isRoleInbox
                ? "zb_valid:role_inbox_not_policy_eligible:operator_review_required"
                : namedRequiresReview
                  ? "zb_valid:named_or_unclassified_address:operator_review_required"
                  : "zb_valid:named_contact:policy_eligible";
            reasonCodes.push(eligibleByPolicy ? isNamedContact ? "zb_valid_named_contact_policy_eligible" : "zb_valid_role_inbox_eligible" : "zb_valid_review_required");
            validCount++;
          } else if (zbOutcome === "catch-all") {
            status = "catch_all_review";
            decisionReason = "zb_catch_all:operator_review_required";
            reasonCodes.push("zb_catch_all_review");
            catchAllCount++;
          } else if (zbOutcome === "unknown") {
            const exhausted = retryAttempt >= 3;
            status = exhausted ? "validated_review_required" : "validation_pending";
            decisionReason = exhausted
              ? "zb_unknown:retry_exhausted:manual_review_required"
              : `zb_unknown:retryable_with_backoff:attempt:${retryAttempt}`;
            reasonCodes.push(exhausted ? "zb_unknown_exhausted_review" : "zb_unknown_retryable");
            if (exhausted) catchAllCount++;
            else failedCount++;
          } else if (zbOutcome === "failed") {
            const exhausted = retryAttempt >= 5;
            status = exhausted ? "validated_review_required" : "validation_pending";
            decisionReason = exhausted ? "zb_transport_failed:retry_exhausted:manual_review_required" :
              `zb_transport_failed:retry_required:attempt:${retryAttempt}`;
            reasonCodes.push(exhausted ? "zb_transport_failed_exhausted_review" : "zb_transport_failed_retryable");
            if (exhausted) catchAllCount++;
            else failedCount++;
          } else if (isRetryable) {
            status = "validation_pending";
            decisionReason = `zb_${zbOutcome}:retryable_per_policy:attempt:${retryAttempt}`;
            reasonCodes.push(`zb_${zbOutcome}_retryable`);
            failedCount++;
          } else {
            // invalid, spamtrap, abuse, do_not_mail, or a 'valid' outcome the
            // active policy does not (or no longer) accept.
            status = "invalid";
            decisionReason = `zb_${zbOutcome}:not_deliverable_per_policy`;
            reasonCodes.push(`zb_${zbOutcome}_not_deliverable`);
            invalidCount++;
          }

          // ── Atomic finalization: settlement + eligibility write + counters ────
          // realEmail is written ONLY here, inside this same audited
          // callback — it never leaves this stack frame.
          {
            if (reservation) {
              const obs = zbOutcome === "valid" ? "valid" : zbOutcome === "invalid" || zbOutcome === "spamtrap" || zbOutcome === "abuse" || zbOutcome === "do_not_mail" ? "invalid" : zbOutcome === "failed" ? "transport" : "unknown";
              await settleSfpProviderOperation({
                reservation, outcome: zbOutcome === "failed" ? "failed" : "completed", observation: obs,
                businessId: bizId, emailTokenHash: contactEmailTokenHash,
              }, tx);
            }

            const expiresAt = new Date(Date.parse(validationAt) + policy.validationTtlDays * 86_400_000).toISOString();
            await tx.execute(sql`
              INSERT INTO sfp_outreach_eligibility
               (cohort_run_id, business_id, candidate_id, paid_candidate_evidence_id, contact_id, source_kind,
                contact_business_link_decision_id,contact_business_link_revision,normalized_value_hash_version,
                 policy_version, status, decision_reason, zb_outcome, validation_at, validation_expires_at,
                 named_contact, role_inbox, masked_email, discovery_source, evidence_confidence,
                 suppression_status, outreach_policy_version, outreach_policy_reason, validation_operation_id,
                 normalized_value_hash, policy_document_id, policy_document_hash, consent_tier,
                 raw_provider_status, raw_provider_substatus, reused_from_operation_id, reason_codes)
              VALUES (
                ${cohortRunId}::uuid, ${bizId},
                ${cand.sourceKind === "free" ? cand.evidenceId : null}::uuid,
                ${cand.sourceKind === "paid" ? cand.evidenceId : null}::uuid,
                ${cand.sourceKind === "contact" ? Number(cand.evidenceId.replace(/^contact:/, "")) : null}::int,
                ${cand.sourceKind},
                 ${cand.sourceKind === "contact" ? cand.contactBusinessLinkDecisionId : null}::uuid,
                 ${cand.sourceKind === "contact" ? cand.contactBusinessLinkRevision : null}::int,
                 ${cand.normalizedValueHashVersion ?? (candidateIdentityHash ? 1 : null)},
                ${policy.version}, ${status}, ${decisionReason}, ${String(zbOutcome)},
                ${validationAt}::timestamptz, ${expiresAt}::timestamptz,
                ${isNamedContact}, ${isRoleInbox}, ${cand.maskedValue}, ${cand.provider ?? "free"}, ${cand.confidence},
                 ${suppressionStatus}, ${policy.version}, ${decisionReason},
                 ${reservation?.operationId ?? null}::uuid,
                  ${candidateIdentityHash}, ${policy.id}::uuid, ${policy.documentHash}, ${consentTierAfterProvider},
                ${rawStatus}, ${rawSubstatus}, ${reusedFromOperationId}::uuid, ${JSON.stringify(reasonCodes)}::jsonb
              )
              ON CONFLICT (cohort_run_id, business_id, policy_version)
              DO UPDATE SET
                status = EXCLUDED.status, decision_reason = EXCLUDED.decision_reason,
                zb_outcome = EXCLUDED.zb_outcome, validation_at = EXCLUDED.validation_at,
                validation_expires_at = EXCLUDED.validation_expires_at,
                masked_email = EXCLUDED.masked_email, evidence_confidence = EXCLUDED.evidence_confidence,
                 named_contact=EXCLUDED.named_contact,role_inbox=EXCLUDED.role_inbox,
                 discovery_source=EXCLUDED.discovery_source,
                suppression_status = EXCLUDED.suppression_status, validation_operation_id = EXCLUDED.validation_operation_id,
                source_kind = EXCLUDED.source_kind, paid_candidate_evidence_id = EXCLUDED.paid_candidate_evidence_id,
                candidate_id = EXCLUDED.candidate_id, contact_id = EXCLUDED.contact_id, normalized_value_hash = EXCLUDED.normalized_value_hash,
                 contact_business_link_decision_id=EXCLUDED.contact_business_link_decision_id,
                 contact_business_link_revision=EXCLUDED.contact_business_link_revision,
                 normalized_value_hash_version=EXCLUDED.normalized_value_hash_version,
                 outreach_policy_version=EXCLUDED.outreach_policy_version,
                 outreach_policy_reason=EXCLUDED.outreach_policy_reason,
                policy_document_id = EXCLUDED.policy_document_id, policy_document_hash = EXCLUDED.policy_document_hash,
                consent_tier = EXCLUDED.consent_tier, raw_provider_status = EXCLUDED.raw_provider_status,
                raw_provider_substatus = EXCLUDED.raw_provider_substatus, reused_from_operation_id = EXCLUDED.reused_from_operation_id,
                reason_codes = EXCLUDED.reason_codes, updated_at = NOW()
            `);

            if (zbOutcome === "valid" && contactIdentityCurrentAfterProvider &&
                !suppressedAfterProvider && gateAfterProvider.eligible) {
              await tx.execute(sql`
                UPDATE businesses
                   SET main_email=${realEmail},email_discovery_status='provider_valid',
                       email_validation_updated_at=NOW(),email_selected_candidate_hash=${emailHash},updated_at=NOW()
                 WHERE id=${bizId}
                   AND (main_email IS NULL OR email_selected_candidate_hash=${emailHash})
              `);
            }
          }
          eligibilityRowsCreated++;
          return true;
        },
        tx,
      ));
    } catch (err: any) {
      const message = String(err?.message ?? "");
      if (message === "SFP_CONTACT_SOURCE_PIN_STALE" && !providerDispatchedForCandidate) {
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE sfp_stage_items
               SET state='retry',claim_token=NULL,lease_expires_at=NULL,next_attempt_at=NOW(),
                   outcome_code='contact_source_pin_stale',updated_at=NOW()
             WHERE stage_run_id=${String(stageRun.id)}::uuid
               AND business_id=${bizId} AND provider='zerobounce'
          `);
          await tx.execute(sql`
            UPDATE sfp_stage_runs
               SET state='partial',claim_token=NULL,lease_expires_at=NULL,
                   failed_count=failed_count+1,last_heartbeat_at=NOW(),updated_at=NOW()
             WHERE id=${String(stageRun.id)}::uuid AND claim_token=${claimToken}::uuid
          `);
        });
        throw new Error("SFP_VALIDATION_BLOCKED:SFP_SELECTED_CONTACT_SCOPE_DRIFT");
      }
      // Only a failure to RESOLVE/decrypt the candidate reference itself is
      // treated as candidate_decryption_failed — a real error thrown by the
      // validation logic running inside the callback above must surface as
      // itself, not be relabeled as a decryption failure.
      const isResolveFailure = /^SFP_CANDIDATE_(REFERENCE_NOT_FOUND|NOT_OPENABLE|BUSINESS_NOT_IN_COHORT|ENVELOPE_NOT_FOUND)/.test(message);
      if (!isResolveFailure) throw err;
      if (process.env.SFP_DEBUG_DECRYPT) console.error("SFP_DEBUG_DECRYPT", bizId, err);
      failedCount++;
      await writeEligibilityRow({
        cohortRunId, bizId, cand, policyVersion: policy.version, status: "validation_pending",
        policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
        decisionReason: "candidate_decryption_failed", reasonCodes: ["candidate_decryption_failed"],
      });
      eligibilityRowsCreated++;
    }

    // Durable candidate-level work history lives in the existing stage-item
    // lease ledger. Eligibility remains the business/policy projection; this
    // separate redacted event prevents one candidate's later result from
    // erasing another candidate's retry/exhaustion state.
    const decision = rows(await db.execute(sql`
      SELECT status,zb_outcome,decision_reason,normalized_value_hash
        FROM sfp_outreach_eligibility
       WHERE cohort_run_id=${cohortRunId}::uuid AND business_id=${bizId}
         AND policy_version=${policy.version}
       LIMIT 1
    `))[0];
    if (decision) {
      const decisionReason = String(decision.decision_reason ?? "");
      const isRetry = decision.status === "validation_pending";
      const attemptCount = Number(decisionReason.match(/attempt:(\d+)/)?.[1] ?? (cand as CandidateWithPin)._retryAttempt ?? 1);
      const claimKey = candidateClaimKey(cand, policy.version);
      const nextAttemptAt = isRetry
        ? new Date(Date.now() + retryDelayMs(decisionReason)).toISOString()
        : new Date().toISOString();
      const evidenceReference = cand.sourceKind === "free"
        ? { candidateId: cand.evidenceId, paidCandidateEvidenceId: null, contactId: null }
        : cand.sourceKind === "paid"
          ? { candidateId: null, paidCandidateEvidenceId: cand.evidenceId, contactId: null }
          : { candidateId: null, paidCandidateEvidenceId: null, contactId: cand.evidenceId.replace(/^contact:/, "") };
      await db.execute(sql`
        INSERT INTO sfp_stage_items
          (stage_run_id,business_id,provider,candidate_id,paid_candidate_evidence_id,state,attempt_count,next_attempt_at,
           claim_token,lease_expires_at,outcome_code,redacted_result,completed_at)
        VALUES (
          ${String(stageRun.id)}::uuid,${bizId},'zerobounce',
          ${cand.sourceKind === "free" ? cand.evidenceId : null}::uuid,
           NULL,
          ${isRetry ? "retry" : decision.status === "validated_review_required" || decision.status === "catch_all_review" ? "review_required" : "completed"},
           ${attemptCount},${nextAttemptAt}::timestamptz,NULL,NULL,
          ${decisionReason.slice(0, 180)},
          ${JSON.stringify({
            sourceKind: cand.sourceKind, ...evidenceReference,
             candidateClaimKey: claimKey,
            candidateRevision: (cand as CandidateWithPin)._candidateRevision ?? cand.createdAt,
             normalizedAddressHash: cand.normalizedValueHash ?? decision.normalized_value_hash ?? null,
             normalizedAddressHashVersion: cand.normalizedValueHashVersion ?? 1,
            policyVersion: policy.version, outcome: decision.zb_outcome ?? null, status: decision.status,
            policyDocumentHash: currentSnapshot.payload.policyDocumentHash,
            snapshotHash: opts.snapshotHash,
          })}::jsonb,
          CASE WHEN ${isRetry} THEN NULL ELSE NOW() END
        )
        ON CONFLICT (stage_run_id,business_id,provider) DO UPDATE
          SET candidate_id=EXCLUDED.candidate_id,paid_candidate_evidence_id=EXCLUDED.paid_candidate_evidence_id,
              state=EXCLUDED.state,attempt_count=EXCLUDED.attempt_count,claim_token=NULL,lease_expires_at=NULL,
              next_attempt_at=EXCLUDED.next_attempt_at,outcome_code=EXCLUDED.outcome_code,
              redacted_result=EXCLUDED.redacted_result,completed_at=EXCLUDED.completed_at,updated_at=NOW()
      `);
    }
  }

  // Record discovery_required only if the unified pool has no actionable
  // candidate at all. A candidate omitted because of batch bounds, terminal
  // history, cooldown, or another worker's live claim is not missing evidence.
  const candidateBearingBizIds = new Set(
    (await getUnifiedSfpCandidates(bizIds))
      .filter(c => c.field === "email" && ["staged", "validation_admitted"].includes(c.disposition) && !c.duplicateOfEvidenceId)
      .map(c => c.businessId),
  );
  const noCandidateBizIds = bizIds.filter((bizId) => !candidateBearingBizIds.has(bizId));
  for (const bizId of noCandidateBizIds) {
    await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, policy_version, status, decision_reason)
      VALUES (${cohortRunId}::uuid, ${bizId}, ${policy.version},
              'discovery_required', 'no_staged_candidate')
      ON CONFLICT (cohort_run_id, business_id, policy_version) DO NOTHING
    `);
  }

  const resultCompletedContactReceipts = currentSelection.resolvedTargets
    ? await getDurableScopedContactReceipts(cohortRunId, currentSelection.resolvedTargets, policy)
    : [];
  const resultCompletedIds = new Set(resultCompletedContactReceipts.map((receipt) => receipt.contactId));
  const resultScopeCoverageComplete = !currentSelection.selectedContactIds ||
    currentSelection.selectedContactIds.every((contactId) => resultCompletedIds.has(contactId));
  const completedValidCount = resultCompletedContactReceipts
    .filter((receipt) => receipt.zbOutcome === "valid").length;
  const completedCatchAllCount = resultCompletedContactReceipts
    // This legacy counter includes exhausted pre-provider review decisions;
    // keep that meaning when rebuilding totals from durable scoped receipts.
    .filter((receipt) => receipt.status === "catch_all_review" ||
      (receipt.status === "validated_review_required" && (
        ["unknown", "failed"].includes(String(receipt.zbOutcome)) ||
        receipt.decisionReason === "precheck_dns_indeterminate:exhausted:operator_review"
      ))).length;
  const completedInvalidCount = resultCompletedContactReceipts
    .filter((receipt) => receipt.status === "invalid" ||
      ["invalid", "spamtrap", "abuse", "do_not_mail"].includes(String(receipt.zbOutcome))).length;
  const result: SfpValidationResult = {
    cohortRunId,
    idempotencyKey: opts.idempotencyKey,
    addressesValidated: validationAttempts,
    providerRequests: validationAttempts,
    validCount: currentSelection.selectedContactIds ? completedValidCount : validCount,
    catchAllCount: currentSelection.selectedContactIds ? completedCatchAllCount : catchAllCount,
    invalidCount: currentSelection.selectedContactIds ? completedInvalidCount : invalidCount,
    failedCount,
    eligibilityRowsCreated,
    zeroOutreachConfirmed: true,
    completedAt: new Date().toISOString(),
    ...(currentSelection.selectedContactIds && currentSelection.resolvedTargets ? {
      selectedContactScope: {
        selectedContactIds: currentSelection.selectedContactIds,
        resolvedTargets: currentSelection.resolvedTargets,
        completedContactReceipts: resultCompletedContactReceipts,
        scopeCoverageComplete: resultScopeCoverageComplete,
      },
    } : {}),
  };

  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failedCount > 0 ? "partial" : "completed"},claim_token=NULL,lease_expires_at=NULL,selected_count=${selectedEntries.length},
           processed_count=${validationAttempts},succeeded_count=${validCount+catchAllCount+invalidCount},
           failed_count=${failedCount},completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW(),
           stored_result=${JSON.stringify(result)}::jsonb
     WHERE id=${String(stageRun.id)}::uuid AND claim_token=${claimToken}::uuid
  `);

  return result;
}

async function writeEligibilityRow(input: {
  cohortRunId: string;
  bizId: number;
  cand: UnifiedSfpCandidateView;
  status: OutreachEligibilityStatus;
  decisionReason: string;
  reasonCodes: string[];
  suppressionStatus?: string;
  consentTier?: string | null;
  policyVersion: number;
  policyDocumentId: string;
  policyDocumentHash: string;
  normalizedValueHash?: string | null;
}, executor: { execute: (query: any) => Promise<any> } = db): Promise<void> {
  const policyVersion = input.policyVersion;
  const contactIdInt = input.cand.sourceKind === "contact"
    ? Number(input.cand.evidenceId.replace(/^contact:/, ""))
    : null;
  const normalizedValueHash = input.normalizedValueHash ?? input.cand.normalizedValueHash;
  const normalizedValueHashVersion = input.cand.normalizedValueHashVersion ?? (normalizedValueHash ? 1 : null);
  await executor.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, paid_candidate_evidence_id, contact_id, source_kind,
       contact_business_link_decision_id,contact_business_link_revision,normalized_value_hash_version,
       policy_version,policy_document_id,policy_document_hash,
       status, decision_reason, suppression_status, masked_email, discovery_source,
        consent_tier, reason_codes, normalized_value_hash,named_contact,role_inbox)
    VALUES (${input.cohortRunId}::uuid, ${input.bizId},
      ${input.cand.sourceKind === "free" ? input.cand.evidenceId : null}::uuid,
      ${input.cand.sourceKind === "paid" ? input.cand.evidenceId : null}::uuid,
      ${contactIdInt}::int,
      ${input.cand.sourceKind},
      ${input.cand.sourceKind === "contact" ? input.cand.contactBusinessLinkDecisionId : null}::uuid,
      ${input.cand.sourceKind === "contact" ? input.cand.contactBusinessLinkRevision : null}::int,
      ${normalizedValueHashVersion},
      ${policyVersion}, ${input.policyDocumentId}::uuid, ${input.policyDocumentHash},
      ${input.status}, ${input.decisionReason},
      ${input.suppressionStatus ?? "unchecked"}, ${input.cand.maskedValue}, ${input.cand.provider ?? "free"},
       ${input.consentTier ?? null}, ${JSON.stringify(input.reasonCodes)}::jsonb,
         ${normalizedValueHash},${input.cand.subjectType === "person"},${input.cand.subjectType !== "person"})
    ON CONFLICT (cohort_run_id, business_id, policy_version) DO UPDATE
      SET status=EXCLUDED.status, decision_reason=EXCLUDED.decision_reason,
          suppression_status=EXCLUDED.suppression_status, source_kind=EXCLUDED.source_kind,
          paid_candidate_evidence_id=EXCLUDED.paid_candidate_evidence_id, candidate_id=EXCLUDED.candidate_id,
           contact_id=EXCLUDED.contact_id,
           contact_business_link_decision_id=EXCLUDED.contact_business_link_decision_id,
           contact_business_link_revision=EXCLUDED.contact_business_link_revision,
           normalized_value_hash_version=EXCLUDED.normalized_value_hash_version,
           policy_document_id=EXCLUDED.policy_document_id,
           policy_document_hash=EXCLUDED.policy_document_hash,
            named_contact=EXCLUDED.named_contact,role_inbox=EXCLUDED.role_inbox,
            masked_email=EXCLUDED.masked_email,discovery_source=EXCLUDED.discovery_source,
           consent_tier=EXCLUDED.consent_tier, reason_codes=EXCLUDED.reason_codes,
           normalized_value_hash=EXCLUDED.normalized_value_hash, updated_at=NOW()
  `);
}
