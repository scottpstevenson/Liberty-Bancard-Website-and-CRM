import { storage } from "../storage";
import type { Deal, Contact } from "@shared/schema";
import { advanceDealStage } from "./deal-stage-service";
import { getEmailSignatureHtml } from "./email-signatures";
import OpenAI from "openai";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { logAiCall, classifyAiError, logAiCredentialError } from "./ai-audit-logger";

interface ProposalPlan {
  name: string;
  shortName: string;
  headline: string;
  effectiveRate: string;
  monthlyFees: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  howItWorks: string;
  pros: string[];
  cons: string[];
  bestFor: string;
  libertyMarginBps?: number;
  libertyMonthlyRevenue?: number;
}

interface ProposalPayload {
  merchantName: string;
  generatedAt: string;
  currentState: {
    monthlyVolume: number;
    effectiveRate: string;
    monthlyFees: number;
    annualFees: number;
    avgTicket: number;
    topIssues: string[];
  };
  plans: ProposalPlan[];
  recommendedPlan: string;
  recommendedReason: string;
  recommendedTerminal: string;
  urgencyCtas: string[];
  complianceDisclaimer: string;
  feeBreakdown?: {
    currentInterchange: string;
    currentMarkup: string;
    currentMonthlyFees: string;
    currentPciFees: string;
    hiddenFees: string[];
  };
}

interface DealBlueprint {
  repOpener?: string;
  likelyObjections?: string[];
}

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

function generateProposalToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

async function extractStatementText(dealId: number, fileBuffer?: Buffer): Promise<string | null> {
  try {
    if (fileBuffer) {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(fileBuffer), verbosity: 0 });
        const textResult = await parser.getText();
        const text = textResult?.text || "";
        if (text.trim().length > 50) {
          console.log(`[ProposalEngine] Extracted ${text.length} chars from uploaded PDF buffer`);
          return text.trim();
        }
      } catch (pdfErr) {
        console.error("[ProposalEngine] PDF buffer parse failed:", pdfErr);
      }
    }

    const documents = await storage.getDocuments();
    const statementDocs = documents.filter(
      (d) => d.dealId === dealId && d.type === "merchant_statement"
    );

    if (statementDocs.length === 0) return null;

    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) return null;

    const allFiles = fs.readdirSync(uploadsDir);

    for (const doc of statementDocs) {
      const matchingFile = allFiles.find(
        (f) => doc.storageKey?.includes(f) || f.includes(doc.fileName)
      );
      if (!matchingFile) continue;

      const filePath = path.join(uploadsDir, matchingFile);
      const ext = path.extname(matchingFile).toLowerCase();

      if (ext === ".pdf") {
        try {
          const { PDFParse } = await import("pdf-parse");
          const buffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
          const textResult = await parser.getText();
          const text = textResult?.text || "";
          if (text.trim().length > 50) {
            console.log(`[ProposalEngine] Extracted ${text.length} chars from ${matchingFile}`);
            return text.trim();
          }
        } catch (pdfErr) {
          console.error(`[ProposalEngine] PDF parse failed for ${matchingFile}:`, pdfErr);
        }
      } else if ([".txt", ".csv"].includes(ext)) {
        const text = fs.readFileSync(filePath, "utf-8");
        if (text.trim().length > 50) {
          console.log(`[ProposalEngine] Read ${text.length} chars from ${matchingFile}`);
          return text.trim();
        }
      }
    }

    return null;
  } catch (err) {
    console.error("[ProposalEngine] Text extraction failed:", err);
    return null;
  }
}

