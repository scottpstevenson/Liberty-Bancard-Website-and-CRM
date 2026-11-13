/**
 * Pure presentation rules for the notification list.
 *
 * Nothing here deletes, hides from the account, or changes read state. Older digest and SLA/due-soon reminders are only
 * moved below current work in their own named group, so what needs a person today is not interleaved with summaries that
 * were true yesterday. A group is a view; every notification stays openable and keeps its own unread state.
 */

export type NotificationTargetFacts = { state: string; url: string | null; label?: string; context?: string; actionLabel?: string | null } | undefined;
export type NotificationFacts = {
  id: number;
  read: boolean | null;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
  target?: NotificationTargetFacts;
};

/** Reminders and summaries are time-bound: after this long they are history, not work. */
export const AGED_SYSTEM_NOTICE_MS = 48 * 60 * 60 * 1000;

const SYSTEM_SUMMARY_EVENTS: ReadonlySet<string> = new Set(["daily_digest", "weekly_digest", "sla_breach", "task_due_soon"]);

/** Digest summaries and SLA/due-soon reminders. Decided only from the producer's recorded event type or digest kind. */
export function isSystemSummaryNotification(notification: Pick<NotificationFacts, "metadata">): boolean {
  const metadata = notification.metadata ?? {};
  const eventType = metadata.eventType;
  if (typeof eventType === "string" && SYSTEM_SUMMARY_EVENTS.has(eventType)) return true;
  return metadata.digestType === "daily" || metadata.digestType === "weekly";
}

export function isAgedSystemNotification(notification: NotificationFacts, now: number): boolean {
  if (!isSystemSummaryNotification(notification) || !notification.createdAt) return false;
  const created = new Date(notification.createdAt).getTime();
  return Number.isFinite(created) && now - created > AGED_SYSTEM_NOTICE_MS;
}

/** Order inside each group is the caller's order (newest first); the split never reorders, drops or duplicates a row. */
export function groupNotifications<T extends NotificationFacts>(notifications: readonly T[], now: number): { current: T[]; aged: T[]; agedUnread: number } {
  const current: T[] = [];
  const aged: T[] = [];
  for (const notification of notifications) (isAgedSystemNotification(notification, now) ? aged : current).push(notification);
  return { current, aged, agedUnread: aged.filter(notification => !notification.read).length };
}

/** The server names what opens; an older server response falls back to a role-neutral but still specific phrase. */
export function notificationActionLabel(target: NotificationTargetFacts): string {
  if (target?.state !== "available") return "Open record";
  return target.actionLabel?.trim() || "Open record";
}

/** Plain words for a row with nothing to open: explicit, never a blank or a guess. */
export const NOTIFICATION_UNRESOLVED_LABEL = "No linked record";
export const NOTIFICATION_UNRESOLVED_DETAIL = "This older alert did not record which request or work it belongs to, so it cannot be opened from here.";
