import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, and, gt } from "drizzle-orm";

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
}

export const authStorage = new AuthStorage();
