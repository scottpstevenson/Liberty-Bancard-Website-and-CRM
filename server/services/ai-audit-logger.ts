import { db } from "../db";
import { aiAuditLogs } from "@shared/schema";
import type { AiTriggerType } from "@shared/schema";
import type OpenAI from "openai";

const MODEL_COSTS: Record<string, { inputCentsPerToken: number; outputCentsPerToken: number }> = {
  "gpt-4o": { inputCentsPerToken: 0.00025, outputCentsPerToken: 0.001 },
  "gpt-4o-mini": { inputCentsPerToken: 0.000015, outputCentsPerToken: 0.00006 },
  "gpt-4-turbo": { inputCentsPerToken: 0.001, outputCentsPerToken: 0.003 },
  "gpt-4": { inputCentsPerToken: 0.003, outputCentsPerToken: 0.006 },
  "gpt-3.5-turbo": { inputCentsPerToken: 0.00005, outputCentsPerToken: 0.00015 },
};

function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const modelKey = Object.keys(MODEL_COSTS).find(k => model.startsWith(k)) || "gpt-4o-mini";
  const costs = MODEL_COSTS[modelKey];
  return promptTokens * costs.inputCentsPerToken + completionTokens * costs.outputCentsPerToken;
}

function summarizeResponse(content: string | null | undefined): string {
  if (!content) return "";
  return content.slice(0, 500);
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
  error?: string;
}

export async function logAiCall<T extends OpenAI.Chat.ChatCompletion>(
  params: LogAiCallParams,
  callFn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  let result: T;
  let error: string | undefined;

  try {
    result = await callFn();
  } catch (err: any) {
    error = err?.message || String(err);
    const durationMs = params.durationMs ?? (Date.now() - start);

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
  const responseSummary = params.responseSummary ?? summarizeResponse(content);

  db.insert(aiAuditLogs).values({
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
  }).catch(logErr => console.error("[AI Audit] Failed to write log:", logErr));

  return result;
}
