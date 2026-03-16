import type { SdrLeadState } from "@shared/schema";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

export interface ScoreResult {
  score: number;
  factors: Record<string, number>;
}

export interface FullScoreResult {
  fitScore: number;
  revenueScore: number;
  reachabilityScore: number;
  priorityScore: number;
  priorityBucket: "A" | "B" | "C" | "nurture";
  breakdown: {
    fit: ScoreResult;
    revenue: ScoreResult;
    reachability: ScoreResult;
  };
}

const VERTICAL_FIT: Record<string, number> = {
  "Restaurant": 25,
  "Food/Beverage": 22,
  "Retail": 20,
  "Salon/Spa": 22,
  "Healthcare": 24,
  "Medical/Dental/Medspa": 24,
  "Auto": 18,
  "Automotive": 18,
  "Fitness/Recreation": 16,
  "Construction": 12,
  "Professional Services": 14,
  "Legal": 14,
  "Accounting": 12,
  "Real Estate": 10,
  "Hospitality": 20,
  "Cleaning Services": 14,
  "Technology": 8,
  "Education": 10,
  "Other": 10,
};

const WEBSITE_QUALITY_SCORES: Record<string, number> = {
  "excellent": 20,
  "good": 15,
  "basic": 10,
  "poor": 5,
  "none": 0,
};

const MATURITY_SCORES: Record<string, number> = {
  "established": 20,
  "mature": 18,
  "growing": 14,
  "new": 8,
  "startup": 5,
  "unknown": 10,
};

const CONTACT_QUALITY_SCORES: Record<string, number> = {
  "verified_owner": 20,
  "owner": 18,
  "manager": 14,
  "general": 10,
  "web_form_only": 6,
  "none": 0,
  "unknown": 8,
};

export function scoreFit(lead: SdrLeadState): ScoreResult {
  const factors: Record<string, number> = {};
  let score = 0;

  const verticalScore = VERTICAL_FIT[lead.vertical || "Other"] || 10;
  factors.vertical = verticalScore;
  score += verticalScore;

  const websiteQuality = lead.websiteQuality || (lead.website ? "basic" : "none");
  const websiteScore = WEBSITE_QUALITY_SCORES[websiteQuality] || 5;
  factors.websiteQuality = websiteScore;
  score += websiteScore;

  const maturity = lead.businessMaturity || "unknown";
  const maturityScore = MATURITY_SCORES[maturity] || 10;
  factors.businessMaturity = maturityScore;
  score += maturityScore;

  const contactQuality = lead.contactQuality || (lead.ownerEmail ? "owner" : lead.email ? "general" : "none");
  const contactScore = CONTACT_QUALITY_SCORES[contactQuality] || 8;
  factors.contactQuality = contactScore;
  score += contactScore;

  const consumerFacing = ["Restaurant", "Food/Beverage", "Retail", "Salon/Spa", "Healthcare", "Medical/Dental/Medspa", "Hospitality", "Fitness/Recreation"].includes(lead.vertical || "");
  if (consumerFacing) {
    factors.consumerFacing = 10;
    score += 10;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors };
}

export function scoreRevenue(lead: SdrLeadState): ScoreResult {
  const factors: Record<string, number> = {};
  let score = 0;

  const locations = lead.locationCount || 1;
  const locationScore = Math.min(25, locations * 8);
  factors.locations = locationScore;
  score += locationScore;

  const ticketSize = lead.estimatedTicketSize || "";
  let ticketScore = 10;
  if (ticketSize) {
    const num = parseFloat(ticketSize.replace(/[^0-9.]/g, ""));
    if (!isNaN(num)) {
      if (num >= 200) ticketScore = 25;
      else if (num >= 100) ticketScore = 20;
      else if (num >= 50) ticketScore = 15;
      else if (num >= 25) ticketScore = 10;
      else ticketScore = 5;
    }
  }
  factors.ticketSize = ticketScore;
  score += ticketScore;

  const serviceType = lead.serviceType || "";
  let serviceScore = 10;
  if (/recurring|subscription|membership/i.test(serviceType)) serviceScore = 20;
  else if (/high.?volume|busy|popular/i.test(serviceType)) serviceScore = 18;
  else if (/seasonal/i.test(serviceType)) serviceScore = 8;
  factors.serviceType = serviceScore;
  score += serviceScore;

  const billingHints = lead.billingHints || "";
  let billingScore = 5;
  if (/recurring|monthly|annual/i.test(billingHints)) billingScore = 15;
  else if (/invoice|billing/i.test(billingHints)) billingScore = 10;
  factors.billingHints = billingScore;
  score += billingScore;

  if (lead.hasBookingSystem) {
    factors.bookingSystem = 5;
    score += 5;
  }
  if (lead.hasEcommerce) {
    factors.ecommerce = 5;
    score += 5;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors };
}

export function scoreReachability(lead: SdrLeadState): ScoreResult {
  const factors: Record<string, number> = {};
  let score = 0;

  const hasDirectEmail = !!(lead.ownerEmail || lead.email);
  if (hasDirectEmail) {
    const isOwnerEmail = !!lead.ownerEmail;
    factors.directEmail = isOwnerEmail ? 30 : 20;
    score += isOwnerEmail ? 30 : 20;
  }

  const hasMobile = !!(lead.ownerPhone || lead.phone);
  if (hasMobile) {
    factors.mobilePhone = 25;
    score += 25;
  }

  if (lead.website) {
    factors.webPresence = 15;
    score += 15;
  }

  const ownerConfidence = lead.ownerName ? 20 : 5;
  factors.ownerConfidence = ownerConfidence;
  score += ownerConfidence;

  if (lead.consentSms) {
    factors.smsConsent = 5;
    score += 5;
  }
  if (lead.consentEmail) {
    factors.emailConsent = 5;
    score += 5;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors };
}

export function calculatePriority(fitScore: number, revenueScore: number, reachabilityScore: number): { priorityScore: number; priorityBucket: "A" | "B" | "C" | "nurture" } {
  const priorityScore = Math.round((fitScore + revenueScore + reachabilityScore) / 3);

  let priorityBucket: "A" | "B" | "C" | "nurture";
  if (priorityScore >= 80) priorityBucket = "A";
  else if (priorityScore >= 60) priorityBucket = "B";
  else if (priorityScore >= 40) priorityBucket = "C";
  else priorityBucket = "nurture";

  return { priorityScore, priorityBucket };
}

export function scoreLeadFull(lead: SdrLeadState): FullScoreResult {
  const fit = scoreFit(lead);
  const revenue = scoreRevenue(lead);
  const reachability = scoreReachability(lead);
  const { priorityScore, priorityBucket } = calculatePriority(fit.score, revenue.score, reachability.score);

  return {
    fitScore: fit.score,
    revenueScore: revenue.score,
    reachabilityScore: reachability.score,
    priorityScore,
    priorityBucket,
    breakdown: { fit, revenue, reachability },
  };
}

export async function aiAssessWebsiteQuality(website: string): Promise<{ websiteQuality: string; businessMaturity: string }> {
  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Analyze this business website URL and assess:
1. Website quality: excellent/good/basic/poor
2. Business maturity: established/mature/growing/new/startup

Website: ${website}

Return JSON: { "websiteQuality": "...", "businessMaturity": "..." }`
      }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 100,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        websiteQuality: parsed.websiteQuality || "basic",
        businessMaturity: parsed.businessMaturity || "unknown",
      };
    }
  } catch (err) {
    console.error("[SDR Scoring] AI website assessment failed:", err);
  }
  return { websiteQuality: "basic", businessMaturity: "unknown" };
}
