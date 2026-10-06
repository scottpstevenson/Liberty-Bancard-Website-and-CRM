import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { tasks, deals, slaConfigs, taskAuthorityEvents } from "@shared/schema";
import { DEFAULT_SLA_RULES } from "@shared/sla-rules";
import { commandProducedTask, WorkCommandError } from "./work-item-command";
import { auditChange } from "./audit-change";

/** Discovery is bounded and identity-based, never title-based. */
export async function discoverSlaResolutionCandidates(afterId=0) {
  return db.select().from(tasks).where(and(eq(tasks.producer,"sla"),eq(tasks.subjectType,"deal"),
    sql`${tasks.issueKey} LIKE 'deal-sla:%'`,gt(tasks.id,afterId),
    inArray(tasks.authorityState,["open","in_progress"]),isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.id)).limit(500);
}

export async function resolveClearedSlaTask(candidate: typeof tasks.$inferSelect) {
  const result = await commandProducedTask({id:candidate.id,producer:"sla",
    commandId:`sla-clear:${candidate.id}:g${candidate.generation}`,observedFence:candidate.authorityFence,
    updates:{status:"completed"},context:{dealId:candidate.dealId,generation:candidate.generation,issueKey:candidate.issueKey},
    eligible:async (tx,before) => {
      if (before.producer !== "sla" || before.subjectType !== "deal" || before.subjectId !== before.dealId ||
        before.generation !== candidate.generation || before.issueKey !== candidate.issueKey ||
        !["open","in_progress"].includes(before.authorityState)) return false;
      const [created] = await tx.select().from(taskAuthorityEvents).where(and(eq(taskAuthorityEvents.taskId,before.id),
        eq(taskAuthorityEvents.eventType,"created"),eq(taskAuthorityEvents.producer,"sla")));
      const origin = (created?.payload as any)?.context?.slaRule;
      if (!origin || origin.name === undefined || origin.stage === undefined) return false;
      const [parent] = await tx.select().from(deals).where(eq(deals.id,before.dealId)).for("share");
      if (!parent) return false;
      if (parent.stage !== origin.stage || parent.closedAt) return true;
      // Even the empty/default-policy case is pinned against configuration
      // insertion; no rule change can race the final cleared-breach decision.
      await tx.execute(sql`LOCK TABLE sla_configs IN SHARE MODE`);
      const configured = await tx.select().from(slaConfigs);
      const rules = configured.length ? configured.filter(r => r.isActive) : DEFAULT_SLA_RULES;
      const rule = rules.find(r => r.entityType==="deal" && r.name===origin.name && r.stage===origin.stage);
      if (!rule || !parent.updatedAt) return false;
      return parent.updatedAt.getTime() >= Date.now() - rule.maxDurationMinutes*60_000;
    },
    afterWrite:async(tx,before,after) => auditChange({actorType:"system",action:"sla_breach_resolved",
      entityType:"deal",entityId:before.dealId,before:{taskId:before.id,state:before.authorityState},
      after:{taskId:after.id,state:after.authorityState,reason:"Current rule no longer breached"}},tx),
  });
  return {changed:result.changed,replayed:result.replayed};
}

export async function resolveClearedSlaTasks() {
  let afterId=0,resolved=0,reviewRequired=0,failed=0;
  for (;;) {
    const candidates = await discoverSlaResolutionCandidates(afterId);
    for (const candidate of candidates) {
      try { resolved += (await resolveClearedSlaTask(candidate)).changed; }
      catch (error) {
        if (error instanceof WorkCommandError) reviewRequired++;
        else { failed++; console.error("[SLA] Resolution unavailable; work retained",candidate.id,error); }
      }
    }
    if (candidates.length<500) break;
    afterId=candidates[candidates.length-1].id;
  }
  return {resolved,reviewRequired,failed};
}
