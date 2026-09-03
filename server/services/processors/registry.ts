/**
 * Processor Registry (REV-05A)
 *
 * Changes from pre-REV-05A:
 *   - Activation snapshot gate: every boardMerchant call checks for a confirmed
 *     processor_activation_snapshots row before allowing transport. Fail-closed.
 *   - getAllAdapterStatuses() now returns healthState (ProcessorHealthState).
 *   - pingAllAdapters() delegates to adapter.ping() which only returns true on 2xx.
 *   - ingestMidDataForActiveMids() no longer imports processor-api (#1737 held).
 *   - getProcessorHealthState() exported for server/index.ts health endpoint.
 *   - requireConfirmedActivationSnapshot() exported for outbox worker.
 */
import type { IProcessorAdapter, AdapterHealthStatus, DailyStats, ProcessorHealthState, HeldResult } from "./IProcessorAdapter";
import { PayarcProcessorAdapter } from "./payarc.adapter";
import { MockProcessorAdapter } from "./mock.adapter";
import { db } from "../../db";
import { processorActivationSnapshots } from "../../../shared/schema";
import { and, eq, desc } from "drizzle-orm";

interface AdapterRecord {
  adapter: IProcessorAdapter;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
  cachedHealthState: ProcessorHealthState | null;
  healthStateAt: Date | null;
}

const adapters = new Map<string, AdapterRecord>();

function initRegistry() {
  if (adapters.size > 0) return;

  const payarc = new PayarcProcessorAdapter();
  const mock = new MockProcessorAdapter();

  // Payarc is the system processor. Enable when PAYARC_API_KEY is set.
  // ENABLED_PROCESSORS can override (e.g. "mock" for dev, "payarc,mock" for both).
  const envList = (process.env.ENABLED_PROCESSORS || "payarc").toLowerCase().split(",").map(s => s.trim());

  const payarcEnabled = envList.includes("payarc");
  adapters.set("payarc", {
    adapter: payarc,
    enabled: payarcEnabled,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    cachedHealthState: null,
    healthStateAt: null,
  });

  // Mock: enabled ONLY in non-production environments.
  // REV-05A: Mock MUST NEVER be enabled in production regardless of ENABLED_PROCESSORS.
  // Any attempt to board or check status via Mock in production is a boarding-integrity
  // failure — real merchant data would flow through a fake adapter with no real provider.
  const isProduction = process.env.NODE_ENV === "production";
  const mockEnabled =
    !isProduction && (
      envList.includes("mock") ||
      !process.env.PAYARC_API_KEY
    );

  if (isProduction && envList.includes("mock")) {
    console.error(
      "[Processor Registry] CRITICAL: ENABLED_PROCESSORS includes 'mock' in production. " +
      "Mock adapter has been HARD-DISABLED. Set PAYARC_API_KEY to activate the real Payarc adapter.",
    );
  }

  adapters.set("mock", {
    adapter: mock,
    enabled: mockEnabled,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
    cachedHealthState: null,
    healthStateAt: null,
  });
}

export function getProcessor(name?: string): IProcessorAdapter {
  initRegistry();

  const processorName = (name || process.env.DEFAULT_PROCESSOR || "payarc").toLowerCase();
  const record = adapters.get(processorName);

  if (record && record.enabled) {
    return createTrackedAdapter(processorName, record);
  }

  if (name) {
    throw new Error(
      `Processor adapter "${name}" is not registered or not enabled. Check ENABLED_PROCESSORS env var.`,
    );
  }

  // Fall through to first enabled adapter (payarc → mock)
  for (const [key, rec] of adapters.entries()) {
    if (rec.enabled) return createTrackedAdapter(key, rec);
  }

  throw new Error(
    "No processor adapters are enabled. Set PAYARC_API_KEY or ENABLED_PROCESSORS=mock.",
  );
}

export function getEnabledAdapterNames(): string[] {
  initRegistry();
  const results: string[] = [];
  for (const [name, record] of adapters.entries()) {
    if (record.enabled) results.push(name);
  }
  return results;
}

export function getDefaultProcessor(): IProcessorAdapter {
  return getProcessor();
}

