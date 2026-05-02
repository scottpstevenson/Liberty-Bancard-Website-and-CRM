import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, and, gt } from "drizzle-orm";

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
}

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
  }

  async updateUserVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({ verificationToken: token, verificationExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(users.id, userId));
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
  }

  async saveTotpSecret(userId: string, secret: string): Promise<void> {
    await db
      .update(users)
      .set({ totpSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async enableTotp(userId: string, backupCodes: IBackupCode[]): Promise<void> {
    await db
      .update(users)
      .set({ totpEnabled: true, totpBackupCodes: backupCodes as any, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async disableTotp(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null, trustedDevices: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
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
    valid.push(device);
    await db.update(users).set({ trustedDevices: valid as any, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async removeTrustedDevice(userId: string, token: string): Promise<void> {
    const devices = await this.getTrustedDevices(userId);
    const updated = devices.filter(d => d.token !== token);
    await db.update(users).set({ trustedDevices: updated as any, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async clearExpiredTrustedDevices(userId: string): Promise<void> {
    const devices = await this.getTrustedDevices(userId);
    const now = new Date();
    const valid = devices.filter(d => new Date(d.expiresAt) > now);
    await db.update(users).set({ trustedDevices: valid as any, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async adminResetTotp(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null, trustedDevices: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
}

export const authStorage = new AuthStorage();
