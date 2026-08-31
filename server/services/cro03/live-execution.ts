import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { CRO03B_RECIPE_HASH, CRO03B_RECIPE_VERSION } from "./admission-service";
import { CRO03B_UNIFIED_RECIPE } from "./recipe-contract";
import { hashCro03Evidence } from "./source-staging";
import {
  CRO03C_CURRENT_MIGRATION_HEAD,
  CRO03C_INITIAL_ROLLOUT_KEY,
  CRO03C_PROVIDER_KEYS,
  stableCro03RecipeHash,
  type Cro03Provider,
} from "./contracts";
import { getPauseState } from "../outbound-pause-authority";
import { readCro03cGlobalNoOutboundCounters } from "./cro03c-effect-fence";
import { getBullMqTestPrefix, getSharedRedisClient } from "../queue-connection";
import { readCro03cWorkerFleet, type Cro03cWorkerHeartbeat } from "./runtime-heartbeat";
import {
  artifactFromCro03cReceiptRow,
  canonicalCro03cApprovalPayload,
  verifyCro03cApprovalArtifact,
  type Cro03cSignedApprovalArtifact,
} from "./approval-artifact";
import {
  currentCro03cDeploymentInventory,
  verifyCro03cDeploymentInventory,
  type Cro03cSignedDeploymentInventory,
} from "./deployment-inventory";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const SHA256 = /^[0-9a-f]{64}$/i;
const SHA1 = /^[0-9a-f]{40}$/i;

export const CRO03C_MODE = "cro03c_live_v1" as const;
export const CRO03C_CANARY_MODE = "cro03c_micro_canary_v1" as const;
/** CRO-08A recurring-schedule command mode. Distinct from the fixed-size
 * micro-canary and the singleton one-shot initial batch: every command of
 * this type is bound 1:1 to a CRO-08A schedule occurrence (see
 * cro08a_schedule_occurrences.cro03c_command_id, unique). */
export const CRO03C_CONTINUOUS_MODE = "cro03c_continuous_occurrence_v1" as const;

/**
 * Single source of truth for the mode column written to BOTH cro03c_runs and
 * every cro03c_generations row a command produces. Run-mode and generation-
 * mode previously diverged (generations were always hardcoded to CRO03C_MODE
 * regardless of commandType) — extracted as one pure function so the two
 * insert sites can never drift apart again, and so this exact mapping is
 * directly unit-testable without needing to clear the permanent CRO-03A
 * effect_authorized=FALSE wall that otherwise blocks any committed
 * continuous_occurrence generation row in this environment.
 */
export function resolveCro03cGenerationMode(commandType: string): string {
  if (commandType === "micro_canary") return CRO03C_CANARY_MODE;
  if (commandType === "continuous_occurrence") return CRO03C_CONTINUOUS_MODE;
  return CRO03C_MODE;
}
// Re-exported for backward compatibility; canonical definition lives in the
// dependency-free contracts.ts so callers that must not import server/db
// (e.g. operator discovery tooling) can reference the exact key.
export { CRO03C_INITIAL_ROLLOUT_KEY };
export const CRO03C_MAX_INITIAL_HANDOFFS = 100;
export const CRO03C_MIGRATION_HEAD = CRO03C_CURRENT_MIGRATION_HEAD;
export const CRO03C_RECIPE_HASH = CRO03B_RECIPE_HASH;
export const CRO03C_RECIPE_VERSION = CRO03B_RECIPE_VERSION;

export const CRO03C_STAGE_DISPOSITIONS = [
  "eligible", "skipped_sufficient_evidence", "skipped_missing_anchor",
  "skipped_not_applicable", "blocked_control", "blocked_budget",
  "blocked_authority", "review_required",
] as const;
export type Cro03cStageDisposition = typeof CRO03C_STAGE_DISPOSITIONS[number];

export const CRO03C_REQUIRED_APPROVALS = ["operator", "data", "finance", "legal"] as const;
export type Cro03cApproval = typeof CRO03C_REQUIRED_APPROVALS[number];
export type Cro03cBillingSemantics = "not_billable" | "per_unit_no_result_free" | "per_unit_no_result_billable";
export interface Cro03cApprovalEvidence {
  approvalId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
  scopeHash: string;
}

type Cro03cReceiptRow = {
  id: string; idempotency_key: string; dimension: Cro03cApproval; issuer_id: string; issuer_receipt_id: string;
  scope: unknown; scope_hash: string; issued_at: Date | string; expires_at: Date | string; signature: string;
};
export interface Cro03cPriceSchedule {
  version: number;
  unitType: string;
  currency: string;
  amountMicros: number;
  billingSemantics: Cro03cBillingSemantics;
}

