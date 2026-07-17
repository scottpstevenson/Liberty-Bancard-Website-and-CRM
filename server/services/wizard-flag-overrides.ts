import { db } from "../db";
import { systemSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

const WIZARD_FLAGS = [
  "SDR_ENABLED",
  "ORCHESTRATOR_ENABLED",
  "LEGACY_OUTREACH_ENABLED",
  "SMS_ENABLED",
  "VOICE_AI_ENABLED",
  "RINGLESS_VM_ENABLED",
  "NIGHTLY_DISCOVERY_ENABLED",
] as const;

export type WizardFlagName = typeof WIZARD_FLAGS[number];

const FLAG_DEFAULTS: Record<WizardFlagName, boolean> = {
  SDR_ENABLED: true,
  ORCHESTRATOR_ENABLED: false,
  LEGACY_OUTREACH_ENABLED: false,
  SMS_ENABLED: false,
  VOICE_AI_ENABLED: false,
  RINGLESS_VM_ENABLED: false,
  NIGHTLY_DISCOVERY_ENABLED: false,
};

const FLAG_ENV_VARS: Record<WizardFlagName, string> = {
  SDR_ENABLED: "SDR_ENABLED",
  ORCHESTRATOR_ENABLED: "ORCHESTRATOR_ENABLED",
  LEGACY_OUTREACH_ENABLED: "LEGACY_OUTREACH_ENABLED",
  SMS_ENABLED: "SMS_ENABLED",
  VOICE_AI_ENABLED: "VOICE_AI_ENABLED",
  RINGLESS_VM_ENABLED: "RINGLESS_VM_ENABLED",
  NIGHTLY_DISCOVERY_ENABLED: "NIGHTLY_DISCOVERY_ENABLED",
};

function settingsKey(flag: string): string {
  return `wizard_flag_override:${flag}`;
}

interface CacheEntry {
  value: boolean | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function getCached(flag: string): boolean | null | undefined {
  const entry = cache.get(flag);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(flag);
    return undefined;
  }
  return entry.value;
}

function setCached(flag: string, value: boolean | null): void {
  cache.set(flag, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateFlagCache(flag?: string): void {
  if (flag) {
    cache.delete(flag);
  } else {
    cache.clear();
  }
}

export async function getWizardFlagOverride(flag: string): Promise<boolean | null> {
  const cached = getCached(flag);
  if (cached !== undefined) return cached;

  try {
    const key = settingsKey(flag);
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);

    const value = row?.value != null ? Boolean((row.value as any).enabled) : null;
    setCached(flag, value);
    return value;
  } catch (err) {
    console.warn(`[WizardFlags] Failed to read override for ${flag}:`, err);
    return null;
  }
}

export async function setWizardFlagOverride(
  flag: string,
  enabled: boolean,
  actorEmail: string,
  reason: string,
): Promise<void> {
  const key = settingsKey(flag);
  const value = { enabled, setBy: actorEmail, reason, setAt: new Date().toISOString() };

  const [existing] = await db
    .select({ id: systemSettings.id })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(systemSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(systemSettings.key, key));
  } else {
    await db.insert(systemSettings).values({ key, value });
  }

  invalidateFlagCache(flag);

  await storage.createAuditLog({
    action: "wizard_flag_override",
    entityType: "system",
    entityId: 0,
    actorType: "admin",
    details: { flag, enabled, actorEmail, reason, timestamp: new Date().toISOString() },
  }).catch(() => {});
}

export async function getAllFlagStates(): Promise<Record<string, {
  enabled: boolean;
  source: "env" | "db_override" | "default";
  envVarName: string;
}>> {
  const result: Record<string, { enabled: boolean; source: "env" | "db_override" | "default"; envVarName: string }> = {};

  await Promise.all(
    WIZARD_FLAGS.map(async (flag) => {
      const envVar = FLAG_ENV_VARS[flag];
      const envVal = process.env[envVar];

      if (envVal !== undefined && envVal !== "") {
        result[flag] = {
          enabled: envVal === "true" || envVal === "1",
          source: "env",
          envVarName: envVar,
        };
        return;
      }

      const dbOverride = await getWizardFlagOverride(flag);
      if (dbOverride !== null) {
        result[flag] = {
          enabled: dbOverride,
          source: "db_override",
          envVarName: envVar,
        };
        return;
      }

      result[flag] = {
        enabled: FLAG_DEFAULTS[flag],
        source: "default",
        envVarName: envVar,
      };
    })
  );

  return result;
}

export function isValidWizardFlag(flag: string): flag is WizardFlagName {
  return WIZARD_FLAGS.includes(flag as WizardFlagName);
}

export function getCachedWizardFlagOverrideSync(flag: string): boolean | null {
  const cached = getCached(flag);
  return cached === undefined ? null : cached;
}

// ── Background cache hydration ───────────────────────────────────────────────
// Preloads all flags from DB into the in-process cache so that the synchronous
// `getCachedWizardFlagOverrideSync()` path always returns a real value rather
// than null on a cold cache. Called once from registerWizardRoutes() at startup;
// safe to call multiple times (idempotent — only starts the interval once).

let _refreshInterval: ReturnType<typeof setInterval> | null = null;

async function hydrateAllFlags(): Promise<void> {
  await Promise.allSettled(WIZARD_FLAGS.map((f) => getWizardFlagOverride(f)));
}

export function startFlagCacheRefresh(): void {
  if (_refreshInterval !== null) return;
  // Hydrate immediately (fire-and-forget; errors are caught inside getWizardFlagOverride)
  hydrateAllFlags().catch(() => {});
  // Re-hydrate every 30 s to keep the in-process cache warm
  _refreshInterval = setInterval(() => {
    hydrateAllFlags().catch(() => {});
  }, CACHE_TTL_MS);
  // Allow the process to exit even if this interval is still pending
  if (typeof _refreshInterval.unref === "function") _refreshInterval.unref();
}
