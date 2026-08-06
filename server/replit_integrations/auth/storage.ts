import { users, userSessions, sessions, type User, type UpsertUser, type UserSession } from "@shared/models/auth";
import { db } from "../../db";
import { eq, and, gt, lt, desc, ne } from "drizzle-orm";

export interface ITrustedDevice {
  token: string;
  name: string;
  expiresAt: string;
}

export interface IBackupCode {
  code: string;
  used: boolean;
}

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserResetToken(email: string, token: string, expiresAt: Date): Promise<boolean>;
  getUserByResetToken(tokenHash: string): Promise<User | undefined>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  updateUserVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  getUserByVerificationToken(tokenHash: string): Promise<User | undefined>;
  markEmailVerified(userId: string): Promise<void>;
  saveTotpSecret(userId: string, secret: string): Promise<void>;
  enableTotp(userId: string, backupCodes: IBackupCode[]): Promise<void>;
  disableTotp(userId: string): Promise<void>;
  getTotpData(userId: string): Promise<{ secret: string | null; enabled: boolean; backupCodes: IBackupCode[] | null }>;
  markBackupCodeUsed(userId: string, index: number): Promise<void>;
  getTrustedDevices(userId: string): Promise<ITrustedDevice[]>;
  addTrustedDevice(userId: string, device: ITrustedDevice): Promise<void>;
  removeTrustedDevice(userId: string, token: string): Promise<void>;
  clearExpiredTrustedDevices(userId: string): Promise<void>;
  adminResetTotp(userId: string): Promise<void>;
  // Session management
  createUserSession(data: { userId: string; sessionId: string; ip?: string; userAgent?: string }): Promise<UserSession>;
  getUserSession(sessionId: string): Promise<UserSession | undefined>;
  touchUserSession(sessionId: string): Promise<void>;
  invalidateUserSession(sessionId: string): Promise<void>;
  invalidateAllUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
  getActiveSessionsForUser(userId: string): Promise<UserSession[]>;
  countActiveSessionsForUser(userId: string): Promise<number>;
  invalidateOldestSessionsForUser(userId: string, keepCount: number): Promise<void>;
  revokeSessionById(sessionRecordId: string): Promise<void>;
  cleanupExpiredSessions(): Promise<void>;
}

// Session expiry configuration
const IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_HOURS || "8") * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = parseInt(process.env.SESSION_ABSOLUTE_TTL_HOURS || "24") * 60 * 60 * 1000;

// Concurrent session limits by role
const SESSION_LIMITS: Record<string, number> = {
  admin: 10,
  manager: 5,
  agent: 3,
  merchant: 5,
  partner: 3,
  affiliate: 3,
};

export function getSessionLimitForRole(role: string): number {
  return SESSION_LIMITS[role] ?? 3;
}

