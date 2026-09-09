import { storage } from "../storage";
import type { ContactAiCache } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";

const PROMPT_VERSION = "v3";
const TEST_MODEL = "test-fixture";
const LIVE_MODEL = "gpt-4o-mini";
const SalesPrepSchema = z.object({
  talkingPoints: z.array(z.string()),
  objections: z.array(z.string()),
  questions: z.array(z.string()),
  summary: z.string(),
});

export interface SalesPrepOutput {
  callOpener: string;
  processorAngle: string;
  likelyObjection: string;
  recommendedCta: string;
  statementAsk: string;
  unavailable?: boolean;
  reason?: string;
  talkingPoints?: string[];
  objections?: string[];
  questions?: string[];
  summary?: string;
}

function buildFixture(companyName: string): SalesPrepOutput {
  return {
    callOpener: `Hi, this is Liberty Bancard reaching out about ${companyName || "your business"}. We specialize in helping businesses reduce their payment processing costs — do you have 2 minutes?`,
    processorAngle: "Most businesses in your space are overpaying on interchange and markup fees. We typically show 15-30% in savings.",
    likelyObjection: "We're happy with our current processor / We're under contract.",
    recommendedCta: "Would it be okay if I sent you a free statement analysis? It takes 24 hours and costs you nothing.",
    statementAsk: "Just send over your most recent processing statement — we'll identify exactly where the fees are and what we can save you.",
  };
}

export async function checkSalesPrepCache(contactId: number, cacheKey?: string): Promise<ContactAiCache | null> {
  if (!cacheKey) {
    const contact = await storage.getContact(contactId);
    if (!contact) return null;
    cacheKey = `sales_prep_${PROMPT_VERSION}_${contactId}_${crypto.createHash("sha256").update(`${contact.updatedAt ?? ""}${LIVE_MODEL}`).digest("hex").slice(0, 12)}`;
  }
  return storage.getContactAiCache(contactId, cacheKey);
}

export async function generateSalesPrepAi(contactId: number): Promise<{ output: SalesPrepOutput; generatedAt: Date; fromCache: boolean; model: string }> {
  const contact = await storage.getContact(contactId);
  if (!contact) throw new Error(`Contact #${contactId} not found`);
  const cacheKey = `sales_prep_${PROMPT_VERSION}_${contactId}_${crypto.createHash("sha256").update(`${contact.updatedAt ?? ""}${LIVE_MODEL}`).digest("hex").slice(0, 12)}`;
  const cached = await checkSalesPrepCache(contactId, cacheKey);
  if (cached) {
    return { output: cached.output as SalesPrepOutput, generatedAt: cached.generatedAt, fromCache: true, model: cached.model ?? LIVE_MODEL };
  }

  const testMode = process.env.NODE_ENV === "test";
  const hasApiKey = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (testMode) {
    const fixture = buildFixture(contact?.companyName || `Contact #${contactId}`);
    return { output: fixture, generatedAt: new Date(), fromCache: false, model: TEST_MODEL };
  }
  if (!hasApiKey) return { output: { unavailable: true, reason: "PROVIDER_ERROR" } as SalesPrepOutput, generatedAt: new Date(), fromCache: false, model: LIVE_MODEL };

  const companyName = contact.companyName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "the merchant";
  const industry = contact.industry || "retail/service";
  const currentProcessor = contact.currentProvider || "unknown";
  const vertical = (contact as any).vertical || industry;

  const prompt = `You are a sales prep AI for Liberty Bancard, a merchant payment processing company.
Generate a concise sales prep brief for a call with ${companyName}.

Context:
- Industry/Vertical: ${vertical}
- Current Processor: ${currentProcessor}
- Lead Source: ${contact.leadSource || "SDR outreach"}

Return a JSON object with exactly these fields:
{
  "talkingPoints": ["specific talking point"],
  "objections": ["likely objection"],
  "questions": ["useful discovery question"],
  "summary": "brief sales prep summary"
}

Be specific to the merchant's industry and current processor. Keep each field under 3 sentences. Return only valid JSON.`;

  let output: SalesPrepOutput;
  try {
    const { checkAiGate, recordAiSpend } = await import("./ai-audit-logger");
    const slot = await checkAiGate(LIVE_MODEL);
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    let response;
    try {
      response = await openai.chat.completions.create({
        model: LIVE_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 400,
        temperature: 0.6,
      });
    } catch (providerErr) {
      slot.refund();
      throw providerErr;
    }
    slot.settle(recordAiSpend(LIVE_MODEL, response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "sales-prep"));
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = SalesPrepSchema.parse(JSON.parse(raw));
    output = {
      callOpener: parsed.talkingPoints[0] ?? parsed.summary,
      processorAngle: parsed.talkingPoints.join(" "),
      likelyObjection: parsed.objections[0] ?? "",
      recommendedCta: parsed.questions[0] ?? "",
      statementAsk: parsed.questions.slice(1).join(" "),
      ...parsed,
    };
  } catch (err: any) {
    console.error("[SalesPrep] OpenAI call failed:", err.message);
    const reason = err?.name === "ZodError" ? "MALFORMED_OUTPUT" : "PROVIDER_ERROR";
    return { output: { unavailable: true, reason } as SalesPrepOutput, generatedAt: new Date(), fromCache: false, model: LIVE_MODEL };
  }

  const persisted = await storage.setContactAiCache(contactId, cacheKey, output as unknown as Record<string, unknown>, LIVE_MODEL);
  return { output, generatedAt: persisted.generatedAt, fromCache: false, model: LIVE_MODEL };
}
