/**
 * #1408 — AI Memory Service
 *
 * Central write paths for:
 *   - Entity facts (upsert per entity_type + entity_id + fact_key)
 *   - AI decision log entries
 *   - Human corrections
 *
 * Consumers import these functions and call them at the point of each AI decision.
 * The service is deliberately fire-and-forget friendly — all functions are async
 * and callers can await or fire without blocking the main path.
 */

import { db } from "../db";
import {
  entityMemory, aiDecisionLog, aiCorrections, goldenExamples, promptVersions,
  type InsertAiDecisionLog, type InsertAiCorrection,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Entity Memory ────────────────────────────────────────────────────────────

/**
 * Upsert a single fact about an entity.
 * On conflict (same entity_type + entity_id + fact_key), updates the value,
 * source, confidence, version, and last_updated_at.
 */
export async function upsertEntityFact(params: {
  entityType: "contact" | "deal" | "merchant";
  entityId: number;
  factKey: string;
  factValue: unknown;
  source?: "ai" | "human" | "system";
  confidence?: number | null;
  sourceEventId?: number | null;
}): Promise<void> {
  const { entityType, entityId, factKey, factValue, source = "system", confidence = null, sourceEventId = null } = params;
  try {
    await db.execute(sql`
      INSERT INTO entity_memory
        (entity_type, entity_id, fact_key, fact_value, source, confidence, source_event_id, version, last_updated_at, created_at)
      VALUES
        (${entityType}, ${entityId}, ${factKey}, ${JSON.stringify(factValue)}::jsonb,
         ${source}, ${confidence}, ${sourceEventId}, 1, NOW(), NOW())
      ON CONFLICT (entity_type, entity_id, fact_key) DO UPDATE SET
        fact_value     = EXCLUDED.fact_value,
        source         = EXCLUDED.source,
        confidence     = EXCLUDED.confidence,
        source_event_id = EXCLUDED.source_event_id,
        version        = entity_memory.version + 1,
        last_updated_at = NOW()
    `);
  } catch (err) {
    console.error(`[AIMemory] upsertEntityFact error (${entityType}#${entityId} ${factKey}):`, err);
  }
}

/**
 * Retrieve all facts for an entity.
 */
export async function getEntityFacts(entityType: string, entityId: number) {
  return db
    .select()
    .from(entityMemory)
    .where(and(eq(entityMemory.entityType, entityType), eq(entityMemory.entityId, entityId)));
}

// ─── AI Decision Log ──────────────────────────────────────────────────────────

type ConfidenceTier = "high" | "medium" | "low";

function classifyConfidenceTier(confidence: number | null | undefined): ConfidenceTier | null {
  if (confidence == null) return null;
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}

/**
 * Record an AI decision. Returns the inserted row id, which callers can use
 * to later mark the decision as overridden or attach it to a correction.
 */
export async function recordAiDecision(params: Omit<InsertAiDecisionLog, "confidenceTier">): Promise<number | null> {
  try {
    const confidenceTier = classifyConfidenceTier(params.confidence ?? null);
    const [row] = await db
      .insert(aiDecisionLog)
      .values({ ...params, confidenceTier: confidenceTier ?? undefined })
      .returning({ id: aiDecisionLog.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[AIMemory] recordAiDecision error:", err);
    return null;
  }
}

/**
 * Mark a previously-recorded decision as overridden.
 */
export async function markDecisionOverridden(decisionLogId: number, reason?: string): Promise<void> {
  try {
    await db
      .update(aiDecisionLog)
      .set({
        wasOverridden: true,
        overrideReason: reason ?? null,
        outcome: "overridden",
      })
      .where(eq(aiDecisionLog.id, decisionLogId));
  } catch (err) {
    console.error(`[AIMemory] markDecisionOverridden error (id=${decisionLogId}):`, err);
  }
}

// ─── Human Corrections (#1409) ────────────────────────────────────────────────

/**
 * Record a rep correction to an AI-classified value.
 * This is the canonical write path for the correction loop.
 */
export async function recordAiCorrection(params: InsertAiCorrection): Promise<number | null> {
  try {
    const [row] = await db
      .insert(aiCorrections)
      .values(params)
      .returning({ id: aiCorrections.id });

    // If the correction references a decision log, mark that decision as overridden
    if (params.decisionLogId) {
      await markDecisionOverridden(params.decisionLogId, params.correctionReason ?? undefined);
    }

    return row?.id ?? null;
  } catch (err) {
    console.error("[AIMemory] recordAiCorrection error:", err);
    return null;
  }
}

// ─── Stats for Learning Center (#1410) ───────────────────────────────────────

export async function getAiDecisionStats(since: Date): Promise<{
  totalDecisions: number;
  overriddenDecisions: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  byDecisionType: Record<string, { total: number; overridden: number }>;
}> {
  const rows = await db.execute<{
    decision_type: string;
    total: string;
    overridden: string;
    high_conf: string;
    medium_conf: string;
    low_conf: string;
  }>(sql`
    SELECT
      decision_type,
      COUNT(*)                                           AS total,
      COUNT(*) FILTER (WHERE was_overridden)             AS overridden,
      COUNT(*) FILTER (WHERE confidence_tier = 'high')   AS high_conf,
      COUNT(*) FILTER (WHERE confidence_tier = 'medium') AS medium_conf,
      COUNT(*) FILTER (WHERE confidence_tier = 'low')    AS low_conf
    FROM ai_decision_log
    WHERE created_at >= ${since}
    GROUP BY decision_type
  `);

  const byDecisionType: Record<string, { total: number; overridden: number }> = {};
  let totalDecisions = 0;
  let overriddenDecisions = 0;
  let highConfidenceCount = 0;
  let mediumConfidenceCount = 0;
  let lowConfidenceCount = 0;

  for (const r of rows.rows) {
    const total = parseInt(r.total, 10);
    const overridden = parseInt(r.overridden, 10);
    byDecisionType[r.decision_type] = { total, overridden };
    totalDecisions += total;
    overriddenDecisions += overridden;
    highConfidenceCount += parseInt(r.high_conf, 10);
    mediumConfidenceCount += parseInt(r.medium_conf, 10);
    lowConfidenceCount += parseInt(r.low_conf, 10);
  }

  return { totalDecisions, overriddenDecisions, highConfidenceCount, mediumConfidenceCount, lowConfidenceCount, byDecisionType };
}

export async function getAiCorrectionStats(since: Date): Promise<{
  totalCorrections: number;
  byDecisionType: Record<string, number>;
  byReason: Record<string, number>;
}> {
  const rows = await db.execute<{
    decision_type: string;
    correction_reason: string | null;
    cnt: string;
  }>(sql`
    SELECT decision_type, correction_reason, COUNT(*) AS cnt
    FROM ai_corrections
    WHERE created_at >= ${since}
    GROUP BY decision_type, correction_reason
  `);

  const byDecisionType: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let totalCorrections = 0;

  for (const r of rows.rows) {
    const cnt = parseInt(r.cnt, 10);
    totalCorrections += cnt;
    byDecisionType[r.decision_type] = (byDecisionType[r.decision_type] ?? 0) + cnt;
    const reason = r.correction_reason ?? "unspecified";
    byReason[reason] = (byReason[reason] ?? 0) + cnt;
  }

  return { totalCorrections, byDecisionType, byReason };
}
