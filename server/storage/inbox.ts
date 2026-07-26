// Storage domain: inbox items + statement reviews
import { db } from "../db";
import { inboxItems, statementReviews } from "@shared/schema";
import type { InboxItemRow, InsertInboxItem, StatementReview, InsertStatementReview } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export async function upsertInboxItem(
  data: InsertInboxItem & { sourceItemId: string }
): Promise<InboxItemRow> {
  const existing = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.sourceItemId, data.sourceItemId))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(inboxItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(inboxItems.sourceItemId, data.sourceItemId))
      .returning();
    return updated;
  }

  const [created] = await db.insert(inboxItems).values(data).returning();
  return created;
}

export async function getInboxItem(sourceItemId: string): Promise<InboxItemRow | undefined> {
  const [row] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.sourceItemId, sourceItemId))
    .limit(1);
  return row;
}

export async function updateInboxItem(
  sourceItemId: string,
  updates: Partial<InsertInboxItem>
): Promise<InboxItemRow | undefined> {
  const [updated] = await db
    .update(inboxItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(inboxItems.sourceItemId, sourceItemId))
    .returning();
  return updated;
}

export async function getInboxItemsWithSlaBreaches(): Promise<InboxItemRow[]> {
  return db
    .select()
    .from(inboxItems)
    .where(
      and(
        sql`sla_due_at IS NOT NULL`,
        sql`sla_due_at < NOW()`,
        sql`status NOT IN ('resolved', 'escalated')`
      )
    );
}

// Statement reviews
export async function createStatementReview(data: InsertStatementReview): Promise<StatementReview> {
  const [created] = await db.insert(statementReviews).values(data).returning();
  return created;
}

export async function getStatementReviews(): Promise<StatementReview[]> {
  return db.select().from(statementReviews).orderBy(desc(statementReviews.createdAt));
}

export async function getStatementReview(id: number): Promise<StatementReview | undefined> {
  const [row] = await db
    .select()
    .from(statementReviews)
    .where(eq(statementReviews.id, id))
    .limit(1);
  return row;
}

export async function getStatementReviewByDocument(documentId: number): Promise<StatementReview | undefined> {
  const [row] = await db
    .select()
    .from(statementReviews)
    .where(eq(statementReviews.documentId, documentId))
    .limit(1);
  return row;
}

export async function updateStatementReview(
  id: number,
  updates: Partial<InsertStatementReview>
): Promise<StatementReview | undefined> {
  const [updated] = await db
    .update(statementReviews)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(statementReviews.id, id))
    .returning();
  return updated;
}
