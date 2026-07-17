import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

const REQUIRED_LB_FIELDS = [
  "lb_lead_score",
  "lb_lead_grade",
  "lb_contactability_status",
  "lb_contact_source",
  "lb_location_of",
];

export async function probeGhlFields(): Promise<ProbeResult> {
  try {
    const ghlEnabled = !!(
      process.env.GHL_LOCATION_ID && process.env.GHL_PRIVATE_INTEGRATION_TOKEN
    );

    if (!ghlEnabled) {
      return {
        subsystem: "ghl-fields",
        status: "warn",
        summary: "GHL not configured — field sync check skipped",
        details: { ghlEnabled: false },
      };
    }

    const successLogs = await db.execute(sql`
      SELECT details, created_at
      FROM audit_logs
      WHERE action = 'ghl_custom_field_created'
         OR action = 'ghl_contact_synced'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const hasRecentSync = successLogs.rows.length > 0;

    const lastSyncedCustomField = await db.execute(sql`
      SELECT COUNT(*) AS total
      FROM audit_logs
      WHERE action LIKE 'ghl_sync_%'
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    const syncActivity = Number((lastSyncedCustomField.rows[0] as any)?.total ?? 0);

    const missingFields: string[] = [];

    for (const fieldKey of REQUIRED_LB_FIELDS) {
      const fieldActivity = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM audit_logs
        WHERE (details::text LIKE ${"%" + fieldKey + "%"})
          AND created_at > NOW() - INTERVAL '30 days'
      `);
      const cnt = Number((fieldActivity.rows[0] as any)?.cnt ?? 0);
      if (cnt === 0) {
        missingFields.push(fieldKey);
      }
    }

    let status: ProbeResult["status"] = "ok";
    let summary = `GHL lb_* field sync active. ${syncActivity} sync events in 7d`;

    if (missingFields.length >= REQUIRED_LB_FIELDS.length) {
      status = "warn";
      summary = `No evidence of lb_* field writes in 30d — fields may not be created in GHL yet`;
    } else if (missingFields.length > 0) {
      status = "warn";
      summary = `${missingFields.length} lb_* fields may not be syncing: ${missingFields.join(", ")}`;
    }

    return {
      subsystem: "ghl-fields",
      status,
      summary,
      details: {
        requiredFields: REQUIRED_LB_FIELDS,
        missingOrInactive: missingFields,
        syncActivityLast7d: syncActivity,
        hasRecentSync,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "ghl-fields",
      status: "error",
      summary: `GHL fields probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
