/**
 * Production distribution script — registry-importer phone-tier confidence
 *
 * READ-ONLY: fetches a sample of historical registry_import_log rows and runs
 * them through the new phone-tier scorer in dry-run mode.  No merchant records
 * are mutated.
 *
 * Run: npx tsx scripts/test-registry-phone-distribution.ts
 *
 * Exits non-zero if the DB connection cannot be established.
 * Constants (REGISTRY_MATCH_THRESHOLD, REGISTRY_MATCH_MARGIN) should NOT be
 * treated as final until this report has been reviewed.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  scorePhoneCandidate,
  evaluatePhoneCandidates,
  REGISTRY_MATCH_THRESHOLD,
  REGISTRY_MATCH_MARGIN,
  REGISTRY_MATCH_ALGORITHM_VERSION,
  type RegistryPhoneCandidateScore,
} from "../server/services/sdr/registry-importer";
import { normalizeBusinessName, normalizePhoneE164 } from "../server/services/sdr/dedupe";

const SAMPLE_LIMIT = 500;

interface LogRow {
  id: number;
  import_id: string;
  source: string;
  state: string;
  status: string;
  raw_row: Record<string, string> | null;
  matched_merchant_id: number | null;
}

interface MerchantRow {
  id: number;
  business_name: string | null;
  legal_name: string | null;
  main_phone: string | null;
  state: string | null;
}

async function main() {
  console.log("Registry Importer — Phone-Tier Distribution Check");
  console.log("=".repeat(60));
  console.log(`Algorithm version : ${REGISTRY_MATCH_ALGORITHM_VERSION} (provisional)`);
  console.log(`THRESHOLD         : ${REGISTRY_MATCH_THRESHOLD}`);
  console.log(`MARGIN            : ${REGISTRY_MATCH_MARGIN}`);
  console.log(`Sample limit      : ${SAMPLE_LIMIT} rows`);
  console.log("");

  // Verify DB connectivity — exit non-zero if it fails
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    console.error("FATAL: Cannot connect to database:", err);
    process.exit(1);
  }

  // Fetch historical log rows where the raw_row jsonb object contains any of
  // the common phone key names.  We use the JSONB '?' operator (key existence)
  // to avoid regex escaping issues and to work efficiently with a jsonb column.
  let logRows: LogRow[] = [];
  try {
    const result = await db.execute<LogRow>(sql`
      SELECT id, import_id, source, state, status, raw_row, matched_merchant_id
      FROM registry_import_log
      WHERE status IN ('matched', 'unmatched')
        AND raw_row IS NOT NULL
        AND (
          raw_row ? 'Phone'
          OR raw_row ? 'phone'
          OR raw_row ? 'Phone Number'
          OR raw_row ? 'phone_number'
          OR raw_row ? 'PhoneNumber'
          OR raw_row ? 'PHONE'
        )
      ORDER BY id DESC
      LIMIT ${SAMPLE_LIMIT}
    `);
    logRows = result.rows;
  } catch (err) {
    console.error("Failed to fetch log rows:", err);
    process.exit(1);
  }

  console.log(`Fetched ${logRows.length} historical log rows with phone data.`);
  if (logRows.length === 0) {
    console.log("No rows to analyse. Exiting.");
    process.exit(0);
  }

  // For each log row, extract the phone field value and look up candidates
  let accepted = 0;
  let lowConfidence = 0;
  let ambiguous = 0;
  let noPhoneCandidates = 0;
  let priorPhoneMatchCount = 0; // rows with status='matched' that had phone in raw_row

  interface SampleCase {
    logId: number;
    registryName: string;
    candidateName: string;
    outcome: string;
    score: number;
    runnerUpScore: number | null;
    basis: string[];
    contradictions: string[];
  }

  const conflictSamples: SampleCase[] = [];
  const closeRunnerUpSamples: SampleCase[] = [];

  for (const row of logRows) {
    const rawRow = row.raw_row as Record<string, string> | null;
    if (!rawRow) continue;

    // Find the phone field — try common key names
    const phoneKeys = ["Phone", "phone", "Phone Number", "phone_number", "PhoneNumber", "PHONE"];
    let rawPhone = "";
    for (const key of phoneKeys) {
      if (rawRow[key]) { rawPhone = rawRow[key]; break; }
    }

    const normalizedPhone = normalizePhoneE164(rawPhone);
    if (!normalizedPhone) continue;

    // Find the business name
    const nameKeys = [
      "EntityName", "Business Name", "business_name", "ENTITY_NAME",
      "Entity Name", "Corporation Name", "Establishment Name",
    ];
    let rawName = "";
    for (const key of nameKeys) {
      if (rawRow[key]) { rawName = rawRow[key]; break; }
    }
    const registryName = normalizeBusinessName(rawName);
    const registryState = (rawRow["State"] || rawRow["state"] || rawRow["PRINCIPAL_STATE"] || row.state || "").toUpperCase();

    if (row.status === "matched") priorPhoneMatchCount++;

    // Look up all merchants with this phone (dry-run — no writes)
    let candidates: MerchantRow[] = [];
    try {
      const res = await db.execute<MerchantRow>(sql`
        SELECT id, business_name, legal_name, main_phone, state
        FROM sdr_merchants
        WHERE main_phone = ${normalizedPhone}
      `);
      candidates = res.rows;
    } catch {
      continue;
    }

    if (candidates.length === 0) {
      noPhoneCandidates++;
      continue;
    }

    const scored: RegistryPhoneCandidateScore[] = candidates.map((c) =>
      scorePhoneCandidate(registryName, registryState, {
        id: c.id,
        businessName: c.business_name,
        legalName: c.legal_name,
        state: c.state,
      })
    );

    const evaluation = evaluatePhoneCandidates(scored);

    if (evaluation.outcome === "accepted") {
      accepted++;
    } else if (evaluation.outcome === "ambiguous") {
      ambiguous++;
    } else if (evaluation.outcome === "low_confidence") {
      lowConfidence++;
    }

    const best = evaluation.outcome !== "fallthrough" ? (evaluation as any).best as RegistryPhoneCandidateScore : null;
    const runnerUp = evaluation.outcome !== "fallthrough" ? (evaluation as any).runnerUp as RegistryPhoneCandidateScore | null : null;

    if (!best) continue;

    const caseData: SampleCase = {
      logId: row.id,
      registryName,
      candidateName: candidates.find((c) => c.id === best.merchantId)?.business_name ?? "(unknown)",
      outcome: evaluation.outcome,
      score: best.score,
      runnerUpScore: runnerUp?.score ?? null,
      basis: best.basis,
      contradictions: best.contradictions,
    };

    if (best.contradictions.includes("name_conflict") && conflictSamples.length < 5) {
      conflictSamples.push(caseData);
    }

    if (
      runnerUp &&
      runnerUp.score > 0 &&
      best.score - runnerUp.score < REGISTRY_MATCH_MARGIN &&
      closeRunnerUpSamples.length < 5
    ) {
      closeRunnerUpSamples.push(caseData);
    }
  }

  const rowsWithCandidates = logRows.length - noPhoneCandidates;
  const priorBlockedCount = priorPhoneMatchCount - accepted;
  const blockedPct = priorPhoneMatchCount > 0
    ? ((priorBlockedCount / priorPhoneMatchCount) * 100).toFixed(1)
    : "N/A";

  console.log("\nResults");
  console.log("-".repeat(60));
  console.log(`Total rows analysed       : ${logRows.length}`);
  console.log(`Rows with phone candidates: ${rowsWithCandidates}`);
  console.log(`  Accepted                : ${accepted}`);
  console.log(`  Low-confidence          : ${lowConfidence}`);
  console.log(`  Ambiguous               : ${ambiguous}`);
  console.log(`Prior phone-matched rows  : ${priorPhoneMatchCount}`);
  console.log(`Now blocked (not accepted): ${priorBlockedCount} (${blockedPct}% of prior phone matches)`);

  if (conflictSamples.length > 0) {
    console.log("\nSample conflicting-name cases (up to 5):");
    for (const s of conflictSamples) {
      console.log(`  log#${s.logId} registry="${s.registryName}" candidate="${s.candidateName}" score=${s.score} basis=[${s.basis.join(",")}]`);
    }
  }

  if (closeRunnerUpSamples.length > 0) {
    console.log("\nSample close runner-up cases (up to 5):");
    for (const s of closeRunnerUpSamples) {
      console.log(`  log#${s.logId} registry="${s.registryName}" best=${s.score} runnerUp=${s.runnerUpScore} outcome=${s.outcome}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("NOTE: Constants are PROVISIONAL. Review these results before");
  console.log("treating REGISTRY_MATCH_THRESHOLD and REGISTRY_MATCH_MARGIN as final.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
