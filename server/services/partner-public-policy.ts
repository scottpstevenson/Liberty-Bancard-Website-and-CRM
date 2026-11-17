/**
 * Published referral-compensation policy: the only way a referral percentage reaches a public surface.
 *
 * A policy version is created as a draft, approved by an administrator (approver taken from the session, never the
 * body) against a named schedule reference and copy version, and can be revoked. At most one version is approved at a
 * time (partial unique index). The public projection is `written_agreement` unless exactly one approved version exists,
 * and any read failure collapses to `written_agreement` - an outage can never publish a number.
 *
 * Approving a version changes only what the public pages say. It creates no partner terms, enables no payout, and no
 * setting or flag elsewhere stands in for it.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { partnerPublicPolicyVersions } from "@shared/schema";
import type { PartnerPublicPolicyVersion } from "@shared/schema";
import { DEFAULT_REFERRAL_POLICY, type PartnerReferralPolicy } from "@shared/partner-public-content";
import { storage } from "../storage";
import { logOperationalDiagnostic } from "../utils/server-error";

export const STANDARD_REFERRAL_POLICY_KEY = "standard_referral" as const;
const SCHEDULE_REFERENCE_MAX = 200;
const COPY_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,59}$/;

export type PolicyMutationResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; code: string };

/** The projection the public pages and the calculator read. Never throws. */
export async function getPublishedReferralPolicy(): Promise<PartnerReferralPolicy> {
  try {
    const [row] = await db.select().from(partnerPublicPolicyVersions)
      .where(and(eq(partnerPublicPolicyVersions.policyKey, STANDARD_REFERRAL_POLICY_KEY), eq(partnerPublicPolicyVersions.status, "approved")))
      .limit(1);
    if (!row || !Number.isInteger(row.sharePercent) || row.sharePercent < 1 || row.sharePercent > 100) return DEFAULT_REFERRAL_POLICY;
    return { state: "approved", version: row.version, sharePercent: row.sharePercent };
  } catch (error) {
    logOperationalDiagnostic("partner_public_policy", error, "projection_unavailable", {});
    return DEFAULT_REFERRAL_POLICY;
  }
}

export async function listReferralPolicyVersions(): Promise<PartnerPublicPolicyVersion[]> {
  return db.select().from(partnerPublicPolicyVersions)
    .where(eq(partnerPublicPolicyVersions.policyKey, STANDARD_REFERRAL_POLICY_KEY))
    .orderBy(desc(partnerPublicPolicyVersions.version));
}

export interface PolicyDraftInput { sharePercent: unknown; scheduleReference: unknown; copyVersion: unknown }

export async function createReferralPolicyDraft(input: PolicyDraftInput, actorId: string): Promise<PolicyMutationResult<PartnerPublicPolicyVersion>> {
  const share = input.sharePercent;
  if (typeof share !== "number" || !Number.isInteger(share) || share < 1 || share > 100) return { ok: false, status: 400, code: "INVALID_SHARE_PERCENT" };
  const schedule = typeof input.scheduleReference === "string" ? input.scheduleReference.trim() : "";
  if (!schedule || schedule.length > SCHEDULE_REFERENCE_MAX) return { ok: false, status: 400, code: "INVALID_SCHEDULE_REFERENCE" };
  const copyVersion = typeof input.copyVersion === "string" ? input.copyVersion.trim() : "";
  if (!COPY_VERSION.test(copyVersion)) return { ok: false, status: 400, code: "INVALID_COPY_VERSION" };
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('partner-public-policy'))`);
    const [{ next }] = await tx.select({ next: sql<number>`COALESCE(MAX(${partnerPublicPolicyVersions.version}), 0) + 1` })
      .from(partnerPublicPolicyVersions).where(eq(partnerPublicPolicyVersions.policyKey, STANDARD_REFERRAL_POLICY_KEY));
    const [created] = await tx.insert(partnerPublicPolicyVersions).values({
      policyKey: STANDARD_REFERRAL_POLICY_KEY, version: Number(next), sharePercent: share, status: "draft",
      scheduleReference: schedule, copyVersion, createdBy: actorId,
    }).returning();
    return created;
  });
  await storage.createAuditLog({
    action: "partner_policy_draft_created", entityType: "partner_public_policy", entityKey: row.id, userId: actorId,
    details: { version: row.version, sharePercent: row.sharePercent, scheduleReference: row.scheduleReference, copyVersion: row.copyVersion },
  } as any).catch(() => undefined);
  return { ok: true, value: row };
}

/** Approval is the single publication step: it supersedes (revokes) any previously approved version in the same transaction. */
export async function approveReferralPolicy(id: string, actorId: string): Promise<PolicyMutationResult<PartnerPublicPolicyVersion>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, code: "NOT_FOUND" };
  const outcome = await db.transaction(async (tx): Promise<PolicyMutationResult<PartnerPublicPolicyVersion> & { superseded?: string | null }> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('partner-public-policy'))`);
    const [row] = await tx.select().from(partnerPublicPolicyVersions).where(eq(partnerPublicPolicyVersions.id, id)).for("update");
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND" };
    if (row.status !== "draft") return { ok: false, status: 409, code: "POLICY_NOT_DRAFT" };
    const now = new Date();
    const [previous] = await tx.select().from(partnerPublicPolicyVersions)
      .where(and(eq(partnerPublicPolicyVersions.policyKey, row.policyKey), eq(partnerPublicPolicyVersions.status, "approved"))).for("update");
    if (previous) {
      await tx.update(partnerPublicPolicyVersions).set({ status: "revoked", revokedBy: actorId, revokedAt: now })
        .where(eq(partnerPublicPolicyVersions.id, previous.id));
    }
    const [approved] = await tx.update(partnerPublicPolicyVersions).set({ status: "approved", approvedBy: actorId, approvedAt: now })
      .where(eq(partnerPublicPolicyVersions.id, id)).returning();
    return { ok: true, value: approved, superseded: previous?.id ?? null };
  });
  if (outcome.ok) {
    await storage.createAuditLog({
      action: "partner_policy_approved", entityType: "partner_public_policy", entityKey: outcome.value.id, userId: actorId,
      details: { version: outcome.value.version, sharePercent: outcome.value.sharePercent, scheduleReference: outcome.value.scheduleReference, copyVersion: outcome.value.copyVersion, supersededPolicyId: outcome.superseded ?? null },
    } as any).catch(() => undefined);
  }
  return outcome.ok ? { ok: true, value: outcome.value } : outcome;
}

export async function revokeReferralPolicy(id: string, actorId: string): Promise<PolicyMutationResult<PartnerPublicPolicyVersion>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, code: "NOT_FOUND" };
  const outcome = await db.transaction(async (tx): Promise<PolicyMutationResult<PartnerPublicPolicyVersion>> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('partner-public-policy'))`);
    const [row] = await tx.select().from(partnerPublicPolicyVersions).where(eq(partnerPublicPolicyVersions.id, id)).for("update");
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND" };
    if (row.status !== "approved") return { ok: false, status: 409, code: "POLICY_NOT_APPROVED" };
    const [revoked] = await tx.update(partnerPublicPolicyVersions).set({ status: "revoked", revokedBy: actorId, revokedAt: new Date() })
      .where(eq(partnerPublicPolicyVersions.id, id)).returning();
    return { ok: true, value: revoked };
  });
  if (outcome.ok) {
    await storage.createAuditLog({
      action: "partner_policy_revoked", entityType: "partner_public_policy", entityKey: outcome.value.id, userId: actorId,
      details: { version: outcome.value.version },
    } as any).catch(() => undefined);
  }
  return outcome;
}
