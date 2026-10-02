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
 *  - Provider I/O runs without candidate/source locks; immutable settlement
 *    precedes a separately fenced short transaction for eligibility writes.
 *
 * SPF/DKIM/DMARC are sender-domain release controls and are never consulted
 * here — this module validates recipient addresses only.
 *
 * No runtime DDL — all tables created via migrations.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { type OutreachEligibilityStatus, isSfpValidationPromotionEnabled } from "./south-florida-prospecting";
import {
  assertCurrentSfpProviderReservation,
  assertSfpRuntimeAuthority,
  currentSfpUnitPrice,
  finishSfpProviderOperation,
  invokeSfpProviderTransport,
  reserveSfpProviderOperation,
  assertCurrentSfpStageFinalization,
  lockCurrentSfpRuntimeOwner,
  type SfpProviderBeforeDispatch,
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
  lockCurrentSfpOutreachPolicy,
  findFreshProviderObservation,
  isSfpProviderObservationFreshAt,
  effectiveSfpProviderObservationExpiry,
  evaluateSfpEmailTypePolicy,
  type SfpActivePolicy,
} from "./sfp-outreach-policy";
import { lockSfpContactAddress } from "./sfp-contact-address-lock";
import { isSfpReceiptProjectionRepairCandidate } from "./sfp-eligibility-receipt-repair";
import {
  lockSfpBusinessSafetySentinel,
  lockSfpEligibilityProjectionKey,
  lockSfpEligibilityProjectionWriteGate,
} from "./sfp-eligibility-locks";
import {
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
  type CommercialGraphNode,
} from "../commercial-graph-locks";
import {
  SFP_SELECTED_CONTACTS_MAX,
  normalizeFrozenContactScope,
  normalizeSelectedContactIds,
  resolveVerifiedSfpContactTargets,
  type SfpSelectedContactTarget,
} from "./sfp-contact-scope";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const SFP_VALIDATION_MAX = 25;

function safeProviderFailureDiagnosticCode(error: any): string {
  let current = error;
  for (let depth = 0; current && depth < 4; depth++, current = current?.cause) {
    const databaseCode = String(current?.code ?? current?.sqlState ?? "");
    const query = String(current?.query ?? "").toLowerCase();
    if (databaseCode === "57014") {
      if (query.includes("provider_operations") && query.includes("sfp_stage_items") &&
          query.includes("sfp_cohort_runs") && query.includes("for update")) {
        return "DB_QUERY_CANCELED_PROVIDER_DISPATCH_FENCE";
      }
      if (query.includes("routine-sfp-paid-budget") || query.includes("ladder-aggregate-paid-budget")) {
        return "DB_QUERY_CANCELED_PAID_LEDGER_LOCK";
      }
      if (query.includes("sfp_runtime_owner_authority")) {
        return "DB_QUERY_CANCELED_RUNTIME_OWNER_FENCE";
      }
      return "DB_QUERY_CANCELED";
    }
    if (/^[0-9A-Z]{5}$/.test(databaseCode)) return `DB_${databaseCode}`;
    const message = typeof current === "string" ? current : String(current?.message ?? "");
    if (/deadlock/i.test(message)) return "DB_DEADLOCK";
    if (/lock timeout/i.test(message)) return "DB_LOCK_TIMEOUT";
    if (/statement timeout/i.test(message)) return "DB_STATEMENT_TIMEOUT";
    if (/already executing/i.test(message)) return "DB_CLIENT_QUERY_CONCURRENCY";
    if (/connection (?:terminated|closed|lost)/i.test(message)) return "DB_CONNECTION_LOST";
    const safeErrorCode = String(current?.code ?? "");
    if (/^SFP_[A-Z0-9_:-]{1,112}$/.test(safeErrorCode) &&
        !/(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|PASSWORD|BEARER|AUTHORIZATION)/i.test(safeErrorCode)) {
      return safeErrorCode;
    }
    const safeMessageCode = message.trim();
    if (/^SFP_[A-Z0-9_:-]{1,112}$/.test(safeMessageCode) &&
        !/(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|PASSWORD|BEARER|AUTHORIZATION)/i.test(safeMessageCode)) {
      return safeMessageCode;
    }
  }
  const errorName = String(error?.name ?? error?.constructor?.name ?? "");
  if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(errorName) && errorName !== "Error") {
    return `EXCEPTION_${errorName.toUpperCase()}`;
  }
  return "PROVIDER_EXCEPTION_UNCLASSIFIED";
}

function emitProviderFailureDiagnostic(
  callback: ((phase: string, safeCode: string) => void) | undefined,
  phase: string,
  safeCode: string,
): void {
  try {
    callback?.(phase, safeCode);
  } catch {
    // Optional diagnostics must never change provider/finalization behavior.
  }
}

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
    policy.validationTtlDays,
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

/**
 * Revalidate every immutable input pin in a short transaction. Locks taken
 * here are released before reservation/dispatch and are reacquired only for
 * finalization; no candidate/business/contact lock survives provider I/O.
 */
