/**
 * Staff review of partner applications.
 *
 * Reading: server-paginated, bounded filters, no unbounded roster load. The list never carries private answers; the
 * detail does, and only for the staff roles the route admits.
 *
 * Deciding (administrators only, enforced by the route): the decision runs in one transaction that
 *   - locks the application row and compares the caller's revision (a stale screen cannot overwrite a newer decision),
 *   - verifies the application is still open and its partner is still the pending, credential-less row created with it,
 *   - on acceptance requires explicit commission terms and the agreement/schedule reference the terms come from, writes
 *     them to the partner, and enqueues exactly one invitation intent through the approval-delivery owner,
 *   - records actor and time from the session.
 * Nothing is sent from here. The actor, the rate and the partner are never taken from the body. Acceptance of an
 * application is not marketing consent and starts no sequence, campaign or outbound activity.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { notifications, partnerApplications, partnerApprovalDeliveries, partners } from "@shared/schema";
import type { PartnerApplication, PartnerApprovalDelivery, Partner } from "@shared/schema";
import { updatePartnerWithApproval } from "./partner-approval-delivery";
import { revokeAuthActions } from "./auth-actions";
import { storage } from "../storage";
import { formatPartnerTerms, PARTNER_PATH_IDS } from "@shared/partner-public-content";

export const APPLICATION_REVIEW_STATUSES = ["pending_review", "needs_info", "accepted", "declined", "withdrawn", "superseded"] as const;
export type ApplicationReviewStatus = (typeof APPLICATION_REVIEW_STATUSES)[number];
export const APPLICATION_PAGE_SIZE_MAX = 50;
export const SCHEDULE_REFERENCE_MAX = 200;
const NOTE_MAX = 2000;

export interface ApplicationListFilters {
  status?: string;
  path?: string;
  profession?: string;
  /** `assigned`: the intake notification recorded an owner; `unassigned`: no owner was resolved (no assignment policy, or held). */
  owner?: "assigned" | "unassigned";
  page?: number;
  pageSize?: number;
}

export interface ApplicationListRow {
  id: string;
  receivedAt: string;
  applicantName: string | null;
  company: string | null;
  path: string;
  profession: string | null;
  region: string | null;
  reviewStatus: string;
  revision: number;
  assignedOwner: string | null;
  dueAt: string | null;
  reviewPolicy: string | null;
  termsState: "pending" | "recorded";
  partnerStatus: string | null;
}

const clampPage = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 && (value as number) < 10_000 ? (value as number) : 1);
const clampSize = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, APPLICATION_PAGE_SIZE_MAX) : 25);

export function normalizeApplicationFilters(query: Record<string, unknown>): ApplicationListFilters {
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 60 ? v : undefined);
  const num = (v: unknown) => (typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : undefined);
  const status = str(query.status);
  const path = str(query.path);
  return {
    status: status && (APPLICATION_REVIEW_STATUSES as readonly string[]).includes(status) ? status : undefined,
    path: path && (PARTNER_PATH_IDS as readonly string[]).includes(path) ? path : undefined,
    profession: str(query.profession),
    owner: query.owner === "assigned" || query.owner === "unassigned" ? query.owner : undefined,
    page: clampPage(num(query.page)),
    pageSize: clampSize(num(query.pageSize)),
  };
}

export async function listPartnerApplications(filters: ApplicationListFilters): Promise<{ rows: ApplicationListRow[]; total: number; page: number; pageSize: number }> {
  const page = clampPage(filters.page);
  const pageSize = clampSize(filters.pageSize);
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(partnerApplications.reviewStatus, filters.status));
  if (filters.path) conditions.push(eq(partnerApplications.path, filters.path));
  if (filters.profession) conditions.push(eq(partnerApplications.profession, filters.profession));
  if (filters.owner) {
    const hasOwner = sql`EXISTS (
      SELECT 1 FROM ${notifications} n
      WHERE n.inbound_request_id = ${partnerApplications.inboundRequestId}
        AND n.metadata->>'eventType' = 'partner_application_received'
        AND COALESCE(n.metadata->>'reviewOwnerUserId', '') <> ''
    )`;
    conditions.push(filters.owner === "assigned" ? hasOwner : sql`NOT ${hasOwner}`);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(partnerApplications).where(where);
  const rows = await db.select({
    id: partnerApplications.id,
    createdAt: partnerApplications.createdAt,
    path: partnerApplications.path,
    profession: partnerApplications.profession,
    answers: partnerApplications.answers,
    reviewStatus: partnerApplications.reviewStatus,
    revision: partnerApplications.revision,
    inboundRequestId: partnerApplications.inboundRequestId,
    contactName: partners.contactName,
    companyName: partners.companyName,
    partnerStatus: partners.status,
    commissionPercent: partners.commissionPercent,
  }).from(partnerApplications)
    .innerJoin(partners, eq(partners.id, partnerApplications.partnerId))
    .where(where)
    .orderBy(desc(partnerApplications.createdAt), desc(partnerApplications.id))
    .limit(pageSize).offset((page - 1) * pageSize);

  const requestIds = rows.map((r) => r.inboundRequestId);
  const carriers = requestIds.length
    ? await db.select({ inboundRequestId: notifications.inboundRequestId, metadata: notifications.metadata }).from(notifications)
      .where(and(inArray(notifications.inboundRequestId, requestIds), sql`${notifications.metadata}->>'eventType' = 'partner_application_received'`))
    : [];
  const byRequest = new Map(carriers.map((c) => [c.inboundRequestId, (c.metadata ?? {}) as Record<string, unknown>]));

  return {
    total: Number(total),
    page,
    pageSize,
    rows: rows.map((r) => {
      const meta = byRequest.get(r.inboundRequestId) ?? {};
      const answers = (r.answers ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        receivedAt: r.createdAt.toISOString(),
        applicantName: r.contactName ?? null,
        company: (typeof answers.company === "string" && answers.company) || r.companyName || null,
        path: r.path,
        profession: r.profession,
        region: typeof answers.region === "string" ? answers.region : null,
        reviewStatus: r.reviewStatus,
        revision: r.revision,
        assignedOwner: typeof meta.reviewOwnerUserId === "string" ? meta.reviewOwnerUserId : null,
        dueAt: typeof meta.reviewDueAt === "string" ? meta.reviewDueAt : null,
        reviewPolicy: typeof meta.reviewPolicy === "string" ? meta.reviewPolicy : null,
        termsState: r.commissionPercent === null || r.commissionPercent === undefined ? "pending" : "recorded",
        partnerStatus: r.partnerStatus ?? null,
      } satisfies ApplicationListRow;
    }),
  };
}