export const CRO03C_PROVIDER_CONTRACTS: Readonly<Record<string, {
  unitType: string;
  currency: string;
  maxCanaryUnits: number;
  legitimateNoResult: boolean;
  noResultBillable: boolean;
  minimumSample: number;
  maxConsecutiveFailures: number;
  maxMalformed: number;
  maxConflicts: number;
  billingSemantics: Cro03cBillingSemantics;
}>> = Object.freeze({
  internal_source: { unitType: "none", currency: "USD", maxCanaryUnits: 0, legitimateNoResult: true, noResultBillable: false, minimumSample: 10, maxConsecutiveFailures: 0, maxMalformed: 0, maxConflicts: 0, billingSemantics: "not_billable" },
  first_party_web: { unitType: "page", currency: "USD", maxCanaryUnits: 50, legitimateNoResult: true, noResultBillable: false, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_free" },
  rdap: { unitType: "request", currency: "USD", maxCanaryUnits: 10, legitimateNoResult: true, noResultBillable: false, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_free" },
  jsonld: { unitType: "parse", currency: "USD", maxCanaryUnits: 0, legitimateNoResult: true, noResultBillable: false, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "not_billable" },
  serper: { unitType: "request", currency: "USD", maxCanaryUnits: 10, legitimateNoResult: true, noResultBillable: true, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_billable" },
  outscraper: { unitType: "result", currency: "USD", maxCanaryUnits: 25, legitimateNoResult: true, noResultBillable: false, minimumSample: 5, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_free" },
  openai: { unitType: "token", currency: "USD", maxCanaryUnits: 10, legitimateNoResult: true, noResultBillable: true, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_billable" },
  apollo: { unitType: "result", currency: "USD", maxCanaryUnits: 25, legitimateNoResult: true, noResultBillable: false, minimumSample: 5, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_free" },
  zerobounce: { unitType: "request", currency: "USD", maxCanaryUnits: 10, legitimateNoResult: true, noResultBillable: true, minimumSample: 10, maxConsecutiveFailures: 2, maxMalformed: 1, maxConflicts: 1, billingSemantics: "per_unit_no_result_billable" },
});

// Guard against silent drift between this contract object and the
// dependency-free CRO03C_PROVIDER_KEYS list in contracts.ts (which
// dependency-free callers, e.g. operator discovery tooling, rely on instead
// of importing this module and its server/db chain).
{
  const actual = Object.keys(CRO03C_PROVIDER_CONTRACTS).sort();
  const expected = [...CRO03C_PROVIDER_KEYS].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    throw new Error(
      `CRO03C_PROVIDER_KEYS_DRIFT: contracts.ts CRO03C_PROVIDER_KEYS (${expected.join(",")}) no longer matches CRO03C_PROVIDER_CONTRACTS keys (${actual.join(",")})`
    );
  }
}

export interface Cro03cRuntimeAttestation {
  inventoryId?: string;
  workerIdentities?: string[];
  artifactSha: string;
  migrationHead: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  webBootIdentity: string;
  workerBootIdentity: string;
  queueTopologyHash: string;
  workerHeartbeatAt: Date | string;
  dbHealthy: boolean;
  redisHealthy: boolean;
  capturedAt?: Date | string;
  expiresAt: Date | string;
}

export type Cro03cRuntimeAttestationValidationMode = "capture" | "later";

export interface Cro03cLiveProviderContext {
  kind: "cro03c_live";
  provider: Cro03Provider | "internal_source" | "first_party_web" | "rdap" | "jsonld" | "openai";
  activationRevision: number;
  generationId: string;
  commandId: string;
  runId: string;
  cro03bItemId?: string;
  stageKey: string;
  claimToken: string;
  executionFence: number;
  providerOperationId?: string;
  runtimeAttestationId: string;
  expiresAt: Date | string;
  noOutboundSnapshotHash: string;
  caller: string;
}

/**
 * Authority for command-owned effects which have their own durable claim
 * (rather than a CRO03C stage claim).  In particular, validation intents must
 * not borrow a generation claim token just to prove their command provenance.
 */
export interface Cro03cCommandAuthorityContext {
  commandId: string;
  runId: string;
  generationId: string;
  runtimeAttestationId: string;
  activationRevision: number;
}

function requireHash(value: string, name: string): void {
  if (!SHA256.test(value)) throw new Error(`CRO03C_${name}_HASH_INVALID`);
}

export function hashCro03cAttestation(attestation: Cro03cRuntimeAttestation): string {
  return stableCro03RecipeHash({
    ...attestation,
    workerHeartbeatAt: new Date(attestation.workerHeartbeatAt).toISOString(),
    capturedAt: attestation.capturedAt ? new Date(attestation.capturedAt).toISOString() : undefined,
    expiresAt: new Date(attestation.expiresAt).toISOString(),
  });
}

export function assertCro03cRuntimeAttestation(
  attestation: Cro03cRuntimeAttestation,
  now: Date = new Date(),
  mode: Cro03cRuntimeAttestationValidationMode = "later",
): void {
  if (!SHA1.test(attestation.artifactSha)) throw new Error("CRO03C_RELEASE_UNVERIFIED");
  if (!attestation.migrationHead || !attestation.deploymentIdentity || !attestation.environmentIdentity ||
      !attestation.webBootIdentity || !attestation.workerBootIdentity || !SHA256.test(attestation.queueTopologyHash)) {
    throw new Error("CRO03C_RUNTIME_ATTESTATION_INCOMPLETE");
  }
  if (!attestation.dbHealthy || !attestation.redisHealthy) throw new Error("CRO03C_RUNTIME_UNHEALTHY");
  const heartbeat = new Date(attestation.workerHeartbeatAt).getTime();
  const capturedAt = attestation.capturedAt ? new Date(attestation.capturedAt).getTime() : NaN;
  const expires = new Date(attestation.expiresAt).getTime();
  if (!Number.isFinite(heartbeat)) {
    throw new Error("CRO03C_WORKER_HEARTBEAT_STALE");
  }
  // worker_heartbeat_at is immutable evidence that the fleet was healthy when
  // this attestation was captured. It is deliberately not a lease: later
  // authority checks re-scan Redis below rather than requiring this historical
  // timestamp to remain under the heartbeat TTL.
  if (mode === "capture" && (!Number.isFinite(capturedAt) ||
      heartbeat > capturedAt + 5_000 || capturedAt - heartbeat > 60_000)) {
    throw new Error("CRO03C_WORKER_HEARTBEAT_STALE");
  }
  if (!Number.isFinite(expires) || expires <= now.getTime()) throw new Error("CRO03C_ATTESTATION_EXPIRED");
}

export function effectiveCro03cCap(commandCap: number, providerCap: number): number {
  if (!Number.isInteger(commandCap) || !Number.isInteger(providerCap) || commandCap < 0 || providerCap < 0) {
    throw new Error("CRO03C_CAP_INVALID");
  }
  return Math.min(commandCap, providerCap);
}

export function assertCro03cStageDisposition(disposition: string): asserts disposition is Cro03cStageDisposition {
  if (!(CRO03C_STAGE_DISPOSITIONS as readonly string[]).includes(disposition)) {
    throw new Error("CRO03C_STAGE_DISPOSITION_INVALID");
  }
}

export function assertCro03cApprovalEvidence(approvals: Partial<Record<Cro03cApproval, Cro03cApprovalEvidence>>): void {
  if (CRO03C_REQUIRED_APPROVALS.some((name) => {
    const approval = approvals[name];
    return !approval || !approval.approvalId || !Number.isInteger(approval.version) || approval.version < 1 ||
      !approval.approvedBy?.trim() || !Number.isFinite(new Date(approval.approvedAt).getTime()) ||
      !SHA256.test(approval.scopeHash);
  })) {
    throw new Error("CRO03C_APPROVALS_INCOMPLETE");
  }
}

export function assertCro03cPriceSchedules(pricing: Record<string, Cro03cPriceSchedule>): void {
  const providers = Object.keys(CRO03C_PROVIDER_CONTRACTS);
  if (Object.keys(pricing).length !== providers.length || providers.some((provider) => !(provider in pricing))) {
    throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  }
  for (const provider of providers) {
    const contract = CRO03C_PROVIDER_CONTRACTS[provider];
    const schedule = pricing[provider];
    if (!schedule || !Number.isInteger(schedule.version) || schedule.version < 1 ||
        schedule.unitType !== contract.unitType || schedule.currency !== contract.currency ||
        schedule.billingSemantics !== contract.billingSemantics ||
        !Number.isSafeInteger(schedule.amountMicros) || schedule.amountMicros < 0 ||
        (contract.billingSemantics === "not_billable" ? schedule.amountMicros !== 0 : schedule.amountMicros < 1)) {
      throw new Error("CRO03C_PRICE_SCHEDULE_INVALID");
    }
  }
}

export function assertCro03cCanaryTarget(provider: string, sampleSize: number, targetCount: number): void {
  const contract = CRO03C_PROVIDER_CONTRACTS[provider];
  if (!contract) throw new Error("CRO03C_PROVIDER_NOT_SUPPORTED");
  if (!Number.isInteger(sampleSize) || sampleSize !== contract.minimumSample ||
      !Number.isInteger(targetCount) || targetCount !== sampleSize) {
    throw new Error("CRO03C_CANARY_SCOPE_INVALID");
  }
}

const CRO03C_MICRO_TARGETS: Readonly<Record<string, number>> = Object.freeze({
  internal_source: 10, first_party_web: 10, rdap: 10, jsonld: 10, serper: 10, outscraper: 5, openai: 10, apollo: 5, zerobounce: 10,
});

/** Input documents are evidence, never browser-supplied execution authority. */
function cro03cSourceValue(payload: any, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = payload?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function deriveCro03cProviderInput(provider: string, payload: any, schedule: any, source: any): Record<string, unknown> | null {
  const amountMicros = Number(schedule?.amountMicros);
  if (!Number.isInteger(amountMicros) || amountMicros < 0) throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  const name = cro03cSourceValue(payload, "businessName", "business_name");
  const website = cro03cSourceValue(payload, "website");
  const city = cro03cSourceValue(payload, "city");
  const state = cro03cSourceValue(payload, "state");
  const address = cro03cSourceValue(payload, "address");
  const pricing = { priceScheduleVersion: Number(schedule.version), priceScheduleHash: stableCro03RecipeHash(schedule) };
  if (provider === "internal_source") return {
    provider, amountMicros: 0, reservedUnits: 0,
    ...pricing, evidence: { observationId: source.observation_id, payloadHash: source.payload_hash,
      sourceKeyHash: hashCro03Evidence({ observationId: source.observation_id }) },
  };
  if (provider === "rdap" || provider === "jsonld") {
    // These are local parsers over a frozen parent evidence artifact. They
    // have no URL/transport authority and therefore retain zero-cost pricing.
    return {
      provider, amountMicros: 0, reservedUnits: 0, ...pricing,
      evidence: {
        observationId: source.observation_id, payloadHash: source.payload_hash,
        sourceKeyHash: hashCro03Evidence({ observationId: source.observation_id }),
      },
    };
  }
  if (provider === "first_party_web") {
    let homepage: URL;
    try { homepage = new URL(website ?? ""); } catch { return null; }
    if (homepage.protocol !== "https:" || homepage.username || homepage.password || homepage.port) return null;
    homepage.pathname = "/"; homepage.search = ""; homepage.hash = "";
    return { provider, amountMicros, reservedUnits: 5, ...pricing, crawl: { homepageUrl: homepage.toString(), approvedPageUrls: [], operationId: "" } };
  }
  if (provider === "serper") {
    // A search is justified only by a frozen unresolved source gap.
    if (!name || (!website && !cro03cSourceValue(payload, "phone") && !address)) return null;
    return { provider, amountMicros, reservedUnits: 1, ...pricing, endpoint: "/search", payload: { q: [name, city, state].filter(Boolean).join(" ") } };
  }
  if (provider === "outscraper") {
    if (!name || !city || !state) return null;
    return { provider, amountMicros, reservedUnits: 5, ...pricing, query: [name, city, state].join(", "), region: "US", consideredResultLimit: 5,
      justification: { handoffHash: hashCro03Evidence({ observationId: source.observation_id, payloadHash: source.payload_hash }), strongAnchor: true } };
  }
  if (provider === "apollo") {
    if (!name || (!website && !address)) return null;
    let domain: string | null = null;
    try {
      const parsed = website ? new URL(website) : null;
      if (parsed && (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port)) return null;
      domain = parsed?.hostname ?? null;
    } catch { return null; }
    return { provider, amountMicros, reservedUnits: 5, ...pricing, identity: { domain, legalName: name, city: city ?? null, state: state ?? null, address: address ?? null } };
  }
  // The reviewed OpenAI model/prompt allowlists are intentionally empty. Do
  // not manufacture a model request from handoff evidence.
  return null;
}

export interface Cro03cEvidenceStagePlan {
  readonly stageKey: string;
  readonly provider: string | null;
  readonly disposition: Cro03cStageDisposition;
  /** A stable, non-PII explanation of the evidence gap and authority result. */
  readonly reasonCode: string;
}

/**
 * Pure initial planning policy.  It deliberately consumes only the canonical
 * observation and the already-persisted command authority.  In particular,
 * recipe order is not a license to fan an item out: at most the provider named
 * by the command can be eligible.
 */
export function planCro03cEvidenceStages(input: {
  payload: any;
  commandType: "micro_canary" | "initial_batch" | "continuous_occurrence";
  caps: { provider?: string | null; maxUnits?: number; maxAmountMicros?: number };
  pricing: Record<string, Cro03cPriceSchedule>;
  source: { observation_id: string; payload_hash: string };
}): readonly Cro03cEvidenceStagePlan[] {
  const value = (...keys: string[]) => cro03cSourceValue(input.payload, ...keys);
  const name = value("businessName", "business_name");
  const website = value("website");
  const phone = value("phone");
  const address = value("address");
  const city = value("city");
  const state = value("state");
  const email = value("email");
  let httpsDomain = false;
  try {
    const url = new URL(website ?? "");
    httpsDomain = url.protocol === "https:" && !url.username && !url.password && !url.port;
  } catch { /* evidence has no approved domain */ }
  const hasBusinessAnchor = Boolean(name && (website || phone || address));
  const fieldGap = !website || !phone || !address || !city || !state;
  const contactGap = !email;
  const requested = input.caps.provider ?? null;

  return CRO03B_UNIFIED_RECIPE.steps.map((step): Cro03cEvidenceStagePlan => {
    const provider = step.id === "public-web" ? "first_party_web" :
      CRO03C_PROVIDER_CONTRACTS[step.provider] ? String(step.provider) : null;
    if (!provider) return { stageKey: step.id, provider: null, disposition: "skipped_not_applicable", reasonCode: "local_stage_not_provider_dispatch" };

    let applicable = false;
    let gapCode = "no_justified_unresolved_gap";
    if (provider === "internal_source") {
      applicable = true; gapCode = "immutable_canonical_observation";
    } else if (provider === "first_party_web") {
      applicable = httpsDomain && fieldGap; gapCode = httpsDomain ? "unresolved_first_party_field_gap" : "missing_approved_https_domain";
    } else if (provider === "rdap") {
      applicable = httpsDomain; gapCode = httpsDomain ? "domain_corroboration_gap" : "missing_verified_domain";
    } else if (provider === "jsonld") {
      applicable = httpsDomain && fieldGap; gapCode = httpsDomain ? "authorized_page_evidence_gap" : "missing_parent_domain_evidence";
    } else if (provider === "serper") {
      applicable = fieldGap && hasBusinessAnchor; gapCode = hasBusinessAnchor ? "unresolved_business_gap" : "missing_strong_anchor";
    } else if (provider === "outscraper") {
      applicable = fieldGap && Boolean(name && city && state); gapCode = name && city && state ? "unresolved_business_gap" : "missing_strong_anchor";
    } else if (provider === "apollo") {
      applicable = contactGap && Boolean(name && (httpsDomain || address)); gapCode = contactGap ? "unresolved_contact_gap" : "sufficient_contact_evidence";
    } // OpenAI has no reviewed request bundle, hence is never applicable.

    if (!applicable) {
      const missingAnchor = /missing_(?:strong_anchor|approved_https_domain|verified_domain|parent_domain_evidence)/.test(gapCode);
      return { stageKey: step.id, provider, disposition: missingAnchor ? "skipped_missing_anchor" : "skipped_sufficient_evidence", reasonCode: gapCode };
    }
    if (requested !== provider) {
      return { stageKey: step.id, provider, disposition: "blocked_authority", reasonCode: `${gapCode}:command_provider_not_authorized` };
    }
    const schedule = input.pricing[provider];
    const derived = schedule && deriveCro03cProviderInput(provider, input.payload, schedule, input.source);
    if (!derived) return { stageKey: step.id, provider, disposition: "skipped_not_applicable", reasonCode: "provider_input_not_applicable" };
    const units = Number(derived.reservedUnits);
    const amount = units * Number(schedule.amountMicros);
    if (units > Number(input.caps.maxUnits ?? 0) || amount > Number(input.caps.maxAmountMicros ?? 0)) {
      return { stageKey: step.id, provider, disposition: "blocked_budget", reasonCode: `${gapCode}:command_cap_exhausted` };
    }
    return { stageKey: step.id, provider, disposition: "eligible", reasonCode: gapCode };
  });
}

export function assertCro03cLiveContext(context: Cro03cLiveProviderContext): void {
  if (context.kind !== "cro03c_live" || !context.caller.startsWith("server/services/cro03/")) {
    throw new Error("CRO03C_CONTEXT_INVALID");
  }
  if (!context.generationId || !context.commandId || !context.runId || !context.stageKey ||
      !context.claimToken || !context.runtimeAttestationId || !context.noOutboundSnapshotHash) {
    throw new Error("CRO03C_CONTEXT_INCOMPLETE");
  }
  if (!Number.isInteger(context.activationRevision) || context.activationRevision < 1 ||
      !Number.isInteger(context.executionFence) || context.executionFence < 1) {
    throw new Error("CRO03C_CONTEXT_FENCE_INVALID");
  }
  requireHash(context.noOutboundSnapshotHash, "SNAPSHOT");
  if (new Date(context.expiresAt).getTime() <= Date.now()) throw new Error("CRO03C_CONTEXT_EXPIRED");
}

async function currentRevision(executor: any): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(MAX(expected_revision), 0)::int AS revision FROM cro03c_activation_policies
  `);
  return Number(rows(result)[0]?.revision ?? 0);
}

export function cro03cStagePlanHash(): string {
  return stableCro03RecipeHash(CRO03B_UNIFIED_RECIPE.steps.map((step) => ({
    id: step.id, provider: step.provider, accountingOwner: step.accountingOwner,
  })));
}

/** The approval scope is reconstructed here; receipt payloads never define it. */
function cro03cApprovalScope(pricing: Record<string, Cro03cPriceSchedule>): Record<string, unknown> {
  return {
    policyKey: "cro03c_live_activation", recipeVersion: CRO03C_RECIPE_VERSION,
    recipeHash: CRO03C_RECIPE_HASH, stagePlanHash: cro03cStagePlanHash(),
    migrationHead: CRO03C_MIGRATION_HEAD, releaseSha: process.env.RELEASE_SHA ?? "",
    priceSchedules: pricing,
  };
}

async function verifiedCro03cReceipts(tx: any, receiptIds: Partial<Record<Cro03cApproval, string>>): Promise<{
  pricing: Record<string, Cro03cPriceSchedule>; evidence: Record<string, Cro03cApprovalEvidence>;
}> {
  if (CRO03C_REQUIRED_APPROVALS.some((dimension) => !receiptIds[dimension])) {
    throw new Error("CRO03C_APPROVAL_RECEIPTS_INCOMPLETE");
  }
  const ids = CRO03C_REQUIRED_APPROVALS.map((dimension) => receiptIds[dimension]!);
  if (new Set(ids).size !== ids.length) throw new Error("CRO03C_APPROVAL_RECEIPTS_INCOMPLETE");
  const receipts = rows(await tx.execute(sql`
    SELECT r.*, v.receipt_id AS revoked_receipt_id
      FROM cro03c_approval_receipts r
      LEFT JOIN cro03c_approval_receipt_revocations v ON v.receipt_id=r.id
     WHERE r.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
     FOR UPDATE OF r
  `)) as Cro03cReceiptRow[];
  if (receipts.length !== ids.length || receipts.some((r: any) => r.revoked_receipt_id ||
      !r.signature || new Date(r.expires_at).getTime() <= Date.now())) {
    throw new Error("CRO03C_APPROVAL_RECEIPT_REVOKED");
  }
  for (const receipt of receipts) verifyCro03cApprovalArtifact(artifactFromCro03cReceiptRow(receipt));
  const byDimension = new Map(receipts.map((receipt) => [receipt.dimension, receipt]));
  if (CRO03C_REQUIRED_APPROVALS.some((dimension) => {
    const receipt = byDimension.get(dimension);
    return !receipt || String(receipt.id) !== receiptIds[dimension];
  })) throw new Error("CRO03C_APPROVAL_RECEIPTS_INCOMPLETE");
  const pricing = (receipts[0].scope as any)?.priceSchedules;
  assertCro03cPriceSchedules(pricing);
  const expectedScope = cro03cApprovalScope(pricing);
  const expectedHash = stableCro03RecipeHash(expectedScope);
  if (receipts.some((receipt) => !SHA256.test(receipt.scope_hash) ||
      receipt.scope_hash !== expectedHash || stableCro03RecipeHash(receipt.scope) !== expectedHash)) {
    throw new Error("CRO03C_APPROVAL_SCOPE_MISMATCH");
  }
  const evidence = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension) => {
    const receipt = byDimension.get(dimension)!;
    return [dimension, { approvalId: String(receipt.id), version: 1, approvedBy: receipt.issuer_id,
      approvedAt: new Date(receipt.issued_at).toISOString(), scopeHash: receipt.scope_hash }];
  }));
  return { pricing, evidence };
}

export async function importCro03cApprovalArtifact(input: {
  artifact: Cro03cSignedApprovalArtifact;
  idempotencyKey: string;
  reason: string;
  actorId: string;
}): Promise<{ receiptId: string; replayed: boolean }> {
  if (!input.reason?.trim() || input.reason.trim().length > 500 ||
      !input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error("CRO03C_APPROVAL_IMPORT_INVALID");
  }
  // Verification deliberately precedes replay lookup: a forged replay is never
  // allowed to probe or inherit a previously imported approval.
  const payload = verifyCro03cApprovalArtifact(input.artifact);
  if (payload.idempotencyKey !== input.idempotencyKey) throw new Error("CRO03C_IDEMPOTENCY_CONFLICT");
  return db.transaction(async (tx) => {
    const prior = rows(await tx.execute(sql`
      SELECT * FROM cro03c_approval_receipts
       WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (prior) {
      const stored = artifactFromCro03cReceiptRow(prior);
      if (canonicalCro03cApprovalPayload(stored.payload) !== canonicalCro03cApprovalPayload(payload) ||
          stored.signature !== input.artifact.signature) {
        throw new Error("CRO03C_IDEMPOTENCY_CONFLICT");
      }
      return { receiptId: String(prior.id), replayed: true };
    }
    const inserted = rows(await tx.execute(sql`
      INSERT INTO cro03c_approval_receipts
        (id,idempotency_key,dimension,issuer_id,issuer_receipt_id,scope,scope_hash,issued_at,expires_at,signature,created_by)
      VALUES (${payload.receiptId}::uuid,${payload.idempotencyKey},${payload.dimension},${payload.issuerId},
              ${payload.receiptId},${JSON.stringify(payload.scope)}::jsonb,${payload.scopeHash},
              ${payload.issuedAt}::timestamptz,${payload.expiresAt}::timestamptz,
              ${input.artifact.signature},${input.actorId})
      RETURNING id
    `))[0];
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.approval_artifact.imported','cro03c_approval_receipt',${String(inserted.id)},
              ${JSON.stringify({
                idempotencyKey: payload.idempotencyKey, issuerId: payload.issuerId,
                dimension: payload.dimension, scopeHash: payload.scopeHash, reason: input.reason.trim(),
              })}::jsonb,'user',${input.actorId})
    `);
    return { receiptId: String(inserted.id), replayed: false };
  });
}

export async function createCro03cRuntimeAttestation(input: {
  idempotencyKey: string;
  actorId: string;
  ttlMs?: number;
}): Promise<{ id: string; attestationHash: string; expiresAt: string; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error("CRO03C_IDEMPOTENCY_KEY_INVALID");
  const replay = rows(await db.execute(sql`
    SELECT t.id,t.attestation_hash,t.expires_at,r.inventory_id AS revoked_inventory_id,i.expires_at AS inventory_expires_at
      FROM cro03c_runtime_attestations t
      JOIN cro03c_deployment_inventories i ON i.id=t.inventory_id
      LEFT JOIN cro03c_deployment_inventory_revocations r ON r.inventory_id=i.id
     WHERE t.idempotency_key=${input.idempotencyKey}
  `))[0];
  if (replay) {
    if (replay.revoked_inventory_id || new Date(replay.inventory_expires_at).getTime() <= Date.now()) {
      throw new Error("CRO03C_DEPLOYMENT_INVENTORY_REVOKED");
    }
    return {
      id: String(replay.id), attestationHash: String(replay.attestation_hash),
      expiresAt: new Date(replay.expires_at).toISOString(), replayed: true,
    };
  }
  const { getCro03cQueueTopologyHash } = await import("../queue-manager");
  const queueTopologyHash = getCro03cQueueTopologyHash();
  const artifactSha = process.env.RELEASE_SHA ?? "";
  const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
  const environmentIdentity = process.env.NODE_ENV ?? "";
  if (!SHA1.test(artifactSha) || !deploymentIdentity || !environmentIdentity) throw new Error("CRO03C_RELEASE_UNVERIFIED");
  const inventory = await currentCro03cDeploymentInventory({
    deploymentIdentity, environmentIdentity, releaseSha: artifactSha, queueTopologyHash,
  });
  let dbHealthy = false;
  let redisHealthy = false;
  try {
    const probe = rows(await db.execute(sql`SELECT 1 AS ok`))[0];
    dbHealthy = Number(probe?.ok) === 1;
  } catch {
    dbHealthy = false;
  }
  const redis = getSharedRedisClient();
  let observedWorker;
  let observedWorkers: Cro03cWorkerHeartbeat[] = [];
  if (redis) {
    try {
      redisHealthy = await redis.ping() === "PONG";
    } catch {
      redisHealthy = false;
    }
    if (redisHealthy) {
      const fleet = await readCro03cWorkerFleet({
        redis,
        prefix: getBullMqTestPrefix(),
        expectedReleaseSha: artifactSha,
        expectedQueueTopologyHash: queueTopologyHash,
        expectedProcessIdentities: inventory.workerIdentities,
        now: new Date(),
      });
      if (!fleet.complete) throw new Error("CRO03C_WORKER_FLEET_SCAN_INCOMPLETE");
      observedWorkers = fleet.heartbeats;
      observedWorker = observedWorkers[0];
    }
  }
  if (!observedWorker) throw new Error("CRO03C_WORKER_ATTESTATION_UNAVAILABLE");
  const capturedAt = new Date();
  const expiresAt = new Date(capturedAt.getTime() + Math.min(Math.max(input.ttlMs ?? 60_000, 1_000), 15 * 60_000));
  const attestation: Cro03cRuntimeAttestation = {
    inventoryId: inventory.inventoryId,
    workerIdentities: observedWorkers.map((heartbeat) => heartbeat.processIdentity).sort(),
    artifactSha,
    migrationHead: CRO03C_MIGRATION_HEAD,
    deploymentIdentity,
    environmentIdentity,
    webBootIdentity: process.env.CRO03C_WEB_BOOT_IDENTITY ?? `web:${process.pid}`,
    workerBootIdentity: observedWorker.bootIdentity,
    queueTopologyHash,
    workerHeartbeatAt: observedWorker.timestamp,
    dbHealthy,
    redisHealthy,
    capturedAt,
    expiresAt,
  };
  assertCro03cRuntimeAttestation(attestation, capturedAt, "capture");
  const attestationHash = hashCro03cAttestation(attestation);
  const inserted = rows(await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations
      (idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,
       worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,
       captured_at,expires_at,attestation_hash,created_by)
    VALUES (${input.idempotencyKey},${inventory.inventoryId}::uuid,${JSON.stringify(attestation.workerIdentities)}::jsonb,
            ${attestation.artifactSha},${attestation.migrationHead},${attestation.deploymentIdentity},
            ${attestation.environmentIdentity},${attestation.webBootIdentity},${attestation.workerBootIdentity},
            ${attestation.queueTopologyHash},${attestation.workerHeartbeatAt}::timestamptz,
            ${attestation.dbHealthy},${attestation.redisHealthy},${capturedAt}::timestamptz,
            ${expiresAt}::timestamptz,${attestationHash},${input.actorId})
    ON CONFLICT (attestation_hash) DO NOTHING
    RETURNING id,expires_at
  `))[0];
  if (!inserted) {
    const existing = rows(await db.execute(sql`
      SELECT id,expires_at FROM cro03c_runtime_attestations WHERE attestation_hash=${attestationHash}
    `))[0];
    return { id: String(existing.id), attestationHash, expiresAt: new Date(existing.expires_at).toISOString(), replayed: true };
  }
  await db.execute(sql`
    INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
    VALUES (${input.actorId},'cro03c.runtime_attestation.created','cro03c_runtime_attestation',${String(inserted.id)},
            ${JSON.stringify({ idempotencyKey: input.idempotencyKey, attestationHash, expiresAt: new Date(inserted.expires_at).toISOString() })}::jsonb,
            'user',${input.actorId})
  `);
  return { id: String(inserted.id), attestationHash, expiresAt: new Date(inserted.expires_at).toISOString(), replayed: false };
}

export async function createCro03cActivationPolicy(input: {
  idempotencyKey: string;
  actorId: string;
  expectedRevision: number;
  reason: string;
  receiptIds: Partial<Record<Cro03cApproval, string>>;
}): Promise<{ id: string; revision: number; policyHash: string; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error("CRO03C_IDEMPOTENCY_KEY_INVALID");
  if (!input.reason?.trim() || input.reason.trim().length > 500) throw new Error("CRO03C_REASON_INVALID");
  const result = await db.transaction(async (tx) => {
    const prior = rows(await tx.execute(sql`
      SELECT id,expected_revision,policy_hash FROM cro03c_activation_policies
       WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (prior) {
      if (input.expectedRevision !== Number(prior.expected_revision) - 1) {
        throw new Error("CRO03C_ACTIVATION_REVISION_CONFLICT");
      }
      return { id: String(prior.id), revision: Number(prior.expected_revision), policyHash: String(prior.policy_hash), replayed: true };
    }
    const revision = await currentRevision(tx) + 1;
    if (input.expectedRevision !== revision - 1) throw new Error("CRO03C_ACTIVATION_REVISION_CONFLICT");
    const { pricing: providerPricing, evidence: approvals } = await verifiedCro03cReceipts(tx, input.receiptIds);
    const policy = {
      key: "cro03c_live_activation",
      version: revision,
      recipeVersion: CRO03C_RECIPE_VERSION,
      recipeHash: CRO03C_RECIPE_HASH,
      approvals,
      priceSchedules: providerPricing,
      providers: Object.entries(CRO03C_PROVIDER_CONTRACTS).map(([provider, contract]) => ({
        provider, unitType: contract.unitType, billingSemantics: contract.billingSemantics,
        canary: { sampleSize: contract.minimumSample, maxUnits: contract.maxCanaryUnits },
        yield: { denominator: "settled_provider_units", minimumSample: contract.minimumSample },
        stop: { maxConsecutiveFailures: contract.maxConsecutiveFailures, maxMalformed: contract.maxMalformed, maxConflicts: contract.maxConflicts },
      })),
      disposition: { cancellation: "cancelled", expiry: "expired", ambiguousBilling: "quarantine_pending_reconciliation" },
    };
    const policyHash = stableCro03RecipeHash(policy);
    const inserted = rows(await tx.execute(sql`
      INSERT INTO cro03c_activation_policies
        (idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,
         expected_revision,reason,created_by)
      VALUES (${input.idempotencyKey},'cro03c_live_activation',${revision},${JSON.stringify(policy)}::jsonb,${policyHash},
              ${JSON.stringify(providerPricing)}::jsonb,${JSON.stringify(approvals)}::jsonb,
              'approved',${revision},${input.reason.trim()},${input.actorId})
      RETURNING id
    `))[0];
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.activation_policy.created','cro03c_activation_policy',${String(inserted.id)},
              ${JSON.stringify({ idempotencyKey: input.idempotencyKey, revision, policyHash })}::jsonb,'user',${input.actorId})
    `);
    return { id: String(inserted.id), revision, policyHash, replayed: false };
  });
  return result;
}

/** Revocation is the sole local administrative receipt mutation and is audited. */
export async function revokeCro03cApprovalReceipt(input: {
  receiptId: string; idempotencyKey: string; expectedRevision: number; reason: string; actorId: string;
}): Promise<{ receiptId: string; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200 || !input.reason?.trim() || input.reason.trim().length > 500) {
    throw new Error("CRO03C_RECEIPT_REVOCATION_INVALID");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("CRO03C_RECEIPT_REVOCATION_INVALID");
  return db.transaction(async (tx) => {
    const receipt = rows(await tx.execute(sql`SELECT id FROM cro03c_approval_receipts WHERE id=${input.receiptId}::uuid FOR UPDATE`))[0];
    if (!receipt) throw new Error("CRO03C_APPROVAL_RECEIPT_NOT_FOUND");
    const activeRevision = await currentRevision(tx);
    if (input.expectedRevision !== activeRevision) throw new Error("CRO03C_RECEIPT_REVOCATION_REVISION_CONFLICT");
    const prior = rows(await tx.execute(sql`
      SELECT receipt_id FROM cro03c_approval_receipt_revocations WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (prior) {
      if (String(prior.receipt_id) !== input.receiptId) throw new Error("CRO03C_IDEMPOTENCY_CONFLICT");
      return { receiptId: input.receiptId, replayed: true };
    }
    const existing = rows(await tx.execute(sql`
      SELECT receipt_id FROM cro03c_approval_receipt_revocations WHERE receipt_id=${input.receiptId}::uuid
    `))[0];
    if (existing) throw new Error("CRO03C_APPROVAL_RECEIPT_ALREADY_REVOKED");
    await tx.execute(sql`
      INSERT INTO cro03c_approval_receipt_revocations(receipt_id,idempotency_key,reason,revoked_by)
      VALUES (${input.receiptId}::uuid,${input.idempotencyKey},${input.reason.trim()},${input.actorId})
    `);
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.approval_receipt.revoked','cro03c_approval_receipt',${input.receiptId},
              ${JSON.stringify({ idempotencyKey: input.idempotencyKey, expectedRevision: input.expectedRevision, reason: input.reason.trim() })}::jsonb,'user',${input.actorId})
    `);
    return { receiptId: input.receiptId, replayed: false };
  });
}

export async function createCro03cCommand(input: {
  actorId: string;
  idempotencyKey: string;
  commandType: "micro_canary" | "initial_batch" | "continuous_occurrence";
  expectedActivationRevision: number;
  runtimeAttestationId: string;
  handoffIds: string[];
  provider?: keyof typeof CRO03C_PROVIDER_CONTRACTS;
  maxUnits?: number;
  maxAmountMicros?: number;
  reason: string;
  expiresAt: Date | string;
  /** Required for commandType==="continuous_occurrence": binds this command
   * 1:1 to a CRO-08A schedule occurrence (cro08a_schedule_occurrences.id).
   * The occurrence row itself enforces the 1:1 relationship via a unique FK
   * column; this identifier is folded into the command key so a second
   * attempt against the same occurrence always replays instead of minting a
   * second command. */
  scheduleOccurrenceId?: string;
  scheduleDefinitionHash?: string;
}): Promise<{ commandId: string; runId: string; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error("CRO03C_IDEMPOTENCY_KEY_INVALID");
  if (!input.reason?.trim() || input.reason.trim().length > 500) throw new Error("CRO03C_REASON_INVALID");
  const distinctHandoffs = [...new Set(input.handoffIds)];
  if (distinctHandoffs.length !== input.handoffIds.length ||
      distinctHandoffs.length < 1 || distinctHandoffs.length > CRO03C_MAX_INITIAL_HANDOFFS) {
    throw new Error("CRO03C_COMMAND_SCOPE_INVALID");
  }
  if (input.commandType === "micro_canary") {
    if (!Number.isInteger(input.maxUnits) || input.maxUnits! < 0 ||
        !Number.isInteger(input.maxAmountMicros) || input.maxAmountMicros! < 0) throw new Error("CRO03C_CAP_INVALID");
    if (!input.provider) throw new Error("CRO03C_PROVIDER_REQUIRED");
    assertCro03cCanaryTarget(input.provider, distinctHandoffs.length, distinctHandoffs.length);
    if (distinctHandoffs.length !== CRO03C_MICRO_TARGETS[input.provider]) throw new Error("CRO03C_CANARY_SCOPE_INVALID");
  } else if (input.commandType === "continuous_occurrence") {
    // Caps for a continuous_occurrence command are NEVER trusted from the
    // caller: they are derived below, inside the transaction, from the
    // locked schedule occurrence row and its active schedule definition's
    // budgets. Any caller-supplied maxUnits/maxAmountMicros is ignored.
    if (!input.provider) throw new Error("CRO03C_PROVIDER_REQUIRED");
    if (!input.scheduleOccurrenceId || !input.scheduleDefinitionHash) throw new Error("CRO08A_SCHEDULE_OCCURRENCE_REQUIRED");
  } else if (input.provider) {
    throw new Error("CRO03C_INITIAL_BATCH_CAP_INVALID");
  }
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error("CRO03C_COMMAND_EXPIRED");

  const created = await db.transaction(async (tx) => {
    const replay = rows(await tx.execute(sql`
      SELECT c.id,r.id AS run_id FROM cro03c_commands c
      JOIN cro03c_runs r ON r.command_id=c.id
      WHERE c.idempotency_key=${input.idempotencyKey}
    `))[0];
    if (replay) return { commandId: String(replay.id), runId: String(replay.run_id), replayed: true };

    const policy = rows(await tx.execute(sql`
      SELECT * FROM cro03c_activation_policies
       WHERE policy_key='cro03c_live_activation' AND status='approved'
       ORDER BY expected_revision DESC LIMIT 1
    `))[0];
    if (!policy || Number(policy.expected_revision) !== input.expectedActivationRevision) {
      throw new Error("CRO03C_ACTIVATION_REVISION_CONFLICT");
    }
    assertCro03cApprovalEvidence(policy.required_approvals ?? {});
    const pricing = policy.price_schedules ?? {};
    assertCro03cPriceSchedules(pricing);
    const validationMaxUnits = input.commandType === "initial_batch" ? distinctHandoffs.length : 0;
    const validationUnitAmountMicros = Number(pricing.zerobounce.amountMicros);
    const validationMaxAmountMicros = validationMaxUnits * validationUnitAmountMicros;
    if (!Number.isSafeInteger(validationMaxAmountMicros)) throw new Error("CRO03C_INITIAL_BATCH_CAP_INVALID");

    // continuous_occurrence: lock the schedule occurrence row NOW, inside
    // this same command-creation transaction, and derive caps from it and
    // its active schedule definition's budgets. The caller-supplied
    // maxUnits/maxAmountMicros are never trusted — this closes the gap where
    // a continuous command could otherwise be minted with an
    // arbitrary/nonexistent occurrence id and caller-chosen caps. The row
    // stays locked (FOR UPDATE) until this transaction commits or rolls
    // back, so a concurrent second command-creation attempt against the
    // same occurrence blocks here and then fails the cro03c_command_id
    // IS NULL check below once this transaction commits — guaranteeing at
    // most one continuous_occurrence command per occurrence even under a
    // race, without relying on a separate, optional bind step.
    let continuousDerivedMaxUnits = 0;
    let continuousDerivedMaxAmountMicros = 0;
    if (input.commandType === "continuous_occurrence") {
      const occurrence = rows(await tx.execute(sql`
        SELECT o.id, o.definition_hash, o.enumeration_checkpoint, o.selected_count, o.cro03c_command_id,
               d.id AS definition_id, d.active, d.certification_receipt_id, d.budgets
          FROM cro08a_schedule_occurrences o
          JOIN cro08a_schedule_definitions d ON d.id = o.schedule_definition_id
         WHERE o.id = ${input.scheduleOccurrenceId}::uuid
         FOR UPDATE OF o
      `))[0];
      if (!occurrence) throw new Error("CRO08A_SCHEDULE_OCCURRENCE_NOT_FOUND");
      if (occurrence.definition_hash !== input.scheduleDefinitionHash) throw new Error("CRO08A_SCHEDULE_DEFINITION_HASH_MISMATCH");
      if (occurrence.enumeration_checkpoint !== "committed") throw new Error("CRO08A_OCCURRENCE_ENUMERATION_NOT_COMMITTED");
      if (occurrence.cro03c_command_id) throw new Error("CRO08A_OCCURRENCE_ALREADY_BOUND_TO_COMMAND");
      if (!occurrence.active) throw new Error("CRO08A_SCHEDULE_DEFINITION_NOT_ACTIVE");
      if (!occurrence.certification_receipt_id) throw new Error("CRO08A_SCHEDULE_DEFINITION_UNCERTIFIED");
      const budgets = (occurrence.budgets ?? {}) as Record<string, { maxUnitsPerOccurrence?: number }>;
      const providerBudget = budgets[input.provider!];
      if (!providerBudget || !Number.isInteger(providerBudget.maxUnitsPerOccurrence) || providerBudget.maxUnitsPerOccurrence! < 0) {
        throw new Error("CRO08A_PROVIDER_BUDGET_UNDEFINED");
      }
      continuousDerivedMaxUnits = Math.min(Number(occurrence.selected_count), providerBudget.maxUnitsPerOccurrence!);
      // The occurrence's frozen enumeration is the sole authority for which
      // handoffs may receive provider work under this command: every
      // caller-supplied handoffId must be exact membership of the durable
      // selected-handoff set recorded at enumeration-commit time. A bare
      // selected_count comparison (above) cannot stop a caller from
      // substituting handoffs outside that authorized population.
      const authorizedRows = rows(await tx.execute(sql`
        SELECT handoff_id FROM cro08a_occurrence_selected_handoffs WHERE occurrence_id=${input.scheduleOccurrenceId}::uuid
      `));
      const authorizedSet = new Set(authorizedRows.map((r) => String(r.handoff_id)));
      if (authorizedSet.size === 0) throw new Error("CRO08A_OCCURRENCE_SELECTED_HANDOFFS_MISSING");
      for (const handoffId of distinctHandoffs) {
        if (!authorizedSet.has(handoffId)) throw new Error("CRO08A_HANDOFF_NOT_IN_OCCURRENCE_POPULATION");
      }
    }

    if (input.provider) {
      const schedule = pricing[input.provider] as Cro03cPriceSchedule;
      const contract = CRO03C_PROVIDER_CONTRACTS[input.provider];
      if (!schedule || !contract) throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
      if (input.commandType === "micro_canary" &&
          (input.maxUnits !== contract.maxCanaryUnits ||
           input.maxAmountMicros !== input.maxUnits * schedule.amountMicros)) {
        throw new Error("CRO03C_CANARY_CAP_INVALID");
      }
      if (input.commandType === "continuous_occurrence") {
        continuousDerivedMaxAmountMicros = continuousDerivedMaxUnits * schedule.amountMicros;
        if (!Number.isSafeInteger(continuousDerivedMaxAmountMicros)) throw new Error("CRO03C_CONTINUOUS_CAP_INVALID");
      }
    }
    const attestation = rows(await tx.execute(sql`
      SELECT t.*,r.inventory_id AS revoked_inventory_id,i.expires_at AS inventory_expires_at
        FROM cro03c_runtime_attestations t
        JOIN cro03c_deployment_inventories i ON i.id=t.inventory_id
        LEFT JOIN cro03c_deployment_inventory_revocations r ON r.inventory_id=i.id
       WHERE t.id=${input.runtimeAttestationId}::uuid
    `))[0];
    if (!attestation) throw new Error("CRO03C_RUNTIME_ATTESTATION_MISSING");
    if (attestation.revoked_inventory_id || new Date(attestation.inventory_expires_at).getTime() <= Date.now()) {
      throw new Error("CRO03C_DEPLOYMENT_INVENTORY_REVOKED");
    }
    const runtime: Cro03cRuntimeAttestation = {
      artifactSha: attestation.artifact_sha, migrationHead: attestation.migration_head,
      deploymentIdentity: attestation.deployment_identity, environmentIdentity: attestation.environment_identity,
      webBootIdentity: attestation.web_boot_identity, workerBootIdentity: attestation.worker_boot_identity,
      queueTopologyHash: attestation.queue_topology_hash, workerHeartbeatAt: attestation.worker_heartbeat_at,
      dbHealthy: attestation.db_healthy, redisHealthy: attestation.redis_healthy,
      capturedAt: attestation.captured_at, expiresAt: attestation.expires_at,
    };
    assertCro03cRuntimeAttestation(runtime, new Date(), "later");
    if (runtime.migrationHead !== CRO03C_MIGRATION_HEAD || runtime.artifactSha !== process.env.RELEASE_SHA) {
      throw new Error("CRO03C_RELEASE_MISMATCH");
    }
    const pause = await getPauseState();
    if (pause.state !== "paused" || pause.source === "safe_default") throw new Error("CRO03C_OUTBOUND_STATE_UNVERIFIED");

    const cohortHash = hashCro03Evidence({ handoffIds: [...distinctHandoffs].sort() });
    const stagePlanHash = stableCro03RecipeHash(CRO03B_UNIFIED_RECIPE.steps.map((step) => ({
      id: step.id, provider: step.provider, accountingOwner: step.accountingOwner,
    })));
    if (input.commandType === "initial_batch") {
      // A batch can only continue from a durable, successful canary under the
      // identical policy, release, recipe and stage plan.  The initial plan
      // carries only internal-source authority, so that is the sole applicable
      // provider at this boundary; later provider authority is separately
      // reviewed and never inferred from this continuation.
      const passed = rows(await tx.execute(sql`
        SELECT 1
          FROM cro03c_commands canary
          JOIN cro03c_runs canary_run ON canary_run.command_id=canary.id
          JOIN cro03c_runtime_attestations canary_runtime
            ON canary_runtime.id=canary.runtime_attestation_id
         WHERE canary.command_type='micro_canary'
           AND canary.state='completed' AND canary_run.state='completed'
           AND canary.activation_policy_id=${policy.id}::uuid
           AND canary.recipe_hash=${CRO03C_RECIPE_HASH}
           AND canary.stage_plan_hash=${stagePlanHash}
           AND canary_runtime.artifact_sha=${runtime.artifactSha}
           AND canary_runtime.migration_head=${CRO03C_MIGRATION_HEAD}
           AND canary.caps->>'provider'='internal_source'
           AND EXISTS (
             SELECT 1 FROM cro03c_stage_operations o
              JOIN cro03c_generations g ON g.id=o.generation_id
              JOIN cro03c_receipts receipt ON receipt.stage_operation_id=o.id
             WHERE g.command_id=canary.id
               AND o.provider='internal_source' AND o.state='completed'
               AND receipt.normalized_outcome='success'
           )
           AND NOT EXISTS (
             SELECT 1 FROM cro03c_stage_operations o
              JOIN cro03c_generations g ON g.id=o.generation_id
             WHERE g.command_id=canary.id AND o.state<>'completed'
           )
         LIMIT 1
      `))[0];
      if (!passed) throw new Error("CRO03C_APPLICABLE_CANARY_NOT_PASSED");
      // Serialize singleton reservation before any generation can be
      // dispatched. The primary-key row is the one-shot/no-successor fence.
      const singleton = rows(await tx.execute(sql`
        SELECT command_id FROM cro03c_initial_rollouts
         WHERE rollout_key=${CRO03C_INITIAL_ROLLOUT_KEY} FOR UPDATE
      `))[0];
      if (singleton) throw new Error("CRO03C_INITIAL_ROLLOUT_ALREADY_CONSUMED");
    }
    const commandId = randomUUID();
    const runId = randomUUID();
    const commandCaps = input.commandType === "initial_batch"
      ? {
          // Initial rollout authority is intentionally bounded to consuming
          // immutable internal evidence.  A later provider requires its own
          // command/generation decision; recipe adjacency is not authority.
          provider: "internal_source", maxUnits: 0, maxAmountMicros: 0,
          validationMaxUnits, validationMaxAmountMicros,
          validationPriceScheduleVersion: Number(pricing.zerobounce.version),
          validationPriceScheduleHash: stableCro03RecipeHash(pricing.zerobounce),
        }
      : input.commandType === "continuous_occurrence"
      ? {
          // A continuous_occurrence command reserves and settles real
          // provider spend (unlike initial_batch) but, unlike micro_canary,
          // its unit ceiling is server-derived above from the locked
          // schedule occurrence/definition budgets — never from the caller.
          provider: input.provider, maxUnits: continuousDerivedMaxUnits, maxAmountMicros: continuousDerivedMaxAmountMicros,
          scheduleOccurrenceId: input.scheduleOccurrenceId, scheduleDefinitionHash: input.scheduleDefinitionHash,
        }
      : { provider: input.provider, maxUnits: input.maxUnits, maxAmountMicros: input.maxAmountMicros };
    // The command key binds the server-derived caps into command identity; an
    // idempotency token can never silently identify a differently capped
    // scope. For continuous_occurrence, the schedule occurrence id is also
    // folded in directly (in addition to being inside commandCaps) so a
    // second create attempt against the same occurrence always replays
    // rather than minting a second command bound to the same occurrence.
    const commandKey = `cro03c:${input.commandType}:${stableCro03RecipeHash({
      idempotencyKey: input.idempotencyKey, cohortHash, caps: commandCaps,
      activationRevision: Number(policy.expected_revision), runtimeAttestationId: input.runtimeAttestationId,
      scheduleOccurrenceId: input.scheduleOccurrenceId ?? null,
    })}`;
    await tx.execute(sql`
      INSERT INTO cro03c_commands
        (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,
         recipe_version,recipe_hash,stage_plan_hash,cohort_hash,runtime_attestation_id,caps,
         stop_policy_hash,approval_evidence,state,expires_at,reason,pre_pause_epoch)
      VALUES (${commandId}::uuid,${commandKey},${input.idempotencyKey},${input.commandType},${input.actorId},
              ${policy.id}::uuid,${policy.expected_revision},${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},
              ${stagePlanHash},${cohortHash},${input.runtimeAttestationId}::uuid,
               ${JSON.stringify(commandCaps)}::jsonb,
              ${policy.policy_hash},${JSON.stringify(policy.required_approvals)}::jsonb,'queued',
              ${expiresAt}::timestamptz,${input.reason.trim()},${String(pause.epoch)})
    `);
    await tx.execute(sql`
      INSERT INTO cro03c_runs(id,command_id,run_key,mode)
      VALUES (${runId}::uuid,${commandId}::uuid,${`cro03c:run:${commandId}`},
              ${resolveCro03cGenerationMode(input.commandType)})
    `);
    if (input.commandType === "continuous_occurrence") {
      // Bind the occurrence to this command in the SAME transaction as
      // command creation, while the occurrence row is still locked from the
      // earlier SELECT ... FOR UPDATE above. This is the atomic 1:1 bind
      // (not the separate, optional bindCro08aOccurrenceCommand helper,
      // which remains only as a manual repair utility for operators).
      const bound = await tx.execute(sql`
        UPDATE cro08a_schedule_occurrences
           SET cro03c_command_id=${commandId}::uuid, state='reconciling', updated_at=NOW()
         WHERE id=${input.scheduleOccurrenceId}::uuid
           AND enumeration_checkpoint='committed'
           AND cro03c_command_id IS NULL
      `);
      if (((bound as any).rowCount ?? 0) !== 1) throw new Error("CRO08A_OCCURRENCE_BIND_FAILED");
    }
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.command.created','cro03c_command',${commandId},
              ${JSON.stringify({ idempotencyKey: input.idempotencyKey, commandType: input.commandType, activationRevision: Number(policy.expected_revision), runId })}::jsonb,
              'user',${input.actorId})
    `);
    // This is observational only. CRO-03C must never mutate pause state to
    // manufacture a no-outbound result.
    const counters = await readCro03cGlobalNoOutboundCounters();
    const snapshotHash = hashCro03Evidence(counters);
    const snapshot = rows(await tx.execute(sql`
      INSERT INTO cro03c_no_outbound_snapshots(command_id,run_id,phase,snapshot_hash,counters)
      VALUES (${commandId}::uuid,${runId}::uuid,'pre_run',${snapshotHash},${JSON.stringify(counters)}::jsonb)
      RETURNING id
    `))[0];
    await tx.execute(sql`UPDATE cro03c_commands SET pre_run_snapshot_id=${snapshot.id}::uuid WHERE id=${commandId}::uuid`);
    for (const handoffId of distinctHandoffs) {
      const handoff = await assertEligibleHandoff(tx, handoffId);
      // Read the immutable CRO03A occurrence/observation here, while the
      // command transaction is open. No request or browser-provided field can
      // become provider authority after this point.
      const sourceEvidence = rows(await tx.execute(sql`
        SELECT o.id AS observation_id,o.payload,o.payload_hash
          FROM cro03a_handoffs h
          JOIN cro03_source_occurrences c
            ON c.id = ANY(ARRAY(SELECT jsonb_array_elements_text(h.occurrence_ids)::uuid))
          JOIN cro03_source_observations o ON o.id=c.source_observation_id
         WHERE h.id=${handoffId}::uuid
         ORDER BY c.source_observed_at DESC,c.id DESC LIMIT 1
      `))[0];
      if (!sourceEvidence) throw new Error("CRO03C_HANDOFF_EVIDENCE_MISSING");
      handoff.payload_hash = sourceEvidence.payload_hash;
      const frozenHandoffHash = hashCro03Evidence({
        handoffId: handoff.id, decisionId: handoff.decision_id, sourceType: handoff.source_type,
        sourceSystem: handoff.source_system, sourceKey: handoff.source_key, policyHash: handoff.policy_hash,
        occurrenceIds: handoff.frozen_occurrence_ids, selectionHash: handoff.selection_hash,
      });
      const generation = rows(await tx.execute(sql`
        INSERT INTO cro03c_generations
          (handoff_id,recipe_version,recipe_hash,mode,activation_revision,command_id,run_id,
           frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id)
        VALUES (${handoffId}::uuid,${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},${resolveCro03cGenerationMode(input.commandType)},
                ${policy.expected_revision},${commandId}::uuid,${runId}::uuid,${frozenHandoffHash},
                 ${stagePlanHash},${cohortHash},${input.runtimeAttestationId}::uuid)
        RETURNING id
      `))[0];
      const stagePlans = planCro03cEvidenceStages({
        payload: sourceEvidence.payload ?? {},
        commandType: input.commandType,
        caps: commandCaps,
        pricing,
        source: { observation_id: sourceEvidence.observation_id, payload_hash: sourceEvidence.payload_hash },
      });
      for (const step of CRO03B_UNIFIED_RECIPE.steps) {
        const plan = stagePlans.find((candidate) => candidate.stageKey === step.id);
        if (!plan) throw new Error("CRO03C_STAGE_PLAN_MISSING");
        const plannedProvider = plan.provider;
        const disposition = plan.disposition;
        const providerInput = disposition === "eligible" && plannedProvider
          ? deriveCro03cProviderInput(plannedProvider, sourceEvidence.payload ?? {}, pricing[plannedProvider], sourceEvidence)
          : null;
        const frozenEvidence = {
          handoffId,
          provider: step.provider,
          sourceType: handoff.source_type,
          sourceSystem: handoff.source_system,
          sourceKeyHash: hashCro03Evidence({ sourceKey: handoff.source_key }),
          commandType: input.commandType,
        };
        const inputHash = hashCro03Evidence(providerInput ?? frozenEvidence);
        let stageInputReferenceId: string | null = null;
        if (disposition === "eligible" && providerInput) {
          const schedule = pricing[plannedProvider!];
          const reservedUnits = Number(providerInput.reservedUnits);
          const reference = rows(await tx.execute(sql`
            INSERT INTO cro03c_stage_input_references
              (generation_id,stage_key,source_observation_id,source_payload_hash,evidence_hash,provider,
               price_schedule_version,price_schedule_hash,reserved_units,units_hash,cap_hash)
            VALUES (${generation.id}::uuid,${step.id},${sourceEvidence.observation_id}::uuid,${sourceEvidence.payload_hash},
                    ${frozenHandoffHash},${String(plannedProvider)},${Number(schedule.version)},
                    ${stableCro03RecipeHash(schedule)},${reservedUnits},
                    ${hashCro03Evidence({ provider: plannedProvider, reservedUnits })},
                     ${hashCro03Evidence(commandCaps)})
            RETURNING id
          `))[0];
          stageInputReferenceId = String(reference.id);
        }
        await tx.execute(sql`
          INSERT INTO cro03c_stage_dispositions
            (generation_id,stage_key,disposition,input_hash,evidence_hash,recipe_hash,policy_hash,reason_code,stage_input_reference_id)
          VALUES (${generation.id}::uuid,${step.id},${disposition},${inputHash},
                  ${frozenHandoffHash},${stableCro03RecipeHash(step)},${policy.policy_hash},
                    ${plan.reasonCode},
                   ${stageInputReferenceId}::uuid)
        `);
      }
    }
    if (input.commandType === "initial_batch") {
      const generationRows = rows(await tx.execute(sql`
        SELECT id,frozen_handoff_hash FROM cro03c_generations WHERE command_id=${commandId}::uuid ORDER BY id
      `));
      await tx.execute(sql`
        INSERT INTO cro03c_initial_rollouts(rollout_key,command_id,activation_revision,membership_hash)
        VALUES (${CRO03C_INITIAL_ROLLOUT_KEY},${commandId}::uuid,${policy.expected_revision},
                ${hashCro03Evidence({ generationIds: generationRows.map((row) => row.id), cohortHash })})
      `);
      for (const [ordinal, generation] of generationRows.entries()) {
        await tx.execute(sql`
          INSERT INTO cro03c_initial_memberships(rollout_key,generation_id,ordinal,handoff_hash)
          VALUES (${CRO03C_INITIAL_ROLLOUT_KEY},${generation.id}::uuid,${ordinal + 1},${generation.frozen_handoff_hash})
        `);
      }
    }
    return { commandId, runId, replayed: false };
  });
  if (!created.replayed) {
    // Producer-only access cannot start workers from a command request.  A
    // missed enqueue is safe: the bounded CRO03C_LIVE recovery schedule owns
    // recovery after QueueManager startup.
    try {
      const { getQueueManagerProducers, QUEUE_NAMES } = await import("../queue-manager");
      const queue = getQueueManagerProducers()?.getQueue(QUEUE_NAMES.CRO03C_LIVE);
      await queue?.add("dispatch", { commandId: created.commandId }, { jobId: `cro03c-live:${created.commandId}` });
    } catch {
      // Do not fail a committed command due to Redis/producer availability.
    }
  }
  return created;
}

export async function assertCro03cAuthorityBeforeIo(context: Cro03cLiveProviderContext): Promise<void> {
  assertCro03cLiveContext(context);
  const authority = rows(await db.execute(sql`
    SELECT c.state AS command_state,c.activation_revision,c.recipe_hash,c.stage_plan_hash,c.expires_at,
           c.cancel_requested_at,r.state AS run_state,r.claim_token,r.execution_fence,
           g.state AS generation_state,g.claim_token AS generation_claim_token,
            a.status AS policy_status,a.expected_revision,a.price_schedules,a.required_approvals,
            t.inventory_id,t.worker_identities,t.artifact_sha,t.migration_head,t.deployment_identity,t.environment_identity,
           t.web_boot_identity,t.worker_boot_identity,t.queue_topology_hash,t.worker_heartbeat_at,
           t.db_healthy,t.redis_healthy,t.captured_at,t.expires_at AS attestation_expires_at,
           s.snapshot_hash,d.disposition
      FROM cro03c_commands c
      JOIN cro03c_runs r ON r.command_id=c.id
      JOIN cro03c_generations g ON g.run_id=r.id
      JOIN cro03c_activation_policies a ON a.id=c.activation_policy_id
      JOIN cro03c_runtime_attestations t ON t.id=c.runtime_attestation_id
      JOIN cro03c_no_outbound_snapshots s ON s.id=c.pre_run_snapshot_id
      JOIN cro03c_stage_dispositions d ON d.generation_id=g.id AND d.stage_key=${context.stageKey}
     WHERE c.id=${context.commandId}::uuid AND r.id=${context.runId}::uuid
       AND g.id=${context.generationId}::uuid
       AND c.runtime_attestation_id=${context.runtimeAttestationId}::uuid
  `))[0];
  if (!authority || authority.disposition !== "eligible" ||
      authority.command_state !== "running" || authority.run_state !== "running" ||
      authority.generation_state !== "running" ||
      String(authority.claim_token) !== context.claimToken ||
      String(authority.generation_claim_token) !== context.claimToken ||
      Number(authority.execution_fence) !== context.executionFence ||
      authority.cancel_requested_at || authority.policy_status !== "approved" ||
      Number(authority.expected_revision) !== context.activationRevision ||
      authority.snapshot_hash !== context.noOutboundSnapshotHash) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  if (new Date(authority.expires_at).getTime() <= Date.now()) throw new Error("CRO03C_COMMAND_EXPIRED");
  // A command is not grandfathered when its activation is superseded or when
  // any immutable receipt it references expires/revokes.  Re-read this at the
  // irreversible I/O boundary rather than trusting admission-time evidence.
  const active = rows(await db.execute(sql`
    SELECT expected_revision FROM cro03c_activation_policies
     WHERE policy_key='cro03c_live_activation' AND status='approved'
     ORDER BY expected_revision DESC LIMIT 1
  `))[0];
  if (!active || Number(active.expected_revision) !== Number(authority.activation_revision)) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  const evidence = authority.required_approvals ?? {};
  const receiptIds = CRO03C_REQUIRED_APPROVALS.map((dimension) => evidence[dimension]?.approvalId);
  if (receiptIds.some((id) => typeof id !== "string")) throw new Error("CRO03C_AUTHORITY_REVOKED");
  const receiptCheck = rows(await db.execute(sql`
    SELECT r.*,v.receipt_id AS revoked_receipt_id
      FROM cro03c_approval_receipts r
      LEFT JOIN cro03c_approval_receipt_revocations v ON v.receipt_id=r.id
     WHERE r.id IN (${sql.join(receiptIds.map((id: string) => sql`${id}::uuid`), sql`, `)})
  `));
  const expectedScopeHash = stableCro03RecipeHash(cro03cApprovalScope(authority.price_schedules));
  try {
    for (const receipt of receiptCheck) {
      verifyCro03cApprovalArtifact(artifactFromCro03cReceiptRow(receipt));
    }
  } catch {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  if (receiptCheck.length !== CRO03C_REQUIRED_APPROVALS.length ||
      receiptCheck.some((receipt: any) => receipt.revoked_receipt_id ||
        new Date(receipt.expires_at).getTime() <= Date.now() || receipt.scope_hash !== expectedScopeHash) ||
      new Set(receiptCheck.map((receipt: any) => receipt.dimension)).size !== CRO03C_REQUIRED_APPROVALS.length) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  assertCro03cRuntimeAttestation({
    artifactSha: authority.artifact_sha, migrationHead: authority.migration_head,
    deploymentIdentity: authority.deployment_identity, environmentIdentity: authority.environment_identity,
    webBootIdentity: authority.web_boot_identity, workerBootIdentity: authority.worker_boot_identity,
    queueTopologyHash: authority.queue_topology_hash, workerHeartbeatAt: authority.worker_heartbeat_at,
    dbHealthy: authority.db_healthy, redisHealthy: authority.redis_healthy,
    capturedAt: authority.captured_at, expiresAt: authority.attestation_expires_at,
  }, new Date(), "later");
  if (authority.artifact_sha !== process.env.RELEASE_SHA || authority.migration_head !== CRO03C_MIGRATION_HEAD) {
    throw new Error("CRO03C_RELEASE_MISMATCH");
  }
  await assertCro03cDeploymentAuthorityBeforeIo({
    runtimeAttestationId: context.runtimeAttestationId,
    inventoryId: String(authority.inventory_id ?? ""),
  });
  const pause = await getPauseState();
  if (pause.state !== "paused" || pause.source === "safe_default") throw new Error("CRO03C_OUTBOUND_STATE_UNVERIFIED");
}

/**
 * Fresh command-level authority check for effects with a separate durable
 * intent claim.  Keep this independent of stage claim tokens: the caller's
 * claim is deliberately not CRO03C dispatch authority.  This is intentionally
 * a complete live revalidation, not an admission-time policy lookup.
 */
export async function assertCro03cCommandAuthorityBeforeIo(context: Cro03cCommandAuthorityContext): Promise<void> {
  if (!context.commandId || !context.runId || !context.generationId || !context.runtimeAttestationId ||
      !Number.isInteger(context.activationRevision) || context.activationRevision < 1) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  const authority = rows(await db.execute(sql`
    SELECT c.state AS command_state,c.activation_revision,c.recipe_hash,c.stage_plan_hash,c.expires_at,
           c.cancel_requested_at,c.runtime_attestation_id AS command_runtime_attestation_id,
           r.state AS run_state,r.command_id AS run_command_id,
           g.state AS generation_state,g.command_id AS generation_command_id,g.run_id AS generation_run_id,
           g.activation_revision AS generation_activation_revision,
           g.runtime_attestation_id AS generation_runtime_attestation_id,
           a.status AS policy_status,a.expected_revision,a.price_schedules,a.required_approvals,
           t.inventory_id,t.worker_identities,t.artifact_sha,t.migration_head,t.deployment_identity,t.environment_identity,
           t.web_boot_identity,t.worker_boot_identity,t.queue_topology_hash,t.worker_heartbeat_at,
           t.db_healthy,t.redis_healthy,t.captured_at,t.expires_at AS attestation_expires_at
      FROM cro03c_commands c
      JOIN cro03c_runs r ON r.command_id=c.id
      JOIN cro03c_generations g ON g.run_id=r.id
      JOIN cro03c_activation_policies a ON a.id=c.activation_policy_id
      JOIN cro03c_runtime_attestations t ON t.id=c.runtime_attestation_id
     WHERE c.id=${context.commandId}::uuid AND r.id=${context.runId}::uuid
       AND g.id=${context.generationId}::uuid
       AND c.runtime_attestation_id=${context.runtimeAttestationId}::uuid
  `))[0];
  if (!authority || authority.command_state !== "running" || authority.run_state !== "running" ||
      authority.generation_state !== "running" || authority.cancel_requested_at ||
      String(authority.run_command_id) !== context.commandId ||
      String(authority.generation_command_id) !== context.commandId ||
      String(authority.generation_run_id) !== context.runId ||
      String(authority.command_runtime_attestation_id) !== context.runtimeAttestationId ||
      String(authority.generation_runtime_attestation_id) !== context.runtimeAttestationId ||
      Number(authority.activation_revision) !== context.activationRevision ||
      Number(authority.generation_activation_revision) !== context.activationRevision ||
      authority.policy_status !== "approved" ||
      Number(authority.expected_revision) !== context.activationRevision ||
      authority.recipe_hash !== CRO03C_RECIPE_HASH ||
      authority.stage_plan_hash !== cro03cStagePlanHash()) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  if (new Date(authority.expires_at).getTime() <= Date.now()) throw new Error("CRO03C_COMMAND_EXPIRED");
  const active = rows(await db.execute(sql`
    SELECT expected_revision FROM cro03c_activation_policies
     WHERE policy_key='cro03c_live_activation' AND status='approved'
     ORDER BY expected_revision DESC LIMIT 1
  `))[0];
  if (!active || Number(active.expected_revision) !== context.activationRevision) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  const evidence = authority.required_approvals ?? {};
  const receiptIds = CRO03C_REQUIRED_APPROVALS.map((dimension) => evidence[dimension]?.approvalId);
  if (receiptIds.some((id) => typeof id !== "string") || new Set(receiptIds).size !== receiptIds.length) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  const receiptCheck = rows(await db.execute(sql`
    SELECT r.*,v.receipt_id AS revoked_receipt_id
      FROM cro03c_approval_receipts r
      LEFT JOIN cro03c_approval_receipt_revocations v ON v.receipt_id=r.id
     WHERE r.id IN (${sql.join(receiptIds.map((id: string) => sql`${id}::uuid`), sql`, `)})
  `));
  const expectedScopeHash = stableCro03RecipeHash(cro03cApprovalScope(authority.price_schedules));
  try {
    assertCro03cPriceSchedules(authority.price_schedules);
    for (const receipt of receiptCheck) {
      verifyCro03cApprovalArtifact(artifactFromCro03cReceiptRow(receipt));
    }
  } catch {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  if (receiptCheck.length !== CRO03C_REQUIRED_APPROVALS.length ||
      receiptCheck.some((receipt: any) => receipt.revoked_receipt_id ||
        new Date(receipt.expires_at).getTime() <= Date.now() ||
        receipt.scope_hash !== expectedScopeHash ||
        stableCro03RecipeHash(receipt.scope) !== expectedScopeHash ||
        String(receipt.id) !== evidence[receipt.dimension]?.approvalId) ||
      new Set(receiptCheck.map((receipt: any) => receipt.dimension)).size !== CRO03C_REQUIRED_APPROVALS.length) {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
  try {
    assertCro03cRuntimeAttestation({
      artifactSha: authority.artifact_sha, migrationHead: authority.migration_head,
      deploymentIdentity: authority.deployment_identity, environmentIdentity: authority.environment_identity,
      webBootIdentity: authority.web_boot_identity, workerBootIdentity: authority.worker_boot_identity,
      queueTopologyHash: authority.queue_topology_hash, workerHeartbeatAt: authority.worker_heartbeat_at,
      dbHealthy: authority.db_healthy, redisHealthy: authority.redis_healthy,
      capturedAt: authority.captured_at, expiresAt: authority.attestation_expires_at,
    }, new Date(), "later");
    if (authority.artifact_sha !== process.env.RELEASE_SHA || authority.migration_head !== CRO03C_MIGRATION_HEAD) {
      throw new Error("CRO03C_RELEASE_MISMATCH");
    }
    await assertCro03cDeploymentAuthorityBeforeIo({
      runtimeAttestationId: context.runtimeAttestationId,
      inventoryId: String(authority.inventory_id ?? ""),
    });
    const pause = await getPauseState();
    if (pause.state !== "paused" || pause.source === "safe_default") {
      throw new Error("CRO03C_OUTBOUND_STATE_UNVERIFIED");
    }
  } catch {
    throw new Error("CRO03C_AUTHORITY_REVOKED");
  }
}

/**
 * The deployment inventory is a live authority, not an admission-time fact.
 * This intentionally performs fresh database, trust-root, and Redis reads on
 * every call; do not cache its result or relax the fresh Redis heartbeat age.
 * The persisted attestation heartbeat is capture evidence only.
 */
export async function assertCro03cDeploymentAuthorityBeforeIo(input: {
  runtimeAttestationId: string;
  inventoryId: string;
}): Promise<void> {
  if (!input.runtimeAttestationId || !input.inventoryId) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_MISSING");
  }
  const authority = rows(await db.execute(sql`
    SELECT t.id AS runtime_attestation_id,t.inventory_id,t.worker_identities,
           t.artifact_sha,t.migration_head,t.deployment_identity,t.environment_identity,
           t.web_boot_identity,t.worker_boot_identity,t.queue_topology_hash,
           t.worker_heartbeat_at,t.db_healthy,t.redis_healthy,t.captured_at,
           t.expires_at AS attestation_expires_at,i.issuer_id,i.payload,i.signature,
           rev.inventory_id AS revoked_inventory_id
      FROM cro03c_runtime_attestations t
      JOIN cro03c_deployment_inventories i ON i.id=t.inventory_id
      LEFT JOIN cro03c_deployment_inventory_revocations rev ON rev.inventory_id=i.id
     WHERE t.id=${input.runtimeAttestationId}::uuid
       AND t.inventory_id=${input.inventoryId}::uuid
     LIMIT 1
  `))[0];
  if (!authority || authority.revoked_inventory_id) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_REVOKED");
  }
  let inventory;
  try {
    const payload = typeof authority.payload === "string" ? JSON.parse(authority.payload) : authority.payload;
    inventory = verifyCro03cDeploymentInventory({
      payload,
      signature: String(authority.signature),
    } as Cro03cSignedDeploymentInventory);
  } catch {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_REVOKED");
  }
  const workers = Array.isArray(authority.worker_identities) ? authority.worker_identities : [];
  const exactWorkers = workers.length === inventory.workerIdentities.length &&
    [...workers].sort().every((identity, index) => identity === [...inventory.workerIdentities].sort()[index]);
  if (inventory.inventoryId !== input.inventoryId ||
      inventory.issuerId !== authority.issuer_id ||
      inventory.releaseSha !== authority.artifact_sha ||
      inventory.deploymentIdentity !== authority.deployment_identity ||
      inventory.environmentIdentity !== authority.environment_identity ||
      inventory.queueTopologyHash !== authority.queue_topology_hash ||
      !exactWorkers ||
      authority.artifact_sha !== process.env.RELEASE_SHA ||
      authority.migration_head !== CRO03C_MIGRATION_HEAD) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_MISMATCH");
  }
  assertCro03cRuntimeAttestation({
    inventoryId: String(authority.inventory_id),
    workerIdentities: workers,
    artifactSha: authority.artifact_sha, migrationHead: authority.migration_head,
    deploymentIdentity: authority.deployment_identity, environmentIdentity: authority.environment_identity,
    webBootIdentity: authority.web_boot_identity, workerBootIdentity: authority.worker_boot_identity,
    queueTopologyHash: authority.queue_topology_hash, workerHeartbeatAt: authority.worker_heartbeat_at,
    dbHealthy: authority.db_healthy, redisHealthy: authority.redis_healthy,
    capturedAt: authority.captured_at, expiresAt: authority.attestation_expires_at,
  }, new Date(), "later");
  const redis = getSharedRedisClient();
  if (!redis) throw new Error("CRO03C_WORKER_ATTESTATION_UNAVAILABLE");
  let fleet;
  try {
    fleet = await readCro03cWorkerFleet({
      redis, prefix: getBullMqTestPrefix(), expectedReleaseSha: inventory.releaseSha,
      expectedQueueTopologyHash: inventory.queueTopologyHash,
      expectedProcessIdentities: inventory.workerIdentities, now: new Date(),
    });
  } catch {
    throw new Error("CRO03C_WORKER_FLEET_INVALID");
  }
  if (!fleet.complete) throw new Error("CRO03C_WORKER_FLEET_SCAN_INCOMPLETE");
}

async function assertEligibleHandoff(tx: any, handoffId: string): Promise<any> {
  const handoff = rows(await tx.execute(sql`
    SELECT h.*,d.disposition
      FROM cro03a_handoffs h
      JOIN cro03a_qualification_decisions d ON d.id=h.decision_id
      WHERE h.id=${handoffId}::uuid AND h.effect_authorized=TRUE AND d.disposition IN ('selected','qualified')
     FOR UPDATE OF h
  `))[0];
  if (!handoff) throw new Error("CRO03C_HANDOFF_NOT_ELIGIBLE");
  const priorDenied = rows(await tx.execute(sql`
    SELECT 1 FROM cro03b_recipe_items
     WHERE handoff_id=${handoffId}::uuid AND recipe_version=${CRO03C_RECIPE_VERSION}
     LIMIT 1
  `))[0];
  if (priorDenied) throw new Error("CRO03C_HANDOFF_ALREADY_CONSUMED");
  const priorGeneration = rows(await tx.execute(sql`
    SELECT 1 FROM cro03c_generations
     WHERE handoff_id=${handoffId}::uuid AND recipe_version=${CRO03C_RECIPE_VERSION}
     LIMIT 1
  `))[0];
  if (priorGeneration) throw new Error("CRO03C_HANDOFF_ALREADY_CONSUMED");
  return handoff;
}

export async function createCro03cGeneration(input: {
  commandId: string;
  runId: string;
  handoffId: string;
  activationRevision: number;
  runtimeAttestationId: string;
  stagePlanHash: string;
  cohortHash: string;
}): Promise<{ id: string; replayed: boolean }> {
  requireHash(input.stagePlanHash, "STAGE_PLAN");
  requireHash(input.cohortHash, "COHORT");
  return db.transaction(async (tx) => {
    const handoff = await assertEligibleHandoff(tx, input.handoffId);
    const frozenHandoffHash = hashCro03Evidence({
      handoffId: handoff.id, decisionId: handoff.decision_id, sourceType: handoff.source_type,
      sourceSystem: handoff.source_system, sourceKey: handoff.source_key,
      policyId: handoff.policy_id, policyHash: handoff.policy_hash,
      occurrenceIds: handoff.frozen_occurrence_ids, selectionHash: handoff.selection_hash,
    });
    const prior = rows(await tx.execute(sql`
      SELECT id,frozen_handoff_hash,stage_plan_hash,cohort_hash FROM cro03c_generations
       WHERE handoff_id=${input.handoffId}::uuid AND recipe_version=${CRO03C_RECIPE_VERSION}
    `))[0];
    if (prior) {
      if (prior.frozen_handoff_hash !== frozenHandoffHash ||
          prior.stage_plan_hash !== input.stagePlanHash || prior.cohort_hash !== input.cohortHash) {
        throw new Error("CRO03C_GENERATION_IDENTITY_CONFLICT");
      }
      return { id: String(prior.id), replayed: true };
    }
    const generation = rows(await tx.execute(sql`
      INSERT INTO cro03c_generations
        (handoff_id,recipe_version,recipe_hash,mode,activation_revision,command_id,run_id,
         frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id)
      VALUES (${input.handoffId}::uuid,${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},${CRO03C_MODE},
              ${input.activationRevision},${input.commandId}::uuid,${input.runId}::uuid,
              ${frozenHandoffHash},${input.stagePlanHash},${input.cohortHash},
              ${input.runtimeAttestationId}::uuid)
      RETURNING id
    `))[0];
    return { id: String(generation.id), replayed: false };
  });
}

export async function planCro03cStage(input: {
  generationId: string;
  stageKey: string;
  disposition: Cro03cStageDisposition;
  reasonCode: string;
  inputHash: string;
  evidenceHash: string;
  policyHash: string;
}): Promise<{ id: string; replayed: boolean }> {
  assertCro03cStageDisposition(input.disposition);
  for (const [value, name] of [[input.inputHash, "INPUT"], [input.evidenceHash, "EVIDENCE"], [input.policyHash, "POLICY"]] as const) requireHash(value, name);
  const stage = CRO03B_UNIFIED_RECIPE.steps.find((step) => step.id === input.stageKey);
  if (!stage) throw new Error("CRO03C_STAGE_NOT_IN_RECIPE");
  const recipeHash = stableCro03RecipeHash(stage);
  const inserted = rows(await db.execute(sql`
    INSERT INTO cro03c_stage_dispositions
      (generation_id,stage_key,disposition,input_hash,evidence_hash,recipe_hash,policy_hash,reason_code)
    VALUES (${input.generationId}::uuid,${input.stageKey},${input.disposition},${input.inputHash},
            ${input.evidenceHash},${recipeHash},${input.policyHash},${input.reasonCode})
    ON CONFLICT (generation_id,stage_key) DO NOTHING
    RETURNING id
  `))[0];
  if (inserted) return { id: String(inserted.id), replayed: false };
  const prior = rows(await db.execute(sql`
    SELECT id,disposition,input_hash,evidence_hash,policy_hash FROM cro03c_stage_dispositions
     WHERE generation_id=${input.generationId}::uuid AND stage_key=${input.stageKey}
  `))[0];
  if (!prior || prior.disposition !== input.disposition || prior.input_hash !== input.inputHash ||
      prior.evidence_hash !== input.evidenceHash || prior.policy_hash !== input.policyHash) {
    throw new Error("CRO03C_STAGE_PLAN_CONFLICT");
  }
  return { id: String(prior.id), replayed: true };
}

export async function assertCro03cStageEligible(generationId: string, stageKey: string): Promise<void> {
  const stage = rows(await db.execute(sql`
    SELECT disposition FROM cro03c_stage_dispositions
     WHERE generation_id=${generationId}::uuid AND stage_key=${stageKey}
  `))[0];
  if (!stage) throw new Error("CRO03C_STAGE_DISPOSITION_MISSING");
  if (stage.disposition !== "eligible") throw new Error("CRO03C_STAGE_NOT_ELIGIBLE");
}

export async function reserveCro03cProviderOperation(input: {
  generationId: string;
  stageKey: string;
  provider: string;
  operationType: string;
  operationKey: string;
  caller: string;
  requestedUnits: number;
  maxAmountMicros: number;
  priceScheduleVersion: number;
  priceScheduleHash: string;
  activationRevision: number;
}): Promise<{ id: string; replayed: boolean }> {
  await assertCro03cStageEligible(input.generationId, input.stageKey);
  const contract = CRO03C_PROVIDER_CONTRACTS[input.provider];
  if (!contract || !input.caller.startsWith("server/services/cro03/")) throw new Error("CRO03C_PROVIDER_AUTHORITY_DENIED");
  if (!Number.isInteger(input.requestedUnits) || input.requestedUnits < 0 ||
      !Number.isInteger(input.maxAmountMicros) || input.maxAmountMicros < 0) throw new Error("CRO03C_CAP_INVALID");
  if (!Number.isInteger(input.priceScheduleVersion) || input.priceScheduleVersion < 1) throw new Error("CRO03C_PRICE_SCHEDULE_INVALID");
  requireHash(input.priceScheduleHash, "PRICE_SCHEDULE");
  const prior = rows(await db.execute(sql`
    SELECT id,max_reserved_units,max_reserved_amount_micros FROM cro03c_stage_operations WHERE operation_key=${input.operationKey}
  `))[0];
  if (prior) {
    if (Number(prior.max_reserved_units) !== input.requestedUnits ||
        Number(prior.max_reserved_amount_micros) !== input.maxAmountMicros) throw new Error("CRO03C_OPERATION_IDENTITY_CONFLICT");
    return { id: String(prior.id), replayed: true };
  }
  // The remainder runs inside a transaction that locks the owning command row
  // (FOR UPDATE OF c). That lock serializes every concurrent reservation
  // attempt against the same command, which is what makes the continuous_
  // occurrence aggregate-budget check below atomic: two concurrent stage
  // operations for the same command can never both read the same "sum so
  // far" and both slip under the cap — the second reservation always sees
  // the first one's committed row before it computes its own sum.
  return db.transaction(async (tx) => {
    const authority = rows(await tx.execute(sql`
      SELECT c.id AS command_id,c.caps,c.command_type,c.state,c.cancel_requested_at,c.expires_at,a.price_schedules
        FROM cro03c_generations g
        JOIN cro03c_commands c ON c.id=g.command_id
        JOIN cro03c_activation_policies a ON a.id=c.activation_policy_id
       WHERE g.id=${input.generationId}::uuid
       FOR UPDATE OF c
    `))[0];
    if (!authority || authority.state !== "running" || authority.cancel_requested_at ||
        new Date(authority.expires_at).getTime() <= Date.now()) throw new Error("CRO03C_AUTHORITY_REVOKED");
    // continuous_occurrence commands carry their own server-derived, per-command
    // caps.maxUnits ceiling (validated below against authority.caps) rather than
    // the fixed micro-canary sample-size ceiling; the canary ceiling only
    // applies to actual micro_canary commands and legacy initial_batch stages.
    if (input.requestedUnits > contract.maxCanaryUnits && input.stageKey !== "initial_batch" &&
        authority.command_type !== "continuous_occurrence") {
      throw new Error("CRO03C_PROVIDER_CAP_EXCEEDED");
    }
    const schedule = (authority.price_schedules ?? {})[input.provider] as Cro03cPriceSchedule | undefined;
    if (!schedule || schedule.version !== input.priceScheduleVersion ||
        stableCro03RecipeHash(schedule) !== input.priceScheduleHash) throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
    const caps = authority.caps ?? {};
    if (caps.provider !== input.provider || input.requestedUnits > Number(caps.maxUnits) ||
        input.maxAmountMicros > Number(caps.maxAmountMicros) ||
        input.maxAmountMicros !== input.requestedUnits * schedule.amountMicros) {
      throw new Error("CRO03C_PROVIDER_CAP_EXCEEDED");
    }
    if (authority.command_type === "continuous_occurrence") {
      // Aggregate cap: sum every reservation already made under this command
      // (across all its generations/stages, excluding ones that were fully
      // released back with zero settlement) plus this new request must not
      // exceed the command's own caps.maxUnits/maxAmountMicros ceiling. A
      // per-reservation check alone (above) is not sufficient — many small
      // reservations under the per-op ceiling could otherwise sum past the
      // occurrence's overall provider budget.
      const agg = rows(await tx.execute(sql`
        SELECT COALESCE(SUM(o.max_reserved_units),0)::bigint AS units,
               COALESCE(SUM(o.max_reserved_amount_micros),0)::bigint AS amount
          FROM cro03c_stage_operations o
          JOIN cro03c_generations g2 ON g2.id=o.generation_id
         WHERE g2.command_id=${authority.command_id}::uuid
           AND o.terminal_disposition IS DISTINCT FROM 'released'
      `))[0] ?? { units: 0, amount: 0 };
      if (Number(agg.units) + input.requestedUnits > Number(caps.maxUnits) ||
          Number(agg.amount) + input.maxAmountMicros > Number(caps.maxAmountMicros)) {
        throw new Error("CRO08A_OCCURRENCE_AGGREGATE_BUDGET_EXCEEDED");
      }
    }
    const operation = rows(await tx.execute(sql`
      INSERT INTO cro03c_stage_operations
        (generation_id,stage_key,provider,operation_type,operation_key,caller,unit_type,currency,
         price_schedule_version,price_schedule_hash,max_reserved_units,max_reserved_amount_micros)
      VALUES (${input.generationId}::uuid,${input.stageKey},${input.provider},${input.operationType},${input.operationKey},
              ${input.caller},${contract.unitType},${contract.currency},${input.priceScheduleVersion},
              ${input.priceScheduleHash},${input.requestedUnits},${input.maxAmountMicros})
      RETURNING id
    `))[0];
    return { id: String(operation.id), replayed: false };
  });
}

export async function settleCro03cProviderOperation(input: {
  operationId: string;
  outcome: string;
  settledUnits: number;
  settledAmountMicros: number;
  billingCertainty: "certain" | "ambiguous" | "unknown" | "none";
  providerReceiptReference?: string;
  evidenceHash: string;
  metadata?: Record<string, unknown>;
}): Promise<{ receiptId: string; replayed: boolean }> {
  if (!SHA256.test(input.evidenceHash)) throw new Error("CRO03C_EVIDENCE_HASH_INVALID");
  if (!["success", "no_result", "blocked", "failed", "ambiguous"].includes(input.outcome)) {
    throw new Error("CRO03C_OUTCOME_INVALID");
  }
  if (!Number.isInteger(input.settledUnits) || input.settledUnits < 0 ||
      !Number.isInteger(input.settledAmountMicros) || input.settledAmountMicros < 0) throw new Error("CRO03C_SETTLEMENT_INVALID");
  const op = rows(await db.execute(sql`
    SELECT o.*,c.state AS command_state,c.cancel_requested_at,c.expires_at,a.price_schedules
      FROM cro03c_stage_operations o
      JOIN cro03c_generations g ON g.id=o.generation_id
      JOIN cro03c_commands c ON c.id=g.command_id
      JOIN cro03c_activation_policies a ON a.id=c.activation_policy_id
     WHERE o.id=${input.operationId}::uuid
  `))[0];
  if (!op) throw new Error("CRO03C_OPERATION_NOT_FOUND");
  if (op.command_state === "cancelled" || op.cancel_requested_at) throw new Error("CRO03C_COMMAND_CANCELLED");
  if (new Date(op.expires_at).getTime() <= Date.now()) throw new Error("CRO03C_COMMAND_EXPIRED");
  const schedule = (op.price_schedules ?? {})[op.provider] as Cro03cPriceSchedule | undefined;
  if (!schedule || schedule.unitType !== op.unit_type || schedule.currency !== op.currency ||
      schedule.version !== Number(op.price_schedule_version) ||
      stableCro03RecipeHash(schedule) !== op.price_schedule_hash) throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  if ((schedule.billingSemantics === "not_billable" && input.settledAmountMicros !== 0) ||
      (schedule.billingSemantics === "per_unit_no_result_free" && input.outcome === "no_result" && input.settledAmountMicros !== 0) ||
      (input.outcome === "ambiguous" && !["ambiguous", "unknown"].includes(input.billingCertainty))) {
    throw new Error("CRO03C_BILLING_SEMANTICS_INVALID");
  }
  if (input.settledUnits > Number(op.max_reserved_units) ||
      input.settledAmountMicros > Number(op.max_reserved_amount_micros)) throw new Error("CRO03C_SETTLEMENT_EXCEEDS_RESERVATION");
  const receiptKey = `cro03c:${input.operationId}:terminal`;
  const inserted = rows(await db.execute(sql`
    INSERT INTO cro03c_receipts
      (generation_id,stage_operation_id,receipt_key,receipt_type,normalized_outcome,evidence_hash,
       provider_receipt_reference,redacted_metadata,settled_units,settled_amount_micros)
    VALUES (${op.generation_id}::uuid,${input.operationId}::uuid,${receiptKey},'terminal',${input.outcome},
            ${input.evidenceHash},${input.providerReceiptReference ?? null},
            ${JSON.stringify(input.metadata ?? {})}::jsonb,${input.settledUnits},${input.settledAmountMicros})
    ON CONFLICT (receipt_key) DO NOTHING
    RETURNING id
  `))[0];
  if (!inserted) return { receiptId: String(rows(await db.execute(sql`SELECT id FROM cro03c_receipts WHERE receipt_key=${receiptKey}`))[0].id), replayed: true };
  const disposition = input.billingCertainty === "ambiguous" || input.billingCertainty === "unknown"
    ? "ambiguous" : input.settledUnits > 0 ? "consumed" : "released";
  await db.execute(sql`
    UPDATE cro03c_stage_operations
       SET settled_units=${input.settledUnits},settled_amount_micros=${input.settledAmountMicros},
           provider_receipt_reference=${input.providerReceiptReference ?? null},
           billing_certainty=${input.billingCertainty},terminal_disposition=${disposition},
           state=${disposition === "ambiguous" ? "quarantined" : "completed"},completed_at=NOW()
     WHERE id=${input.operationId}::uuid AND terminal_disposition IS NULL
  `);
  return { receiptId: String(inserted.id), replayed: false };
}

export async function authorizeCro03cValidation(input: {
  intentId: string;
  commandId: string;
  runId: string;
  generationId: string;
  activationRevision: number;
  contactId: number;
  normalizedEmailHash: string;
  subjectGeneration: number;
  runtimeAttestationId: string;
  expiresAt: Date | string;
}): Promise<{ id: string; replayed: boolean }> {
  if (!SHA256.test(input.normalizedEmailHash)) throw new Error("CRO03C_EMAIL_HASH_INVALID");
  if (!Number.isInteger(input.activationRevision) || input.activationRevision < 1 ||
      !Number.isInteger(input.subjectGeneration) || input.subjectGeneration < 1) {
    throw new Error("CRO03C_VALIDATION_CAP_INVALID");
  }
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error("CRO03C_VALIDATION_EXPIRED");
  const authorization = await db.transaction(async (tx) => {
    // Lock every mutable subject/control row before writing authorization. This
    // makes the authorization an exact binding to the *current* winning email,
    // generation, release attestation, command/run/generation and control
    // revision rather than a replayable intent-id capability.
    const authority = rows(await tx.execute(sql`
      SELECT i.id, p.price_schedules, c.caps, pc.version AS provider_control_revision
        FROM validation_intents i
        JOIN contacts contact ON contact.id=i.contact_id
        JOIN cro03c_commands c ON c.id=${input.commandId}::uuid
        JOIN cro03c_runs r ON r.id=${input.runId}::uuid AND r.command_id=c.id
        JOIN cro03c_generations g ON g.id=${input.generationId}::uuid
          AND g.command_id=c.id AND g.run_id=r.id
        JOIN cro03c_runtime_attestations t ON t.id=c.runtime_attestation_id
          AND t.id=${input.runtimeAttestationId}::uuid
        JOIN cro03c_activation_policies p ON p.id=c.activation_policy_id
        JOIN provider_controls pc ON pc.provider='zerobounce'
       WHERE i.id=${input.intentId}::uuid
         AND i.purpose='cro03_winning_email'
         AND i.contact_id=${input.contactId}
         AND i.subject_generation=${input.subjectGeneration}
         AND i.normalized_email_token_hash=${input.normalizedEmailHash}
         AND contact.email_mutation_generation=${input.subjectGeneration}
         AND contact.email_token_hash=${input.normalizedEmailHash}
         AND c.activation_revision=${input.activationRevision}
         AND c.command_type='initial_batch' AND c.state='running'
         AND c.cancel_requested_at IS NULL AND c.expires_at > NOW()
         AND r.state='running' AND g.state='running'
         AND g.activation_revision=${input.activationRevision}
         AND t.artifact_sha=${process.env.RELEASE_SHA ?? ""}
         AND t.migration_head=${CRO03C_MIGRATION_HEAD}
         AND t.db_healthy=TRUE AND t.redis_healthy=TRUE
         AND t.expires_at > NOW()
         AND ${expiresAt}::timestamptz <= c.expires_at
         AND ${expiresAt}::timestamptz <= t.expires_at
         AND pc.enabled=TRUE AND pc.circuit_state='closed'
       FOR UPDATE OF i, contact, c, r, g, t, pc
    `))[0];
    if (!authority) throw new Error("CRO03C_VALIDATION_AUTHORITY_DENIED");
    const schedule = (authority.price_schedules ?? {}).zerobounce as Cro03cPriceSchedule | undefined;
    const commandCaps = authority.caps ?? {};
    const unitCap = 1;
    const costCapMicros = Number(schedule?.amountMicros);
    if (!schedule || schedule.unitType !== "request" ||
        schedule.billingSemantics !== "per_unit_no_result_billable" ||
        !Number.isInteger(schedule.amountMicros) || schedule.amountMicros < 1 ||
        Number(commandCaps.validationMaxUnits) < 1 ||
        Number(commandCaps.validationMaxUnits) > CRO03C_MAX_INITIAL_HANDOFFS ||
        Number(commandCaps.validationMaxAmountMicros) !==
          Number(commandCaps.validationMaxUnits) * schedule.amountMicros ||
        Number(commandCaps.validationPriceScheduleVersion) !== schedule.version ||
        commandCaps.validationPriceScheduleHash !== stableCro03RecipeHash(schedule)) {
      throw new Error("CRO03C_VALIDATION_CAP_INVALID");
    }
    const existing = rows(await tx.execute(sql`
      SELECT id FROM cro03c_validation_authorizations
       WHERE validation_intent_id=${input.intentId}::uuid
         AND command_id=${input.commandId}::uuid AND run_id=${input.runId}::uuid
         AND generation_id=${input.generationId}::uuid AND activation_revision=${input.activationRevision}
         AND contact_id=${input.contactId} AND normalized_email_hash=${input.normalizedEmailHash}
         AND subject_generation=${input.subjectGeneration}
         AND runtime_attestation_id=${input.runtimeAttestationId}::uuid
         AND expected_provider_control_revision=${Number(authority.provider_control_revision)}
         AND unit_cap=${unitCap} AND cost_cap_micros=${costCapMicros}
         AND expires_at=${expiresAt}::timestamptz
    `))[0];
    if (existing) return { id: String(existing.id), replayed: true };
    const aggregate = rows(await tx.execute(sql`
      SELECT COALESCE(SUM(a.unit_cap),0)::int AS units,
             COALESCE(SUM(a.cost_cap_micros),0)::bigint AS amount
        FROM cro03c_validation_authorizations a
       WHERE a.command_id=${input.commandId}::uuid
         AND NOT EXISTS (
           SELECT 1 FROM cro03c_validation_revocations rv
            WHERE rv.authorization_id=a.id AND rv.disposition='released_undispatched'
         )
    `))[0];
    if (Number(aggregate.units) + unitCap > Number(commandCaps.validationMaxUnits) ||
        Number(aggregate.amount) + costCapMicros > Number(commandCaps.validationMaxAmountMicros)) {
      throw new Error("CRO03C_VALIDATION_COMMAND_CAP_EXHAUSTED");
    }
    const created = rows(await tx.execute(sql`
      INSERT INTO cro03c_validation_authorizations
      (validation_intent_id,command_id,run_id,generation_id,activation_revision,contact_id,
       normalized_email_hash,subject_generation,runtime_attestation_id,expected_provider_control_revision,
       unit_cap,cost_cap_micros,expires_at)
    VALUES (${input.intentId}::uuid,${input.commandId}::uuid,${input.runId}::uuid,${input.generationId}::uuid,
            ${input.activationRevision},${input.contactId},${input.normalizedEmailHash},${input.subjectGeneration},
             ${input.runtimeAttestationId}::uuid,${Number(authority.provider_control_revision)},${unitCap},${costCapMicros},
             ${expiresAt}::timestamptz)
    ON CONFLICT (validation_intent_id) DO NOTHING
    RETURNING id
    `))[0];
    if (created) {
      await tx.execute(sql`
        UPDATE validation_intents
           SET execution_authorized_at=NOW(),execution_authority='cro03c_activation',updated_at=NOW()
         WHERE id=${input.intentId}::uuid AND purpose='cro03_winning_email'
      `);
    }
    if (created) return { id: String(created.id), replayed: false };
    throw new Error("CRO03C_VALIDATION_AUTHORIZATION_CONFLICT");
  });
  return authorization;
}

export async function revokeCro03cValidationAuthorization(authorizationId: string, actorId: string, reason: string): Promise<boolean> {
  if (!reason?.trim()) throw new Error("CRO03C_REASON_INVALID");
  const result = await db.transaction(async (tx) => {
    const auth = rows(await tx.execute(sql`
      SELECT a.id,COALESCE(i.operation_id,op.id) AS operation_id
        FROM cro03c_validation_authorizations a
        JOIN validation_intents i ON i.id=a.validation_intent_id
        LEFT JOIN provider_operations op
          ON op.provider='zerobounce'
         AND op.idempotency_key='validation-intent:' || i.id::text
       WHERE a.id=${authorizationId}::uuid AND a.revoked_at IS NULL FOR UPDATE OF a,i
    `))[0];
    if (!auth) return false;
    const revoked = rows(await tx.execute(sql`
      INSERT INTO cro03c_validation_revocations(authorization_id,reason,actor_id,disposition)
      VALUES (${authorizationId}::uuid,${reason.trim()},${actorId},
              ${auth.operation_id ? "quarantined_dispatched" : "released_undispatched"})
      ON CONFLICT (authorization_id) DO NOTHING
      RETURNING id
    `))[0];
    if (revoked && auth.operation_id) {
      await tx.execute(sql`
        UPDATE provider_operations
           SET state='quarantined',billing_state='ambiguous',
               failure_code='cro03c_authority_revoked_after_dispatch',updated_at=NOW()
         WHERE id=${auth.operation_id}::uuid AND state IN ('pending','running')
      `);
    }
    return Boolean(revoked);
  });
  return result;
}

export async function createCro03cNoOutboundSnapshot(input: {
  commandId: string;
  runId?: string;
  phase: "pre_run" | "post_run";
  counters: Record<string, number>;
}): Promise<{ id: string; snapshotHash: string; replayed: boolean }> {
  const snapshotHash = hashCro03Evidence(input.counters);
  const inserted = rows(await db.execute(sql`
    INSERT INTO cro03c_no_outbound_snapshots(command_id,run_id,phase,snapshot_hash,counters)
    VALUES (${input.commandId}::uuid,${input.runId ?? null}::uuid,${input.phase},${snapshotHash},${JSON.stringify(input.counters)}::jsonb)
    ON CONFLICT(command_id,phase) DO NOTHING RETURNING id
  `))[0];
  if (inserted) return { id: String(inserted.id), snapshotHash, replayed: false };
  const prior = rows(await db.execute(sql`
    SELECT id,snapshot_hash FROM cro03c_no_outbound_snapshots WHERE command_id=${input.commandId}::uuid AND phase=${input.phase}
  `))[0];
  if (!prior || prior.snapshot_hash !== snapshotHash) throw new Error("CRO03C_SNAPSHOT_CONFLICT");
  return { id: String(prior.id), snapshotHash, replayed: true };
}

export async function recordCro03cForbiddenEffect(input: {
  commandId: string;
  runId?: string;
  effectKind: string;
  correlationId?: string;
  attemptedCount: number;
  effectiveCount: number;
  globalAnomaly?: boolean;
}): Promise<void> {
  if (input.attemptedCount < 0 || input.effectiveCount < 0 || input.effectiveCount > input.attemptedCount) {
    throw new Error("CRO03C_EFFECT_COUNT_INVALID");
  }
  const linked = Boolean(input.correlationId);
  // A linked attempted effect is sufficient to fail the evidence-only run.
  // Do not require proof that the provider actually committed the effect.
  const disposition = linked && input.attemptedCount > 0 ? "failed_run"
    : input.globalAnomaly ? "inconclusive" : linked ? "blocked" : "none";
  await db.execute(sql`
    INSERT INTO cro03c_forbidden_effects
      (command_id,run_id,effect_kind,correlation_id,attempted_count,effective_count,disposition,evidence_hash)
    VALUES (${input.commandId}::uuid,${input.runId ?? null}::uuid,${input.effectKind},${input.correlationId ?? null},
            ${input.attemptedCount},${input.effectiveCount},${disposition},
            ${hashCro03Evidence({ ...input, disposition })})
  `);
  if (disposition === "failed_run" || disposition === "inconclusive") {
    await db.execute(sql`
      UPDATE cro03c_runs SET state=${disposition === "failed_run" ? "failed" : "inconclusive_pending_reconciliation"},
             stop_reason=${disposition},completed_at=NOW()
       WHERE id=${input.runId ?? null}::uuid AND state IN ('queued','claimed','running')
    `);
    await db.execute(sql`
      UPDATE cro03c_commands
         SET state=${disposition === "failed_run" ? "failed" : "inconclusive_pending_reconciliation"},
             completed_at=NOW(),updated_at=NOW()
       WHERE id=${input.commandId}::uuid AND state IN ('queued','running')
    `);
  }
}

export async function createCro03cInitialRollout(input: {
  commandId: string;
  activationRevision: number;
  cohortHash: string;
  generationIds: string[];
}): Promise<{ replayed: boolean }> {
  if (input.generationIds.length < 1 || input.generationIds.length > CRO03C_MAX_INITIAL_HANDOFFS) {
    throw new Error("CRO03C_INITIAL_BATCH_SCOPE_INVALID");
  }
  requireHash(input.cohortHash, "COHORT");
  return db.transaction(async (tx) => {
    const existing = rows(await tx.execute(sql`
      SELECT command_id,activation_revision,membership_hash FROM cro03c_initial_rollouts
       WHERE rollout_key=${CRO03C_INITIAL_ROLLOUT_KEY} FOR UPDATE
    `))[0];
    const membershipHash = hashCro03Evidence({ generationIds: [...input.generationIds].sort(), cohortHash: input.cohortHash });
    if (existing) {
      if (String(existing.command_id) !== input.commandId || existing.membership_hash !== membershipHash) {
        throw new Error("CRO03C_INITIAL_ROLLOUT_ALREADY_CONSUMED");
      }
      return { replayed: true };
    }
    await tx.execute(sql`
      INSERT INTO cro03c_initial_rollouts(rollout_key,command_id,activation_revision,membership_hash)
      VALUES (${CRO03C_INITIAL_ROLLOUT_KEY},${input.commandId}::uuid,${input.activationRevision},${membershipHash})
    `);
    if (new Set(input.generationIds).size !== input.generationIds.length) {
      throw new Error("CRO03C_INITIAL_BATCH_SCOPE_INVALID");
    }
    for (const [ordinal, generationId] of input.generationIds.entries()) {
      await tx.execute(sql`
        INSERT INTO cro03c_initial_memberships(rollout_key,generation_id,ordinal,handoff_hash)
        SELECT ${CRO03C_INITIAL_ROLLOUT_KEY},g.id,${ordinal + 1},g.frozen_handoff_hash
          FROM cro03c_generations g
         WHERE g.id=${generationId}::uuid AND g.command_id=${input.commandId}::uuid
      `);
    }
    const count = Number(rows(await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM cro03c_initial_memberships WHERE rollout_key=${CRO03C_INITIAL_ROLLOUT_KEY}
    `))[0]?.n ?? 0);
    if (count !== input.generationIds.length) throw new Error("CRO03C_INITIAL_MEMBERSHIP_INVALID");
    return { replayed: false };
  });
}