async function analyzeStatementData(deal: Deal, contact: Contact | null | undefined, statementText: string | null): Promise<{
  effectiveRate: string;
  monthlyVolume: string;
  recommendedPath: string;
  keyFindings: string[];
  riskFlags: string[];
  currentFees: Record<string, string>;
  verticalInsights?: {
    industryAvgRate: string;
    industryAvgTicket: string;
    verticalBenchmark: string;
    opportunityScore: number;
  };
} | null> {
  try {
    const contextLines = [
      `Business: ${contact?.companyName || "Unknown"}`,
      `Industry: ${contact?.vertical || "Unknown"}`,
      `Monthly Volume: ${deal.totalVolume || contact?.monthlyVolume || "Unknown"}`,
      `Current Effective Rate: ${deal.effectiveRate || "Unknown"}`,
      `Average Ticket: ${deal.avgTicket || contact?.avgTicket || "Unknown"}`,
      `Current Provider: ${contact?.currentProvider || "Unknown"}`,
      `Total Fees: ${deal.totalFees || "Unknown"}`,
      `Interest in 0% Program: ${contact?.interestedIn0Percent ? "Yes" : "No"}`,
      `Pain Points: ${(contact?.painPoints || []).join(", ") || "None specified"}`,
      `Notes: ${deal.notes || "None"}`,
    ];

    if (statementText) {
      const truncated = statementText.length > 6000 ? statementText.substring(0, 6000) + "\n[...truncated]" : statementText;
      contextLines.push("", "--- RAW STATEMENT TEXT (extracted from uploaded PDF) ---", truncated, "--- END STATEMENT TEXT ---");
    }

    const statementContext = contextLines.join("\n");

    const openai = getOpenAI();
    const stmtEngineMessages = [
      {
        role: "system" as const,
        content: `You are Liberty Bancard's AI Statement Analyst. Analyze merchant processing statement data and provide a detailed fee analysis.
When raw statement text is provided, parse it carefully to extract:
- Monthly processing volume and transaction counts
- Interchange fees, assessment fees, processor markup
- Monthly service fees, PCI compliance fees, statement fees
- Equipment/terminal fees, batch fees, gateway fees
- Effective rate (total fees / total volume)
- Current processor name and rate structure (tiered, interchange-plus, flat rate)

RULES:
- When raw statement text is available, extract actual values from it rather than estimating
- Never promise specific savings without full statement review
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Be specific about fee types and rates found
- Recommend the best offer path based on the data
- If no raw statement text and data is sparse, estimate based on industry averages for the vertical

Return JSON with:
- effectiveRate: estimated effective rate as percentage string (e.g. "3.2%")
- monthlyVolume: estimated monthly volume as string (e.g. "$45,000")
- currentFees: object with fee breakdowns { interchange: string, markup: string, monthlyFees: string, pciFees: string, otherFees: string }
- recommendedPath: one of ["Cash Discount", "Dual Pricing", "Tiered Reduction", "Interchange Plus"]
- keyFindings: array of 3-5 specific findings about their current processing
- riskFlags: array of any concerning items (high rates, non-compliant fees, etc.)
- verticalInsights: object with { industryAvgRate: string, industryAvgTicket: string, verticalBenchmark: string, opportunityScore: number (1-100) }
- nextSteps: array of recommended next steps
- overallAssessment: 2-3 sentence summary`,
      },
      { role: "user" as const, content: `Statement Data:\n${statementContext}` },
    ];
    const { completion } = await logAiCall(
      { triggerType: "statement-analysis", actorType: "system", rawPrompt: JSON.stringify(stmtEngineMessages) },
      () => openai.chat.completions.create({
        model: "gpt-5",
        messages: stmtEngineMessages,
        max_completion_tokens: 10000,
        response_format: { type: "json_object" },
      }));

    const raw = completion.choices[0]?.message?.content || "";
    const analysis = JSON.parse(raw);

    await storage.updateDeal(deal.id, {
      effectiveRate: analysis.effectiveRate || deal.effectiveRate,
      recommendedPath: analysis.recommendedPath || deal.recommendedPath,
      topCostDrivers: analysis.keyFindings || deal.topCostDrivers,
    });

    await storage.createAuditLog({
      action: "statement_auto_analyzed",
      entityType: "deal",
      entityId: deal.id,
      details: {
        effectiveRate: analysis.effectiveRate,
        recommendedPath: analysis.recommendedPath,
        keyFindings: analysis.keyFindings,
      },
    });

    console.log(`[ProposalEngine] Statement analyzed for deal ${deal.id}: rate=${analysis.effectiveRate}, path=${analysis.recommendedPath}`);
    return analysis;
  } catch (err) {
    console.error("[ProposalEngine] Statement analysis failed:", err);
    const info = classifyAiError(err);
    if (info.kind === "credential" || info.kind === "quota") {
      await logAiCredentialError({
        triggerType: "statement-analysis",
        actorType: "system",
        error: (err as any)?.message ?? String(err),
      });
    }
    return null;
  }
}

