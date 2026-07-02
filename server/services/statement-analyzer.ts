// OUTBOUND CONTRACT: This service writes only to the database.
// It must never call: sendProposalEmail, sendSmtpEmail, autoGenerateProposal,
// autoEnrollFromTrigger, createGhlTask, sendGhlEmailForMerchant, or any sequence/workflow.
// autoGenerateProposal fires independently from statement-upload-chain.ts:373.
// That is a separate pre-existing flow outside this analyzer's scope.

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { documents, statementProposals } from "@shared/schema";

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

async function readFileText(filePath: string, label: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const buffer = fs.readFileSync(filePath);
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
    const text = fs.readFileSync(filePath, "utf-8");
    if (text.trim().length > 50) {
      console.log(`[StatementAnalyzer] Read ${text.length} chars from ${label}`);
      return text.trim();
    }
  }
  return null;
}

async function extractTextFromDisk(storageKey: string | null, fileName: string): Promise<string | null> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) return null;

  // Build a priority-ordered list of candidate paths.
  // storageKey is typically "statements/<diskFileName>" so the file lives at
  // uploads/statements/<diskFileName> — NOT in the uploads/ root.
  const candidates: string[] = [];

  if (storageKey) {
    // Primary: treat storageKey as relative to uploads/
    candidates.push(path.join(uploadsDir, storageKey.replace(/^uploads\//, "")));
    // Secondary: storageKey might itself be an absolute path
    if (path.isAbsolute(storageKey)) candidates.push(storageKey);
    // Tertiary: basename only inside known subdirs
    candidates.push(path.join(uploadsDir, "statements", path.basename(storageKey)));
    candidates.push(path.join(uploadsDir, "merchant_docs", path.basename(storageKey)));
    candidates.push(path.join(uploadsDir, path.basename(storageKey)));
  }

  // Always try basename of fileName inside known locations
  candidates.push(path.join(uploadsDir, "statements", path.basename(fileName)));
  candidates.push(path.join(uploadsDir, fileName));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const result = await readFileText(candidate, path.relative(process.cwd(), candidate));
      if (result) return result;
    }
  }

  // Last resort: recursive scan of uploads/ and subdirs
  const scanDir = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        try {
          return fs.statSync(full).isDirectory() ? scanDir(full) : [full];
        } catch { return []; }
      });
    } catch { return []; }
  };

  const allFiles = scanDir(uploadsDir);
  const baseName = path.basename(fileName);
  const match = allFiles.find(
    (f) =>
      (storageKey && (f.endsWith(storageKey) || path.basename(f) === path.basename(storageKey))) ||
      path.basename(f) === baseName,
  );
  if (match) {
    const result = await readFileText(match, path.relative(process.cwd(), match));
    if (result) return result;
  }

  return null;
}

async function callOpenAIExtraction(statementText: string): Promise<Extraction | null> {
  if (process.env.SKIP_AI === "true" || process.env.TEST_MODE === "true") {
    return FIXTURE_EXTRACTION;
  }

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

  const response = await openai.chat.completions.create({
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
  const [existing] = await db
    .select({ id: statementProposals.id })
    .from(statementProposals)
    .where(eq(statementProposals.dealId, dealId))
    .limit(1);

  if (existing) {
    await db
      .update(statementProposals)
      .set({ status: "failed", notes: reason, updatedAt: new Date() })
      .where(eq(statementProposals.dealId, dealId));
  } else {
    await db.insert(statementProposals).values({
      dealId,
      status: "failed",
      notes: reason,
      plans: [],
    });
  }

  await storage.createAuditLog({
    action: "statement_analysis_failed",
    entityType: "deal",
    entityId: dealId,
    actorType: "system",
    details: { reason, timestamp: new Date().toISOString() },
  }).catch(() => {});
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

  const statementText = await extractTextFromDisk(selectedDoc.storageKey, selectedDoc.fileName);

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

  const [existing] = await db
    .select({ id: statementProposals.id })
    .from(statementProposals)
    .where(eq(statementProposals.dealId, dealId))
    .limit(1);

  if (existing) {
    await db
      .update(statementProposals)
      .set({
        effectiveRate: `${(effectiveRate * 100).toFixed(2)}%`,
        savingsEstimate: savingsNote,
        notes: analysisPayload,
        status: "analyzed",
        updatedAt: new Date(),
      })
      .where(eq(statementProposals.dealId, dealId));
    console.log(`[StatementAnalyzer] Updated statement_proposals row #${existing.id} for deal #${dealId}`);
  } else {
    const [inserted] = await db
      .insert(statementProposals)
      .values({
        dealId,
        status: "analyzed",
        effectiveRate: `${(effectiveRate * 100).toFixed(2)}%`,
        savingsEstimate: savingsNote,
        notes: analysisPayload,
        plans: [],
      })
      .returning({ id: statementProposals.id });
    console.log(`[StatementAnalyzer] Inserted new statement_proposals row #${inserted?.id} for deal #${dealId}`);
  }

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