export async function cancelCro03cCommand(input: {
  commandId: string;
  actorId: string;
  idempotencyKey: string;
  expectedRevision: number;
  reason: string;
}): Promise<{ revision: number; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error("CRO03C_IDEMPOTENCY_KEY_INVALID");
  if (!input.reason?.trim() || input.reason.trim().length > 500) throw new Error("CRO03C_REASON_INVALID");
  return db.transaction(async (tx) => {
    // The row lock serializes cancellation receipt creation without requiring a
    // new mutable command field or a migration-level uniqueness constraint.
    const command = rows(await tx.execute(sql`
      SELECT id,state,activation_revision FROM cro03c_commands
       WHERE id=${input.commandId}::uuid FOR UPDATE
    `))[0];
    if (!command) throw new Error("CRO03C_COMMAND_NOT_FOUND");
    const receiptKey = `cro03c-command-cancel:${input.commandId}:${input.idempotencyKey}`;
    const receipt = rows(await tx.execute(sql`
      SELECT details FROM audit_logs
       WHERE action='cro03c.command.cancelled' AND entity_type='cro03c_command' AND entity_key=${receiptKey}
       LIMIT 1
    `))[0];
    if (receipt) {
      const details = receipt.details ?? {};
      if (Number(details.expectedRevision) !== input.expectedRevision || details.reason !== input.reason.trim()) {
        throw new Error("CRO03C_IDEMPOTENCY_PAYLOAD_CONFLICT");
      }
      return { revision: Number(command.activation_revision), replayed: true };
    }
    if (Number(command.activation_revision) !== input.expectedRevision) {
      throw new Error("CRO03C_CANCELLATION_REVISION_CONFLICT");
    }
    if (!["queued", "running"].includes(String(command.state))) throw new Error("CRO03C_COMMAND_NOT_CANCELLABLE");
    await tx.execute(sql`
      UPDATE cro03c_commands
         SET cancel_requested_at=COALESCE(cancel_requested_at,NOW()),state='cancelled',updated_at=NOW()
       WHERE id=${input.commandId}::uuid
    `);
    // An authorization without a provider operation is an undispatched token
    // and may be released. Once an operation exists, provider commitment is
    // unknowable at cancellation and the token is quarantined, never released.
    await tx.execute(sql`
      INSERT INTO cro03c_validation_revocations(authorization_id,reason,actor_id,disposition)
      SELECT a.id,${`command_cancelled:${input.reason.trim()}`},${input.actorId},
             CASE WHEN i.operation_id IS NULL AND op.id IS NULL
                  THEN 'released_undispatched' ELSE 'quarantined_dispatched' END
        FROM cro03c_validation_authorizations a
        JOIN validation_intents i ON i.id=a.validation_intent_id
        LEFT JOIN provider_operations op
          ON op.provider='zerobounce'
         AND op.idempotency_key='validation-intent:' || i.id::text
       WHERE a.command_id=${input.commandId}::uuid
      ON CONFLICT (authorization_id) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE provider_operations op
         SET state='quarantined',billing_state='ambiguous',
             failure_code='cro03c_command_cancelled_after_dispatch',updated_at=NOW()
        FROM validation_intents i
        JOIN cro03c_validation_authorizations a ON a.validation_intent_id=i.id
       WHERE a.command_id=${input.commandId}::uuid
         AND (op.id=i.operation_id OR
              (op.provider='zerobounce' AND op.idempotency_key='validation-intent:' || i.id::text))
         AND op.state IN ('pending','running')
    `);
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.command.cancelled','cro03c_command',${receiptKey},
              ${JSON.stringify({ commandId: input.commandId, idempotencyKey: input.idempotencyKey, expectedRevision: input.expectedRevision, reason: input.reason.trim() })}::jsonb,
              'user',${input.actorId})
    `);
    return { revision: Number(command.activation_revision), replayed: false };
  });
}

export async function getCro03cStatus(): Promise<any> {
  const [policy, attestation, rollout, activeRuns] = await Promise.all([
    db.execute(sql`SELECT id,version,status,expected_revision,policy_hash,required_approvals,created_at FROM cro03c_activation_policies ORDER BY expected_revision DESC LIMIT 1`),
    db.execute(sql`SELECT id,artifact_sha,migration_head,deployment_identity,environment_identity,queue_topology_hash,db_healthy,redis_healthy,captured_at,expires_at FROM cro03c_runtime_attestations ORDER BY captured_at DESC LIMIT 1`),
    db.execute(sql`SELECT rollout_key,command_id,activation_revision,membership_hash,state,consumed_at FROM cro03c_initial_rollouts WHERE rollout_key=${CRO03C_INITIAL_ROLLOUT_KEY}`),
    db.execute(sql`SELECT id,command_id,mode,state,stop_reason,started_at,completed_at FROM cro03c_runs WHERE state IN ('queued','claimed','running') ORDER BY created_at`),
  ]);
  return {
    mode: CRO03C_MODE,
    transportEnabled: false,
    outreach: "PAUSED / NOT AUTHORIZED",
    policy: rows(policy)[0] ?? null,
    runtime: rows(attestation)[0] ?? null,
    initialRollout: rows(rollout)[0] ?? null,
    activeRuns: rows(activeRuns),
  };
}