import { z } from "zod";

export const strictRecordId = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(2147483647));
const nullableId = z.number().int().positive().max(2147483647).nullable().optional();
const dueDate = z.string().datetime({ offset: true }).transform(v => new Date(v)).nullable().optional();
const assignee = z.string().trim().min(1).max(190).nullable().optional();
export const taskEditFields = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(["pending","open","in progress","in_progress","completed","cancelled"]).optional(),
  priority: z.enum(["low","normal","medium","high","urgent"]).optional(),
  contactId: nullableId, dealId: nullableId, ticketId: nullableId, assignedTo: assignee, dueDate,
}).strict();
export const ticketEditFields = z.object({
  subject: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20000).optional(),
  status: z.enum(["New Ticket","Open","In Progress","Waiting on Merchant","Resolved","Closed"]).optional(),
  priority: z.string().min(1).max(30).optional(),
  category: z.string().min(1).max(100).nullable().optional(),
  contactId: nullableId, assignedTo: assignee,
}).strict();
export const workCommandEnvelope = z.object({
  expectedFence: z.number().int().nonnegative(),
  commandId: z.string().uuid(),
  expectedActorId: z.string().min(1).max(190).optional(),
  expectedAccountVersion:z.number().int().positive().optional(),
  recordClass: z.enum(["production","test","demo","all"]).default("production"),
});
export const taskEditCommand = taskEditFields.merge(workCommandEnvelope).strict();
export const ticketEditCommand = ticketEditFields.merge(workCommandEnvelope).strict();
export const taskCreateCommand = taskEditFields.extend({
  title:z.string().trim().min(1).max(500),commandId:z.string().uuid(),
  expectedActorId:z.string().min(1).max(190),
  expectedAccountVersion:z.number().int().positive().optional(),
  recordClass:z.enum(["production","test","demo","all"]).default("production"),
}).strict();
export const workSelection = z.array(z.object({
  id: z.number().int().positive().max(2147483647), expectedFence: z.number().int().nonnegative(),
}).strict()).min(1).max(10000).refine(items => {
  const fences = new Map<number, number>();
  for (const item of items) {
    if (fences.has(item.id) && fences.get(item.id) !== item.expectedFence) return false;
    fences.set(item.id, item.expectedFence);
  }
  return true;
}, "Duplicate IDs have different versions").transform(items =>
  [...new Map(items.map(i => [i.id, i])).values()].sort((a,b) => a.id-b.id));

export function legacyTicketStatusToAuthorityState(status: string | null | undefined): "open" | "in_progress" | "completed" | "cancelled" {
  const value = (status ?? "").trim().toLowerCase();
  if (["resolved","closed","completed"].includes(value)) return "completed";
  if (["cancelled","canceled"].includes(value)) return "cancelled";
  if (value === "in progress") return "in_progress";
  return "open";
}

export function legacyTaskStatusToAuthorityState(status?: string | null): "open" | "in_progress" | "completed" | "cancelled" {
  switch ((status ?? "").toLowerCase()) {
    case "in progress": case "in_progress": return "in_progress";
    case "completed": case "complete": case "done": return "completed";
    case "cancelled": case "canceled": return "cancelled";
    default: return "open";
  }
}
export function authorityStateToLegacyTaskStatus(state: ReturnType<typeof legacyTaskStatusToAuthorityState>): string {
  return { open:"pending", in_progress:"in_progress", completed:"completed", cancelled:"cancelled" }[state];
}
