import { storage } from "../storage";

const PROGRESS_KEY = "contact_scoring_job_progress";

export function sanitizeScoringError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  let safe: string;
  if (
    lower.includes("connect") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("socket") ||
    lower.includes("network") ||
    lower.includes("authentication") ||
    lower.includes("password") ||
    lower.includes("credentials") ||
    lower.includes("unauthorized") ||
    lower.includes("403") ||
    lower.includes("401")
  ) {
    safe = "db_write_error";
  } else if (lower.includes("ownership") || lower.includes("runid")) {
    safe = "ownership_lost";
  } else if (
    lower.includes("score") ||
    lower.includes("calculation") ||
    lower.includes("nan") ||
    lower.includes("undefined") ||
    lower.includes("null")
  ) {
    safe = "scoring_calculation_error";
  } else if (
    lower.includes("transaction") ||
    lower.includes("rollback") ||
    lower.includes("constraint") ||
    lower.includes("conflict")
  ) {
    safe = "db_write_error";
  } else {
    safe = "unexpected_batch_failure";
  }

  safe = safe.replace(/[\r\n\t\x00-\x1F]/g, "");
  return safe.slice(0, 120);
}

export function buildSafeScoringFailureProgress(
  progress: Record<string, unknown> | null,
  err: unknown
): Record<string, unknown> {
  return {
    ...(progress ?? {}),
    status: "failed",
    failedAt: new Date().toISOString(),
    error: sanitizeScoringError(err),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function markScoringInterrupted(): Promise<void> {
  try {
    const raw = await storage.getSystemSetting(PROGRESS_KEY);
    if (raw === null || raw === undefined) return;
    if (typeof raw !== "object" || Array.isArray(raw) || !("status" in raw)) {
      console.warn("[ScoringReconcile] contact_scoring_job_progress has unexpected shape — skipping");
      return;
    }
    const value = raw as Record<string, unknown>;
    if (value.status !== "running") return;

    await storage.setSystemSetting(PROGRESS_KEY, {
      ...value,
      status: "interrupted",
      interruptedAt: new Date().toISOString(),
      interruptionReason: "server_restart",
      updatedAt: new Date().toISOString(),
      error: undefined,
    });

    console.log(`[ScoringReconcile] contact_scoring_job_progress marked interrupted (was running since ${value.startedAt ?? "unknown"})`);
  } catch (err) {
    console.error("[ScoringReconcile] Reconciliation failed — continuing startup:", err);
  }
}
