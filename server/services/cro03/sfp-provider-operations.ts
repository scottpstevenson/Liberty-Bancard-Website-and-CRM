/**
 * Durable paid-provider boundary for the independent SFP program.
 *
 * A credential is never authority. Live I/O requires program activation,
 * current durable deployment/job ownership, explicit paid approval, provider
 * manifest admission, an enabled/closed control row, an operation receipt,
 * and a final pre-I/O lease
 * check.  Tests may inject a fake transport; fake execution never reserves or
 * updates operational usage receipts.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { readSfpAutomaticPublish, assertSfpPublishMayAdvance } from "../../../shared/sfp-publish-handoff";
import { db } from "../../db";
import {
  sanitizeSfpProviderHttpDiagnostics, safeSfpHttpClass, type SfpProviderHttpDiagnostics,
} from "./sfp-provider-http-diagnostics";
import { assertProviderActivation, type ProviderSourceId } from "../provider-manifest";
import {
  getCurrentPricingSchedule,
} from "../mi09-pilot-authority";
import { acquireLadderBudgetLock } from "./shared-paid-budget-ledger";
import { lockCurrentSfpOutreachPolicy } from "./sfp-outreach-policy";
import {
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
} from "../commercial-graph-locks";
import { lockSfpBusinessSafetySentinel } from "./sfp-eligibility-locks";
import { sfpUnavailableHttpReason } from "./sfp-continuous-progress";
import {
  getCurrentRoutineSfpDeploymentIdentity,
  getCurrentSfpRuntimeFence,
  sameSfpRuntimeRelease,
  SFP_RUNTIME_OWNER_LEASE_MS,
  type SfpAuthorizedRelease,
  type SfpRuntimeFence,
} from "./sfp-runtime-fence";
import {
  calculateSfpUsageCostMicros,
  type SfpExactDecimalUsage,
  type SfpProviderUsageInput,
  type SfpProviderUsageSettlement,
  type SfpProviderUsageStatus,
} from "./sfp-billing-contract";

export type { SfpExactDecimalUsage, SfpProviderUsageInput, SfpProviderUsageSettlement } from "./sfp-billing-contract";
export { calculateSfpSettlementAccounting } from "./sfp-billing-contract";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const CALLER = "server/services/cro03/sfp-provider-operations.ts";
const publicProviderResultData = (value: any) => sanitizeProviderResultData(value);

export type SfpPaidProvider = "zerobounce" | "serper" | "outscraper" | "apollo" | "openai_classification";
const CONTROL_KEY: Record<SfpPaidProvider, string> = {
  zerobounce: "zerobounce", serper: "serper", outscraper: "outscraper",
  apollo: "apollo", openai_classification: "openai",
};
const SECRET_KEY: Record<SfpPaidProvider, string> = {
  zerobounce: "ZEROBOUNCE_API_KEY", serper: "SERPER_API_KEY", outscraper: "OUTSCRAPER_API_KEY",
  apollo: "APOLLO_API_KEY", openai_classification: "AI_INTEGRATIONS_OPENAI_API_KEY",
};

// Per-provider work ceilings, keyed to declared operation work (not billing
// units): Serper/Apollo are per-HTTP request; Outscraper reserves result,
// contact, or request units by operation; OpenAI is token-priced and a
// fixed 100-unit ceiling would silently truncate a real completion's
// token reservation far below its actual usage, under-accounting real
// spend against the cost ledger. Each ceiling is a generous worst-case
// bound for a single call, not an unlimited allowance.
const MAX_UNITS_PER_RESERVATION: Record<SfpPaidProvider, number> = {
  zerobounce: 1,
  serper: 4,
  outscraper: 100,
  apollo: 100,
  openai_classification: 4000,
};

// Exported so any pre-flight gate that estimates provider-call consumption
// (e.g. the arm-pilot readiness check in routes/lead-ops.ts) reads the same
// per-reservation ceiling used by reserveSfpProviderOperation/
// reservePreCohortSfpProviderOperation, instead of hardcoding its own copy
// of the number. Both `provider_controls.reserved_units`/`consumed_units`
// (unit-denominated) and, for serper specifically, `serper_control.
// window_calls`/`local_budget` (raw API call counts) use "1 unit == 1 call"
// for this provider, so a single shared constant keeps both gates in sync.
export function maxUnitsPerSfpReservation(provider: SfpPaidProvider): number {
  return MAX_UNITS_PER_RESERVATION[provider] ?? 100;
}

export interface SfpProviderReservation {
  operationId: string;
  claimToken: string;
  provider: SfpPaidProvider;
  controlProvider: string;
  /** Reserve estimate per work unit; null when reviewed pricing uses another unit. */
  amountMicros: number | null;
  reviewedUnitPriceMicros?: number | null;
  reviewedUnitType?: string | null;
  noResultBillable?: boolean | null;
  businessId?: number;
  cohortRunId?: string;
  /** Declared work-unit semantics shared by the reservation and workCompleted receipt. */
  workUnit: string;
  /** Reserved provider-specific work units (results, contacts, tokens, or calls), never provider credits. */
  units: number;
  stageRunId: string;
  runtimeOwnerEpoch: number;
  runtimeOwnerToken: string;
  replayed?: boolean;
  resultData?: any;
}

export type SfpProviderBillingStatus = "known" | "unknown" | "conflicting";
export type SfpProviderFinishBilling = SfpExactDecimalUsage;
export type SfpProviderFinishInput = {
  reservation: SfpProviderReservation | SfpPreCohortProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  workUnit: string;
  emailTokenHash?: string | null;
  resultData?: SfpSanitizedProviderResult | Record<string, unknown>;
} & (
  | { workCompleted: number; providerUsage: SfpProviderUsageInput; billing?: never }
  | { workCompleted?: never; providerUsage?: never; billing: SfpExactDecimalUsage }
);

export interface SfpSanitizedProviderResult extends SfpProviderHttpDiagnostics {
  retrievalState?: string | null;
  providerReference?: string | null;
  externalTaskId?: string | null;
}

type RuntimeSfpProviderReservation = SfpProviderReservation | SfpPreCohortProviderReservation;

/** Minimal transaction reader passed to source/policy-specific dispatch pins. */
export interface SfpProviderDispatchTransaction {
  execute: (query: any) => Promise<any>;
}

/**
 * Runs in the same transaction as the dispatch marker, after generic
 * owner/job/provider/program/cohort controls are locked. It must lock and
 * validate source/address/link/policy pins and throw on stale pins. Its return
 * cannot grant dispatch: generic controls are rechecked by the final marker CAS.
 */
export type SfpProviderBeforeDispatch = (
  tx: SfpProviderDispatchTransaction,
  reservation: SfpProviderReservation,
) => Promise<void>;

export interface SfpStageFinalizationInput {
  stageRunId: string;
  stageClaimToken: string;
  cohortRunId: string;
  businessId: number;
  /** Exact validation candidate-claim key persisted on the claimed stage item. */
  candidateClaimKey: string;
  sourceContactId?: number;
}

async function getCurrentRoutineSfpRuntimeFence(): Promise<SfpRuntimeFence | null> {
  // REPL_ID identifies a workspace, not a deployment, and cannot distinguish
  // same-SHA redeployments that share a project identity.
  if (!getCurrentRoutineSfpDeploymentIdentity()) return null;
  return getCurrentSfpRuntimeFence();
}

function normalizeSfpOperationExactDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const raw = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

function normalizeSfpOperationProviderUsage(value: unknown): SfpProviderUsageSettlement {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SfpProviderUsageInput>
    : {};
  const status = raw.status;
  const providerRequestId = typeof raw.providerRequestId === "string" && raw.providerRequestId.trim()
    ? raw.providerRequestId.trim()
    : null;
  const source = typeof raw.source === "string" && raw.source.trim()
    ? raw.source.trim().slice(0, 120)
    : null;
  if (status !== "known" && status !== "unknown" && status !== "conflict" && status !== "not_applicable") {
    return { status: "unknown", quantity: null, unit: null, providerRequestId, source };
  }
  if (status !== "known") return { status, quantity: null, unit: null, providerRequestId, source };
  const quantity = normalizeSfpOperationExactDecimal(raw.quantity);
  const unit = typeof raw.unit === "string" ? raw.unit.trim().toLowerCase() : "";
  if (quantity === null || !/^[a-z][a-z0-9_:-]{0,31}$/.test(unit)) {
    return { status: "conflict", quantity: null, unit: null, providerRequestId, source };
  }
  return { status: "known", quantity, unit, providerRequestId, source };
}

function billingUsageFromFinish(input: SfpProviderFinishBilling): SfpProviderUsageSettlement {
  if (!Number.isSafeInteger(input.workCompleted) || input.workCompleted < 0) {
    throw new Error("SFP_PROVIDER_WORK_COMPLETED_MUST_BE_NONNEGATIVE_INTEGER");
  }
  if (input.billingStatus === "known") {
    return normalizeSfpOperationProviderUsage({
      status: "known",
      quantity: input.billedCredits,
      unit: "credit",
      providerRequestId: input.providerReference,
      source: "provider_finish",
    });
  }
  return normalizeSfpOperationProviderUsage({
    status: input.billingStatus === "conflicting" ? "conflict" : "unknown",
    quantity: null,
    unit: null,
    providerRequestId: input.providerReference,
    source: "provider_finish",
  });
}

function calculateSfpOperationSettlementAccounting(input: {
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  reservedUnits: number;
  settledUnits?: number;
  reviewedUnitPriceMicros: number | null;
  reviewedUnitType: string | null;
  noResultBillable: boolean | null;
  notDispatched: boolean;
  providerUsage: SfpProviderUsageSettlement;
}): {
  settledUnits: number;
  settledMicros: number | null;
  settledCostMicros: number | null;
  providerUsage: SfpProviderUsageSettlement;
} {
  if (!Number.isSafeInteger(input.reservedUnits) || input.reservedUnits < 0) {
    throw new Error("SFP_RESERVED_WORK_UNITS_MUST_BE_NONNEGATIVE_INTEGER");
  }
  const workUnits = input.settledUnits ?? input.reservedUnits;
  if (!Number.isSafeInteger(workUnits) || workUnits < 0) {
    throw new Error("SFP_SETTLED_WORK_UNITS_MUST_BE_NONNEGATIVE_INTEGER");
  }
  if (workUnits > input.reservedUnits) throw new Error("SFP_SETTLED_WORK_UNITS_EXCEED_RESERVATION");
  const providerUsage = input.notDispatched
    ? normalizeSfpOperationProviderUsage({ status: "not_applicable" })
    : input.providerUsage;
  const settledUnits = !input.notDispatched &&
      (input.outcome === "completed" || input.outcome === "no_result" || providerUsage.status === "known")
    ? workUnits
    : 0;
  let settledMicros = input.notDispatched
    ? 0
    : calculateSfpUsageCostMicros({
      usage: providerUsage,
      reviewedUnitPriceMicros: input.reviewedUnitPriceMicros,
      reviewedUnitType: input.reviewedUnitType,
    });
  if (input.outcome === "no_result" && input.noResultBillable === false && providerUsage.status !== "known") {
    settledMicros = 0;
  }
  return {
    settledUnits,
    settledMicros,
    settledCostMicros: settledMicros,
    providerUsage,
  };
}

function sanitizeProviderResultData(value: unknown): SfpSanitizedProviderResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const safe: SfpSanitizedProviderResult = sanitizeSfpProviderHttpDiagnostics(value);
  for (const key of ["retrievalState", "providerReference", "externalTaskId"] as const) {
    const candidate = raw[key];
    if (candidate === null) safe[key] = null;
    else if (typeof candidate === "string" && candidate.trim()) safe[key] = candidate.trim().slice(0, 240);
  }
  return safe;
}

function sanitizePreCohortResultData(value: unknown): Record<string, unknown> {
  const safe = sanitizeProviderResultData(value) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) return safe;
  const raw = value as Record<string, unknown>;
  if (raw.outcome === "target" || raw.outcome === "non_target" || raw.outcome === "review_required") {
    safe.outcome = raw.outcome;
  }
  if (typeof raw.domain === "string" && /^[a-z0-9.-]{1,253}$/i.test(raw.domain.trim())) {
    safe.domain = raw.domain.trim().toLowerCase();
  }
  if (typeof raw.reasonCode === "string" && raw.reasonCode.trim()) {
    safe.reasonCode = raw.reasonCode.trim().slice(0, 160);
  }
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence) &&
      raw.confidence >= 0 && raw.confidence <= 100) {
    safe.confidence = raw.confidence;
  }
  if (Array.isArray(raw.reasonCodes)) {
    safe.reasonCodes = raw.reasonCodes
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .slice(0, 20)
      .map((item) => item.trim().slice(0, 120));
  }
  for (const key of ["modelVersion", "promptVersion"] as const) {
    if (typeof raw[key] === "string" && raw[key].trim()) safe[key] = raw[key].trim().slice(0, 120);
  }
  if (typeof raw.costMicros === "number" && Number.isSafeInteger(raw.costMicros) && raw.costMicros >= 0) {
    safe.costMicros = raw.costMicros;
  }
  return safe;
}

function publicPreCohortResultData(value: unknown): Record<string, unknown> {
  return sanitizePreCohortResultData(value);
}

export interface SfpRuntimeAuthority {
  ownerEpoch: number;
  ownerToken: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  artifactSha: string;
  queueTopologyHash: string;
  processIdentity: string;
}

export interface SfpRuntimeReleaseSelectionInput {
  actorId: string;
  expectedPreviousSelectionVersion: number | null;
  expectedPreviousArtifactSha: string | null;
  publisherVerifiedArtifactSha: string;
  publisherVerifiedDeploymentIdentity: string;
  verificationReference: string;
}

export interface SfpRuntimeReleaseSelectionStatus {
  selectedRelease: (SfpAuthorizedRelease & {
    selectedBy: string;
    selectedAt: string;
    selectionVersion: number;
    selectionEventId: string;
    publisherVerifiedArtifactSha: string;
    publisherVerifiedDeploymentIdentity: string;
    verificationReference: string;
  }) | null;
  currentRelease: SfpAuthorizedRelease | null;
  currentReleaseSelected: boolean;
  ownerLeaseExpiresAt: string | null;
  ownerLive: boolean;
  ready: boolean;
  reason: string | null;
}

export interface SfpRuntimeJobLeaseBinding {
  jobType: "sfp_ready_held_consumer";
  jobId: string;
  claimToken: string;
  ownerEpoch: number;
  ownerToken: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  artifactSha: string;
  processIdentity: string;
  queueTopologyHash: string;
}

export interface SqlExecutor {
  execute: (query: any) => Promise<any>;
}

