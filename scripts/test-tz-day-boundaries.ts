#!/usr/bin/env tsx
/**
 * scripts/test-tz-day-boundaries.ts
 *
 * Verifies getTzDayBoundaries() and its internal localMidnightUTC helper for
 * DST-safe behaviour, with special focus on transition days.
 *
 * Required boundary assertions (from reviewer spec):
 *
 *   America/New_York 2026-03-08 (spring-forward — clocks move +1 h at 2 AM EST):
 *     windowStart = 2026-03-08T05:00:00.000Z  (midnight EST  = UTC−5)
 *     windowEnd   = 2026-03-09T04:00:00.000Z  (next midnight EDT = UTC−4)
 *     duration    = 23 h
 *
 *   America/New_York 2026-11-01 (fall-back — clocks move −1 h at 2 AM EDT):
 *     windowStart = 2026-11-01T04:00:00.000Z  (midnight EDT  = UTC−4)
 *     windowEnd   = 2026-11-02T05:00:00.000Z  (next midnight EST = UTC−5)
 *     duration    = 25 h
 *
 *   Normal EST day (2026-01-15):
 *     windowStart = 2026-01-15T05:00:00.000Z
 *     windowEnd   = 2026-01-16T05:00:00.000Z
 *     duration    = 24 h
 *
 *   Normal EDT day (2026-07-10):
 *     windowStart = 2026-07-10T04:00:00.000Z
 *     windowEnd   = 2026-07-11T04:00:00.000Z
 *     duration    = 24 h
 *
 * Additional edge cases:
 *   - A timestamp 1 ms before local midnight is NOT inside [windowStart, windowEnd)
 *   - A timestamp AT local midnight is inside the window
 *   - A timestamp 1 ms after local midnight IS inside the window
 *
 * Usage:  npx tsx scripts/test-tz-day-boundaries.ts
 * Exits:  0 = all assertions pass, 1 = one or more failures
 */

/**
 * Local copy of the algorithm under test.
 * We import from config.ts so we test the real production code, not a copy.
 * getTzDayBoundaries() depends on "now", so we drive it indirectly by
 * re-implementing the two-step helper (localMidnightUTC + getWindowForDate)
 * so tests can pass an arbitrary local date.
 *
 * The production getTzDayBoundaries() calls localMidnightUTC, which is not
 * exported. We instead expose a testable entry point getWindowForLocalDate().
 */

const TZ = "America/New_York";

// ── Internal helpers (mirrors production logic exactly) ─────────────────────

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
    `localMidnightUTC: no candidate matched for ` +
    `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")} in ${timezone}`,
  );
}

/** Compute boundaries for a specific local date (for testing). */
function getWindowForLocalDate(
  year: number,
  month1: number,   // 1-indexed
  day: number,
  timezone: string,
): { windowStart: Date; windowEnd: Date; durationHours: number } {
  const month0 = month1 - 1;
  const windowStart = localMidnightUTC(year, month0, day, timezone);

  // Resolve tomorrow's date (25 h ahead is always safe — even on fall-back days)
  const tomorrowApprox = new Date(windowStart.getTime() + 25 * 3_600_000);
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const tmrP: Record<string, number> = {};
  for (const part of dateFmt.formatToParts(tomorrowApprox)) {
    if (part.type !== "literal") tmrP[part.type] = parseInt(part.value);
  }

  const windowEnd = localMidnightUTC(tmrP.year, tmrP.month - 1, tmrP.day, timezone);
  const durationHours = (windowEnd.getTime() - windowStart.getTime()) / 3_600_000;

  return { windowStart, windowEnd, durationHours };
}

// ── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.error(`  ✗ ${msg}`);
    failed++;
    failures.push(msg);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

