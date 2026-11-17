/**
 * Partner application service: one durable application per mailbox, created together with a pending partner row and
 * the binding of the public occurrence to it.
 *
 * Contract
 *  - The application is a request for review. It creates no login, no password, no session, no users row, no commission
 *    terms and no approval. The partner row is `pending` with `passwordHash` null and `commissionPercent` explicitly
 *    null (never the column default), so nothing downstream can read "10%" or "0%" as agreed terms.
 *  - A per-mailbox advisory lock serializes concurrent applications for one mailbox. The partial unique index on the
 *    mailbox while an application is open is the backstop.
 *  - Every refusal is uniform to the caller; the exact internal reason is returned to the route for the occurrence's
 *    terminal reason and audit only, never to the browser.
 *  - Consent wording is resolved server-side from the version the browser rendered; the stored hash is the hash of the
 *    server's text, and the acceptance time is the server clock.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inboundRequests, partnerApplications, partners, users } from "@shared/schema";
import type { Partner, PartnerApplication } from "@shared/schema";
import {
  PARTNER_APPLICATION_CONSENT_VERSIONS,
  pickPartnerAttribution,
  PARTNER_SOURCE_PAGES,
  PARTNER_APPLICATION_SCHEMA_VERSION,
  type PartnerApplicationInput,
} from "@shared/partner-application";
import { disclosureForSurface } from "@shared/website-email-disclosures";

export type PartnerApplicationRefusal = "PARTNER_EXISTS" | "USER_EXISTS" | "OPEN_APPLICATION" | "PRIOR_APPLICATION";
export type PartnerApplicationInputError = "UNKNOWN_CONSENT_VERSION" | "UNKNOWN_EMAIL_DISCLOSURE";

export type CreatePartnerApplicationResult =
  | { kind: "created"; partner: Partner; application: PartnerApplication }
  | { kind: "refused"; reason: PartnerApplicationRefusal }
  | { kind: "invalid"; reason: PartnerApplicationInputError };

export const sha256Hex = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

/** Server-owned consent record for a rendered version; null when the version is not one the server can resolve. */
export function resolveApplicationConsent(version: string): { version: string; purpose: string; text: string; textSha256: string } | null {
  const known = PARTNER_APPLICATION_CONSENT_VERSIONS[version];
  if (!known) return null;
  return { version, purpose: known.purpose, text: known.text, textSha256: sha256Hex(known.text) };
}

/** Server-owned marketing disclosure; null unless the id is the current partner_application disclosure. */
export function resolveMarketingDisclosure(id: string): { id: string; textSha256: string } | null {
  const disclosure = disclosureForSurface("partner_application");
  if (!disclosure || disclosure.id !== id) return null;
  return { id: disclosure.id, textSha256: sha256Hex(`${disclosure.label}\n${disclosure.helper}`) };
}

function partnerTypeFor(path: PartnerApplicationInput["path"]): string {
  return path === "sales_agent" ? "iso_agent" : "referral";
}

/** The path-specific answers kept with the application. Contains only fields the schema accepted. */
export function applicationAnswers(input: PartnerApplicationInput): Record<string, unknown> {
  const common = { contactPreference: input.contactPreference, company: input.company ?? null, background: input.background ?? null };
  if (input.path === "referral") {
    return {
      ...common,
      profession: input.profession,
      professionOther: input.professionOther ?? null,
      referralNetwork: input.referralNetwork,
      expectedIntroductions: input.expectedIntroductions ?? null,
      region: input.region ?? null,
    };
  }
  return {
    ...common,
    region: input.region,
    experience: input.experience,
    prospectingApproach: input.prospectingApproach,
    leadSourceInterest: input.leadSourceInterest,
  };
}

async function uniqueAffiliateCode(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], fullName: string): Promise<string> {
  const stem = fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "partner";
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `${stem}${crypto.randomBytes(3).toString("hex")}`;
    const [taken] = await tx.select({ id: partners.id }).from(partners).where(eq(partners.affiliateCode, code)).limit(1);
    if (!taken) return code;
  }
  throw new Error("PARTNER_AFFILIATE_CODE_EXHAUSTED");
}

