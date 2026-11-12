/**
 * Truthful summaries for the mobile More screen (health, inbox, tasks).
 *
 * Each summary has an explicit loading, unavailable, partial and settled state. A missing, failed or malformed read is never
 * rendered as "All systems go", "All caught up" or "No new messages": only a decoded, complete answer can say so.
 */
import { z } from "zod";
import { isPendingTask } from "@/lib/task-source";
import type { InboxSourcePage } from "@/lib/inbox-source";

// ── Health ──────────────────────────────────────────────────────────────────
// Shape of GET /api/admin/live-health: { ok, checks: [{ name, status, detail, critical }], summary: { total, ok, critical, criticalOk } }.
const healthCheckSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["ok", "error", "stale", "warn"]),
  detail: z.string().optional(),
  critical: z.boolean().optional(),
}).passthrough();
const liveHealthSchema = z.object({
  ok: z.boolean(),
  fetchedAt: z.string().optional(),
  checks: z.array(healthCheckSchema).min(1),
  summary: z.object({
    total: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    criticalOk: z.number().int().nonnegative(),
  }),
  cached: z.boolean().optional(),
  cacheAgeMs: z.number().nonnegative().optional(),
}).passthrough();
export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type LiveHealthCheck = z.infer<typeof healthCheckSchema>;

/** Strict decode; a response that does not match the current shape throws instead of defaulting to healthy. */
export function decodeLiveHealth(input: unknown): LiveHealth {
  const parsed = liveHealthSchema.parse(input);
  if (parsed.summary.total !== parsed.checks.length) throw new Error("Health summary does not match its checks.");
  return parsed;
}

export type HealthSummaryState =
  | { tone: "loading"; label: string; ok: false; badge: null }
  | { tone: "unavailable"; label: string; ok: false; badge: "!" }
  | { tone: "healthy" | "attention" | "unhealthy"; label: string; ok: boolean; badge: "!" | null; passing: number; total: number; notPassing: number };

export function healthSummary(read: { isLoading: boolean; isError: boolean; data: LiveHealth | undefined }): HealthSummaryState {
  if (read.isLoading) return { tone: "loading", label: "Checking systems…", ok: false, badge: null };
  if (read.isError || !read.data) return { tone: "unavailable", label: "Health status unavailable", ok: false, badge: "!" };
  const checks = read.data.checks;
  const passing = checks.filter((check) => check.status === "ok").length;
  const total = checks.length;
  const notPassing = total - passing;
  const criticalFailing = checks.some((check) => check.critical === true && check.status !== "ok") || read.data.ok === false;
  if (criticalFailing) {
    return { tone: "unhealthy", label: `Critical issue: ${passing} of ${total} checks passing`, ok: false, badge: "!", passing, total, notPassing };
  }
  if (notPassing > 0) {
    return { tone: "attention", label: `${passing} of ${total} checks passing`, ok: false, badge: "!", passing, total, notPassing };
  }
  return { tone: "healthy", label: `${passing} of ${total} checks passing`, ok: true, badge: null, passing, total, notPassing };
}

/** "Checked 4 min ago" from the server timestamp; absent or future timestamps say nothing rather than guess. */
export function healthFreshness(data: LiveHealth | undefined, now: number): string | null {
  if (!data?.fetchedAt) return null;
  const at = Date.parse(data.fetchedAt);
  if (!Number.isFinite(at) || at > now) return null;
  const minutes = Math.floor((now - at) / 60000);
  return minutes < 1 ? "Checked just now" : `Checked ${minutes} min ago`;
}

// ── Inbox ───────────────────────────────────────────────────────────────────
export type InboxSummaryState = {
  tone: "loading" | "unavailable" | "unread" | "none" | "none_incomplete";
  label: string;
  badge: string | null;
  complete: boolean;
};

/** The count comes from the inbox authority (`/api/inbox/items?filter=unread`), never from notification totals. */
export function inboxSummary(read: { isLoading: boolean; isError: boolean; data: InboxSourcePage | undefined }): InboxSummaryState {
  if (read.isLoading) return { tone: "loading", label: "Checking messages…", badge: null, complete: false };
  if (read.isError || !read.data) return { tone: "unavailable", label: "Messages unavailable. Open Inbox to retry.", badge: null, complete: false };
  const page = read.data;
  const sourcesIncomplete = page.sourceStatus.some((source) => source.status === "failed" || source.truncated);
  const exact = page.complete && !page.hasMoreKnown && !sourcesIncomplete;
  const count = page.items.length;
  if (count > 0) {
    return {
      tone: "unread",
      label: exact ? `${count} unread` : `${count}+ unread · list may be incomplete`,
      badge: exact ? String(count) : `${count}+`,
      complete: exact,
    };
  }
  if (exact) return { tone: "none", label: "No unread messages", badge: null, complete: true };
  return {
    tone: "none_incomplete",
    label: sourcesIncomplete ? "No unread found · some message sources did not respond" : "No unread found · list may be incomplete",
    badge: null,
    complete: false,
  };
}

// ── Tasks ───────────────────────────────────────────────────────────────────
export type TaskSummaryState = { tone: "loading" | "unavailable" | "open" | "none"; label: string; badge: string | null; count: number };

export function taskSummary(read: { isLoading: boolean; isError: boolean; data: Array<Parameters<typeof isPendingTask>[0]> | undefined }): TaskSummaryState {
  if (read.isLoading) return { tone: "loading", label: "Loading tasks…", badge: null, count: 0 };
  if (read.isError || !read.data) return { tone: "unavailable", label: "Tasks unavailable. Open Tasks to retry.", badge: null, count: 0 };
  const count = read.data.filter((task) => isPendingTask(task)).length;
  return count > 0
    ? { tone: "open", label: `${count} open task${count === 1 ? "" : "s"}`, badge: String(count), count }
    : { tone: "none", label: "No open tasks", badge: null, count: 0 };
}