async function claimOrRenewSfpRuntimeOwner(
  executor: SqlExecutor,
  fence: SfpRuntimeFence,
): Promise<SfpRuntimeAuthority> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('routine-sfp-runtime-owner',0))`);
  const selected = await lockSelectedSfpRuntimeRelease(executor, fence);
  if (!selected) throw new Error("SFP_RUNTIME_OWNER_BLOCKED:CURRENT_RELEASE_NOT_SELECTED");
  const current = rows(await executor.execute(sql`
    SELECT deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
           owner_epoch,owner_token,lease_expires_at,revoked_at
      FROM sfp_runtime_owner_authority
     WHERE authority_key='routine_sfp'
     FOR UPDATE
  `))[0];
  if (current?.revoked_at) throw new Error("SFP_RUNTIME_OWNER_BLOCKED:OWNER_REVOKED");
  const currentMatches = current && sameSfpRuntimeRelease({
    artifactSha: String(current.artifact_sha),
    deploymentIdentity: String(current.deployment_identity),
    environmentIdentity: String(current.environment_identity),
    queueTopologyHash: String(current.queue_topology_hash),
  }, fence);
  if (currentMatches && !current.revoked_at) {
    const renewed = rows(await executor.execute(sql`
      UPDATE sfp_runtime_owner_authority
         SET lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
             updated_at=clock_timestamp()
       WHERE authority_key='routine_sfp'
          AND deployment_identity=${fence.deploymentIdentity}
          AND environment_identity=${fence.environmentIdentity}
          AND artifact_sha=${fence.artifactSha}
          AND queue_topology_hash=${fence.queueTopologyHash}
         AND owner_epoch=${Number(current.owner_epoch)}
         AND owner_token=${String(current.owner_token)}::uuid
           AND lease_expires_at>clock_timestamp()
         AND revoked_at IS NULL
       RETURNING owner_epoch,owner_token
    `))[0];
    if (renewed) {
      return {
        ownerEpoch: Number(renewed.owner_epoch),
        ownerToken: String(renewed.owner_token),
        ...fence,
      };
    }
  }

  // Only the exact durable selector can reach this acquisition path. An
  // absent, revoked, or expired owner row never authorizes an old release.
  const ownerToken = randomUUID();
  if (current) {
    const claimed = rows(await executor.execute(sql`
      UPDATE sfp_runtime_owner_authority
         SET deployment_identity=${fence.deploymentIdentity},
             environment_identity=${fence.environmentIdentity},
             artifact_sha=${fence.artifactSha},
             queue_topology_hash=${fence.queueTopologyHash},
             owner_epoch=owner_epoch+1,
             owner_token=${ownerToken}::uuid,
             lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
             revoked_at=NULL,
             updated_at=clock_timestamp()
       WHERE authority_key='routine_sfp'
       RETURNING owner_epoch,owner_token
    `))[0];
    if (!claimed) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
    return { ownerEpoch: Number(claimed.owner_epoch), ownerToken: String(claimed.owner_token), ...fence };
  }
  const claimed = rows(await executor.execute(sql`
    INSERT INTO sfp_runtime_owner_authority
      (authority_key,deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
       owner_epoch,owner_token,lease_expires_at,revoked_at,updated_at)
    VALUES ('routine_sfp',${fence.deploymentIdentity},${fence.environmentIdentity},${fence.artifactSha},
            ${fence.queueTopologyHash},1,${ownerToken}::uuid,
            clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
            NULL,clock_timestamp())
    RETURNING owner_epoch,owner_token
  `))[0];
  if (!claimed) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  return { ownerEpoch: Number(claimed.owner_epoch), ownerToken: String(claimed.owner_token), ...fence };
}

function rowMatchesSfpRuntimeRelease(row: any, release: SfpAuthorizedRelease): boolean {
  return sameSfpRuntimeRelease({
    artifactSha: String(row.artifact_sha).toLowerCase(),
    deploymentIdentity: String(row.deployment_identity),
    environmentIdentity: String(row.environment_identity),
    queueTopologyHash: String(row.queue_topology_hash).toLowerCase(),
  }, {
    ...release,
    artifactSha: release.artifactSha.toLowerCase(),
    queueTopologyHash: release.queueTopologyHash.toLowerCase(),
  });
}

async function lockSelectedSfpRuntimeRelease(
  executor: SqlExecutor,
  fence: SfpRuntimeFence,
): Promise<any | null> {
  const selected = rows(await executor.execute(sql`
    SELECT deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
           publisher_verified_artifact_sha,publisher_verified_deployment_identity,
           verification_reference,selected_by,selected_at
      FROM sfp_runtime_release_selectors
     WHERE authority_key='routine_sfp'
     FOR SHARE
  `))[0];
  if (!selected || !rowMatchesSfpRuntimeRelease(selected, fence)) return null;
  return selected;
}

/**
 * Lock and verify the live singleton owner inside the caller's transaction.
 * Unlike claimOrRenewSfpRuntimeOwner this cannot acquire or revive ownership;
 * use it to fence generic queue claims and commit transactions.
 */
export async function lockCurrentSfpRuntimeOwner(executor: SqlExecutor): Promise<SfpRuntimeAuthority> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_RUNTIME_OWNER_BLOCKED:DEPLOYMENT_IDENTITY_UNVERIFIED");
  const current = rows(await executor.execute(sql`
    SELECT oa.deployment_identity,oa.environment_identity,oa.artifact_sha,oa.queue_topology_hash,
           oa.owner_epoch,oa.owner_token,oa.lease_expires_at,oa.revoked_at
      FROM sfp_runtime_owner_authority oa
      JOIN sfp_runtime_release_selectors rs
        ON rs.authority_key=oa.authority_key
       AND rs.deployment_identity=oa.deployment_identity
       AND rs.environment_identity=oa.environment_identity
       AND rs.artifact_sha=oa.artifact_sha
       AND rs.queue_topology_hash=oa.queue_topology_hash
     WHERE oa.authority_key='routine_sfp'
       AND oa.deployment_identity=${fence.deploymentIdentity}
       AND oa.environment_identity=${fence.environmentIdentity}
       AND oa.artifact_sha=${fence.artifactSha}
       AND oa.queue_topology_hash=${fence.queueTopologyHash}
       AND oa.revoked_at IS NULL
     FOR SHARE OF oa,rs
  `))[0];
  if (!current) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  const live = rows(await executor.execute(sql`
    SELECT 1
      FROM sfp_runtime_owner_authority oa
      JOIN sfp_runtime_release_selectors rs
        ON rs.authority_key=oa.authority_key
       AND rs.deployment_identity=oa.deployment_identity
       AND rs.environment_identity=oa.environment_identity
       AND rs.artifact_sha=oa.artifact_sha
       AND rs.queue_topology_hash=oa.queue_topology_hash
     WHERE oa.authority_key='routine_sfp'
       AND oa.deployment_identity=${fence.deploymentIdentity}
       AND oa.environment_identity=${fence.environmentIdentity}
       AND oa.artifact_sha=${fence.artifactSha}
       AND oa.queue_topology_hash=${fence.queueTopologyHash}
       AND oa.owner_epoch=${Number(current.owner_epoch)}
       AND oa.owner_token=${String(current.owner_token)}::uuid
       AND oa.lease_expires_at>clock_timestamp()
       AND oa.revoked_at IS NULL
  `))[0];
  if (!live) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  return {
    ownerEpoch: Number(current.owner_epoch),
    ownerToken: String(current.owner_token),
    ...fence,
  };
}

/** Validate a claimed pure SFP job against both its live claim and owner row. */
export async function assertSfpRuntimeJobLease(
  executor: SqlExecutor,
  lease: SfpRuntimeJobLeaseBinding,
): Promise<SfpRuntimeAuthority> {
  if (lease.jobType !== "sfp_ready_held_consumer") throw new Error("SFP_RUNTIME_JOB_TYPE_UNSUPPORTED");
  const owner = await lockCurrentSfpRuntimeOwner(executor);
  if (owner.ownerEpoch !== lease.ownerEpoch || owner.ownerToken !== lease.ownerToken ||
      owner.deploymentIdentity !== lease.deploymentIdentity ||
      owner.environmentIdentity !== lease.environmentIdentity ||
      owner.artifactSha !== lease.artifactSha ||
      owner.processIdentity !== lease.processIdentity ||
      owner.queueTopologyHash !== lease.queueTopologyHash) {
    throw new Error("SFP_RUNTIME_JOB_OWNER_FENCE_LOST");
  }
  const job = rows(await executor.execute(sql`
    SELECT id FROM sfp_ready_held_consumer_items
     WHERE id=${lease.jobId}::uuid AND state='claimed'
        AND claim_token=${lease.claimToken}::uuid
       AND runtime_owner_epoch=${lease.ownerEpoch}
       AND runtime_owner_token=${lease.ownerToken}::uuid
       AND runtime_deployment_identity=${lease.deploymentIdentity}
       AND runtime_environment_identity=${lease.environmentIdentity}
       AND runtime_artifact_sha=${lease.artifactSha}
       AND runtime_process_identity=${lease.processIdentity}
       AND runtime_queue_topology_hash=${lease.queueTopologyHash}
     FOR UPDATE
  `))[0];
  if (!job) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  const liveJob = rows(await executor.execute(sql`
    SELECT 1 FROM sfp_ready_held_consumer_items
     WHERE id=${lease.jobId}::uuid AND state='claimed'
       AND claim_token=${lease.claimToken}::uuid
       AND lease_expires_at>clock_timestamp()
  `))[0];
  if (!liveJob) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  return owner;
}

async function renewSfpRuntimeOwnerLease(
  executor: SqlExecutor,
  reservation: SfpProviderReservation | SfpPreCohortProviderReservation,
  fence: SfpRuntimeFence,
): Promise<void> {
  // The owner is the first exclusive authority lock in dispatch order.
  // Updating directly avoids a SHARE-to-UPDATE lock upgrade under concurrency.
  const owner = rows(await executor.execute(sql`
    UPDATE sfp_runtime_owner_authority
       SET lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
           updated_at=clock_timestamp()
     WHERE authority_key='routine_sfp'
       AND deployment_identity=${fence.deploymentIdentity}
       AND environment_identity=${fence.environmentIdentity}
       AND artifact_sha=${fence.artifactSha}
       AND queue_topology_hash=${fence.queueTopologyHash}
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND lease_expires_at>clock_timestamp()
       AND revoked_at IS NULL
    RETURNING owner_epoch
  `))[0];
  if (!owner) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
}

async function renewSfpRuntimeJobLease(
  executor: SqlExecutor,
  reservation: SfpProviderReservation | SfpPreCohortProviderReservation,
  fence: SfpRuntimeFence,
  leaseMs = 5 * 60_000,
): Promise<void> {
  const selectedOwner = await lockCurrentSfpRuntimeOwner(executor);
  if (selectedOwner.ownerEpoch !== reservation.runtimeOwnerEpoch ||
      selectedOwner.ownerToken !== reservation.runtimeOwnerToken) {
    throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  }
  const owner = rows(await executor.execute(sql`
    UPDATE sfp_runtime_owner_authority
       SET lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
           updated_at=clock_timestamp()
     WHERE authority_key='routine_sfp'
       AND deployment_identity=${fence.deploymentIdentity}
       AND environment_identity=${fence.environmentIdentity}
       AND artifact_sha=${fence.artifactSha}
       AND queue_topology_hash=${fence.queueTopologyHash}
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
        AND lease_expires_at>clock_timestamp()
       AND revoked_at IS NULL
     RETURNING owner_epoch
  `))[0];
  if (!owner) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  const jobRow = rows(await executor.execute(sql`
    SELECT operation_id FROM sfp_runtime_job_leases
     WHERE operation_id=${reservation.operationId}::uuid
       AND deployment_identity=${fence.deploymentIdentity}
       AND environment_identity=${fence.environmentIdentity}
       AND artifact_sha=${fence.artifactSha}
       AND process_identity=${fence.processIdentity}
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND operation_claim_token=${reservation.claimToken}::uuid
       AND revoked_at IS NULL
     FOR UPDATE
  `))[0];
  if (!jobRow) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  const liveJob = rows(await executor.execute(sql`
    SELECT 1 FROM sfp_runtime_job_leases
     WHERE operation_id=${reservation.operationId}::uuid
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND operation_claim_token=${reservation.claimToken}::uuid
       AND lease_expires_at>clock_timestamp()
       AND revoked_at IS NULL
  `))[0];
  if (!liveJob) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  const lease = rows(await executor.execute(sql`
    UPDATE sfp_runtime_job_leases
       SET lease_expires_at=clock_timestamp()+(${leaseMs}::bigint * INTERVAL '1 millisecond'),
           updated_at=clock_timestamp()
     WHERE operation_id=${reservation.operationId}::uuid
       AND deployment_identity=${fence.deploymentIdentity}
       AND environment_identity=${fence.environmentIdentity}
       AND artifact_sha=${fence.artifactSha}
       AND process_identity=${fence.processIdentity}
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND operation_claim_token=${reservation.claimToken}::uuid
       AND revoked_at IS NULL
        AND lease_expires_at>clock_timestamp()
     RETURNING operation_id
  `))[0];
  if (!lease) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  const operationRow = rows(await executor.execute(sql`
    SELECT id FROM provider_operations
     WHERE id=${reservation.operationId}::uuid
       AND claim_token=${reservation.claimToken}::uuid
       AND state='running' AND cancel_requested_at IS NULL
     FOR UPDATE
  `))[0];
  if (!operationRow) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
  const liveOperation = rows(await executor.execute(sql`
    SELECT 1 FROM provider_operations
     WHERE id=${reservation.operationId}::uuid
       AND claim_token=${reservation.claimToken}::uuid
       AND state='running' AND cancel_requested_at IS NULL
       AND lease_expires_at>clock_timestamp()
  `))[0];
  if (!liveOperation) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
  const operation = rows(await executor.execute(sql`
    UPDATE provider_operations
       SET lease_expires_at=clock_timestamp()+(${leaseMs}::bigint * INTERVAL '1 millisecond'),
           updated_at=clock_timestamp()
     WHERE id=${reservation.operationId}::uuid
       AND claim_token=${reservation.claimToken}::uuid AND state='running'
       AND cancel_requested_at IS NULL
        AND lease_expires_at>clock_timestamp()
     RETURNING id
  `))[0];
  if (!operation) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/**
 * Finish-side lease fence. Rows are locked before wall-clock checks so a lease
 * that expires while this transaction waits cannot be renewed or settled using
 * transaction-start NOW(). Terminal operation retries remain idempotent.
 */
async function lockSfpProviderReservationForFinish(
  executor: SqlExecutor,
  reservation: RuntimeSfpProviderReservation,
  fence: SfpRuntimeFence,
): Promise<boolean> {
  const operation = rows(await executor.execute(sql`
    SELECT state,billing_state FROM provider_operations
     WHERE id=${reservation.operationId}::uuid
       AND claim_token=${reservation.claimToken}::uuid
     FOR UPDATE
  `))[0];
  if (!operation) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
  if (String(operation.state) !== "running" || String(operation.billing_state) !== "reserved") {
    return false;
  }
  const liveOperation = rows(await executor.execute(sql`
    SELECT 1 FROM provider_operations
     WHERE id=${reservation.operationId}::uuid
       AND claim_token=${reservation.claimToken}::uuid
       AND state='running' AND billing_state='reserved'
       AND lease_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
  `))[0];
  if (!liveOperation) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");

  const owner = await lockCurrentSfpRuntimeOwner(executor);
  if (owner.ownerEpoch !== reservation.runtimeOwnerEpoch ||
      owner.ownerToken !== reservation.runtimeOwnerToken ||
      owner.deploymentIdentity !== fence.deploymentIdentity ||
      owner.environmentIdentity !== fence.environmentIdentity ||
      owner.artifactSha !== fence.artifactSha ||
      owner.processIdentity !== fence.processIdentity ||
      owner.queueTopologyHash !== fence.queueTopologyHash) {
    throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
  }
  const job = rows(await executor.execute(sql`
    SELECT operation_id FROM sfp_runtime_job_leases
     WHERE operation_id=${reservation.operationId}::uuid
       AND deployment_identity=${fence.deploymentIdentity}
       AND environment_identity=${fence.environmentIdentity}
       AND artifact_sha=${fence.artifactSha}
       AND process_identity=${fence.processIdentity}
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND operation_claim_token=${reservation.claimToken}::uuid
       AND revoked_at IS NULL
     FOR UPDATE
  `))[0];
  if (!job) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");
  const liveJob = rows(await executor.execute(sql`
    SELECT 1 FROM sfp_runtime_job_leases
     WHERE operation_id=${reservation.operationId}::uuid
       AND owner_epoch=${reservation.runtimeOwnerEpoch}
       AND owner_token=${reservation.runtimeOwnerToken}::uuid
       AND operation_claim_token=${reservation.claimToken}::uuid
       AND lease_expires_at>clock_timestamp() AND revoked_at IS NULL
  `))[0];
  if (!liveJob) throw new Error("SFP_RUNTIME_JOB_LEASE_FENCE_LOST");

  if ("stageRunId" in reservation) {
    const parentRows = rows(await executor.execute(sql`
      SELECT i.id
        FROM sfp_stage_items i
        JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
        JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
         JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
        JOIN sfp_programs p ON p.id=cr.program_id
         JOIN provider_controls pc ON pc.provider=${reservation.controlProvider}
       WHERE i.provider_operation_id=${reservation.operationId}::uuid
         AND i.claim_token=${reservation.claimToken}::uuid AND i.state='claimed'
         AND sr.id=${reservation.stageRunId}::uuid AND sr.state='running'
         AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
          AND p.is_active=TRUE AND pc.enabled=TRUE AND pc.circuit_state='closed'
        FOR UPDATE OF i,sr,cr,m,p,pc
    `))[0];
    if (!parentRows) throw new Error("SFP_PROVIDER_STAGE_LEASE_FENCE_LOST");
    const liveParent = rows(await executor.execute(sql`
      SELECT 1
        FROM sfp_stage_items i
        JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
        JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
         JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
        JOIN sfp_programs p ON p.id=cr.program_id
         JOIN provider_controls pc ON pc.provider=${reservation.controlProvider}
       WHERE i.provider_operation_id=${reservation.operationId}::uuid
         AND i.claim_token=${reservation.claimToken}::uuid AND i.state='claimed'
         AND i.lease_expires_at>clock_timestamp()
         AND sr.id=${reservation.stageRunId}::uuid AND sr.state='running'
         AND sr.lease_expires_at>clock_timestamp()
         AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
          AND p.is_active=TRUE AND pc.enabled=TRUE AND pc.circuit_state='closed'
    `))[0];
    if (!liveParent) throw new Error("SFP_PROVIDER_STAGE_LEASE_FENCE_LOST");
  } else {
    const parentRows = rows(await executor.execute(sql`
      SELECT r.id
        FROM sfp_classification_runs r
        JOIN sfp_programs p ON p.id=r.program_id
         JOIN provider_controls pc ON pc.provider=${reservation.controlProvider}
        JOIN sfp_classification_items i ON i.run_id=r.id
          AND i.business_id=split_part(
            (SELECT target_fingerprint FROM provider_operations
              WHERE id=${reservation.operationId}::uuid),':',2)::integer
         WHERE r.id=${reservation.runId}::uuid AND r.state='running' AND p.is_active=TRUE
           AND pc.enabled=TRUE AND pc.circuit_state='closed'
         AND i.state='running'
        FOR UPDATE OF r,p,i,pc
    `))[0];
    if (!parentRows) throw new Error("SFP_PROVIDER_CLASSIFICATION_RUN_FENCE_LOST");
    const liveParent = rows(await executor.execute(sql`
      SELECT 1
        FROM sfp_classification_runs r
        JOIN sfp_programs p ON p.id=r.program_id
         JOIN provider_controls pc ON pc.provider=${reservation.controlProvider}
        JOIN sfp_classification_items i ON i.run_id=r.id
          AND i.business_id=split_part(
            (SELECT target_fingerprint FROM provider_operations
              WHERE id=${reservation.operationId}::uuid),':',2)::integer
       WHERE r.id=${reservation.runId}::uuid AND r.state='running'
         AND r.lease_expires_at>clock_timestamp()
          AND p.is_active=TRUE AND i.state='running'
          AND pc.enabled=TRUE AND pc.circuit_state='closed'
         AND i.lease_expires_at>clock_timestamp()
    `))[0];
    if (!liveParent) throw new Error("SFP_PROVIDER_CLASSIFICATION_RUN_FENCE_LOST");
  }
  return true;
}

function makeSfpDispatchReceiptFingerprint(input: {
  reservation: RuntimeSfpProviderReservation;
  businessId: number;
  dispatchMarkedAt: string;
  outcome: string;
  observation: string;
  settledUnits: number;
  providerUsage: SfpProviderUsageSettlement;
  resultData: Record<string, unknown>;
}): string {
  const identity = {
    schema: "sfp-dispatch-receipt-v1",
    operationId: input.reservation.operationId,
    claimToken: input.reservation.claimToken,
    provider: input.reservation.provider,
    businessId: input.businessId,
    parentRunId: "stageRunId" in input.reservation ? input.reservation.stageRunId : input.reservation.runId,
    cohortRunId: "stageRunId" in input.reservation ? input.reservation.cohortRunId ?? null : null,
    reservation: {
      units: input.reservation.units,
      amountMicros: input.reservation.amountMicros,
      reviewedUnitPriceMicros: input.reservation.reviewedUnitPriceMicros ?? null,
      reviewedUnitType: input.reservation.reviewedUnitType ?? null,
      noResultBillable: input.reservation.noResultBillable ?? null,
      workUnit: input.reservation.workUnit,
    },
    dispatchMarkedAt: input.dispatchMarkedAt,
    requestId: input.providerUsage.providerRequestId,
    outcome: input.outcome,
    observation: input.observation,
    settledUnits: input.settledUnits,
    providerUsage: {
      status: input.providerUsage.status,
      quantity: input.providerUsage.quantity,
      unit: input.providerUsage.unit,
      providerRequestId: input.providerUsage.providerRequestId,
      source: input.providerUsage.source,
    },
    resultData: input.resultData,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function isExpectedSfpAuthorityLoss(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("SFP_");
}

async function currentSfpProviderPromotionPermission(
  executor: SqlExecutor,
  reservation: RuntimeSfpProviderReservation,
  fence: SfpRuntimeFence | null,
): Promise<boolean> {
  if (!fence) return false;
  try {
    const owner = await lockCurrentSfpRuntimeOwner(executor);
    if (owner.ownerEpoch !== reservation.runtimeOwnerEpoch ||
        owner.ownerToken !== reservation.runtimeOwnerToken ||
        owner.deploymentIdentity !== fence.deploymentIdentity ||
        owner.environmentIdentity !== fence.environmentIdentity ||
        owner.artifactSha !== fence.artifactSha ||
        owner.processIdentity !== fence.processIdentity ||
        owner.queueTopologyHash !== fence.queueTopologyHash) return false;

    // Retain only the eligibility/run authority before acquiring billing,
    // operation, attempt, or dispatch-receipt locks.
    if ("stageRunId" in reservation) {
      const parent = rows(await executor.execute(sql`
        SELECT sr.id
          FROM sfp_stage_items i
          JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
          JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
          JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
          JOIN sfp_programs p ON p.id=cr.program_id
         WHERE i.provider_operation_id=${reservation.operationId}::uuid
           AND i.claim_token=${reservation.claimToken}::uuid AND i.state='claimed'
           AND i.lease_expires_at>clock_timestamp()
           AND sr.id=${reservation.stageRunId}::uuid AND sr.state='running'
           AND sr.lease_expires_at>clock_timestamp()
           AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
           AND p.is_active=TRUE
         FOR SHARE OF i,sr,cr,m,p
      `))[0];
      if (!parent) return false;
    } else {
      const parent = rows(await executor.execute(sql`
        SELECT r.id
          FROM sfp_classification_runs r
          JOIN sfp_programs p ON p.id=r.program_id
          JOIN sfp_classification_items i ON i.run_id=r.id
            AND i.business_id=split_part(
              (SELECT target_fingerprint FROM provider_operations
                WHERE id=${reservation.operationId}::uuid),':',2)::integer
         WHERE r.id=${reservation.runId}::uuid AND r.state='running'
           AND r.lease_expires_at>clock_timestamp() AND p.is_active=TRUE
           AND i.state='running' AND i.lease_expires_at>clock_timestamp()
         FOR SHARE OF r,p,i
      `))[0];
      if (!parent) return false;
    }

    const job = rows(await executor.execute(sql`
      SELECT 1 FROM sfp_runtime_job_leases
       WHERE operation_id=${reservation.operationId}::uuid
         AND deployment_identity=${fence.deploymentIdentity}
         AND environment_identity=${fence.environmentIdentity}
         AND artifact_sha=${fence.artifactSha}
         AND process_identity=${fence.processIdentity}
         AND owner_epoch=${reservation.runtimeOwnerEpoch}
         AND owner_token=${reservation.runtimeOwnerToken}::uuid
         AND operation_claim_token=${reservation.claimToken}::uuid
         AND lease_expires_at>clock_timestamp() AND revoked_at IS NULL
    `))[0];
    const operation = rows(await executor.execute(sql`
      SELECT 1 FROM provider_operations
       WHERE id=${reservation.operationId}::uuid
         AND claim_token=${reservation.claimToken}::uuid
         AND state='running' AND billing_state='reserved'
         AND lease_expires_at>clock_timestamp() AND cancel_requested_at IS NULL
    `))[0];
    const control = rows(await executor.execute(sql`
      SELECT 1 FROM provider_controls
       WHERE provider=${reservation.controlProvider}
         AND enabled=TRUE AND circuit_state='closed'
    `))[0];
    return Boolean(job && operation && control);
  } catch (error) {
    if (isExpectedSfpAuthorityLoss(error)) return false;
    throw error;
  }
}

/** Repeat every lease predicate at the final settlement CAS after row locks. */
function sfpProviderFinishLeasePredicate(
  reservation: RuntimeSfpProviderReservation,
  fence: SfpRuntimeFence,
) {
  const itemPredicate = "stageRunId" in reservation
    ? sql`
        AND EXISTS (
          SELECT 1 FROM sfp_stage_items i
          JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
          JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
          JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
          JOIN sfp_programs p ON p.id=cr.program_id
          WHERE i.provider_operation_id=provider_operations.id
            AND i.claim_token=${reservation.claimToken}::uuid AND i.state='claimed'
            AND i.lease_expires_at>clock_timestamp()
            AND sr.id=${reservation.stageRunId}::uuid AND sr.state='running'
            AND sr.lease_expires_at>clock_timestamp()
            AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
            AND p.is_active=TRUE
        )
      `
    : sql`
        AND EXISTS (
          SELECT 1 FROM sfp_classification_runs r
          JOIN sfp_programs p ON p.id=r.program_id
          JOIN sfp_classification_items i ON i.run_id=r.id
            AND i.business_id=split_part(provider_operations.target_fingerprint,':',2)::integer
          WHERE r.id=${reservation.runId}::uuid AND r.state='running'
            AND r.lease_expires_at>clock_timestamp()
            AND p.is_active=TRUE AND i.state='running'
            AND i.lease_expires_at>clock_timestamp()
        )
      `;
  return sql`
    AND provider_operations.lease_expires_at>clock_timestamp()
    AND provider_operations.cancel_requested_at IS NULL
    AND EXISTS (
      SELECT 1
        FROM sfp_runtime_owner_authority oa
        JOIN sfp_runtime_release_selectors rs
          ON rs.authority_key=oa.authority_key
         AND rs.deployment_identity=oa.deployment_identity
         AND rs.environment_identity=oa.environment_identity
         AND rs.artifact_sha=oa.artifact_sha
         AND rs.queue_topology_hash=oa.queue_topology_hash
        JOIN sfp_runtime_job_leases jl ON jl.operation_id=provider_operations.id
       WHERE oa.authority_key='routine_sfp'
         AND oa.deployment_identity=${fence.deploymentIdentity}
         AND oa.environment_identity=${fence.environmentIdentity}
         AND oa.artifact_sha=${fence.artifactSha}
         AND oa.queue_topology_hash=${fence.queueTopologyHash}
         AND oa.owner_epoch=${reservation.runtimeOwnerEpoch}
         AND oa.owner_token=${reservation.runtimeOwnerToken}::uuid
         AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
         AND jl.deployment_identity=${fence.deploymentIdentity}
         AND jl.environment_identity=${fence.environmentIdentity}
         AND jl.artifact_sha=${fence.artifactSha}
         AND jl.process_identity=${fence.processIdentity}
         AND jl.owner_epoch=${reservation.runtimeOwnerEpoch}
         AND jl.owner_token=${reservation.runtimeOwnerToken}::uuid
         AND jl.operation_claim_token=${reservation.claimToken}::uuid
         AND jl.lease_expires_at>clock_timestamp() AND jl.revoked_at IS NULL
         ${itemPredicate}
    )
  `;
}

export async function claimSfpRuntimeDeploymentOwner(): Promise<SfpRuntimeAuthority> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PAID_BLOCKED:DEPLOYMENT_IDENTITY_UNVERIFIED");
  return db.transaction(async (tx) => {
    await advanceSfpPublishedRelease(tx, fence);
    return claimOrRenewSfpRuntimeOwner(tx, fence);
  });
}

/** Renew only a live owner for this process's explicitly selected release. */
export async function renewSfpRuntimeDeploymentOwner(): Promise<SfpRuntimeAuthority> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_RUNTIME_OWNER_BLOCKED:DEPLOYMENT_IDENTITY_UNVERIFIED");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('routine-sfp-runtime-owner',0))`);
    const selected = await lockSelectedSfpRuntimeRelease(tx, fence);
    if (!selected) throw new Error("SFP_RUNTIME_OWNER_BLOCKED:CURRENT_RELEASE_NOT_SELECTED");
    const owner = rows(await tx.execute(sql`
      UPDATE sfp_runtime_owner_authority
         SET lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
             updated_at=clock_timestamp()
       WHERE authority_key='routine_sfp'
         AND deployment_identity=${fence.deploymentIdentity}
         AND environment_identity=${fence.environmentIdentity}
         AND artifact_sha=${fence.artifactSha}
         AND queue_topology_hash=${fence.queueTopologyHash}
         AND lease_expires_at>clock_timestamp()
         AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM sfp_runtime_release_selectors rs
            WHERE rs.authority_key='routine_sfp'
              AND rs.deployment_identity=${fence.deploymentIdentity}
              AND rs.environment_identity=${fence.environmentIdentity}
              AND rs.artifact_sha=${fence.artifactSha}
              AND rs.queue_topology_hash=${fence.queueTopologyHash}
         )
       RETURNING owner_epoch,owner_token
    `))[0];
    if (!owner) throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
    return {
      ownerEpoch: Number(owner.owner_epoch),
      ownerToken: String(owner.owner_token),
      ...fence,
    };
  });
}

