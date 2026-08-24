/**
 * Short-lived, server-derived mappings for the aggregated Inbox feed.
 *
 * The unified feed composes provider and local sources without writing metadata
 * on read. Mutations may use only a mapping observed by the server, never a
 * body-supplied contact or provider-conversation identifier.
 */
export type InboxItemResolution = {
  sourceItemId: string;
  contactId: number;
  channel: "email" | "sms" | "ghl_chat" | "voicemail" | "site";
  providerConversationId?: string;
};

const TTL_MS = 10 * 60 * 1000;
const resolutions = new Map<string, { value: InboxItemResolution; expiresAt: number }>();

export function rememberInboxItemResolutions(items: InboxItemResolution[]): void {
  const expiresAt = Date.now() + TTL_MS;
  for (const item of items) {
    if (Number.isInteger(item.contactId) && item.contactId > 0) {
      resolutions.set(item.sourceItemId, { value: item, expiresAt });
    }
  }
}

export function getInboxItemResolution(sourceItemId: string): InboxItemResolution | undefined {
  const entry = resolutions.get(sourceItemId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    resolutions.delete(sourceItemId);
    return undefined;
  }
  return entry.value;
}