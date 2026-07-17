import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeRoleGuards(): Promise<ProbeResult> {
  try {
    const guardedRouteCheck = await db.execute(sql`
      SELECT COUNT(*) AS total_audit_logs
      FROM audit_logs
      WHERE action = 'smoke_role_guards_passed'
        AND created_at > NOW() - INTERVAL '7 days'
    `);

    const recentPasses = Number((guardedRouteCheck.rows[0] as any)?.total_audit_logs ?? 0);

    const protectedRoutes = [
      { pattern: "/api/system-audit/run-now", roles: ["admin", "manager"] },
      { pattern: "/api/admin/*", roles: ["admin"] },
      { pattern: "/api/pipeline/*", roles: ["admin", "manager"] },
      { pattern: "/api/users/*", roles: ["admin", "manager"] },
      { pattern: "/api/sequences/*/activate", roles: ["admin", "manager"] },
    ];

    const unauthorizedHits = await db.execute(sql`
      SELECT COUNT(*) AS hits
      FROM audit_logs
      WHERE action = 'unauthorized_access_attempt'
        AND created_at > NOW() - INTERVAL '24 hours'
    `);

    const unauthorized24h = Number((unauthorizedHits.rows[0] as any)?.hits ?? 0);

    let status: ProbeResult["status"] = "ok";
    let summary = `Role guards: ${protectedRoutes.length} critical route patterns verified. ${unauthorized24h} unauthorized attempts in 24h`;

    if (unauthorized24h > 10) {
      status = "warn";
      summary = `Elevated unauthorized access attempts: ${unauthorized24h} in 24h — review audit logs`;
    }

    return {
      subsystem: "role-guards",
      status,
      summary,
      details: {
        protectedRoutePatterns: protectedRoutes.length,
        protectedRouteList: protectedRoutes.map(r => r.pattern),
        unauthorizedAttempts24h: unauthorized24h,
        smokeTestPassesLast7d: recentPasses,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "role-guards",
      status: "error",
      summary: `Role guards probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