/** Read current selector/owner state without acquiring or extending a lease. */
export async function getSfpRuntimeReleaseSelectionStatus(): Promise<SfpRuntimeReleaseSelectionStatus> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  const rowsFound = rows(await db.execute(sql`
    SELECT rs.deployment_identity,rs.environment_identity,rs.artifact_sha,rs.queue_topology_hash,
           rs.publisher_verified_artifact_sha,rs.publisher_verified_deployment_identity,
            rs.verification_reference,rs.selected_by,rs.selected_at,
            rs.selection_version,rs.selection_event_id,
           oa.lease_expires_at,oa.revoked_at,
           COALESCE(oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL,FALSE) AS owner_live,
           (oa.authority_key IS NOT NULL) AS owner_exists
      FROM sfp_runtime_release_selectors rs
      LEFT JOIN sfp_runtime_owner_authority oa
        ON oa.authority_key=rs.authority_key
       AND oa.deployment_identity=rs.deployment_identity
       AND oa.environment_identity=rs.environment_identity
       AND oa.artifact_sha=rs.artifact_sha
       AND oa.queue_topology_hash=rs.queue_topology_hash
     WHERE rs.authority_key='routine_sfp'
  `))[0];
  const selectedRelease = rowsFound ? {
    artifactSha: String(rowsFound.artifact_sha),
    deploymentIdentity: String(rowsFound.deployment_identity),
    environmentIdentity: String(rowsFound.environment_identity),
    queueTopologyHash: String(rowsFound.queue_topology_hash),
    publisherVerifiedArtifactSha: String(rowsFound.publisher_verified_artifact_sha),
    publisherVerifiedDeploymentIdentity: String(rowsFound.publisher_verified_deployment_identity),
    verificationReference: String(rowsFound.verification_reference),
    selectedBy: String(rowsFound.selected_by),
    selectedAt: String(rowsFound.selected_at),
    selectionVersion: Number(rowsFound.selection_version),
    selectionEventId: String(rowsFound.selection_event_id),
  } : null;
  const currentRelease: SfpAuthorizedRelease | null = fence ? {
    artifactSha: fence.artifactSha,
    deploymentIdentity: fence.deploymentIdentity,
    environmentIdentity: fence.environmentIdentity,
    queueTopologyHash: fence.queueTopologyHash,
  } : null;
  const currentReleaseSelected = Boolean(selectedRelease && currentRelease &&
    sameSfpRuntimeRelease(selectedRelease, currentRelease));
  const ownerLive = Boolean(rowsFound?.owner_exists && rowsFound.owner_live);
  let reason: string | null = null;
  if (!fence) reason = "deployment_identity_unverified";
  else if (!selectedRelease) reason = "current_release_not_selected";
  else if (!currentReleaseSelected) reason = "different_release_selected";
  else if (!ownerLive) reason = rowsFound?.owner_exists ? "runtime_owner_lease_not_live" : "runtime_owner_missing";
  return {
    selectedRelease,
    currentRelease,
    currentReleaseSelected,
    ownerLeaseExpiresAt: rowsFound?.lease_expires_at ? String(rowsFound.lease_expires_at) : null,
    ownerLive,
    ready: currentReleaseSelected && ownerLive,
    reason,
  };
}

/**
 * Admin bootstrap/transfer primitive. The caller must authenticate the actor
 * and independently verify the referenced publisher record; this service only
 * checks the submitted publisher SHA/deployment binding and audits those
 * assertions. It cannot validate the external publisher source itself and
 * never treats RELEASE_SHA alone as publisher proof. The selected tuple is
 * bound to this process's observed release, deployment, environment, and
 * queue topology.
 */
export async function selectCurrentSfpRuntimeRelease(
  input: SfpRuntimeReleaseSelectionInput,
): Promise<{
  eventId: string;
  action: "bootstrap" | "transfer";
  selectedRelease: SfpAuthorizedRelease & { selectionVersion: number };
}> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_RUNTIME_RELEASE_SELECTION_BLOCKED:CURRENT_RUNTIME_IDENTITY_UNVERIFIED");
  const actorId = input.actorId.trim();
  const publisherSha = input.publisherVerifiedArtifactSha.trim().toLowerCase();
  const publisherDeployment = input.publisherVerifiedDeploymentIdentity.trim();
  const verificationReference = input.verificationReference.trim();
  if (!actorId) throw new Error("SFP_RUNTIME_RELEASE_SELECTION_ACTOR_REQUIRED");
  if (!/^[0-9a-f]{40}$/.test(publisherSha) || publisherSha !== fence.artifactSha.toLowerCase()) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_PUBLISHER_SHA_MISMATCH");
  }
  if (!publisherDeployment || publisherDeployment !== fence.deploymentIdentity) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_DEPLOYMENT_MISMATCH");
  }
  if (verificationReference.length < 1 || verificationReference.length > 500 ||
      !/^https:\/\//i.test(verificationReference)) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_VERIFICATION_REFERENCE_INVALID");
  }
  const expectedPrevious = input.expectedPreviousArtifactSha?.trim().toLowerCase() ?? null;
  const expectedVersion = input.expectedPreviousSelectionVersion;
  if (expectedVersion !== null &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_EXPECTED_PREVIOUS_VERSION_INVALID");
  }
  if (expectedPrevious !== null && !/^[0-9a-f]{40}$/.test(expectedPrevious)) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_EXPECTED_PREVIOUS_SHA_INVALID");
  }
  if ((expectedVersion === null) !== (expectedPrevious === null)) {
    throw new Error("SFP_RUNTIME_RELEASE_SELECTION_PREVIOUS_FINGERPRINT_REQUIRED");
  }

  return db.transaction((tx) => selectSfpRuntimeReleaseInTransaction(tx, fence, input));
}

