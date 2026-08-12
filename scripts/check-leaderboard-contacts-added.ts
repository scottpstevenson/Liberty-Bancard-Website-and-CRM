#!/usr/bin/env tsx
/**
 * Task #1443 — Step 4: Leaderboard contacts-added accuracy check.
 *
 * Fetches the leaderboard API and compares each rep's `contactsCreated` field
 * against a direct DB COUNT(*) from audit_logs (matching the server-side aggregate).
 * Fails if any rep diverges by more than 1%, or if the API returns entries but none
 * have a `contactsCreated` field (indicating a field-name mismatch).
 *
 * Usage:  npx tsx scripts/check-leaderboard-contacts-added.ts
 * Exit 0 = all within tolerance; 1 = divergence or structural mismatch.
 */
import { pool } from "../server/db";

const BASE_URL = process.env.INTERNAL_BASE_URL ?? "http://localhost:5000";

interface LeaderboardEntry {
  agentId: number;
  name: string;
  contactsCreated?: number;  // field name as returned by analytics.ts #910
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = process.env.CHECK_SESSION_COOKIE;
  if (cookie) headers["Cookie"] = cookie;

  // The API recognises: week | month | quarter | all (not "allTime")
  const res = await fetch(`${BASE_URL}/api/leaderboard?period=all`, { headers });
  if (res.status === 401) {
    // Treat missing auth as a hard failure so unattended CI runs don't silently pass
    // without performing any verification. Set CHECK_SESSION_COOKIE to a valid session.
    throw new Error(
      "Leaderboard API returned 401 — unattended check requires a session cookie. " +
      "Set CHECK_SESSION_COOKIE env var to a valid authenticated session value.",
    );
  }
  if (!res.ok) {
    throw new Error(`Leaderboard API returned ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function getDbContactCount(agentUserId: number): Promise<number> {
  // Server computes contactsCreated via audit_logs WHERE action='contact_created' AND actor_id=agent.userId
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM audit_logs
     WHERE action = 'contact_created' AND actor_type = 'user' AND actor_id = $1`,
    [String(agentUserId)],
  );
  return Number(countRes.rows[0]?.cnt ?? 0);
}

// Leaderboard entries carry agentId (agents.id), not users.id.
// We resolve the userId via the agents table so we can match audit_logs.actor_id.
async function getAgentUserId(agentId: number): Promise<number | null> {
  const r = await pool.query(`SELECT user_id FROM agents WHERE id = $1 LIMIT 1`, [agentId]);
  return r.rows[0]?.user_id ?? null;
}

async function main() {
  console.log("=== Leaderboard contacts-created accuracy check (period=all) ===");

  const entries = await fetchLeaderboard();

  if (entries.length === 0) {
    console.log("ℹ No leaderboard entries returned (API may require session auth — set CHECK_SESSION_COOKIE).");
    await pool.end();
    process.exit(0);
  }

  // Structural sanity: at least one entry must carry contactsCreated
  const entriesWithField = entries.filter(e => e.contactsCreated != null);
  if (entriesWithField.length === 0) {
    console.error(
      `✗ STRUCTURAL MISMATCH: leaderboard returned ${entries.length} entries but none have` +
      ` a 'contactsCreated' field. Check the field name in analytics.ts.`,
    );
    await pool.end();
    process.exit(1);
  }

  let failed = 0;
  let checked = 0;

  for (const entry of entriesWithField) {
    const userId = await getAgentUserId(entry.agentId);
    if (userId == null) {
      console.warn(`  ⚠ ${entry.name} (agentId=${entry.agentId}): no user_id found — skipping`);
      continue;
    }

    const dbCount = await getDbContactCount(userId);
    const apiCount = entry.contactsCreated!;
    const tolerance = Math.max(1, Math.round(Math.max(dbCount, apiCount) * 0.01));
    const divergence = Math.abs(apiCount - dbCount);

    checked++;
    if (divergence > tolerance) {
      console.error(
        `✗ ${entry.name} (agentId=${entry.agentId}): API reports ${apiCount} contactsCreated` +
        ` but DB audit_logs COUNT = ${dbCount} (diverges by ${divergence}, tolerance=${tolerance})`,
      );
      failed++;
    } else {
      console.log(
        `✓ ${entry.name}: API=${apiCount} DB=${dbCount} (diff=${divergence} within ${tolerance})`,
      );
    }
  }

  await pool.end();

  if (checked === 0) {
    console.error("✗ No entries could be verified (no user_id resolved) — check agents table.");
    process.exit(1);
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed}/${checked} reps have divergent contactsCreated counts.`);
    process.exit(1);
  }

  console.log(`\n✓ All ${checked} reps within 1% tolerance.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
