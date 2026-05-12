import type { SdrLeadState } from "@shared/schema";
import { processorSignals, adSignals } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { logAiCall } from "../ai-audit-logger";

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
  processorScore: number;
  growthScore: number;
  priorityScore: number;
  priorityBucket: "A" | "B" | "C" | "nurture";
  breakdown: {
    fit: ScoreResult;
    revenue: ScoreResult;
    reachability: ScoreResult;
    priority: ScoreResult;
    processor: ScoreResult;
    growth: ScoreResult;
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

interface VerticalBoostConfig {
  vertical: string;
  boosts: Array<{
    name: string;
    check: (lead: SdrLeadState) => boolean;
    points: number;
  }>;
}

const FL_AUTO_BOOSTS: VerticalBoostConfig = {
  vertical: "Auto",
  boosts: [
    { name: "highGoogleRating", check: (lead) => parseGoogleRating(lead) >= 4.3, points: 8 },
    { name: "sufficientReviews", check: (lead) => parseReviewCount(lead) >= 20, points: 6 },
    { name: "independentOwner", check: (lead) => isIndependentOwner(lead), points: 5 },
    { name: "serviceMenuOnSite", check: (lead) => hasServiceMenu(lead), points: 4 },
    { name: "multiBayOrLocation", check: (lead) => (lead.locationCount || 1) > 1 || hasMultiBay(lead), points: 5 },
    { name: "financingOnSite", check: (lead) => hasFinancingOrFleet(lead), points: 6 },
  ],
};

const FL_MEDSPA_BOOSTS: VerticalBoostConfig = {
  vertical: "Salon/Spa",
  boosts: [
    { name: "offersMemberships", check: (lead) => hasMembershipSignals(lead), points: 8 },
    { name: "onlineBooking", check: (lead) => !!lead.hasBookingSystem, points: 6 },
    { name: "activeInstagram", check: (lead) => hasActiveInstagram(lead), points: 4 },
    { name: "highReviewCount", check: (lead) => parseReviewCount(lead) >= 50, points: 6 },
    { name: "multipleProviders", check: (lead) => (lead.locationCount || 1) > 1 || hasMultipleProviders(lead), points: 5 },
    { name: "aestheticServices", check: (lead) => hasAestheticServices(lead), points: 5 },
  ],
};

const FL_MEDICAL_BOOSTS: VerticalBoostConfig = {
  vertical: "Healthcare",
  boosts: [
    { name: "privatePractice", check: (lead) => isPrivatePractice(lead), points: 7 },
    { name: "multipleProviders", check: (lead) => hasMultipleProviders(lead), points: 5 },
    { name: "textToPayInterest", check: (lead) => hasTextToPayInterest(lead), points: 6 },
    { name: "highReviewCount", check: (lead) => parseReviewCount(lead) >= 30, points: 4 },
    { name: "paymentPlanSignals", check: (lead) => hasPaymentPlanSignals(lead), points: 5 },
    { name: "privatePay", check: (lead) => hasPrivatePaySignals(lead), points: 6 },
  ],
};

const VERTICAL_BOOST_CONFIGS: VerticalBoostConfig[] = [
  FL_AUTO_BOOSTS,
  FL_MEDSPA_BOOSTS,
  FL_MEDICAL_BOOSTS,
];

function parseGoogleRating(lead: SdrLeadState): number {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (!data) return 0;
  const rating = data.googleRating || data.rating || data.google_rating;
  return typeof rating === "number" ? rating : parseFloat(rating) || 0;
}

function parseReviewCount(lead: SdrLeadState): number {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (!data) return 0;
  const count = data.reviewCount || data.reviews || data.review_count || data.totalReviews;
  return typeof count === "number" ? count : parseInt(count) || 0;
}

function isIndependentOwner(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (lead.ownerName) return true;
  if (!data) return false;
  return !!(data.ownerOperated || data.independent || data.ownership === "independent");
}

function hasServiceMenu(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (!data) return false;
  return !!(data.hasServiceMenu || data.serviceMenu || data.services_listed);
}

function hasMultiBay(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (!data) return false;
  return !!(data.multiBay || data.multipleBays || data.bayCount > 1);
}

function hasFinancingOrFleet(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${lead.billingHints || ""} ${data?.description || ""} ${data?.services || ""}`.toLowerCase();
  return /financing|fleet account|fleet service/i.test(text);
}

function hasMembershipSignals(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${lead.billingHints || ""} ${data?.description || ""} ${data?.services || ""}`.toLowerCase();
  return /membership|package|subscription|recurring|monthly plan/i.test(text);
}

function hasActiveInstagram(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (!data) return false;
  return !!(data.instagramUrl || data.instagram || data.hasInstagram || data.socialMedia?.instagram);
}

function hasAestheticServices(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${data?.description || ""} ${data?.services || ""} ${lead.companyName || ""}`.toLowerCase();
  return /botox|filler|laser|weight.?loss|body.?sculpt|body.?contour|injectable|coolsculpt|hydrafacial|microneedling|chemical peel/i.test(text);
}

function hasMultipleProviders(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if ((lead.locationCount || 1) > 1) return true;
  if (!data) return false;
  const providerCount = data.providerCount || data.providers || data.staffCount;
  return typeof providerCount === "number" ? providerCount > 1 : false;
}

function isPrivatePractice(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  if (lead.ownerName) return true;
  if (!data) return false;
  const text = `${data.ownership || ""} ${data.practiceType || ""}`.toLowerCase();
  return /private|independent|solo|owner/i.test(text) && !/hospital|system|network|enterprise/i.test(text);
}

function hasTextToPayInterest(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${lead.billingHints || ""} ${data?.description || ""} ${data?.services || ""}`.toLowerCase();
  return /text.?to.?pay|mobile pay|online pay|patient portal|digital payment/i.test(text);
}

function hasPaymentPlanSignals(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${lead.billingHints || ""} ${data?.description || ""} ${data?.services || ""}`.toLowerCase();
  return /payment plan|financing|care.?credit|installment/i.test(text);
}

function hasPrivatePaySignals(lead: SdrLeadState): boolean {
  const data = lead.enrichmentData as Record<string, any> | null;
  const text = `${lead.serviceType || ""} ${data?.description || ""} ${data?.services || ""} ${lead.companyName || ""}`.toLowerCase();
  return /private.?pay|cash.?pay|self.?pay|out.?of.?pocket|cosmetic|elective|behavioral|mental health|chiropr|physical therapy|pt\b|optometry/i.test(text);
}

function applyVerticalBoosts(lead: SdrLeadState): { totalBoost: number; boostFactors: Record<string, number> } {
  const boostFactors: Record<string, number> = {};
  let totalBoost = 0;
  const vertical = lead.vertical || "";
  const state = (lead.state || "").toLowerCase();
  const isFlorida = state === "fl" || state === "florida";

  const v = vertical.toLowerCase();
  const isAuto = /auto|automotive|car|vehicle|mechanic|tire|collision|body shop|transmission|brake/i.test(v);
  const hasMedSpaTerms = /med.?spa|medspa|aesthetic|beauty|salon/i.test(v);
  const hasClinicalTerms = /dental|dentist|chiro|optom|podiatr|dermat|urgent care|physical therapy|behavioral|healthcare|clinic/i.test(v);
  const hasMedicalPrimary = /^medical(?!.*spa)/i.test(v) || hasClinicalTerms;

  let matchedVertical: string | null = null;
  if (isAuto) matchedVertical = "Auto";
  else if (hasMedSpaTerms && !hasMedicalPrimary) matchedVertical = "Salon/Spa";
  else if (hasMedicalPrimary || /^medical/i.test(v)) matchedVertical = "Healthcare";
  else if (hasMedSpaTerms || /spa/i.test(v)) matchedVertical = "Salon/Spa";

  if (matchedVertical) {
    const config = VERTICAL_BOOST_CONFIGS.find(c => c.vertical === matchedVertical);
    if (config) {
      for (const boost of config.boosts) {
        const passes = boost.check(lead);
        if (passes) {
          const adjustedPoints = isFlorida ? boost.points : Math.round(boost.points * 0.7);
          boostFactors[`${config.vertical}_${boost.name}`] = adjustedPoints;
          totalBoost += adjustedPoints;
        }
      }
    }
  }

  return { totalBoost, boostFactors };
}

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

  const { totalBoost, boostFactors } = applyVerticalBoosts(lead);
  if (totalBoost > 0) {
    Object.assign(factors, boostFactors);
    score += totalBoost;
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

const SWITCHABLE_PROCESSORS = ["Square", "Stripe", "Toast", "Clover", "PayPal", "Shopify"];

export function scoreProcessor(processorData: { vendors: string[]; hasProcessor: boolean }): ScoreResult {
  const factors: Record<string, number> = {};
  let score = 0;

  if (processorData.hasProcessor) {
    factors.processorDetected = 15;
    score += 15;

    const switchable = processorData.vendors.filter(v => SWITCHABLE_PROCESSORS.includes(v));
    if (switchable.length > 0) {
      const switchScore = Math.min(40, switchable.length * 20);
      factors.switchableTarget = switchScore;
      score += switchScore;

      if (switchable.includes("Square")) {
        factors.squareDetected = 20;
        score += 20;
      } else if (switchable.includes("Stripe")) {
        factors.stripeDetected = 15;
        score += 15;
      } else if (switchable.includes("Toast")) {
        factors.toastDetected = 15;
        score += 15;
      }
    }

    if (processorData.vendors.length > 1) {
      factors.multipleProcessors = 10;
      score += 10;
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors };
}

export function scoreGrowth(growthData: { isRunningAds: boolean; adPlatforms: string[]; hasBooking: boolean; hasEcommerce: boolean }): ScoreResult {
  const factors: Record<string, number> = {};
  let score = 0;

  if (growthData.isRunningAds) {
    factors.runningAds = 20;
    score += 20;

    if (growthData.adPlatforms.includes("facebook")) {
      factors.facebookAds = 15;
      score += 15;
    }
    if (growthData.adPlatforms.includes("google")) {
      factors.googleAds = 15;
      score += 15;
    }
  }

  if (growthData.hasBooking) {
    factors.bookingSystem = 15;
    score += 15;
  }
  if (growthData.hasEcommerce) {
    factors.ecommerce = 15;
    score += 15;
  }

  if (growthData.adPlatforms.length > 1) {
    factors.multiChannelAds = 10;
    score += 10;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors };
}

export function scorePriority(lead: SdrLeadState): ScoreResult {
  let score = 50;
  const factors: Record<string, number> = {};

  if (lead.hasResponded) { score += 20; factors.responded = 20; }
  if (lead.emailAttempts && lead.emailAttempts > 0 && !lead.hasResponded) { score -= 5; factors.unresponsiveOutreach = -5; }
  if (lead.stage === "ENRICHED" || lead.stage === "CLASSIFIED") { score += 10; factors.enrichedStage = 10; }
  if (lead.lastActivityAt) {
    const daysSinceActivity = (Date.now() - new Date(lead.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity < 7) { score += 15; factors.recentActivity = 15; }
    else if (daysSinceActivity < 30) { score += 5; factors.moderateActivity = 5; }
  }
  if (lead.priorityBucket === "A") { score += 10; factors.existingHighPriority = 10; }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

export function calculatePriority(
  fitScore: number, revenueScore: number, reachabilityScore: number,
  processorScoreVal: number = 0, growthScoreVal: number = 0,
  priorityDimensionScore: number = 50
): { priorityScore: number; priorityBucket: "A" | "B" | "C" | "nurture" } {
  const priorityScore = Math.round(
    fitScore * 0.25 +
    revenueScore * 0.20 +
    reachabilityScore * 0.15 +
    priorityDimensionScore * 0.15 +
    processorScoreVal * 0.15 +
    growthScoreVal * 0.10
  );

  let priorityBucket: "A" | "B" | "C" | "nurture";
  if (priorityScore >= 80) priorityBucket = "A";
  else if (priorityScore >= 60) priorityBucket = "B";
  else if (priorityScore >= 40) priorityBucket = "C";
  else priorityBucket = "nurture";

  return { priorityScore, priorityBucket };
}

export function scoreLeadFull(lead: SdrLeadState, processorData?: { vendors: string[]; hasProcessor: boolean }, growthData?: { isRunningAds: boolean; adPlatforms: string[]; hasBooking: boolean; hasEcommerce: boolean }): FullScoreResult {
  const fit = scoreFit(lead);
  const revenue = scoreRevenue(lead);
  const reachability = scoreReachability(lead);

  const processor = scoreProcessor(processorData || { vendors: [], hasProcessor: false });
  const growth = scoreGrowth(growthData || {
    isRunningAds: false,
    adPlatforms: [],
    hasBooking: !!lead.hasBookingSystem,
    hasEcommerce: !!lead.hasEcommerce,
  });

  const priority = scorePriority(lead);

  const { priorityScore, priorityBucket } = calculatePriority(
    fit.score, revenue.score, reachability.score, processor.score, growth.score, priority.score
  );

  return {
    fitScore: fit.score,
    revenueScore: revenue.score,
    reachabilityScore: reachability.score,
    processorScore: processor.score,
    growthScore: growth.score,
    priorityScore,
    priorityBucket,
    breakdown: { fit, revenue, reachability, priority, processor, growth },
  };
}

export async function getLeadProcessorData(businessId: number | null | undefined): Promise<{ vendors: string[]; hasProcessor: boolean }> {
  if (!businessId) return { vendors: [], hasProcessor: false };
  try {
    const signals = await db.select().from(processorSignals).where(eq(processorSignals.businessId, businessId));
    const vendors = signals.map(s => s.vendorName);
    return { vendors, hasProcessor: vendors.length > 0 };
  } catch {
    return { vendors: [], hasProcessor: false };
  }
}

export async function getLeadGrowthData(businessId: number | null | undefined, lead: SdrLeadState): Promise<{ isRunningAds: boolean; adPlatforms: string[]; hasBooking: boolean; hasEcommerce: boolean }> {
  const base = { isRunningAds: false, adPlatforms: [] as string[], hasBooking: !!lead.hasBookingSystem, hasEcommerce: !!lead.hasEcommerce };
  if (!businessId) return base;
  try {
    const signals = await db.select().from(adSignals).where(eq(adSignals.businessId, businessId));
    const runningAds = signals.filter(s => s.isRunningAds);
    return {
      isRunningAds: runningAds.length > 0,
      adPlatforms: runningAds.map(s => s.platform),
      hasBooking: !!lead.hasBookingSystem,
      hasEcommerce: !!lead.hasEcommerce,
    };
  } catch {
    return base;
  }
}

export async function aiAssessWebsiteQuality(website: string): Promise<{ websiteQuality: string; businessMaturity: string }> {
  try {
    const openai = getOpenAI();
    const response = await logAiCall(
      { triggerType: "website-quality", actorType: "system" },
      () => openai.chat.completions.create({
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
    }));

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
