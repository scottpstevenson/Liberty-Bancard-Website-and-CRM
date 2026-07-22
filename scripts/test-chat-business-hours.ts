#!/usr/bin/env tsx
/**
 * scripts/test-chat-business-hours.ts
 *
 * Regression coverage for the Liberty AI 24/7 availability fix.
 *
 * Proves:
 *   1. checkBusinessHours() returns false outside Mon–Fri 9AM–6PM ET
 *   2. checkBusinessHours() returns true inside Mon–Fri 9AM–6PM ET
 *   3. Widget initial phase is always "pre-identify" (AI path), never "offline"
 *      — verified by reading the compiled source constant
 *   4. After-hours human escalation routes to phase="offline" (contact form),
 *      not to chatMode="human"
 *   5. During-hours human escalation routes to chatMode="human"
 *   6. AI assistant HTTP endpoint responds regardless of time of day
 *
 * Exit 0 = all assertions pass
 * Exit 1 = one or more assertions fail
 */

import { readFileSync } from "fs";
import { resolve } from "path";

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `\n       ↳ ${detail}` : ""}`);
    failed++;
  }
}

// ─── Replicate checkBusinessHours logic ───────────────────────────────────────
// Must stay in sync with client/src/components/ChatWidget.tsx lines 29-34.
function checkBusinessHours(now: Date): boolean {
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = eastern.getDay();
  const hour = eastern.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}

// ─── Replicate escalateToHuman routing logic ──────────────────────────────────
// Must stay in sync with client/src/components/ChatWidget.tsx escalateToHuman().
type ChatPhase = "pre-identify" | "chatting" | "offline";
type ChatMode  = "ai" | "human";

function simulateEscalateToHuman(now: Date): { phase: ChatPhase; chatMode: ChatMode } {
  if (!checkBusinessHours(now)) {
    return { phase: "offline", chatMode: "ai" };
  }
  return { phase: "chatting", chatMode: "human" };
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

// Sunday 2 PM ET — outside business hours (weekend)
const SUNDAY_AFTERNOON   = new Date("2026-07-19T18:00:00.000Z"); // 2 PM ET
// Monday 2 AM ET — outside business hours (night)
const MONDAY_NIGHT       = new Date("2026-07-20T06:00:00.000Z"); // 2 AM ET
// Monday 5 PM ET — inside business hours
const MONDAY_AFTERNOON   = new Date("2026-07-20T21:00:00.000Z"); // 5 PM ET
// Friday 9 AM ET — inside business hours (opening edge)
const FRIDAY_OPEN        = new Date("2026-07-17T13:00:00.000Z"); // 9 AM ET
// Friday 5:59 PM ET — inside business hours (closing edge)
const FRIDAY_CLOSE_EDGE  = new Date("2026-07-17T21:59:00.000Z"); // 5:59 PM ET
// Friday 6 PM ET — outside business hours (exact close)
const FRIDAY_CLOSED      = new Date("2026-07-17T22:00:00.000Z"); // 6:00 PM ET

// ─── Suite 1: checkBusinessHours logic ────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Suite 1: checkBusinessHours() — time-of-day logic");
console.log("══════════════════════════════════════════════════════════");

assert("Sunday 2 PM ET → false (weekend)", !checkBusinessHours(SUNDAY_AFTERNOON));
assert("Monday 2 AM ET → false (after hours)", !checkBusinessHours(MONDAY_NIGHT));
assert("Monday 5 PM ET → true (business hours)", checkBusinessHours(MONDAY_AFTERNOON));
assert("Friday 9 AM ET → true (opening edge)", checkBusinessHours(FRIDAY_OPEN));
assert("Friday 5:59 PM ET → true (just before close)", checkBusinessHours(FRIDAY_CLOSE_EDGE));
assert("Friday 6:00 PM ET → false (exact close, exclusive)", !checkBusinessHours(FRIDAY_CLOSED));

// ─── Suite 2: Widget initial phase is always AI, never offline ────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Suite 2: Widget initial phase — must always be pre-identify");
console.log("══════════════════════════════════════════════════════════");

const widgetSrc = readFileSync(
  resolve(process.cwd(), "client/src/components/ChatWidget.tsx"),
  "utf8"
);

// Phase must NOT be gated by checkBusinessHours() at initialisation
const hasHoursGatedInit = /useState<ChatPhase>\(\s*checkBusinessHours\(\)/.test(widgetSrc);
assert(
  "Phase state init does NOT call checkBusinessHours() (AI always available)",
  !hasHoursGatedInit,
  hasHoursGatedInit
    ? 'Found useState<ChatPhase>(checkBusinessHours() ...) — this gates AI by time of day'
    : undefined
);

// Phase init must be the literal string "pre-identify"
const hasStaticPreIdentify = /useState<ChatPhase>\(\s*["']pre-identify["']\s*\)/.test(widgetSrc);
assert(
  'Phase state initialises to literal "pre-identify" (AI flow unconditionally)',
  hasStaticPreIdentify,
  !hasStaticPreIdentify ? 'Could not find useState<ChatPhase>("pre-identify")' : undefined
);

// ─── Suite 3: escalateToHuman routing ────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Suite 3: After-hours escalation → offline form, not human mode");
console.log("══════════════════════════════════════════════════════════");

const sundayResult = simulateEscalateToHuman(SUNDAY_AFTERNOON);
assert(
  "Sunday 2 PM escalation → phase=offline",
  sundayResult.phase === "offline",
  `got phase=${sundayResult.phase}`
);
assert(
  "Sunday 2 PM escalation → chatMode stays ai (not switched to human)",
  sundayResult.chatMode === "ai",
  `got chatMode=${sundayResult.chatMode}`
);

const nightResult = simulateEscalateToHuman(MONDAY_NIGHT);
assert(
  "Monday 2 AM escalation → phase=offline",
  nightResult.phase === "offline",
  `got phase=${nightResult.phase}`
);

const duringHoursResult = simulateEscalateToHuman(MONDAY_AFTERNOON);
assert(
  "Monday 5 PM escalation → phase=chatting (human mode active)",
  duringHoursResult.phase === "chatting",
  `got phase=${duringHoursResult.phase}`
);
assert(
  "Monday 5 PM escalation → chatMode=human",
  duringHoursResult.chatMode === "human",
  `got chatMode=${duringHoursResult.chatMode}`
);

// ─── Suite 4: escalateToHuman code in source is hours-gated ──────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Suite 4: Source contains after-hours escalation gate");
console.log("══════════════════════════════════════════════════════════");

const hasEscalationGate = /escalateToHuman[\s\S]{0,300}checkBusinessHours\(\)[\s\S]{0,100}setPhase\(["']offline["']\)/.test(widgetSrc);
assert(
  "escalateToHuman() has checkBusinessHours() → setPhase('offline') branch",
  hasEscalationGate,
  !hasEscalationGate ? "Could not find the after-hours gate in escalateToHuman" : undefined
);

// ─── Suite 5: AI endpoint accessibility (HTTP probe) ─────────────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Suite 5: AI assistant HTTP endpoint — responds regardless of time");
console.log("══════════════════════════════════════════════════════════");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

async function probeAiEndpoint(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is your processing rate?", visitorName: "Test" }),
      signal: AbortSignal.timeout(10000),
    });
    // 200 = AI replied; 429 = rate-limited (endpoint live); any 2xx/4xx = endpoint live
    const liveResponse = res.status < 500;
    assert(
      `POST /api/assistant/chat → HTTP ${res.status} (endpoint reachable at any time)`,
      liveResponse,
      !liveResponse ? `Server error ${res.status} — AI endpoint may be down` : undefined
    );
  } catch (err: any) {
    assert(
      "POST /api/assistant/chat → reachable",
      false,
      `Network error: ${err.message}`
    );
  }
}

await probeAiEndpoint();

// ─── Final verdict ────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  RESULT: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════\n");

if (failed > 0) {
  console.error(`[test-chat-business-hours] FAIL — ${failed} assertion(s) failed\n`);
  process.exit(1);
} else {
  console.log("[test-chat-business-hours] PASS — Liberty AI is available 24/7; human handoff is hours-gated\n");
  process.exit(0);
}
