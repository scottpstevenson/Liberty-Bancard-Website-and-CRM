/**
 * Partner application contract shared by the public forms and the server route.
 *
 * One schema per path (referral / sales agent). Both are strict: a field that belongs to the other path, a password, a
 * document, a partner id or a rate is rejected rather than ignored, so a hidden field left over from a role switch can
 * never be stored. The server resolves consent wording from the version the browser rendered; it never accepts
 * browser-supplied wording, hashes, time or identity.
 *
 * No database or server imports: the client bundle imports this file.
 */
import { z } from "zod";
import {
  PARTNER_CONTACT_PREFERENCES,
  PARTNER_INTRO_VOLUME_BANDS,
  PARTNER_LEAD_SOURCE_INTERESTS,
  PARTNER_PROFESSION_IDS,
  PARTNER_ROUTES,
  type PartnerPathId,
} from "./partner-public-content";

export const PARTNER_APPLICATION_SCHEMA_VERSION = 1 as const;

export const PARTNER_APPLICATION_CONSENT = {
  version: "partner_application_contact@1",
  purpose: "partner_application_contact",
  text: "I ask Liberty Bancard to contact me about this partnership application. I have read the Privacy Notice.",
} as const;

/** Consent wording versions the server can resolve. A version it does not know is a 400, never a guess. */
export const PARTNER_APPLICATION_CONSENT_VERSIONS: Readonly<Record<string, { purpose: string; text: string }>> = {
  [PARTNER_APPLICATION_CONSENT.version]: { purpose: PARTNER_APPLICATION_CONSENT.purpose, text: PARTNER_APPLICATION_CONSENT.text },
};

/** The email-marketing disclosure id (resolved server-side from shared/website-email-disclosures.ts). */
export const PARTNER_APPLICATION_MARKETING_SURFACE = "partner_application" as const;

/** Pages a submission may name as its origin. Anything else is dropped, never stored. */
export const PARTNER_SOURCE_PAGES = [
  PARTNER_ROUTES.hub,
  PARTNER_ROUTES.referral,
  PARTNER_ROUTES.salesAgent,
  PARTNER_ROUTES.cpa,
  PARTNER_ROUTES.bookkeeper,
  PARTNER_ROUTES.insurance,
  PARTNER_ROUTES.affiliate,
] as const;

// ── Attribution allowlist ───────────────────────────────────────────────────────────────────────────────────────────

export const PARTNER_ATTRIBUTION_KEYS = ["ref", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type PartnerAttributionKey = (typeof PARTNER_ATTRIBUTION_KEYS)[number];
const ATTRIBUTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.~:+\- ]{0,99}$/;

/** Keeps only allowlisted, bounded, plainly-formed values. Tokens, URLs and anything else are dropped. */
export function pickPartnerAttribution(source: URLSearchParams | Record<string, unknown> | null | undefined): Partial<Record<PartnerAttributionKey, string>> {
  const out: Partial<Record<PartnerAttributionKey, string>> = {};
  if (!source) return out;
  for (const key of PARTNER_ATTRIBUTION_KEYS) {
    const raw = source instanceof URLSearchParams ? source.get(key) : (source as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (ATTRIBUTION_VALUE.test(value)) out[key] = value;
  }
  return out;
}

/**
 * Attribution precedence (one rule, used by every link, the application form and the stored snapshot):
 *   1. CURRENT touch wins: when the page the visitor is on carries any allowlisted value, that whole set is used.
 *      Sets are never merged key by key, so a stored `ref` can never be paired with a different campaign's UTM values.
 *   2. Otherwise the session's FIRST touch (the first allowlisted set seen on a partner route) is used, so a visitor who
 *      wandered to a page without parameters is still attributed to how they arrived.
 *   3. Otherwise nothing is stored. Personal data, unknown keys and malformed values never survive `pickPartnerAttribution`.
 */
export function resolvePartnerAttribution(
  current: URLSearchParams | Record<string, unknown> | null | undefined,
  firstTouch: URLSearchParams | Record<string, unknown> | null | undefined,
): Partial<Record<PartnerAttributionKey, string>> {
  const now = pickPartnerAttribution(current);
  if (Object.keys(now).length > 0) return now;
  return pickPartnerAttribution(firstTouch);
}

/** Builds a same-origin partner path with only allowlisted attribution and an allowlisted profession. */
export function partnerLink(path: string, params?: { attribution?: Partial<Record<PartnerAttributionKey, string>>; profession?: string | null; hash?: string }): string {
  const query = new URLSearchParams();
  const attribution = pickPartnerAttribution(params?.attribution ?? {});
  for (const key of PARTNER_ATTRIBUTION_KEYS) if (attribution[key]) query.set(key, attribution[key]!);
  if (params?.profession && (PARTNER_PROFESSION_IDS as readonly string[]).includes(params.profession)) query.set("profession", params.profession);
  const qs = query.toString();
  return `${path}${qs ? `?${qs}` : ""}${params?.hash ? `#${params.hash}` : ""}`;
}

// ── Field schemas ───────────────────────────────────────────────────────────────────────────────────────────────────

// Plain text: control characters are removed, line breaks kept. HTML is not interpreted anywhere (React/escaped output).
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const text = (min: number, max: number, label: string) =>
  z.string({ error: `${label} is required.` })
    .transform(clean)
    .pipe(z.string().min(min, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));
const optionalText = (max: number, label: string) =>
  z.string({ error: `${label} must be text.` })
    .transform(clean)
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
    .optional()
    .transform((v) => (v ? v : undefined));

const PHONE_CHARS = /^\+?[\d\s().-]{7,30}$/;
/** Country-aware: 7–15 digits with ordinary punctuation. Not US-only; not a deliverability check. */
export function isAcceptablePartnerPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_CHARS.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

const fullName = text(1, 200, "Full name");
const workEmail = z.string({ error: "Work email is required." })
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().min(1, "Work email is required.").max(254, "Work email must be 254 characters or fewer.").email("Enter a valid email address."));
const requiredPhone = z.string({ error: "Phone is required." })
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "Phone is required.").refine(isAcceptablePartnerPhone, "Enter a valid phone number."));
const optionalPhone = z.string({ error: "Enter a valid phone number." })
  .transform((v) => v.trim())
  .refine((v) => v === "" || isAcceptablePartnerPhone(v), "Enter a valid phone number.")
  .optional()
  .transform((v) => (v ? v : undefined));

