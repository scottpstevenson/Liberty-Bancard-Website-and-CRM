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
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { businesses, contactSourceEvents, contacts, notifications, partnerIntroductions, partners, referrals } from "@shared/schema";
import type { Partner, PartnerIntroduction } from "@shared/schema";
import { storage } from "../storage";
import { createContactLocalFirst, upsertContactSourceEvent } from "./contact-writer";
import { isAcceptablePartnerPhone } from "@shared/partner-application";
import { PARTNER_INTRODUCTION_PERMISSION } from "@shared/partner-public-content";
import { logOperationalDiagnostic } from "../utils/server-error";
import { normalizeBusinessDomain, SHARED_EMAIL_DOMAINS } from "./contact-business-reconciliation";
import { appendReviewEvent, listReviewEvents, staffDisplayNames, type ReviewEventView } from "./partner-review-events";

export const INTRODUCTION_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INTRODUCTION_REVIEW_STATES = ["pending_review", "duplicate_review", "competing_referrer", "accepted", "declined"] as const;

const clean = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const req = (max: number, label: string) =>
  z.string({ error: `${label} is required.` })
    .transform(clean).pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));
const opt = (max: number, label: string) =>
  z.string({ error: `${label} must be text.` }).transform(clean).pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
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
  website: z.string({ error: "Enter a valid website address." }).max(300, "Website must be 300 characters or fewer.").optional()
    .superRefine((v, ctx) => {
      if (v && v.trim() && !normalizeWebsite(v)) ctx.addIssue({ code: "custom", message: "Enter a valid website address." });
    })
    .transform((v) => (v && v.trim() ? normalizeWebsite(v) ?? undefined : undefined)),
  context: opt(1000, "Context"),
  permissionConfirmed: z.literal(true, { error: "Confirm that this contact has agreed to an introduction." }),
  permissionVersion: z.literal(PARTNER_INTRODUCTION_PERMISSION.version, { error: "Reload the page and confirm the current permission wording." }),
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

// ── Business-identity evidence ───────────────────────────────────────────────────────────────────────────────────────
// The mailbox/phone match above is exact. A different person at the same business, or a second partner introducing the
// same business, is not an exact match, so it needs corroborated business evidence from the existing authority: the
// canonical `businesses` registry (website domain) and other partners' standing claims. Genuine ambiguity is held for
// staff; it is never merged, never re-attributed and never silently credited.

/** First capture group of a stored website URL: the host, without scheme or leading www. (bound as a parameter, so no SQL escaping). */
const WEBSITE_HOST_PATTERN = String.raw`^(?:https?://)?(?:www\.)?([^/:?#]+)`;

/** Hosts that identify a platform, not a business. A shared host never counts as business evidence. */
const NON_BUSINESS_HOSTS = new Set([
  "facebook.com", "instagram.com", "yelp.com", "linkedin.com", "google.com", "linktr.ee", "x.com", "twitter.com",
  "wixsite.com", "squarespace.com", "godaddysites.com", "business.site", "weebly.com", "youtube.com", "tiktok.com",
]);

function businessDomainFor(intro: PartnerIntroduction): string | null {
  const fromSite = normalizeBusinessDomain(intro.website);
  if (fromSite && !NON_BUSINESS_HOSTS.has(fromSite)) return fromSite;
  const emailDomain = intro.contactEmail ? intro.contactEmail.split("@")[1]?.trim().toLowerCase() : null;
  if (emailDomain && !SHARED_EMAIL_DOMAINS.has(emailDomain) && !NON_BUSINESS_HOSTS.has(emailDomain)) return emailDomain;
  return null;
}

export interface BusinessEvidence {
  domain: string | null;
  businessIds: number[];
  contactIds: number[];
  /** Another partner already holds a claim on this business (a referral or an earlier introduction). */
  otherClaims: Array<{ kind: "referral" | "introduction"; id: string; partnerId: number | null; partnerName: string | null }>;
}