async function isSfpValidationSourceAndRunCurrent(input: {
  cohortRunId: string;
  businessId: number;
  candidate: CandidateWithPin;
  resolved: ResolvedSfpCandidateReference;
  plaintext: string;
  policy: SfpActivePolicy;
  businessWrite?: boolean;
}, executor: { execute: (query: any) => Promise<any> }): Promise<boolean> {
  const { candidate, resolved } = input;
  const expectedHash = candidate._normalizedHash ?? candidate.normalizedValueHash ?? null;
  const plaintextHash = createHash("sha256")
    .update(`email\0${input.plaintext.trim().toLowerCase()}`).digest("hex");
  if (resolved.sourceKind !== candidate.sourceKind ||
      resolved.businessId !== input.businessId ||
      resolved.field !== "email" ||
      resolved.evidenceId !== candidate.evidenceId.replace(/^contact:/, "") ||
      String(resolved.createdAt) !== String(candidate.createdAt) ||
      (expectedHash !== null && String(resolved.normalizedValueHash ?? "") !== String(expectedHash)) ||
      (candidate.normalizedValueHashVersion !== undefined &&
        Number(resolved.normalizedValueHashVersion) !== Number(candidate.normalizedValueHashVersion)) ||
      String(resolved.normalizedValueHash ?? "") !== plaintextHash) {
    return false;
  }

  // Common authority order: policy -> typed commercial graph -> business
  // safety sentinel -> normalized address -> frozen cohort/source rows.
  await lockCurrentSfpOutreachPolicy(executor, input.policy);
  if (candidate.sourceKind === "contact") {
    const contactId = Number(resolved.evidenceId);
    const graphNodes: CommercialGraphNode[] = [
      { type: "contact", id: contactId },
      { type: "business", id: input.businessId },
    ];
    await lockCommercialGraphNodes(executor, graphNodes);
    await lockCommercialGraphMembershipSets(executor, graphNodes, ["contact_business"]);
  }
  await lockSfpBusinessSafetySentinel(
    executor, input.businessId, input.businessWrite ? "exclusive" : "shared",
  );
  await lockSfpContactAddress(executor, input.plaintext);

  // Authority pins are retained only by the short caller transaction.
  const authorityPins = rows(await executor.execute(sql`
    SELECT r.id
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
      JOIN sfp_cohort_runs r ON r.id=${input.cohortRunId}::uuid
      JOIN sfp_programs p ON p.id=r.program_id AND p.is_active=TRUE
      JOIN sfp_cohort_members m ON m.cohort_run_id=r.id AND m.business_id=${input.businessId}
      JOIN businesses b ON b.id=m.business_id AND b.record_class='canonical'
      JOIN sfp_cohort_decisions decision
        ON decision.cohort_run_id=r.id AND decision.business_id=m.business_id
       AND decision.selected=TRUE
     WHERE c.singleton=TRUE
       AND r.cohort_state='frozen' AND r.voided_at IS NULL AND r.superseded_at IS NULL
       AND d.id=${input.policy.id}::uuid AND d.version=${input.policy.version}
       AND d.document_hash=${input.policy.documentHash}
     LIMIT 1
     FOR SHARE OF c,d,r,p,m,decision
     ${input.businessWrite ? sql`FOR UPDATE OF b` : sql`FOR SHARE OF b`}
  `))[0];
  if (!authorityPins) return false;

  if (candidate.sourceKind === "contact") {
    if (String(resolved.contactBusinessLinkDecisionId ?? "") !== String(candidate.contactBusinessLinkDecisionId ?? "") ||
        Number(resolved.contactBusinessLinkRevision) !== Number(candidate.contactBusinessLinkRevision)) return false;
    try {
      await assertSfpContactCandidateCurrent(resolved, input.plaintext, executor);
    } catch (error: any) {
      if (String(error?.message ?? error) === "SFP_CONTACT_SOURCE_PIN_STALE") return false;
      throw error;
    }
  } else {
    const sourceRow = candidate.sourceKind === "free"
      ? rows(await executor.execute(sql`
          SELECT id,business_id,field,subject_type,disposition,normalized_value_hash,created_at
            FROM free_discovery_candidates
           WHERE id=${candidate.evidenceId}::uuid
             AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                              WHERE q.business_id=free_discovery_candidates.business_id AND q.cleared_at IS NULL)
           FOR SHARE
        `))[0]
      : rows(await executor.execute(sql`
          SELECT id,business_id,field,subject_type,disposition,normalized_value_hash,created_at
            FROM sfp_paid_candidate_evidence
           WHERE id=${candidate.evidenceId}::uuid
             AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                              WHERE q.business_id=sfp_paid_candidate_evidence.business_id AND q.cleared_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM sfp_discredited_paid_evidence d
                              WHERE d.evidence_id=sfp_paid_candidate_evidence.id)
           FOR SHARE
        `))[0];
    if (!sourceRow ||
        Number(sourceRow.business_id) !== input.businessId ||
        String(sourceRow.field) !== "email" ||
        String(sourceRow.subject_type ?? "business") !== String(resolved.subjectType ?? "business") ||
        !["staged", "validation_admitted"].includes(String(sourceRow.disposition)) ||
        String(sourceRow.normalized_value_hash) !== String(resolved.normalizedValueHash) ||
        String(sourceRow.created_at) !== String(candidate.createdAt)) {
      return false;
    }
  }

  return true;
}

