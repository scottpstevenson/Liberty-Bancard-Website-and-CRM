import { and, eq } from "drizzle-orm";
import { taskAuthorityEvents } from "@shared/schema";
import { db } from "../db";
import { commandWorkItems, WorkCommandError, type WorkActor } from "./work-item-command";
import { auditChange } from "./audit-change";

type NativeOutcome = { disposition: "succeeded" | "blocked" | "definite_failure" | "unknown"; reason?: string };
export type NativeTaskDeleteTransport = (identity: { taskId: number; ghlTaskId: string; ghlContactId: string }) => Promise<NativeOutcome>;

async function actualTransport(identity: Parameters<NativeTaskDeleteTransport>[0]): Promise<NativeOutcome> {
  const { authorize } = await import("./outbound-pause-authority");
  const decision = await authorize({});
  if (!decision.allowed) return { disposition: "blocked", reason: decision.reasonCode };
  const { propagateTaskDeleteToGhl } = await import("./ghl-delete-sync");
  const result = await propagateTaskDeleteToGhl(identity.taskId, identity.ghlTaskId, identity.ghlContactId);
  if (result.skipped) return { disposition: "blocked", reason: result.reason };
  if (result.ok) return { disposition: "succeeded" };
  return { disposition: result.reason === "paused" ? "blocked" : "unknown",
    reason: result.reason === "paused" ? "paused" : "native_result_unavailable" };
}

/** Retained intent -> exclusive dispatch -> native receipt -> local commit.
 * No DB lock spans I/O. Unknown outcomes keep the intent fencing local edits.
 * Replays may retry local commit after success but NEVER repeat native I/O. */
export async function deleteTaskCommand(input: {
  id: number; expectedFence: number; commandId: string; actor: WorkActor;
  recordClass: "production" | "test" | "demo" | "all";
}, transport: NativeTaskDeleteTransport = actualTransport) {
  const base = { kind: "task" as const, items: [{ id: input.id, expectedFence: input.expectedFence }],
    commandId: input.commandId, actor: input.actor, recordClass: input.recordClass, updates: {} };
  const prepared = await commandWorkItems({ ...base, operation: "delete" });
  const intent = prepared.results[0];
  if (!intent.native) return { success: true, localDeleted: true, nativeOutcome: "not_needed", replayed: prepared.replayed };
  const key = `native-result:${input.commandId}`;
  const readResult = async () => (await db.select().from(taskAuthorityEvents).where(and(
    eq(taskAuthorityEvents.taskId, input.id), eq(taskAuthorityEvents.eventKey, key))))[0];
  let receipt = await readResult();
  if (!receipt) {
    let dispatch;
    try {
      dispatch = await commandWorkItems({ ...base, operation: "native_dispatch",
        eligible: async () => !!intent.native.ghlTaskId && !!intent.native.ghlContactId });
    } catch (error) {
      // Missing native identity or changed authority: retain a blocked outcome,
      // releasing the intent without changing the work item.
      if (!(error instanceof WorkCommandError)) throw error;
      await retain({ disposition: "blocked", reason: "dispatch_authority_changed" });
      throw error;
    }
    if (dispatch.replayed) throw new WorkCommandError("Native dispatch is pending or its outcome is unknown. No local task was deleted; review the retained intent rather than repeating the native request.", 409);
    const current = dispatch.results[0].native;
    let outcome: NativeOutcome;
    if (current.ghlTaskId !== intent.native.ghlTaskId || current.ghlContactId !== intent.native.ghlContactId) {
      outcome = { disposition: "blocked", reason: "native_identity_changed" };
    } else {
      try { outcome = await transport({ taskId: input.id, ghlTaskId: current.ghlTaskId, ghlContactId: current.ghlContactId }); }
      catch { outcome = { disposition: "unknown", reason: "native_result_unavailable" }; }
    }
    await retain(outcome);
    receipt = await readResult();
  }
  const outcome = (receipt?.payload as any)?.outcome as NativeOutcome | undefined;
  if (outcome) await retainAudit(outcome);
  if (outcome?.disposition !== "succeeded") {
    throw new WorkCommandError(`Native deletion ${outcome?.disposition ?? "unknown"} (${outcome?.reason ?? "review required"}). No local task was deleted.`, 409);
  }
  await commandWorkItems({ ...base, operation: "native_finalize" });
  return { success: true, localDeleted: true, nativeOutcome: "succeeded", replayed: prepared.replayed };

  async function retain(outcome: NativeOutcome) {
    // Preserve the provider fact independently of local audit availability.
    // A failed audit is retried; it must not erase an observed native outcome.
    await db.insert(taskAuthorityEvents).values({
      taskId: input.id, eventKey: key, eventType: outcome.disposition === "blocked" ? "native_delete_blocked"
        : outcome.disposition === "definite_failure" ? "native_delete_failed" : `native_delete_${outcome.disposition}`,
      producer: "dashboard", commandKey: input.commandId, fence: input.expectedFence,
      payload: { outcome, nativeIdentity: intent.native },
    }).onConflictDoNothing({ target: [taskAuthorityEvents.taskId, taskAuthorityEvents.eventKey] });
    await retainAudit(outcome);
  }
  async function retainAudit(outcome: NativeOutcome) {
    await db.transaction(async tx => {
      const [inserted] = await tx.insert(taskAuthorityEvents).values({
        taskId: input.id, eventKey: `native-audit:${input.commandId}`, eventType: "native_delete_result_audited",
        producer: "dashboard", commandKey: input.commandId, fence: input.expectedFence,
      }).onConflictDoNothing({ target: [taskAuthorityEvents.taskId, taskAuthorityEvents.eventKey] }).returning();
      if (inserted) await auditChange({ actorType: "user", userId: input.actor.id, action: "task_native_delete_result",
        entityType: "task", entityId: input.id, before: null, after: { disposition: outcome.disposition,
          localDeleted: false, commandId: input.commandId } }, tx);
    });
  }
}
