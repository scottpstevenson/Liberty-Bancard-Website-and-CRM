import { storage } from "../storage";
import { db } from "../db";
import { tasks } from "@shared/schema";
import { and, eq, ilike } from "drizzle-orm";

export async function runAbandonedStatementCheck(): Promise<{ checked: number; tasksCreated: number; errors: number }> {
  let checked = 0;
  let tasksCreated = 0;
  let errors = 0;

  try {
    const openRequests = await storage.listOpenStatementRequests(3);

    for (const req of openRequests) {
      checked++;
      try {
        const marker = `statement_request_id:${req.id}`;

        const existingTask = await db.select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.contactId, req.contactId),
              eq(tasks.status, "pending"),
              ilike(tasks.description, `%${marker}%`),
            ),
          )
          .limit(1);

        if (existingTask.length > 0) {
          continue;
        }

        await storage.createTask({
          contactId: req.contactId,
          dealId: req.dealId ?? undefined,
          title: "Follow up: merchant statement upload not completed",
          description: `Merchant has not uploaded their statement. ${marker}`,
          priority: "normal",
          status: "pending",
        });

        await storage.updateStatementRequest(req.id, {
          lastReminderTaskAt: new Date(),
        });

        await storage.createAuditLog({
          action: "abandoned_statement_task_created",
          entityType: "contact",
          entityId: req.contactId,
          actorType: "system",
          details: {
            statementRequestId: req.id,
            marker,
            requestedAt: req.requestedAt.toISOString(),
          },
        });

        tasksCreated++;
      } catch (rowErr: any) {
        console.error(`[AbandonedStatementWorker] Error processing request #${req.id}:`, rowErr.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[AbandonedStatementWorker] Fatal error:", err.message);
    errors++;
  }

  console.log(`[AbandonedStatementWorker] Done — ${checked} requests checked, ${tasksCreated} tasks created, ${errors} errors`);
  return { checked, tasksCreated, errors };
}
