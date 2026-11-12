/**
 * Bounded foreground refresh for the Inbox (mobile feed, mobile and desktop selected conversation).
 *
 * The shared query defaults disable polling and focus refetch and `staleTime` alone never polls, so an open Inbox would
 * not show a new reply. These rules add refresh that is:
 *   - foreground only (TanStack pauses interval refetch in a hidden tab; `refetchIntervalInBackground` stays false);
 *   - bounded: one cadence for everyone, no refresh of a deeply paged list (each refresh re-reads every loaded page),
 *     and a selected conversation refetches only when the feed's view of that contact actually changed;
 *   - actor-bound and cancellable: callers use the protected query hooks, which scope keys to the actor and pass an abort signal.
 */
export const INBOX_FEED_REFRESH_MS = 45_000;
/** Beyond this many loaded pages the list stops auto-refreshing; the person can still pull to retry or reload. */
export const INBOX_MAX_AUTO_REFRESH_PAGES = 3;

export const inboxForegroundRefresh = {
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
} as const;

export function inboxFeedRefreshInterval(loadedPages: number | undefined): number | false {
  return (loadedPages ?? 0) <= INBOX_MAX_AUTO_REFRESH_PAGES ? INBOX_FEED_REFRESH_MS : false;
}

type FeedRow = { id: string; contactId?: number | null; isRead?: boolean | null; receivedAt?: string | null; updatedAt?: string | null };

/**
 * A short fingerprint of what the loaded feed currently says about one contact. It changes only when a message for that
 * contact arrives, is removed, or changes read state, so it can drive a single refetch of the open conversation instead of a timer.
 */
export function selectedFeedStamp(rows: readonly FeedRow[], contactId: number | null | undefined): string {
  if (!contactId) return "";
  const own = rows.filter((row) => row.contactId === contactId);
  if (own.length === 0) return "none";
  const newest = own.reduce((best, row) => {
    const at = row.receivedAt ?? row.updatedAt ?? "";
    return at > best ? at : best;
  }, "");
  return `${own.length}|${newest}|${own.filter((row) => row.isRead === false).length}`;
}
