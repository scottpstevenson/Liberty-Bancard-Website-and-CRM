/**
 * Post-approval merchant introductions submitted by an authenticated, active partner.
 *
 * Boundaries
 *  - The partner is derived from the authenticated session (mailbox -> partner row) and re-checked as active inside the
 *    transaction that records the introduction. A partner id, rate, actor or status in the body is rejected.
 *  - The occurrence is the `partner_introductions` row keyed (partner, Idempotency-Key). A retry with the same key and
 *    the same content returns the same record; the same key with different content is a conflict.
 *  - The permission confirmation is introducer evidence (version, wording hash, server time, submitting user). It is
 *    never the merchant's own email/SMS consent: no consent command is issued here and no outreach eligibility is made.
 *  - A new person becomes a contact through the canonical contact writer (`partner_referral|partner_portal`) plus one
 *    referral row for this partner. A mailbox/phone that already belongs to a contact is linked for review and never
 *    modified; if another partner already referred it, the introduction is a competing-referrer review. Attribution is
 *    never moved, companies are never merged, and nothing is stacked automatically.
 *  - No commission, entitlement or payment is created. No provider call, enrollment or send is made.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contactSourceEvents, notifications, partnerIntroductions, partners, referrals } from "@shared/schema";
import type { Partner, PartnerIntroduction } from "@shared/schema";
import { storage } from "../storage";
import { createContactLocalFirst, upsertContactSourceEvent } from "./contact-writer";
import { isAcceptablePartnerPhone } from "@shared/partner-application";
import { PARTNER_INTRODUCTION_PERMISSION } from "@shared/partner-public-content";
import { logOperationalDiagnostic } from "../utils/server-error";

export const INTRODUCTION_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INTRODUCTION_REVIEW_STATES = ["pending_review", "duplicate_review", "competing_referrer", "accepted", "declined"] as const;

const clean = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const req = (max: number, label: string) =>
  z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} is required.` })
    .transform(clean).pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));
const opt = (max: number, label: string) =>
  z.string({ invalid_type_error: `${label} must be text.` }).transform(clean).pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
    .optional().transform((v) => (v ? v : undefined));

function normalizeWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 300);
  } catch { return null; }
}

export const introductionBodySchema = z.object({
  businessName: req(200, "Business name"),
  contactName: req(200, "Contact name"),
  contactEmail: z.string().transform((v) => v.trim().toLowerCase())
    .pipe(z.string().max(254, "Email must be 254 characters or fewer.").refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address."))
    .optional().transform((v) => (v ? v : undefined)),
  contactPhone: z.string().transform((v) => v.trim()).refine((v) => v === "" || isAcceptablePartnerPhone(v), "Enter a valid phone number.")
    .optional().transform((v) => (v ? v : undefined)),
  website: z.string({ invalid_type_error: "Enter a valid website address." }).max(300, "Website must be 300 characters or fewer.").optional()
    .superRefine((v, ctx) => {
      if (v && v.trim() && !normalizeWebsite(v)) ctx.addIssue({ code: "custom", message: "Enter a valid website address." });
    })
    .transform((v) => (v && v.trim() ? normalizeWebsite(v) ?? undefined : undefined)),
  context: opt(1000, "Context"),
  permissionConfirmed: z.literal(true, { errorMap: () => ({ message: "Confirm that this contact has agreed to an introduction." }) }),
  permissionVersion: z.literal(PARTNER_INTRODUCTION_PERMISSION.version, { errorMap: () => ({ message: "Reload the page and confirm the current permission wording." }) }),
}).strict().superRefine((value, ctx) => {
  if (!value.contactEmail && !value.contactPhone) {
    ctx.addIssue({ code: "custom", path: ["contactEmail"], message: "Enter a business email or a phone number so we can follow up." });
  }
});
export type IntroductionBody = z.infer<typeof introductionBodySchema>;

export interface IntroductionIssue { field: string; message: string }
export function parseIntroductionBody(body: unknown): { ok: true; data: IntroductionBody } | { ok: false; issues: IntroductionIssue[] } {
  const parsed = introductionBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "form", message: i.message })) };
  return { ok: true, data: parsed.data };
}

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

export function introductionFingerprint(body: IntroductionBody): string {
  return sha256(JSON.stringify({
    b: body.businessName.toLowerCase(), n: body.contactName.toLowerCase(), e: body.contactEmail ?? "",
    p: (body.contactPhone ?? "").replace(/\D/g, ""), w: body.website ?? "", c: body.context ?? "",
  }));
}

export type SubmitIntroductionResult =
  | { kind: "recorded"; replayed: boolean; introduction: PartnerIntroduction }
  | { kind: "refused"; status: 403 | 409; code: "PARTNER_NOT_ACTIVE" | "IDEMPOTENCY_CONFLICT" };

/** Step 1: the durable occurrence. Commits before any contact work so a crash never loses a submitted introduction. */
export async function recordPartnerIntroduction(
  partner: Pick<Partner, "id">,
  actor: { userId: string | null },
  idempotencyKey: string,
  body: IntroductionBody,
  now: Date = new Date(),
): Promise<SubmitIntroductionResult> {
  const fingerprint = introductionFingerprint(body);
  return db.transaction(async (tx): Promise<SubmitIntroductionResult> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-introduction:" + partner.id + ":" + idempotencyKey}))`);
    // Active status is rechecked here, in the transaction that commits the introduction.
    const [current] = await tx.select({ id: partners.id, status: partners.status }).from(partners).where(eq(partners.id, partner.id)).for("share");
    if (!current || current.status !== "active") return { kind: "refused", status: 403, code: "PARTNER_NOT_ACTIVE" };
    const [existing] = await tx.select().from(partnerIntroductions)
      .where(and(eq(partnerIntroductions.partnerId, partner.id), eq(partnerIntroductions.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) return { kind: "refused", status: 409, code: "IDEMPOTENCY_CONFLICT" };
      return { kind: "recorded", replayed: true, introduction: existing };
    }
    const [created] = await tx.insert(partnerIntroductions).values({
      partnerId: partner.id,
      idempotencyKey,
      requestFingerprint: fingerprint,
      businessName: body.businessName,
      contactName: body.contactName,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      website: body.website ?? null,
      context: body.context ?? null,
      permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version,
      permissionTextSha256: sha256(PARTNER_INTRODUCTION_PERMISSION.text),
      permissionConfirmedAt: now,
      submittedByUserId: actor.userId,
      reviewState: "pending_review",
    }).returning();
    return { kind: "recorded", replayed: false, introduction: created };
  });
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

const eventKeyFor = (introductionId: string) => `partner_introduction:${introductionId}`;

/** The contact this occurrence already touched, and whether this occurrence created it (its first source event). */
async function findOccurrenceContact(introductionId: string): Promise<{ contactId: number; created: boolean } | null> {
  const [event] = await db.select({ contactId: contactSourceEvents.contactId, id: contactSourceEvents.id }).from(contactSourceEvents)
    .where(eq(contactSourceEvents.eventKey, eventKeyFor(introductionId))).limit(1);
  if (!event) return null;
  const [first] = await db.select({ id: contactSourceEvents.id }).from(contactSourceEvents)
    .where(eq(contactSourceEvents.contactId, event.contactId)).orderBy(asc(contactSourceEvents.id)).limit(1);
  return { contactId: event.contactId, created: first?.id === event.id };
}

async function anotherPartnersReferral(partnerId: number, contactId: number | null, email: string | null): Promise<boolean> {
  const identity: SQL[] = [];
  if (contactId) identity.push(eq(referrals.contactId, contactId));
  if (email) identity.push(sql`lower(${referrals.referredEmail}) = ${email}`);
  if (identity.length === 0) return false;
  const [other] = await db.select({ id: referrals.id }).from(referrals)
    .where(and(ne(referrals.partnerId, partnerId), or(...identity))).limit(1);
  return Boolean(other);
}

/**
 * Step 2 (repeatable): resolve the contact, record the referral for a genuinely new contact, set the review state and
 * write the internal review notification. Safe to run again for the same introduction: each part is keyed on it.
 */
export async function completePartnerIntroduction(introductionId: string): Promise<PartnerIntroduction> {
  return db.transaction(async (lockTx) => {
    await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-introduction-complete:" + introductionId}))`);
    return completeLocked(introductionId);
  });
}

async function completeLocked(introductionId: string): Promise<PartnerIntroduction> {
  const [intro] = await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, introductionId)).limit(1);
  if (!intro) throw new Error("INTRODUCTION_NOT_FOUND");
  if (intro.contactId !== null) return intro;

  const provenance = { sourceCategory: "partner_referral", sourceType: "partner_portal", eventKey: eventKeyFor(intro.id) };
  const email = intro.contactEmail ? intro.contactEmail.trim().toLowerCase() : null;
  let contactId: number | null = null;
  let createdHere = false;
  let reviewState: PartnerIntroduction["reviewState"] = "pending_review";
  let reviewReason: string | null = null;

  const prior = await findOccurrenceContact(intro.id);
  if (prior) {
    contactId = prior.contactId;
    createdHere = prior.created;
  } else {
    const existing = (email ? await storage.getContactByEmail(email) : undefined)
      ?? (intro.contactPhone ? (await storage.getContactByPhone(intro.contactPhone)) ?? undefined : undefined);
    if (existing) {
      await upsertContactSourceEvent({
        contactId: existing.id,
        provenance: { ...provenance, actorType: "partner", actorId: String(intro.partnerId), metadata: { introductionId: intro.id, via: "existing_contact" } },
      });
      contactId = existing.id;
    } else {
      const { firstName, lastName } = splitName(intro.contactName);
      // No marketing consent, no sequence tags: the introducer's permission is not the merchant's consent.
      const created = await createContactLocalFirst({
        firstName, lastName, email: email ?? "", phone: intro.contactPhone ?? "",
        companyName: intro.businessName, website: intro.website ?? undefined,
        status: "New", tags: ["src_partner_introduction"],
      } as any, { actorType: "partner", actorId: String(intro.partnerId) }, provenance);
      contactId = created.id;
      createdHere = created._intakeOutcome === "created";
      if (!createdHere) {
        await upsertContactSourceEvent({
          contactId: created.id,
          provenance: { ...provenance, actorType: "partner", actorId: String(intro.partnerId), metadata: { introductionId: intro.id, via: "matched_existing" } },
        });
      }
    }
  }

  let referralId: number | null = null;
  if (createdHere && contactId) {
    // A genuinely new contact: one referral for the introducing partner, unless a competing one already names this mailbox.
    if (await anotherPartnersReferral(intro.partnerId, contactId, email)) {
      reviewState = "competing_referrer";
      reviewReason = "ANOTHER_PARTNER_ALREADY_REFERRED";
    } else {
      const [existingReferral] = await db.select({ id: referrals.id }).from(referrals)
        .where(and(eq(referrals.partnerId, intro.partnerId), eq(referrals.contactId, contactId))).limit(1);
      if (existingReferral) referralId = existingReferral.id;
      else {
        const referral = await storage.createReferral({
          partnerId: intro.partnerId, contactId,
          referredName: intro.contactName, referredEmail: email, referredPhone: intro.contactPhone,
          referredCompany: intro.businessName, status: "pending", incentiveType: "commission",
          notes: `Partner introduction ${intro.id}`,
        } as any);
        referralId = referral.id;
        await db.update(partners).set({ totalReferrals: sql`COALESCE(${partners.totalReferrals}, 0) + 1` }).where(eq(partners.id, intro.partnerId)).catch(() => undefined);
      }
    }
  } else if (contactId) {
    const competing = await anotherPartnersReferral(intro.partnerId, contactId, email);
    reviewState = competing ? "competing_referrer" : "duplicate_review";
    reviewReason = competing ? "ANOTHER_PARTNER_ALREADY_REFERRED" : "CONTACT_ALREADY_EXISTS";
  }

  const [updated] = await db.update(partnerIntroductions).set({ contactId, referralId, reviewState, reviewReason, updatedAt: new Date() })
    .where(and(eq(partnerIntroductions.id, intro.id), sql`${partnerIntroductions.contactId} IS NULL`)).returning();

  try {
    const commandKey = `partner-introduction:${intro.id}:review`;
    const [prior] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.commandKey, commandKey)).limit(1);
    if (!prior) {
      await storage.createNotification({
        channel: "internal",
        title: reviewState === "pending_review" ? "New partner introduction" : "Partner introduction needs review",
        message: reviewState === "pending_review"
          ? `A partner introduced ${intro.businessName.slice(0, 120)}.`
          : `A partner introduced ${intro.businessName.slice(0, 120)}; it matches an existing record and is held for review.`,
        type: "alert",
        commandKey,
        metadata: { partnerId: intro.partnerId, introductionId: intro.id, link: "/dashboard/referral-program", eventType: "partner_introduction_received", audienceRoles: ["admin", "manager"], reviewState },
      } as any);
    }
  } catch (error) {
    // The introduction and its contact are durable; a missing notification is visible in the review list, never a lost record.
    logOperationalDiagnostic("partner_introduction", error, "review_notification_failed", { partnerId: intro.partnerId });
  }
  return updated ?? (await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, intro.id)).limit(1))[0];
}