const contactPreference = z.enum(PARTNER_CONTACT_PREFERENCES.map((p) => p.id) as [string, ...string[]]).default("email");

const permission = z.literal(true, { error: "Confirm that you ask Liberty Bancard to contact you about this application." });

const common = {
  schemaVersion: z.literal(PARTNER_APPLICATION_SCHEMA_VERSION),
  fullName,
  email: workEmail,
  company: optionalText(200, "Company"),
  contactPreference,
  background: optionalText(2000, "Background"),
  contactPermission: permission,
  consentVersion: z.string().min(1).max(80),
  marketingOptIn: z.boolean().optional().default(false),
  emailDisclosureId: z.string().min(1).max(120).optional(),
  sourcePage: z.string().max(120).optional(),
  attribution: z.record(z.string(), z.unknown()).optional(),
};

export const referralApplicationSchema = z.object({
  ...common,
  path: z.literal("referral"),
  phone: optionalPhone,
  profession: z.enum(PARTNER_PROFESSION_IDS as [string, ...string[]], { error: "Choose your profession or business type." }),
  professionOther: optionalText(200, "Profession detail"),
  referralNetwork: text(1, 2000, "Referral network"),
  expectedIntroductions: z.enum(PARTNER_INTRO_VOLUME_BANDS.map((b) => b.id) as [string, ...string[]]).optional(),
  region: optionalText(100, "Region"),
}).strict();

export const salesAgentApplicationSchema = z.object({
  ...common,
  path: z.literal("sales_agent"),
  phone: requiredPhone,
  region: text(1, 100, "Region"),
  experience: text(1, 2000, "Payments or sales experience"),
  prospectingApproach: text(1, 2000, "Prospecting approach"),
  leadSourceInterest: z.enum(PARTNER_LEAD_SOURCE_INTERESTS.map((i) => i.id) as [string, ...string[]], { error: "Choose a lead-source interest." }),
}).strict();

export type ReferralApplicationInput = z.infer<typeof referralApplicationSchema>;
export type SalesAgentApplicationInput = z.infer<typeof salesAgentApplicationSchema>;
export type PartnerApplicationInput = ReferralApplicationInput | SalesAgentApplicationInput;

export interface PartnerApplicationIssue { field: string; message: string }

export type PartnerApplicationParse =
  | { ok: true; data: PartnerApplicationInput }
  | { ok: false; issues: PartnerApplicationIssue[] };

/** Validates a body for the path it names. Cross-field rules (phone preference, marketing disclosure) live here too. */
export function parsePartnerApplication(body: unknown, pathOverride?: PartnerPathId): PartnerApplicationParse {
  const path = pathOverride ?? (body && typeof body === "object" ? (body as Record<string, unknown>).path : undefined);
  const schema = path === "referral" ? referralApplicationSchema : path === "sales_agent" ? salesAgentApplicationSchema : null;
  if (!schema) return { ok: false, issues: [{ field: "path", message: "Choose a partnership path." }] };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "form", message: i.message })) };
  }
  const data = parsed.data as PartnerApplicationInput;
  const issues: PartnerApplicationIssue[] = [];
  if (data.contactPreference === "phone" && !data.phone) issues.push({ field: "phone", message: "Add a phone number to be contacted by phone." });
  if (data.marketingOptIn && !data.emailDisclosureId) issues.push({ field: "marketingOptIn", message: "Marketing updates need the rendered disclosure." });
  if (!data.marketingOptIn && data.emailDisclosureId) issues.push({ field: "emailDisclosureId", message: "A disclosure id requires the marketing box to be checked." });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data };
}

/** A legacy account-creation payload (password, or no schema version / path) must never be treated as an application. */
export function isLegacyPartnerPayload(body: unknown): boolean {
  if (!body || typeof body !== "object") return true;
  const b = body as Record<string, unknown>;
  return "password" in b || b.schemaVersion === undefined || b.path === undefined;
}
