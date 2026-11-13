/**
 * Row contracts for the Today work queue.
 *
 * Every row is one question with its own source, window and destination. A read that is loading, failed, or not configured is
 * stated as such; it is never rendered as zero, because zero on Today reads as "nothing to do".
 */
import { inboxSummary } from "./mobile-more-summary";
import type { InboxSourcePage } from "./inbox-source";
import { buildAppointmentWindowHref, buildInboxWorkspaceHref, buildIntakeCohortHref, todayDestinations } from "./crm-destination-state";
import { summarizeUnassigned } from "./unassigned-work";

export type CockpitRowState = "loading" | "unavailable" | "ready" | "partial";
export type CockpitRow = {
  key: "unread" | "intake" | "unassigned" | "appointments";
  label: string;
  /** Null whenever the count cannot be stated truthfully. */
  value: number | null;
  /** Shown beside the number when it is a lower bound ("5+") or a scoped count. */
  qualifier: string | null;
  state: CockpitRowState;
  note: string | null;
  href: string;
  cta: string;
  tone: "alert" | "normal";
};

/** Each row opens the population it counted: unread conversations, the needs-review intake group, open unowned tasks, and the
 *  exact appointment window (the window's start is carried in the link, see appointmentRow). */
export const COCKPIT_DESTINATIONS = {
  inbox: buildInboxWorkspaceHref("/dashboard/comms-hub", { channel: "all", filter: "unread" }),
  intake: buildIntakeCohortHref("needs_review"),
  unassigned: todayDestinations.unassignedTasks,
} as const;

/** Intake and unassigned review are management work; reps never see another person's queue on their own Today. */
export function cockpitPermissions(role: string | null | undefined) {
  const manager = role === "admin" || role === "manager";
  return { intake: manager, unassigned: manager };
}

type Read<T> = { isLoading: boolean; isError: boolean; data: T | undefined };

export function unreadRow(read: Read<InboxSourcePage>): CockpitRow {
  const base = { key: "unread" as const, label: "Unread conversations", href: COCKPIT_DESTINATIONS.inbox, cta: "Open Inbox" };
  const summary = inboxSummary(read);
  if (summary.tone === "loading") return { ...base, value: null, qualifier: null, state: "loading", note: null, tone: "normal" };
  if (summary.tone === "unavailable") return { ...base, value: null, qualifier: null, state: "unavailable", note: "The inbox could not be read. This is not an all-clear.", tone: "normal" };
  const count = read.data?.items.length ?? 0;
  if (summary.tone === "unread") {
    return { ...base, value: count, qualifier: summary.complete ? null : "or more", state: summary.complete ? "ready" : "partial",
      note: summary.complete ? null : "The list may be incomplete; open Inbox for the full set.", tone: "alert" };
  }
  if (summary.tone === "none") return { ...base, value: 0, qualifier: null, state: "ready", note: null, tone: "normal" };
  return { ...base, value: null, qualifier: null, state: "partial", note: summary.label, tone: "normal" };
}

export type IntakeSummaryRead = { needsReview: number | null; received?: number | null; windowDays?: number | null };

export function intakeRow(read: Read<IntakeSummaryRead>): CockpitRow {
  const base = { key: "intake" as const, label: "Website requests needing assignment or review", href: COCKPIT_DESTINATIONS.intake, cta: "Open intake" };
  if (read.isLoading) return { ...base, value: null, qualifier: null, state: "loading", note: null, tone: "normal" };
  const value = read.data?.needsReview;
  if (read.isError || typeof value !== "number" || !Number.isFinite(value)) {
    return { ...base, value: null, qualifier: null, state: "unavailable", note: "Website request counts are unavailable. This is not an all-clear.", tone: "normal" };
  }
  return { ...base, value, qualifier: null, state: "ready", note: "Open now, any age.", tone: value > 0 ? "alert" : "normal" };
}