export { IDLE_TIMEOUT_MS, ABSOLUTE_TTL_MS };

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      const [existing] = userData.id
        ? await db.select().from(users).where(eq(users.id, userData.id))
        : userData.email
          ? await db.select().from(users).where(eq(users.email, userData.email.toLowerCase()))
          : [undefined];
      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            ...userData,
            updatedAt: new Date(),
          },
        })
        .returning();
      const { auditChange } = await import("../../services/audit-change");
      const { passwordHash: _bph, ...safeBefore } = (existing ?? {}) as any;
      const { passwordHash: _aph, ...safeAfter } = user as any;
      await auditChange({ actorType: "system", action: existing ? "user_updated" : "user_created",
        entityType: "user", entityKey: user.id, before: existing ? safeBefore : null, after: safeAfter });
      return user;
    } catch (error: any) {
      if (error?.constraint === 'users_email_unique' || error?.message?.includes('users_email_unique')) {
        const [existing] = await db.select().from(users).where(eq(users.email, userData.email!));
        if (existing) return existing;
      }
      throw error;
    }
  }

  async updateUserResetToken(email: string, token: string, expiresAt: Date): Promise<boolean> {
    const result = await db
      .update(users)
      .set({ resetToken: token, resetExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(users.email, email.toLowerCase()))
      .returning();
    if (result.length > 0) {
      const { auditChange } = await import("../../services/audit-change");
      await auditChange({ actorType: "system", action: "user_password_reset_requested", entityType: "user",
        entityKey: result[0].id, before: null, after: { email, resetExpiresAt: expiresAt } });
    }
    return result.length > 0;
  }

  async getUserByResetToken(tokenHash: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.resetToken, tokenHash), gt(users.resetExpiresAt, new Date())));
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, resetToken: null, resetExpiresAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_password_changed", entityType: "user", entityKey: userId, before: null, after: { passwordChangedAt: new Date().toISOString() } });
  }

  async updateUserVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({ verificationToken: token, verificationExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "system", action: "user_verification_token_issued", entityType: "user",
      entityKey: userId, before: null, after: { verificationExpiresAt: expiresAt } });
  }

  async getUserByVerificationToken(tokenHash: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.verificationToken, tokenHash), gt(users.verificationExpiresAt, new Date())));
    return user;
  }

  async markEmailVerified(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ emailVerified: new Date(), verificationToken: null, verificationExpiresAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_email_verified", entityType: "user", entityKey: userId, before: { emailVerified: null }, after: { emailVerified: new Date().toISOString() } });
  }

  async saveTotpSecret(userId: string, secret: string): Promise<void> {
    await db
      .update(users)
      .set({ totpSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_totp_secret_saved", entityType: "user", entityKey: userId, before: null, after: { totpSecretSet: true } });
  }

  async enableTotp(userId: string, backupCodes: IBackupCode[]): Promise<void> {
    await db
      .update(users)
      .set({ totpEnabled: true, totpBackupCodes: backupCodes as any, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_totp_enabled", entityType: "user", entityKey: userId, before: { totpEnabled: false }, after: { totpEnabled: true } });
  }

  async disableTotp(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null, trustedDevices: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_totp_disabled", entityType: "user", entityKey: userId, before: { totpEnabled: true }, after: { totpEnabled: false } });
  }

  async getTotpData(userId: string): Promise<{ secret: string | null; enabled: boolean; backupCodes: IBackupCode[] | null }> {
    const [user] = await db.select({
      totpSecret: users.totpSecret,
      totpEnabled: users.totpEnabled,
      totpBackupCodes: users.totpBackupCodes,
    }).from(users).where(eq(users.id, userId));
    if (!user) return { secret: null, enabled: false, backupCodes: null };
    return {
      secret: user.totpSecret ?? null,
      enabled: user.totpEnabled ?? false,
      backupCodes: user.totpBackupCodes as IBackupCode[] | null,
    };
  }

  async markBackupCodeUsed(userId: string, index: number): Promise<void> {
    const data = await this.getTotpData(userId);
    if (!data.backupCodes) return;
    const updated = [...data.backupCodes];
    updated[index] = { ...updated[index], used: true };
    await db.update(users).set({ totpBackupCodes: updated as any, updatedAt: new Date() }).where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_backup_code_used", entityType: "user", entityKey: userId,
      before: { backupCodeIndex: index, used: false }, after: { backupCodeIndex: index, used: true } });
  }

  async getTrustedDevices(userId: string): Promise<ITrustedDevice[]> {
    const [user] = await db.select({ trustedDevices: users.trustedDevices }).from(users).where(eq(users.id, userId));
    if (!user?.trustedDevices) return [];
    return user.trustedDevices as ITrustedDevice[];
  }

  async addTrustedDevice(userId: string, device: ITrustedDevice): Promise<void> {
    const devices = await this.getTrustedDevices(userId);
    const now = new Date();
    const valid = devices.filter(d => new Date(d.expiresAt) > now);
    const before = { trustedDeviceCount: valid.length };
    valid.push(device);
    await db.update(users).set({ trustedDevices: valid as any, updatedAt: new Date() }).where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_trusted_device_added", entityType: "user", entityKey: userId,
      before, after: { trustedDeviceCount: valid.length, deviceUserAgent: (device as any).userAgent ?? null, expiresAt: device.expiresAt } });
  }

  async removeTrustedDevice(userId: string, token: string): Promise<void> {
    const devices = await this.getTrustedDevices(userId);
    const updated = devices.filter(d => d.token !== token);
    await db.update(users).set({ trustedDevices: updated as any, updatedAt: new Date() }).where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "user", userId, action: "user_trusted_device_removed", entityType: "user", entityKey: userId,
      before: { trustedDeviceCount: devices.length }, after: { trustedDeviceCount: updated.length } });
  }

  async clearExpiredTrustedDevices(userId: string): Promise<void> {
    const devices = await this.getTrustedDevices(userId);
    const now = new Date();
    const valid = devices.filter(d => new Date(d.expiresAt) > now);
    await db.update(users).set({ trustedDevices: valid as any, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async adminResetTotp(userId: string): Promise<void> {
    const before = await this.getTotpData(userId);
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null, trustedDevices: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { auditChange } = await import("../../services/audit-change");
    await auditChange({ actorType: "system", action: "user_totp_admin_reset", entityType: "user", entityKey: userId,
      before: { totpEnabled: before.enabled, backupCodeCount: before.backupCodes?.length ?? 0 },
      after: { totpEnabled: false, backupCodeCount: 0 } });
  }

  // === SESSION MANAGEMENT ===

  async createUserSession(data: { userId: string; sessionId: string; ip?: string; userAgent?: string }): Promise<UserSession> {
    const [record] = await db
      .insert(userSessions)
      .values({
        userId: data.userId,
        sessionId: data.sessionId,
        ip: data.ip || null,
        userAgent: data.userAgent || null,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        isInvalidated: false,
      })
      .returning();
    return record;
  }

  async getUserSession(sessionId: string): Promise<UserSession | undefined> {
    const [record] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionId, sessionId));
    return record;
  }

  async touchUserSession(sessionId: string): Promise<void> {
    await db
      .update(userSessions)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(userSessions.sessionId, sessionId), eq(userSessions.isInvalidated, false)));
  }

  async invalidateUserSession(sessionId: string): Promise<void> {
    const now = new Date();
    await db
      .update(userSessions)
      .set({ isInvalidated: true, invalidatedAt: now })
      .where(eq(userSessions.sessionId, sessionId));
    // Also delete from the express-session store
    try {
      await db.delete(sessions).where(eq(sessions.sid, sessionId));
    } catch {
      // Ignore if already gone
    }
  }

  async invalidateAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    const now = new Date();
    // Get all active session IDs for this user (except the current one)
    const activeSessions = await db
      .select({ sessionId: userSessions.sessionId })
      .from(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        eq(userSessions.isInvalidated, false),
        exceptSessionId ? ne(userSessions.sessionId, exceptSessionId) : undefined as any,
      ));

    // Mark all as invalidated in our table
    if (exceptSessionId) {
      await db
        .update(userSessions)
        .set({ isInvalidated: true, invalidatedAt: now })
        .where(and(
          eq(userSessions.userId, userId),
          eq(userSessions.isInvalidated, false),
          ne(userSessions.sessionId, exceptSessionId),
        ));
    } else {
      await db
        .update(userSessions)
        .set({ isInvalidated: true, invalidatedAt: now })
        .where(and(
          eq(userSessions.userId, userId),
          eq(userSessions.isInvalidated, false),
        ));
    }

    // Delete from express-session store for immediate effect
    for (const { sessionId } of activeSessions) {
      try {
        await db.delete(sessions).where(eq(sessions.sid, sessionId));
      } catch {
        // Ignore
      }
    }
  }

  async getActiveSessionsForUser(userId: string): Promise<UserSession[]> {
    const idleCutoff = new Date(Date.now() - IDLE_TIMEOUT_MS);
    const absoluteCutoff = new Date(Date.now() - ABSOLUTE_TTL_MS);
    return db
      .select()
      .from(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        eq(userSessions.isInvalidated, false),
        gt(userSessions.lastActiveAt, idleCutoff),
        gt(userSessions.createdAt, absoluteCutoff),
      ))
      .orderBy(desc(userSessions.lastActiveAt));
  }

  async countActiveSessionsForUser(userId: string): Promise<number> {
    const rows = await this.getActiveSessionsForUser(userId);
    return rows.length;
  }

  async invalidateOldestSessionsForUser(userId: string, keepCount: number): Promise<void> {
    const active = await this.getActiveSessionsForUser(userId);
    if (active.length <= keepCount) return;
    // Sessions are ordered by lastActiveAt DESC — oldest are at the end
    const toInvalidate = active.slice(keepCount);
    for (const s of toInvalidate) {
      await this.invalidateUserSession(s.sessionId);
    }
  }

  async revokeSessionById(sessionRecordId: string): Promise<void> {
    const [record] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionRecordId));
    if (!record) return;
    await this.invalidateUserSession(record.sessionId);
  }

  async cleanupExpiredSessions(): Promise<void> {
    const idleCutoff = new Date(Date.now() - IDLE_TIMEOUT_MS);
    const absoluteCutoff = new Date(Date.now() - ABSOLUTE_TTL_MS);
    const now = new Date();
    // Mark sessions expired by idle timeout
    await db
      .update(userSessions)
      .set({ isInvalidated: true, invalidatedAt: now })
      .where(and(
        eq(userSessions.isInvalidated, false),
        lt(userSessions.lastActiveAt, idleCutoff),
      ));
    // Mark sessions expired by absolute TTL
    await db
      .update(userSessions)
      .set({ isInvalidated: true, invalidatedAt: now })
      .where(and(
        eq(userSessions.isInvalidated, false),
        lt(userSessions.createdAt, absoluteCutoff),
      ));
  }
}

export const authStorage = new AuthStorage();
