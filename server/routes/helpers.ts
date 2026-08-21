import multer from "multer";
import os from "os";
import { storage } from "../storage";
import { sendGhlSms } from "../services/ghl";

/**
 * parseId — parses a route/query param into a positive integer.
 * Accepts the Express param type (string | string[]) as well as body values.
 * Returns null when the value is absent, empty, non-numeric, zero, or negative.
 * Callers should return 404 for a missing path param or 400 for a bad query param.
 */
export function parseId(val: string | string[] | undefined | null): number | null {
  const v = Array.isArray(val) ? val[0] : val;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * parsePagination — safely coerces limit/offset/page query params.
 * - limit is clamped to [1, maxLimit] (default max 500).
 * - offset is clamped to ≥ 0.
 * - If page is provided, offset = (page - 1) * limit.
 */
export function parsePagination(
  query: Record<string, any>,
  maxLimit = 500,
): { limit: number; offset: number } {
  let limit = query.limit !== undefined ? Number(query.limit) : 50;
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > maxLimit) limit = maxLimit;

  let offset = 0;
  if (query.page !== undefined) {
    let page = Number(query.page);
    if (!Number.isFinite(page) || page < 1) page = 1;
    offset = (page - 1) * limit;
  } else if (query.offset !== undefined) {
    offset = Number(query.offset);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
  }

  return { limit, offset };
}

/** Allowed MIME types for standard document/evidence uploads */
const ALLOWED_UPLOAD_MIMES = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "text/csv", "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function mimeFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${file.mimetype}' is not allowed. Accepted: PDF, images, CSV, Excel.`));
  }
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: mimeFilter,
});
/** MIME types accepted by large-file upload endpoints (CSV imports + Sunbiz ZIP). */
const ALLOWED_LARGE_UPLOAD_MIMES = new Set([
  "text/csv",
  "text/plain",                                                               // some OS/browsers send CSV as text/plain
  "application/csv",
  "application/vnd.ms-excel",                                                // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      // .xlsx
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "application/octet-stream",                                                // fallback for ZIP on some clients
]);

function largeMimeFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (ALLOWED_LARGE_UPLOAD_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${file.mimetype}' is not allowed. Accepted: CSV, Excel, ZIP.`));
  }
}

export const uploadLarge = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: largeMimeFilter,
});

export interface ProposalPlan {
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

export interface ProposalData {
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
  lastEditedAt?: string;
  editedBy?: string;
}

export function normalizePhoneForImport(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export { CANONICAL_COARSE_VERTICALS } from "../services/sdr/vertical-constants";

export function classifyVerticalForImport(industry: string, category: string, companyName: string, keywords: string = ""): string {
  const text = `${industry} ${category} ${companyName} ${keywords}`.toLowerCase();
  if (/restaurant|food|pizza|burger|taco|sushi|cafe|coffee|bakery|catering|bar\b|grill|diner|eatery|bistro|cuisine|kitchen/.test(text)) return "Restaurant";
  if (/auto|car |vehicle|mechanic|tire|collision|body shop|transmission|brake|oil change|lube|muffler|exhaust|towing|automotive/.test(text)) return "Auto";
  if (/retail|store|shop\b|boutique|gift|apparel|clothing|fashion|jewelry|shoe|furniture/.test(text)) return "Retail";
  if (/salon|spa\b|beauty|hair\b|nail\b|barber|cosmet|skincare|esthetic|waxing|lash\b|brow\b|med spa|medical spa|medspa/.test(text)) return "Salon/Spa";
  if (/medical|doctor|physician|dental|dentist|chiropr|optom|pharma|clinic|hospital|healthcare|health care|urgent care|veterinar|vet\b|plastic surg|dermatol/.test(text)) return "Healthcare";
  if (/fitness|gym\b|yoga|pilates|martial art|boxing|crossfit|personal train|recreation|swim|sport/.test(text)) return "Fitness/Recreation";
  if (/food|beverage|drink|juice|smoothie|ice cream|donut|wine|liquor|brewery/.test(text)) return "Food/Beverage";
  if (/construct|contractor|plumb|electric|hvac|roof|paint|landscap|concrete|mason|carpenter|remodel|renovati|flooring|handyman/.test(text)) return "Construction";
  if (/law\b|legal|attorney|lawyer/.test(text)) return "Legal";
  if (/account|cpa\b|bookkeep|tax prep/.test(text)) return "Accounting";
  if (/consult|professional service|management|staffing|recruit|human resource/.test(text)) return "Professional Services";
  if (/transport|trucking|freight|logistics|moving|courier|delivery|shipping/.test(text)) return "Transportation";
  if (/real estate|realtor|property|mortgage|title company/.test(text)) return "Real Estate";
  if (/insurance/.test(text)) return "Insurance";
  if (/hotel|motel|lodging|hospitality|travel|tour|resort/.test(text)) return "Hospitality";
  if (/clean|janitorial|laundry|dry clean|maid|housekeep/.test(text)) return "Cleaning Services";
  if (/print|sign |graphic design|marketing|advertis|media|photo|video|creative/.test(text)) return "Marketing/Media";
  if (/tech|software|it\b|information technology|web design|web develop|app develop/.test(text)) return "Technology";
  if (/education|school|tutor|training|academy|learning/.test(text)) return "Education";
  if (/machine|equipment|manufactur|industrial/.test(text)) return "Manufacturing";
  return "Other";
}

export async function trackReferral(referralCode: string | undefined, contactName: string, email: string, phone?: string, company?: string) {
  if (!referralCode) return;
  try {
    const partner = await storage.getPartnerByCode(referralCode);
    if (!partner) return;
    await storage.createReferral({
      partnerId: partner.id,
      referredName: contactName,
      referredEmail: email,
      referredPhone: phone || null,
      referredCompany: company || null,
      status: "pending",
      incentiveType: "commission",
      notes: `Auto-tracked from website form`,
    });
    await storage.updatePartner(partner.id, { totalReferrals: (partner.totalReferrals || 0) + 1 } as any);
  } catch (err) {
    console.error("Referral tracking error:", err);
  }
}

export async function sendConfirmationSms(contactId: number, firstName: string, formType: string, dealId?: number) {
  try {
    const now = new Date();
    const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
    const isBusinessHours = estHour >= 9 && estHour < 17;
    const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    let callTimeText: string;
    if (isBusinessHours && isWeekday) {
      callTimeText = "Would it be okay if a member of our team gives you a quick call now or within the next hour to chat about your processing needs?";
    } else {
      callTimeText = "Would it be okay if a member of our team gives you a call during business hours (9 AM - 5 PM EST) to chat about your processing needs?";
    }

    const formLabels: Record<string, string> = {
      free_analysis_quiz: "completing your free savings analysis",
      get_started: "your interest in getting started",
      statement_upload: "uploading your processing statement",
      callback: "requesting a callback",
      equipment_order: "your equipment order",
      estimate: "using our savings calculator",
      support: "reaching out for support",
    };
    const contextText = formLabels[formType] || "reaching out";

    const body = `Hi ${firstName}! This is Liberty Bancard confirming we received your submission. Thank you for ${contextText}!\n\n${callTimeText}\n\nReply YES for a call, or let us know a time that works best.\n\nReply STOP to opt out. Msg&data rates may apply.`;

    await sendGhlSms({ contactId, dealId, body, commercialPurpose: "transactional_response" });
  } catch (err: any) {
    console.error(`[ConfirmSMS] Failed for contact ${contactId}:`, err.message?.slice(0, 100));
  }
}
