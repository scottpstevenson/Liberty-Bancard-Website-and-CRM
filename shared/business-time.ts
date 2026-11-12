/**
 * One business time zone for every CRM task/Today presentation and every
 * "today" request. Browser zones differ per user and per device; a due time or
 * an overdue label must read the same on desktop, mobile and in the briefing.
 *
 * Window math stays in `crmDayWindow` (shared/crm-time-window.ts); this module
 * only names the zone and formats instants in it. No fallback to the browser
 * zone and no silent UTC.
 */
export const BUSINESS_TIMEZONE = "America/New_York";

export type BusinessInstant = Date | string | number | null | undefined;

function toDate(value: BusinessInstant): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** "EST" / "EDT" for the instant (never the browser abbreviation). */
export function businessZoneAbbreviation(at: BusinessInstant = new Date()): string {
  const date = toDate(at) ?? new Date();
  const part = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, timeZoneName: "short" })
    .formatToParts(date).find(p => p.type === "timeZoneName");
  return part?.value ?? "ET";
}

/** Sentence for footnotes: states the single zone every time on the page uses. */
export function businessZoneNote(at: BusinessInstant = new Date()): string {
  return `Times use ${BUSINESS_TIMEZONE.replace("_", " ")} business time (${businessZoneAbbreviation(at)}), not your device zone.`;
}

/** Due-date style label in the business zone; invalid input is reported, not blanked. */
export function formatBusinessDateTime(value: BusinessInstant, options: { invalid?: string; empty?: string } = {}): string {
  const date = toDate(value);
  if (!date) return value === null || value === undefined || value === "" ? (options.empty ?? "") : (options.invalid ?? "Invalid date");
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE, dateStyle: "medium", timeStyle: "short",
  }).format(date)} ${businessZoneAbbreviation(date)}`;
}

/** Civil business day (YYYY-MM-DD) containing the instant. */
export function businessDayKey(value: BusinessInstant): string | null {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function isSameBusinessDay(a: BusinessInstant, b: BusinessInstant): boolean {
  const left = businessDayKey(a), right = businessDayKey(b);
  return left !== null && left === right;
}

/** Due today in business time (not a browser-local calendar day). */
export function isDueBusinessToday(due: BusinessInstant, now: Date = new Date()): boolean {
  return isSameBusinessDay(due, now);
}

/** Query-string value every Today/briefing request sends; the server validates it. */
export const BUSINESS_TIMEZONE_QUERY = `timezone=${encodeURIComponent(BUSINESS_TIMEZONE)}`;

const wallFormatter = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function wallParts(date: Date) {
  return Object.fromEntries(wallFormatter().formatToParts(date)
    .filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)])) as
    Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** `YYYY-MM-DDTHH:mm` (datetime-local value) of the instant, read in the business zone. */
export function instantToBusinessInput(value: BusinessInstant): string {
  const date = toDate(value);
  if (!date) return "";
  const p = wallParts(date), pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Instant for a `datetime-local` value typed as business-zone wall time. Returns
 * null for malformed input; a wall time skipped by DST moves forward, an
 * ambiguous one resolves to the first occurrence.
 */
export function businessInputToInstant(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  if (!Number.isFinite(target)) return null;
  let result = target;
  for (let i = 0; i < 6; i++) {
    const o = wallParts(new Date(result));
    const represented = Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second);
    const correction = target - represented;
    if (!correction) return new Date(result);
    result += correction;
  }
  return new Date(result);
}
