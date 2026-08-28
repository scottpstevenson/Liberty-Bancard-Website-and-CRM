import crypto from "crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { authActions, AUTH_ACTION_PURPOSES, type AuthActionPurpose } from "@shared/models/auth";
import { db } from "../db";

export type AuthActionDeliveryDisposition = "pending" | "sent" | "definite_failure" | "ambiguous";
export type AuthActionSubject = { type: string; id: string | number };

const purposeSet = new Set<string>(AUTH_ACTION_PURPOSES);
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function requirePurpose(purpose: AuthActionPurpose): void {
  if (!purposeSet.has(purpose)) throw new Error("Unsupported auth action purpose");
}

/**
 * Issues a cryptographically random bearer while retaining only its hash.
 * Issuance revokes every earlier live action for this exact purpose + subject,
 * making delayed messages harmless and giving each delivery a monotonic version.
 */
export async function issueAuthAction(input: {
  purpose: AuthActionPurpose;
  subject: AuthActionSubject;
  ttlMs: number;
}): Promise<{ id: string; token: string; expiresAt: Date; version: number }> {
  requirePurpose(input.purpose);
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) throw new Error("Invalid auth action expiry");
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  const subjectId = String(input.subject.id);
  return db.transaction(async (tx) => {
    // Serialize issuance for one subject + purpose so concurrent resends cannot
    // choose the same version or leave more than one live action.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${input.purpose}:${input.subject.type}:${subjectId}`}, 0)
      )
    `);
    await tx.update(authActions).set({ revokedAt: now })
      .where(and(eq(authActions.purpose, input.purpose), eq(authActions.subjectType, input.subject.type),
        eq(authActions.subjectId, subjectId), isNull(authActions.consumedAt), isNull(authActions.revokedAt)));
    const [previous] = await tx.select({ version: authActions.version }).from(authActions)
      .where(and(eq(authActions.purpose, input.purpose), eq(authActions.subjectType, input.subject.type),
        eq(authActions.subjectId, subjectId))).orderBy(desc(authActions.version)).limit(1);
    const version = (previous?.version ?? 0) + 1;
    const [action] = await tx.insert(authActions).values({
      purpose: input.purpose, subjectType: input.subject.type, subjectId, tokenHash: tokenHash(token),
      version, expiresAt, deliveryDisposition: "pending",
    }).returning({ id: authActions.id });
    return { id: action.id, token, expiresAt, version };
  });
}

/** Record only safe mail outcome state; callers must never attach recipient/provider payloads. */
export async function setAuthActionDelivery(id: string, disposition: AuthActionDeliveryDisposition): Promise<void> {
  const deliveredAt = disposition === "sent" ? new Date() : null;
  await db.update(authActions).set({
    deliveryDisposition: disposition, deliveredAt,
    // A definite pre-dispatch failure must never leave a usable bearer behind;
    // timeouts remain ambiguous because a provider may already have accepted it.
    revokedAt: disposition === "definite_failure" ? new Date() : undefined,
  }).where(eq(authActions.id, id));
}

/**
 * Atomically claims a purpose-bound bearer and executes its mutation in the
 * same transaction. Throwing from mutate rolls back the consumed marker.
 */
export async function consumeAuthAction<T>(input: {
  token: string;
  purpose: AuthActionPurpose;
  mutate: (subject: AuthActionSubject, tx: any) => Promise<T>;
}): Promise<{ ok: true; value: T; subject: AuthActionSubject } | { ok: false }> {
  requirePurpose(input.purpose);
  if (!input.token || input.token.length > 512) return { ok: false };
  const now = new Date();
  class AuthActionMutationRejected extends Error {}
  const rejected = new AuthActionMutationRejected("AUTH_ACTION_MUTATION_REJECTED");
  try {
  return await db.transaction(async (tx) => {
    const [claimed] = await tx.update(authActions).set({ consumedAt: now })
      .where(and(eq(authActions.tokenHash, tokenHash(input.token)), eq(authActions.purpose, input.purpose),
        gt(authActions.expiresAt, now), isNull(authActions.consumedAt), isNull(authActions.revokedAt)))
      .returning();
    if (!claimed) return { ok: false } as const;
    const subject = { type: claimed.subjectType, id: claimed.subjectId };
    const value = await input.mutate(subject, tx);
    // `false` is an authorization/subject rejection, not a successful
    // mutation. Throw so both the claim and any preceding writes roll back.
    if (value === false || value === null || value === undefined) throw rejected;
    return { ok: true, value, subject } as const;
  });
  } catch (error) {
    if (error instanceof AuthActionMutationRejected) return { ok: false };
    throw error;
  }
}

export async function revokeAuthActions(subject: AuthActionSubject, purpose?: AuthActionPurpose): Promise<void> {
  const conditions = [eq(authActions.subjectType, subject.type), eq(authActions.subjectId, String(subject.id)),
    isNull(authActions.consumedAt), isNull(authActions.revokedAt)];
  if (purpose) conditions.push(eq(authActions.purpose, purpose));
  await db.update(authActions).set({ revokedAt: new Date() }).where(and(...conditions));
}

/** Non-consuming, identity-free validity check for pages which need a form state. */
export async function isAuthActionValid(token: string, purpose: AuthActionPurpose): Promise<boolean> {
  requirePurpose(purpose);
  if (!token || token.length > 512) return false;
  const [action] = await db.select({ id: authActions.id }).from(authActions).where(and(
    eq(authActions.tokenHash, tokenHash(token)), eq(authActions.purpose, purpose),
    gt(authActions.expiresAt, new Date()), isNull(authActions.consumedAt), isNull(authActions.revokedAt),
  )).limit(1);
  return !!action;
}