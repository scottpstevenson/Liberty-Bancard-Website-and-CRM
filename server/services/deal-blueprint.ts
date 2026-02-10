import { storage } from "../storage";
import type { Contact, Deal } from "@shared/schema";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

interface DealBlueprintResult {
  recommendedProgram: string;
  hardwarePackage: string;
  estMonthlyRevenue: string;
  underwritingPath: string;
  competitivePositioning: string;
  repBriefing: string;
  repOpener: string;
  likelyObjections: string[];
  keyFindings: string[];
  riskFlags: string[];
}

export async function generateDealBlueprint(dealId: number): Promise<DealBlueprintResult | null> {
  const deal = await storage.getDeal(dealId);
  if (!deal) return null;

  let contact: Contact | undefined;
  if (deal.contactId) {
    contact = await storage.getContact(deal.contactId);
  }

  if (!contact) return null;

  const prompt = `You are Liberty Bancard's senior sales strategist and deal architect. Generate a complete deal blueprint for this merchant prospect.

PROSPECT PROFILE:
- Business: ${contact.companyName || "Unknown"} (${contact.vertical || "Unknown vertical"})
- Monthly Volume: ${contact.monthlyVolume || deal.totalVolume || "Unknown"}
- Average Ticket: ${contact.avgTicket || deal.avgTicket || "Unknown"}
- Current Processor: ${contact.currentProvider || "Unknown"}
- Contract Status: ${contact.contractStatus || "Unknown"}
- Why Looking: ${contact.lookingReason || "Unknown"}
- Locations: ${contact.locationCount || 1}
- Business Age: ${contact.businessAge || "Unknown"}
- Pain Points: ${(contact.painPoints || []).join(", ") || "None identified"}
- Lead Score: ${contact.leadScore || 0}/100
- Referral Source: ${contact.referralSource || deal.leadSource || "Unknown"}
- Interest in 0% Program: ${contact.interestedIn0Percent ? "Yes" : "No"}
- Needs Terminal: ${contact.needTerminal ? "Yes" : "No"}
- Offer Path: ${contact.primaryOfferPath || deal.offerPath || "Not determined"}
- Effective Rate: ${deal.effectiveRate || "Unknown"}
- Risk Tier: ${deal.riskTier || "Unknown"}

DEAL STATUS:
- Pipeline Stage: ${deal.stage}
- Statement Received: ${deal.statementReceived ? "Yes" : "No"}
- Documents: Statement(${deal.statementReceived ? "Y" : "N"}) App(${deal.appCompleted ? "Y" : "N"}) VoidCheck(${deal.voidedCheckReceived ? "Y" : "N"}) ID(${deal.idReceived ? "Y" : "N"})

LIBERTY BANCARD PROGRAMS:
1. Interchange-Plus (wholesale): Best for $50K+ volume, transparent pricing
2. 0% Processing (Cash Discount/Surcharge): Merchant passes processing costs to cardholder
3. Flat Rate: Simple pricing for lower-volume merchants
4. Dual Pricing: Cash and card prices displayed separately
5. Tiered: Traditional qualified/mid/non-qualified (less common)

HARDWARE OPTIONS:
- Dejavoo Z11 (countertop terminal)
- Dejavoo QD series (mobile/wireless)
- Clover Flex/Mini/Station (POS system)
- PAX A920 (smart terminal)
- Virtual Terminal (online/keyed)
- Gateway integration (for e-commerce)

Generate a complete deal blueprint as JSON:
{
  "recommendedProgram": "The best pricing program for this merchant and why (1-2 sentences)",
  "hardwarePackage": "Specific hardware recommendation with justification",
  "estMonthlyRevenue": "Estimated monthly revenue to Liberty Bancard (e.g., '$350-$450/mo')",
  "underwritingPath": "standard | enhanced_review | manual_review - with brief reason",
  "competitivePositioning": "2-3 sentences on how to position against their current processor. Be specific about the competitor's weaknesses.",
  "repBriefing": "3-sentence executive summary for the rep. Include the merchant's situation, the opportunity, and the recommended approach.",
  "repOpener": "A natural, conversational opening line for the first call or meeting. Not salesy. Reference something specific about their business.",
  "likelyObjections": ["Top 3 objections they'll raise based on their current processor and situation, each with a brief counter-response"],
  "keyFindings": ["3-4 key findings about this prospect that should drive the sales strategy"],
  "riskFlags": ["Any red flags for underwriting or retention risk (empty array if none)"]
}

COMPLIANCE RULES:
- Never promise specific savings without a statement review
- No legal/tax advice
- Include "Eligibility, underwriting, card brand rules, and applicable laws apply" context where relevant
- No PCI data references`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No AI response");

    const result = JSON.parse(content) as DealBlueprintResult;

    await storage.updateDeal(dealId, {
      dealBlueprint: result,
      recommendedProgram: result.recommendedProgram,
      hardwarePackage: result.hardwarePackage,
      estMonthlyRevenue: result.estMonthlyRevenue,
      underwritingPath: result.underwritingPath,
      competitivePositioning: result.competitivePositioning,
      repBriefing: result.repBriefing,
      repOpener: result.repOpener,
      likelyObjections: result.likelyObjections,
      blueprintGeneratedAt: new Date(),
    });

    await storage.createAuditLog({
      action: "deal_blueprint_generated",
      entityType: "deal",
      entityId: dealId,
      details: {
        contactId: contact.id,
        program: result.recommendedProgram,
        estRevenue: result.estMonthlyRevenue,
      },
    });

    return result;
  } catch (err) {
    console.error("Deal blueprint generation failed:", err);
    return null;
  }
}

export type { DealBlueprintResult };