export async function autoGenerateProposal(dealId: number, fileBuffer?: Buffer): Promise<void> {
  try {
    console.log(`[ProposalEngine] Starting auto-proposal for deal ${dealId}`);

    const deal = await storage.getDeal(dealId);
    if (!deal) {
      console.error(`[ProposalEngine] Deal ${dealId} not found`);
      return;
    }

    if (deal.savingsProposal) {
      console.log(`[ProposalEngine] Deal ${dealId} already has a proposal`);
      return;
    }

    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;

    const statementText = await extractStatementText(dealId, fileBuffer);
    if (statementText) {
      console.log(`[ProposalEngine] Statement text available (${statementText.length} chars) for deal ${dealId}`);
    } else {
      console.log(`[ProposalEngine] No statement text extracted for deal ${dealId}, using deal/contact fields only`);
    }

    const analysis = await analyzeStatementData(deal, contact, statementText);

    const refreshedDeal = await storage.getDeal(dealId);
    const latestDeal = refreshedDeal || deal;

    const volume = parseFloat(
      (analysis?.monthlyVolume || latestDeal.totalVolume || contact?.monthlyVolume || "0").toString().replace(/[^0-9.]/g, "")
    );
    const effectiveRate = parseFloat(
      (analysis?.effectiveRate || latestDeal.effectiveRate || "3.0").toString().replace(/[^0-9.]/g, "")
    );
    const avgTicket = parseFloat(
      (latestDeal.avgTicket || contact?.avgTicket || "50").toString().replace(/[^0-9.]/g, "")
    );
    const currentMonthlyFees = volume * (effectiveRate / 100);

    const openai = getOpenAI();

    const propEngineMessages = [
      {
        role: "system" as const,
        content: `You are Liberty Bancard's AI Pricing Strategist. Generate a competitive savings proposal for a merchant.

BUSINESS CONTEXT:
- Liberty Bancard is a merchant payment processor offering better rates
- Goal: Show the merchant EXACTLY where they save and how much per year
- Pricing should be 20-30% lower than their current processing fees
- Liberty Bancard still needs healthy margin (target 15-25 basis points net profit on volume)
- Generate THREE pricing plans

PLAN TYPES:
1. "Cash Discount / Compliant Surcharging" - Merchant effectively pays 0% processing. Customer pays a small service fee at point of sale.
2. "Interchange Plus" - Transparent pricing: interchange cost + small fixed markup.
3. "Flat Rate" - Simple flat percentage for all card types. Good for lower-volume merchants.

RULES:
- All savings must be realistic and mathematically sound
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."
- Be specific with dollar amounts
- Include strong urgency CTAs

Return valid JSON with this structure:
{
  "merchantName": "string",
  "currentState": {
    "monthlyVolume": number,
    "effectiveRate": "string (e.g. 3.2%)",
    "monthlyFees": number,
    "annualFees": number,
    "avgTicket": number,
    "topIssues": ["string array of 3-5 specific fee problems found"]
  },
  "plans": [
    {
      "name": "Cash Discount / Compliant Surcharging",
      "shortName": "cashDiscount",
      "headline": "string - compelling one-liner",
      "effectiveRate": "string (e.g. 0.00%)",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string - 2-3 sentence explanation",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Interchange Plus",
      "shortName": "interchangePlus",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Flat Rate",
      "shortName": "flatRate",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    }
  ],
  "recommendedPlan": "shortName of best plan",
  "recommendedReason": "string - why this plan is best",
  "recommendedTerminal": "string - specific terminal recommendation with reason",
  "urgencyCtas": ["3 strong CTA messages"],
  "complianceDisclaimer": "string",
  "feeBreakdown": {
    "currentInterchange": "string estimate",
    "currentMarkup": "string estimate",
    "currentMonthlyFees": "string estimate",
    "currentPciFees": "string estimate",
    "hiddenFees": ["string array of fees they're overpaying"]
  }
}`,
      },
      {
        role: "user" as const,
        content: `Generate a savings proposal for this merchant:
Merchant: ${contact?.companyName || (contact ? `${contact.firstName} ${contact.lastName}` : "Unknown Business")}
Industry: ${contact?.vertical || "General Retail"}
Monthly Volume: $${volume.toLocaleString()}
Current Effective Rate: ${effectiveRate}%
Current Monthly Fees: $${currentMonthlyFees.toFixed(2)}
Average Ticket: $${avgTicket.toFixed(2)}
Current Provider: ${contact?.currentProvider || "Unknown"}
Interest in 0% Program: ${contact?.interestedIn0Percent ? "Yes" : "No"}
Needs Terminal: ${contact?.needTerminal ? "Yes" : "No"}
Notes: ${latestDeal.notes || "None"}
${analysis ? `
STATEMENT ANALYSIS RESULTS (use these findings):
- Analyzed Effective Rate: ${analysis.effectiveRate}
- Analyzed Monthly Volume: ${analysis.monthlyVolume}
- Recommended Path: ${analysis.recommendedPath}
- Key Findings: ${analysis.keyFindings?.join("; ") || "None"}
- Risk Flags: ${analysis.riskFlags?.join("; ") || "None"}
- Fee Breakdown: ${JSON.stringify(analysis.currentFees || {})}
` : ""}`,
      },
    ];
    const { completion } = await logAiCall(
      { triggerType: "proposal", actorType: "system", rawPrompt: JSON.stringify(propEngineMessages) },
      () => openai.chat.completions.create({
        model: "gpt-5",
        messages: propEngineMessages,
        max_completion_tokens: 8000,
        response_format: { type: "json_object" },
      }));

    const raw = completion.choices[0]?.message?.content || "";
    let proposal: any;
    try {
      proposal = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[ProposalEngine] Failed to parse AI response");
        return;
      }
      proposal = JSON.parse(jsonMatch[0]);
    }

    if (!proposal.plans || !Array.isArray(proposal.plans) || proposal.plans.length === 0) {
      console.error("[ProposalEngine] Proposal missing plan data");
      return;
    }

    for (const plan of proposal.plans) {
      plan.monthlySavings = typeof plan.monthlySavings === "number" ? plan.monthlySavings : 0;
      plan.annualSavings = typeof plan.annualSavings === "number" ? plan.annualSavings : plan.monthlySavings * 12;
      plan.savingsPercent = typeof plan.savingsPercent === "number" ? plan.savingsPercent : 0;
      plan.libertyMarginBps = typeof plan.libertyMarginBps === "number" ? plan.libertyMarginBps : 0;
      plan.libertyMonthlyRevenue = typeof plan.libertyMonthlyRevenue === "number" ? plan.libertyMonthlyRevenue : 0;
    }

    if (!proposal.currentState) {
      proposal.currentState = {
        monthlyVolume: volume,
        effectiveRate: `${effectiveRate}%`,
        monthlyFees: currentMonthlyFees,
        annualFees: currentMonthlyFees * 12,
        avgTicket,
        topIssues: [],
      };
    }

    proposal.generatedAt = new Date().toISOString();
    proposal.dealId = deal.id;
    proposal.verticalInsights = analysis?.verticalInsights;

    const token = generateProposalToken();
    const bestPlan = proposal.plans.find((p: any) => p.shortName === proposal.recommendedPlan) || proposal.plans[0];

    await storage.updateDeal(deal.id, {
      savingsProposal: proposal,
      proposalGeneratedAt: new Date(),
      proposalToken: token,
      proposalStatus: "generated",
      recommendedPath: bestPlan?.name || deal.recommendedPath,
      effectiveRate: deal.effectiveRate || `${effectiveRate}%`,
      totalVolume: deal.totalVolume || `$${volume.toLocaleString()}`,
      totalFees: deal.totalFees || `$${currentMonthlyFees.toFixed(2)}`,
      avgTicket: deal.avgTicket || `$${avgTicket.toFixed(2)}`,
      estimatedGrossProfitBps: bestPlan?.libertyMarginBps || deal.estimatedGrossProfitBps,
      estimatedGrossProfitMonthly: bestPlan?.libertyMonthlyRevenue
        ? `$${bestPlan.libertyMonthlyRevenue.toFixed(2)}`
        : deal.estimatedGrossProfitMonthly,
      lastStatementReviewDate: new Date(),
    });

    import("./analytics-events").then(({ recordAnalyticsEvent }) => {
      recordAnalyticsEvent({
        eventName: "proposal_generated",
        contactId: deal.contactId ?? undefined,
        dealId: deal.id,
        dealStage: deal.stage ?? undefined,
        vertical: deal.vertical ?? undefined,
        metadata: { recommendedPlan: proposal.recommendedPlan, planCount: proposal.plans?.length },
      });
    }).catch(() => {});

    await storage.createAuditLog({
      action: "proposal_auto_generated",
      entityType: "deal",
      entityId: deal.id,
      details: {
        contactId: deal.contactId,
        recommendedPlan: proposal.recommendedPlan,
        annualSavings: bestPlan?.annualSavings,
        token,
      },
    });

    console.log(`[ProposalEngine] Proposal generated for deal ${dealId}, token: ${token}`);

    const settings = await storage.getSystemSetting("proposal_auto_send");
    const autoSend = settings?.enabled === true;

    if (autoSend) {
      await sendProposalEmail(dealId);
      await notifyRepWithBriefing(dealId);
    } else {
      await storage.updateDeal(deal.id, { proposalStatus: "pending_review" });
      await storage.createNotification({
        channel: "internal",
        title: "Proposal Ready for Review",
        message: `Savings proposal generated for ${contact?.companyName || contact?.firstName || "Unknown"} — waiting for rep approval before sending.`,
        type: "alert",
        metadata: { dealId: deal.id, contactId: deal.contactId },
      });
      if (contact?.ghlContactId) {
        const ownerLookup = deal.owner ? await (storage as any).getUserByEmail(deal.owner).catch(() => null) : null;
        const assignedTo = ownerLookup?.id ?? null;
        const { createGhlTask: ghlTask } = await import("./ghl");
        ghlTask({
          contactId: contact.ghlContactId,
          title: `Proposal Ready — Review & Send: ${contact.companyName || contact.firstName || "New Lead"}`,
          description: `AI-generated savings proposal is ready for your review before sending. Open the deal to approve and send.`,
          assignedTo,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }).catch(err => console.warn("[ProposalEngine] GHL task (review-needed, non-critical):", err.message));
      }
    }
  } catch (err) {
    console.error("[ProposalEngine] Auto-proposal failed:", err);
    const info = classifyAiError(err);
    if (info.kind === "credential" || info.kind === "quota") {
      await logAiCredentialError({
        triggerType: "proposal",
        actorType: "system",
        error: (err as any)?.message ?? String(err),
      });
      // Notify admins so they can action the credential issue
      storage.createNotification({
        channel: "internal",
        title: "⚠ AI Subsystem Unavailable",
        message: info.userMessage,
        type: "warning",
        metadata: { dealId, errorKind: info.kind },
      }).catch(() => {});
      // Fall back to the template proposal path — store null so the rep knows to
      // manually review rather than silently lose the deal.
      await storage.createAuditLog({
        action: "proposal_auto_generation_failed",
        entityType: "deal",
        entityId: dealId,
        details: { error: (err as Error).message, reason: info.kind, fallback: "template_required" },
      });
    } else {
      await storage.createAuditLog({
        action: "proposal_auto_generation_failed",
        entityType: "deal",
        entityId: dealId,
        details: { error: (err as Error).message },
      });
    }
  }
}

