/**
 * W-C public inquiry contracts, shared by the browser forms and the server routes so the two can never drift.
 *
 * Two server-owned modes extend the existing /api/public/get-started intake WITHOUT touching its generic strict schema:
 *   - equipment_inquiry  the specific terminal-program inquiry (offer-specific mode of /get-started)
 *   - general_inquiry    the short preliminary business inquiry on About/Contact (#inquiry)
 *
 * A mode is chosen by an allowlisted request value and then fixes which source policy, which strict DTO and which
 * frozen context the server uses. Nothing here (and nothing a client sends) can grant promotional/marketing eligibility,
 * approve anything, or promote an unknown contact: an inquiry is a request for staff review.
 */
import { z } from "zod";

export const INQUIRY_MODES = ["equipment_inquiry", "general_inquiry"] as const;
export type InquiryMode = (typeof INQUIRY_MODES)[number];

export function isInquiryMode(value: unknown): value is InquiryMode {
  return typeof value === "string" && (INQUIRY_MODES as readonly string[]).includes(value);
}

/** Route values the server resolves to a frozen offer id/version/intent. Anything else is unsupported, never echoed. */
export const INQUIRY_OFFERS = {
  "free-terminal": { id: "free-terminal", version: "2026-11-wc1", intent: "terminal_options" },
} as const;
export type InquiryOfferRoute = keyof typeof INQUIRY_OFFERS;

export function resolveInquiryOffer(route: unknown): (typeof INQUIRY_OFFERS)[InquiryOfferRoute] | null {
  return typeof route === "string" && Object.prototype.hasOwnProperty.call(INQUIRY_OFFERS, route)
    ? INQUIRY_OFFERS[route as InquiryOfferRoute]
    : null;
}

export const INQUIRY_BUSINESS_TYPES = ["Medical/Dental/Medspa", "Automotive", "Restaurant", "Home Services", "Retail", "Other"] as const;

/**
 * Monthly card-volume intake bands. Stable semantic codes and ranges, never guessed dollar amounts. These are intake bands,
 * not approval thresholds: "not_processing_yet" and "not_sure" are different answers and neither disqualifies or promotes.
 */
export const INQUIRY_VOLUME_BANDS = [
  { code: "not_processing_yet", label: "Not processing yet", min: null, max: null },
  { code: "under_5000", label: "Under $5,000", min: 0, max: 4999 },
  { code: "5000_24999", label: "$5,000–$24,999", min: 5000, max: 24999 },
  { code: "25000_99999", label: "$25,000–$99,999", min: 25000, max: 99999 },
  { code: "100000_plus", label: "$100,000 or more", min: 100000, max: null },
  { code: "not_sure", label: "Not sure", min: null, max: null },
] as const;
export type InquiryVolumeBand = (typeof INQUIRY_VOLUME_BANDS)[number]["code"];
export const INQUIRY_VOLUME_BAND_CODES = INQUIRY_VOLUME_BANDS.map((band) => band.code) as [InquiryVolumeBand, ...InquiryVolumeBand[]];

export const INQUIRY_LEASE_ANSWERS = [
  { code: "yes", label: "Yes" },
  { code: "no", label: "No" },
  { code: "not_sure", label: "Not sure" },
] as const;
export type InquiryLeaseAnswer = (typeof INQUIRY_LEASE_ANSWERS)[number]["code"];

export const INQUIRY_GENERAL_INTENTS = [
  { code: "processing", label: "Card processing" },
  { code: "equipment", label: "Equipment" },
  { code: "new_business", label: "A new business" },
] as const;
export type InquiryGeneralIntent = (typeof INQUIRY_GENERAL_INTENTS)[number]["code"];

export const INQUIRY_NOTE_MAX = 1000;