export interface ApplicationDetail {
  application: {
    id: string; path: string; profession: string | null; answers: Record<string, unknown>;
    contactConsent: { version: string; purpose: string; textSha256: string; acceptedAt: string };
    marketing: { optIn: boolean; disclosureId: string | null };
    sourcePage: string | null; attribution: Record<string, unknown>;
    reviewStatus: string; revision: number; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
    scheduleReference: string | null; receivedAt: string; inboundRequestId: string;
  };
  partner: { id: number; name: string | null; company: string; email: string | null; phone: string | null; partnerType: string | null; status: string | null; terms: string };
  contactId: number | null;
  invitation: { id: string; kind: string; state: string; generation: number; waitReason: string | null; terminalReason: string | null; updatedAt: string } | null;
  assignment: { owner: string | null; dueAt: string | null; policy: string | null; gap: string | null };
}

export async function getPartnerApplicationDetail(id: string): Promise<ApplicationDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [application] = await db.select().from(partnerApplications).where(eq(partnerApplications.id, id)).limit(1);
  if (!application) return null;
  const partner = await storage.getPartner(application.partnerId);
  if (!partner) return null;
  const [delivery] = await db.select().from(partnerApprovalDeliveries)
    .where(eq(partnerApprovalDeliveries.partnerId, partner.id)).orderBy(desc(partnerApprovalDeliveries.generation)).limit(1);
  const [carrier] = await db.select({ metadata: notifications.metadata }).from(notifications)
    .where(and(eq(notifications.inboundRequestId, application.inboundRequestId), sql`${notifications.metadata}->>'eventType' = 'partner_application_received'`)).limit(1);
  const meta = (carrier?.metadata ?? {}) as Record<string, unknown>;
  const contact = partner.email ? await storage.getContactByEmail(partner.email.toLowerCase()) : undefined;
  return {
    application: {
      id: application.id, path: application.path, profession: application.profession,
      answers: (application.answers ?? {}) as Record<string, unknown>,
      contactConsent: { version: application.consentVersion, purpose: application.consentPurpose, textSha256: application.consentTextSha256, acceptedAt: application.consentAcceptedAt.toISOString() },
      marketing: { optIn: application.marketingOptIn, disclosureId: application.marketingDisclosureId },
      sourcePage: application.sourcePage, attribution: (application.acquisition ?? {}) as Record<string, unknown>,
      reviewStatus: application.reviewStatus, revision: application.revision, decidedBy: application.decidedBy,
      decidedAt: application.decidedAt ? application.decidedAt.toISOString() : null, decisionNote: application.decisionNote,
      scheduleReference: application.scheduleReference, receivedAt: application.createdAt.toISOString(), inboundRequestId: application.inboundRequestId,
    },
    partner: {
      id: partner.id, name: partner.contactName, company: partner.companyName, email: partner.email, phone: partner.phone,
      partnerType: partner.partnerType, status: partner.status, terms: formatPartnerTerms(partner.commissionPercent),
    },
    contactId: contact?.id ?? null,
    invitation: delivery ? {
      id: delivery.id, kind: delivery.kind, state: delivery.state, generation: delivery.generation, waitReason: delivery.waitReason ?? null,
      terminalReason: delivery.terminalReason ?? null, updatedAt: (delivery.updatedAt ?? new Date()).toISOString(),
    } : null,
    assignment: {
      owner: typeof meta.reviewOwnerUserId === "string" ? meta.reviewOwnerUserId : null,
      dueAt: typeof meta.reviewDueAt === "string" ? meta.reviewDueAt : null,
      policy: typeof meta.reviewPolicy === "string" ? meta.reviewPolicy : null,
      gap: typeof meta.reviewPolicyGap === "string" ? meta.reviewPolicyGap : null,
    },
  };
}