export async function sendProposalEmail(dealId: number): Promise<boolean> {
  try {
    const deal = await storage.getDeal(dealId);
    if (!deal || !deal.savingsProposal || !deal.proposalToken) {
      console.error(`[ProposalEngine] Cannot send email - no proposal for deal ${dealId}`);
      return false;
    }

    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
    if (!contact?.email) {
      console.error(`[ProposalEngine] No email for contact on deal ${dealId}`);
      return false;
    }

    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      try {
        const { upsertGhlContact, isGhlConfigured: ghlOk } = await import("./ghl");
        if (ghlOk()) {
          ghlContactId = await upsertGhlContact({
            firstName: contact.firstName || "",
            lastName: contact.lastName || "",
            email: contact.email,
          } as any);
          if (ghlContactId) {
            await storage.updateContact(contact.id, { ghlContactId });
            console.log(`[ProposalEngine] GHL contact upserted for contact #${contact.id}`);
          }
        }
      } catch (upsertErr: any) {
        console.warn("[ProposalEngine] GHL contact upsert failed (non-critical):", upsertErr.message);
      }
    }

    const proposal = deal.savingsProposal as ProposalPayload;
    const bestPlan = proposal.plans?.find((p) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];
    const baseUrl = process.env.APP_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null)
      || "https://libertybancard.com";
    const proposalUrl = `${baseUrl}/proposal/${deal.proposalToken}`;

    const subject = `Your Savings Breakdown is Ready — ${contact.companyName || contact.firstName}`;

    const body = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<div style="background: #0f172a; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
  <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Liberty Bancard</h1>
  <p style="color: #94a3b8; margin: 8px 0 0;">Your Processing Statement Review</p>
