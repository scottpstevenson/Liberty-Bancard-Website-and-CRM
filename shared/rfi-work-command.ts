import {z} from "zod";
import {RFI_CATEGORIES,RFI_STATUSES} from "./schema";
const localId=z.number().int().positive().max(2147483647).nullable().optional();
export const rfiWorkFields=z.object({
  subject:z.string().trim().min(1).max(500).optional(),
  description:z.string().max(20000).nullable().optional(),
  contactId:localId,dealId:localId,
  category:z.enum(RFI_CATEGORIES).nullable().optional(),
  priority:z.enum(["Low","Normal","High","Urgent"]).nullable().optional(),
  status:z.enum(RFI_STATUSES).nullable().optional(),
  assignedTo:z.string().trim().min(1).max(190).nullable().optional(),
  requestedBy:z.string().trim().max(190).nullable().optional(),
  response:z.string().max(20000).nullable().optional(),
  dueDate:z.string().datetime({offset:true}).transform(value=>new Date(value)).nullable().optional(),
}).strict();
export const rfiWorkCommand=rfiWorkFields.extend({
  commandId:z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),expectedActorId:z.string().min(1),
  expectedAccountVersion:z.number().int().nonnegative(),
  expectedFence:z.number().int().nonnegative().optional(),
}).strict();
export type RfiWorkCommand=z.infer<typeof rfiWorkCommand>;