async function selectSfpRuntimeReleaseInTransaction(
  tx: SqlExecutor,
  fence: SfpRuntimeFence,
  input: SfpRuntimeReleaseSelectionInput,
  automaticBuiltAt?: string,
) {
    const actorId = input.actorId.trim();
    const publisherSha = input.publisherVerifiedArtifactSha.trim().toLowerCase();
    const publisherDeployment = input.publisherVerifiedDeploymentIdentity.trim();
    const verificationReference = input.verificationReference.trim();
    const expectedPrevious = input.expectedPreviousArtifactSha?.trim().toLowerCase() ?? null;
    const expectedVersion = input.expectedPreviousSelectionVersion;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('routine-sfp-runtime-owner',0))`);
    const previous = rows(await tx.execute(sql`
      SELECT deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
             publisher_verified_artifact_sha,publisher_verified_deployment_identity,
              verification_reference,selected_by,selected_at,selection_version,selection_event_id
        FROM sfp_runtime_release_selectors
       WHERE authority_key='routine_sfp'
       FOR UPDATE
    `))[0] ?? null;
    const actualPreviousSha = previous ? String(previous.artifact_sha).toLowerCase() : null;
    const actualPreviousVersion = previous ? Number(previous.selection_version) : null;
    if (actualPreviousSha !== expectedPrevious || actualPreviousVersion !== expectedVersion) {
      throw new Error("SFP_RUNTIME_RELEASE_SELECTION_PREVIOUS_RELEASE_MISMATCH");
    }
    if (previous && rowMatchesSfpRuntimeRelease(previous, fence)) {
      throw new Error("SFP_RUNTIME_RELEASE_ALREADY_SELECTED");
    }
    const currentOwner = rows(await tx.execute(sql`
      SELECT owner_epoch,owner_token FROM sfp_runtime_owner_authority
       WHERE authority_key='routine_sfp'
       FOR UPDATE
    `))[0];
    if (!previous && currentOwner) {
      throw new Error("SFP_RUNTIME_RELEASE_SELECTION_BOOTSTRAP_BLOCKED:OWNER_HISTORY_EXISTS");
    }
    const priorSelectionHistory = rows(await tx.execute(sql`
      SELECT 1 FROM sfp_runtime_release_selection_events LIMIT 1
    `))[0];
    if (!previous && priorSelectionHistory) {
      throw new Error("SFP_RUNTIME_RELEASE_SELECTION_BOOTSTRAP_BLOCKED:SELECTION_HISTORY_EXISTS");
    }
    const action: "transfer" | "bootstrap" = previous ? "transfer" : "bootstrap";
    const selectionVersion = previous ? actualPreviousVersion! + 1 : 1;
    const selected = {
      artifactSha: fence.artifactSha,
      deploymentIdentity: fence.deploymentIdentity,
      environmentIdentity: fence.environmentIdentity,
      queueTopologyHash: fence.queueTopologyHash,
      selectionVersion,
      publisherVerifiedArtifactSha: publisherSha,
      publisherVerifiedDeploymentIdentity: publisherDeployment,
      verificationReference,
      ...(automaticBuiltAt ? {
        selectionMethod: "automatic_published_artifact",
        buildCreatedAt: automaticBuiltAt,
      } : {}),
    };
    const event = rows(await tx.execute(sql`
      INSERT INTO sfp_runtime_release_selection_events
        (action,actor_id,previous_selection,selected_release,publisher_verification_reference)
      VALUES (
        ${action},${actorId},${previous ? JSON.stringify({
          deploymentIdentity: String(previous.deployment_identity),
          environmentIdentity: String(previous.environment_identity),
          artifactSha: String(previous.artifact_sha),
          queueTopologyHash: String(previous.queue_topology_hash),
          selectionVersion: Number(previous.selection_version),
          selectionEventId: String(previous.selection_event_id),
          selectedBy: String(previous.selected_by),
          selectedAt: String(previous.selected_at),
        }) : null}::jsonb,
        ${JSON.stringify(selected)}::jsonb,${verificationReference}
      )
      RETURNING id
    `))[0];
    if (previous) {
      // A transfer must execute the selector's UPDATE trigger branch. An
      // INSERT ... ON CONFLICT DO UPDATE first runs the INSERT trigger, which
      // correctly rejects transfer evidence as invalid bootstrap evidence.
      // Keep the locked read's complete binding/version/event as a CAS too:
      // this remains fail-closed if a writer bypasses the advisory lock.
      const updated = rows(await tx.execute(sql`
        UPDATE sfp_runtime_release_selectors
           SET deployment_identity=${fence.deploymentIdentity},
               environment_identity=${fence.environmentIdentity},
               artifact_sha=${fence.artifactSha},
               queue_topology_hash=${fence.queueTopologyHash},
               publisher_verified_artifact_sha=${publisherSha},
               publisher_verified_deployment_identity=${publisherDeployment},
               verification_reference=${verificationReference},
               selected_by=${actorId},
               selected_at=clock_timestamp(),
               updated_at=clock_timestamp(),
               selection_version=${selectionVersion},
               selection_event_id=${String(event.id)}::uuid
         WHERE authority_key='routine_sfp'
           AND deployment_identity=${String(previous.deployment_identity)}
           AND environment_identity=${String(previous.environment_identity)}
           AND artifact_sha=${String(previous.artifact_sha)}
           AND queue_topology_hash=${String(previous.queue_topology_hash)}
           AND selection_version=${actualPreviousVersion}
           AND selection_event_id=${String(previous.selection_event_id)}::uuid
        RETURNING authority_key
      `));
      if (updated.length !== 1) {
        throw new Error("SFP_RUNTIME_RELEASE_SELECTION_PREVIOUS_RELEASE_MISMATCH");
      }
    } else {
      // Bootstrap is the only selector INSERT path. A concurrent or
      // non-cooperating inserter loses at the singleton key and cannot be
      // silently converted into a transfer.
      await tx.execute(sql`
        INSERT INTO sfp_runtime_release_selectors
          (authority_key,deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
           publisher_verified_artifact_sha,publisher_verified_deployment_identity,
           verification_reference,selected_by,selected_at,updated_at,selection_version,selection_event_id)
        VALUES ('routine_sfp',${fence.deploymentIdentity},${fence.environmentIdentity},${fence.artifactSha},
                ${fence.queueTopologyHash},${publisherSha},${publisherDeployment},
                ${verificationReference},${actorId},clock_timestamp(),clock_timestamp(),
                ${selectionVersion},${String(event.id)}::uuid)
      `);
    }
    const ownerToken = randomUUID();
    if (currentOwner) {
      await tx.execute(sql`
        UPDATE sfp_runtime_owner_authority
           SET deployment_identity=${fence.deploymentIdentity},
               environment_identity=${fence.environmentIdentity},
               artifact_sha=${fence.artifactSha},
               queue_topology_hash=${fence.queueTopologyHash},
               owner_epoch=owner_epoch+1,
               owner_token=${ownerToken}::uuid,
               lease_expires_at=clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
               revoked_at=NULL,
               updated_at=clock_timestamp()
         WHERE authority_key='routine_sfp'
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO sfp_runtime_owner_authority
          (authority_key,deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
           owner_epoch,owner_token,lease_expires_at,revoked_at,updated_at)
        VALUES ('routine_sfp',${fence.deploymentIdentity},${fence.environmentIdentity},${fence.artifactSha},
                ${fence.queueTopologyHash},1,${ownerToken}::uuid,
                clock_timestamp()+(${SFP_RUNTIME_OWNER_LEASE_MS}::bigint * INTERVAL '1 millisecond'),
                NULL,clock_timestamp())
      `);
    }
    return {
      eventId: String(event.id),
      action,
      selectedRelease: {
        artifactSha: fence.artifactSha,
        deploymentIdentity: fence.deploymentIdentity,
        environmentIdentity: fence.environmentIdentity,
        queueTopologyHash: fence.queueTopologyHash,
        selectionVersion,
      },
    };
}

/**
 * User-authorized routine publish policy, not an external publisher attestation.
 * Only compiled, SHA-bound artifacts in Replit's published production runtime
 * can advance. Selection, append-only evidence and owner transfer are atomic.
 * Spend approvals, provider controls and outbound authority are never touched.
 */
async function advanceSfpPublishedRelease(tx: SqlExecutor, fence: SfpRuntimeFence) {
  const published = readSfpAutomaticPublish({
    nodeEnv: process.env.NODE_ENV,
    replitDeployment: process.env.REPLIT_DEPLOYMENT,
    releaseSha: process.env.RELEASE_SHA,
    publishArtifactSha: process.env.SFP_PUBLISH_ARTIFACT_SHA,
    publishBuildId: process.env.SFP_PUBLISH_BUILD_ID,
    publishBuiltAt: process.env.SFP_PUBLISH_BUILT_AT,
  });
  if (!published) return;
  if (published.deploymentIdentity !== fence.deploymentIdentity
      || published.artifactSha !== fence.artifactSha) {
    throw new Error("SFP_PUBLISH_HANDOFF_ARTIFACT_MISMATCH");
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('routine-sfp-runtime-owner',0))`);
  const previous = rows(await tx.execute(sql`
    SELECT rs.*, e.selected_release AS selected_receipt
      FROM sfp_runtime_release_selectors rs
      JOIN sfp_runtime_release_selection_events e ON e.id=rs.selection_event_id
     WHERE rs.authority_key='routine_sfp' FOR UPDATE OF rs
  `))[0];
  const owner = rows(await tx.execute(sql`
    SELECT revoked_at FROM sfp_runtime_owner_authority WHERE authority_key='routine_sfp' FOR UPDATE
  `))[0];
  if (owner?.revoked_at) throw new Error("SFP_PUBLISH_HANDOFF_OWNER_REVOKED");
  // Restarting another replica is idempotent, not another release event.
  if (previous && rowMatchesSfpRuntimeRelease(previous, fence)) return;
  const seen = rows(await tx.execute(sql`
    SELECT 1 FROM sfp_runtime_release_selection_events
     WHERE selected_release->>'deploymentIdentity'=${fence.deploymentIdentity} LIMIT 1
  `))[0];
  const latest = rows(await tx.execute(sql`
    SELECT selected_release->>'buildCreatedAt' AS built_at
      FROM sfp_runtime_release_selection_events
     WHERE selected_release ? 'buildCreatedAt'
     ORDER BY selected_release->>'buildCreatedAt' DESC LIMIT 1
  `))[0];
  assertSfpPublishMayAdvance({
    builtAt: published.builtAt,
    previousEnvironment: previous ? String(previous.environment_identity) : null,
    environment: fence.environmentIdentity,
    previousSelectedAt: previous ? String(previous.selected_at) : null,
    previousWasAutomatic: previous?.selected_receipt?.selectionMethod === "automatic_published_artifact",
    latestBuiltAt: latest ? String(latest.built_at) : null,
    previouslySelected: Boolean(seen),
    ownerRevoked: Boolean(owner?.revoked_at),
  });
  await selectSfpRuntimeReleaseInTransaction(tx, fence, {
    actorId: "system:sfp-publish-handoff",
    expectedPreviousArtifactSha: previous ? String(previous.artifact_sha) : null,
    expectedPreviousSelectionVersion: previous ? Number(previous.selection_version) : null,
    publisherVerifiedArtifactSha: fence.artifactSha,
    publisherVerifiedDeploymentIdentity: fence.deploymentIdentity,
    verificationReference: `sfp-publish-artifact:${published.buildId}:${published.builtAt}`,
  }, published.builtAt);
}

export async function assertSfpRuntimeAuthority(cohortRunId: string): Promise<SfpRuntimeAuthority> {
  const authority = rows(await db.execute(sql`
    SELECT r.id
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id=${cohortRunId}::uuid AND r.cohort_state='frozen' AND r.voided_at IS NULL
       AND r.superseded_at IS NULL AND p.is_active=TRUE
  `))[0];
  if (!authority) throw new Error("SFP_PAID_BLOCKED:COHORT_OR_PROGRAM_INACTIVE");
  return claimSfpRuntimeDeploymentOwner();
}

/**
 * Fast, side-effect-free readiness check for provider_controls
 * (enabled + circuit closed).
 * Continuous background ticks call this BEFORE touching any cohort/stage
 * row so a disabled or circuit-open provider becomes a durable "paused" outcome —
 * no cohort freeze, no stage claim, no reservation attempt, nothing to get
 * stuck in a partial state and no retry storm. This deliberately duplicates
 * (rather than weakens) the authoritative checks inside
 * reserveSfpProviderOperation/previewSfpValidation, which still run their
 * authoritative checks at actual reservation time.
 */
export async function getSfpProviderReadiness(
  provider: SfpPaidProvider,
): Promise<{ ready: boolean; reason: string | null }> {
  const controlProvider = CONTROL_KEY[provider];
  const control = rows(await db.execute(sql`
    SELECT enabled, circuit_state
      FROM provider_controls WHERE provider=${controlProvider}
  `))[0];
  if (!control) return { ready: false, reason: `provider_control_missing:${controlProvider}` };
  if (!control.enabled) return { ready: false, reason: `provider_disabled:${controlProvider}` };
  if (control.circuit_state !== "closed") return { ready: false, reason: `provider_circuit_${control.circuit_state}:${controlProvider}` };
  if (!process.env[SECRET_KEY[provider]]) return { ready: false, reason: `credential_missing:${SECRET_KEY[provider]}` };
  if (provider === "apollo") {
    // Optional-provider scheduling hint, not a new control or spend limit.
    // Use the existing 15-minute failed-attempt cooldown across businesses:
    // one provider-wide rejection must not cause a request on every business.
    // A later successful response supersedes the hint immediately.
    const latest = rows(await db.execute(sql`
      SELECT sfp_result_data->>'httpStatus' AS http_status,
             sfp_result_data->>'retrievalState' AS retrieval_state
        FROM provider_operations
       WHERE provider='apollo' AND purpose='sfp_named_decision_maker_discovery'
         AND state IN ('completed','failed')
         AND sfp_result_data->>'retrievalState' IN ('completed','failed')
         AND updated_at>=NOW()-INTERVAL '15 minutes'
       ORDER BY updated_at DESC,id DESC LIMIT 1
    `))[0];
    const unavailable = latest?.retrieval_state === "failed"
      ? sfpUnavailableHttpReason("apollo", latest.http_status) : null;
    if (unavailable) return { ready: false, reason: unavailable };
  }
  return { ready: true, reason: null };
}

/**
 * Side-effect-free eligibility check. Durable ownership is claimed by the
 * reservation path and rechecked/renewed at the serialized dispatch marker.
 */
export async function getSfpRuntimeReadiness(
  cohortRunId: string,
): Promise<{ ready: boolean; reason: string | null }> {
  const authority = rows(await db.execute(sql`
    SELECT r.id FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id=${cohortRunId}::uuid AND r.cohort_state='frozen'
       AND r.voided_at IS NULL AND r.superseded_at IS NULL AND p.is_active=TRUE
  `))[0];
  if (!authority) return { ready: false, reason: "cohort_or_program_inactive" };
  return getSfpDeploymentOwnerReadiness();
}

/** Side-effect-free deployment-wide readiness for profiles and legacy pilot previews. */
export async function getSfpDeploymentOwnerReadiness(): Promise<{ ready: boolean; reason: string | null }> {
  const status = await getSfpRuntimeReleaseSelectionStatus();
  return { ready: status.ready, reason: status.reason };
}

export async function currentSfpUnitPrice(provider: SfpPaidProvider): Promise<number | null> {
  return (await currentSfpReviewedPricing(provider)).unitPriceMicros;
}

type SfpNoResultBillingSemantics =
  | "per_unit_no_result_billable"
  | "per_unit_no_result_free"
  | null;

export function noResultBillableFromPricingSemantics(semantics: unknown): boolean | null {
  if (semantics === "per_unit_no_result_billable") return true;
  if (semantics === "per_unit_no_result_free") return false;
  return null;
}

function canonicalNoResultBillingSemantics(value: unknown): SfpNoResultBillingSemantics {
  return value === "per_unit_no_result_billable" || value === "per_unit_no_result_free"
    ? value
    : null;
}

function reservationNoResultBillable(resultData: unknown): boolean | null {
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) return null;
  const data = resultData as Record<string, unknown>;
  if (typeof data.noResultBillable === "boolean") return data.noResultBillable;
  return noResultBillableFromPricingSemantics(data.noResultBillingSemantics);
}

function nullableReviewedMicros(value: unknown): number | null {
  if (value == null) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function exactReservedCostMicros(unitPriceMicros: number | null, units: number): string {
  if (unitPriceMicros !== null &&
      (!Number.isSafeInteger(unitPriceMicros) || unitPriceMicros < 0)) {
    throw new Error("SFP_RESERVED_UNIT_PRICE_MICROS_INVALID");
  }
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error("SFP_RESERVED_WORK_UNITS_MUST_BE_NONNEGATIVE_INTEGER");
  }
  return (BigInt(unitPriceMicros ?? 0) * BigInt(units)).toString();
}

function normalizeSfpWorkUnit(value: unknown): string {
  const unit = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9_:-]{0,31}$/.test(unit)) {
    throw new Error("SFP_PROVIDER_WORK_UNIT_INVALID");
  }
  return unit;
}

function reservedWorkUnit(resultData: unknown, fallback: string): string {
  if (resultData && typeof resultData === "object" && !Array.isArray(resultData)) {
    const value = (resultData as Record<string, unknown>).reservedWorkUnit;
    if (typeof value === "string") return normalizeSfpWorkUnit(value);
  }
  return normalizeSfpWorkUnit(fallback);
}

export async function currentSfpReviewedPricing(provider: SfpPaidProvider): Promise<{
  unitPriceMicros: number | null;
  unitType: string | null;
  noResultBillingSemantics: SfpNoResultBillingSemantics;
  noResultBillable: boolean | null;
}> {
  try {
    const pricing = await getCurrentPricingSchedule();
    const key = provider === "openai_classification" ? "openai" : provider;
    const entry = pricing.priceSchedules[key] as any;
    const unitPriceMicros = nullableReviewedMicros(entry?.amountMicros);
    const unitType = typeof entry?.unitType === "string" && entry.unitType.trim()
      ? entry.unitType.trim().toLowerCase()
      : null;
    const noResultBillingSemantics = canonicalNoResultBillingSemantics(entry?.billingSemantics);
    return {
      unitPriceMicros,
      unitType,
      noResultBillingSemantics,
      noResultBillable: noResultBillableFromPricingSemantics(noResultBillingSemantics),
    };
  } catch {
    return { unitPriceMicros: null, unitType: null, noResultBillingSemantics: null, noResultBillable: null };
  }
}

export function sfpPriceEstimateReceipt(
  unitPriceEstimateMicros: number | null,
  noResultBillingSemantics: SfpNoResultBillingSemantics = null,
): {
  unitPriceEstimateMicros: number | null;
  unitPriceEstimateStatus: "estimate" | "unknown";
  costEstimateStatus: "estimate" | "unknown";
  noResultBillingSemantics: SfpNoResultBillingSemantics;
  noResultBillable: boolean | null;
} {
  return {
    unitPriceEstimateMicros,
    unitPriceEstimateStatus: unitPriceEstimateMicros === null ? "unknown" : "estimate",
    costEstimateStatus: unitPriceEstimateMicros === null ? "unknown" : "estimate",
    noResultBillingSemantics,
    noResultBillable: noResultBillableFromPricingSemantics(noResultBillingSemantics),
  };
}

/**
 * Release only expired reservations whose durable attempt is still pending.
 * invoke*SfpProviderTransport changes that marker to ambiguous under the same
 * ledger lock immediately before transport; those post-dispatch rows are never
 * auto-released. Legacy reservations without the stored unit price or run
 * lineage are retained conservatively for operator reconciliation.
 */
export async function releaseExpiredPreDispatchSfpReservations(): Promise<number> {
  return db.transaction(async (tx) => {
    await acquireLadderBudgetLock(tx);
    const expired = rows(await tx.execute(sql`
      SELECT o.id,o.provider,o.reserved_units,o.idempotency_key,o.operation_type,
             o.sfp_result_data->>'reservedUnitAmountMicros' AS unit_amount_micros
        FROM provider_operations o
        JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
       WHERE o.operation_type IN ('sfp_enrichment','sfp_precohort_classification')
         AND o.state='running' AND o.billing_state='reserved'
         AND o.lease_expires_at<=clock_timestamp() AND a.outcome='pending' AND a.completed_at IS NULL
         AND o.sfp_result_data ? 'reservedUnitAmountMicros'
       FOR UPDATE OF o
    `));
    let released = 0;
    for (const operation of expired) {
      const reservedUnits = Number(operation.reserved_units);
      const unitPriceMicros = operation.unit_amount_micros == null
        ? 0
        : nullableReviewedMicros(operation.unit_amount_micros);
      if (unitPriceMicros === null || !Number.isSafeInteger(reservedUnits) || reservedUnits < 0) continue;
      const amountMicros = exactReservedCostMicros(unitPriceMicros, reservedUnits);
      const updated = rows(await tx.execute(sql`
        UPDATE provider_operations
            SET state='failed',billing_state='released',failure_code='PRE_DISPATCH_LEASE_EXPIRED',
                settled_cost_micros=0,
               claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
         WHERE id=${String(operation.id)}::uuid AND state='running' AND billing_state='reserved'
         RETURNING id
      `))[0];
      if (!updated) continue;
      await tx.execute(sql`
        UPDATE provider_attempts SET outcome='blocked',retryable=TRUE,error_code='PRE_DISPATCH_LEASE_EXPIRED',
               completed_at=NOW()
         WHERE operation_id=${String(operation.id)}::uuid AND attempt_number=1
           AND outcome='pending' AND completed_at IS NULL
      `);
      const control = rows(await tx.execute(sql`
        UPDATE provider_controls SET reserved_units=reserved_units-${reservedUnits},
               version=version+1,updated_at=NOW()
         WHERE provider=${String(operation.provider)} AND reserved_units>=${reservedUnits}
        RETURNING provider
      `))[0];
      if (!control) throw new Error("SFP_EXPIRED_RESERVATION_PROVIDER_CONTROL_UNDERFLOW");
      if (String(operation.operation_type) === "sfp_enrichment") {
        const stage = rows(await tx.execute(sql`
          UPDATE sfp_stage_runs sr
             SET reserved_cost_micros=sr.reserved_cost_micros-${amountMicros}::bigint,updated_at=NOW()
            FROM sfp_stage_items i
           WHERE i.provider_operation_id=${String(operation.id)}::uuid AND sr.id=i.stage_run_id
             AND sr.reserved_cost_micros>=${amountMicros}::bigint
          RETURNING sr.id
        `))[0];
        if (!stage) throw new Error("SFP_EXPIRED_RESERVATION_STAGE_AGGREGATE_UNDERFLOW");
      } else {
        const runId = rows(await tx.execute(sql`
          SELECT id FROM sfp_classification_runs
           WHERE ${String(operation.idempotency_key)} LIKE '%' || ':run:' || id::text
           LIMIT 1
        `))[0]?.id;
        if (!runId) {
          // Do not commit a partial release if run lineage was not retained.
          throw new Error("SFP_EXPIRED_RESERVATION_RUN_LINEAGE_MISSING");
        }
        const classification = rows(await tx.execute(sql`
          UPDATE sfp_classification_runs
             SET reserved_cost_micros=reserved_cost_micros-${amountMicros}::bigint,updated_at=NOW()
           WHERE id=${String(runId)}::uuid AND reserved_cost_micros>=${amountMicros}::bigint
          RETURNING id
        `))[0];
        if (!classification) throw new Error("SFP_EXPIRED_RESERVATION_CLASSIFICATION_AGGREGATE_UNDERFLOW");
      }
      released++;
    }
    return released;
  });
}