/**
 * requireConfirmedActivationSnapshot — Activation gate (REV-05A §6)
 *
 * Fails closed if no activation snapshot with status='owner_confirmed' or higher
 * exists for the given processor. The caller must pass the SPECIFIC operation
 * being performed (e.g. "board_merchant" for boardMerchant, "get_merchant_status"
 * for getMerchantStatus). The gate checks that the snapshot explicitly authorizes
 * that operation — a snapshot that only permits boarding does not permit polling,
 * and vice versa.
 *
 * Statuses that permit transport:
 *   owner_confirmed, sandbox_verified, production_authorized
 *
 * @throws Error with code ACTIVATION_SNAPSHOT_REQUIRED if no qualifying row exists.
 * @throws Error with code ACTIVATION_SNAPSHOT_OPERATION_MISSING if the operation is not listed.
 */
const QUALIFYING_SNAPSHOT_STATUSES = new Set(["owner_confirmed", "sandbox_verified", "production_authorized"]);

export async function requireConfirmedActivationSnapshot(
  processorName: string,
  requiredOperation: string = "board_merchant",
): Promise<{
  processorProgram: string;
  authorizedBaseUrl: string | null;
  supportedOperations: string[];
  status: string;
}> {
  // REV-05A: Evaluate ONLY the latest snapshot. A newer expired/held snapshot
  // supersedes any older owner_confirmed one — the gate does not fall back to
  // historical rows. This prevents an expired snapshot from remaining usable
  // after it has been explicitly revoked.
  const rows = await db
    .select()
    .from(processorActivationSnapshots)
    .where(eq(processorActivationSnapshots.processorName, processorName))
    .orderBy(desc(processorActivationSnapshots.createdAt))
    .limit(1);

  const latest = rows[0];
  const latestStatus = latest?.status ?? "none";

  if (!latest || !QUALIFYING_SNAPSHOT_STATUSES.has(latest.status)) {
    throw Object.assign(
      new Error(
        `[REV-05A] Processor transport blocked: latest activation snapshot for '${processorName}' has status '${latestStatus}'. ` +
        `Owner must create a new owner_confirmed snapshot before boarding activates.`
      ),
      { code: "ACTIVATION_SNAPSHOT_REQUIRED", processorName, latestStatus }
    );
  }

  // REV-05A: Validate that the snapshot includes the entitlement for the
  // current environment. sandbox_entitlement must be true for non-production;
  // production_entitlement must be true for production transport.
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !latest.productionEntitlement) {
    throw Object.assign(
      new Error(
        `[REV-05A] Processor transport blocked: activation snapshot for '${processorName}' does not have production_entitlement. ` +
        `Only sandbox_entitlement is granted. Owner must create a new snapshot with productionEntitlement=true for production transport.`
      ),
      { code: "ACTIVATION_SNAPSHOT_ENTITLEMENT_MISMATCH", processorName, latestStatus }
    );
  }
  if (!isProduction && !latest.sandboxEntitlement && !latest.productionEntitlement) {
    throw Object.assign(
      new Error(
        `[REV-05A] Processor transport blocked: activation snapshot for '${processorName}' has no entitlement. ` +
        `At least sandbox_entitlement or production_entitlement must be true.`
      ),
      { code: "ACTIVATION_SNAPSHOT_ENTITLEMENT_MISSING", processorName, latestStatus }
    );
  }

  // REV-05A: Verify that supportedOperations includes the specific operation
  // being performed. Authorization is per-operation — a snapshot that lists
  // "board_merchant" does not authorize "get_merchant_status" and vice versa.
  const ops = (latest.supportedOperations as string[]) ?? [];
  if (!ops.includes(requiredOperation)) {
    throw Object.assign(
      new Error(
        `[REV-05A] Processor transport blocked: activation snapshot for '${processorName}' does not list '${requiredOperation}' in supportedOperations. ` +
        `Add it to the snapshot to authorize this operation.`
      ),
      { code: "ACTIVATION_SNAPSHOT_OPERATION_MISSING", processorName, requiredOperation, latestStatus }
    );
  }

  // REV-05A: Require an authorized base URL — adapter must use snapshot URL, not env-default.
  if (!latest.authorizedBaseUrl) {
    throw Object.assign(
      new Error(
        `[REV-05A] Processor transport blocked: activation snapshot for '${processorName}' has no authorizedBaseUrl. ` +
        `Owner must specify the authorized Payarc API base URL in the snapshot.`
      ),
      { code: "ACTIVATION_SNAPSHOT_URL_MISSING", processorName, latestStatus }
    );
  }

  return {
    processorProgram: latest.processorProgram,
    authorizedBaseUrl: latest.authorizedBaseUrl,
    supportedOperations: ops,
    status: latest.status,
  };
}