export async function gatherBusinessEvidence(intro: PartnerIntroduction, selfContactId: number | null): Promise<BusinessEvidence> {
  const domain = businessDomainFor(intro);
  const empty: BusinessEvidence = { domain, businessIds: [], contactIds: [], otherClaims: [] };
  if (!domain) return empty;

  const registry = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.websiteDomain, domain)).limit(5);
  const businessIds = registry.map((b) => b.id);
  const linked = businessIds.length
    ? await db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.businessId, businessIds), isNull(contacts.archivedAt))).limit(10)
    : [];
  const contactIds = linked.map((c) => c.id).filter((id) => id !== selfContactId);

  const otherClaims: BusinessEvidence["otherClaims"] = [];
  const emailLike = `%@${domain}`;
  const referralRows = await db.select({ id: referrals.id, partnerId: referrals.partnerId, partnerName: partners.companyName })
    .from(referrals).innerJoin(partners, eq(partners.id, referrals.partnerId))
    .where(and(ne(referrals.partnerId, intro.partnerId), or(
      sql`lower(${referrals.referredEmail}) LIKE ${emailLike}`,
      contactIds.length ? inArray(referrals.contactId, contactIds) : sql`false`,
    ))).limit(3);
  for (const r of referralRows) otherClaims.push({ kind: "referral", id: String(r.id), partnerId: r.partnerId, partnerName: r.partnerName ?? null });

  // An earlier introduction from another partner for the same business wins; a later one is held. The (created_at, id)
  // order is the same for both partners' passes, so concurrent introductions resolve identically in any timing.
  const hostMatch = sql`substring(lower(coalesce(${partnerIntroductions.website}, '')) from ${WEBSITE_HOST_PATTERN}) = ${domain}`;
  const earlier = await db.select({ id: partnerIntroductions.id, partnerId: partnerIntroductions.partnerId, partnerName: partners.companyName })
    .from(partnerIntroductions).innerJoin(partners, eq(partners.id, partnerIntroductions.partnerId))
    .where(and(
      ne(partnerIntroductions.partnerId, intro.partnerId),
      ne(partnerIntroductions.reviewState, "declined"),
      sql`(${partnerIntroductions.createdAt}, ${partnerIntroductions.id}) < (${intro.createdAt}, ${intro.id})`,
      or(hostMatch, sql`lower(coalesce(${partnerIntroductions.contactEmail}, '')) LIKE ${emailLike}`),
    )).limit(3);
  for (const e of earlier) otherClaims.push({ kind: "introduction", id: e.id, partnerId: e.partnerId, partnerName: e.partnerName ?? null });

  return { domain, businessIds, contactIds, otherClaims };
}

// ── Completion: explicit, individually idempotent checkpoints ───────────────────────────────────────────────────────

export type CompletionStep = "contact" | "referral" | "count" | "notification";
const checkpointsComplete = (row: PartnerIntroduction) =>
  Boolean(row.contactCheckpointAt && row.referralCheckpointAt && row.countCheckpointAt && row.notificationCheckpointAt);

/** Re-read the row after a failed pass so the response reflects exactly which checkpoints exist. */
export async function refreshIntroduction(intro: PartnerIntroduction): Promise<PartnerIntroduction> {
  const [row] = await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, intro.id)).limit(1);
  return row ?? intro;
}

async function loadIntroduction(id: string): Promise<PartnerIntroduction> {
  const [row] = await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, id)).limit(1);
  if (!row) throw new Error("INTRODUCTION_NOT_FOUND");
  return row;
}

/**
 * Local completion of one introduction. Each step is individually idempotent and persists its own checkpoint, so a crash
 * or failure at any boundary leaves a record of exactly what is done; the recovery sweep and any replay resume from the
 * first missing checkpoint. `completion_state` is `complete` only when every checkpoint is set. A failing step stores a
 * non-sensitive error code and a `held` state, and rethrows so the caller can log it; nothing here is ever sent anywhere.
 *
 * The per-introduction advisory lock (and, below, the identity lock) only serialize passes. Writes that must be atomic
 * use their own transaction handle (the referral count and its checkpoint); the others are deliberately separate and
 * made safe by their checkpoints.
 */
export async function completePartnerIntroduction(introductionId: string): Promise<PartnerIntroduction> {
  return db.transaction(async (lockTx) => {
    await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-introduction-complete:" + introductionId}))`);
    return completeLocked(introductionId, lockTx);
  });
}

