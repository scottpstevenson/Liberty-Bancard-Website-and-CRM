/**
 * automation-kill-switch.ts
 *
 * Provides isAutomationEnabled() — a cached helper that checks the
 * automation_registry table's kill_switch_enabled flag before allowing
 * a BullMQ queue / scheduled worker to execute.
 *
 * Cache TTL: 30 seconds to avoid DB hammering on every job tick.
 */

import { db } from "../db";
import { automationRegistry } from "@shared/schema";
import { eq } from "drizzle-orm";

interface CacheEntry {
  enabled: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds

const _cache = new Map<string, CacheEntry>();

/**
 * Returns true when the automation should run.
 * Returns false when kill_switch_enabled = true.
 * If the row doesn't exist in the registry, defaults to enabled (true).
 */
export async function isAutomationEnabled(key: string): Promise<boolean> {
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  try {
    const [row] = await db
      .select({ killSwitchEnabled: automationRegistry.killSwitchEnabled })
      .from(automationRegistry)
      .where(eq(automationRegistry.key, key))
      .limit(1);

    // If no row → default enabled. If row exists, enabled = !killSwitchEnabled.
    const enabled = row == null ? true : !(row.killSwitchEnabled ?? false);

    _cache.set(key, { enabled, expiresAt: now + CACHE_TTL_MS });
    return enabled;
  } catch (err) {
    // On DB error, fail CLOSED — cannot prove the queue is enabled; skip the job.
    // Callers must treat false as "skip this job".
    console.error(`[AutomationKillSwitch] Failed to check registry for key="${key}":`, err);
    return false;
  }
}

/**
 * Invalidates the in-process cache for a given key so the next call
 * reads a fresh value from the DB. Call this after toggling kill_switch_enabled.
 */
export function invalidateAutomationCache(key: string): void {
  _cache.delete(key);
}

/**
 * Batch-populates the kill-switch cache from an already-fetched registry snapshot.
 * Call this at startup before constructing any workers to avoid per-job DB queries
 * during cache-miss windows.
 *
 * @param rows - Array of registry rows, each with a key and killSwitchEnabled flag.
 */
export function primeKillSwitchCache(
  rows: Array<{ key: string; killSwitchEnabled: boolean | null }>,
): void {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  for (const row of rows) {
    _cache.set(row.key, {
      enabled: !(row.killSwitchEnabled ?? false),
      expiresAt,
    });
  }
}
