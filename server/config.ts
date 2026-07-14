/**
 * server/config.ts
 * Centralised server-side configuration constants.
 *
 * "America/New_York" was previously duplicated as a string literal in
 * digest-service.ts (lines 37, 43, 131, 464), helpers.ts, and activation.ts.
 * Centralised here to prevent further drift.
 */

/** Canonical application timezone for all server-side date formatting and window calculations. */
export const APP_TIMEZONE = "America/New_York";

/**
 * Minimum data-readiness score (0–100) a prospect must reach before it can be
 * converted to a contact.  Default 40.  Parsed once at startup; invalid values
 * throw immediately so a mis-configured deploy fails fast.
 */
function parseIntRange(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`[Config] ${name} must be an integer ${min}–${max}; got: ${raw}`);
  }
  return n;
}

export const prospectConversionMinReadiness: number = parseIntRange(
  process.env.PROSPECT_CONVERSION_MIN_READINESS,
  "PROSPECT_CONVERSION_MIN_READINESS",
  0,
  100,
  40,
);

/**
 * Find the UTC instant that corresponds to local midnight (00:00:00) on the
 * given local calendar date in `timezone`.
 *
 * Algorithm: scan UTC hour candidates h ∈ [-14, 14] (plus :30 and :45 minute
 * sub-offsets for non-whole-hour zones like India +5:30 and Nepal +5:45).
 * For each candidate, format it back with Intl.DateTimeFormat.formatToParts
 * and check whether it resolves to 00:00:00 on the correct local date.
 *
 * This is DST-safe because it resolves the offset specifically at the target
 * local midnight — not at "now". At most 28 × 3 = 84 Intl calls; for ET
 * (UTC-4/UTC-5) it terminates in ≤ 2 iterations.
 *
 * @throws if no candidate maps to local midnight (should never happen for a
 *         valid IANA timezone/date combination).
 */
function localMidnightUTC(year: number, month0: number, day: number, timezone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  for (let h = -14; h <= 14; h++) {
    for (const extraMin of [0, 30, 45]) {
      const candidateMs = Date.UTC(year, month0, day, h, extraMin, 0, 0);
      const candidate = new Date(candidateMs);

      const p: Record<string, string> = {};
      for (const part of fmt.formatToParts(candidate)) {
        if (part.type !== "literal") p[part.type] = part.value;
      }

      // hour12:false returns "24" for midnight on some ICU builds — normalise to 0.
      const h24 = parseInt(p.hour ?? "1") % 24;

      if (
        h24 === 0 &&
        parseInt(p.minute ?? "1") === 0 &&
        parseInt(p.second ?? "1") === 0 &&
        parseInt(p.year ?? "0") === year &&
        parseInt(p.month ?? "0") === month0 + 1 &&
        parseInt(p.day ?? "0") === day
      ) {
        return candidate;
      }
    }
  }

  throw new Error(
    `getTzDayBoundaries: cannot resolve local midnight for ` +
    `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `in ${timezone}`,
  );
}

/**
 * Compute the UTC start and end of the current calendar day in `timezone`.
 *
 * Both boundaries are resolved independently via `localMidnightUTC`, which
 * scans UTC candidates and verifies using Intl.DateTimeFormat.formatToParts.
 * This means each boundary uses the offset that actually applies at that
 * specific midnight — not the offset at "now".
 *
 * DST behaviour:
 *   - Normal day:        windowEnd − windowStart = 24 h exactly
 *   - Spring-forward:   windowEnd − windowStart = 23 h  (e.g. 2026-03-08 ET)
 *   - Fall-back:        windowEnd − windowStart = 25 h  (e.g. 2026-11-01 ET)
 *
 * The end boundary is NOT `start + 24 h`; it is the start of the next local
 * calendar date, which correctly handles DST transition days.
 *
 * @param timezone IANA timezone name (e.g. "America/New_York")
 * @returns { windowStart, windowEnd } as real UTC Date objects
 */
export function getTzDayBoundaries(timezone: string): { windowStart: Date; windowEnd: Date } {
  const now = new Date();

  // Step 1: resolve today's local date components in the target timezone.
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const todayP: Record<string, number> = {};
  for (const part of dateFmt.formatToParts(now)) {
    if (part.type !== "literal") todayP[part.type] = parseInt(part.value);
  }

  const year = todayP.year;
  const month0 = todayP.month - 1; // 0-indexed for Date.UTC
  const day = todayP.day;

  // Step 2: resolve UTC instant for today's local midnight.
  const windowStart = localMidnightUTC(year, month0, day, timezone);

  // Step 3: find tomorrow's local date by stepping well past today's midnight
  // (+25 h guarantees we land in "tomorrow" local time even on fall-back days
  //  where a 24 h step could land in the same calendar date).
  const tomorrowApprox = new Date(windowStart.getTime() + 25 * 3_600_000);

  const tmrP: Record<string, number> = {};
  for (const part of dateFmt.formatToParts(tomorrowApprox)) {
    if (part.type !== "literal") tmrP[part.type] = parseInt(part.value);
  }

  // Step 4: resolve UTC instant for tomorrow's local midnight independently.
  const windowEnd = localMidnightUTC(tmrP.year, tmrP.month - 1, tmrP.day, timezone);

  return { windowStart, windowEnd };
}