async function completeLocked(introductionId: string, lockTx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<PartnerIntroduction> {
  let intro = await loadIntroduction(introductionId);
  if (intro.completionState === "complete" && checkpointsComplete(intro)) return intro;

  // Two partners introducing the same person must not interleave their contact/referral decisions.
  const identity = intro.contactEmail?.trim().toLowerCase() || intro.contactPhone?.replace(/\D/g, "") || businessDomainFor(intro) || intro.id;
  await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-introduction-identity:" + identity}))`);
  intro = await loadIntroduction(introductionId);

  await db.update(partnerIntroductions).set({
    completionAttempts: sql`${partnerIntroductions.completionAttempts} + 1`,
    completionLastAttemptAt: new Date(),
  }).where(eq(partnerIntroductions.id, intro.id));

  let step: CompletionStep = "contact";
  try {
    if (!intro.contactCheckpointAt) {
      step = "contact";
      intro = await completeContactStep(intro);
    }
    if (!intro.referralCheckpointAt) {
      step = "referral";
      intro = await completeReferralStep(intro);
    }
    if (!intro.countCheckpointAt) {
      step = "count";
      intro = await completeCountStep(intro);
    }
    if (!intro.notificationCheckpointAt) {
      step = "notification";
      intro = await completeNotificationStep(intro);
    }
  } catch (error) {
    const code = `STEP_${step.toUpperCase()}_FAILED`;
    await db.update(partnerIntroductions).set({ completionState: "held", completionErrorCode: code })
      .where(eq(partnerIntroductions.id, intro.id)).catch(() => undefined);
    logOperationalDiagnostic("partner_introduction", error, "completion_step_failed", { partnerId: intro.partnerId, step });
    throw error;
  }

  const [done] = await db.update(partnerIntroductions).set({ completionState: "complete", completionErrorCode: null })
    .where(and(
      eq(partnerIntroductions.id, intro.id),
      isNotNull(partnerIntroductions.contactCheckpointAt), isNotNull(partnerIntroductions.referralCheckpointAt),
      isNotNull(partnerIntroductions.countCheckpointAt), isNotNull(partnerIntroductions.notificationCheckpointAt),
    )).returning();
  return done ?? loadIntroduction(intro.id);
}

/** Step 1: the contact. Links an existing contact (never modified) or creates one through the canonical writer. */
async function completeContactStep(intro: PartnerIntroduction): Promise<PartnerIntroduction> {
  const provenance = { sourceCategory: "partner_referral", sourceType: "partner_portal", eventKey: eventKeyFor(intro.id) };
  const email = intro.contactEmail ? intro.contactEmail.trim().toLowerCase() : null;
  let contactId: number | null = intro.contactId;

  if (contactId === null) {
    const prior = await findOccurrenceContact(intro.id);
    if (prior) {
      contactId = prior.contactId;
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
        if (created._intakeOutcome !== "created") {
          await upsertContactSourceEvent({
            contactId: created.id,
            provenance: { ...provenance, actorType: "partner", actorId: String(intro.partnerId), metadata: { introductionId: intro.id, via: "matched_existing" } },
          });
        }
      }
    }
  } else if (!(await findOccurrenceContact(intro.id))) {
    // A contact id recorded without this occurrence's source evidence (older flow): append the evidence, idempotently.
    await upsertContactSourceEvent({
      contactId,
      provenance: { ...provenance, actorType: "partner", actorId: String(intro.partnerId), metadata: { introductionId: intro.id, via: "existing_contact" } },
    });
  }

  // The link and its checkpoint are one write: either both are visible after a crash or neither is.
  const [updated] = await db.update(partnerIntroductions)
    .set({ contactId, contactCheckpointAt: new Date(), updatedAt: new Date() })
    .where(and(eq(partnerIntroductions.id, intro.id), isNull(partnerIntroductions.contactCheckpointAt))).returning();
  return updated ?? loadIntroduction(intro.id);
}

