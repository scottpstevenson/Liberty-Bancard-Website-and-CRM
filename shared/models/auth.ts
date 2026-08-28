import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: varchar("password_hash"),
  role: varchar("role").default("merchant"),
  authProvider: varchar("auth_provider").default("local"),
  emailVerified: timestamp("email_verified"),
  verificationToken: varchar("verification_token"),
  verificationExpiresAt: timestamp("verification_expires_at"),
  resetToken: varchar("reset_token"),
  resetExpiresAt: timestamp("reset_expires_at"),
  agentId: varchar("agent_id"),
  totpSecret: varchar("totp_secret"),
  totpEnabled: boolean("totp_enabled").default(false),
  totpBackupCodes: jsonb("totp_backup_codes"),
  trustedDevices: jsonb("trusted_devices"),
  permissions: jsonb("permissions").$type<string[]>().default([]),
  tourCompletedAt: timestamp("tour_completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userSessions = pgTable(
  "user_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id").notNull(),
    ip: varchar("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow(),
    lastActiveAt: timestamp("last_active_at").defaultNow(),
    isInvalidated: boolean("is_invalidated").default(false),
    invalidatedAt: timestamp("invalidated_at"),
  },
  (table) => [
    index("user_sessions_user_id_idx").on(table.userId),
    index("user_sessions_session_id_idx").on(table.sessionId),
    index("user_sessions_last_active_idx").on(table.lastActiveAt),
  ]
);

/**
 * The sole durable authority for browser-delivered account actions.  Bearers
 * are deliberately never persisted: tokenHash is SHA-256(raw bearer).
 * subjectType/subjectId support the non-user credential owners without
 * coupling this table to a changing collection of foreign keys.
 */
export const AUTH_ACTION_PURPOSES = [
  "user_password_reset",
  "user_email_verification",
  "merchant_activation",
  "partner_password_reset",
  "partner_invite",
  "partner_org_activation",
  "partner_org_password_reset",
] as const;
export type AuthActionPurpose = typeof AUTH_ACTION_PURPOSES[number];

export const authActions = pgTable("auth_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: varchar("purpose", { length: 64 }).notNull(),
  subjectType: varchar("subject_type", { length: 64 }).notNull(),
  subjectId: varchar("subject_id", { length: 128 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  version: integer("version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  deliveryDisposition: varchar("delivery_disposition", { length: 32 }).notNull().default("pending"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("auth_actions_token_hash_uidx").on(table.tokenHash),
  uniqueIndex("auth_actions_subject_purpose_version_uidx").on(table.subjectType, table.subjectId, table.purpose, table.version),
  index("auth_actions_subject_purpose_idx").on(table.subjectType, table.subjectId, table.purpose, table.version),
  index("auth_actions_consume_idx").on(table.tokenHash, table.purpose, table.expiresAt),
]);

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof userSessions.$inferInsert;