export async function createPartnerApplication(
  input: PartnerApplicationInput,
  context: { inboundRequestId: string; now?: Date },
): Promise<CreatePartnerApplicationResult> {
  const consent = resolveApplicationConsent(input.consentVersion);
  if (!consent) return { kind: "invalid", reason: "UNKNOWN_CONSENT_VERSION" };
  let marketingDisclosureId: string | null = null;
  if (input.marketingOptIn) {
    const disclosure = resolveMarketingDisclosure(input.emailDisclosureId ?? "");
    if (!disclosure) return { kind: "invalid", reason: "UNKNOWN_EMAIL_DISCLOSURE" };
    marketingDisclosureId = disclosure.id;
  }
  const mailbox = input.email.trim().toLowerCase();
  const now = context.now ?? new Date();
  const attribution = pickPartnerAttribution((input.attribution ?? {}) as Record<string, unknown>);
  const sourcePage = (PARTNER_SOURCE_PAGES as readonly string[]).includes(input.sourcePage ?? "") ? (input.sourcePage as string) : null;

  return db.transaction(async (tx): Promise<CreatePartnerApplicationResult> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-application-mailbox:" + mailbox}))`);

    const [existingPartner] = await tx.select({ id: partners.id }).from(partners).where(sql`lower(${partners.email}) = ${mailbox}`).limit(1);
    if (existingPartner) return { kind: "refused", reason: "PARTNER_EXISTS" };
    const [existingUser] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${mailbox}`).limit(1);
    if (existingUser) return { kind: "refused", reason: "USER_EXISTS" };
    const [prior] = await tx.select({ id: partnerApplications.id, status: partnerApplications.reviewStatus })
      .from(partnerApplications).where(eq(partnerApplications.mailbox, mailbox)).limit(1);
    if (prior) return { kind: "refused", reason: prior.status === "pending_review" || prior.status === "needs_info" ? "OPEN_APPLICATION" : "PRIOR_APPLICATION" };

    const affiliateCode = await uniqueAffiliateCode(tx, input.fullName);
    const [partner] = await tx.insert(partners).values({
      companyName: (input.company ?? input.fullName).slice(0, 200),
      contactName: input.fullName.slice(0, 200),
      email: mailbox,
      phone: input.phone ? input.phone.slice(0, 40) : null,
      passwordHash: null,
      partnerType: partnerTypeFor(input.path),
      affiliateCode,
      status: "pending",
      // Explicit null: no commission terms exist until an administrator records them against a schedule.
      commissionPercent: null,
    }).returning();

    // Bind the occurrence to this mailbox in the same transaction (first value wins), so recovery finds the application
    // from the occurrence and never from an arbitrary email match.
    const [bound] = await tx.update(inboundRequests).set({
      submittedEmail: sql`COALESCE(${inboundRequests.submittedEmail}, ${mailbox})`, updatedAt: now,
    }).where(eq(inboundRequests.id, context.inboundRequestId)).returning({ submittedEmail: inboundRequests.submittedEmail });
    if (!bound || bound.submittedEmail !== mailbox) throw new Error("INBOUND_ACCOUNT_BINDING_CONFLICT");

    const [application] = await tx.insert(partnerApplications).values({
      inboundRequestId: context.inboundRequestId,
      partnerId: partner.id,
      mailbox,
      path: input.path,
      profession: input.path === "referral" ? input.profession : null,
      answers: applicationAnswers(input),
      consentVersion: consent.version,
      consentTextSha256: consent.textSha256,
      consentPurpose: consent.purpose,
      consentAcceptedAt: now,
      marketingOptIn: marketingDisclosureId !== null,
      marketingDisclosureId,
      sourcePage,
      acquisition: attribution,
      schemaVersion: PARTNER_APPLICATION_SCHEMA_VERSION,
    }).returning();
    return { kind: "created", partner, application };
  });
}

/** The application bound to an occurrence, if the occurrence created one. */
export async function getApplicationForOccurrence(inboundRequestId: string): Promise<PartnerApplication | null> {
  const [row] = await db.select().from(partnerApplications).where(eq(partnerApplications.inboundRequestId, inboundRequestId)).limit(1);
  return row ?? null;
}

export async function getApplicationForPartner(partnerId: number): Promise<PartnerApplication | null> {
  const [row] = await db.select().from(partnerApplications).where(eq(partnerApplications.partnerId, partnerId)).limit(1);
  return row ?? null;
}

export async function getApplicationByMailbox(mailbox: string): Promise<PartnerApplication | null> {
  const [row] = await db.select().from(partnerApplications)
    .where(and(eq(partnerApplications.mailbox, mailbox.trim().toLowerCase()))).limit(1);
  return row ?? null;
}
