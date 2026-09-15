/**
 * Shared paid-provider control-plane views and the operator emergency stop.
 *
 * This module is deliberately transport-free: it only reads and mutates the
 * disposable/durable control tables. Provider adapters remain responsible for
 * their own fake-transport boundaries.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { auditLogs } from "@shared/schema";
import { PROVIDER_SOURCE_MANIFEST } from "./provider-manifest";
import { sanitizeAuditPayload } from "./audit-sanitizer";

export const PAID_PROVIDER_KEYS = ["serper", "outscraper", "openai", "apollo", "zerobounce"] as const;
export type PaidProviderKey = (typeof PAID_PROVIDER_KEYS)[number];

const SECRET_BY_PROVIDER: Record<PaidProviderKey, string> = {
  serper: "SERPER_API_KEY",
  outscraper: "OUTSCRAPER_API_KEY",
  openai: "AI_INTEGRATIONS_OPENAI_API_KEY",
  apollo: "APOLLO_API_KEY",
  zerobounce: "ZEROBOUNCE_API_KEY",
};

const CAPABILITY_BY_PROVIDER: Record<PaidProviderKey, string> = {
  serper: "business_discovery",
  outscraper: "business_discovery",
  openai: "cro03_classification",
  apollo: "contact_enrichment",
  zerobounce: "email_validation",
};
const CALLERS_BY_PROVIDER: Record<PaidProviderKey, string[]> = {
  serper: ["server/services/sdr/serper-enrichment.ts", "server/services/sdr/lead-finder.ts", "server/services/cro03/live-provider-executors.ts", "server/services/serper-business-identity.ts"],
  outscraper: ["server/services/cro03/live-provider-executors.ts"],
  openai: ["server/services/cro03/live-provider-executors.ts"],
  apollo: ["server/services/cro03/live-provider-executors.ts"],
  zerobounce: ["server/services/zerobounce-campaign-worker.ts", "server/services/cro03/live-provider-executors.ts", "server/services/cro03/business-validation-service.ts"],
};

function rows(result: any): any[] {
  return result?.rows ?? [];
}

function nextSixUtc(): string {
  const next = new Date();
  next.setUTCHours(6, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * A panel-safe snapshot. Secret values are never returned; missing control
 * rows are represented explicitly rather than treated as enabled.
 */
export async function getPaidProviderControls(): Promise<{
  providers: Array<Record<string, unknown>>;
  zeroBounce: Record<string, unknown>;
  inFlightCount: number;
  inFlightOperations: Array<Record<string, unknown>>;
}> {
  const controls = rows(await db.execute(sql`
    SELECT provider, capability, enabled, circuit_state, local_budget_units,
           reserved_units, consumed_units, last_completed_at, last_outcome,
           last_error_code, observed_at, updated_at
      FROM provider_controls
     WHERE provider IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
  `));
  const inFlightOperations = rows(await db.execute(sql`
    SELECT id, provider, operation_type, purpose, state, billing_state,
           requested_units, reserved_units, created_at, started_at
      FROM provider_operations
     WHERE provider IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
       AND (state IN ('pending', 'deferred', 'running') OR billing_state = 'reserved')
     ORDER BY created_at ASC
     LIMIT 100
  `));
  const byProvider = new Map(controls.map((row) => [String(row.provider), row]));

  let serper: any = null;
  try {
    serper = rows(await db.execute(sql`
      SELECT enabled, state, local_budget, window_calls, last_success_at,
             last_failure_at, reason_code, updated_at
        FROM serper_control WHERE id = 1
    `))[0] ?? null;
  } catch {
    // A missing/unmigrated control row is represented as unavailable below.
  }

  let pricing: Record<string, any> = {};
  let pricingAvailable = true;
  let pricingArtifactRefs = new Map<string, string>();
  let pricingSnapshotId: string | null = null;
  try {
    const { getCurrentPricingSchedule } = await import("./mi09-pilot-authority");
    const schedule = await getCurrentPricingSchedule();
    pricingSnapshotId = schedule.snapshotId;
    pricing = schedule.priceSchedules as Record<string, any>;
    try {
      const artifacts = rows(await db.execute(sql`
        SELECT provider_key, id, artifact_version
          FROM mi09_pricing_artifacts
         WHERE provider_key IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
         ORDER BY captured_at DESC
      `));
      for (const artifact of artifacts) {
        if (!pricingArtifactRefs.has(String(artifact.provider_key))) {
          pricingArtifactRefs.set(
            String(artifact.provider_key),
            `mi09_pricing_artifacts:${artifact.id}:v${artifact.artifact_version}`,
          );
        }
      }
    } catch {
      // The schedule remains useful in a partially migrated disposable DB;
      // expose its stable snapshot reference below instead.
    }
  } catch {
    pricingAvailable = false;
  }

  const providers = PAID_PROVIDER_KEYS.map((provider) => {
    const row = byProvider.get(provider);
    const circuitState = provider === "serper"
      ? (serper?.state ?? row?.circuit_state ?? "unavailable")
      : (row?.circuit_state ?? "unavailable");
    const enabled = provider === "serper"
      ? (serper?.enabled === true && row?.enabled !== false)
      : row?.enabled === true;
    const price = pricing[provider];
    const manifest = PROVIDER_SOURCE_MANIFEST.find((entry) => entry.id === provider);
    return {
      provider,
      credentialPresent: Boolean(process.env[SECRET_BY_PROVIDER[provider]]),
      enabled,
      circuitState,
      budgetCapUnits: provider === "serper" ? (serper?.local_budget ?? row?.local_budget_units ?? null) : (row?.local_budget_units ?? null),
      reservedUnits: row?.reserved_units ?? 0,
      consumedUnits: row?.consumed_units ?? (provider === "serper" ? serper?.window_calls ?? 0 : 0),
      currentPriceArtifactReference: pricingAvailable && price
        ? (pricingArtifactRefs.get(provider) ?? `mi09_pricing_schedule_snapshots:${pricingSnapshotId}:${provider}:v${price.version}`)
        : null,
      currentPrice: price ?? null,
      lastCallAt: row?.last_completed_at ?? serper?.last_success_at ?? serper?.last_failure_at ?? null,
      lastOutcome: row?.last_outcome ?? (serper?.last_failure_at ? `failure:${serper.reason_code ?? "unknown"}` : serper?.last_success_at ? "success" : null),
      lastErrorCode: row?.last_error_code ?? serper?.reason_code ?? null,
      authorizedPurposes: manifest?.capability ?? [CAPABILITY_BY_PROVIDER[provider]],
      authorizedCallers: manifest?.approvedCallers ?? CALLERS_BY_PROVIDER[provider],
      controlRowPresent: Boolean(row),
    };
  });

  const autoRunValue = await storage.getSystemSetting("zerobounce_auto_run_enabled").catch(() => false);
  const zb = providers.find((provider) => provider.provider === "zerobounce")!;
  return {
    providers,
    zeroBounce: {
      enabled: zb.enabled,
      circuitState: zb.circuitState,
      dailyCap: (await storage.getSystemSetting("zerobounce_validation_daily_limit").catch(() => null)) ?? zb.budgetCapUnits,
      autoRunEnabled: autoRunValue === true || autoRunValue === "true",
      nextAutomaticRunAt: nextSixUtc(),
      authorizedPurposes: zb.authorizedPurposes,
      authorizedCallers: zb.authorizedCallers,
    },
    inFlightCount: inFlightOperations.length,
    inFlightOperations,
  };
}

