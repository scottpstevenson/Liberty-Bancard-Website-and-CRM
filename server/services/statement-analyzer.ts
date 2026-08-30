// OUTBOUND CONTRACT: This service writes only to the database.
// It must never call: sendProposalEmail, sendSmtpEmail, autoGenerateProposal,
// autoEnrollFromTrigger, createGhlTask, sendGhlEmailForMerchant, or any sequence/workflow.
// Proposal generation is intentionally not launched by statement processing.

import OpenAI from "openai";
import { checkAiGate, recordAiSpend } from "./ai-audit-logger";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { documents, statementProposals } from "@shared/schema";
import { getProtectedObject, getProtectedObjectMetadata } from "./protected-object";

function getOpenAI(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

const ExtractionSchema = z.object({
  processorName: z.string().default("Unknown"),
  monthlyVolume: z.number().min(0),
  totalFees: z.number().min(0),
  fixedFees: z.number().min(0).default(0),
  authFees: z.number().min(0).default(0),
  batchFees: z.number().min(0).default(0),
  pciFees: z.number().min(0).default(0),
  cardMix: z.object({
    visa: z.number().optional(),
    mc: z.number().optional(),
    amex: z.number().optional(),
    debit: z.number().optional(),
  }).default({}),
  topCostDrivers: z.array(z.string()).max(5).default([]),
});

type Extraction = z.infer<typeof ExtractionSchema>;

const FIXTURE_EXTRACTION: Extraction = {
  processorName: "Test Processor",
  monthlyVolume: 75000,
  totalFees: 2250,
  fixedFees: 150,
  authFees: 90,
  batchFees: 30,
  pciFees: 20,
  cardMix: { visa: 55, mc: 25, amex: 10, debit: 10 },
  topCostDrivers: ["Interchange Downgrades", "PCI Non-Compliance Fee", "Monthly Service Fee"],
};

async function readBufferText(buffer: Buffer, fileName: string, label: string): Promise<string | null> {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
      const textResult = await parser.getText();
      const text = textResult?.text || "";
      if (text.trim().length > 50) {
        console.log(`[StatementAnalyzer] Extracted ${text.length} chars from ${label}`);
        return text.trim();
      }
    } catch (pdfErr) {
      console.error(`[StatementAnalyzer] PDF parse failed for ${label}:`, pdfErr);
    }
  } else if ([".txt", ".csv"].includes(ext)) {
    const text = buffer.toString("utf8");
    if (text.trim().length > 50) {
      console.log(`[StatementAnalyzer] Read ${text.length} chars from ${label}`);
      return text.trim();
    }
  }
  return null;
}

async function extractTextFromProtectedObject(objectRef: string | null, fileName: string, tenantScope: string | null): Promise<string | null> {
  if (!objectRef || !/^[0-9a-f-]{36}$/i.test(objectRef)) {
    throw new Error("LEGACY_LOCAL_PATH_UNRECOVERABLE");
  }
  if (!tenantScope) throw new Error("PROTECTED_OBJECT_TENANT_SCOPE_REQUIRED");
  try {
    const authorization = {
      tenantScope,
      environmentScope: process.env.NODE_ENV || "development",
    };
    const metadata = await getProtectedObjectMetadata(objectRef, authorization);
    if (!metadata) throw new Error("PROTECTED_OBJECT_SCOPE_MISMATCH");
    const bytes = await getProtectedObject(objectRef, authorization);
    return readBufferText(bytes, fileName, `protected-object:${objectRef}`);
  } catch (error) {
    console.error("[StatementAnalyzer] Protected object unavailable:", error instanceof Error ? error.message : "unknown");
    if (error instanceof Error && (
      error.message === "PROTECTED_OBJECT_SCOPE_MISMATCH" ||
      error.message === "LEGACY_LOCAL_PATH_UNRECOVERABLE"
    )) throw error;
    return null;
  }
}

