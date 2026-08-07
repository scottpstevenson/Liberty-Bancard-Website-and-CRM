import { db } from "../db";
import type { AiTriggerType } from "@shared/schema";
import type OpenAI from "openai";
import { createHash } from "crypto";
import { aiAuditLogs, reviewQueue, systemSettings } from "@shared/schema";
import { getSharedRedisClientIfReady } from "./queue-connection";

// ── AI error classification ────────────────────────────────────────────────
import { eq, gte, sum } from "drizzle-orm";

export type AiErrorKind = "credential" | "quota" | "other";

export interface AiErrorInfo {
  kind: AiErrorKind;
  /** Human-readable message safe to surface in the UI. */
  userMessage: string;
}

/**
 * Classify an error thrown by the OpenAI SDK (or the logAiCall wrapper) into
 * one of three buckets so callers can return a friendly response instead of a
 * generic 500.
 */
export function classifyAiError(err: unknown): AiErrorInfo {
  const e = err as any;
  const status: number | undefined = e?.status ?? e?.statusCode;
  const code: string | undefined = e?.code ?? e?.error?.code;
  const type: string | undefined = e?.type ?? e?.error?.type;
  const message: string = e?.message ?? String(err);

  // Missing API key (env var not set)
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return {
      kind: "credential",
      userMessage:
        "The AI assistant is not configured yet. An administrator needs to set up the OpenAI API key before AI features are available.",
    };
  }

  // OpenAI authentication errors (401)
  if (
    status === 401 ||
    code === "invalid_api_key" ||
    type === "authentication_error" ||
    e?.constructor?.name === "AuthenticationError" ||
    message.includes("Incorrect API key") ||
    message.includes("No API key")
  ) {
    return {
      kind: "credential",
      userMessage:
        "The AI assistant credentials are invalid or have expired. Please contact your administrator to refresh the API key.",
    };
  }

  // OpenAI quota / rate-limit errors (429)
  if (
    status === 429 ||
    code === "insufficient_quota" ||
    type === "insufficient_quota" ||
    e?.constructor?.name === "RateLimitError" ||
    message.includes("quota") ||
    message.includes("rate limit")
  ) {
    return {
      kind: "quota",
      userMessage:
        "The AI assistant has reached its usage limit for this period. Please try again later or contact your administrator to upgrade the plan.",
    };
  }

  return { kind: "other", userMessage: "The AI assistant encountered an unexpected error. Please try again." };
}

/**
 * Write a credential_error or quota row to ai_audit_logs without making an AI
 * call. Safe to fire-and-forget (errors are swallowed so the caller can still
 * return a user-friendly response).
 */
export async function logAiCredentialError(params: {
  triggerType: AiTriggerType;
  actorType?: string;
  actorId?: string;
  error: string;
}): Promise<void> {
  try {
    await db.insert(aiAuditLogs).values({
      triggerType: "credential_error",
      actorType: params.actorType || "system",
      actorId: params.actorId || null,
      model: "unknown",
      promptTokens: 0,
      completionTokens: 0,
      costCents: 0,
      responseSummary: null,
      error: `[${params.triggerType}] ${params.error}`,
      durationMs: 0,
      promptHash: null,
      confidenceScore: 0,
      flagged: false,
      rawPrompt: null,
      rawResponse: null,
    });
  } catch (logErr) {
    console.error("[AI Audit] Failed to write credential_error log:", logErr);
  }
}

const MODEL_COSTS: Record<string, { inputCentsPerToken: number; outputCentsPerToken: number }> = {
  "gpt-5": { inputCentsPerToken: 0.00025, outputCentsPerToken: 0.001 },
  "gpt-4o-mini": { inputCentsPerToken: 0.000015, outputCentsPerToken: 0.00006 },
  "gpt-4o": { inputCentsPerToken: 0.00025, outputCentsPerToken: 0.001 },
  "gpt-4-turbo": { inputCentsPerToken: 0.001, outputCentsPerToken: 0.003 },
  "gpt-4": { inputCentsPerToken: 0.003, outputCentsPerToken: 0.006 },
  "gpt-3.5-turbo": { inputCentsPerToken: 0.00005, outputCentsPerToken: 0.00015 },
};

/** Fixed per-call reservation in cents to pre-reserve before each model's dispatch.
 *  Conservative upper bound; actual cost is reconciled after the call completes. */
