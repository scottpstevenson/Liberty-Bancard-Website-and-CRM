import { storage } from "../storage";
import type { ContactAiCache } from "@shared/schema";

const CACHE_KEY = "sales_prep_v1";
const TEST_MODEL = "test-fixture";
const LIVE_MODEL = "gpt-4o-mini";

export interface SalesPrepOutput {
  callOpener: string;
  processorAngle: string;
  likelyObjection: string;
  recommendedCta: string;
  statementAsk: string;
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

export async function checkSalesPrepCache(contactId: number): Promise<ContactAiCache | null> {
  return storage.getContactAiCache(contactId, CACHE_KEY);
}

export async function generateSalesPrepAi(contactId: number): Promise<{ output: SalesPrepOutput; generatedAt: Date; fromCache: boolean; model: string }> {
  const cached = await checkSalesPrepCache(contactId);
  if (cached) {
    return { output: cached.output as SalesPrepOutput, generatedAt: cached.generatedAt, fromCache: true, model: cached.model ?? CACHE_KEY };
  }

  const testMode = process.env.TEST_MODE === "true";
  const hasApiKey = !!process.env.OPENAI_API_KEY;

  if (testMode || !hasApiKey) {
    const contact = await storage.getContact(contactId);
    const fixture = buildFixture(contact?.companyName || `Contact #${contactId}`);
    const now = new Date();
    await storage.setContactAiCache(contactId, CACHE_KEY, fixture as unknown as Record<string, unknown>, TEST_MODEL);
    return { output: fixture, generatedAt: now, fromCache: false, model: TEST_MODEL };
  }

  const contact = await storage.getContact(contactId);
  if (!contact) throw new Error(`Contact #${contactId} not found`);

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
  "callOpener": "A 1-2 sentence opening line tailored to this business",
  "processorAngle": "A 1-2 sentence value proposition angle specific to their industry/processor",
  "likelyObjection": "The most likely objection this merchant will raise (1 sentence)",
  "recommendedCta": "The recommended next-step call to action (1 sentence)",
  "statementAsk": "A natural, non-pushy way to ask for their processing statement (1-2 sentences)"
}

Be specific to the merchant's industry and current processor. Keep each field under 3 sentences. Return only valid JSON.`;

  let output: SalesPrepOutput;
  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: LIVE_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.6,
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    output = {
      callOpener: parsed.callOpener ?? "",
      processorAngle: parsed.processorAngle ?? "",
      likelyObjection: parsed.likelyObjection ?? "",
      recommendedCta: parsed.recommendedCta ?? "",
      statementAsk: parsed.statementAsk ?? "",
    };
  } catch (err: any) {
    console.error("[SalesPrep] OpenAI call failed, using fixture:", err.message);
    output = buildFixture(companyName);
  }

  const now = new Date();
  await storage.setContactAiCache(contactId, CACHE_KEY, output as unknown as Record<string, unknown>, LIVE_MODEL);
  return { output, generatedAt: now, fromCache: false, model: LIVE_MODEL };
}
