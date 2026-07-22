/**
 * AI Assistant schema additions — imported by shared/schema.ts
 *
 * Tables: knowledge_sources, knowledge_chunks, assistant_sessions,
 *         assistant_messages, assistant_feedback, assistant_unanswered
 */

import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export users table reference shape (avoids circular dep)
// The actual FK is enforced in SQL; Drizzle schema uses integer columns.

export const knowledgeSources = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull().default("text_block"),
  status: text("status").notNull().default("draft"),
  audience: text("audience").notNull().default("public"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at"),
  lastIndexedAt: timestamp("last_indexed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: jsonb("embedding"),
  tokenCount: integer("token_count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("knowledge_chunks_source_id_idx").on(table.sourceId),
]);

export const assistantSessions = pgTable("assistant_sessions", {
  id: text("id").primaryKey(),
  audience: text("audience").notNull().default("public"),
  userId: integer("user_id"),
  contactId: integer("contact_id"),
  ipHash: text("ip_hash"),
  metadata: jsonb("metadata"),
  messageCount: integer("message_count").notNull().default(0),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("assistant_sessions_user_id_idx").on(table.userId),
]);

export const assistantMessages = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  flaggedInjection: boolean("flagged_injection").notNull().default(false),
  flaggedPii: boolean("flagged_pii").notNull().default(false),
  lowConfidence: boolean("low_confidence").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("assistant_messages_session_id_idx").on(table.sessionId),
  index("assistant_messages_created_at_idx").on(table.createdAt),
]);

export const assistantFeedback = pgTable("assistant_feedback", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  sessionId: text("session_id").notNull(),
  rating: text("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assistantUnanswered = pgTable("assistant_unanswered", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  audience: text("audience").notNull().default("public"),
  question: text("question").notNull(),
  aiResponse: text("ai_response"),
  reviewedAt: timestamp("reviewed_at"),
  reviewerId: integer("reviewer_id"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSources).omit({
  id: true, createdAt: true, updatedAt: true, lastIndexedAt: true, publishedAt: true, version: true,
});
export const insertAssistantSessionSchema = createInsertSchema(assistantSessions).omit({
  messageCount: true, lastActiveAt: true, createdAt: true,
});
export const insertAssistantMessageSchema = createInsertSchema(assistantMessages).omit({
  id: true, createdAt: true,
});
export const insertAssistantFeedbackSchema = createInsertSchema(assistantFeedback).omit({
  id: true, createdAt: true,
});
export const insertAssistantUnansweredSchema = createInsertSchema(assistantUnanswered).omit({
  id: true, createdAt: true, reviewedAt: true, reviewerId: true, resolutionNote: true,
});

// Select types
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type AssistantSession = typeof assistantSessions.$inferSelect;
export type AssistantMessage = typeof assistantMessages.$inferSelect;
export type AssistantFeedback = typeof assistantFeedback.$inferSelect;
export type AssistantUnanswered = typeof assistantUnanswered.$inferSelect;

// Insert types
export type InsertKnowledgeSource = z.infer<typeof insertKnowledgeSourceSchema>;
export type InsertAssistantSession = z.infer<typeof insertAssistantSessionSchema>;
export type InsertAssistantMessage = z.infer<typeof insertAssistantMessageSchema>;
