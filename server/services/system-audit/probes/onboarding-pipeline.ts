import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeOnboardingPipeline(): Promise<ProbeResult> {
  try {
    const [closedWonRows, onboardingRows, recentKickoffs] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days') AS recent
        FROM deals
        WHERE stage = 'Closed Won'
      `),
      db.execute(sql`
        SELECT COUNT(*) AS total
        FROM deals
        WHERE pipeline = 'onboarding'
           OR lead_source = 'closed_won'
      `),
      db.execute(sql`
        SELECT COUNT(*) AS kickoffs_7d
        FROM audit_logs
        WHERE action = 'onboarding_deal_created'
          AND created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const closedWon = closedWonRows.rows[0] as any;
    const onboarding = onboardingRows.rows[0] as any;
    const kickoffs = recentKickoffs.rows[0] as any;

    const totalClosedWon = Number(closedWon?.total ?? 0);
    const recentClosedWon = Number(closedWon?.recent ?? 0);
    const totalOnboarding = Number(onboarding?.total ?? 0);
    const kickoffs7d = Number(kickoffs?.kickoffs_7d ?? 0);

    const orphanedEstimate = Math.max(0, totalClosedWon - totalOnboarding);

    let status: ProbeResult["status"] = "ok";
    let summary = `${totalClosedWon} Closed Won deals, ${totalOnboarding} onboarding deals. ${kickoffs7d} onboarding kickoffs this week`;

    if (orphanedEstimate > 5) {
      status = "warn";
      summary = `Possible orphaned Closed Won deals: ${orphanedEstimate} deals without an onboarding pipeline counterpart`;
    }

    if (recentClosedWon > 0 && kickoffs7d === 0) {
      status = "warn";
      summary = `${recentClosedWon} recent Closed Won deals but 0 onboarding kickoffs in 7d — auto-kickoff may be broken`;
    }

    return {
      subsystem: "onboarding-pipeline",
      status,
      summary,
      details: {
        totalClosedWon,
        recentClosedWon30d: recentClosedWon,
        totalOnboardingDeals: totalOnboarding,
        kickoffs7d,
        estimatedOrphaned: orphanedEstimate,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "onboarding-pipeline",
      status: "error",
      summary: `Onboarding pipeline probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
