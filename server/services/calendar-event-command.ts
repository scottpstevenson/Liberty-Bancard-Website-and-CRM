import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { calendarEvents, users } from "@shared/schema";
import { auditChange } from "./audit-change";

/**
 * Local calendar events are CRM-owned planning records. The browser may set exactly these fields. The provider link
 * (`ghlEventId`), the creation time and the id are never writable here, and the owner changes only through the
 * audited reassignment below. Unknown fields are refused (400), not silently stored or dropped.
 */
export const calendarEventFields = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  allDay: z.boolean(),
  type: z.string().trim().min(1).max(60),
  contactId: z.number().int().positive().nullable(),
  dealId: z.number().int().positive().nullable(),
  location: z.string().max(500).nullable(),
  status: z.string().trim().min(1).max(60),
}).partial().strict();

export const calendarEventCreateSchema = calendarEventFields.required({ title: true, startTime: true, endTime: true });

export type CalendarEventPatch = z.infer<typeof calendarEventFields>;

export type ReassignResult =
  | { ok: true; event: typeof calendarEvents.$inferSelect }
  | { ok: false; reason: "not_found" | "unknown_owner" | "invalid_interval" };

/** One transaction: lock the row, apply the DTO, and (when the owner changes) write the audit row with the update. */
export async function updateCalendarEventAtomic(input: {
  id: number; patch: CalendarEventPatch; newOwnerId?: string; actorId: string | null;
}): Promise<ReassignResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(calendarEvents).where(eq(calendarEvents.id, input.id)).for("update");
    if (!existing) return { ok: false, reason: "not_found" } as const;
    const start = input.patch.startTime ?? existing.startTime;
    const end = input.patch.endTime ?? existing.endTime;
    if (end <= start) return { ok: false, reason: "invalid_interval" } as const;
    const set: Record<string, unknown> = { ...input.patch };
    const reassign = input.newOwnerId !== undefined && input.newOwnerId !== existing.ownerId;
    if (reassign) {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.newOwnerId!));
      if (!owner) return { ok: false, reason: "unknown_owner" } as const;
      set.ownerId = input.newOwnerId;
    }
    if (Object.keys(set).length === 0) return { ok: true, event: existing } as const;
    const [updated] = await tx.update(calendarEvents).set(set as any).where(eq(calendarEvents.id, input.id)).returning();
    if (reassign) {
      await auditChange({
        actorType: "user", userId: input.actorId, action: "calendar_event_reassigned", entityType: "calendar_event",
        entityId: input.id, before: { ownerId: existing.ownerId }, after: { ownerId: input.newOwnerId },
      }, tx);
    }
    return { ok: true, event: updated } as const;
  });
}
