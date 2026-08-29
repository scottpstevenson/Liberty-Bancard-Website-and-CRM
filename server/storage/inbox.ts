// Storage domain: inbox items + statement reviews
import { db } from "../db";
import { inboxItems, statementReviews } from "@shared/schema";
import type { InboxItemRow, InsertInboxItem, StatementReview, InsertStatementReview } from "@shared/schema";
import { eq, desc, and, sql, or, isNull, and as drizzleAnd } from "drizzle-orm";

export type InboxSourceIdentity = { sourceNamespace: string; sourceItemId: string };

/** Public identifiers are opaque but structurally bind provider item ID to its
 * account/location namespace. Legacy IDs remain readable during migration. */
export function parseInboxSourceIdentity(value: string): InboxSourceIdentity {
  const separator = value.lastIndexOf("::");
  return separator > 0
    ? { sourceNamespace: value.slice(0, separator), sourceItemId: value.slice(separator + 2) }
    : { sourceNamespace: "legacy", sourceItemId: value };
}

function normalizeInboxSource(
  data: InsertInboxItem & { sourceItemId: string },
): InsertInboxItem & { sourceItemId: string; sourceNamespace: string } {
  const identity = parseInboxSourceIdentity(data.sourceItemId);
  return { ...data, ...identity, sourceNamespace: data.sourceNamespace || identity.sourceNamespace };
}
function sourceIdentityWhere(identity: InboxSourceIdentity) {
  const namespace = identity.sourceNamespace === "legacy"
    ? or(eq(inboxItems.sourceNamespace, "legacy"), isNull(inboxItems.sourceNamespace))
    : eq(inboxItems.sourceNamespace, identity.sourceNamespace);
  return drizzleAnd(namespace, eq(inboxItems.sourceItemId, identity.sourceItemId));
}

export async function upsertInboxItem(
  data: InsertInboxItem & { sourceItemId: string }
): Promise<InboxItemRow> {
  const normalized = normalizeInboxSource(data);
  const [created] = await db.insert(inboxItems).values(normalized).onConflictDoNothing().returning();
  if (created) return created;
  const existing = await getInboxItem(`${normalized.sourceNamespace}::${normalized.sourceItemId}`);
  if (!existing) throw new Error("Inbox source identity conflict could not be resolved");
  return (await updateInboxItem(`${normalized.sourceNamespace}::${normalized.sourceItemId}`, normalized)) || existing;
}

/** Persist an observed source item once. Immutable content is never refreshed
 * from a client request or a later provider conversation summary. */
export async function rememberInboxSourceItem(data: InsertInboxItem & { sourceItemId: string }): Promise<InboxItemRow> {
  const normalized = normalizeInboxSource(data);
  const [created] = await db.insert(inboxItems).values(normalized).onConflictDoNothing().returning();
  if (created) return created;
  const existing = await getInboxItem(`${normalized.sourceNamespace}::${normalized.sourceItemId}`);
  if (!existing) throw new Error("Inbox source identity conflict could not be resolved");
  return existing;
}

export async function getInboxItem(sourceItemId: string): Promise<InboxItemRow | undefined> {
  const identity = parseInboxSourceIdentity(sourceItemId);
  const [row] = await db
    .select()
    .from(inboxItems)
    .where(sourceIdentityWhere(identity))
    .limit(1);
  return row;
}

export async function updateInboxItem(
  sourceItemId: string,
  updates: Partial<InsertInboxItem>
): Promise<InboxItemRow | undefined> {
  const identity = parseInboxSourceIdentity(sourceItemId);
  // Deliberately copy only routing/workflow fields. Source identity, provider
  // target and observed content are immutable after insertion.
  const operationalUpdates: Partial<InsertInboxItem> = {};
  const allowed = [
    "contactId", "dealId", "ownerId", "ownerName",
    "department", "status", "priority", "slaDueAt", "nextAction",
    "escalationPath", "notes",
  ] as const;
  for (const key of allowed) {
    if (updates[key] !== undefined) (operationalUpdates as any)[key] = updates[key];
  }
  const [updated] = await db
    .update(inboxItems)
    .set({ ...operationalUpdates, updatedAt: new Date() })
    .where(sourceIdentityWhere(identity))
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
  const created = await db.insert(statementReviews).values(data).onConflictDoNothing().returning();
  if (created[0]) return created[0];
  if (data.createCommandKey) {
    const [byCommand] = await db.select().from(statementReviews)
      .where(eq(statementReviews.createCommandKey, data.createCommandKey)).limit(1);
    if (byCommand) return byCommand;
  }
  if (data.documentId) {
    const existing = await getStatementReviewByDocument(data.documentId);
    if (existing) return existing;
  }
  throw new Error("Statement review create command could not be resolved");
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
  updates: Partial<InsertStatementReview>,
  expectedVersion?: number,
): Promise<StatementReview | undefined> {
  const where = expectedVersion === undefined
    ? eq(statementReviews.id, id)
    : drizzleAnd(eq(statementReviews.id, id), eq(statementReviews.version, expectedVersion));
  const [updated] = await db
    .update(statementReviews)
    .set({ ...updates, version: sql`${statementReviews.version} + 1`, updatedAt: new Date() })
    .where(where)
    .returning();
  return updated;
}