const MODEL_MAX_RESERVATION_CENTS: Record<string, number> = {
  "gpt-5": 20,        // ~20K tokens worst-case at gpt-5 rates
  "gpt-4o": 10,       // ~5K out + 5K in at gpt-4o rates
  "gpt-4-turbo": 50,  // higher rate model
  "gpt-4": 50,
  "gpt-4o-mini": 1,   // cheap model
  "gpt-3.5-turbo": 1,
  "gpt-audio": 5,     // audio generation estimate
  "gpt-image-1": 4,   // standard 1024x1024 image
};

/** Flat per-image cost in cents, keyed by size string. Falls back to 4 cents. */
const IMAGE_COSTS_BY_SIZE: Record<string, number> = {
  "1024x1024": 4,
  "512x512":   2,
  "256x256":   1,
};

// ── Redis-based atomic spend reservation ─────────────────────────────────────

function dailyCapKey(): string {
  const d = new Date();
  return `ai:cap:cents:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Lua script: atomically try to reserve `estimatedCents`. Returns new total on success,
 *  -1 if the reservation would exceed the cap. Sets a 25-hour TTL on first write. */
const LUA_RESERVE = `
local key  = KEYS[1]
local est  = tonumber(ARGV[1])
local cap  = tonumber(ARGV[2])
local ttl  = 90000  -- 25 hours in seconds
local cur  = tonumber(redis.call('GET', key) or '0')
if cur + est > cap then return -1 end
local nv = redis.call('INCRBY', key, est)
if redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ttl) end
return nv
`;

/** Atomically reserve `estimatedCents` against the daily cap in Redis.
 *  Returns {allowed:true} if the reservation succeeded, {allowed:false} if it
 *  would exceed the cap.  Returns {allowed:true, redisUnavailable:true} when
 *  Redis is not reachable so callers fall back to the DB-side check. */
async function atomicReserveSpend(
  estimatedCents: number,
  capCents: number,
): Promise<{ allowed: boolean; redisUnavailable?: boolean }> {
  const redis = getSharedRedisClientIfReady();
  if (!redis) return { allowed: true, redisUnavailable: true };
  try {
    const result = await (redis as any).eval(LUA_RESERVE, 1, dailyCapKey(), estimatedCents, capCents);
    return { allowed: Number(result) !== -1 };
  } catch {
    return { allowed: true, redisUnavailable: true };
  }
}

/** Adjust the Redis daily counter by `deltaCents` (may be negative to refund an over-estimate). */
function reconcileRedisSpend(deltaCents: number): void {
  if (deltaCents === 0) return;
  const redis = getSharedRedisClientIfReady();
  if (!redis) return;
  const key = dailyCapKey();
  (redis as any).incrby(key, deltaCents).catch(() => {});
}

/** Push `actualCents` into the Redis daily counter (fire-and-forget). */
function trackRedisSpend(actualCents: number): void {
  if (actualCents <= 0) return;
  const redis = getSharedRedisClientIfReady();
  if (!redis) return;
  const key = dailyCapKey();
  const ttl = 90000;
  // Best-effort INCRBY + set TTL if new
  Promise.resolve().then(async () => {
    try {
      await (redis as any).incrby(key, actualCents);
      const t = await (redis as any).ttl(key);
      if (t < 0) await (redis as any).expire(key, ttl);
    } catch {}
  });
}

const UNCERTAINTY_PHRASES = [
  "i don't know", "i'm not sure", "i cannot", "i can't", "unclear",
  "uncertain", "not certain", "may not", "might not", "possibly",
  "i'm unable", "unable to determine", "insufficient information",
  "cannot determine", "not enough information", "as an ai",
  "i don't have access", "i cannot access", "no information available",
];

let _confidenceThreshold = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || "0.5");

export function getConfidenceThreshold(): number {
  return _confidenceThreshold;
}

export function setConfidenceThreshold(val: number): void {
  _confidenceThreshold = Math.min(1, Math.max(0, val));
}

async function getSystemSettingValue(key: string): Promise<any> {
  try {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row?.value !== undefined ? row.value : null;
  } catch {
    return null;
  }
}
export interface AiGovernanceResult<T> {
  completion: T;
  flagged: boolean;
  confidence: number;
  reviewQueueId: number | null;
  auditLogId: number | null;
}

function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const modelKey = Object.keys(MODEL_COSTS).find(k => model.startsWith(k)) || "gpt-4o-mini";
  const costs = MODEL_COSTS[modelKey];
  return promptTokens * costs.inputCentsPerToken + completionTokens * costs.outputCentsPerToken;
}

function summarizeResponse(content: string | null | undefined): string {
  if (!content) return "";
  return content.slice(0, 500);
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function scoreConfidence(
  content: string | null | undefined,
  finishReason: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  if (!content) return 0;

  let score = 1.0;

  if (finishReason === "length") {
    score -= 0.3;
  } else if (finishReason === "content_filter") {
    score -= 0.4;
  } else if (finishReason !== "stop") {
    score -= 0.1;
  }

  const lower = content.toLowerCase();
  let uncertaintyCount = 0;
  for (const phrase of UNCERTAINTY_PHRASES) {
    if (lower.includes(phrase)) {
      uncertaintyCount++;
    }
  }
  if (uncertaintyCount > 0) {
    score -= Math.min(0.4, uncertaintyCount * 0.1);
  }

  if (promptTokens > 0 && completionTokens > 0) {
    const ratio = completionTokens / promptTokens;
    if (ratio < 0.05) {
      score -= 0.2;
    } else if (ratio < 0.1) {
      score -= 0.1;
    }
  }

  if (content.length < 20) {
    score -= 0.2;
  }

  return Math.min(1, Math.max(0, parseFloat(score.toFixed(2))));
}

async function routeToReviewQueue(auditLogId: number, triggerType: string, confidenceScore: number): Promise<number | null> {
  try {
    const [row] = await db.insert(reviewQueue).values({
      sourceType: "ai_output",
      sourceId: auditLogId,
      status: "pending",
      checklistState: {},
      notes: `Low-confidence AI output (score: ${confidenceScore.toFixed(2)}) for trigger: ${triggerType}`,
      metadata: {
        auditLogId,
        triggerType,
        confidenceScore,
        flaggedAt: new Date().toISOString(),
      },
    }).returning();
    return row?.id ?? null;
  } catch (err) {
    console.error("[AI Audit] Failed to create review queue item:", err);
    return null;
  }
}

export interface LogAiCallParams {
  triggerType: AiTriggerType;
  actorType?: string;
  actorId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costCents?: number;
  durationMs?: number;
  responseSummary?: string;
  rawPrompt?: string;
  error?: string;
  skipReviewQueue?: boolean;
  onGovernance?: (result: Pick<AiGovernanceResult<unknown>, "flagged" | "confidence" | "reviewQueueId" | "auditLogId">) => void;
}

/**
 * Lightweight cost recorder for AI call sites that gate via checkAiGate() but do
 * not route through logAiCall() (e.g. system-level probes, embeddings, Anthropic).
 * Fire-and-forget — never throws so a logging failure cannot break the caller.
 *
 * @param costCentsOverride - Pass a fixed cost (e.g. for image calls) instead of
 *   computing from tokens. Required when the provider does not return token counts.
 */
export function recordAiSpend(
  model: string,
  promptTokens: number,
  completionTokens: number,
  triggerType: AiTriggerType = "enrichment",
  costCentsOverride?: number,
): number {
  const costCents = costCentsOverride ?? estimateCostCents(model, promptTokens, completionTokens);
  // NOTE: Redis tracking is handled by the AiCapSlot.settle() call at the call site.
  // recordAiSpend() only writes the audit-log DB row; it must NOT call trackRedisSpend()
  // or the reservation and the actual cost are both counted, doubling the Redis total.
  db.insert(aiAuditLogs).values({
    triggerType,
    actorType: "system",
    actorId: null,
    model,
    promptTokens,
    completionTokens,
    costCents,
    responseSummary: null,
    error: null,
    durationMs: 0,
    promptHash: null,
    confidenceScore: 1,
    flagged: false,
    rawPrompt: null,
    rawResponse: null,
  }).catch(err => console.error("[AI Audit] recordAiSpend failed:", err));
  return costCents;
}

/** Returned by checkAiGate(). Use refund() on failure and settle() on success. */
export interface AiCapSlot {
  /** Estimated cents reserved in Redis. 0 when no cap is configured or Redis unavailable. */
  estimatedCents: number;
  /**
   * Refund the full pre-reservation. Call in catch/finally when the provider call fails
   * so the reserved cents are not permanently consumed.
   */
  refund(): void;
  /**
   * Reconcile the reservation with the actual cost of a successful call.
   * Adjusts the Redis counter by (actualCents − estimatedCents) so the
   * running total reflects real spend rather than the conservative estimate.
   * Call this INSTEAD of a separate trackRedisSpend — it avoids double-counting.
   */
  settle(actualCents: number): void;
}

/**
 * Single gate function for ALL AI call sites.
 * Throws if AI is paused (manual or cap-triggered).
 * When a model hint is provided, atomically pre-reserves an estimated cost in Redis
 * so concurrent callers cannot collectively exceed the cap.
 *
 * Returns a slot with `refund()` — callers MUST call slot.refund() in a catch/finally
 * if the provider call fails, so the Redis reservation is released.
 */
export async function checkAiGate(model?: string): Promise<AiCapSlot> {
  const paused = await isAiPaused();
  if (paused) {
    throw new Error("AI operations are currently paused by an administrator. Please try again later.");
  }

  const cap = await getSystemSettingValue("ai_daily_spend_cap_cents");
  if (!cap || typeof cap !== "number" || cap <= 0) {
    // No cap configured — still check DB spend as a safety net then return a no-op slot.
    const capExceeded = await checkAndEnforceSpendCap();
    if (capExceeded) {
      throw new Error("AI daily spend cap reached. AI has been automatically paused until midnight UTC.");
    }
    return { estimatedCents: 0, refund: () => {}, settle: () => {} };
  }

  const estimatedCents = model
    ? (Object.entries(MODEL_MAX_RESERVATION_CENTS).find(([k]) => model.startsWith(k))?.[1] ?? 5)
    : 5; // conservative default when no model hint

  const reservation = await atomicReserveSpend(estimatedCents, cap);
  if (!reservation.redisUnavailable) {
    if (!reservation.allowed) {
      // Atomic check: cap will be exceeded — auto-pause and reject
      const alreadyPaused = await isAiPaused();
      if (!alreadyPaused) {
        await setSystemSettingValue("ai_paused", true);
        await setSystemSettingValue("ai_paused_reason", "daily_spend_cap");
        console.warn(`[AI Kill Switch] Atomic cap reservation blocked call (cap: ${cap}¢). AI auto-paused.`);
      }
      throw new Error("AI daily spend cap reached. AI has been automatically paused until midnight UTC.");
    }
    return {
      estimatedCents,
      refund: () => reconcileRedisSpend(-estimatedCents),
      settle: (actualCents: number) => reconcileRedisSpend(Math.round(actualCents) - estimatedCents),
    };
  }

  // Redis unavailable — fall back to DB-aggregated check (non-atomic but always available)
  const capExceeded = await checkAndEnforceSpendCap();
  if (capExceeded) {
    throw new Error("AI daily spend cap reached. AI has been automatically paused until midnight UTC.");
  }
  // No Redis reservation in use — settle is a no-op; DB row from recordAiSpend() is sufficient
  return { estimatedCents: 0, refund: () => {}, settle: () => {} };
}

export async function logAiCall<T extends OpenAI.Chat.ChatCompletion>(
  params: LogAiCallParams,
  callFn: () => Promise<T>
): Promise<AiGovernanceResult<T>> {
  // ── Kill switch gate ────────────────────────────────────────────────────────
  const paused = await isAiPaused();
  if (paused) {
    throw new Error("AI operations are currently paused by an administrator. Please try again later.");
  }
  // Pre-reserve an estimated cost atomically in Redis before dispatching.
  const modelKey = params.model || "gpt-4o-mini";
  const reservationCents = Object.entries(MODEL_MAX_RESERVATION_CENTS)
    .find(([k]) => modelKey.startsWith(k))?.[1] ?? 5;
  const capExceeded = await checkAndEnforceSpendCap(reservationCents);
  if (capExceeded) {
    throw new Error("AI daily spend cap reached. AI has been automatically paused until midnight UTC.");
  }
  // ───────────────────────────────────────────────────────────────────────────

  const start = Date.now();
  let result: T;

  try {
    result = await callFn();
  } catch (err: any) {
    // Refund the pre-reservation so failed calls don't exhaust the daily cap.
    reconcileRedisSpend(-reservationCents);

    const error = err?.message || String(err);
    const durationMs = params.durationMs ?? (Date.now() - start);
    const promptHash = params.rawPrompt ? hashPrompt(params.rawPrompt) : undefined;

    db.insert(aiAuditLogs).values({
      triggerType: params.triggerType,
      actorType: params.actorType || "system",
      actorId: params.actorId || null,
      model: params.model || "unknown",
      promptTokens: params.promptTokens || 0,
      completionTokens: params.completionTokens || 0,
      costCents: params.costCents || 0,
      responseSummary: params.responseSummary || null,
      error,
      durationMs,
      promptHash: promptHash || null,
      confidenceScore: 0,
      flagged: false,
      rawPrompt: params.rawPrompt || null,
      rawResponse: null,
    }).catch(logErr => console.error("[AI Audit] Failed to write error log:", logErr));

    throw err;
  }

  const durationMs = params.durationMs ?? (Date.now() - start);
  const usage = result.usage;
  const promptTokens = params.promptTokens ?? (usage?.prompt_tokens || 0);
  const completionTokens = params.completionTokens ?? (usage?.completion_tokens || 0);
  const model = params.model || result.model || "unknown";
  const costCents = params.costCents ?? estimateCostCents(model, promptTokens, completionTokens);
  // Reconcile Redis counter: subtract reservation, add actual cost (delta may be negative)
  reconcileRedisSpend(Math.round(costCents) - reservationCents);
  const content = result.choices?.[0]?.message?.content;
  const finishReason = result.choices?.[0]?.finish_reason;
  const responseSummary = params.responseSummary ?? summarizeResponse(content);

  const promptHash = params.rawPrompt ? hashPrompt(params.rawPrompt) : undefined;
  const confidenceScore = scoreConfidence(content, finishReason, promptTokens, completionTokens);
  const flagged = confidenceScore < _confidenceThreshold;

  const [logRow] = await db.insert(aiAuditLogs).values({
    triggerType: params.triggerType,
    actorType: params.actorType || "system",
    actorId: params.actorId || null,
    model,
    promptTokens,
    completionTokens,
    costCents,
    responseSummary,
    error: params.error || null,
    durationMs,
    promptHash: promptHash || null,
    confidenceScore,
    flagged,
    rawPrompt: params.rawPrompt || null,
    rawResponse: content || null,
  }).returning().catch(logErr => {
    console.error("[AI Audit] Failed to write log:", logErr);
    return [];
  });

  const auditLogId = logRow?.id ?? null;
  let reviewQueueId: number | null = null;

  if (flagged && !params.skipReviewQueue && auditLogId) {
    reviewQueueId = await routeToReviewQueue(auditLogId, params.triggerType, confidenceScore);
  }

  const governanceInfo = { flagged, confidence: confidenceScore, reviewQueueId, auditLogId };
  if (params.onGovernance) {
    try { params.onGovernance(governanceInfo); } catch {}
  }

  return { completion: result, ...governanceInfo };
}

export async function isAiPaused(): Promise<boolean> {
  const val = await getSystemSettingValue("ai_paused");
  return val === true;
}

async function setSystemSettingValue(key: string, value: any): Promise<void> {
  const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  if (existing.length > 0) {
    await db.update(systemSettings).set({ value, updatedAt: new Date() }).where(eq(systemSettings.key, key));
  } else {
    await db.insert(systemSettings).values({ key, value, updatedAt: new Date() });
  }
}

/**
 * Checks the daily spend cap. If exceeded, auto-pauses AI and returns true.
 * Returns false if under cap or no cap is set.
 *
 * When `estimatedCents` is provided, performs an atomic Redis reservation first
 * so concurrent callers cannot collectively blow past the cap.  Falls back to
 * the DB-aggregated total when Redis is unavailable.
 */
export async function checkAndEnforceSpendCap(estimatedCents?: number): Promise<boolean> {
  const cap = await getSystemSettingValue("ai_daily_spend_cap_cents");
  if (!cap || typeof cap !== "number" || cap <= 0) return false;

  // ── Try the fast atomic Redis path first ──────────────────────────────────
  if (estimatedCents && estimatedCents > 0) {
    const reservation = await atomicReserveSpend(estimatedCents, cap);
    if (!reservation.redisUnavailable) {
      if (!reservation.allowed) {
        // Cap will be exceeded — auto-pause and reject
        const alreadyPaused = await isAiPaused();
        if (!alreadyPaused) {
          await setSystemSettingValue("ai_paused", true);
          await setSystemSettingValue("ai_paused_reason", "daily_spend_cap");
          console.warn(`[AI Kill Switch] Redis cap reservation blocked call (cap: ${cap}¢). AI auto-paused.`);
        }
        return true;
      }
      // Reservation succeeded — proceed (reconciliation happens in logAiCall / recordAiSpend).
      return false;
    }
    // Redis unavailable — fall through to DB check.
  }

  // ── Fallback: DB-aggregated total (non-atomic but always available) ────────
  const spent = await getDailySpendCents();
  if (spent >= cap) {
    const alreadyPaused = await isAiPaused();
    if (!alreadyPaused) {
      await setSystemSettingValue("ai_paused", true);
      await setSystemSettingValue("ai_paused_reason", "daily_spend_cap");
      console.warn(`[AI Kill Switch] Daily spend cap of ${cap} cents exceeded (spent: ${spent}). AI auto-paused.`);
    }
    return true;
  }
  return false;
}

/** Returns today's total AI spend in cents (UTC day boundary). */
export async function getDailySpendCents(): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [row] = await db
      .select({ total: sum(aiAuditLogs.costCents) })
      .from(aiAuditLogs)
      .where(gte(aiAuditLogs.createdAt, startOfDay));
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}