export async function reserveSfpProviderOperation(input: {
  stageRunId: string;
  cohortRunId: string;
  businessId: number;
  candidateId?: string | null;
  provider: SfpPaidProvider;
  purpose: string;
  idempotencyKey: string;
  actorId: string;
  workUnit: string;
  units?: number;
}): Promise<SfpProviderReservation> {
  if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true") {
    throw new Error("SFP_PAID_BLOCKED:PROVIDER_TRANSPORT_DISABLED");
  }
  if (!process.env[SECRET_KEY[input.provider]]) {
    throw new Error(`SFP_PAID_BLOCKED:CREDENTIAL_MISSING:${SECRET_KEY[input.provider]}`);
  }
  const sourceId = input.provider as ProviderSourceId;
  assertProviderActivation({ sourceId, caller: CALLER, explicitPaidApproval: true });
  await releaseExpiredPreDispatchSfpReservations();
  const authority = await assertSfpRuntimeAuthority(input.cohortRunId);
  const requestedUnits = Number(input.units ?? 1);
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 1) throw new Error("SFP_PROVIDER_WORK_UNITS_INVALID");
  const maximumUnits = MAX_UNITS_PER_RESERVATION[input.provider] ?? 100;
  if (requestedUnits > maximumUnits) throw new Error("SFP_PROVIDER_WORK_UNITS_EXCEED_PER_RESERVATION_LIMIT");
  const units = requestedUnits;
  const workUnit = normalizeSfpWorkUnit(input.workUnit);
  const reviewedPricing = await currentSfpReviewedPricing(input.provider);
  const unitPriceEstimateMicros = reviewedPricing.unitPriceMicros;
  const amountMicros = reviewedPricing.unitType === workUnit ? unitPriceEstimateMicros : null;
  const reservedCostMicros = exactReservedCostMicros(amountMicros, units);
  const controlProvider = CONTROL_KEY[input.provider];

  return db.transaction(async (tx) => {
    const currentOwner = await claimOrRenewSfpRuntimeOwner(tx, authority);
    if (currentOwner.ownerEpoch !== authority.ownerEpoch || currentOwner.ownerToken !== authority.ownerToken) {
      throw new Error("SFP_RUNTIME_OWNER_FENCE_LOST");
    }
    const quarantine = rows(await tx.execute(sql`
      SELECT 1 FROM sfp_identity_quarantines
       WHERE business_id=${input.businessId} AND cleared_at IS NULL LIMIT 1
    `))[0];
    if (quarantine) throw new Error("SFP_PAID_BLOCKED:IDENTITY_QUARANTINED");
    const existing = rows(await tx.execute(sql`
       SELECT id,claim_token,reserved_units,state,sfp_result_data,unit_price_micros,unit_price_unit,
              runtime_owner_epoch,runtime_owner_token FROM provider_operations
       WHERE provider=${controlProvider} AND idempotency_key=${input.idempotencyKey} LIMIT 1
    `))[0];
    if (existing) {
      if (String(existing.state) === "running") throw new Error("SFP_PAID_BLOCKED:OPERATION_ALREADY_RUNNING");
      if (String(existing.state) !== "completed") {
        throw new Error(`SFP_PAID_BLOCKED:OPERATION_${String(existing.state).toUpperCase()}`);
      }
      return {
        operationId:String(existing.id),claimToken:String(existing.claim_token ?? ""),provider:input.provider,
        controlProvider,
        amountMicros:nullableReviewedMicros((existing.sfp_result_data as any)?.reservedUnitAmountMicros),
        reviewedUnitPriceMicros:nullableReviewedMicros(existing.unit_price_micros),
        workUnit:reservedWorkUnit(existing.sfp_result_data, workUnit),
         reviewedUnitType:existing.unit_price_unit == null ? null : String(existing.unit_price_unit),
        noResultBillable:reservationNoResultBillable(existing.sfp_result_data),
        units:Number(existing.reserved_units),stageRunId:input.stageRunId,
         runtimeOwnerEpoch:Number(existing.runtime_owner_epoch ?? authority.ownerEpoch),
         runtimeOwnerToken:String(existing.runtime_owner_token ?? authority.ownerToken),
         replayed:true,resultData:publicProviderResultData(existing.sfp_result_data),
      };
    }

    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
          state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,
          unit_price_micros,unit_price_unit,runtime_owner_epoch,runtime_owner_token,started_at,sfp_result_data)
      VALUES (${controlProvider},'sfp_enrichment',${input.purpose},${input.idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
                clock_timestamp()+INTERVAL '5 minutes',${unitPriceEstimateMicros},${reviewedPricing.unitType},${authority.ownerEpoch},${authority.ownerToken}::uuid,NOW(),
                ${JSON.stringify({
                   reservedUnitAmountMicros: amountMicros,
                   reservedUnitType: amountMicros === null ? null : workUnit,
                   reservedWorkUnit: workUnit,
                   ...sfpPriceEstimateReceipt(amountMicros, reviewedPricing.noResultBillingSemantics),
                    reservedBusinessId: input.businessId,
                    reservedStageRunId: input.stageRunId,
                    reservedCohortRunId: input.cohortRunId,
                    reservedProvider: input.provider,
                })}::jsonb) RETURNING id
    `))[0];
    await tx.execute(sql`
      INSERT INTO provider_attempts(operation_id,attempt_number,outcome,started_at)
      VALUES (${String(operation.id)}::uuid,1,'pending',NOW())
    `);
    await tx.execute(sql`
      INSERT INTO sfp_runtime_job_leases
        (operation_id,deployment_identity,environment_identity,artifact_sha,process_identity,
         owner_epoch,owner_token,operation_claim_token,lease_expires_at)
      VALUES (${String(operation.id)}::uuid,${authority.deploymentIdentity},${authority.environmentIdentity},
              ${authority.artifactSha},${authority.processIdentity},${authority.ownerEpoch},
              ${authority.ownerToken}::uuid,${claimToken}::uuid,clock_timestamp()+INTERVAL '5 minutes')
    `);
    const stage = rows(await tx.execute(sql`
      UPDATE sfp_stage_runs SET
             reserved_cost_micros=reserved_cost_micros+${reservedCostMicros}::bigint,
             "authorization"=${JSON.stringify({
               runtimeOwnerEpoch: authority.ownerEpoch,
               deploymentIdentity: authority.deploymentIdentity,
               spendAuthorization: "routine_sfp_not_required",
             })}::jsonb,
             last_heartbeat_at=NOW(),updated_at=NOW()
        WHERE id=${input.stageRunId}::uuid
      RETURNING id
    `))[0];
    if (!stage) throw new Error("SFP_PROVIDER_STAGE_RUN_MISSING");
    await tx.execute(sql`
      INSERT INTO sfp_stage_items(stage_run_id,business_id,provider,candidate_id,provider_operation_id,state,claim_token,lease_expires_at,attempt_count)
      VALUES (${input.stageRunId}::uuid,${input.businessId},${controlProvider},${input.candidateId ?? null}::uuid,
              ${String(operation.id)}::uuid,'claimed',${claimToken}::uuid,clock_timestamp()+INTERVAL '5 minutes',1)
      ON CONFLICT (stage_run_id,business_id,provider) DO UPDATE
        SET provider_operation_id=EXCLUDED.provider_operation_id,state='claimed',claim_token=EXCLUDED.claim_token,
            lease_expires_at=EXCLUDED.lease_expires_at,attempt_count=sfp_stage_items.attempt_count+1,updated_at=NOW()
    `);
    return {
      operationId:String(operation.id),claimToken,provider:input.provider,controlProvider,
      amountMicros,reviewedUnitPriceMicros:unitPriceEstimateMicros,
      reviewedUnitType:reviewedPricing.unitType,
      noResultBillable:reviewedPricing.noResultBillable,workUnit,units,stageRunId:input.stageRunId,
       businessId:input.businessId,cohortRunId:input.cohortRunId,
      runtimeOwnerEpoch:authority.ownerEpoch,runtimeOwnerToken:authority.ownerToken,
    };
  });
}

/**
 * Pre-cohort variant of {@link reserveSfpProviderOperation} for Phase A
 * (independent SFP classification bridge, sfp-classification-bridge.ts).
 * Phase A has no frozen cohort and is forbidden from writing
 * sfp_stage_runs/sfp_stage_items — so this omits `assertSfpRuntimeAuthority`
 * (which requires a frozen `sfp_cohort_runs` row) and the stage-run/item
 * writes, but keeps every other real guardrail: provider transport flag,
 * credential presence, provider-manifest admission, explicit paid approval,
 * and the provider_controls enabled/circuit-breaker gate.
 */
export interface SfpPreCohortProviderReservation {
  operationId: string;
  claimToken: string;
  provider: SfpPaidProvider;
  controlProvider: string;
  /** Reserve estimate per work unit; null when reviewed pricing uses another unit. */
  amountMicros: number | null;
  reviewedUnitPriceMicros?: number | null;
  reviewedUnitType?: string | null;
  noResultBillable?: boolean | null;
  businessId?: number;
  workUnit: string;
  units: number;
  runId: string;
  runtimeOwnerEpoch: number;
  runtimeOwnerToken: string;
  replayed?: boolean;
  resultData?: any;
}

export async function reservePreCohortSfpProviderOperation(input: {
  runId: string;
  businessId: number;
  provider: SfpPaidProvider;
  purpose: string;
  idempotencyKey: string;
  actorId: string;
  workUnit: string;
  units?: number;
}): Promise<SfpPreCohortProviderReservation> {
  if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true") {
    throw new Error("SFP_PAID_BLOCKED:PROVIDER_TRANSPORT_DISABLED");
  }
  if (!process.env[SECRET_KEY[input.provider]]) {
    throw new Error(`SFP_PAID_BLOCKED:CREDENTIAL_MISSING:${SECRET_KEY[input.provider]}`);
  }
  const sourceId = input.provider as ProviderSourceId;
  assertProviderActivation({ sourceId, caller: "server/services/cro03/sfp-classification-bridge.ts", explicitPaidApproval: true });
  await releaseExpiredPreDispatchSfpReservations();
  const runtimeFence = await getCurrentRoutineSfpRuntimeFence();
  if (!runtimeFence) throw new Error("SFP_PAID_BLOCKED:DEPLOYMENT_IDENTITY_UNVERIFIED");
  const requestedUnits = Number(input.units ?? 1);
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 1) throw new Error("SFP_PROVIDER_WORK_UNITS_INVALID");
  const maximumUnits = MAX_UNITS_PER_RESERVATION[input.provider] ?? 100;
  if (requestedUnits > maximumUnits) throw new Error("SFP_PROVIDER_WORK_UNITS_EXCEED_PER_RESERVATION_LIMIT");
  const units = requestedUnits;
  const workUnit = normalizeSfpWorkUnit(input.workUnit);
  const reviewedPricing = await currentSfpReviewedPricing(input.provider);
  const unitPriceEstimateMicros = reviewedPricing.unitPriceMicros;
  const amountMicros = reviewedPricing.unitType === workUnit ? unitPriceEstimateMicros : null;
  const reservedCostMicros = exactReservedCostMicros(amountMicros, units);
  const controlProvider = CONTROL_KEY[input.provider];
  // Include the owning run as durable lineage so an expired, provably
  // pre-dispatch reservation can be returned to precisely that run ledger.
  const idempotencyKey = `${input.idempotencyKey}:run:${input.runId}`;

  return db.transaction(async (tx) => {
    const authority = await claimOrRenewSfpRuntimeOwner(tx, runtimeFence);
    const quarantine = rows(await tx.execute(sql`
      SELECT 1 FROM sfp_identity_quarantines
       WHERE business_id=${input.businessId} AND cleared_at IS NULL LIMIT 1
    `))[0];
    if (quarantine) throw new Error("SFP_PAID_BLOCKED:IDENTITY_QUARANTINED");
    const existing = rows(await tx.execute(sql`
       SELECT id,claim_token,reserved_units,state,sfp_result_data,unit_price_micros,unit_price_unit,
              runtime_owner_epoch,runtime_owner_token FROM provider_operations
        WHERE provider=${controlProvider} AND idempotency_key=${idempotencyKey} LIMIT 1
    `))[0];
    if (existing) {
      if (String(existing.state) === "running") throw new Error("SFP_PAID_BLOCKED:OPERATION_ALREADY_RUNNING");
      if (String(existing.state) !== "completed") {
        throw new Error(`SFP_PAID_BLOCKED:OPERATION_${String(existing.state).toUpperCase()}`);
      }
      return {
        operationId:String(existing.id),claimToken:String(existing.claim_token ?? ""),provider:input.provider,
        controlProvider,
        amountMicros:nullableReviewedMicros((existing.sfp_result_data as any)?.reservedUnitAmountMicros),
        reviewedUnitPriceMicros:nullableReviewedMicros(existing.unit_price_micros),
        workUnit:reservedWorkUnit(existing.sfp_result_data, workUnit),
        reviewedUnitType:existing.unit_price_unit == null ? null : String(existing.unit_price_unit),
        noResultBillable:reservationNoResultBillable(existing.sfp_result_data),
        units:Number(existing.reserved_units),runId:input.runId,
        runtimeOwnerEpoch:Number(existing.runtime_owner_epoch ?? authority.ownerEpoch),
        runtimeOwnerToken:String(existing.runtime_owner_token ?? authority.ownerToken),
          replayed:true,resultData:publicPreCohortResultData(existing.sfp_result_data),
      };
    }
    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
          state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,
          unit_price_micros,unit_price_unit,runtime_owner_epoch,runtime_owner_token,started_at,sfp_result_data)
       VALUES (${controlProvider},'sfp_precohort_classification',${input.purpose},${idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
                 clock_timestamp()+INTERVAL '5 minutes',${unitPriceEstimateMicros},${reviewedPricing.unitType},${authority.ownerEpoch},${authority.ownerToken}::uuid,NOW(),
                ${JSON.stringify({
                   reservedUnitAmountMicros: amountMicros,
                   reservedUnitType: amountMicros === null ? null : workUnit,
                   reservedWorkUnit: workUnit,
                   ...sfpPriceEstimateReceipt(amountMicros, reviewedPricing.noResultBillingSemantics),
                    reservedBusinessId: input.businessId,
                    reservedClassificationRunId: input.runId,
                    reservedProvider: input.provider,
                })}::jsonb) RETURNING id
    `))[0];
    const classificationRun = rows(await tx.execute(sql`
      UPDATE sfp_classification_runs
         SET reserved_cost_micros=reserved_cost_micros+${reservedCostMicros}::bigint,updated_at=NOW()
        WHERE id=${input.runId}::uuid AND state='running' AND lease_expires_at>clock_timestamp()
      RETURNING id
    `))[0];
    if (!classificationRun) throw new Error("SFP_PROVIDER_CLASSIFICATION_RUN_FENCE_LOST");
    await tx.execute(sql`
      INSERT INTO provider_attempts(operation_id,attempt_number,outcome,started_at)
      VALUES (${String(operation.id)}::uuid,1,'pending',NOW())
    `);
    await tx.execute(sql`
      INSERT INTO sfp_runtime_job_leases
        (operation_id,deployment_identity,environment_identity,artifact_sha,process_identity,
         owner_epoch,owner_token,operation_claim_token,lease_expires_at)
      VALUES (${String(operation.id)}::uuid,${authority.deploymentIdentity},${authority.environmentIdentity},
              ${authority.artifactSha},${authority.processIdentity},${authority.ownerEpoch},
              ${authority.ownerToken}::uuid,${claimToken}::uuid,clock_timestamp()+INTERVAL '5 minutes')
    `);
    return {
      operationId:String(operation.id),claimToken,provider:input.provider,controlProvider,
      amountMicros,reviewedUnitPriceMicros:unitPriceEstimateMicros,
      reviewedUnitType:reviewedPricing.unitType,
      noResultBillable:reviewedPricing.noResultBillable,workUnit,units,runId:input.runId,
       businessId:input.businessId,
      runtimeOwnerEpoch:authority.ownerEpoch,runtimeOwnerToken:authority.ownerToken,
    };
  });
}