async function callOpenAIExtraction(statementText: string): Promise<Extraction | null> {
  if (process.env.SKIP_AI === "true" || process.env.TEST_MODE === "true") {
    return FIXTURE_EXTRACTION;
  }

  const slot = await checkAiGate("gpt-4o");
  const openai = getOpenAI();
  const systemPrompt = `You are a payment processing statement analyzer. 
Extract ONLY the following raw numeric fields from the merchant processing statement. 
Return a JSON object with EXACTLY these keys — no others:
- processorName: string (processor company name, e.g. "First Data", "Stripe")
- monthlyVolume: number (total monthly processing volume in dollars, no commas)
- totalFees: number (total fees/charges in dollars for the month)
- fixedFees: number (monthly fixed/flat fees in dollars, 0 if not found)
- authFees: number (authorization fees total in dollars, 0 if not found)
- batchFees: number (batch/settlement fees total in dollars, 0 if not found)
- pciFees: number (PCI compliance fees in dollars, 0 if not found)
- cardMix: object with optional keys visa, mc, amex, debit (percentage of volume each, e.g. 55.2)
- topCostDrivers: array of up to 5 strings naming the biggest fee line items

IMPORTANT: Do NOT calculate effectiveRate or savings — return raw numbers only.
If a value cannot be found, use 0 for numeric fields.
Return only valid JSON with no markdown, no explanation.`;

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyze this merchant processing statement and extract the requested fields:\n\n${statementText.slice(0, 8000)}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
  } catch (providerErr) {
    slot.refund();
    throw providerErr;
  }

  slot.settle(recordAiSpend("gpt-4o", response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "statement-analysis"));
  const raw = response.choices[0]?.message?.content;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    console.error("[StatementAnalyzer] Failed to parse OpenAI JSON response:", raw?.slice(0, 200));
    return null;
  }
}

async function markFailed(dealId: number, reason: string): Promise<void> {
  // Concurrency-safe upsert: unique partial index on deal_id WHERE deal_id IS NOT NULL.
  // If the upload chain already created a draft row, flip it to failed; otherwise create it.
  await db.execute(sql`
    INSERT INTO statement_proposals
      (deal_id, status, notes, plans, created_at, updated_at)
    VALUES
      (${dealId}, 'failed', ${reason}, ${'[]'}::jsonb, NOW(), NOW())
    ON CONFLICT (deal_id) WHERE deal_id IS NOT NULL
    DO UPDATE SET
      status     = 'failed',
      notes      = EXCLUDED.notes,
      updated_at = NOW()
  `);

  await storage.createAuditLog({
    action: "statement_analysis_failed",
    entityType: "deal",
    entityId: dealId,
    actorType: "system",
    details: { reason, timestamp: new Date().toISOString() },
  }).catch(() => {});
}