export interface PartnerIntroductionView {
  reference: string;
  businessName: string;
  submittedAt: string;
  status: "received" | "under_review" | "accepted" | "declined";
  nextStep: string;
}

const STATUS_VIEW: Record<PartnerIntroduction["reviewState"], { status: PartnerIntroductionView["status"]; nextStep: string }> = {
  pending_review: { status: "received", nextStep: "Our team will review this introduction." },
  duplicate_review: { status: "under_review", nextStep: "Our team is reviewing this introduction against existing records." },
  competing_referrer: { status: "under_review", nextStep: "Our team is reviewing this introduction against existing records." },
  accepted: { status: "accepted", nextStep: "Our team has accepted this introduction." },
  declined: { status: "declined", nextStep: "This introduction was not accepted." },
};

/** The partner-facing shape: no contact details echoed back, no other partner's data, no attribution or commission detail. */
export function toPartnerIntroductionView(row: PartnerIntroduction): PartnerIntroductionView {
  const view = STATUS_VIEW[row.reviewState as PartnerIntroduction["reviewState"]] ?? STATUS_VIEW.pending_review;
  return { reference: row.id, businessName: row.businessName, submittedAt: row.createdAt.toISOString(), status: view.status, nextStep: view.nextStep };
}

export async function listPartnerIntroductionsFor(partnerId: number, limit = 50): Promise<PartnerIntroductionView[]> {
  const rows = await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.partnerId, partnerId))
    .orderBy(desc(partnerIntroductions.createdAt), desc(partnerIntroductions.id)).limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(toPartnerIntroductionView);
}

