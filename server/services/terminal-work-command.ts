import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { users, deals, tasks } from "@shared/schema";
import { auditChange } from "./audit-change";
import { commandProducedTask, WorkCommandError, type WorkActor } from "./work-item-command";

/** Bounded repair of the existing local approval+completion caller. No boarding,
 * native workflow, notification transport or provider execution belongs here. */
export async function decideTerminalWork(input: {
  dealId: number; decision: "approved"|"rejected"; actor: WorkActor; reason?: string;
}) {
  return db.transaction(async tx => {
    const [actor] = await tx.select().from(users).where(and(eq(users.id,input.actor.id),
      eq(users.accountState,"active"),eq(users.authEpoch,input.actor.authEpoch))).for("share");
    if (!actor || !["admin","manager"].includes(actor.role ?? "")) throw new WorkCommandError("Work item unavailable",404);
    const [candidate] = await tx.select().from(deals).where(and(eq(deals.id,input.dealId),
      eq(deals.recordClass,"production"),isNull(deals.archivedAt)));
    if (!candidate) throw new WorkCommandError("Work item unavailable",404);
    if (!candidate.terminalApprovalTaskId) throw new WorkCommandError("Terminal approval work item missing. Review the prepared request before deciding.",409);
    const taskId = candidate.terminalApprovalTaskId;
    const result = await commandProducedTask({ id:taskId, producer:"terminal_approval",actor:input.actor,
      commandId:`terminal-decision:${input.dealId}:${taskId}:${input.decision}`,
      updates:{status:"completed"}, context:{dealId:input.dealId,decision:input.decision,reason:input.reason ?? null},
      eligible: async (_tx,before) => {
        const [current] = await tx.select().from(deals).where(eq(deals.id,input.dealId));
        return before.dealId === input.dealId && ["open","in_progress"].includes(before.authorityState) &&
          current?.terminalApprovalTaskId === taskId && current.terminalApprovalStatus === "pending_approval";
      },
      afterWrite: async () => {
        const [before] = await tx.select().from(deals).where(eq(deals.id,input.dealId)).for("update");
        if (before.terminalApprovalTaskId !== taskId || before.terminalApprovalStatus !== "pending_approval") {
          throw new WorkCommandError("Terminal request changed. No decision or work completion was saved.",409);
        }
        const [after] = await tx.update(deals).set({terminalApprovalStatus:input.decision,updatedAt:new Date()})
          .where(eq(deals.id,input.dealId)).returning();
        await auditChange({actorType:"user",userId:actor.id,action:`terminal_approval_${input.decision}`,
          entityType:"deal",entityId:input.dealId,before,after},tx);
      },
    },tx);
    const [currentDeal] = await tx.select().from(deals).where(eq(deals.id,input.dealId));
    const [currentTask] = await tx.select().from(tasks).where(eq(tasks.id,taskId));
    if (currentDeal.terminalApprovalTaskId !== taskId || currentDeal.terminalApprovalStatus !== input.decision ||
      currentTask.deletedAt || currentTask.authorityState !== "completed") {
      throw new WorkCommandError("The retained decision differs from current work. Review the current request; no new decision was executed.",409);
    }
    return {deal:currentDeal,replayed:result.replayed};
  });
}