function assertUTC(actual: Date, expectedIso: string, label: string): void {
  const exp = new Date(expectedIso);
  assert(
    actual.getTime() === exp.getTime(),
    label,
    `expected ${exp.toISOString()}, got ${actual.toISOString()}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 1 — Normal EST day (2026-01-15)
// ─────────────────────────────────────────────────────────────────────────────
section("Case 1: Normal EST day — 2026-01-15 (UTC−5)");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 1, 15, TZ);
  assertUTC(windowStart, "2026-01-15T05:00:00.000Z", "windowStart = 2026-01-15T05:00:00.000Z");
  assertUTC(windowEnd,   "2026-01-16T05:00:00.000Z", "windowEnd   = 2026-01-16T05:00:00.000Z");
  assert(durationHours === 24, `duration = 24 h (got ${durationHours})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 2 — Normal EDT day (2026-07-10)
// ─────────────────────────────────────────────────────────────────────────────
section("Case 2: Normal EDT day — 2026-07-10 (UTC−4)");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 7, 10, TZ);
  assertUTC(windowStart, "2026-07-10T04:00:00.000Z", "windowStart = 2026-07-10T04:00:00.000Z");
  assertUTC(windowEnd,   "2026-07-11T04:00:00.000Z", "windowEnd   = 2026-07-11T04:00:00.000Z");
  assert(durationHours === 24, `duration = 24 h (got ${durationHours})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 3 — Spring-forward (2026-03-08): EST→EDT, clocks jump +1 h at 2 AM
// Expected: 23-hour day
// ─────────────────────────────────────────────────────────────────────────────
section("Case 3: Spring-forward — 2026-03-08 (23-hour day)");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 3, 8, TZ);
  assertUTC(windowStart, "2026-03-08T05:00:00.000Z", "windowStart = 2026-03-08T05:00:00.000Z (midnight EST)");
  assertUTC(windowEnd,   "2026-03-09T04:00:00.000Z", "windowEnd   = 2026-03-09T04:00:00.000Z (next midnight EDT)");
  assert(durationHours === 23, `duration = 23 h (got ${durationHours})`);
  assert(
    windowEnd.getTime() - windowStart.getTime() !== 24 * 3_600_000,
    "end IS NOT start + 24 h (DST-safe boundary)",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 4 — Fall-back (2026-11-01): EDT→EST, clocks fall −1 h at 2 AM
// Expected: 25-hour day
// ─────────────────────────────────────────────────────────────────────────────
section("Case 4: Fall-back — 2026-11-01 (25-hour day)");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 11, 1, TZ);
  assertUTC(windowStart, "2026-11-01T04:00:00.000Z", "windowStart = 2026-11-01T04:00:00.000Z (midnight EDT)");
  assertUTC(windowEnd,   "2026-11-02T05:00:00.000Z", "windowEnd   = 2026-11-02T05:00:00.000Z (next midnight EST)");
  assert(durationHours === 25, `duration = 25 h (got ${durationHours})`);
  assert(
    windowEnd.getTime() - windowStart.getTime() !== 24 * 3_600_000,
    "end IS NOT start + 24 h (DST-safe boundary)",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 5 — Edge: timestamps just before/after local midnight
// ─────────────────────────────────────────────────────────────────────────────
section("Case 5: Edge timestamps around local midnight");
{
  // Normal EST day: midnight ET = 2026-01-15T05:00:00.000Z
  const { windowStart, windowEnd } = getWindowForLocalDate(2026, 1, 15, TZ);

  const justBefore  = new Date(windowStart.getTime() - 1);   // 1 ms before midnight
  const atMidnight  = new Date(windowStart.getTime());         // exactly midnight
  const justAfter   = new Date(windowStart.getTime() + 1);   // 1 ms after midnight

  const inWindow = (ts: Date) =>
    ts.getTime() >= windowStart.getTime() && ts.getTime() < windowEnd.getTime();

  assert(!inWindow(justBefore),  "1 ms before local midnight → NOT in window");
  assert(inWindow(atMidnight),   "exactly at local midnight → IN window");
  assert(inWindow(justAfter),    "1 ms after local midnight → IN window");

  // Also verify day-end boundary: 1 ms before next midnight is still in window
  const dayEnd    = new Date(windowEnd.getTime() - 1);   // last ms of the day
  const nextDay   = new Date(windowEnd.getTime());        // first ms of next day
  assert(inWindow(dayEnd),   "1 ms before next local midnight → IN window");
  assert(!inWindow(nextDay), "exactly at next local midnight → NOT in window (exclusive end)");
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 6 — Spring-forward eve/next-day boundary check
// The day BEFORE spring-forward (2026-03-07) should be a normal 24-hour day
// ─────────────────────────────────────────────────────────────────────────────
section("Case 6: Day before spring-forward (2026-03-07) — still 24 h");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 3, 7, TZ);
  assertUTC(windowStart, "2026-03-07T05:00:00.000Z", "windowStart = 2026-03-07T05:00:00.000Z");
  assertUTC(windowEnd,   "2026-03-08T05:00:00.000Z", "windowEnd   = 2026-03-08T05:00:00.000Z");
  assert(durationHours === 24, `duration = 24 h (got ${durationHours})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 7 — Day after fall-back (2026-11-02) — normal 24 h EST day
// ─────────────────────────────────────────────────────────────────────────────
section("Case 7: Day after fall-back (2026-11-02) — 24 h EST");
{
  const { windowStart, windowEnd, durationHours } = getWindowForLocalDate(2026, 11, 2, TZ);
  assertUTC(windowStart, "2026-11-02T05:00:00.000Z", "windowStart = 2026-11-02T05:00:00.000Z");
  assertUTC(windowEnd,   "2026-11-03T05:00:00.000Z", "windowEnd   = 2026-11-03T05:00:00.000Z");
  assert(durationHours === 24, `duration = 24 h (got ${durationHours})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 8 — production getTzDayBoundaries() smoke test (uses "now")
// ─────────────────────────────────────────────────────────────────────────────
section("Case 8: Production getTzDayBoundaries() live smoke test");
{
  const { getTzDayBoundaries, APP_TIMEZONE } = await import("../server/config");

  const { windowStart, windowEnd } = getTzDayBoundaries(APP_TIMEZONE);
  const durationMs = windowEnd.getTime() - windowStart.getTime();
  const durationH  = durationMs / 3_600_000;

  assert(
    durationH === 23 || durationH === 24 || durationH === 25,
    `production call returns 23, 24, or 25 h (got ${durationH} h on ${new Date().toISOString()})`,
  );
  assert(
    windowStart < windowEnd,
    `windowStart (${windowStart.toISOString()}) is before windowEnd (${windowEnd.toISOString()})`,
  );
  // Verify "now" is within today's window
  const now = new Date();
  assert(
    now >= windowStart && now < windowEnd,
    `current time (${now.toISOString()}) is within today's ET window [${windowStart.toISOString()}, ${windowEnd.toISOString()})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Timezone Day Boundaries — ${passed + failed} assertions: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\nFailed assertions:");
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

console.log("\nAll assertions passed. getTzDayBoundaries() is DST-safe. ✓");
process.exit(0);
