/**
 * Inbox identity is durable database state (inbox_items), never a process-local
 * cache. This module intentionally only defines the server-observed shape used
 * when persisting a source item.
 */
export type InboxItemResolution = {
  sourceItemId: string;
  sourceNamespace: string;
  contactId: number;
  channel: "email" | "sms" | "ghl_chat" | "voicemail" | "site";
  providerConversationId?: string;
  body: string;
  receivedAt: Date;
};