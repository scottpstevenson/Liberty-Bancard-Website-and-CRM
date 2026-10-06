import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { tickets } from "@shared/schema";
import { commandWorkItems, WorkCommandError } from "./work-item-command";
import { auditChange } from "./audit-change";

export async function autoCloseResolvedTicket(candidate: typeof tickets.$inferSelect) {
  return commandWorkItems({kind:"ticket",producer:"ticket_maintenance",
    items:[{id:candidate.id,expectedFence:candidate.authorityFence}],
    commandId:`ticket-auto-close:${candidate.id}:g${candidate.generation}`,updates:{status:"Closed"},
    context:{policy:"resolved_for_7_days",generation:candidate.generation},
    eligible:async(_tx,current) => {
      const cutoff = Date.now()-7*24*60*60_000;
      return current.generation===candidate.generation && current.status==="Resolved" && current.authorityState==="completed" &&
        current.updatedAt?.getTime()<cutoff && current.resolvedAt?.getTime()<cutoff;
    },
    afterWrite:async(tx,before,after) => auditChange({actorType:"system",action:"ticket_auto_closed",entityType:"ticket",
      entityId:before.id,before:{status:before.status,resolvedAt:before.resolvedAt},after:{status:after.status},
      details:{reason:"Resolved and unchanged for 7+ days"}},tx),
  });
}

/** Discovery is indexed/bounded; final current state and fence are rechecked
 * inside each command. No notifications, native operations or worker startup. */
export async function autoCloseResolvedTickets() {
  const cutoff = new Date(Date.now()-7*24*60*60_000);
  const candidates = await db.select().from(tickets).where(and(eq(tickets.status,"Resolved"),
    eq(tickets.authorityState,"completed"),lt(tickets.updatedAt,cutoff),lt(tickets.resolvedAt,cutoff)))
    .orderBy(asc(tickets.id)).limit(500);
  let closed=0,reviewRequired=0,failed=0;
  for (const candidate of candidates) {
    try { const result = await autoCloseResolvedTicket(candidate); closed += result.replayed ? 0 : result.changed; }
    catch(error) {
      if (error instanceof WorkCommandError) reviewRequired++;
      else { failed++; console.error("[SLA] Ticket auto-close unavailable; work retained",candidate.id,error); }
    }
  }
  return {closed,reviewRequired,failed};
}