async function isSfpValidationDispatchAuthorityCurrent(
  input: {
    cohortRunId: string;
    businessId: number;
    candidate: CandidateWithPin;
    resolved: ResolvedSfpCandidateReference;
    plaintext: string;
    policy: SfpActivePolicy;
    emailTokenHashes: string[];
    emailTokenHash: string;
  },
  executor: { execute: (query: any) => Promise<any> },
): Promise<{ current: boolean; reasonCode: string | null }> {
  if (!(await isSfpValidationSourceAndRunCurrent(input, executor))) {
    return { current: false, reasonCode: "SFP_CANDIDATE_SOURCE_PIN_STALE" };
  }
  const consentTier = await lookupConsentTierByEmailHash(input.emailTokenHash, executor);
  if (await isCanonicallySuppressed(input.emailTokenHashes, executor, [input.plaintext])) {
    return { current: false, reasonCode: "SFP_VALIDATION_ADDRESS_SUPPRESSED" };
  }
  const gate = await evaluateSfpMutableSafetyGates({
    businessId: input.businessId,
    consentTier,
    policy: input.policy,
    emailAddress: input.plaintext,
  }, executor);
  return gate.eligible
    ? { current: true, reasonCode: null }
    : { current: false, reasonCode: `SFP_VALIDATION_${gate.reasonCode.toUpperCase()}` };
}

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
  validationTtlDays: number,
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
    SELECT e.business_id,e.source_kind,e.candidate_id::text AS candidate_id,
           e.paid_candidate_evidence_id::text AS paid_id,e.contact_id::text AS contact_id,
           e.normalized_value_hash,e.normalized_value_hash_version,e.status,e.updated_at,e.decision_reason,
           (
             e.status='validated_outreach_eligible' AND e.staging_intent_id IS NULL
             AND EXISTS (
               SELECT 1 FROM provider_observations po
               JOIN provider_operations op ON op.id=po.operation_id AND op.state='completed'
                WHERE po.operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
                  AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
                  AND po.subject_type='business' AND po.subject_id=e.business_id
                  AND po.observed_at<=clock_timestamp()
                  AND LEAST(COALESCE(po.expires_at,po.observed_at+(${validationTtlDays}::text||' days')::interval),
                            po.observed_at+(${validationTtlDays}::text||' days')::interval)>clock_timestamp()
                  AND (
                    e.validation_at IS NULL OR e.validation_expires_at IS NULL
                    OR e.validation_at NOT BETWEEN po.observed_at-INTERVAL '5 minutes'
                                                   AND po.observed_at+INTERVAL '5 minutes'
                    OR e.validation_expires_at>LEAST(
                      COALESCE(po.expires_at,po.observed_at+(${validationTtlDays}::text||' days')::interval),
                      po.observed_at+(${validationTtlDays}::text||' days')::interval)
                  )
             )
           ) AS receipt_projection_needs_repair
      FROM sfp_outreach_eligibility e
     WHERE e.cohort_run_id=${cohortRunId}::uuid
       AND e.business_id=ANY(ARRAY[${sql.join(bizIds.map(x=>sql`${x}`),sql`, `)}]::integer[])
       AND e.policy_version=${policyVersion}
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
    const prior = lastByBiz.get(cand.businessId);
    const repairProjection = isSfpReceiptProjectionRepairCandidate(prior, cand);
    if (candidateWork) {
      if (candidateWork.state === "claimed" && Date.parse(String(candidateWork.lease_expires_at)) <= now) {
        // A worker died after its durable claim; the claim helper below can
        // atomically take over this expired lease.
      } else if (candidateWork.state === "claimed") {
        continue;
      } else if (candidateWork.state === "retry") {
        if (now < Date.parse(String(candidateWork.next_attempt_at))) continue;
        cand._retryAttempt = Number(candidateWork.attempt_count ?? 0) + 1;
      } else if (!(candidateWork.state === "completed" && repairProjection)) {
        continue;
      }
    }
    if (!candidateWork && cand.sourceKind !== "contact" && prior && prior.source_kind === cand.sourceKind && prior.normalized_value_hash &&
        String(prior.normalized_value_hash) === String(cand._normalizedHash)) {
      if (prior.status === "validation_pending") {
        cand._retryAttempt = Number(String(prior.decision_reason ?? "").match(/attempt:(\d+)/)?.[1] ?? 1) + 1;
        const retryAt = Date.parse(String(prior.updated_at)) + retryDelayMs(String(prior.decision_reason ?? ""));
        if (now < retryAt) continue;
      } else if (!repairProjection) {
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

/** Redacted, read-only identifiers available to internal concurrency probes. */
export interface SfpValidationConcurrencyHookContext {
  readonly cohortRunId: string;
  readonly stageRunId: string;
  readonly businessId: number;
  readonly candidateClaimKey: string;
}

/**
 * Read-only observation hooks for trusted in-process certification.
 * They receive no transaction and no authority-bearing result; return values
 * are ignored. Callbacks may await a test-controller barrier, but lock-held
 * callbacks must only signal a competing writer and must never await that
 * writer while the writer is blocked on this transaction's locks.
 */
export interface SfpValidationConcurrencyTestHooks {
  /** Runs inside the marker tx after typed pins lock; signal a writer and return, do not await that writer. */
  onDispatchPinsLocked?: (context: SfpValidationConcurrencyHookContext) => void | Promise<void>;
  /** Runs before eligibility/business locks; may coordinate writer lock acquisition without changing authority. */
  onBeforeFinalEligibilityLocks?: (context: SfpValidationConcurrencyHookContext) => void | Promise<void>;
  /** Runs after final row/receipt locks, before final stage/receipt/clock rechecks; do not await a competing writer. */
  onFinalEligibilityLocksHeld?: (context: SfpValidationConcurrencyHookContext) => void | Promise<void>;
}

async function notifySfpValidationConcurrencyHook(
  hookName: keyof SfpValidationConcurrencyTestHooks,
  hook: ((context: SfpValidationConcurrencyHookContext) => void | Promise<void>) | undefined,
  context: SfpValidationConcurrencyHookContext,
): Promise<void> {
  if (!hook) return;
  try {
    await hook(Object.freeze({ ...context }));
  } catch {
    // Probes are observational only: a test callback cannot change the
    // provider receipt, eligibility status, or a policy/authority decision.
    console.error(`SFP_VALIDATION_CONCURRENCY_HOOK_FAILED:${hookName}`);
  }
}

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
    /** Optional allowlisted failure-code observer; never receives exception text or credentials. */
    onProviderFailureDiagnostic?: (phase: string, safeCode: string) => void;
    /** Internal direct-execution seam; HTTP routes deliberately do not forward request fields here. */
    concurrencyTestHooks?: SfpValidationConcurrencyTestHooks;
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
        SELECT id, cohort_run_id, business_id, policy_version, consent_tier FROM sfp_outreach_eligibility
        WHERE cohort_run_id = ${cohortRunId}::uuid AND status = 'validated_outreach_eligible'
      `));
      for (const row of eligibleNow) {
        await db.transaction(async (tx) => {
          await lockSfpEligibilityProjectionWriteGate(tx);
          await lockCurrentSfpOutreachPolicy(tx, policy);
          await lockSfpBusinessSafetySentinel(tx, Number(row.business_id));
          await lockSfpEligibilityProjectionKey(
            tx, String(row.cohort_run_id), Number(row.business_id), Number(row.policy_version),
          );
          const current = rows(await tx.execute(sql`
            SELECT id, consent_tier FROM sfp_outreach_eligibility
             WHERE id=${String(row.id)}::uuid AND status='validated_outreach_eligible'
             FOR UPDATE
          `))[0];
          if (!current) return;
          const recheck = await evaluateSfpMutableSafetyGates({
            businessId: Number(row.business_id), consentTier: current.consent_tier ?? null, policy,
          }, tx);
          if (!recheck.eligible) {
            await tx.execute(sql`
              UPDATE sfp_outreach_eligibility
                 SET status=${recheck.status},
                     decision_reason=${`replay_regate_failed:${recheck.reasonCode}`},
                     updated_at=NOW()
               WHERE id=${String(row.id)}::uuid
            `);
          }
        });
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
    let providerFinalizationAuthorityLost = false;
    let finalizationSourceContactId: number | undefined;
    const concurrencyHookContext: SfpValidationConcurrencyHookContext = Object.freeze({
      cohortRunId,
      stageRunId: String(stageRun.id),
      businessId: bizId,
      candidateClaimKey: candidateClaimKey(cand, policy.version),
    });
    const assertCurrentStageFinalization = async (executor: { execute: (query: any) => Promise<any> }) => {
      try {
        await assertCurrentSfpStageFinalization({
          stageRunId: concurrencyHookContext.stageRunId,
          stageClaimToken: claimToken,
          cohortRunId,
          businessId: bizId,
          candidateClaimKey: concurrencyHookContext.candidateClaimKey,
          sourceContactId: finalizationSourceContactId,
        }, executor);
      } catch (error) {
        providerFinalizationAuthorityLost = true;
        throw error;
      }
    };

    // ── Audited plaintext open (real email only — never masked_value) ──────
    // The audited callback owns plaintext, but is not wrapped in a
    // transaction. Source/run pins are checked in short transactions before
    // dispatch and again at finalization so no source lock spans provider I/O.
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
      await openSfpCandidatePlaintext(
        { reference: cand.candidateReference, cohortRunId, actorId: opts.actorId, purpose: "sfp_email_validation" },
        async (realEmail, resolvedReference) => {
          finalizationSourceContactId = resolvedReference.sourceKind === "contact"
            ? Number(resolvedReference.evidenceId) : undefined;
          const tx = db;
          const contactEmailTokenHash = createHash("sha256").update(realEmail.trim().toLowerCase()).digest("hex");
          const candidateIdentityHash = resolvedReference.normalizedValueHash ?? cand.normalizedValueHash ??
            createHash("sha256").update(`email\0${realEmail.trim().toLowerCase()}`).digest("hex");
          const retryAttempt = (cand as CandidateWithPin)._retryAttempt ?? 1;
          const sourcePinsCurrentBeforeWork = await db.transaction((sourceTx) =>
            isSfpValidationSourceAndRunCurrent({
              cohortRunId, businessId: bizId, candidate: cand as CandidateWithPin,
              resolved: resolvedReference, plaintext: realEmail, policy,
            }, sourceTx),
          );
          if (!sourcePinsCurrentBeforeWork) {
            await db.transaction(async (writeTx) => {
              await writeEligibilityRow({
                cohortRunId, bizId, cand, policyVersion: policy.version,
                status: "validated_review_required",
                policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
                decisionReason: "candidate_or_run_pin_stale_before_provider_dispatch",
                reasonCodes: ["candidate_or_run_pin_stale_before_provider_dispatch"],
                normalizedValueHash: candidateIdentityHash,
              }, writeTx);
            });
            eligibilityRowsCreated++;
            return true;
          }

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
          if (await isCanonicallySuppressed([emailHash, contactEmailTokenHash], tx, [realEmail])) {
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
          let providerFailure: {
            kind: "reservation_denied" | "not_dispatched" | "http_failure" | "ambiguous";
            phase: string;
            code: string;
          } | null = null;

          if (fresh) {
            reusedFromOperationId = fresh.operationId;
            observationAt = fresh.observedAt;
            zbOutcome = fresh.outcome === "valid" ? "valid" : fresh.outcome === "invalid" ? "invalid" : "unknown";
            reasonCodes.push("policy_stale_reused");
          } else {
            let providerFailurePhase = "reservation";
            try {
              reservation = await reserveSfpProviderOperation({
                stageRunId: String(stageRun.id), cohortRunId, businessId: bizId,
                candidateId: cand.sourceKind === "free" ? cand.evidenceId : undefined,
                provider: "zerobounce", purpose: "sfp_email_validation",
                idempotencyKey: `${opts.idempotencyKey}:zerobounce:${cand.evidenceId}`, actorId: opts.actorId,
                workUnit: "request",
              });
              providerFailurePhase = "reservation_assertion";
              await assertCurrentSfpProviderReservation(reservation);
              providerFailurePhase = "stage_lease_renewal";
              await db.execute(sql`
                UPDATE sfp_stage_items
                   SET lease_expires_at=NOW()+INTERVAL '30 minutes',updated_at=NOW()
                 WHERE stage_run_id=${String(stageRun.id)}::uuid
                   AND business_id=${bizId} AND provider='zerobounce' AND state='claimed'
                   AND redacted_result->>'candidateClaimKey'=${candidateClaimKey(cand,policy.version)}
              `);
              providerFailurePhase = "provider_adapter_import";
              const verifyTransport = opts.zbTransport
                ? async () => opts.zbTransport!(String(cand.evidenceId), realEmail)
                : async () => {
                    const { verifyEmail } = await import("../sdr/zerobounce");
                    return verifyEmail(realEmail);
                  };
              providerFailurePhase = "source_pin_recheck_before_dispatch";
              const beforeDispatch: SfpProviderBeforeDispatch = async (markerTx) => {
                const decision = await isSfpValidationDispatchAuthorityCurrent({
                  cohortRunId,
                  businessId: bizId,
                  candidate: cand as CandidateWithPin,
                  resolved: resolvedReference,
                  plaintext: realEmail,
                  policy,
                  emailTokenHashes: [emailHash, contactEmailTokenHash],
                  emailTokenHash: contactEmailTokenHash,
                }, markerTx);
                if (!decision.current) throw new Error(decision.reasonCode ?? "SFP_VALIDATION_DISPATCH_PINS_STALE");
                await notifySfpValidationConcurrencyHook(
                  "onDispatchPinsLocked",
                  opts.concurrencyTestHooks?.onDispatchPinsLocked,
                  concurrencyHookContext,
                );
              };
              providerFailurePhase = "dispatch_boundary";
              const result = await invokeSfpProviderTransport(reservation, async () => {
                validationAttempts++;
                providerDispatchedForCandidate = true;
                return verifyTransport();
              }, beforeDispatch);
              providerFailurePhase = "provider_response_mapping";
              if (typeof (result as any)?.verifiedAt === "string" &&
                  Number.isFinite(Date.parse((result as any).verifiedAt))) {
                observationAt = new Date(Date.parse((result as any).verifiedAt)).toISOString();
              }
              const mappedRawStatus = (result as any).status;
              const mappedRawSubstatus = (result as any).subStatus;
              rawStatus = typeof mappedRawStatus === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(mappedRawStatus)
                ? mappedRawStatus : null;
              rawSubstatus = typeof mappedRawSubstatus === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(mappedRawSubstatus)
                ? mappedRawSubstatus : null;
              if ((result as any).skipped ||
                  ((result as any).outcome !== undefined && (result as any).outcome !== "completed")) {
                const failureReason = String((result as any).reason ?? "provider_unavailable");
                providerFailure = {
                  kind: ["http_4xx", "http_5xx"].includes(failureReason)
                    ? "http_failure"
                    : providerDispatchedForCandidate ? "ambiguous" : "not_dispatched",
                  phase: ["http_4xx", "http_5xx"].includes(failureReason)
                    ? "provider_http_response" : providerFailurePhase,
                  code: ["not_configured", "http_4xx", "http_5xx", "timeout", "transport", "parse_error"].includes(failureReason)
                    ? `ZEROBOUNCE_${failureReason.toUpperCase()}`
                    : "ZEROBOUNCE_UNAVAILABLE",
                };
                emitProviderFailureDiagnostic(opts.onProviderFailureDiagnostic, providerFailure.phase, providerFailure.code);
                zbOutcome = "unknown";
              } else if (typeof result === "string" &&
                  ["valid", "invalid", "catch-all", "spamtrap", "abuse", "do_not_mail", "unknown", "failed"].includes(result)) {
                zbOutcome = result as SfpZbOutcome;
              } else if ((result as any).status === "valid") zbOutcome = "valid";
              else if ((result as any).status === "invalid") zbOutcome = "invalid";
              else if ((result as any).status === "unsafe") zbOutcome = "do_not_mail";
              else if ((result as any).status === "unverified") {
                zbOutcome = (result as any).subStatus === "catch-all" ? "catch-all" : "unknown";
              } else zbOutcome = "unknown";
            } catch (error: any) {
              const safeCode = safeProviderFailureDiagnosticCode(error);
              emitProviderFailureDiagnostic(opts.onProviderFailureDiagnostic, providerFailurePhase, safeCode);
              providerFailure = {
                kind: providerDispatchedForCandidate ? "ambiguous" : reservation ? "not_dispatched" : "reservation_denied",
                phase: providerFailurePhase,
                code: safeCode,
              };
              zbOutcome = "unknown";
            }
          }

          // Persist the immutable provider dispatch receipt and billing before
          // considering promotion. Runtime settlement intentionally preserves
          // a marked response even if authority drifted; the later eligibility
          // transaction is independently fenced and may then refuse all
          // eligibility/projection writes.
          if (reservation) {
            const observation = zbOutcome === "valid" ? "valid" :
              zbOutcome === "invalid" || zbOutcome === "spamtrap" || zbOutcome === "abuse" || zbOutcome === "do_not_mail"
                ? "invalid"
                : zbOutcome === "failed" ? "transport" : "unknown";
            const settlementOutcome = providerFailure?.kind === "not_dispatched"
              ? "not_dispatched"
              : providerFailure?.kind === "ambiguous"
                ? "ambiguous"
                : providerFailure?.kind === "http_failure" || zbOutcome === "failed"
                  ? "failed"
                  : "completed";
            const providerRetrievalState = [
              rawStatus,
              rawSubstatus,
            ].filter((value): value is string => Boolean(value)).join(":") || String(zbOutcome);
            const settlement = await finishSfpProviderOperation({
              reservation,
              outcome: settlementOutcome,
              observation: providerFailure ? "transport" : observation,
              businessId: bizId,
              emailTokenHash: contactEmailTokenHash,
              workUnit: "request",
              workCompleted: providerDispatchedForCandidate ? 1 : 0,
              providerUsage: providerDispatchedForCandidate && !providerFailure
                ? { status: "known", quantity: "1", unit: "request", source: "zero_bounce_request" }
                : providerFailure?.kind === "http_failure" && providerDispatchedForCandidate
                  ? { status: "known", quantity: "1", unit: "request", source: "zero_bounce_http_response" }
                  : providerDispatchedForCandidate
                    ? { status: "unknown", quantity: null, unit: null, source: "zero_bounce_ambiguous_io" }
                    : { status: "not_applicable", quantity: null, unit: null, source: "zero_bounce_not_dispatched" },
              resultData: { retrievalState: providerRetrievalState },
            });
            if (!settlement.finalizationAllowed) {
              providerFinalizationAuthorityLost = true;
              throw new Error("SFP_STAGE_FINALIZATION_FENCE_LOST");
            }
          }

          // Final eligibility uses a short transaction after provider
          // settlement. Re-read the owner/stage claim, source, cohort, policy,
          // suppression, consent and mutable safety gates; a changed source
          // is held without erasing the real provider receipt.
          await db.transaction(async (tx) => {
            await lockCurrentSfpRuntimeOwner(tx);
            // The barrier must precede the first eligibility/business/address
            // lock, not a later recheck of locks already held in this tx.
            await notifySfpValidationConcurrencyHook(
              "onBeforeFinalEligibilityLocks",
              opts.concurrencyTestHooks?.onBeforeFinalEligibilityLocks,
              concurrencyHookContext,
            );
            // All business, source, and address locks follow the global
            // projection gate; otherwise a concurrent writer can hold that
            // gate while waiting for a tuple held by this transaction.
            await lockSfpEligibilityProjectionWriteGate(tx);
            const sourceAndRunCurrentAfterProvider = await isSfpValidationSourceAndRunCurrent({
              cohortRunId, businessId: bizId, candidate: cand as CandidateWithPin,
              resolved: resolvedReference, plaintext: realEmail, policy,
              businessWrite: true,
            }, tx);
            let contactIdentityCurrentAfterProvider = sourceAndRunCurrentAfterProvider;
            const consentTierAfterProvider = await lookupConsentTierByEmailHash(contactEmailTokenHash, tx);
            let suppressedAfterProvider = await isCanonicallySuppressed(
              [emailHash, contactEmailTokenHash], tx, [realEmail],
            );
            let gateAfterProvider = await evaluateSfpMutableSafetyGates({
              businessId: bizId,
              consentTier: consentTierAfterProvider,
              policy,
              emailAddress: realEmail,
            }, tx);

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

          const countsBeforeOutcome = { validCount, catchAllCount, invalidCount, failedCount };
          let status: OutreachEligibilityStatus = "invalid";
          let decisionReason = "";
          let suppressionStatus = "not_suppressed";

          if (!contactIdentityCurrentAfterProvider) {
            status = "validated_review_required";
            decisionReason = "candidate_or_run_pin_stale_after_provider";
            reasonCodes.push("candidate_or_run_pin_stale_after_provider");
          } else if (suppressedAfterProvider) {
            status = "validated_suppressed";
            decisionReason = "canonical_suppression_match_after_provider";
            reasonCodes.push("policy_suppressed");
            suppressionStatus = "suppressed";
          } else if (!gateAfterProvider.eligible) {
            status = gateAfterProvider.status;
            decisionReason = gateAfterProvider.reasonCode;
            reasonCodes.push(gateAfterProvider.reasonCode);
          } else if (providerFailure) {
            const exhausted = retryAttempt >= 5;
            status = exhausted ? "validated_review_required" : "validation_pending";
            const classification = providerFailure.kind === "reservation_denied"
              ? "provider_reservation_denied"
              : providerFailure.kind === "not_dispatched"
                ? "provider_dispatch_not_completed"
                : providerFailure.kind === "http_failure"
                  ? "provider_http_failure"
                  : "provider_io_ambiguous";
            decisionReason = exhausted
              ? `${classification}:retry_exhausted:phase:${providerFailure.phase}:code:${providerFailure.code}:operator_review`
              : `${classification}:retry_required:phase:${providerFailure.phase}:code:${providerFailure.code}:attempt:${retryAttempt}`;
            reasonCodes.push(`${classification}_${exhausted ? "exhausted_review" : "retryable"}`);
            if (exhausted) catchAllCount++;
            else failedCount++;
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

          // ── Atomic eligibility write + projection ──
          // Provider settlement is already durable; realEmail is written only
          // after the current owner/stage and source pins pass in this tx.
          {
            await lockSfpEligibilityProjectionWriteGate(tx);
            await lockSfpEligibilityProjectionKey(tx, cohortRunId, bizId, policy.version);
            await tx.execute(sql`
              SELECT id FROM sfp_outreach_eligibility
               WHERE cohort_run_id=${cohortRunId}::uuid AND business_id=${bizId}
                 AND policy_version=${policy.version}
               FOR UPDATE
            `);
            const expectedReceiptOperationId = fresh?.operationId ??
              (reservation && !providerFailure && ["valid", "invalid"].includes(zbOutcome)
                ? reservation.operationId : null);
            const receiptAfterWait = expectedReceiptOperationId
              ? await findFreshProviderObservation({
                  businessId: bizId,
                  emailTokenHash: contactEmailTokenHash,
                  ttlDays: policy.validationTtlDays,
                }, tx)
              : null;
            await notifySfpValidationConcurrencyHook(
              "onFinalEligibilityLocksHeld",
              opts.concurrencyTestHooks?.onFinalEligibilityLocksHeld,
              concurrencyHookContext,
            );
            // Recheck the live owner/stage claim only after all source,
            // projection and receipt locks and cert barriers have completed.
            await assertCurrentStageFinalization(tx);
            const finalSourceCurrent = await isSfpValidationSourceAndRunCurrent({
              cohortRunId, businessId: bizId, candidate: cand as CandidateWithPin,
              resolved: resolvedReference, plaintext: realEmail, policy,
            }, tx);
            const finalConsentTier = await lookupConsentTierByEmailHash(contactEmailTokenHash, tx);
            const finalSuppressed = await isCanonicallySuppressed(
              [emailHash, contactEmailTokenHash], tx, [realEmail],
            );
            const finalGate = await evaluateSfpMutableSafetyGates({
              businessId: bizId,
              consentTier: finalConsentTier,
              policy,
              emailAddress: realEmail,
            }, tx);
            contactIdentityCurrentAfterProvider = finalSourceCurrent;
            suppressedAfterProvider = finalSuppressed;
            gateAfterProvider = finalGate;
            if (!finalSourceCurrent) {
              status = "validated_review_required";
              decisionReason = "candidate_or_run_pin_stale_at_final_projection";
              reasonCodes.push("candidate_or_run_pin_stale_at_final_projection");
            } else if (finalSuppressed) {
              status = "validated_suppressed";
              decisionReason = "canonical_suppression_match_at_final_projection";
              suppressionStatus = "suppressed";
              reasonCodes.push("policy_suppressed");
            } else if (!finalGate.eligible) {
              status = finalGate.status;
              decisionReason = finalGate.reasonCode;
              reasonCodes.push(finalGate.reasonCode);
            }
            const databaseClockRow = rows(await tx.execute(sql`
              SELECT clock_timestamp() AS at
            `))[0];
            const databaseClock = new Date(String(databaseClockRow?.at ?? ""));
            if (!Number.isFinite(databaseClock.getTime())) {
              throw new Error("SFP_VALIDATION_DATABASE_CLOCK_UNAVAILABLE");
            }
            const databaseClockIso = databaseClock.toISOString();
            // Eligibility projects the immutable receipt's clock, never a
            // later projection/transport time that could extend its TTL.
            const observedAtForEligibility = receiptAfterWait?.observedAt ??
              fresh?.observedAt ?? observationAt ?? databaseClockIso;
            const receiptExpiry = receiptAfterWait
              ? effectiveSfpProviderObservationExpiry(
                  receiptAfterWait.observedAt, receiptAfterWait.expiresAt, policy.validationTtlDays,
                )
              : null;
            const validationExpiry = effectiveSfpProviderObservationExpiry(
              observedAtForEligibility,
              fresh?.expiresAt ?? receiptAfterWait?.expiresAt ?? null,
              policy.validationTtlDays,
            );
            const expiryMillis = [
              receiptExpiry?.getTime(),
              validationExpiry?.getTime(),
            ].filter((value): value is number => value !== undefined && Number.isFinite(value));
            const expiresAt = expiryMillis.length
              ? new Date(Math.min(...expiryMillis)).toISOString()
              : observedAtForEligibility;
            const receiptMatches = Boolean(
              expectedReceiptOperationId &&
              receiptAfterWait?.operationId === expectedReceiptOperationId &&
              isSfpProviderObservationFreshAt(
                receiptAfterWait.observedAt,
                receiptAfterWait.expiresAt,
                policy.validationTtlDays,
                databaseClock,
              ) &&
              (!observationAt || isSfpProviderObservationFreshAt(
                observationAt,
                receiptAfterWait.expiresAt,
                policy.validationTtlDays,
                databaseClock,
              )),
            );

            if (contactIdentityCurrentAfterProvider && !suppressedAfterProvider &&
                gateAfterProvider.eligible && expectedReceiptOperationId && !receiptMatches) {
              validCount = countsBeforeOutcome.validCount;
              catchAllCount = countsBeforeOutcome.catchAllCount;
              invalidCount = countsBeforeOutcome.invalidCount;
              failedCount = countsBeforeOutcome.failedCount;
              status = "validation_pending";
              decisionReason = "provider_observation_expired_before_eligibility_commit";
              reasonCodes.push("provider_observation_expired_before_eligibility_commit");
              failedCount++;
            }

            const validationAt = observedAtForEligibility;
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

            if (zbOutcome === "valid" && status === "validated_outreach_eligible" && receiptMatches &&
                contactIdentityCurrentAfterProvider && !suppressedAfterProvider && gateAfterProvider.eligible) {
              await tx.execute(sql`
                UPDATE businesses
                   SET main_email=${realEmail},email_discovery_status='provider_valid',
                       email_validation_updated_at=NOW(),email_selected_candidate_hash=${emailHash},updated_at=NOW()
                 WHERE id=${bizId}
                   AND (main_email IS NULL OR email_selected_candidate_hash=${emailHash})
              `);
            }
          }
          });
          eligibilityRowsCreated++;
          return true;
        },
        db,
      );
    } catch (err: any) {
      const message = String(err?.message ?? "");
      if (providerFinalizationAuthorityLost) throw err;
      const isSourceOrRunPinStale =
        message === "SFP_CONTACT_SOURCE_PIN_STALE" ||
        message === "SFP_CANDIDATE_SOURCE_PIN_STALE" ||
        /^SFP_CANDIDATE_(REFERENCE_NOT_FOUND|NOT_OPENABLE|BUSINESS_NOT_IN_COHORT|ENVELOPE_NOT_FOUND|IDENTITY_QUARANTINED|EVIDENCE_DISCREDITED)/.test(message);
      if (isSourceOrRunPinStale && !providerDispatchedForCandidate) {
        await db.transaction(async (tx) => {
          await assertCurrentStageFinalization(tx);
          await writeEligibilityRow({
            cohortRunId, bizId, cand, policyVersion: policy.version, status: "validated_review_required",
            policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
            decisionReason: "candidate_or_run_pin_stale_before_provider_dispatch",
            reasonCodes: ["candidate_or_run_pin_stale_before_provider_dispatch"],
            normalizedValueHash: cand.normalizedValueHash,
          }, tx);
        });
        eligibilityRowsCreated++;
      } else {
        // Only open-boundary resolution/decryption errors are candidate-open
        // failures. Provider, owner, SQL and finalization errors remain
        // explicit and are never converted into a provider outcome.
        const isResolveFailure = /^SFP_CANDIDATE_(REFERENCE_NOT_FOUND|NOT_OPENABLE|BUSINESS_NOT_IN_COHORT|ENVELOPE_NOT_FOUND)$/.test(message);
        if (!isResolveFailure) throw err;
        if (process.env.SFP_DEBUG_DECRYPT) {
          console.error("SFP_DEBUG_DECRYPT", bizId, safeProviderFailureDiagnosticCode(err));
        }
        failedCount++;
        await db.transaction(async (tx) => {
          await assertCurrentStageFinalization(tx);
          await writeEligibilityRow({
            cohortRunId, bizId, cand, policyVersion: policy.version, status: "validation_pending",
            policyDocumentId: policy.id, policyDocumentHash: policy.documentHash,
            decisionReason: "candidate_decryption_failed", reasonCodes: ["candidate_decryption_failed"],
          }, tx);
        });
        eligibilityRowsCreated++;
      }
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
      await db.transaction(async (tx) => {
        await lockSfpEligibilityProjectionWriteGate(tx);
        await lockSfpEligibilityProjectionKey(tx, cohortRunId, bizId, policy.version);
        await tx.execute(sql`
          INSERT INTO sfp_outreach_eligibility
            (cohort_run_id, business_id, policy_version, status, decision_reason)
          VALUES (${cohortRunId}::uuid, ${bizId}, ${policy.version},
                  'discovery_required', 'no_staged_candidate')
          ON CONFLICT (cohort_run_id, business_id, policy_version) DO NOTHING
        `);
      });
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
  const write = async (target: { execute: (query: any) => Promise<any> }) => {
    await lockSfpEligibilityProjectionWriteGate(target);
    await lockSfpEligibilityProjectionKey(target, input.cohortRunId, input.bizId, policyVersion);
    await target.execute(sql`
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
  };
  if (executor === db) await db.transaction(write);
  else await write(executor);
}
