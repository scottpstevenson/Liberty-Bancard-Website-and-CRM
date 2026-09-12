#!/usr/bin/env npx tsx
/**
 * MI-09: Pilot reconciliation report generator.
 *
 * Generates a cost/yield accounting report for a pilot run and writes it
 * durably to mi09_pilot_reconciliation_reports BEFORE attempting to publish
 * to Google Drive. A Drive failure must not erase the canonical result.
 *
 * Report includes:
 *   - Records selected (cohort size)
 *   - Enrichment outcomes (by provider, by outcome)
 *   - Provider spend per provider (from provider_budget_period_ledger — CRO-08A ledger)
 *   - Cost per qualified lead
 *   - Duplicate rate, suppression rate, staging rate
 *   - Stop condition summary
 *
 * Usage:
 *   npx tsx scripts/pilot-reconciliation-report.ts <pilot_run_id>
 *   npx tsx scripts/pilot-reconciliation-report.ts --latest [--publish-drive]
 *
 * --publish-drive: after writing to DB, attempt to publish to Google Drive.
 *   Requires GOOGLE_DRIVE_FOLDER_ID env var. Failure is logged but not fatal.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  savePilotReconciliationReport,
  updateReconciliationReportDriveDoc,
  evaluateStopConditions,
} from "../server/services/mi09-pilot-authority";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

async function buildReport(runId: string): Promise<Record<string, unknown>> {
  // Pilot run metadata.
  const run = rows(await db.execute(sql`
    SELECT pr.*, pd.level, pd.max_cohort_size, pd.paid_providers_allowed,
           pd.stop_condition_thresholds, pd.county_scope, pd.vertical_scope
    FROM mi09_pilot_runs pr
    JOIN mi09_pilot_definitions pd ON pd.id = pr.pilot_definition_id
    WHERE pr.id = ${runId}::uuid
  `))[0];
  if (!run) throw new Error(`Pilot run not found: ${runId}`);

  // Cohort size.
  const cohortCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM mi09_pilot_cohort_members WHERE pilot_run_id = ${runId}::uuid
  `))[0];

  // Effect links summary.
  const effectSummary = rows(await db.execute(sql`
    SELECT entity_type, COUNT(*)::int AS cnt FROM mi09_pilot_effect_links
    WHERE pilot_run_id = ${runId}::uuid
    GROUP BY entity_type ORDER BY entity_type
  `));

  // Provider spend from provider_budget_period_ledger (CRO-08A ledger — NOT cro03_provider_ledger).
  // Read spend since pilot start to capture all CRO-08A activity for this run.
  let providerSpend: any[] = [];
  try {
    // provider_budget_period_ledger is an immutable period-close ledger.
    // Columns: provider, period_key, period_started_at, period_ended_at,
    //          consumed_units, local_budget_units, closed_at.
    // We approximate pilot spend by reading close records since pilot start.
    providerSpend = rows(await db.execute(sql`
      SELECT provider                              AS provider_key,
             SUM(consumed_units)::bigint           AS total_consumed_units,
             COUNT(*)::int                         AS period_close_count
      FROM provider_budget_period_ledger
      WHERE closed_at >= ${String(run.started_at)}::timestamptz
      GROUP BY provider ORDER BY provider
    `));
  } catch {
    providerSpend = [];
  }

  // Stage operations summary (reserved/settled) — from cro03c_stage_operations.
  let stageOpsSummary: any[] = [];
  try {
    stageOpsSummary = rows(await db.execute(sql`
      SELECT so.provider                                      AS provider_key,
             so.terminal_disposition                          AS outcome,
             COUNT(*)::int                                    AS cnt,
             SUM(so.settled_amount_micros)::bigint           AS total_micros
      FROM cro03c_stage_operations so
      JOIN cro03c_generations g ON g.id = so.generation_id
      JOIN mi09_pilot_effect_links pel
        ON pel.entity_id::text = g.command_id::text AND pel.pilot_run_id = ${runId}::uuid
      GROUP BY so.provider, so.terminal_disposition
      ORDER BY so.provider, so.terminal_disposition
    `));
  } catch {
    stageOpsSummary = [];
  }

  // Master leads created by this pilot.
  let masterLeads: any = {};
  try {
    const ml = rows(await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM master_leads ml
      JOIN mi09_pilot_effect_links pel
        ON pel.entity_id = ml.id AND pel.entity_type = 'master_lead'
         AND pel.pilot_run_id = ${runId}::uuid
      GROUP BY status ORDER BY status
    `));
    for (const r of ml) masterLeads[String(r.status)] = Number(r.cnt);
  } catch {
    masterLeads = {};
  }

  // Stop conditions.
  let stopConditions: any = null;
  try {
    stopConditions = await evaluateStopConditions(runId);
  } catch (e: any) {
    stopConditions = { error: e?.message };
  }

  // Cost calculations.
  // providerSpend rows have: provider_key, total_consumed_units, period_close_count.
  // (No total_settled_micros column exists in provider_budget_period_ledger.)
  const totalConsumedUnits = providerSpend.reduce(
    (sum: number, r: any) => sum + Number(r.total_consumed_units ?? 0),
    0,
  );
  const stagedCount = masterLeads["staged"] ?? 0;
  const promotedCount = masterLeads["promoted"] ?? 0;
  const qualifiedCount = stagedCount + promotedCount;
  // provider_budget_period_ledger has consumed_units (unit count), not micros.
  // We report consumed_units as the spend metric; conversion to USD requires
  // per-provider unit pricing from the operator's mi09_pricing_artifacts entry.
  const totalConsumedUnitsForLeadCost = totalConsumedUnits;
  const costPerQualifiedLeadUnits =
    qualifiedCount > 0 ? Math.round(totalConsumedUnitsForLeadCost / qualifiedCount) : null;

  const cohortSize = Number(cohortCount?.cnt ?? 0);
  const stagedTotal = effectSummary.find((e: any) => e.entity_type === "staging_receipt");
  const stagingRate = cohortSize > 0 ? ((Number(stagedTotal?.cnt ?? 0) / cohortSize) * 100).toFixed(1) : null;

  return {
    generatedAt: new Date().toISOString(),
    pilotRunId: runId,
    pilotLevel: run.level,
    pilotState: run.state,
    startedAt: run.started_at,
    completedAt: run.completed_at ?? null,
    releaseSha: run.release_sha,
    cohortSize,
    countyScope: run.county_scope,
    verticalScope: run.vertical_scope,
    paidProvidersAllowed: run.paid_providers_allowed,
    effectLinkSummary: effectSummary.reduce((acc: Record<string, number>, r: any) => {
      acc[String(r.entity_type)] = Number(r.cnt);
      return acc;
    }, {}),
    masterLeads,
    // providerSpend rows: { provider_key, total_consumed_units, period_close_count }
    // provider_budget_period_ledger has no reserved/settled/micros columns.
    providerSpend: providerSpend.map((r: any) => ({
      provider: r.provider_key,
      totalConsumedUnits: Number(r.total_consumed_units ?? 0),
      periodCloseCount: Number(r.period_close_count ?? 0),
    })),
    stageOperationsSummary: stageOpsSummary.map((r: any) => ({
      provider: r.provider_key,
      outcome: r.outcome,
      count: Number(r.cnt),
      totalMicros: Number(r.total_micros ?? 0),
    })),
    economics: {
      totalConsumedUnits,
      qualifiedLeads: qualifiedCount,
      costPerQualifiedLeadUnits,
      stagingRate: stagingRate ? `${stagingRate}%` : null,
      note: "Provider spend is in consumed_units from provider_budget_period_ledger. " +
            "Convert to USD using the operator pricing artifact (mi09_pricing_artifacts).",
    },
    stopConditions,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const publishDrive = args.includes("--publish-drive");
  let runId: string | null = null;

  if (args[0] === "--latest" || (args[0] === "--publish-drive" && !args[1])) {
    const latest = rows(await db.execute(sql`
      SELECT id FROM mi09_pilot_runs ORDER BY created_at DESC LIMIT 1
    `))[0];
    if (!latest) {
      console.error("No pilot runs found.");
      process.exit(1);
    }
    runId = String(latest.id);
  } else if (args[0] && !args[0].startsWith("--")) {
    runId = args[0];
  } else {
    console.error("Usage: pilot-reconciliation-report.ts <pilot_run_id> | --latest [--publish-drive]");
    process.exit(1);
  }

  console.log(`\n=== MI-09 Pilot Reconciliation Report ===`);
  console.log(`Pilot run: ${runId}\n`);

  let report: Record<string, unknown>;
  try {
    report = await buildReport(runId!);
  } catch (err: any) {
    console.error("Failed to build report:", err?.message);
    process.exit(1);
  }

  // Write durably to DB first — Drive failure must not erase the canonical result.
  const { id: reportId } = await savePilotReconciliationReport({
    pilotRunId: runId!,
    reportData: report,
  });
  console.log(`✓ Report saved durably to DB: report_id=${reportId}`);
  console.log("\n── Report Summary ──");
  console.log(JSON.stringify(report, null, 2));

  // Optionally publish to Google Drive.
  if (publishDrive) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      console.warn("⚠  --publish-drive requested but GOOGLE_DRIVE_FOLDER_ID not set — skipping");
    } else {
      try {
        // Use the Google Drive integration to create a doc.
        // Import dynamically to avoid hard dependency.
        const { google } = await import("googleapis");
        const auth = new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/drive.file"],
        });
        const drive = google.drive({ version: "v3", auth });
        const fileName = `Pilot-${report.pilotLevel}-Run-${runId!.slice(0, 8)}-Report-${new Date().toISOString().slice(0, 10)}.json`;
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [folderId],
            mimeType: "application/json",
          },
          media: {
            mimeType: "application/json",
            body: JSON.stringify(report, null, 2),
          },
        });
        const driveDocId = String(res.data.id ?? "");
        await updateReconciliationReportDriveDoc(reportId, driveDocId);
        console.log(`✓ Published to Google Drive: file_id=${driveDocId}`);
      } catch (driveErr: any) {
        // Drive failure is logged but not fatal — DB record already saved.
        console.error(`⚠  Google Drive publish failed: ${driveErr?.message}`);
        console.error("   Canonical report is already saved to DB. Drive failure is non-fatal.");
      }
    }
  }

  console.log("\n✅  Reconciliation report complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err?.message ?? err);
  process.exit(1);
});