/**
 * Disable every paid provider atomically and leave already-dispatched work
 * visible for reconciliation. Pending/running rows are not silently deleted
 * or marked terminal; they receive a cancellation request and are returned.
 */
export async function emergencyStopPaidProviders(input: {
  stoppedBy: string;
  reason: string;
}): Promise<{
  providersDisabled: number;
  inFlightCount: number;
  inFlightOperations: Array<Record<string, unknown>>;
  schedulesDeactivated: number;
}> {
  return db.transaction(async (tx) => {
    const inflight = rows(await tx.execute(sql`
      SELECT id, provider, operation_type, purpose, state, billing_state,
             requested_units, reserved_units, created_at, started_at
        FROM provider_operations
       WHERE provider IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
         AND (state IN ('pending', 'deferred', 'running') OR billing_state = 'reserved')
       ORDER BY created_at ASC
       FOR UPDATE
    `));

    const disabled = await tx.execute(sql`
      UPDATE provider_controls
         SET enabled = FALSE, circuit_state = 'open', last_outcome = 'emergency_stop',
             last_error_code = 'operator_emergency_stop', version = version + 1, updated_at = NOW()
       WHERE provider IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
    `);

    // Serper has a legacy singleton gateway row in addition to provider_controls.
    await tx.execute(sql`
      UPDATE serper_control
         SET enabled = FALSE, state = 'open', reason_code = 'operator_emergency_stop',
             half_open_probe_claimed_at = NULL, updated_at = NOW()
       WHERE id = 1
    `);

    // These are independent switches: stopping MI-09/paid controls must also
    // turn off the automatic ZeroBounce lane, without changing manual settings.
    await tx.execute(sql`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('zerobounce_auto_run_enabled', 'false'::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, updated_at = NOW()
    `);
    await tx.execute(sql`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('cro08a_recurring_enrichment_enabled', 'false'::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, updated_at = NOW()
    `);

    const deactivated = rows(await tx.execute(sql`
      UPDATE cro08a_schedule_definitions
         SET active = FALSE, updated_at = NOW()
       WHERE active = TRUE
       RETURNING id
    `));

    // Corrective item 8: an emergency stop must also revoke the recurring
    // paid-budget authorization (not just deactivate schedules), so a future
    // re-activation can never silently ride on a stale operator confirmation
    // — the operator must explicitly re-type the recurring confirmation.
    await tx.execute(sql`
      UPDATE system_settings
         SET value = jsonb_set(jsonb_set(jsonb_set(value,
               '{revokedAt}', to_jsonb(NOW()::text)),
               '{revokedBy}', to_jsonb(${input.stoppedBy}::text)),
               '{revokedReason}', to_jsonb(${input.reason}::text))
       WHERE key = 'cro08a_recurring_paid_budget_authorization'
         AND value->>'revokedAt' IS NULL
    `);

    if (inflight.length > 0) {
      await tx.execute(sql`
        UPDATE provider_operations
           SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()), updated_at = NOW()
         WHERE provider IN ('serper', 'outscraper', 'openai', 'apollo', 'zerobounce')
           AND (state IN ('pending', 'deferred', 'running') OR billing_state = 'reserved')
      `);
    }

    await tx.insert(auditLogs).values({
      action: "paid_provider_emergency_stop",
      entityType: "system",
      entityKey: "paid-providers",
      actorType: "user",
      actorId: input.stoppedBy,
      userId: input.stoppedBy,
      details: sanitizeAuditPayload({
        reason: input.reason,
        providers: PAID_PROVIDER_KEYS,
        inFlightCount: inflight.length,
        schedulesDeactivated: deactivated.length,
      }) as Record<string, unknown>,
    });

    return {
      providersDisabled: Number((disabled as any).rowCount ?? 0),
      inFlightCount: inflight.length,
      inFlightOperations: inflight,
      schedulesDeactivated: deactivated.length,
    };
  });
}