export async function settlePreCohortSfpProviderOperation(input: {
  reservation: SfpPreCohortProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  settledUnits?: number;
  providerUsage?: SfpProviderUsageSettlement;
  resultData?: unknown;
}, executor?: SqlExecutor): Promise<{ settledMicros: number | null; replayed: boolean; currentFenceAtSettlement: boolean; finalizationAllowed: boolean }> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const fence = await getCurrentRoutineSfpRuntimeFence();
  const settle = async (tx: { execute: (query: any) => Promise<any> }) => {
    const currentFenceAtSettlement = await currentSfpProviderPromotionPermission(tx, input.reservation, fence);
    await acquireLadderBudgetLock(tx);
    const operationBefore = rows(await tx.execute(sql`
      SELECT provider,target_fingerprint,state,billing_state,claim_token,reserved_units,
             unit_price_micros,unit_price_unit,settled_cost_micros,
             sfp_dispatch_receipt_fingerprint,sfp_result_data
        FROM provider_operations
       WHERE id=${input.reservation.operationId}::uuid
       FOR UPDATE
    `))[0];
    if (!operationBefore) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    if (String(operationBefore.provider) !== input.reservation.controlProvider ||
        String(operationBefore.target_fingerprint) !== `business:${input.businessId}`) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_IDENTITY_MISMATCH");
    }
    const reservationData = operationBefore.sfp_result_data && typeof operationBefore.sfp_result_data === "object"
      ? operationBefore.sfp_result_data as Record<string, unknown>
      : {};
    const originalBusinessId = Number(reservationData.reservedBusinessId ?? input.businessId);
    const originalRunId = String(reservationData.reservedClassificationRunId ?? input.reservation.runId);
    const originalProvider = reservationData.reservedProvider == null
      ? input.reservation.provider
      : String(reservationData.reservedProvider);
    if (originalBusinessId !== input.businessId || originalRunId !== input.reservation.runId ||
        originalProvider !== input.reservation.provider) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_IDENTITY_MISMATCH");
    }
    const storedReservation = {
      ...input.reservation,
      businessId: originalBusinessId,
      runId: originalRunId,
      units: Number(operationBefore.reserved_units),
      amountMicros: nullableReviewedMicros((operationBefore.sfp_result_data as any)?.reservedUnitAmountMicros),
      reviewedUnitPriceMicros: nullableReviewedMicros(operationBefore.unit_price_micros),
      reviewedUnitType: operationBefore.unit_price_unit == null ? null : String(operationBefore.unit_price_unit),
      noResultBillable: reservationNoResultBillable(operationBefore.sfp_result_data),
      workUnit: reservedWorkUnit(operationBefore.sfp_result_data, input.reservation.workUnit),
    };
    if (!Number.isSafeInteger(storedReservation.units) || storedReservation.units < 0) {
      throw new Error("SFP_PROVIDER_STORED_RESERVATION_INVALID");
    }
    const attemptState = rows(await tx.execute(sql`
       SELECT outcome,dispatch_marked_at::text AS dispatch_marked_at FROM provider_attempts
        WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
        FOR UPDATE
    `))[0];
    const dispatchMarkedAt = attemptState?.dispatch_marked_at == null ? null : String(attemptState.dispatch_marked_at);
    if (["completed", "failed", "cancelled"].includes(String(operationBefore.state)) &&
        String(operationBefore.billing_state) !== "reserved") {
      if (dispatchMarkedAt) {
        const fingerprint = makeSfpDispatchReceiptFingerprint({
          reservation: storedReservation,
          businessId: input.businessId,
          dispatchMarkedAt,
          outcome: input.outcome,
          observation: input.observation,
          settledUnits: input.settledUnits ?? storedReservation.units,
          providerUsage: normalizeSfpOperationProviderUsage(input.providerUsage),
          resultData: sanitizePreCohortResultData(input.resultData),
        });
        if (String(operationBefore.sfp_dispatch_receipt_fingerprint ?? "") !== fingerprint) {
          throw new Error("SFP_PROVIDER_DISPATCH_RECEIPT_REPLAY_CONFLICT");
        }
      }
      return {
        settledMicros: operationBefore.settled_cost_micros == null ? null : Number(operationBefore.settled_cost_micros),
        replayed: true,
        currentFenceAtSettlement: false,
        finalizationAllowed: false,
      };
    }
    if (String(operationBefore.state) !== "running" || String(operationBefore.billing_state) !== "reserved" ||
        String(operationBefore.claim_token ?? "") !== input.reservation.claimToken) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    }
    if (dispatchMarkedAt && input.outcome === "not_dispatched") {
      throw new Error("SFP_DISPATCH_MARKED_RECEIPT_CANNOT_BE_NOT_DISPATCHED");
    }
    if (!dispatchMarkedAt && (completed || input.outcome === "ambiguous")) {
      throw new Error("SFP_PROVIDER_RECEIPT_REQUIRES_DISPATCH_MARKER");
    }
    if (!dispatchMarkedAt && !currentFenceAtSettlement) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    const normalizedUsage = normalizeSfpOperationProviderUsage(input.providerUsage);
    const normalizedResultData = sanitizePreCohortResultData(input.resultData);
    const receiptFingerprint = dispatchMarkedAt
      ? makeSfpDispatchReceiptFingerprint({
          reservation: storedReservation,
          businessId: input.businessId,
          dispatchMarkedAt,
          outcome: input.outcome,
          observation: input.observation,
          settledUnits: input.settledUnits ?? storedReservation.units,
          providerUsage: normalizedUsage,
          resultData: normalizedResultData,
        })
      : null;
    const receipt = receiptFingerprint ? {
      schema: "sfp-dispatch-receipt-v1",
      operationId: input.reservation.operationId,
      claimToken: input.reservation.claimToken,
      provider: input.reservation.provider,
      businessId: input.businessId,
      parentRunId: storedReservation.runId,
      cohortRunId: null,
      dispatchMarkedAt,
      providerRequestId: normalizedUsage.providerRequestId,
      outcome: input.outcome,
      observation: input.observation,
      settledUnits: input.settledUnits ?? storedReservation.units,
      providerUsage: normalizedUsage,
      resultData: normalizedResultData,
      fingerprint: receiptFingerprint,
    } : null;
    const dispatchPredicate = dispatchMarkedAt
      ? sql`AND EXISTS (
          SELECT 1 FROM provider_attempts a
           WHERE a.operation_id=provider_operations.id AND a.attempt_number=1
             AND a.dispatch_marked_at::text=${dispatchMarkedAt}
        )`
      : fence ? sfpProviderFinishLeasePredicate(storedReservation, fence) : sql`AND FALSE`;
    const dispatchWasMarked = dispatchMarkedAt !== null;
    const notDispatched = !completed && !dispatchWasMarked &&
      (input.outcome === "failed" || input.outcome === "not_dispatched");
    const billingAmbiguous = !completed && (input.outcome === "ambiguous" || dispatchWasMarked);
    const accounting = calculateSfpOperationSettlementAccounting({
      outcome: input.outcome,
      reservedUnits: storedReservation.units,
      settledUnits: input.settledUnits,
      reviewedUnitPriceMicros: storedReservation.reviewedUnitPriceMicros ?? null,
      reviewedUnitType: storedReservation.reviewedUnitType ?? null,
      noResultBillable: storedReservation.noResultBillable ?? null,
      notDispatched,
      providerUsage: normalizedUsage,
    });
    const settledUnits = accounting.settledUnits;
    const settledMicros = accounting.settledMicros;
    const billingResolved = settledMicros !== null;
    const releaseReservedUnits = notDispatched || completed || billingResolved ? storedReservation.units : 0;
    const releaseReservedCostMicros = exactReservedCostMicros(storedReservation.amountMicros, releaseReservedUnits);
    const operation = rows(await tx.execute(sql`
       UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
               billing_state=${completed || billingResolved ? "committed" : billingAmbiguous ? "ambiguous" : "released"},
              settled_cost_micros=${accounting.settledCostMicros},
               settled_units=${settledUnits},
               provider_request_id=${accounting.providerUsage.providerRequestId},
               provider_usage_quantity=${accounting.providerUsage.quantity}::numeric,
               provider_usage_unit=${accounting.providerUsage.unit},
               provider_usage_status=${accounting.providerUsage.status},
                sfp_result_data=COALESCE(sfp_result_data,'{}'::jsonb) ||
                   ${JSON.stringify(normalizedResultData)}::jsonb,
                sfp_dispatch_receipt=${receipt ? JSON.stringify(receipt) : null}::jsonb,
                sfp_dispatch_receipt_fingerprint=${receiptFingerprint},
              claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
        WHERE id=${input.reservation.operationId}::uuid
          AND state='running' AND billing_state='reserved'
          AND claim_token=${input.reservation.claimToken}::uuid
            ${dispatchPredicate}
      RETURNING id
    `))[0];
    if (!operation) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    const attempt = rows(await tx.execute(sql`
      UPDATE provider_attempts SET outcome=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : input.outcome === "ambiguous" ? "ambiguous" : "retryable_failed"},
             retryable=${!completed},
             safe_http_class=${safeSfpHttpClass(normalizedResultData.httpStatus)},
             error_code=${completed ? null : normalizedResultData.failureCode ?? input.observation},completed_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
         AND completed_at IS NULL
       RETURNING id
    `))[0];
    if (!attempt) throw new Error("SFP_PROVIDER_SETTLEMENT_ATTEMPT_MISSING");
    await tx.execute(sql`
      UPDATE sfp_runtime_job_leases SET revoked_at=NOW(),updated_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid
         AND operation_claim_token=${input.reservation.claimToken}::uuid AND revoked_at IS NULL
    `);
      const control = rows(await tx.execute(sql`
       UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${releaseReservedUnits}),
              consumed_units=consumed_units+${settledUnits},
             last_completed_at=${completed ? sql`NOW()` : sql`last_completed_at`},last_outcome=${input.observation},
              version=version+1,updated_at=NOW()
          WHERE provider=${input.reservation.controlProvider}
        RETURNING provider
      `))[0];
       if (!control) throw new Error("SFP_PROVIDER_SETTLEMENT_CONTROL_MISSING");
    if (currentFenceAtSettlement) {
      await tx.execute(sql`
        INSERT INTO provider_observations(provider,operation_id,attempt_id,subject_type,subject_id,email_token_hash,outcome,retryable)
        VALUES (${input.reservation.controlProvider},${input.reservation.operationId}::uuid,${String(attempt.id)}::uuid,
                'business',${input.businessId},NULL,${input.observation},${!completed})
      `);
    }
      await tx.execute(sql`
       UPDATE sfp_classification_runs
             SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${releaseReservedCostMicros}::bigint),
              settled_cost_micros=settled_cost_micros+${settledMicros ?? 0},
              billing_unknown_count=billing_unknown_count+${settledMicros === null ? 1 : 0},updated_at=NOW()
         WHERE id=${input.reservation.runId}::uuid
      `);
    return { settledMicros, replayed: false, currentFenceAtSettlement, finalizationAllowed: currentFenceAtSettlement };
  };
  return executor ? settle(executor) : db.transaction(settle);
}

/** Side-effect-free Phase-A reservation check; dispatch repeats this under row locks. */
export async function assertCurrentPreCohortSfpProviderReservation(
  reservation: SfpPreCohortProviderReservation,
): Promise<void> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
  const current = rows(await db.execute(sql`
    SELECT o.id
      FROM provider_operations o
      JOIN provider_controls pc ON pc.provider=o.provider
      JOIN sfp_runtime_owner_authority a ON a.authority_key='routine_sfp'
      JOIN sfp_runtime_release_selectors rs
        ON rs.authority_key=a.authority_key
       AND rs.deployment_identity=a.deployment_identity
       AND rs.environment_identity=a.environment_identity
       AND rs.artifact_sha=a.artifact_sha
       AND rs.queue_topology_hash=a.queue_topology_hash
      JOIN sfp_runtime_job_leases j ON j.operation_id=o.id
      JOIN sfp_classification_runs r ON o.idempotency_key LIKE '%' || ':run:' || r.id::text
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN sfp_classification_items i ON i.run_id=r.id
        AND i.business_id=split_part(o.target_fingerprint,':',2)::integer
     WHERE o.id=${reservation.operationId}::uuid
       AND o.claim_token=${reservation.claimToken}::uuid
       AND o.state='running' AND o.lease_expires_at>clock_timestamp()
       AND o.cancel_requested_at IS NULL
       AND pc.enabled=TRUE AND pc.circuit_state='closed'
       AND a.deployment_identity=${fence.deploymentIdentity}
       AND a.environment_identity=${fence.environmentIdentity}
       AND a.artifact_sha=${fence.artifactSha}
       AND a.queue_topology_hash=${fence.queueTopologyHash}
       AND a.owner_epoch=${reservation.runtimeOwnerEpoch}
       AND a.owner_token=${reservation.runtimeOwnerToken}::uuid
       AND a.lease_expires_at>clock_timestamp() AND a.revoked_at IS NULL
       AND j.process_identity=${fence.processIdentity}
       AND j.owner_epoch=${reservation.runtimeOwnerEpoch}
       AND j.owner_token=${reservation.runtimeOwnerToken}::uuid
       AND j.operation_claim_token=${reservation.claimToken}::uuid
       AND j.lease_expires_at>clock_timestamp() AND j.revoked_at IS NULL
       AND r.id=${reservation.runId}::uuid AND r.state='running' AND r.lease_expires_at>clock_timestamp()
        AND p.is_active=TRUE
       AND i.state='running' AND i.lease_expires_at>clock_timestamp()
  `))[0];
  if (!current) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/** Final fenced invocation used by provider paths and transport-spy certification. */
export async function invokePreCohortSfpProviderTransport<T>(
  reservation: SfpPreCohortProviderReservation,
  transport: () => Promise<T>,
): Promise<T> {
  await markSfpProviderOperationDispatchBoundary(reservation);
  return transport();
}

/**
 * Atomically validate current deployment ownership, operation/stage leases,
 * cancellation, provider/program/cohort state and claim tokens before writing
 * the durable dispatch marker. Once this commits, lost transport outcomes are
 * retained for reconciliation and never released as unused.
 */
async function markSfpProviderOperationDispatchBoundary(
  reservation: RuntimeSfpProviderReservation,
  beforeDispatch?: SfpProviderBeforeDispatch,
): Promise<void> {
  if (reservation.provider === "zerobounce" && (!("stageRunId" in reservation) || !beforeDispatch)) {
    throw new Error("SFP_PROVIDER_DISPATCH_PINS_REQUIRED");
  }
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PROVIDER_DISPATCH_BOUNDARY_LOST");
  await db.transaction(async (tx) => {
    await renewSfpRuntimeOwnerLease(tx, reservation, fence);
    if ("stageRunId" in reservation && beforeDispatch) {
      await beforeDispatch(tx, reservation);
    }
    await acquireLadderBudgetLock(tx);
    await renewSfpRuntimeJobLease(tx, reservation, fence);
    if ("stageRunId" in reservation) {
      const allowed = rows(await tx.execute(sql`
        SELECT o.id
          FROM provider_operations o
          JOIN provider_controls pc ON pc.provider=o.provider
          JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
          JOIN sfp_runtime_owner_authority oa ON oa.authority_key='routine_sfp'
          JOIN sfp_runtime_job_leases jl ON jl.operation_id=o.id
          JOIN sfp_stage_items i ON i.provider_operation_id=o.id
          JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
          JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
          JOIN sfp_programs p ON p.id=cr.program_id
           JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
         WHERE o.id=${reservation.operationId}::uuid
           AND o.claim_token=${reservation.claimToken}::uuid
           AND o.state='running' AND o.billing_state='reserved'
            AND o.lease_expires_at>clock_timestamp() AND o.cancel_requested_at IS NULL
           AND pc.provider=${reservation.controlProvider}
           AND pc.enabled=TRUE AND pc.circuit_state='closed'
           AND a.outcome='pending' AND a.completed_at IS NULL
           AND oa.deployment_identity=${fence.deploymentIdentity}
           AND oa.environment_identity=${fence.environmentIdentity}
           AND oa.artifact_sha=${fence.artifactSha}
           AND oa.queue_topology_hash=${fence.queueTopologyHash}
           AND oa.owner_epoch=${reservation.runtimeOwnerEpoch}
           AND oa.owner_token=${reservation.runtimeOwnerToken}::uuid
            AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
           AND jl.deployment_identity=${fence.deploymentIdentity}
           AND jl.environment_identity=${fence.environmentIdentity}
           AND jl.artifact_sha=${fence.artifactSha}
           AND jl.process_identity=${fence.processIdentity}
           AND jl.owner_epoch=${reservation.runtimeOwnerEpoch}
           AND jl.owner_token=${reservation.runtimeOwnerToken}::uuid
           AND jl.operation_claim_token=${reservation.claimToken}::uuid
            AND jl.lease_expires_at>clock_timestamp() AND jl.revoked_at IS NULL
           AND i.state='claimed' AND i.claim_token=${reservation.claimToken}::uuid
            AND i.lease_expires_at>clock_timestamp()
            AND sr.id=${reservation.stageRunId}::uuid
            AND sr.state='running' AND sr.lease_expires_at>clock_timestamp()
           AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
           AND p.is_active=TRUE
           FOR UPDATE OF o,a,jl,i,sr
           FOR SHARE OF pc,oa,cr,p,m
      `))[0];
      if (!allowed) throw new Error("SFP_PROVIDER_DISPATCH_BOUNDARY_LOST");
      const stageItem = rows(await tx.execute(sql`
         UPDATE sfp_stage_items SET lease_expires_at=clock_timestamp()+INTERVAL '5 minutes',
                                    updated_at=clock_timestamp()
         WHERE provider_operation_id=${reservation.operationId}::uuid
           AND claim_token=${reservation.claimToken}::uuid AND state='claimed'
            AND lease_expires_at>clock_timestamp()
         RETURNING id
      `))[0];
      if (!stageItem) throw new Error("SFP_PROVIDER_STAGE_LEASE_FENCE_LOST");
    } else {
      const allowed = rows(await tx.execute(sql`
        SELECT o.id
          FROM provider_operations o
          JOIN provider_controls pc ON pc.provider=o.provider
          JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
          JOIN sfp_runtime_owner_authority oa ON oa.authority_key='routine_sfp'
          JOIN sfp_runtime_job_leases jl ON jl.operation_id=o.id
          JOIN sfp_classification_runs r ON o.idempotency_key LIKE '%' || ':run:' || r.id::text
          JOIN sfp_programs p ON p.id=r.program_id
          JOIN sfp_classification_items i ON i.run_id=r.id
            AND i.business_id=split_part(o.target_fingerprint,':',2)::integer
         WHERE o.id=${reservation.operationId}::uuid
           AND o.claim_token=${reservation.claimToken}::uuid
           AND o.state='running' AND o.billing_state='reserved'
            AND o.lease_expires_at>clock_timestamp() AND o.cancel_requested_at IS NULL
           AND pc.provider=${reservation.controlProvider}
           AND pc.enabled=TRUE AND pc.circuit_state='closed'
           AND a.outcome='pending' AND a.completed_at IS NULL
           AND oa.deployment_identity=${fence.deploymentIdentity}
           AND oa.environment_identity=${fence.environmentIdentity}
           AND oa.artifact_sha=${fence.artifactSha}
           AND oa.queue_topology_hash=${fence.queueTopologyHash}
           AND oa.owner_epoch=${reservation.runtimeOwnerEpoch}
           AND oa.owner_token=${reservation.runtimeOwnerToken}::uuid
            AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
           AND jl.deployment_identity=${fence.deploymentIdentity}
           AND jl.environment_identity=${fence.environmentIdentity}
           AND jl.artifact_sha=${fence.artifactSha}
           AND jl.process_identity=${fence.processIdentity}
           AND jl.owner_epoch=${reservation.runtimeOwnerEpoch}
           AND jl.owner_token=${reservation.runtimeOwnerToken}::uuid
           AND jl.operation_claim_token=${reservation.claimToken}::uuid
            AND jl.lease_expires_at>clock_timestamp() AND jl.revoked_at IS NULL
            AND r.id=${reservation.runId}::uuid AND r.state='running' AND r.lease_expires_at>clock_timestamp()
           AND p.is_active=TRUE
            AND i.state='running' AND i.lease_expires_at>clock_timestamp()
          FOR UPDATE OF o,a,jl,r,i
          FOR SHARE OF pc,oa,p
      `))[0];
      if (!allowed) throw new Error("SFP_PROVIDER_DISPATCH_BOUNDARY_LOST");
      const itemLease = rows(await tx.execute(sql`
         UPDATE sfp_classification_items SET lease_expires_at=clock_timestamp()+INTERVAL '5 minutes',
                                             updated_at=clock_timestamp()
         WHERE run_id=${reservation.runId}::uuid
           AND business_id=split_part((SELECT target_fingerprint FROM provider_operations
             WHERE id=${reservation.operationId}::uuid),':',2)::integer
            AND state='running' AND lease_expires_at>clock_timestamp()
         RETURNING id
      `))[0];
      if (!itemLease) throw new Error("SFP_PROVIDER_STAGE_LEASE_FENCE_LOST");
    }
    const marked = "stageRunId" in reservation
      ? rows(await tx.execute(sql`
          UPDATE provider_attempts
             SET outcome='ambiguous',dispatch_marked_at=clock_timestamp()
           WHERE operation_id=${reservation.operationId}::uuid
             AND attempt_number=1 AND outcome='pending' AND completed_at IS NULL
             AND EXISTS (
               SELECT 1
                 FROM provider_operations o
                 JOIN provider_controls pc ON pc.provider=o.provider
                 JOIN sfp_runtime_owner_authority oa ON oa.authority_key='routine_sfp'
                 JOIN sfp_runtime_release_selectors rs
                   ON rs.authority_key=oa.authority_key
                  AND rs.deployment_identity=oa.deployment_identity
                  AND rs.environment_identity=oa.environment_identity
                  AND rs.artifact_sha=oa.artifact_sha
                  AND rs.queue_topology_hash=oa.queue_topology_hash
                 JOIN sfp_runtime_job_leases jl ON jl.operation_id=o.id
                 JOIN sfp_stage_items i ON i.provider_operation_id=o.id
                 JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
                 JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
                 JOIN sfp_programs p ON p.id=cr.program_id
                 JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=i.business_id
                WHERE o.id=provider_attempts.operation_id
                  AND o.id=${reservation.operationId}::uuid
                  AND o.claim_token=${reservation.claimToken}::uuid
                  AND o.state='running' AND o.billing_state='reserved'
                  AND o.cancel_requested_at IS NULL AND o.lease_expires_at>clock_timestamp()
                  AND pc.provider=${reservation.controlProvider}
                  AND pc.enabled=TRUE AND pc.circuit_state='closed'
                  AND oa.deployment_identity=${fence.deploymentIdentity}
                  AND oa.environment_identity=${fence.environmentIdentity}
                  AND oa.artifact_sha=${fence.artifactSha}
                  AND oa.queue_topology_hash=${fence.queueTopologyHash}
                  AND oa.owner_epoch=${reservation.runtimeOwnerEpoch}
                  AND oa.owner_token=${reservation.runtimeOwnerToken}::uuid
                  AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
                  AND jl.deployment_identity=${fence.deploymentIdentity}
                  AND jl.environment_identity=${fence.environmentIdentity}
                  AND jl.artifact_sha=${fence.artifactSha}
                  AND jl.process_identity=${fence.processIdentity}
                  AND jl.owner_epoch=${reservation.runtimeOwnerEpoch}
                  AND jl.owner_token=${reservation.runtimeOwnerToken}::uuid
                  AND jl.operation_claim_token=${reservation.claimToken}::uuid
                  AND jl.lease_expires_at>clock_timestamp() AND jl.revoked_at IS NULL
                  AND i.state='claimed' AND i.claim_token=${reservation.claimToken}::uuid
                  AND i.lease_expires_at>clock_timestamp()
                   AND sr.id=${reservation.stageRunId}::uuid
                   AND sr.state='running' AND sr.lease_expires_at>clock_timestamp()
                  AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
                  AND p.is_active=TRUE
                  AND m.business_id=i.business_id
             )
          RETURNING id
        `))[0]
      : rows(await tx.execute(sql`
          UPDATE provider_attempts
             SET outcome='ambiguous',dispatch_marked_at=clock_timestamp()
           WHERE operation_id=${reservation.operationId}::uuid
             AND attempt_number=1 AND outcome='pending' AND completed_at IS NULL
             AND EXISTS (
               SELECT 1
                 FROM provider_operations o
                 JOIN provider_controls pc ON pc.provider=o.provider
                 JOIN sfp_runtime_owner_authority oa ON oa.authority_key='routine_sfp'
                 JOIN sfp_runtime_release_selectors rs
                   ON rs.authority_key=oa.authority_key
                  AND rs.deployment_identity=oa.deployment_identity
                  AND rs.environment_identity=oa.environment_identity
                  AND rs.artifact_sha=oa.artifact_sha
                  AND rs.queue_topology_hash=oa.queue_topology_hash
                 JOIN sfp_runtime_job_leases jl ON jl.operation_id=o.id
                 JOIN sfp_classification_runs r
                   ON o.idempotency_key LIKE '%' || ':run:' || r.id::text
                 JOIN sfp_programs p ON p.id=r.program_id
                 JOIN sfp_classification_items i ON i.run_id=r.id
                   AND i.business_id=split_part(o.target_fingerprint,':',2)::integer
                WHERE o.id=provider_attempts.operation_id
                  AND o.id=${reservation.operationId}::uuid
                  AND o.claim_token=${reservation.claimToken}::uuid
                  AND o.state='running' AND o.billing_state='reserved'
                  AND o.cancel_requested_at IS NULL AND o.lease_expires_at>clock_timestamp()
                  AND pc.provider=${reservation.controlProvider}
                  AND pc.enabled=TRUE AND pc.circuit_state='closed'
                  AND oa.deployment_identity=${fence.deploymentIdentity}
                  AND oa.environment_identity=${fence.environmentIdentity}
                  AND oa.artifact_sha=${fence.artifactSha}
                  AND oa.queue_topology_hash=${fence.queueTopologyHash}
                  AND oa.owner_epoch=${reservation.runtimeOwnerEpoch}
                  AND oa.owner_token=${reservation.runtimeOwnerToken}::uuid
                  AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
                  AND jl.deployment_identity=${fence.deploymentIdentity}
                  AND jl.environment_identity=${fence.environmentIdentity}
                  AND jl.artifact_sha=${fence.artifactSha}
                  AND jl.process_identity=${fence.processIdentity}
                  AND jl.owner_epoch=${reservation.runtimeOwnerEpoch}
                  AND jl.owner_token=${reservation.runtimeOwnerToken}::uuid
                  AND jl.operation_claim_token=${reservation.claimToken}::uuid
                  AND jl.lease_expires_at>clock_timestamp() AND jl.revoked_at IS NULL
                  AND r.id=${reservation.runId}::uuid AND r.state='running'
                  AND r.lease_expires_at>clock_timestamp()
                  AND p.is_active=TRUE
                  AND i.state='running' AND i.lease_expires_at>clock_timestamp()
             )
          RETURNING id
        `))[0];
    if (!marked) throw new Error("SFP_PROVIDER_DISPATCH_BOUNDARY_LOST");
  });
}