</div>

<div style="padding: 30px; background: #ffffff; border: 1px solid #e2e8f0;">
  <p style="font-size: 16px; color: #1e293b;">Hi ${contact.firstName || "there"},</p>

  <p style="font-size: 15px; color: #475569; line-height: 1.6;">
    We've completed a detailed analysis of your processing statement. Here's what we found:
  </p>

  <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <p style="font-size: 14px; color: #991b1b; margin: 0; font-weight: 600;">Current Effective Rate: ${proposal.currentState?.effectiveRate || "N/A"}</p>
    <p style="font-size: 14px; color: #991b1b; margin: 4px 0 0;">Monthly Processing Fees: $${proposal.currentState?.monthlyFees?.toLocaleString() || "N/A"}</p>
  </div>

  ${bestPlan ? `
  <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <p style="font-size: 14px; color: #166534; margin: 0; font-weight: 600;">
      With ${bestPlan.name}: Save up to $${bestPlan.annualSavings?.toLocaleString() || "0"}/year
    </p>
    <p style="font-size: 14px; color: #166534; margin: 4px 0 0;">
      New Effective Rate: ${bestPlan.effectiveRate || "N/A"} (${bestPlan.savingsPercent || 0}% lower)
    </p>
  </div>
  ` : ""}

  <div style="text-align: center; margin: 30px 0;">
    <a href="${proposalUrl}" style="display: inline-block; background: #0ea5e9; color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 6px;">
      View Your Full Savings Breakdown
    </a>
  </div>

  <p style="font-size: 14px; color: #64748b; line-height: 1.5;">
    We've prepared ${proposal.plans?.length || 3} different pricing options for you to compare side-by-side. 
    Your personalized proposal includes detailed fee analysis, projected savings, and terminal recommendations.
  </p>

  <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 16px;">
    <p style="font-size: 14px; color: #475569; margin: 0;">
      <strong>Ready to discuss?</strong> Schedule a 10-minute walkthrough call:
    </p>
    <p style="font-size: 14px; color: #475569; margin: 4px 0;">
      📞 <a href="tel:9542668214" style="color: #0ea5e9;">954-266-8214</a> | 
      📧 <a href="mailto:accounts@libertybancard.com" style="color: #0ea5e9;">accounts@libertybancard.com</a>
    </p>
  </div>
</div>

<div style="padding: 16px 30px; background: #f8fafc; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
  <p style="font-size: 11px; color: #94a3b8; margin: 0; line-height: 1.5;">
    ${proposal.complianceDisclaimer || "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."}
  </p>
