import { bookingForPurpose, type CalendarPurpose } from "./ghl-calendar-purpose";

/**
 * Selected-range appointment reads for the month calendar (Stage 4C2). Unlike the bounded `/api/appointments` queue, this
 * reader asks the provider for the exact requested window and calendar purpose, and the response states its source,
 * window (exclusive end) and completeness. A provider failure is "unavailable", never an authoritative empty calendar.
 * The provider contract documents range and calendar parameters only: no pagination or provider-side limit is assumed.
 */
export const MAX_RANGE_DAYS = 62;

export type RangeRequest =
  | { ok: true; startMs: number; endMs: number; purpose: CalendarPurpose; calendarId: string }
  | { ok: false; status: 400 | 409; error: string };

export function buildRangeRequest(query: { start?: unknown; end?: unknown; purpose?: unknown }, env: Record<string, string | undefined> = process.env): RangeRequest {
  const startMs = typeof query.start === "string" ? Date.parse(query.start) : NaN;
  const endMs = typeof query.end === "string" ? Date.parse(query.end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { ok: false, status: 400, error: "start and end must be ISO timestamps" };
  if (endMs <= startMs) return { ok: false, status: 400, error: "end is exclusive and must be after start" };
  if (endMs - startMs > MAX_RANGE_DAYS * 86_400_000) return { ok: false, status: 400, error: `range cannot exceed ${MAX_RANGE_DAYS} days` };
  const purpose: CalendarPurpose = query.purpose === "account" ? "account" : query.purpose === undefined || query.purpose === "sales" ? "sales" : ("invalid" as never);
  if (purpose !== "sales" && purpose !== "account") return { ok: false, status: 400, error: "purpose must be sales or account" };
  const booking = bookingForPurpose(purpose, env);
  if (!booking.available) return { ok: false, status: 409, error: `${purpose}_calendar_unavailable:${booking.reason}` };
  return { ok: true, startMs, endMs, purpose, calendarId: booking.calendarId };
}

export function providerRangePath(locationId: string, req: { startMs: number; endMs: number; calendarId: string }): string {
  return `/calendars/events?locationId=${encodeURIComponent(locationId)}&startTime=${req.startMs}&endTime=${req.endMs}&calendarId=${encodeURIComponent(req.calendarId)}`;
}

const toMs = (value: unknown): number => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;

/** Events whose start falls in [start, endExclusive). Cancelled events are kept out of the active calendar. */
export function eventsInRange<T extends Record<string, any>>(events: ReadonlyArray<T>, startMs: number, endMs: number): T[] {
  return events.filter(e => {
    if (e.status === "cancelled" || e.status === "canceled") return false;
    const start = toMs(e.startTime ?? e.start?.dateTime ?? e.startDate);
    return Number.isFinite(start) && start >= startMs && start < endMs;
  });
}