/** Step 2: review state and, for a clearly new business with no competing claim, the one referral for this partner. */
async function completeReferralStep(intro: PartnerIntroduction): Promise<PartnerIntroduction> {
  if (intro.contactId === null) throw new Error("INTRODUCTION_CONTACT_MISSING");
  const contactId = intro.contactId;
  const email = intro.contactEmail ? intro.contactEmail.trim().toLowerCase() : null;
  const occurrence = await findOccurrenceContact(intro.id);
  if (!occurrence) throw new Error("INTRODUCTION_CONTACT_EVENT_MISSING");

  let reviewState: PartnerIntroduction["reviewState"] = "pending_review";
  let reviewReason: string | null = null;
  let referralId: number | null = null;

  if (occurrence.created) {
    const evidence = await gatherBusinessEvidence(intro, contactId);
    const [priorReferral] = await db.select({ id: referrals.id }).from(referrals)
      .where(and(eq(referrals.partnerId, intro.partnerId), eq(referrals.contactId, contactId))).limit(1);
    if (priorReferral) {
      // A pass that crashed after creating the referral: reuse it (the count step reconciles the total once).
      referralId = priorReferral.id;
    } else if (await anotherPartnersReferral(intro.partnerId, contactId, email)) {
      reviewState = "competing_referrer";
      reviewReason = "ANOTHER_PARTNER_ALREADY_REFERRED";
    } else if (evidence.otherClaims.length > 0) {
      reviewState = "competing_referrer";
      reviewReason = "ANOTHER_PARTNER_REFERRED_SAME_BUSINESS";
    } else if (evidence.contactIds.length > 0) {
      // Another person already in the CRM at this business: possibly the same merchant, possibly a separate location.
      reviewState = "duplicate_review";
      reviewReason = "SAME_BUSINESS_EVIDENCE";
    } else {
      const referral = await storage.createReferral({
        partnerId: intro.partnerId, contactId,
        referredName: intro.contactName, referredEmail: email, referredPhone: intro.contactPhone,
        referredCompany: intro.businessName, status: "pending", incentiveType: "commission",
        notes: `Partner introduction ${intro.id}`,
      } as any);
      referralId = referral.id;
    }
  } else {
    const competing = await anotherPartnersReferral(intro.partnerId, contactId, email);
    reviewState = competing ? "competing_referrer" : "duplicate_review";
    reviewReason = competing ? "ANOTHER_PARTNER_ALREADY_REFERRED" : "CONTACT_ALREADY_EXISTS";
  }

  const now = new Date();
  const [updated] = await db.update(partnerIntroductions).set({
    referralId, reviewState, reviewReason, referralCheckpointAt: now, revision: sql`${partnerIntroductions.revision} + 1`, updatedAt: now,
  }).where(and(
    eq(partnerIntroductions.id, intro.id), isNull(partnerIntroductions.referralCheckpointAt),
    inArray(partnerIntroductions.reviewState, ["pending_review", "duplicate_review", "competing_referrer"]),
  )).returning();
  return updated ?? loadIntroduction(intro.id);
}

/**
 * Step 3: referral total. The checkpoint claim and the increment are one transaction, so the partner's total moves by
 * exactly one for an introduction's referral no matter how many passes run or where a pass stops. An introduction with no
 * referral (held for review) settles this step without changing any total.
 */
async function completeCountStep(intro: PartnerIntroduction): Promise<PartnerIntroduction> {
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(partnerIntroductions).set({ countCheckpointAt: new Date() })
      .where(and(eq(partnerIntroductions.id, intro.id), isNull(partnerIntroductions.countCheckpointAt), isNotNull(partnerIntroductions.referralCheckpointAt)))
      .returning({ referralId: partnerIntroductions.referralId });
    if (claimed && claimed.referralId !== null) {
      await tx.update(partners).set({ totalReferrals: sql`COALESCE(${partners.totalReferrals}, 0) + 1` }).where(eq(partners.id, intro.partnerId));
    }
  });
  return loadIntroduction(intro.id);
}

/** Step 4: the internal review notification, command-keyed so a replay reuses the one that exists. Independent of contactId. */
async function completeNotificationStep(intro: PartnerIntroduction): Promise<PartnerIntroduction> {
  const commandKey = `partner-introduction:${intro.id}:review`;
  const [prior] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.commandKey, commandKey)).limit(1);
  if (!prior) {
    await storage.createNotification({
      channel: "internal",
      title: intro.reviewState === "pending_review" ? "New partner introduction" : "Partner introduction needs review",
      message: intro.reviewState === "pending_review"
        ? `A partner introduced ${intro.businessName.slice(0, 120)}.`
        : `A partner introduced ${intro.businessName.slice(0, 120)}; it matches an existing record and is held for review.`,
      type: "alert",
      commandKey,
      metadata: { partnerId: intro.partnerId, introductionId: intro.id, link: "/dashboard/referral-program", eventType: "partner_introduction_received", audienceRoles: ["admin", "manager"], reviewState: intro.reviewState },
    } as any);
  }
  const [updated] = await db.update(partnerIntroductions).set({ notificationCheckpointAt: new Date() })
    .where(and(eq(partnerIntroductions.id, intro.id), isNull(partnerIntroductions.notificationCheckpointAt))).returning();
  return updated ?? loadIntroduction(intro.id);
}

