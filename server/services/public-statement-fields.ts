/**
 * Strict, bounded validation of the public statement-upload multipart TEXT fields, and the deterministic versioned
 * request fingerprint for the claim authorities.
 *
 * Validation runs before anything is claimed, stored or created (the file itself is sniffed by statement-upload-file.ts
 * before this). Required: business name, your name, email. Optional: phone (never invented, never erases a stored
 * number), industry, current provider, notes, attribution. Unknown multipart keys are rejected, not ignored.
 *
 * Fingerprint v2 covers the request's SEMANTICS (normalized identity/contact, optional choices, consent, authorized target
 * binding and the file digest) and excludes observational metadata (UTM, landing page, click ids, referrer), so an
 * incidental change of those on a retry is the same request while a changed name/notes/consent/file is a conflict.
 * Stored occurrences keep whatever fingerprint they were created under; callers also pass the legacy fingerprint so a
 * retry that began under an older build still replays instead of conflicting.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { isPlausibleInquiryPhone } from "@shared/public-inquiry";

export const STATEMENT_FINGERPRINT_VERSION = "v2";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const text = (max: number) => z.preprocess(blankToUndefined, z.string().trim().min(1).max(max));
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const flag = z.preprocess(blankToUndefined, z.enum(["true", "false"]).transform((v) => v === "true").optional());

const statementFieldsSchema = z.object({
  businessName: text(160),
  contactName: text(120),
  email: z.preprocess(blankToUndefined, z.string().trim().email().max(160)),
  mobile: z.preprocess(blankToUndefined, z.string().trim().max(40).optional().superRefine((value, ctx) => {
    if (value && !isPlausibleInquiryPhone(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number." });
  })),
  vertical: optionalText(80),
  currentProvider: optionalText(120),
  interestedIn0Percent: flag,
  needTerminal: flag,
  notes: optionalText(2000),
  pewcConsent: flag,
  consentSms: flag,
  referralCode: optionalText(120),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmContent: optionalText(200),
  utmTerm: optionalText(200),
  landingPage: optionalText(1000),
  gclid: optionalText(500),
  referrerUrl: optionalText(1000),
  gclidPresent: flag,
  fbclidPresent: flag,
  msclkidPresent: flag,
}).strict();

export type StatementFields = z.infer<typeof statementFieldsSchema>;

export type StatementFieldsVerdict =
  | { ok: true; data: StatementFields }
  | { ok: false; issues: { path: string; message: string }[] };

export function parseStatementFields(body: unknown): StatementFieldsVerdict {
  const parsed = statementFieldsSchema.safeParse({ ...(body as Record<string, unknown> | null | undefined) });
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join(".") || "body", message })) };
  }
  const data = parsed.data;
  const issues: { path: string; message: string }[] = [];
  // Text-message permission needs a real number: no SMS admission from an absent or malformed phone.
  for (const key of ["pewcConsent", "consentSms"] as const) {
    if (data[key] === true && !(data.mobile && isPlausibleInquiryPhone(data.mobile))) {
      issues.push({ path: key, message: "Text-message permission needs a valid phone number." });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, data };
}

const collapse = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Deterministic, versioned semantic fingerprint (never an authorization capability, never returned to callers). */
export function computeStatementFingerprintV2(input: {
  data: StatementFields;
  existingContactId: number | null;
  existingDealId: number | null;
  fileBuffer: Buffer;
}): string {
  const d = input.data;
  const semantic = {
    v: STATEMENT_FINGERPRINT_VERSION,
    intent: "statement_review",
    businessName: collapse(d.businessName),
    contactName: collapse(d.contactName),
    email: collapse(d.email),
    phoneDigits: (d.mobile ?? "").replace(/\D/g, ""),
    vertical: collapse(d.vertical),
    currentProvider: collapse(d.currentProvider),
    interestedIn0Percent: d.interestedIn0Percent === true,
    needTerminal: d.needTerminal === true,
    notes: (d.notes ?? "").trim(),
    pewcConsent: d.pewcConsent === true,
    consentSms: d.consentSms === true,
    existingContactId: input.existingContactId,
    existingDealId: input.existingDealId,
  };
  const digest = createHash("sha256");
  digest.update(JSON.stringify(semantic, Object.keys(semantic).sort()));
  digest.update("\x00");
  digest.update(createHash("sha256").update(input.fileBuffer).digest());
  // The version label is hashed into the digest (field `v`), so a v2 fingerprint can never equal a legacy one. The stored value must
  // stay 64 lowercase hex characters: inbound_requests.request_fingerprint is constrained to that shape.
  return digest.digest("hex");
}