/** Staff review list (server-paginated, bounded). Includes the evidence links staff need; never returned to partners. */
export async function listIntroductionsForReview(opts: { reviewState?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 50);
  const page = Math.max(opts.page ?? 1, 1);
  const where = opts.reviewState && (INTRODUCTION_REVIEW_STATES as readonly string[]).includes(opts.reviewState)
    ? eq(partnerIntroductions.reviewState, opts.reviewState) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(partnerIntroductions).where(where);
  const rows = await db.select({
    id: partnerIntroductions.id, partnerId: partnerIntroductions.partnerId, partnerName: partners.companyName,
    businessName: partnerIntroductions.businessName, contactName: partnerIntroductions.contactName,
    reviewState: partnerIntroductions.reviewState, reviewReason: partnerIntroductions.reviewReason,
    contactId: partnerIntroductions.contactId, referralId: partnerIntroductions.referralId,
    permissionVersion: partnerIntroductions.permissionVersion, permissionConfirmedAt: partnerIntroductions.permissionConfirmedAt,
    createdAt: partnerIntroductions.createdAt,
  }).from(partnerIntroductions).innerJoin(partners, eq(partners.id, partnerIntroductions.partnerId))
    .where(where).orderBy(desc(partnerIntroductions.createdAt), desc(partnerIntroductions.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { rows, total: Number(total), page, pageSize };
}