/**
 * getLatestActivationSnapshot — Returns the latest snapshot for a processor
 * without enforcing the gate. Used by health/readiness endpoints.
 */
export async function getLatestActivationSnapshot(processorName: string): Promise<{
  status: string; processorProgram: string | null; ownerConfirmedAt: Date | null;
} | null> {
  const rows = await db
    .select({
      status: processorActivationSnapshots.status,
      processorProgram: processorActivationSnapshots.processorProgram,
      ownerConfirmedAt: processorActivationSnapshots.ownerConfirmedAt,
    })
    .from(processorActivationSnapshots)
    .where(eq(processorActivationSnapshots.processorName, processorName))
    .orderBy(desc(processorActivationSnapshots.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function createTrackedAdapter(name: string, record: AdapterRecord): IProcessorAdapter {
  const handler: ProxyHandler<IProcessorAdapter> = {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value !== "function") return value;

      return async (...args: any[]) => {
        record.callCount++;
        try {
          const result = await value.apply(target, args);
          record.lastSuccessAt = new Date();
          return result;
        } catch (err: any) {
          record.errorCount++;
          record.lastErrorAt = new Date();
          record.lastError = err?.message ?? String(err);
          throw err;
        }
      };
    },
  };

  return new Proxy(record.adapter, handler);
}

/**
 * Get the processor health state for a named adapter.
 *
 * REV-05A: Health state is computed from BOTH the credential ping AND the
 * latest activation snapshot. Adapter-level verification alone cannot report
 * a "ready" state if no qualifying activation snapshot exists:
 *
 *   - No qualifying snapshot (pending/held/expired/none) → `missing_contract`
 *   - Qualifying snapshot exists + credential ping passes → adapter state
 *   - Qualifying snapshot exists + credential ping fails → `configured_unverified`
 *
 * This ensures the Settings UI and health endpoint reflect the actual
 * transport gate, not just whether credentials respond.
 *
 * Results are cached for 5 minutes to avoid redundant API calls.
 */
export async function getProcessorHealthState(name: string = "payarc"): Promise<ProcessorHealthState> {
  initRegistry();
  const record = adapters.get(name);
  if (!record) return "disabled";
  if (!record.enabled) return "disabled";

  // Cache for 5 minutes
  const CACHE_TTL_MS = 5 * 60 * 1000;
  if (record.cachedHealthState && record.healthStateAt && (Date.now() - record.healthStateAt.getTime()) < CACHE_TTL_MS) {
    return record.cachedHealthState;
  }

  // REV-05A: Check activation snapshot FIRST, applying the same full checks
  // as requireConfirmedActivationSnapshot (status, entitlement, board_merchant
  // op, authorizedBaseUrl). A verified adapter with no qualifying snapshot or
  // a snapshot missing any required condition is NOT transport-ready.
  //
  // Exception: Mock adapter in non-production is exempt (no snapshot needed).
  const isMock = name === "mock";
  const isProductionEnv = process.env.NODE_ENV === "production";
  let snapshotAuthorizedBaseUrl: string | null = null;
  if (!isMock || isProductionEnv) {
    try {
      const rows = await db
        .select()
        .from(processorActivationSnapshots)
        .where(eq(processorActivationSnapshots.processorName, name))
        .orderBy(desc(processorActivationSnapshots.createdAt))
        .limit(1);
      const snap = rows[0] ?? null;
      const snapStatus = snap?.status ?? "none";

      if (!snap || !QUALIFYING_SNAPSHOT_STATUSES.has(snapStatus)) {
        const state: ProcessorHealthState = "missing_contract";
        record.cachedHealthState = state;
        record.healthStateAt = new Date();
        return state;
      }
      // Check entitlement for current environment.
      if (isProductionEnv && !snap.productionEntitlement) {
        const state: ProcessorHealthState = "held";
        record.cachedHealthState = state;
        record.healthStateAt = new Date();
        return state;
      }
      if (!isProductionEnv && !snap.sandboxEntitlement && !snap.productionEntitlement) {
        const state: ProcessorHealthState = "held";
        record.cachedHealthState = state;
        record.healthStateAt = new Date();
        return state;
      }
      // Check board_merchant op.
      const ops = (snap.supportedOperations as string[]) ?? [];
      if (!ops.includes("board_merchant")) {
        const state: ProcessorHealthState = "missing_contract";
        record.cachedHealthState = state;
        record.healthStateAt = new Date();
        return state;
      }
      // Check authorizedBaseUrl — capture it for passing to the adapter probe.
      if (!snap.authorizedBaseUrl) {
        const state: ProcessorHealthState = "missing_contract";
        record.cachedHealthState = state;
        record.healthStateAt = new Date();
        return state;
      }
      // Snapshot qualifies — fall through to credential probe using the snapshot URL.
      snapshotAuthorizedBaseUrl = snap.authorizedBaseUrl;
    } catch {
      // DB unreachable — report held rather than claiming verified state.
      const state: ProcessorHealthState = "held";
      record.cachedHealthState = state;
      record.healthStateAt = new Date();
      return state;
    }
  }

  try {
    // REV-05A: Pass the snapshot's authorized URL to the adapter so the identity
    // probe targets only the owner-approved endpoint, not an arbitrary env var.
    const state = await record.adapter.getHealthState(snapshotAuthorizedBaseUrl);
    record.cachedHealthState = state;
    record.healthStateAt = new Date();
    return state;
  } catch {
    return "configured_unverified";
  }
}

export function getAllAdapterStatuses(): AdapterHealthStatus[] {
  initRegistry();
  const statuses: AdapterHealthStatus[] = [];

  for (const [name, record] of adapters.entries()) {
    const configured = isAdapterConfigured(name);
    const errorRate =
      record.callCount > 0 ? Math.round((record.errorCount / record.callCount) * 100) : 0;

    statuses.push({
      name: record.adapter.displayName,
      enabled: record.enabled,
      configured,
      healthState: record.cachedHealthState ?? (record.enabled ? "configured_unverified" : "disabled"),
      lastSuccessAt: record.lastSuccessAt,
      lastErrorAt: record.lastErrorAt,
      lastError: record.lastError,
      callCount: record.callCount,
      errorCount: record.errorCount,
      errorRate,
    });
  }

  return statuses;
}

function isAdapterConfigured(name: string): boolean {
  switch (name) {
    case "payarc":
      return !!process.env.PAYARC_API_KEY;
    case "mock":
      return true;
    default:
      return false;
  }
}

/**
 * pingAllAdapters — REV-05A: Routes through getProcessorHealthState() for every
 * enabled adapter so that the snapshot gate (status, entitlement, operation, URL)
 * is always enforced before any authenticated provider I/O. Calling
 * adapter.getHealthState() directly would bypass the snapshot authority check and
 * allow credential pings against an adapter with no qualifying contract snapshot.
 */
export async function pingAllAdapters(): Promise<Record<string, { ok: boolean; healthState: ProcessorHealthState }>> {
  initRegistry();
  const results: Record<string, { ok: boolean; healthState: ProcessorHealthState }> = {};

  for (const [name, record] of adapters.entries()) {
    if (!record.enabled) {
      results[name] = { ok: false, healthState: "disabled" };
      continue;
    }
    try {
      // Use getProcessorHealthState (snapshot-gated) rather than adapter.getHealthState()
      // directly — this is the single authority check for all provider I/O including pings.
      const state = await getProcessorHealthState(name);
      const ok = state === "sandbox_verified" || state === "production_authorized";
      if (ok) record.lastSuccessAt = new Date();
      results[name] = { ok, healthState: state };
    } catch (err: any) {
      results[name] = { ok: false, healthState: "configured_unverified" };
      record.lastErrorAt = new Date();
      record.lastError = err?.message ?? String(err);
      record.errorCount++;
    }
  }

  return results;
}

/**
 * ingestMidDataForActiveMids
 *
 * #1737 domain: getDailyStats now returns HeldResult from all adapters.
 * This function returns { processed: 0, errors: 0, held: true } because
 * the actual daily stats ingestion is Task #1737 (REV-06A) scope.
 *
 * The function is preserved so queue-manager.ts can import it without
 * breaking the job scheduler.
 */
export async function ingestMidDataForActiveMids(): Promise<{ processed: number; errors: number; held?: boolean }> {
  // #1737 domain: getDailyStats returns HeldResult from all adapters now.
  // No ingestion can happen until Task #1737 certifies these paths.
  console.log("[Registry Ingestion] getDailyStats is held pending task #1737 (REV-06A). Skipping MID data ingestion.");
  return { processed: 0, errors: 0, held: true };
}