// ── Decisions ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const APPLICATION_DECISIONS = ["accept", "decline", "needs_info"] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export interface DecisionInput {
  decision: unknown;
  expectedRevision: unknown;
  commissionPercent?: unknown;
  scheduleReference?: unknown;
  note?: unknown;
}

export type DecisionResult =
  | { ok: true; application: PartnerApplication; partner: Partner; invitation: PartnerApprovalDelivery | null }
  | { ok: false; status: 400 | 404 | 409; code: string };

export async function decidePartnerApplication(id: string, input: DecisionInput, actorId: string, now: Date = new Date()): Promise<DecisionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, code: "NOT_FOUND" };
  const decision = typeof input.decision === "string" ? input.decision : "";
  if (!(APPLICATION_DECISIONS as readonly string[]).includes(decision)) return { ok: false, status: 400, code: "INVALID_DECISION" };
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) return { ok: false, status: 400, code: "REVISION_REQUIRED" };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) : "";
  if (input.note !== undefined && typeof input.note !== "string") return { ok: false, status: 400, code: "INVALID_NOTE" };

  let terms: number | null = null;
  let schedule: string | null = null;
  if (decision === "accept") {
    const rate = input.commissionPercent;
    if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 1 || rate > 100) return { ok: false, status: 400, code: "TERMS_REQUIRED" };
    const ref = typeof input.scheduleReference === "string" ? input.scheduleReference.trim() : "";
    if (!ref || ref.length > SCHEDULE_REFERENCE_MAX) return { ok: false, status: 400, code: "SCHEDULE_REFERENCE_REQUIRED" };
    terms = rate;
    schedule = ref;
  }
  if ((decision === "decline" || decision === "needs_info") && !note) return { ok: false, status: 400, code: "NOTE_REQUIRED" };

  const outcome = await db.transaction(async (tx): Promise<DecisionResult> => {
    const [application] = await tx.select().from(partnerApplications).where(eq(partnerApplications.id, id)).for("update");
    if (!application) return { ok: false, status: 404, code: "NOT_FOUND" };
    if (application.revision !== expectedRevision) return { ok: false, status: 409, code: "STALE_REVISION" };
    if (application.reviewStatus !== "pending_review" && application.reviewStatus !== "needs_info") return { ok: false, status: 409, code: "APPLICATION_NOT_OPEN" };
    const [partner] = await tx.select().from(partners).where(eq(partners.id, application.partnerId)).for("update");
    if (!partner) return { ok: false, status: 404, code: "NOT_FOUND" };
    if (partner.status !== "pending" || partner.passwordHash) return { ok: false, status: 409, code: "PARTNER_NOT_PENDING" };

    const status: ApplicationReviewStatus = decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "needs_info";
    const decided = status === "needs_info" ? {} : { decidedBy: actorId, decidedAt: now };
    let invitation: PartnerApprovalDelivery | null = null;
    let updatedPartner: Partner = partner;

    if (decision === "accept") {
      const applied = await updatePartnerWithApproval(partner.id, { status: "active", commissionPercent: terms, agreementDate: now }, tx);
      if (!applied) return { ok: false, status: 404, code: "NOT_FOUND" };
      updatedPartner = applied.updated;
      invitation = applied.delivery;
    } else if (decision === "decline") {
      await tx.update(partners).set({ status: "inactive", updatedAt: now }).where(eq(partners.id, partner.id));
      updatedPartner = { ...partner, status: "inactive" };
    }

    const [updated] = await tx.update(partnerApplications).set({
      reviewStatus: status,
      revision: application.revision + 1,
      decisionNote: note || application.decisionNote,
      scheduleReference: decision === "accept" ? schedule : application.scheduleReference,
      updatedAt: now,
      ...decided,
    }).where(and(eq(partnerApplications.id, id), eq(partnerApplications.revision, expectedRevision))).returning();
    if (!updated) return { ok: false, status: 409, code: "STALE_REVISION" };
    return { ok: true, application: updated, partner: updatedPartner, invitation };
  });

  if (outcome.ok) {
    if (decision === "decline") await revokeAuthActions({ type: "partner", id: outcome.partner.id }, "partner_invite").catch(() => undefined);
    await storage.createAuditLog({
      action: `partner_application_${decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "needs_info"}`,
      entityType: "partner", entityId: outcome.partner.id, userId: actorId, actorType: "user", actorId,
      details: {
        applicationId: outcome.application.id, path: outcome.application.path, revision: outcome.application.revision,
        // The schedule reference is staff-only audit evidence; the rate is recorded because it is the approved term.
        ...(decision === "accept" ? { commissionPercent: terms, scheduleReference: schedule, invitationIntentId: outcome.invitation?.id ?? null } : {}),
      },
    } as any).catch(() => undefined);
  }
  return outcome;
}

export async function countOpenApplications(): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerApplications)
    .where(inArray(partnerApplications.reviewStatus, ["pending_review", "needs_info"]));
  return Number(n);
}
