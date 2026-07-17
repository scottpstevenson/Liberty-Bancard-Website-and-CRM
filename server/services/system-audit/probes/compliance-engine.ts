import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

const FORBIDDEN_PHRASES = [
  "guaranteed approval",
  "100% approval",
  "no credit check",
  "instant approval",
  "zero risk",
  "risk-free",
  "you've been selected",
  "congratulations you",
  "click here to unsubscribe",
  "this is not spam",
];

export async function probeComplianceEngine(): Promise<ProbeResult> {
  try {
    const steps = await db.execute(sql`
      SELECT ss.id, ss.sequence_id, ss.subject, ss.body, fus.name AS sequence_name
      FROM sequence_steps ss
      JOIN follow_up_sequences fus ON fus.id = ss.sequence_id
      WHERE fus.status = 'active'
        AND ss.body IS NOT NULL
      LIMIT 200
    `);

    const stepRows = steps.rows as Array<{
      id: number;
      sequence_id: number;
      subject: string | null;
      body: string | null;
      sequence_name: string;
    }>;

    const violations: Array<{ sequenceName: string; stepId: number; phrase: string }> = [];

    for (const step of stepRows) {
      const content = `${step.subject ?? ""} ${step.body ?? ""}`.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        if (content.includes(phrase.toLowerCase())) {
          violations.push({
            sequenceName: step.sequence_name,
            stepId: step.id,
            phrase,
          });
        }
      }
    }

    const templateCount = stepRows.length;
    const violationCount = violations.length;

    let status: ProbeResult["status"] = "ok";
    let summary = `Compliance scan: ${templateCount} active sequence steps checked, ${violationCount} violations found`;

    if (violationCount > 0) {
      status = violationCount > 5 ? "error" : "warn";
      const preview = violations.slice(0, 3).map(v => `"${v.phrase}" in "${v.sequenceName}"`).join("; ");
      summary = `${violationCount} compliance violation(s) in active sequences: ${preview}`;
    }

    return {
      subsystem: "compliance-engine",
      status,
      summary,
      details: {
        stepsScanned: templateCount,
        violationCount,
        violations: violations.slice(0, 10),
        phrasesChecked: FORBIDDEN_PHRASES.length,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "compliance-engine",
      status: "error",
      summary: `Compliance probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