export async function assertCurrentSfpProviderReservation(reservation: SfpProviderReservation): Promise<void> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
  const current = rows(await db.execute(sql`
    SELECT o.id FROM provider_operations o
      JOIN provider_controls pc ON pc.provider=o.provider
      JOIN sfp_runtime_owner_authority a ON a.authority_key='routine_sfp'
      JOIN sfp_runtime_release_selectors rs
        ON rs.authority_key=a.authority_key
       AND rs.deployment_identity=a.deployment_identity
       AND rs.environment_identity=a.environment_identity
       AND rs.artifact_sha=a.artifact_sha
       AND rs.queue_topology_hash=a.queue_topology_hash
      JOIN sfp_runtime_job_leases j ON j.operation_id=o.id
      JOIN sfp_stage_items i ON i.provider_operation_id=o.id
      JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
      JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
      JOIN sfp_programs p ON p.id=cr.program_id
     WHERE o.id=${reservation.operationId}::uuid AND o.claim_token=${reservation.claimToken}::uuid
        AND o.state='running' AND o.lease_expires_at>clock_timestamp() AND o.cancel_requested_at IS NULL
       AND pc.enabled=TRUE AND pc.circuit_state='closed'
        AND i.state='claimed' AND i.lease_expires_at>clock_timestamp()
         AND sr.state='running' AND sr.lease_expires_at>clock_timestamp()
        AND p.is_active=TRUE AND cr.cohort_state='frozen'
        AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
        AND a.deployment_identity=${fence.deploymentIdentity}
        AND a.environment_identity=${fence.environmentIdentity}
        AND a.artifact_sha=${fence.artifactSha}
        AND a.queue_topology_hash=${fence.queueTopologyHash}
        AND a.owner_epoch=${reservation.runtimeOwnerEpoch}
        AND a.owner_token=${reservation.runtimeOwnerToken}::uuid
        AND a.lease_expires_at>clock_timestamp() AND a.revoked_at IS NULL
        AND j.process_identity=${fence.processIdentity}
        AND j.owner_epoch=${reservation.runtimeOwnerEpoch}
        AND j.owner_token=${reservation.runtimeOwnerToken}::uuid
        AND j.operation_claim_token=${reservation.claimToken}::uuid
        AND j.lease_expires_at>clock_timestamp() AND j.revoked_at IS NULL
  `))[0];
  if (!current) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/**
 * Current lease/program/cohort guard for stage promotion that has no paid
 * reservation (notably validation freshness reuse). Pass the caller's
 * transaction to retain row locks through its eligibility writes.
 */
export async function assertCurrentSfpStageFinalization(
  input: SfpStageFinalizationInput,
  executor?: SqlExecutor,
): Promise<void> {
  const fence = await getCurrentRoutineSfpRuntimeFence();
  if (!fence) throw new Error("SFP_STAGE_FINALIZATION_FENCE_LOST");
  const assert = async (tx: SqlExecutor) => {
    const owner = await lockCurrentSfpRuntimeOwner(tx);
    await lockCurrentSfpOutreachPolicy(tx);
    if (input.sourceContactId) {
      const graphNodes = [
        { type: "contact" as const, id: input.sourceContactId },
        { type: "business" as const, id: input.businessId },
      ];
      await lockCommercialGraphNodes(tx, graphNodes);
      await lockCommercialGraphMembershipSets(tx, graphNodes, ["contact_business"]);
    }
    await lockSfpBusinessSafetySentinel(tx, input.businessId);
    const locked = rows(await tx.execute(sql`
      SELECT sr.id AS stage_run_id,i.id AS stage_item_id,cr.id AS cohort_run_id,
             m.id AS member_id,p.id AS program_id
        FROM sfp_stage_runs sr
        JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
        JOIN sfp_programs p ON p.id=cr.program_id
        JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=${input.businessId}
        JOIN sfp_stage_items i ON i.stage_run_id=sr.id AND i.business_id=${input.businessId}
       WHERE sr.id=${input.stageRunId}::uuid AND sr.cohort_run_id=${input.cohortRunId}::uuid
         AND sr.stage='validation' AND sr.state='running'
         AND sr.claim_token=${input.stageClaimToken}::uuid
         AND i.provider='zerobounce' AND i.state='claimed'
         AND i.redacted_result->>'candidateClaimKey'=${input.candidateClaimKey}
         AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
         AND p.is_active=TRUE
       FOR UPDATE OF sr,i
       FOR SHARE OF cr,p,m
    `))[0];
    if (!locked) throw new Error("SFP_STAGE_FINALIZATION_FENCE_LOST");
    // This second check is deliberately after all blocking row locks.
    const live = rows(await tx.execute(sql`
      SELECT 1
        FROM sfp_runtime_owner_authority oa
        JOIN sfp_runtime_release_selectors rs
          ON rs.authority_key=oa.authority_key
         AND rs.deployment_identity=oa.deployment_identity
         AND rs.environment_identity=oa.environment_identity
         AND rs.artifact_sha=oa.artifact_sha
         AND rs.queue_topology_hash=oa.queue_topology_hash
        JOIN sfp_stage_runs sr ON sr.id=${input.stageRunId}::uuid
        JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
        JOIN sfp_programs p ON p.id=cr.program_id
        JOIN sfp_cohort_members m ON m.cohort_run_id=cr.id AND m.business_id=${input.businessId}
        JOIN sfp_stage_items i ON i.stage_run_id=sr.id AND i.business_id=${input.businessId}
       WHERE oa.authority_key='routine_sfp'
         AND oa.deployment_identity=${fence.deploymentIdentity}
         AND oa.environment_identity=${fence.environmentIdentity}
         AND oa.artifact_sha=${fence.artifactSha}
         AND oa.queue_topology_hash=${fence.queueTopologyHash}
         AND oa.owner_epoch=${owner.ownerEpoch} AND oa.owner_token=${owner.ownerToken}::uuid
         AND oa.lease_expires_at>clock_timestamp() AND oa.revoked_at IS NULL
         AND rs.deployment_identity=${fence.deploymentIdentity}
         AND rs.environment_identity=${fence.environmentIdentity}
         AND rs.artifact_sha=${fence.artifactSha}
         AND rs.queue_topology_hash=${fence.queueTopologyHash}
         AND sr.cohort_run_id=${input.cohortRunId}::uuid AND sr.stage='validation'
         AND sr.state='running' AND sr.claim_token=${input.stageClaimToken}::uuid
         AND sr.lease_expires_at>clock_timestamp()
         AND cr.cohort_state='frozen' AND cr.voided_at IS NULL AND cr.superseded_at IS NULL
         AND p.is_active=TRUE
         AND m.id=${String(locked.member_id)}::uuid
         AND i.id=${String(locked.stage_item_id)}::uuid AND i.provider='zerobounce'
         AND i.state='claimed' AND i.lease_expires_at>clock_timestamp()
         AND i.redacted_result->>'candidateClaimKey'=${input.candidateClaimKey}
    `))[0];
    if (!live) throw new Error("SFP_STAGE_FINALIZATION_FENCE_LOST");
  };
  if (executor) return assert(executor);
  return db.transaction(assert);
}

/** Final fenced invocation used by cohort-bound paid provider paths. */
export async function invokeSfpProviderTransport<T>(
  reservation: SfpProviderReservation,
  transport: () => Promise<T>,
  beforeDispatch?: SfpProviderBeforeDispatch,
): Promise<T> {
  // Routine ZeroBounce validation requires domain-specific source/address/link/
  // policy pins inside the same marker transaction. Fail held if its worker
  // has not yet wired the hook; a prior separate preflight is not authority.
  if (reservation.provider === "zerobounce" && !beforeDispatch) {
    throw new Error("SFP_PROVIDER_DISPATCH_PINS_REQUIRED");
  }
  await markSfpProviderOperationDispatchBoundary(reservation, beforeDispatch);
  return transport();
}

export async function settleSfpProviderOperation(input: {
  reservation: SfpProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  emailTokenHash?: string | null;
  settledUnits?: number;
  providerUsage?: SfpProviderUsageSettlement;
  resultData?: unknown;
}, executor?: SqlExecutor): Promise<{ settledMicros: number | null; replayed: boolean; currentFenceAtSettlement: boolean; finalizationAllowed: boolean }> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const fence = await getCurrentRoutineSfpRuntimeFence();
  const settle = async (tx: { execute: (query: any) => Promise<any> }) => {
    const currentFenceAtSettlement = await currentSfpProviderPromotionPermission(tx, input.reservation, fence);
    await acquireLadderBudgetLock(tx);
    const operationBefore = rows(await tx.execute(sql`
      SELECT provider,target_fingerprint,state,billing_state,claim_token,reserved_units,
             unit_price_micros,unit_price_unit,settled_cost_micros,
             sfp_dispatch_receipt_fingerprint,sfp_result_data
        FROM provider_operations
       WHERE id=${input.reservation.operationId}::uuid
       FOR UPDATE
    `))[0];
    if (!operationBefore) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    if (String(operationBefore.provider) !== input.reservation.controlProvider ||
        String(operationBefore.target_fingerprint) !== `business:${input.businessId}`) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_IDENTITY_MISMATCH");
    }
    const reservationData = operationBefore.sfp_result_data && typeof operationBefore.sfp_result_data === "object"
      ? operationBefore.sfp_result_data as Record<string, unknown>
      : {};
    const originalBusinessId = Number(reservationData.reservedBusinessId ?? input.businessId);
    const originalStageRunId = String(reservationData.reservedStageRunId ?? input.reservation.stageRunId);
    const originalCohortRunId = String(reservationData.reservedCohortRunId ?? input.reservation.cohortRunId ?? "");
    const originalProvider = reservationData.reservedProvider == null
      ? input.reservation.provider
      : String(reservationData.reservedProvider);
    if (originalBusinessId !== input.businessId || originalStageRunId !== input.reservation.stageRunId ||
        (input.reservation.cohortRunId && originalCohortRunId !== input.reservation.cohortRunId) ||
        originalProvider !== input.reservation.provider) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_IDENTITY_MISMATCH");
    }
    const storedReservation = {
      ...input.reservation,
      businessId: originalBusinessId,
      stageRunId: originalStageRunId,
      cohortRunId: originalCohortRunId || undefined,
      units: Number(operationBefore.reserved_units),
      amountMicros: nullableReviewedMicros((operationBefore.sfp_result_data as any)?.reservedUnitAmountMicros),
      reviewedUnitPriceMicros: nullableReviewedMicros(operationBefore.unit_price_micros),
      reviewedUnitType: operationBefore.unit_price_unit == null ? null : String(operationBefore.unit_price_unit),
      noResultBillable: reservationNoResultBillable(operationBefore.sfp_result_data),
      workUnit: reservedWorkUnit(operationBefore.sfp_result_data, input.reservation.workUnit),
    };
    if (!Number.isSafeInteger(storedReservation.units) || storedReservation.units < 0) {
      throw new Error("SFP_PROVIDER_STORED_RESERVATION_INVALID");
    }
    const attemptState = rows(await tx.execute(sql`
       SELECT outcome,dispatch_marked_at::text AS dispatch_marked_at FROM provider_attempts
        WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
        FOR UPDATE
    `))[0];
    const dispatchMarkedAt = attemptState?.dispatch_marked_at == null ? null : String(attemptState.dispatch_marked_at);
    if (["completed", "failed", "cancelled"].includes(String(operationBefore.state)) &&
        String(operationBefore.billing_state) !== "reserved") {
      if (dispatchMarkedAt) {
        const fingerprint = makeSfpDispatchReceiptFingerprint({
          reservation: storedReservation,
          businessId: input.businessId,
          dispatchMarkedAt,
          outcome: input.outcome,
          observation: input.observation,
          settledUnits: input.settledUnits ?? storedReservation.units,
          providerUsage: normalizeSfpOperationProviderUsage(input.providerUsage),
          resultData: sanitizeProviderResultData(input.resultData) as Record<string, unknown>,
        });
        if (String(operationBefore.sfp_dispatch_receipt_fingerprint ?? "") !== fingerprint) {
          throw new Error("SFP_PROVIDER_DISPATCH_RECEIPT_REPLAY_CONFLICT");
        }
      }
      return {
        settledMicros: operationBefore.settled_cost_micros == null ? null : Number(operationBefore.settled_cost_micros),
        replayed: true,
        currentFenceAtSettlement: false,
        finalizationAllowed: false,
      };
    }
    if (String(operationBefore.state) !== "running" || String(operationBefore.billing_state) !== "reserved" ||
        String(operationBefore.claim_token ?? "") !== input.reservation.claimToken) {
      throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    }
    if (dispatchMarkedAt && input.outcome === "not_dispatched") {
      throw new Error("SFP_DISPATCH_MARKED_RECEIPT_CANNOT_BE_NOT_DISPATCHED");
    }
    if (!dispatchMarkedAt && (completed || input.outcome === "ambiguous")) {
      throw new Error("SFP_PROVIDER_RECEIPT_REQUIRES_DISPATCH_MARKER");
    }
    if (!dispatchMarkedAt && !currentFenceAtSettlement) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    const normalizedUsage = normalizeSfpOperationProviderUsage(input.providerUsage);
    const normalizedResultData = sanitizeProviderResultData(input.resultData);
    const receiptFingerprint = dispatchMarkedAt
      ? makeSfpDispatchReceiptFingerprint({
          reservation: storedReservation,
          businessId: input.businessId,
          dispatchMarkedAt,
          outcome: input.outcome,
          observation: input.observation,
          settledUnits: input.settledUnits ?? storedReservation.units,
          providerUsage: normalizedUsage,
          resultData: normalizedResultData as Record<string, unknown>,
        })
      : null;
    const receipt = receiptFingerprint ? {
      schema: "sfp-dispatch-receipt-v1",
      operationId: input.reservation.operationId,
      claimToken: input.reservation.claimToken,
      provider: input.reservation.provider,
      businessId: input.businessId,
      parentRunId: storedReservation.stageRunId,
      cohortRunId: storedReservation.cohortRunId ?? null,
      dispatchMarkedAt,
      providerRequestId: normalizedUsage.providerRequestId,
      outcome: input.outcome,
      observation: input.observation,
      settledUnits: input.settledUnits ?? storedReservation.units,
      providerUsage: normalizedUsage,
      resultData: normalizedResultData,
      fingerprint: receiptFingerprint,
    } : null;
    const dispatchPredicate = dispatchMarkedAt
      ? sql`AND EXISTS (
          SELECT 1 FROM provider_attempts a
           WHERE a.operation_id=provider_operations.id AND a.attempt_number=1
             AND a.dispatch_marked_at::text=${dispatchMarkedAt}
        )`
      : fence ? sfpProviderFinishLeasePredicate(storedReservation, fence) : sql`AND FALSE`;
    const dispatchWasMarked = dispatchMarkedAt !== null;
    const notDispatched = !completed && !dispatchWasMarked &&
      (input.outcome === "failed" || input.outcome === "not_dispatched");
    const billingAmbiguous = !completed && (input.outcome === "ambiguous" || dispatchWasMarked);
    const accounting = calculateSfpOperationSettlementAccounting({
      outcome: input.outcome,
      reservedUnits: storedReservation.units,
      settledUnits: input.settledUnits,
      reviewedUnitPriceMicros: storedReservation.reviewedUnitPriceMicros ?? null,
      reviewedUnitType: storedReservation.reviewedUnitType ?? null,
      noResultBillable: storedReservation.noResultBillable ?? null,
      notDispatched,
      providerUsage: normalizedUsage,
    });
    const settledUnits = accounting.settledUnits;
    const settledMicros = accounting.settledMicros;
    const billingResolved = settledMicros !== null;
    const releaseReservedUnits = notDispatched || completed || billingResolved ? storedReservation.units : 0;
    const releaseReservedCostMicros = exactReservedCostMicros(storedReservation.amountMicros, releaseReservedUnits);
    const operation = rows(await tx.execute(sql`
      UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
              billing_state=${completed || billingResolved ? "committed" : billingAmbiguous ? "ambiguous" : "released"},
              settled_cost_micros=${accounting.settledCostMicros},
               settled_units=${settledUnits},
               provider_request_id=${accounting.providerUsage.providerRequestId},
               provider_usage_quantity=${accounting.providerUsage.quantity}::numeric,
               provider_usage_unit=${accounting.providerUsage.unit},
               provider_usage_status=${accounting.providerUsage.status},
               sfp_result_data=COALESCE(sfp_result_data,'{}'::jsonb) ||
                  ${JSON.stringify(normalizedResultData)}::jsonb,
               sfp_dispatch_receipt=${receipt ? JSON.stringify(receipt) : null}::jsonb,
               sfp_dispatch_receipt_fingerprint=${receiptFingerprint},
              claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
       WHERE id=${input.reservation.operationId}::uuid
         AND state='running' AND billing_state='reserved'
         AND claim_token=${input.reservation.claimToken}::uuid
           ${dispatchPredicate}
      RETURNING id
    `))[0];
    if (!operation) throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    const attempt = rows(await tx.execute(sql`
      UPDATE provider_attempts SET outcome=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : input.outcome === "ambiguous" ? "ambiguous" : "retryable_failed"},
             retryable=${!completed},
             safe_http_class=${safeSfpHttpClass(normalizedResultData.httpStatus)},
             error_code=${completed ? null : normalizedResultData.failureCode ?? input.observation},completed_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
         AND completed_at IS NULL
       RETURNING id
    `))[0];
    if (!attempt) throw new Error("SFP_PROVIDER_SETTLEMENT_ATTEMPT_MISSING");
    await tx.execute(sql`
      UPDATE sfp_runtime_job_leases SET revoked_at=NOW(),updated_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid
         AND operation_claim_token=${input.reservation.claimToken}::uuid AND revoked_at IS NULL
    `);
      const control = rows(await tx.execute(sql`
         UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${releaseReservedUnits}),
              consumed_units=consumed_units+${settledUnits},
             last_completed_at=${completed ? sql`NOW()` : sql`last_completed_at`},last_outcome=${input.observation},
              version=version+1,updated_at=NOW()
          WHERE provider=${input.reservation.controlProvider}
        RETURNING provider
       `))[0];
       if (!control) throw new Error("SFP_PROVIDER_SETTLEMENT_CONTROL_MISSING");
    if (currentFenceAtSettlement) {
      await tx.execute(sql`
        INSERT INTO provider_observations(provider,operation_id,attempt_id,subject_type,subject_id,email_token_hash,outcome,retryable)
        VALUES (${input.reservation.controlProvider},${input.reservation.operationId}::uuid,${String(attempt.id)}::uuid,
                'business',${input.businessId},${input.emailTokenHash ?? null},${input.observation},${!completed})
      `);
    }
     await tx.execute(sql`
        UPDATE sfp_stage_runs SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${releaseReservedCostMicros}::bigint),
              settled_cost_micros=settled_cost_micros+${settledMicros ?? 0},
              billing_unknown_count=billing_unknown_count+${settledMicros === null ? 1 : 0},
               updated_at=NOW()
         WHERE id=${input.reservation.stageRunId}::uuid
     `);
    return { settledMicros, replayed: false, currentFenceAtSettlement, finalizationAllowed: currentFenceAtSettlement };
  };
  return executor ? settle(executor) : db.transaction(settle);
}

