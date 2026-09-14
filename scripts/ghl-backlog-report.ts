/**
 * scripts/ghl-backlog-report.ts
 *
 * Task #1955 — read-only GHL sync error backlog classification.
 *
 * Reads audit_logs rows for action IN ('ghl_sync_failed', 'ghl_sync_error')
 * and classifies them for operator triage. NEVER calls the GHL API, never
 * touches outbound_pause_control / global_paused, never mutates any row —
 * purely a SELECT-based report.
 *
 * Buckets:
 *   pause_blocked   — error text matches the pause-authority skip message
 *                     ("blocked by pause authority"). These are NOT real
 *                     GHL failures; they are the expected, correct behavior
 *                     while global_paused is active in this environment
 *                     (see .agents/memory/outbound-pause-authority.md).
 *   circuit_open    — error text matches the GHL circuit-breaker open state.
 *   retryable_other — recognized transient patterns (timeout, ECONNRESET,
 *                     429, 5xx) not covered by the two buckets above.
 *   terminal_other  — everything else (validation errors, 4xx, unknown
 *                     contact, etc.) — needs case-by-case triage.
 *
 * Also reports:
 *   - overlap with contacts.record_class IN ('test','demo','synthetic')
 *     (these are not part of any real backlog and can usually be excluded
 *     from operator attention entirely)
 *   - age buckets (last 24h / 7d / 30d / older)
 *
 * Usage:
 *   npx tsx scripts/ghl-backlog-report.ts             # human-readable
 *   npx tsx scripts/ghl-backlog-report.ts --json       # machine-readable
 *   npx tsx scripts/ghl-backlog-report.ts --since=2026-08-01
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const JSON_OUT = process.argv.includes("--json");
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1];
const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

function classify(errorText: string): "pause_blocked" | "circuit_open" | "retryable_other" | "terminal_other" {
  const t = errorText.toLowerCase();
  if (t.includes("blocked by pause authority") || t.includes("global_paused")) return "pause_blocked";
  if (t.includes("circuit") && (t.includes("open") || t.includes("breaker"))) return "circuit_open";
  if (
    t.includes("timeout") ||
    t.includes("econnreset") ||
    t.includes("etimedout") ||
    t.includes("429") ||
    t.includes("rate limit") ||
    /\b5\d\d\b/.test(t)
  ) {
    return "retryable_other";
  }
  return "terminal_other";
}

async function main() {
  const rows = await db.execute(sql`
    SELECT
      al.id,
      al.action,
      al.entity_type,
      al.entity_id,
      al.details,
      al.created_at,
      c.record_class AS contact_record_class
    FROM audit_logs al
    LEFT JOIN contacts c
      ON al.entity_type = 'contact' AND c.id = al.entity_id
    WHERE al.action IN ('ghl_sync_failed', 'ghl_sync_error')
      AND al.created_at >= ${since.toISOString()}
  `);

  const now = Date.now();
  const buckets: Record<string, number> = {
    pause_blocked: 0,
    circuit_open: 0,
    retryable_other: 0,
    terminal_other: 0,
  };
  const nonProdOverlap = { pause_blocked: 0, circuit_open: 0, retryable_other: 0, terminal_other: 0 };
  const age = { last24h: 0, last7d: 0, last30d: 0, older: 0 };
  const terminalSamples = new Map<string, number>();

  for (const r of rows.rows as any[]) {
    const errorText = typeof r.details === "object" && r.details?.error ? String(r.details.error) : JSON.stringify(r.details ?? {});
    const bucket = classify(errorText);
    buckets[bucket]++;

    const isNonProd = r.contact_record_class && r.contact_record_class !== "production";
    if (isNonProd) nonProdOverlap[bucket]++;

    const ageMs = now - new Date(r.created_at).getTime();
    const day = 24 * 60 * 60 * 1000;
    if (ageMs <= day) age.last24h++;
    else if (ageMs <= 7 * day) age.last7d++;
    else if (ageMs <= 30 * day) age.last30d++;
    else age.older++;

    if (bucket === "terminal_other") {
      const key = errorText.slice(0, 120);
      terminalSamples.set(key, (terminalSamples.get(key) ?? 0) + 1);
    }
  }

  const total = rows.rows.length;
  const topTerminal = [...terminalSamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([error, count]) => ({ error, count }));

  const report = {
    since: since.toISOString(),
    total,
    buckets,
    nonProdOverlap,
    age,
    note:
      "pause_blocked entries are expected behavior while global_paused is active in this environment " +
      "(see outbound-pause-authority memory) — they are not a real backlog needing GHL-side remediation.",
    topTerminalErrorSamples: topTerminal,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n[ghl-backlog-report] ${total} rows since ${report.since}`);
    console.log(`  pause_blocked:    ${buckets.pause_blocked} (expected — not a real backlog; ${nonProdOverlap.pause_blocked} on non-production contacts)`);
    console.log(`  circuit_open:     ${buckets.circuit_open} (${nonProdOverlap.circuit_open} on non-production contacts)`);
    console.log(`  retryable_other:  ${buckets.retryable_other} (${nonProdOverlap.retryable_other} on non-production contacts)`);
    console.log(`  terminal_other:   ${buckets.terminal_other} (${nonProdOverlap.terminal_other} on non-production contacts) — needs case-by-case triage`);
    console.log(`  age: last24h=${age.last24h} last7d=${age.last7d} last30d=${age.last30d} older=${age.older}`);
    console.log(`\n  Top terminal_other error samples:`);
    for (const s of topTerminal) console.log(`    (${s.count}x) ${s.error}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[ghl-backlog-report] FAILED:", err);
  process.exit(1);
});