</div>
${getEmailSignatureHtml("accounts")}
</div>`;

    const { sendGhlEmail, sendGhlEmailForMerchant, isGhlConfigured } = await import("./ghl");

    let emailSent = false;
    let emailChannel = "none";
    if (isGhlConfigured()) {
      // GHL-Direct: contact ID-based send (upserts GHL contact internally)
      try {
        const ghlDirectResult = await sendGhlEmail({
          contactId: contact.id,
          dealId,
          subject,
          body,
          fromEmail: "accounts@libertybancard.com",
          fromName: "Your Liberty Bancard Account Team",
        });
        if (ghlDirectResult.success) {
          emailSent = true;
          emailChannel = "GHL-Direct";
        } else {
          console.warn(`[ProposalEngine] GHL-Direct returned failure for deal ${dealId}: ${ghlDirectResult.error}`);
        }
      } catch (sendErr) {
        console.error("[ProposalEngine] GHL-Direct email error:", sendErr);
      }

      // GHL-Workflow: by-email fallback when direct fails
      if (!emailSent) {
        try {
          const ghlResult = await sendGhlEmailForMerchant({
            email: contact.email,
            subject,
            body,
            contactId: contact.id,
          });
          if (ghlResult.success) {
            emailSent = true;
            emailChannel = "GHL-Workflow";
          } else {
            console.warn(`[ProposalEngine] GHL-Workflow returned failure for deal ${dealId}: ${ghlResult.error}`);
          }
        } catch (sendErr) {
          console.error("[ProposalEngine] GHL-Workflow email error:", sendErr);
        }
      }
    }

    if (!emailSent) {
      const { isSmtpConfigured, sendSmtpEmail } = await import("./smtp-email");
      if (isSmtpConfigured()) {
        try {
          const smtpResult = await sendSmtpEmail({ to: contact.email, subject, html: body, category: "accounts", contactId: contact.id });
          if (smtpResult.success) {
            emailSent = true;
            emailChannel = "SMTP-Fallback";
            console.log(`[ProposalEngine] Proposal email sent via SMTP-Fallback for deal ${dealId}`);
          } else {
            console.warn(`[ProposalEngine] SMTP-Fallback failed for deal ${dealId}: ${smtpResult.error}`);
          }
        } catch (smtpErr: any) {
          console.error(`[ProposalEngine] SMTP-Fallback threw for deal ${dealId}:`, smtpErr.message);
        }
      } else {
        console.warn(
          `[ProposalEngine] Neither GHL nor SMTP is configured — proposal email NOT delivered for deal ${dealId}. ` +
          "Set GHL credentials or SMTP_HOST/SMTP_USER/SMTP_PASS to enable email delivery.",
        );
      }
    }

    if (!emailSent) {
      await storage.updateDeal(deal.id, { proposalStatus: "generated" });
      return false;
    }

    await storage.updateDeal(deal.id, {
      proposalEmailSentAt: new Date(),
      proposalStatus: "sent",
    });
    if (deal.stage === "Statement Received") {
      await advanceDealStage(deal.id, "Proposal Sent", "proposal_engine_email_sent");
    }

    // #1397 — record to canonical communication_events table
    if (contact.id) {
      const { recordOutboundSend } = await import("./communication-events");
      recordOutboundSend({
        contactId: contact.id,
        dealId: deal.id,
        channel: "email",
        provider: emailChannel.startsWith("GHL") ? "ghl" : "smtp",
        subject,
        status: "sent",
        metadata: { proposalEngine: "initial_send", emailChannel, dealId: deal.id },
      }).catch(err => console.warn("[ProposalEngine] recordOutboundSend failed:", err.message));
    }

    await storage.createAuditLog({
      action: "proposal_email_sent",
      entityType: "deal",
      entityId: deal.id,
      details: {
        email: contact.email,
        proposalUrl,
        channel: emailChannel,
      },
    });

    console.log(`[ProposalEngine] Proposal email sent to ${contact.email} for deal ${dealId}`);
    return true;
  } catch (err) {
    console.error("[ProposalEngine] Email send failed:", err);
    return false;
  }
}

/**
 * Sends a follow-up email for a proposal that hasn't been opened.
 * Uses a different subject line per attempt number to avoid looking like duplicates.
 * Updates proposalEmailSentAt so the re-send window resets correctly.
 * Does NOT update proposalStatus — the calling worker handles that.
 */
export async function sendProposalFollowUpEmail(dealId: number, attemptNumber: number): Promise<boolean> {
  try {
    const deal = await storage.getDeal(dealId);
    if (!deal || !deal.savingsProposal || !deal.proposalToken) {
      console.error(`[ProposalEngine] Cannot send follow-up — no proposal for deal ${dealId}`);
      return false;
    }

    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
    if (!contact?.email) {
      console.error(`[ProposalEngine] No email for contact on deal ${dealId}`);
      return false;
    }

    const proposal = deal.savingsProposal as ProposalPayload;
    const bestPlan = proposal.plans?.find((p) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];
    const baseUrl = process.env.APP_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null)
      || "https://libertybancard.com";
    const proposalUrl = `${baseUrl}/proposal/${deal.proposalToken}`;
    const recipientName = contact.companyName || contact.firstName || "there";

    const subjects: Record<number, string> = {
      1: `Quick check-in: Have you seen your savings breakdown? — ${recipientName}`,
      2: `Last chance to review your savings analysis — ${recipientName}`,
    };
    const subject = subjects[attemptNumber] ?? `Following up on your savings proposal — ${recipientName}`;

    const body = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<div style="background: #0f172a; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
  <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Liberty Bancard</h1>
  <p style="color: #94a3b8; margin: 8px 0 0;">Your Processing Statement Review</p>
</div>

<div style="padding: 30px; background: #ffffff; border: 1px solid #e2e8f0;">
  <p style="font-size: 16px; color: #1e293b;">Hi ${contact.firstName || "there"},</p>

  <p style="font-size: 15px; color: #475569; line-height: 1.6;">
    ${attemptNumber === 2
      ? "We wanted to reach out one final time — your personalized savings breakdown is ready and waiting for you."
      : "We noticed you haven't had a chance to review your personalized savings breakdown yet. We wanted to make sure it didn't get buried in your inbox."}
  </p>

  ${bestPlan ? `
  <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <p style="font-size: 14px; color: #166534; margin: 0; font-weight: 600;">
      Your analysis shows up to $${bestPlan.annualSavings?.toLocaleString() || "0"}/year in potential savings
    </p>
    <p style="font-size: 14px; color: #166534; margin: 4px 0 0;">
      New Effective Rate: ${bestPlan.effectiveRate || "N/A"} (${bestPlan.savingsPercent || 0}% lower)
    </p>
  </div>
  ` : ""}

  <div style="text-align: center; margin: 30px 0;">
    <a href="${proposalUrl}" style="display: inline-block; background: #0ea5e9; color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 6px;">
      View Your Savings Breakdown
    </a>
  </div>

  <p style="font-size: 14px; color: #64748b; line-height: 1.5;">
    Your proposal includes ${proposal.plans?.length || 3} different pricing options, a full fee analysis, and projected savings based on your actual statement data.
  </p>

  <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 16px;">
    <p style="font-size: 14px; color: #475569; margin: 0;">
      <strong>Questions?</strong> We're happy to walk you through it:
    </p>
    <p style="font-size: 14px; color: #475569; margin: 4px 0;">
      📞 <a href="tel:9542668214" style="color: #0ea5e9;">954-266-8214</a> | 
      📧 <a href="mailto:accounts@libertybancard.com" style="color: #0ea5e9;">accounts@libertybancard.com</a>
    </p>
  </div>
</div>

<div style="padding: 16px 30px; background: #f8fafc; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
  <p style="font-size: 11px; color: #94a3b8; margin: 0; line-height: 1.5;">
    ${proposal.complianceDisclaimer || "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."}
  </p>
</div>
${getEmailSignatureHtml("accounts")}
</div>`;

    const { sendGhlEmail, sendGhlEmailForMerchant, isGhlConfigured } = await import("./ghl");

    let emailSent = false;
    let emailChannel = "none";
    if (isGhlConfigured()) {
      try {
        const ghlDirectResult = await sendGhlEmail({
          contactId: contact.id,
          dealId,
          subject,
          body,
          fromEmail: "accounts@libertybancard.com",
          fromName: "Your Liberty Bancard Account Team",
        });
        if (ghlDirectResult.success) {
          emailSent = true;
          emailChannel = "GHL-Direct";
        }
      } catch (sendErr) {
        console.error("[ProposalEngine] GHL-Direct follow-up email error:", sendErr);
      }

      if (!emailSent) {
        try {
          const ghlResult = await sendGhlEmailForMerchant({ email: contact.email, subject, body, contactId: contact.id });
          if (ghlResult.success) {
            emailSent = true;
            emailChannel = "GHL-Workflow";
          }
        } catch (sendErr) {
          console.error("[ProposalEngine] GHL-Workflow follow-up email error:", sendErr);
        }
      }
    }

    if (!emailSent) {
      const { isSmtpConfigured, sendSmtpEmail } = await import("./smtp-email");
      if (isSmtpConfigured()) {
        try {
          const smtpResult = await sendSmtpEmail({ to: contact.email, subject, html: body, category: "accounts", contactId: contact.id });
          if (smtpResult.success) {
            emailSent = true;
            emailChannel = "SMTP-Fallback";
          } else {
            console.warn(`[ProposalEngine] SMTP follow-up failed for deal ${dealId}: ${smtpResult.error}`);
          }
        } catch (smtpErr: any) {
          console.error(`[ProposalEngine] SMTP follow-up threw for deal ${dealId}:`, smtpErr.message);
        }
      }
    }

    if (!emailSent) {
      console.warn(
        `[ProposalEngine] Neither GHL nor SMTP is configured — follow-up email NOT delivered for deal ${dealId}.`,
      );
      return false;
    }

    // Reset the sent-at timestamp so the resend window is measured from this follow-up.
    await storage.updateDeal(deal.id, { proposalEmailSentAt: new Date() });

    // #1397 — record to canonical communication_events table
    if (contact.id) {
      const { recordOutboundSend } = await import("./communication-events");
      recordOutboundSend({
        contactId: contact.id,
        dealId,
        channel: "email",
        provider: emailChannel.startsWith("GHL") ? "ghl" : "smtp",
        subject,
        status: "sent",
        metadata: { proposalEngine: "followup", attempt: attemptNumber, emailChannel, dealId },
      }).catch(err => console.warn("[ProposalEngine] recordOutboundSend (followup) failed:", err.message));
    }

    console.log(
      `[ProposalEngine] Follow-up email (attempt ${attemptNumber}) sent to ${contact.email} for deal ${dealId} via ${emailChannel}`,
    );
    return true;
  } catch (err) {
    console.error("[ProposalEngine] Follow-up email send failed:", err);
    return false;
  }
}

