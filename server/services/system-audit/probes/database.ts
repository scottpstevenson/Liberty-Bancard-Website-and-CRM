import { db } from "../../../db";
import { sql } from "drizzle-orm";
import { ProbeResult } from "./ghl-sync";

export async function probeDatabase(): Promise<ProbeResult> {
  const startMs = Date.now();
  try {
    const [pingResult, tableStats] = await Promise.all([
      db.execute(sql`SELECT 1 AS ping`),
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM contacts) AS contacts,
          (SELECT COUNT(*) FROM deals) AS deals,
          (SELECT COUNT(*) FROM sequence_enrollments) AS enrollments,
          (SELECT COUNT(*) FROM audit_logs) AS audit_logs,
          (SELECT COUNT(*) FROM outbound_messages) AS outbound_messages
      `),
    ]);

    const pingMs = Date.now() - startMs;
    const stats = tableStats.rows[0] as any;

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `DB healthy (ping ${pingMs}ms). ${stats?.contacts ?? "?"} contacts, ${stats?.deals ?? "?"} deals`;

    if (pingMs > 2000) {
      status = "error";
      summary = `DB ping very slow: ${pingMs}ms — possible overload`;
    } else if (pingMs > 500) {
      status = "warn";
      summary = `DB ping elevated: ${pingMs}ms`;
    }

    return {
      subsystem: "database",
      status,
      summary,
      details: {
        pingMs,
        tableCounts: {
          contacts: Number(stats?.contacts ?? 0),
          deals: Number(stats?.deals ?? 0),
          enrollments: Number(stats?.enrollments ?? 0),
          auditLogs: Number(stats?.audit_logs ?? 0),
          outboundMessages: Number(stats?.outbound_messages ?? 0),
        },
      },
    };
  } catch (err: any) {
    return {
      subsystem: "database",
      status: "error",
      summary: `Database probe failed: ${err.message}`,
      details: { error: err.message, pingMs: Date.now() - startMs },
    };
  }
}
