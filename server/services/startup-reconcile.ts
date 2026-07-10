import { storage } from "../storage";

export async function reconcileEnrichmentState(
  storageImpl: Pick<typeof storage, "getSystemSetting" | "setSystemSetting"> = storage
): Promise<void> {
  try {
    const raw = await storageImpl.getSystemSetting("enrichment_progress");

    if (raw === null || raw === undefined) return;

    if (typeof raw !== "object" || Array.isArray(raw) || !("status" in raw)) {
      console.warn("[StartupReconcile] enrichment_progress has unexpected shape — skipping");
      return;
    }

    const value = raw as Record<string, unknown>;

    if (value.status !== "running") return;

    await storageImpl.setSystemSetting("enrichment_progress", {
      ...value,
      status: "interrupted",
      interruptedAt: new Date().toISOString(),
      interruptionReason: "server_restart",
      failedAt: undefined,
      error: undefined,
    });

    console.log(`[StartupReconcile] enrichment_progress marked interrupted (was running since ${value.startedAt ?? "unknown"})`);
  } catch (err) {
    console.error("[StartupReconcile] Reconciliation failed — continuing startup:", err);
  }
}
