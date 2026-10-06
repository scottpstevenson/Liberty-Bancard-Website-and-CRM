import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { users, userSessions, authActions } from "@shared/models/auth";
import { db } from "../db";
import { auditChange } from "./audit-change";
import { publicUser } from "@shared/public-user";

export class AccountCommandError extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}
type Command = { actorId: string; userId: string; expectedVersion: number;
  action: "deactivate" | "reactivate" | "role" | "reset_mfa"; role?: "admin" | "manager" | "agent" | "merchant" };

/** All membership-reducing commands use this same serialization point. Nothing
 * here deletes a user, changes attribution, releases work or sends mail. */
export async function commandAccount(input: Command) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('liberty-effective-admin-membership',0))`);
    const locked = await tx.select().from(users).where(inArray(users.id,
      [...new Set([input.actorId, input.userId])].sort())).orderBy(asc(users.id)).for("update");
    const actor = locked.find(u => u.id === input.actorId);
    const before = locked.find(u => u.id === input.userId);
    if (!actor || actor.accountState !== "active" || actor.role !== "admin" || !before) {
      throw new AccountCommandError("Account unavailable", 404);
    }
    if (before.accountVersion !== input.expectedVersion) {
      throw new AccountCommandError("Account changed. Reload its current state before retrying.", 409);
    }
    const role = input.action === "role" ? input.role : before.role;
    if (!role) throw new AccountCommandError("Account role unavailable", 409);
    const state = input.action === "deactivate" ? "deactivated" : input.action === "reactivate" ? "active" : before.accountState;
    if (actor.id === before.id && (state !== "active" || role !== "admin")) {
      throw new AccountCommandError("You cannot deactivate or demote your own administrative account.", 409);
    }
    if (input.action === "reset_mfa" && before.accountState !== "active") throw new AccountCommandError("Reactivate the account before beginning MFA recovery.", 409);
    if (input.action !== "reset_mfa" && before.role === role && before.accountState === state) return { user: publicUser(before), changed: false, sessionsInvalidated: 0 };
    if (before.role === "admin" && before.accountState === "active" && (role !== "admin" || state !== "active")) {
      // Local-password admission is the currently live login path. A pending
      // invitation or disabled Google-only seat is not effective recovery.
      const other = await tx.execute(sql`SELECT count(*)::int n FROM users
        WHERE id<>${before.id} AND role='admin' AND account_state='active'
          AND password_hash IS NOT NULL AND length(password_hash)>0
          AND (NOT COALESCE(totp_enabled,false) OR totp_secret IS NOT NULL)`);
      if (Number(other.rows[0]?.n ?? 0) < 1) {
        throw new AccountCommandError("At least one other active administrator with working login credentials is required.", 409);
      }
    }
    const now = new Date();
    const [after] = await tx.update(users).set({
      role, accountState: state, accountVersion: before.accountVersion + 1,
      authEpoch: before.authEpoch + 1, updatedAt: now,
      trustedDevices: [],
      ...(input.action === "reset_mfa" ? { totpEnabled: false, totpSecret: null, totpBackupCodes: [] } : {}),
    }).where(eq(users.id, before.id)).returning();
    const invalidated = await tx.update(userSessions).set({ isInvalidated: true, invalidatedAt: now })
      .where(and(eq(userSessions.userId, before.id), eq(userSessions.isInvalidated, false))).returning({ id: userSessions.id });
    await tx.update(authActions).set({ revokedAt: now }).where(and(
      eq(authActions.subjectType, "user"), eq(authActions.subjectId, before.id),
      isNull(authActions.consumedAt), isNull(authActions.revokedAt),
    ));
    await auditChange({ actorType: "user", userId: actor.id,
      action: input.action === "role" ? "user_role_changed" : input.action === "reset_mfa" ? "user_2fa_admin_reset" : `user_${input.action === "deactivate" ? "deactivated" : "reactivated"}`,
      entityType: "user", entityKey: before.id,
      before: { role: before.role, accountState: before.accountState, accountVersion: before.accountVersion },
      after: { role: after.role, accountState: after.accountState, accountVersion: after.accountVersion,
        sessionsInvalidated: invalidated.length, authContinuationsRevoked: true, externalEffectsReleased: false },
    }, tx);
    return { user: publicUser(after), changed: true, sessionsInvalidated: invalidated.length };
  });
}
