import { z } from "zod";

/** Validate the existing reader contract; malformed success is never empty. */
const messageChannel = z.enum(["email", "sms", "ghl_chat", "voicemail", "site"]);
export const inboxSourceItemSchema = z.object({
  id: z.string().min(1).max(512),
  contactId: z.number().int().positive().nullable(),
  contactName: z.string().nullable(),
  companyName: z.string().nullable().optional(),
  channel: messageChannel,
  subject: z.string().nullable().optional(),
  preview: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  isRead: z.boolean().nullable(),
  receivedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
const inboxSourcePageSchema = z.object({
  items: z.array(inboxSourceItemSchema),
  complete: z.boolean(),
  totalIsExact: z.boolean(),
  knownFilteredCount: z.number().int().nonnegative(),
  hasMoreKnown: z.boolean(),
  sourceStatus: z.array(z.object({
    source: z.string().min(1),
    status: z.enum(["ok", "failed", "not_configured"]),
    fetched: z.number().int().nonnegative(),
    truncated: z.boolean(),
    errorCode: z.string().optional(),
  })),
  nextCursor: z.string().min(1).nullable(),
}).passthrough();
export type InboxSourceItem = z.infer<typeof inboxSourceItemSchema>;
export type InboxSourcePage = z.infer<typeof inboxSourcePageSchema>;
export function decodeInboxSourceItem(input: unknown, expectedId: string) {
  const item = inboxSourceItemSchema.parse(input);
  if (item.id !== expectedId) throw new Error("Message reader returned a different source identity.");
  return item;
}
export function decodeInboxSourcePage(input: unknown) {
  return inboxSourcePageSchema.parse(input);
}