export async function notifyRepWithBriefing(dealId: number): Promise<void> {
  try {
    const deal = await storage.getDeal(dealId);
    if (!deal) return;

    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
    const proposal = deal.savingsProposal as ProposalPayload;
    if (!proposal) return;

    const bestPlan = proposal.plans?.find((p) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];
    const proposalUrl = `/proposal/${deal.proposalToken}`;

    const blueprint = deal.dealBlueprint as DealBlueprint | null;

    const briefingLines = [
      `**New Proposal Ready: ${contact?.companyName || contact?.firstName || "Unknown"}**`,
      ``,
      `📊 **Key Numbers:**`,
      `• Monthly Volume: $${proposal.currentState?.monthlyVolume?.toLocaleString() || "N/A"}`,
      `• Current Rate: ${proposal.currentState?.effectiveRate || "N/A"}`,
      `• Recommended Plan: ${bestPlan?.name || "N/A"}`,
      `• Projected Annual Savings: $${bestPlan?.annualSavings?.toLocaleString() || "0"}`,
      `• Liberty Monthly Revenue: $${bestPlan?.libertyMonthlyRevenue?.toLocaleString() || "0"}`,
      ``,
    ];

    if (blueprint?.repOpener) {
      briefingLines.push(`💬 **Recommended Opener:**`);
      briefingLines.push(`"${blueprint.repOpener}"`);
      briefingLines.push(``);
    }

    if (deal.likelyObjections && deal.likelyObjections.length > 0) {
      briefingLines.push(`⚠️ **Likely Objections:**`);
      deal.likelyObjections.forEach((obj, i) => {
        briefingLines.push(`${i + 1}. ${obj}`);
      });
      briefingLines.push(``);
    } else if (blueprint && blueprint.likelyObjections && blueprint.likelyObjections.length > 0) {
      briefingLines.push(`⚠️ **Likely Objections:**`);
      blueprint.likelyObjections.forEach((obj: string, i: number) => {
        briefingLines.push(`${i + 1}. ${obj}`);
      });
      briefingLines.push(``);
    }

    if (proposal.recommendedTerminal) {
      briefingLines.push(`🖥️ **Terminal:** ${proposal.recommendedTerminal}`);
      briefingLines.push(``);
    }

    briefingLines.push(`🔗 Proposal Link: ${proposalUrl}`);

    await storage.createNotification({
      channel: "internal",
      title: `Proposal Ready: ${contact?.companyName || contact?.firstName || "Deal #" + dealId}`,
      message: briefingLines.join("\n"),
      type: "alert",
      metadata: {
        dealId: deal.id,
        contactId: deal.contactId,
        proposalToken: deal.proposalToken,
        annualSavings: bestPlan?.annualSavings,
      },
    });

    if (deal.owner) {
      await storage.createTask({
        dealId: deal.id,
        contactId: deal.contactId || undefined,
        title: `Follow up on proposal — ${contact?.companyName || contact?.firstName || "Unknown"}`,
        assignedTo: deal.owner,
        dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
        priority: "high",
        description: `Savings proposal auto-sent. Annual savings: $${bestPlan?.annualSavings?.toLocaleString() || "N/A"}. Recommended plan: ${bestPlan?.name || "N/A"}.`,
      });

      if (contact?.ghlContactId) {
        const { createGhlTask: ghlTask } = await import("./ghl");
        ghlTask({
          contactId: contact.ghlContactId,
          title: `Follow up on proposal — ${contact?.companyName || contact?.firstName || "Unknown"}`,
          description: `Proposal sent. Projected annual savings: $${bestPlan?.annualSavings?.toLocaleString() || "N/A"}. Plan: ${bestPlan?.name || "N/A"}.`,
          taskType: "FOLLOW_UP",
          assignedTo: deal.owner || undefined,
          dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
        }).catch(err => console.warn("[ProposalEngine] createGhlTask (non-critical):", err.message));
      }
    }

    console.log(`[ProposalEngine] Rep notified for deal ${dealId}`);
  } catch (err) {
    console.error("[ProposalEngine] Rep notification failed:", err);
  }
}