export async function analyzeStatementBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<{
  processorDetected: string | null;
  effectiveRate: string | null;
  monthlyVolume: string | null;
  estimatedSavings: string | null;
  rawSummary: string;
  tokensUsed: number;
  durationMs: number;
}> {
  const startMs = Date.now();
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  let statementText: string | null = null;

  if (ext === "pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
      const textResult = await parser.getText();
      const text = textResult?.text || "";
      if (text.trim().length > 50) statementText = text.trim();
    } catch (err) {
      console.error("[analyzeStatementBuffer] PDF parse error:", err);
    }
  } else if (ext === "txt" || ext === "csv") {
    const text = buffer.toString("utf-8");
    if (text.trim().length > 50) statementText = text.trim();
  }

  if (!statementText) {
    return {
      processorDetected: null,
      effectiveRate: null,
      monthlyVolume: null,
      estimatedSavings: null,
      rawSummary: "Could not extract readable text from the uploaded file.",
      tokensUsed: 0,
      durationMs: Date.now() - startMs,
    };
  }

  const extraction = await callOpenAIExtraction(statementText);
  const durationMs = Date.now() - startMs;

  if (!extraction) {
    return {
      processorDetected: null,
      effectiveRate: null,
      monthlyVolume: null,
      estimatedSavings: null,
      rawSummary: "AI extraction returned no usable output.",
      tokensUsed: 0,
      durationMs,
    };
  }

  const parseResult = ExtractionSchema.safeParse(extraction);
  if (!parseResult.success) {
    return {
      processorDetected: null,
      effectiveRate: null,
      monthlyVolume: null,
      estimatedSavings: null,
      rawSummary: `Schema validation failed: ${parseResult.error.issues.map(i => i.message).join("; ")}`,
      tokensUsed: 0,
      durationMs,
    };
  }

  const extracted = parseResult.data;
  const effectiveRate = extracted.monthlyVolume > 0
    ? extracted.totalFees / extracted.monthlyVolume
    : 0;

  let savingsNote = "No estimate available (LIBERTY_TARGET_EFFECTIVE_RATE_BPS not configured)";
  const targetBps = Number(process.env.LIBERTY_TARGET_EFFECTIVE_RATE_BPS);
  if (targetBps > 0) {
    const libertyFees = extracted.monthlyVolume * (targetBps / 10000);
    const savings = extracted.totalFees - libertyFees;
    savingsNote = savings > 0
      ? `$${Math.round(savings).toLocaleString()}/mo (estimated)`
      : "No clear savings detected";
  } else if (process.env.TEST_MODE === "true" || process.env.SKIP_AI === "true") {
    const libertyFees = extracted.monthlyVolume * (185 / 10000);
    const savings = extracted.totalFees - libertyFees;
    savingsNote = `$${Math.round(savings).toLocaleString()}/mo (test fixture)`;
  }

  return {
    processorDetected: extracted.processorName || null,
    effectiveRate: `${(effectiveRate * 100).toFixed(2)}%`,
    monthlyVolume: `$${Math.round(extracted.monthlyVolume).toLocaleString()}`,
    estimatedSavings: savingsNote,
    rawSummary: JSON.stringify({
      processorName: extracted.processorName,
      monthlyVolume: extracted.monthlyVolume,
      totalFees: extracted.totalFees,
      effectiveRate: `${(effectiveRate * 100).toFixed(2)}%`,
      topCostDrivers: extracted.topCostDrivers,
    }),
    tokensUsed: 0,
    durationMs,
  };
}