/**
 * Persists an immutable dispatch receipt/accounting row even after lease drift.
 * `currentFenceAtSettlement` (and the compatibility `finalizationAllowed`
 * alias) is only a status hint; eligibility promotion must independently call
 * assertCurrentSfpStageFinalization in its write transaction.
 */
export async function finishSfpProviderOperation(
  input: SfpProviderFinishInput,
  executor?: SqlExecutor,
): Promise<{ settledMicros: number | null; replayed: boolean; currentFenceAtSettlement: boolean; finalizationAllowed: boolean }> {
  const workUnit = normalizeSfpWorkUnit(input.workUnit);
  if (workUnit !== input.reservation.workUnit) throw new Error("SFP_PROVIDER_WORK_UNIT_MISMATCH");
  const workCompleted = "workCompleted" in input
    ? input.workCompleted
    : input.billing.workCompleted;
  if (typeof workCompleted !== "number" || !Number.isSafeInteger(workCompleted) || workCompleted < 0) {
    throw new Error("SFP_PROVIDER_WORK_COMPLETED_INVALID");
  }
  const usage = "providerUsage" in input
    ? normalizeSfpOperationProviderUsage(input.providerUsage)
    : billingUsageFromFinish(input.billing);
  const rawResultData = {
    ...input.resultData,
    providerReference: usage.providerRequestId ?? input.resultData?.providerReference,
  };
  const resultData = "runId" in input.reservation
    ? sanitizePreCohortResultData(rawResultData)
    : sanitizeProviderResultData(rawResultData);
  const sharedSettlement = {
    outcome: input.outcome,
    observation: input.observation,
    businessId: input.businessId,
    emailTokenHash: input.emailTokenHash,
    settledUnits: workCompleted,
    providerUsage: usage,
    resultData: resultData as SfpSanitizedProviderResult,
  };
  return "stageRunId" in input.reservation
    ? settleSfpProviderOperation({ ...sharedSettlement, reservation: input.reservation }, executor)
    : settlePreCohortSfpProviderOperation({ ...sharedSettlement, reservation: input.reservation }, executor);
}

/**
 * Reconcile a provider's later billing result against its stable economic
 * request ID. Duplicate polling is idempotent; contradictory known values
 * become explicit conflict rather than last-write-wins settlement.
 */
export async function reconcileSfpProviderUsage(input: {
  provider: SfpPaidProvider;
  /** Generic exact receipt, reconciled independently by providerRequestId. */
  providerUsage?: SfpProviderUsageInput;
  /** Work-unit semantics of the reserved operation, distinct from billing unit. */
  workUnit: string;
  /** Credits-only compatibility fields for callers that cannot yet use providerUsage. */
  providerReference?: string;
  billedCredits?: string | null;
  billingStatus?: SfpProviderBillingStatus;
  reconciliationSource?: string | null;
  resultHash?: string | null;
}): Promise<{ operationId: string; status: SfpProviderUsageStatus; settledCostMicros: number | null; replayed: boolean }> {
  const workUnit = normalizeSfpWorkUnit(input.workUnit);
  const incomingRaw = input.providerUsage
    ? normalizeSfpOperationProviderUsage(input.providerUsage)
    : billingUsageFromFinish({
      workCompleted: 0,
      billedCredits: input.billedCredits ?? null,
      billingStatus: input.billingStatus ?? "unknown",
      providerReference: input.providerReference ?? null,
    });
  const suppliedReference = input.providerReference?.trim() || null;
  if (suppliedReference && incomingRaw.providerRequestId && suppliedReference !== incomingRaw.providerRequestId) {
    throw new Error("SFP_PROVIDER_USAGE_REQUEST_ID_MISMATCH");
  }
  const providerReference = (incomingRaw.providerRequestId ?? suppliedReference ?? "").trim();
  if (!providerReference) throw new Error("SFP_PROVIDER_REFERENCE_REQUIRED");
  const incoming = normalizeSfpOperationProviderUsage({
    ...incomingRaw,
    providerReference,
    providerRequestId: providerReference,
  });
  const controlProvider = CONTROL_KEY[input.provider];
  return db.transaction(async (tx) => {
    await acquireLadderBudgetLock(tx);
     const operation = rows(await tx.execute(sql`
       SELECT o.id AS operation_id,o.provider,o.operation_type,o.idempotency_key,o.state,o.billing_state,
              o.reserved_units,o.provider_usage_status,
              o.provider_usage_quantity::text AS provider_usage_quantity,o.provider_usage_unit,
               o.settled_cost_micros,o.unit_price_micros,o.unit_price_unit,o.sfp_result_data,
               o.sfp_result_data ? 'reservedUnitAmountMicros' AS has_reserve_amount,
               o.sfp_result_data->>'reservedUnitAmountMicros' AS reserved_unit_amount_micros,
               o.sfp_result_data->>'reservedWorkUnit' AS reserved_work_unit
         FROM provider_operations o
        WHERE o.provider=${controlProvider} AND o.provider_request_id=${providerReference}
        FOR UPDATE OF o
     `))[0];
    if (!operation) throw new Error("SFP_PROVIDER_REQUEST_NOT_FOUND");
     const storedWorkUnit = operation.reserved_work_unit == null
       ? null
       : normalizeSfpWorkUnit(operation.reserved_work_unit);
     if (workUnit !== storedWorkUnit) {
       throw new Error("SFP_PROVIDER_RECONCILIATION_WORK_UNIT_MISMATCH");
     }
     const attempt = rows(await tx.execute(sql`
       SELECT outcome FROM provider_attempts
        WHERE operation_id=${String(operation.operation_id)}::uuid AND attempt_number=1
        FOR UPDATE
     `))[0];

    const oldStatus = String(operation.provider_usage_status ?? "unknown") as SfpProviderUsageStatus;
    const oldQuantity = operation.provider_usage_quantity == null
      ? null
       : normalizeSfpOperationExactDecimal(String(operation.provider_usage_quantity));
    const oldUnit = operation.provider_usage_unit == null ? null : String(operation.provider_usage_unit);
    const oldCost = operation.settled_cost_micros == null ? null : Number(operation.settled_cost_micros);
     if (oldCost !== null && !Number.isSafeInteger(oldCost)) {
       throw new Error("SFP_PROVIDER_STORED_COST_OUT_OF_SAFE_INTEGER_RANGE");
     }
    let nextUsage: SfpProviderUsageSettlement;
    if (incoming.status === "known" && oldStatus === "known") {
      nextUsage = oldQuantity === incoming.quantity && oldUnit === incoming.unit
        ? { ...incoming, providerRequestId: providerReference, source: "provider_reconciliation" }
        : normalizeSfpOperationProviderUsage({
          status: "conflict", providerRequestId: providerReference, source: "provider_reconciliation",
        });
    } else if (oldStatus === "conflict" || incoming.status === "conflict") {
      nextUsage = normalizeSfpOperationProviderUsage({
        status: "conflict", providerRequestId: providerReference, source: "provider_reconciliation",
      });
    } else if (incoming.status === "known") {
      nextUsage = { ...incoming, providerRequestId: providerReference, source: "provider_reconciliation" };
    } else if (oldStatus === "known") {
      nextUsage = { status: "known", quantity: oldQuantity, unit: oldUnit, providerRequestId: providerReference, source: "provider_reconciliation" };
    } else {
      nextUsage = {
        status: "unknown",
        quantity: null,
        unit: null,
        providerRequestId: providerReference,
        source: "provider_reconciliation",
      };
    }

    let nextCost = nextUsage.status === "known"
      ? calculateSfpUsageCostMicros({
        usage: nextUsage,
        reviewedUnitPriceMicros: nullableReviewedMicros(operation.unit_price_micros),
        reviewedUnitType: operation.unit_price_unit == null ? null : String(operation.unit_price_unit),
      })
      : null;
    const resultData = operation.sfp_result_data && typeof operation.sfp_result_data === "object"
      ? operation.sfp_result_data as Record<string, unknown>
      : {};
     if (String(attempt?.outcome) === "no_result" &&
        (resultData.noResultBillable === false || resultData.noResultBillable === "false") &&
        nextUsage.status !== "known") {
      nextCost = 0;
    }
    const inserted = rows(await tx.execute(sql`
      INSERT INTO sfp_provider_usage_reconciliations
        (provider,provider_request_id,operation_id,usage_quantity,usage_unit,usage_status,
         reconciliation_source,result_hash,updated_at)
       VALUES (${controlProvider},${providerReference},${String(operation.operation_id)}::uuid,
              ${nextUsage.quantity}::numeric,${nextUsage.unit},${nextUsage.status},
              ${input.reconciliationSource?.slice(0,120) ?? "provider_poll"},
              ${input.resultHash?.slice(0,128) ?? null},NOW())
      ON CONFLICT (provider,provider_request_id) DO UPDATE SET
        usage_quantity=EXCLUDED.usage_quantity,usage_unit=EXCLUDED.usage_unit,
        usage_status=EXCLUDED.usage_status,
        reconciliation_source=EXCLUDED.reconciliation_source,
        result_hash=EXCLUDED.result_hash,updated_at=NOW()
      WHERE sfp_provider_usage_reconciliations.operation_id=EXCLUDED.operation_id
      RETURNING id,operation_id
    `))[0];
    if (!inserted) throw new Error("SFP_PROVIDER_REQUEST_ID_RECONCILIATION_CONFLICT");

    const oldCostKnown = oldCost !== null;
    const nextCostKnown = nextCost !== null;
    const costDelta = (nextCost ?? 0) - (oldCost ?? 0);
    const unknownDelta = Number(!nextCostKnown) - Number(!oldCostKnown);
     if (!Number.isSafeInteger(costDelta) || !Number.isSafeInteger(unknownDelta)) {
       throw new Error("SFP_PROVIDER_RECONCILIATION_DELTA_OUT_OF_SAFE_INTEGER_RANGE");
     }
     const releaseReservation = String(operation.billing_state) === "ambiguous" && nextCostKnown;
     const releaseReservedUnits = releaseReservation ? Number(operation.reserved_units) : 0;
      const reservedUnitPriceMicros = operation.has_reserve_amount
        ? nullableReviewedMicros(operation.reserved_unit_amount_micros) ?? 0
        : nullableReviewedMicros(operation.unit_price_micros) ?? 0;
     const releaseReservedCostMicros = exactReservedCostMicros(reservedUnitPriceMicros, releaseReservedUnits);
     if (releaseReservation) {
       const control = rows(await tx.execute(sql`
         UPDATE provider_controls
            SET reserved_units=reserved_units-${releaseReservedUnits},version=version+1,updated_at=NOW()
          WHERE provider=${String(operation.provider)} AND reserved_units>=${releaseReservedUnits}
         RETURNING provider
       `))[0];
       if (!control) throw new Error("SFP_PROVIDER_RECONCILIATION_CONTROL_UNDERFLOW");
     }
    const updated = rows(await tx.execute(sql`
      UPDATE provider_operations
         SET provider_usage_quantity=${nextUsage.quantity}::numeric,
             provider_usage_unit=${nextUsage.unit},
             provider_usage_status=${nextUsage.status},
             provider_usage_reconciled_at=NOW(),
             settled_cost_micros=${nextCost},
             billing_state=${nextCostKnown ? "committed" : "ambiguous"},
             updated_at=NOW()
        WHERE id=${String(operation.operation_id)}::uuid
       RETURNING id
    `))[0];
    if (!updated) throw new Error("SFP_PROVIDER_USAGE_RECONCILIATION_FENCE_LOST");

    if (String(operation.operation_type) === "sfp_enrichment") {
      const stageRun = rows(await tx.execute(sql`
        SELECT sr.id FROM sfp_stage_runs sr
        JOIN sfp_stage_items i ON i.stage_run_id=sr.id
         WHERE i.provider_operation_id=${String(operation.operation_id)}::uuid
        FOR UPDATE OF sr
      `))[0];
      if (!stageRun) throw new Error("SFP_PROVIDER_USAGE_STAGE_LINEAGE_MISSING");
       const aggregate = rows(await tx.execute(sql`
         UPDATE sfp_stage_runs
            SET reserved_cost_micros=reserved_cost_micros-${releaseReservedCostMicros}::bigint,
                settled_cost_micros=settled_cost_micros+${costDelta},
                billing_unknown_count=billing_unknown_count+${unknownDelta},updated_at=NOW()
          WHERE id=${String(stageRun.id)}::uuid
            AND reserved_cost_micros>=${releaseReservedCostMicros}::bigint
            AND settled_cost_micros+${costDelta}>=0
            AND billing_unknown_count+${unknownDelta}>=0
          RETURNING id
       `))[0];
       if (!aggregate) throw new Error("SFP_PROVIDER_RECONCILIATION_STAGE_AGGREGATE_UNDERFLOW");
    } else {
      const classificationRun = rows(await tx.execute(sql`
        SELECT id FROM sfp_classification_runs
         WHERE ${String(operation.idempotency_key)} LIKE '%' || ':run:' || id::text
         FOR UPDATE
      `))[0];
      if (!classificationRun) throw new Error("SFP_PROVIDER_USAGE_RUN_LINEAGE_MISSING");
       const aggregate = rows(await tx.execute(sql`
         UPDATE sfp_classification_runs
            SET reserved_cost_micros=reserved_cost_micros-${releaseReservedCostMicros}::bigint,
                settled_cost_micros=settled_cost_micros+${costDelta},
                billing_unknown_count=billing_unknown_count+${unknownDelta},updated_at=NOW()
          WHERE id=${String(classificationRun.id)}::uuid
            AND reserved_cost_micros>=${releaseReservedCostMicros}::bigint
            AND settled_cost_micros+${costDelta}>=0
            AND billing_unknown_count+${unknownDelta}>=0
          RETURNING id
       `))[0];
       if (!aggregate) throw new Error("SFP_PROVIDER_RECONCILIATION_CLASSIFICATION_AGGREGATE_UNDERFLOW");
    }
    return {
       operationId: String(operation.operation_id),
      status: nextUsage.status,
      settledCostMicros: nextCost,
      replayed: oldStatus === nextUsage.status && oldQuantity === nextUsage.quantity && oldUnit === nextUsage.unit,
    };
  });
}
