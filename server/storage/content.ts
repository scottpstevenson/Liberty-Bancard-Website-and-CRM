// Task #179 Content Engine: authors, social posts, scheduled blog/social due queries.
// Methods are mixed into DatabaseStorage in server/storage.ts.
import { db } from "../db";
import {
  contentAuthors, socialPosts, generatedBlogPosts,
  type InsertContentAuthor, type InsertSocialPost,
} from "@shared/schema";
import { eq, desc, and, lte } from "drizzle-orm";

export class ContentStorage {
  // ── Content Authors ──────────────────────────────────────────────────────
  async listContentAuthors() {
    return await db.select().from(contentAuthors).orderBy(contentAuthors.name);
  }
  async getContentAuthor(id: number) {
    const [row] = await db.select().from(contentAuthors).where(eq(contentAuthors.id, id));
    return row || null;
  }
  async getContentAuthorBySlug(slug: string) {
    const [row] = await db.select().from(contentAuthors).where(eq(contentAuthors.slug, slug));
    return row || null;
  }
  async createContentAuthor(data: InsertContentAuthor) {
    const [row] = await db.insert(contentAuthors).values(data).returning();
    return row;
  }
  async upsertContentAuthorBySlug(data: InsertContentAuthor) {
    const existing = await this.getContentAuthorBySlug(data.slug);
    if (existing) return existing;
    return this.createContentAuthor(data);
  }
  async updateContentAuthor(id: number, updates: Partial<InsertContentAuthor>) {
    const [row] = await db.update(contentAuthors).set(updates).where(eq(contentAuthors.id, id)).returning();
    return row || null;
  }
  async deleteContentAuthor(id: number) {
    await db.delete(contentAuthors).where(eq(contentAuthors.id, id));
  }

  // ── Social Posts ─────────────────────────────────────────────────────────
  async listSocialPosts(filters?: { status?: string; platform?: string }) {
    const conds: any[] = [];
    if (filters?.status) conds.push(eq(socialPosts.status, filters.status));
    if (filters?.platform) conds.push(eq(socialPosts.platform, filters.platform));
    const where = conds.length ? and(...conds) : undefined;
    return await db.select().from(socialPosts).where(where as any).orderBy(desc(socialPosts.createdAt));
  }
  async getSocialPost(id: number) {
    const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
    return row || null;
  }
  async createSocialPost(data: InsertSocialPost) {
    const [row] = await db.insert(socialPosts).values(data).returning();
    return row;
  }
  async updateSocialPost(id: number, updates: Partial<InsertSocialPost>) {
    const [row] = await db.update(socialPosts).set(updates).where(eq(socialPosts.id, id)).returning();
    return row || null;
  }
  async deleteSocialPost(id: number) {
    await db.delete(socialPosts).where(eq(socialPosts.id, id));
  }
  async getDueScheduledSocialPosts(now: Date) {
    return await db.select().from(socialPosts).where(
      and(eq(socialPosts.status, "scheduled"), lte(socialPosts.scheduledAt, now))
    );
  }
  async getDueScheduledBlogPosts(now: Date) {
    return await db.select().from(generatedBlogPosts).where(
      and(eq(generatedBlogPosts.status, "scheduled"), lte(generatedBlogPosts.scheduledAt, now))
    );
  }
}