export async function analyzeStatement(dealId: number): Promise<void> {
  console.log(`[StatementAnalyzer] Starting structured analysis for deal #${dealId}`);

  const statementDocs = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.dealId, dealId),
        eq(documents.type, "merchant_statement"),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(10);

  if (statementDocs.length === 0) {
    console.warn(`[StatementAnalyzer] No merchant_statement documents found for deal #${dealId}`);
    await markFailed(dealId, "No merchant statement document found for this deal.");
    return;
  }

  const selectedDoc = statementDocs[0];
  console.log(`[StatementAnalyzer] Selected documentId=${selectedDoc.id} fileName=${selectedDoc.fileName} for deal #${dealId}`);

  const statementText = await extractTextFromProtectedObject(
    selectedDoc.storageKey,
    selectedDoc.fileName,
    selectedDoc.contactId ? `contact:${selectedDoc.contactId}` : null,
  );

  if (!statementText) {
    console.warn(`[StatementAnalyzer] Could not extract text from document #${selectedDoc.id} for deal #${dealId}`);
    await markFailed(dealId, `Could not extract readable text from document #${selectedDoc.id} (${selectedDoc.fileName}).`);
    return;
  }

  let rawExtraction: Extraction | null = null;
  try {
    rawExtraction = await callOpenAIExtraction(statementText);
  } catch (aiErr: any) {
    console.error(`[StatementAnalyzer] OpenAI call threw for deal #${dealId}:`, aiErr.message);
    await markFailed(dealId, `AI extraction error: ${aiErr.message}`);
    return;
  }

  if (!rawExtraction) {
    console.warn(`[StatementAnalyzer] OpenAI returned null or unparseable output for deal #${dealId}`);
    await markFailed(dealId, "AI extraction returned no usable output — rep review required.");
    return;
  }

  const parseResult = ExtractionSchema.safeParse(rawExtraction);

  if (!parseResult.success) {
    console.warn(`[StatementAnalyzer] Zod validation failed for deal #${dealId}:`, parseResult.error.issues);
    await markFailed(
      dealId,
      `AI extraction failed schema validation: ${parseResult.error.issues.map(i => i.message).join("; ")}`,
    );
    return;
  }

  const extracted = parseResult.data;

  const effectiveRate =
    extracted.monthlyVolume > 0 ? extracted.totalFees / extracted.monthlyVolume : 0;

  let savingsMonthly: number | null = null;
  let savingsNote: string;

  const targetBps = Number(process.env.LIBERTY_TARGET_EFFECTIVE_RATE_BPS);
  if (targetBps > 0) {
    const libertyFees = extracted.monthlyVolume * (targetBps / 10000);
    savingsMonthly = extracted.totalFees - libertyFees;
    savingsNote =
      savingsMonthly > 0
        ? `$${Math.round(savingsMonthly).toLocaleString()}/mo (estimated, draft)`
        : "No clear savings detected from the extracted statement.";
  } else if (process.env.TEST_MODE === "true" || process.env.SKIP_AI === "true") {
    // Fixture mode only — 185 bps expressed as fraction (185 / 10000)
    const testTargetBps = 185;
    const libertyFees = extracted.monthlyVolume * (testTargetBps / 10000);
    savingsMonthly = extracted.totalFees - libertyFees;
    savingsNote = `$${Math.round(savingsMonthly ?? 0).toLocaleString()}/mo (test fixture only)`;
  } else {
    savingsNote =
      "No estimate available — rep review required (LIBERTY_TARGET_EFFECTIVE_RATE_BPS not configured)";
  }

  const analysisPayload = JSON.stringify({
    extraction: extracted,
    computedMetrics: {
      effectiveRate,
      savingsMonthly,
      analyzedAt: new Date().toISOString(),
    },
    documentId: selectedDoc.id,
  });

  // Concurrency-safe upsert: unique partial index on deal_id WHERE deal_id IS NOT NULL.
  // If a draft row already exists (from the upload chain), update it with analysis results.
  const analyzeResult = await db.execute(sql`
    INSERT INTO statement_proposals
      (deal_id, status, effective_rate, savings_estimate, notes, plans, created_at, updated_at)
    VALUES
      (${dealId}, 'analyzed', ${`${(effectiveRate * 100).toFixed(2)}%`}, ${savingsNote},
       ${analysisPayload}, ${'[]'}::jsonb, NOW(), NOW())
    ON CONFLICT (deal_id) WHERE deal_id IS NOT NULL
    DO UPDATE SET
      status           = 'analyzed',
      effective_rate   = EXCLUDED.effective_rate,
      savings_estimate = EXCLUDED.savings_estimate,
      notes            = EXCLUDED.notes,
      updated_at       = NOW()
    RETURNING id
  `);
  const analyzedRow = analyzeResult.rows[0] as { id: number } | undefined;
  console.log(`[StatementAnalyzer] Upserted statement_proposals row #${analyzedRow?.id} for deal #${dealId}`);

  await storage.createAuditLog({
    action: "statement_analysis_complete",
    entityType: "deal",
    entityId: dealId,
    actorType: "system",
    details: {
      documentId: selectedDoc.id,
      effectiveRate: `${(effectiveRate * 100).toFixed(2)}%`,
      savingsEstimate: savingsNote,
      processorName: extracted.processorName,
      monthlyVolume: extracted.monthlyVolume,
      totalFees: extracted.totalFees,
      timestamp: new Date().toISOString(),
    },
  }).catch(() => {});

  console.log(`[StatementAnalyzer] Analysis complete for deal #${dealId} — effectiveRate=${(effectiveRate * 100).toFixed(2)}% savings="${savingsNote}"`);
}