export type CockpitTask = { assignedTo?: string | null; canonicalAssignee?: string | null; status?: string | null };
const OPEN_TASK = (task: CockpitTask) => task.status === "pending" || task.status === "in_progress";

export function unassignedRow(read: Read<readonly CockpitTask[]>): CockpitRow {
  const base = { key: "unassigned" as const, label: "Unassigned open tasks", href: COCKPIT_DESTINATIONS.unassigned, cta: "Review unassigned" };
  if (read.isLoading) return { ...base, value: null, qualifier: null, state: "loading", note: null, tone: "normal" };
  if (read.isError || !read.data) return { ...base, value: null, qualifier: null, state: "unavailable", note: "Tasks could not be read. This is not an all-clear.", tone: "normal" };
  const open = read.data.filter(OPEN_TASK);
  const summary = summarizeUnassigned(open, () => false);
  return { ...base, value: summary.unassigned, qualifier: null, state: "ready",
    note: `Counted in the ${summary.loaded} open tasks you can see. Nothing is assigned automatically.`,
    tone: summary.unassigned > 0 ? "alert" : "normal" };
}

export type AppointmentRangeRead = {
  appointments?: Array<{ startTime?: string | number | null; status?: string | null }>;
  configured?: boolean;
  status?: string;
  completeness?: string;
};
const INACTIVE_APPOINTMENT = /^(cancel+ed|no_?show|invalid)$/i;

/** Active appointments starting in [from, from + days). The Today count and the Calendar window list both use this. */
export function appointmentsInWindow<T extends { startTime?: string | number | null; status?: string | null }>(
  appointments: readonly T[] | undefined, fromMs: number, days: number,
): T[] {
  const to = fromMs + days * 86_400_000;
  return (appointments ?? []).filter((appointment) => {
    if (INACTIVE_APPOINTMENT.test(String(appointment.status ?? ""))) return false;
    const start = typeof appointment.startTime === "number" ? appointment.startTime : Date.parse(String(appointment.startTime ?? ""));
    return Number.isFinite(start) && start >= fromMs && start < to;
  });
}

export function upcomingAppointmentCount(data: AppointmentRangeRead, now: Date, days: number): number {
  return appointmentsInWindow(data.appointments, now.getTime(), days).length;
}

/** "Nov 12, 3:00 PM – Nov 19, 3:00 PM ET": the exact window a count or list covers, in the business time zone. */
export function formatAppointmentWindow(fromMs: number, days: number): string {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${format.format(new Date(fromMs))} \u2013 ${format.format(new Date(fromMs + days * 86_400_000))} ET`;
}

export function appointmentRow(read: Read<AppointmentRangeRead>, now: Date, days = 7): CockpitRow {
  const base = { key: "appointments" as const, label: `Appointments in the next ${days} days`,
    href: buildAppointmentWindowHref(now.toISOString(), days), cta: "Open calendar" };
  if (read.isLoading) return { ...base, value: null, qualifier: null, state: "loading", note: null, tone: "normal" };
  if (read.isError || !read.data) return { ...base, value: null, qualifier: null, state: "unavailable", note: "Appointments could not be read. This is not an all-clear.", tone: "normal" };
  if (read.data.configured === false || read.data.status === "not_configured") {
    return { ...base, value: null, qualifier: null, state: "unavailable", note: "The sales calendar is not connected, so appointments cannot be counted.", tone: "normal" };
  }
  return { ...base, value: upcomingAppointmentCount(read.data, now, days), qualifier: null, state: "ready",
    note: `${formatAppointmentWindow(now.getTime(), days)}. Sales calendar, excluding cancelled and no-show appointments.`, tone: "normal" };
}

export function cockpitRowText(row: CockpitRow): string {
  if (row.state === "loading") return "Loading…";
  if (row.value === null) return "Unavailable";
  return row.qualifier ? `${row.value} ${row.qualifier}` : String(row.value);
}