export const INTRODUCTION_RECOVERY_MIN_AGE_MS = 30_000;
export const INTRODUCTION_RETRY_BASE_SECONDS = 60;
export const INTRODUCTION_RETRY_MAX_SECONDS = 3600;

/**
 * Ordinary background recovery for introductions whose local completion stopped part-way (crash, restart, a failing
 * step). It runs inside the existing partner recovery tick: no browser retry, no new timer, no send, no campaign.
 * Eligible rows: not complete, never attempted and old enough that the request path is surely finished, or last
 * attempted longer ago than a capped exponential backoff. Every pass resumes from the first missing checkpoint.
 */
export async function recoverPartnerIntroductions(opts: { now?: Date; limit?: number } = {}): Promise<{ examined: number; completed: number; held: number }> {
  const now = opts.now ?? new Date();
  const young = new Date(now.getTime() - INTRODUCTION_RECOVERY_MIN_AGE_MS);
  const rows = await db.select({ id: partnerIntroductions.id }).from(partnerIntroductions).where(and(
    ne(partnerIntroductions.completionState, "complete"),
    or(
      and(isNull(partnerIntroductions.completionLastAttemptAt), lt(partnerIntroductions.createdAt, young)),
      sql`${partnerIntroductions.completionLastAttemptAt} < ${now.toISOString()}::timestamptz - LEAST(${INTRODUCTION_RETRY_BASE_SECONDS}::int * power(2, LEAST(${partnerIntroductions.completionAttempts}, 12)), ${INTRODUCTION_RETRY_MAX_SECONDS}::int) * interval '1 second'`,
    ),
  )).orderBy(sql`${partnerIntroductions.completionLastAttemptAt} NULLS FIRST`, asc(partnerIntroductions.createdAt)).limit(Math.min(Math.max(opts.limit ?? 25, 1), 100));
  const out = { examined: rows.length, completed: 0, held: 0 };
  for (const row of rows) {
    try {
      const done = await completePartnerIntroduction(row.id);
      if (done.completionState === "complete") out.completed += 1; else out.held += 1;
    } catch {
      out.held += 1; // the step's code is already stored and logged by completeLocked
    }
  }
  return out;
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

/**
 * The partner-facing shape: no contact details echoed back, no other partner's data, no attribution or commission detail.
 * An introduction whose internal recording is still finishing is shown as received, never as reviewed.
 */
export function toPartnerIntroductionView(row: PartnerIntroduction): PartnerIntroductionView {
  const view = STATUS_VIEW[row.reviewState as PartnerIntroduction["reviewState"]] ?? STATUS_VIEW.pending_review;
  const finishing = row.completionState !== "complete" && row.reviewState === "pending_review";
  return {
    reference: row.id, businessName: row.businessName, submittedAt: row.createdAt.toISOString(),
    status: view.status,
    nextStep: finishing ? "We have your introduction and are finishing recording it. You do not need to submit it again." : view.nextStep,
  };
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
    revision: partnerIntroductions.revision, completionState: partnerIntroductions.completionState,
    completionErrorCode: partnerIntroductions.completionErrorCode,
    contactId: partnerIntroductions.contactId, referralId: partnerIntroductions.referralId,
    permissionVersion: partnerIntroductions.permissionVersion, permissionConfirmedAt: partnerIntroductions.permissionConfirmedAt,
    createdAt: partnerIntroductions.createdAt,
  }).from(partnerIntroductions).innerJoin(partners, eq(partners.id, partnerIntroductions.partnerId))
    .where(where).orderBy(desc(partnerIntroductions.createdAt), desc(partnerIntroductions.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { rows, total: Number(total), page, pageSize };
}

// ── Staff decisions ──────────────────────────────────────────────────────────────────────────────────────────────────
//
// An administrator resolves an introduction with an explicit command. Every command:
//   - names the revision the staff screen showed (a stale screen cannot overwrite a newer decision),
//   - requires a written reason,
//   - writes actor, time, reason, the new state and the history event in one transaction,
//   - touches nothing else: no contact is edited or merged, no referral is created or reassigned, no partner total or
//     commission changes, and another partner's allocation is never read for writing.
// A decision is refused while the introduction's contact/referral steps are unfinished (identity is not yet resolved).

export const INTRODUCTION_COMMANDS = ["accept", "decline", "resolve_duplicate", "keep_existing_referrer"] as const;
export type IntroductionCommand = (typeof INTRODUCTION_COMMANDS)[number];

const COMMAND_RULES: Record<IntroductionCommand, { from: ReadonlyArray<PartnerIntroduction["reviewState"]>; to: "accepted" | "declined"; reason: (from: string) => string }> = {
  accept: { from: ["pending_review", "duplicate_review"], to: "accepted", reason: (from) => (from === "duplicate_review" ? "ACCEPTED_EXISTING_RECORD_KEPT" : "ACCEPTED_BY_STAFF") },
  decline: { from: ["pending_review", "duplicate_review", "competing_referrer"], to: "declined", reason: () => "DECLINED_BY_STAFF" },
  resolve_duplicate: { from: ["duplicate_review"], to: "declined", reason: () => "DUPLICATE_OF_EXISTING_RECORD" },
  keep_existing_referrer: { from: ["competing_referrer"], to: "declined", reason: () => "COMPETING_REFERRER_EXISTING_KEPT" },
};

export function allowedIntroductionCommands(row: Pick<PartnerIntroduction, "reviewState" | "referralCheckpointAt">): IntroductionCommand[] {
  if (!row.referralCheckpointAt) return [];
  return INTRODUCTION_COMMANDS.filter((command) => COMMAND_RULES[command].from.includes(row.reviewState as PartnerIntroduction["reviewState"]));
}

const INTRODUCTION_NOTE_MAX = 2000;

export interface IntroductionDecisionInput { command: unknown; expectedRevision: unknown; note?: unknown }
export type IntroductionDecisionResult =
  | { ok: true; introduction: PartnerIntroduction }
  | { ok: false; status: 400 | 404 | 409; code: string };

export async function decidePartnerIntroduction(id: string, input: IntroductionDecisionInput, actorId: string, now: Date = new Date()): Promise<IntroductionDecisionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, code: "NOT_FOUND" };
  const command = typeof input.command === "string" ? input.command : "";
  if (!(INTRODUCTION_COMMANDS as readonly string[]).includes(command)) return { ok: false, status: 400, code: "INVALID_COMMAND" };
  const expected = input.expectedRevision;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) return { ok: false, status: 400, code: "REVISION_REQUIRED" };
  if (typeof input.note !== "string") return { ok: false, status: 400, code: "NOTE_REQUIRED" };
  const note = clean(input.note).slice(0, INTRODUCTION_NOTE_MAX);
  if (!note) return { ok: false, status: 400, code: "NOTE_REQUIRED" };
  if (!actorId) return { ok: false, status: 400, code: "ACTOR_REQUIRED" };
  const rule = COMMAND_RULES[command as IntroductionCommand];

  return db.transaction(async (tx): Promise<IntroductionDecisionResult> => {
    const [row] = await tx.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, id)).for("update");
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND" };
    if (row.revision !== expected) return { ok: false, status: 409, code: "STALE_REVISION" };
    if (row.reviewState === "accepted" || row.reviewState === "declined") return { ok: false, status: 409, code: "INTRODUCTION_ALREADY_DECIDED" };
    if (!row.referralCheckpointAt) return { ok: false, status: 409, code: "INTRODUCTION_PROCESSING" };
    if (!rule.from.includes(row.reviewState as PartnerIntroduction["reviewState"])) return { ok: false, status: 409, code: "COMMAND_NOT_ALLOWED_FOR_STATE" };

    const reason = rule.reason(row.reviewState);
    const [updated] = await tx.update(partnerIntroductions).set({
      reviewState: rule.to, reviewReason: reason, revision: row.revision + 1,
      decidedBy: actorId, decidedAt: now, decisionNote: note, updatedAt: now,
    }).where(and(eq(partnerIntroductions.id, id), eq(partnerIntroductions.revision, expected))).returning();
    if (!updated) return { ok: false, status: 409, code: "STALE_REVISION" };
    await appendReviewEvent(tx, {
      subjectType: "introduction", subjectId: id, eventType: command,
      fromStatus: row.reviewState, toStatus: rule.to, fromRevision: row.revision, toRevision: updated.revision,
      actorId, note, at: now,
      details: { reasonCode: reason, previousReasonCode: row.reviewReason, contactId: row.contactId, referralId: row.referralId, partnerId: row.partnerId },
    });
    return { ok: true, introduction: updated };
  });
}

