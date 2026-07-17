import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeContactability(): Promise<ProbeResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE contactability_status = 'blocked') AS blocked,
        COUNT(*) FILTER (WHERE contactability_status = 'limited') AS limited,
        COUNT(*) FILTER (WHERE contactability_status = 'reachable') AS reachable,
        COUNT(*) FILTER (WHERE contactability_status IS NULL) AS unchecked
      FROM contacts
    `);

    const stats = rows.rows[0] as any;
    const total = Number(stats?.total ?? 0);
    const blocked = Number(stats?.blocked ?? 0);
    const limited = Number(stats?.limited ?? 0);
    const reachable = Number(stats?.reachable ?? 0);
    const unchecked = Number(stats?.unchecked ?? 0);

    if (total === 0) {
      return {
        subsystem: "contactability",
        status: "ok",
        summary: "No contacts in database",
        details: { total: 0 },
      };
    }

    const blockedPct = Math.round((blocked / total) * 100);
    const reachablePct = Math.round((reachable / total) * 100);

    let status: ProbeResult["status"] = "ok";
    let summary = `${reachablePct}% reachable, ${blockedPct}% blocked out of ${total} contacts`;

    if (blockedPct >= 50) {
      status = "error";
      summary = `CRITICAL: ${blockedPct}% of contacts are blocked (${blocked}/${total}) — outreach severely limited`;
    } else if (blockedPct >= 20) {
      status = "warn";
      summary = `${blockedPct}% of contacts blocked (${blocked}/${total}) — review contactability rules`;
    }

    return {
      subsystem: "contactability",
      status,
      summary,
      details: {
        total,
        blocked,
        limited,
        reachable,
        unchecked,
        blockedPct,
        reachablePct,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "contactability",
      status: "error",
      summary: `Contactability probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
