import { db } from "../db";
import { aiAuditLogs, reviewQueue } from "@shared/schema";
import type { AiTriggerType } from "@shared/schema";
import type OpenAI from "openai";
import { createHash } from "crypto";

const MODEL_COSTS: Record<string, { inputCentsPerToken: number; outputCentsPerToken: number }> = {
  "gpt-4o": { inputCentsPerToken: 0.00025, outputCentsPerToken: 0.001 },
  "gpt-4o-mini": { inputCentsPerToken: 0.000015, outputCentsPerToken: 0.00006 },
  "gpt-4-turbo": { inputCentsPerToken: 0.001, outputCentsPerToken: 0.003 },
  "gpt-4": { inputCentsPerToken: 0.003, outputCentsPerToken: 0.006 },
  "gpt-3.5-turbo": { inputCentsPerToken: 0.00005, outputCentsPerToken: 0.00015 },
};

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

export async function logAiCall<T extends OpenAI.Chat.ChatCompletion>(
  params: LogAiCallParams,
  callFn: () => Promise<T>
): Promise<AiGovernanceResult<T>> {
  const start = Date.now();
  let result: T;

  try {
    result = await callFn();
  } catch (err: any) {
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
