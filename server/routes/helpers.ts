import multer from "multer";
import os from "os";
import { storage } from "../storage";
import { sendGhlSms } from "../services/ghl";

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const uploadLarge = multer({ dest: os.tmpdir(), limits: { fileSize: 300 * 1024 * 1024 } });

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

    await sendGhlSms({ contactId, dealId, body });
  } catch (err: any) {
    console.error(`[ConfirmSMS] Failed for contact ${contactId}:`, err.message?.slice(0, 100));
  }
}