/** Digits only, for validity checks. A US number is 10 digits (optionally with a leading 1). */
export function inquiryPhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}
export function isPlausibleInquiryPhone(value: string): boolean {
  const digits = inquiryPhoneDigits(value);
  return (digits.length === 10 && /^[2-9]/.test(digits)) || (digits.length === 11 && digits.startsWith("1") && /^[2-9]/.test(digits.slice(1)));
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Optional phone: absent or blank means "not provided" (never an erased or invented value); a non-blank value must be a real number. */
const optionalPhone = z.string().trim().max(40).optional().superRefine((value, ctx) => {
  if (value && !isPlausibleInquiryPhone(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number." });
});

const attribution = {
  referralCode: optionalText(120),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmContent: optionalText(200),
  utmTerm: optionalText(200),
  landingPage: optionalText(1000),
  gclid: optionalText(500),
  gclidPresent: z.boolean().optional(),
  fbclidPresent: z.boolean().optional(),
  msclkidPresent: z.boolean().optional(),
};

const person = {
  businessName: text(160),
  name: text(120),
  email: z.string().trim().email().max(160),
  phone: optionalPhone,
  /** SMS/PEWC permission. Only meaningful with a real phone number; consent-true without one is a field error. */
  pewcConsent: z.boolean().optional(),
};

export const equipmentInquirySchema = z.object({
  mode: z.literal("equipment_inquiry"),
  /** Allowlisted route value; the server resolves id/version/intent. Unknown values fail validation. */
  offer: z.string().max(40).optional(),
  ...person,
  businessType: z.enum(INQUIRY_BUSINESS_TYPES),
  volumeBand: z.enum(INQUIRY_VOLUME_BAND_CODES),
  currentlyLeasing: z.enum(["yes", "no", "not_sure"]),
  ...attribution,
}).strict();

export const generalInquirySchema = z.object({
  mode: z.literal("general_inquiry"),
  ...person,
  intent: z.enum(["processing", "equipment", "new_business"]),
  note: z.string().trim().max(INQUIRY_NOTE_MAX).optional(),
  ...attribution,
}).strict();

export type EquipmentInquiryInput = z.infer<typeof equipmentInquirySchema>;
export type GeneralInquiryInput = z.infer<typeof generalInquirySchema>;

/** Consent-true needs a real number. Returned as a zod-like issue list so callers answer one consistent 400 shape. */
export function inquiryConsentIssues(input: { phone?: string; pewcConsent?: boolean }): { path: string; message: string }[] {
  if (input.pewcConsent === true && !(input.phone && isPlausibleInquiryPhone(input.phone))) {
    return [{ path: "pewcConsent", message: "Text-message permission needs a valid phone number." }];
  }
  return [];
}

/** The frozen, server-owned context kept on the occurrence (attribution_refs). Contains no free text except the bounded note. */
export const INQUIRY_CONTEXT_SCHEMA = "wc-inquiry-v1" as const;
export interface InquiryContext {
  schema: typeof INQUIRY_CONTEXT_SCHEMA;
  mode: InquiryMode;
  offer: { id: string; version: string; intent: string } | null;
  businessName: string;
  businessType?: string;
  volumeBand?: InquiryVolumeBand;
  currentlyLeasing?: InquiryLeaseAnswer;
  intent?: InquiryGeneralIntent;
  phoneProvided: boolean;
  smsPermissionRequested: boolean;
  note?: string;
  attribution: {
    utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string;
    landingPage?: string; referralCode?: string; gclidPresent?: boolean; fbclidPresent?: boolean; msclkidPresent?: boolean;
  };
}

export function volumeBandLabel(code: string | undefined): string | null {
  return INQUIRY_VOLUME_BANDS.find((band) => band.code === code)?.label ?? null;
}
export function leaseAnswerLabel(code: string | undefined): string | null {
  return INQUIRY_LEASE_ANSWERS.find((answer) => answer.code === code)?.label ?? null;
}
export function generalIntentLabel(code: string | undefined): string | null {
  return INQUIRY_GENERAL_INTENTS.find((intent) => intent.code === code)?.label ?? null;
}