// ── Staff detail ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IntroductionDetail {
  introduction: {
    id: string; reviewState: string; reviewReason: string | null; revision: number;
    businessName: string; contactName: string; contactEmail: string | null; contactPhone: string | null; website: string | null; context: string | null;
    submittedAt: string; decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
    permission: { version: string; textSha256: string; confirmedAt: string };
    completion: { state: string; attempts: number; lastAttemptAt: string | null; errorCode: string | null;
      checkpoints: { contact: string | null; referral: string | null; notification: string | null; count: string | null } };
  };
  partner: { id: number; company: string; name: string | null; status: string | null };
  linked: {
    contact: { id: number; name: string; company: string | null; createdByThisIntroduction: boolean } | null;
    referral: { id: number; status: string | null } | null;
  };
  /** Other partners' claims and other CRM contacts at the same business. Staff-only; never shown to partners. */
  evidence: {
    domain: string | null;
    businessIds: number[];
    otherContacts: Array<{ id: number; name: string; company: string | null }>;
    otherClaims: Array<{ kind: "referral" | "introduction"; id: string; partnerId: number | null; partnerName: string | null }>;
  };
  history: ReviewEventView[];
  allowedCommands: IntroductionCommand[];
}

export async function getPartnerIntroductionDetail(id: string): Promise<IntroductionDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(partnerIntroductions).where(eq(partnerIntroductions.id, id)).limit(1);
  if (!row) return null;
  const partner = await storage.getPartner(row.partnerId);
  if (!partner) return null;
  const contact = row.contactId ? await storage.getContact(row.contactId) : undefined;
  const [referral] = row.referralId ? await db.select({ id: referrals.id, status: referrals.status }).from(referrals).where(eq(referrals.id, row.referralId)).limit(1) : [];
  const occurrence = row.contactId ? await findOccurrenceContact(row.id) : null;
  const evidence = await gatherBusinessEvidence(row, row.contactId);
  const others = evidence.contactIds.length
    ? await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, companyName: contacts.companyName })
      .from(contacts).where(inArray(contacts.id, evidence.contactIds)).limit(10)
    : [];
  const history = await listReviewEvents("introduction", row.id);
  const names = await staffDisplayNames([row.decidedBy]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    introduction: {
      id: row.id, reviewState: row.reviewState, reviewReason: row.reviewReason, revision: row.revision,
      businessName: row.businessName, contactName: row.contactName, contactEmail: row.contactEmail, contactPhone: row.contactPhone,
      website: row.website, context: row.context, submittedAt: row.createdAt.toISOString(),
      decidedBy: row.decidedBy, decidedByName: row.decidedBy ? names.get(row.decidedBy) ?? null : null,
      decidedAt: iso(row.decidedAt), decisionNote: row.decisionNote,
      permission: { version: row.permissionVersion, textSha256: row.permissionTextSha256, confirmedAt: row.permissionConfirmedAt.toISOString() },
      completion: {
        state: row.completionState, attempts: row.completionAttempts, lastAttemptAt: iso(row.completionLastAttemptAt), errorCode: row.completionErrorCode,
        checkpoints: { contact: iso(row.contactCheckpointAt), referral: iso(row.referralCheckpointAt), notification: iso(row.notificationCheckpointAt), count: iso(row.countCheckpointAt) },
      },
    },
    partner: { id: partner.id, company: partner.companyName, name: partner.contactName, status: partner.status },
    linked: {
      contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || "Unnamed contact", company: contact.companyName ?? null, createdByThisIntroduction: Boolean(occurrence?.created) } : null,
      referral: referral ? { id: referral.id, status: referral.status ?? null } : null,
    },
    evidence: {
      domain: evidence.domain, businessIds: evidence.businessIds,
      otherContacts: others.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Unnamed contact", company: c.companyName ?? null })),
      otherClaims: evidence.otherClaims,
    },
    history,
    allowedCommands: allowedIntroductionCommands(row),
  };
}
