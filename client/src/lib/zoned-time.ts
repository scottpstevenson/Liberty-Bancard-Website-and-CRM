/**
 * Convert a wall-clock `YYYY-MM-DDTHH:mm` in an IANA zone to UTC without a library.
 *
 * Every plausible UTC offset around the requested instant is tried and a candidate is accepted only if formatting it back
 * in the zone reproduces EXACTLY the requested wall time. So:
 *   - a wall time that does not exist (spring-forward gap) is rejected, never silently moved to another time;
 *   - a wall time that happens twice (fall-back repeat) is ambiguous: the caller must choose "first" or "second"
 *     (earlier / later instant). With no choice it is rejected as ambiguous, never guessed.
 */
export type ZonedResolution =
  | { ok: true; ms: number; offsetMinutes: number; ambiguous: boolean }
  | { ok: false; reason: "invalid_format" | "invalid_date" | "invalid_zone" | "nonexistent_local_time" | "ambiguous_local_time" };

const pad = (n: number) => String(n).padStart(2, "0");

export function resolveZonedWallTime(local: string, zone: string, occurrence?: "first" | "second"): ZonedResolution {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return { ok: false, reason: "invalid_format" };
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const rt = new Date(asUtc);
  if (rt.getUTCFullYear() !== y || rt.getUTCMonth() !== mo - 1 || rt.getUTCDate() !== d || rt.getUTCHours() !== h || rt.getUTCMinutes() !== mi) {
    return { ok: false, reason: "invalid_date" };
  }
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return { ok: false, reason: "invalid_zone" }; }
  const wall = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
    return { text: `${String(g("year")).padStart(4, "0")}-${pad(g("month"))}-${pad(g("day"))}T${pad(g("hour"))}:${pad(g("minute"))}`,
      asUtc: Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) };
  };
  const offsetAt = (ms: number) => wall(ms).asUtc - Math.floor(ms / 1000) * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const offsets = Array.from(new Set([offsetAt(asUtc - DAY), offsetAt(asUtc), offsetAt(asUtc + DAY)]));
  const candidates = Array.from(new Set(offsets.map(o => asUtc - o))).filter(utc => wall(utc).text === local).sort((a, b) => a - b);
  if (candidates.length === 0) return { ok: false, reason: "nonexistent_local_time" };
  if (candidates.length > 1 && !occurrence) return { ok: false, reason: "ambiguous_local_time" };
  const ms = candidates.length > 1 && occurrence === "second" ? candidates[candidates.length - 1] : candidates[0];
  return { ok: true, ms, offsetMinutes: Math.round((asUtc - ms) / 60000), ambiguous: candidates.length > 1 };
}

/** Compatibility wrapper: NaN for anything that is not an unambiguous, existing wall time. */
export function zonedWallTimeToUtcMs(local: string, zone: string, occurrence?: "first" | "second"): number {
  const r = resolveZonedWallTime(local, zone, occurrence);
  return r.ok ? r.ms : NaN;
}

export const ZONED_REASON_COPY: Record<string, string> = {
  invalid_format: "Enter a valid date and time.",
  invalid_date: "That date does not exist.",
  invalid_zone: "That time zone is not recognized.",
  nonexistent_local_time: "That local time does not exist in this time zone (clocks skip forward). Choose a different time.",
  ambiguous_local_time: "That local time happens twice in this time zone (clocks fall back). Choose which one.",
};
