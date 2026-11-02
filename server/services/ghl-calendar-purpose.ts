/**
 * Calendar purpose resolver (Stage 4C2). A calendar belongs to exactly one purpose:
 *  - "account": the account-management calendar (AM_CALENDAR_URL widget address);
 *  - "sales": the validated sales booking (resolveSalesBooking) plus the configured appointment/vertical calendars.
 * The sales webhook stream only moves the sales pipeline; an appointment on the account calendar is recorded as history
 * and never advances or rolls back a sales lead stage. Nothing here falls back to "the first calendar GHL returns".
 */
import { resolveSalesBooking, BOOKING_WIDGET_HOST, type SalesBookingResolution } from "./message-cta-contract";

export type CalendarPurpose = "sales" | "account";
type Env = Readonly<Record<string, string | undefined>>;

export type AccountBookingResolution =
  | { available: true; calendarId: string; widgetUrl: string }
  | { available: false; reason: "not_configured" | "invalid_configuration" };

export function resolveAccountBooking(env: Env = process.env): AccountBookingResolution {
  const raw = env.AM_CALENDAR_URL?.trim();
  if (!raw) return { available: false, reason: "not_configured" };
  let url: URL;
  try { url = new URL(raw); } catch { return { available: false, reason: "invalid_configuration" }; }
  const match = /^\/widget\/booking\/([A-Za-z0-9]{16,32})\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.host !== BOOKING_WIDGET_HOST || !match) return { available: false, reason: "invalid_configuration" };
  return { available: true, calendarId: match[1], widgetUrl: `https://${BOOKING_WIDGET_HOST}/widget/booking/${match[1]}` };
}

export function resolveSalesCalendar(env: Env = process.env): SalesBookingResolution {
  return resolveSalesBooking(env);
}

/** Purpose of a provider calendar id. An id that is not the account calendar belongs to the sales stream. */
export function calendarPurposeOf(calendarId: string | null | undefined, env: Env = process.env): CalendarPurpose {
  const account = resolveAccountBooking(env);
  return account.available && calendarId && calendarId === account.calendarId ? "account" : "sales";
}

/** Booking widget for one purpose, or an explicit unavailable state. Never a default or first-calendar fallback. */
export function bookingForPurpose(purpose: CalendarPurpose, env: Env = process.env):
  | { available: true; calendarId: string; widgetUrl: string; purpose: CalendarPurpose }
  | { available: false; purpose: CalendarPurpose; reason: string } {
  if (purpose === "account") {
    const account = resolveAccountBooking(env);
    return account.available ? { ...account, purpose } : { available: false, purpose, reason: account.reason };
  }
  const sales = resolveSalesCalendar(env);
  return sales.available
    ? { available: true, calendarId: sales.calendarId, widgetUrl: sales.widgetUrl, purpose }
    : { available: false, purpose, reason: sales.reason };
}
