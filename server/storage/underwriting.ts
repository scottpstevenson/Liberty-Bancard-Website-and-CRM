import { db } from "../db";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  underwritingRules,
  underwritingDecisions,
  type UnderwritingRules,
  type InsertUnderwritingRules,
  type UnderwritingDecision,
  type InsertUnderwritingDecision,
} from "@shared/schema";

export class UnderwritingStorage {
  async getUnderwritingRules(): Promise<UnderwritingRules> {
    const [row] = await db.select().from(underwritingRules).where(eq(underwritingRules.id, 1));
    if (row) return row;
    const [created] = await db.insert(underwritingRules).values({ id: 1 }).returning();
    return created;
  }

  async updateUnderwritingRules(updates: Partial<InsertUnderwritingRules>): Promise<UnderwritingRules> {
    const [row] = await db
      .update(underwritingRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(underwritingRules.id, 1))
      .returning();
    return row;
  }

  async getUnderwritingDecisions(filters?: {
    decision?: string;
    dealId?: number;
    since?: Date;
    limit?: number;
  }): Promise<UnderwritingDecision[]> {
    const conditions: any[] = [];
    if (filters?.decision) conditions.push(eq(underwritingDecisions.decision, filters.decision));
    if (filters?.dealId) conditions.push(eq(underwritingDecisions.dealId, filters.dealId));
    if (filters?.since) conditions.push(gte(underwritingDecisions.createdAt, filters.since));

    const query = db
      .select()
      .from(underwritingDecisions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(underwritingDecisions.createdAt));

    if (filters?.limit) {
      return query.limit(filters.limit);
    }
    return query;
  }

  async getUnderwritingDecisionByDeal(dealId: number): Promise<UnderwritingDecision | undefined> {
    const [row] = await db
      .select()
      .from(underwritingDecisions)
      .where(eq(underwritingDecisions.dealId, dealId))
      .orderBy(desc(underwritingDecisions.createdAt))
      .limit(1);
    return row;
  }

  async createUnderwritingDecision(data: InsertUnderwritingDecision): Promise<UnderwritingDecision> {
    const [row] = await db.insert(underwritingDecisions).values(data).returning();
    return row;
  }

  async overrideUnderwritingDecision(
    decisionId: number,
    overrideAction: "approve" | "reject",
    overriddenBy: string,
    note?: string,
  ): Promise<UnderwritingDecision | undefined> {
    const [row] = await db
      .update(underwritingDecisions)
      .set({
        overrideAction,
        overriddenBy,
        overriddenAt: new Date(),
        overrideNote: note ?? null,
      })
      .where(eq(underwritingDecisions.id, decisionId))
      .returning();
    return row;
  }

  async getUnderwritingQueue(decision?: "review" | "hold"): Promise<UnderwritingDecision[]> {
    const conditions: any[] = [];
    if (decision) {
      conditions.push(eq(underwritingDecisions.decision, decision));
    } else {
      // default: both review and hold, not yet overridden
      conditions.push(
        and(
          eq(underwritingDecisions.decision, "review"),
        ) as any,
      );
    }
    return db
      .select()
      .from(underwritingDecisions)
      .where(
        and(
          ...(decision
            ? [eq(underwritingDecisions.decision, decision)]
            : []),
        ) as any,
      )
      .orderBy(desc(underwritingDecisions.createdAt));
  }

  async getUnderwritingStats(since?: Date): Promise<{
    total: number;
    approved: number;
    review: number;
    hold: number;
    overridden: number;
  }> {
    const filter = since
      ? gte(underwritingDecisions.createdAt, since)
      : undefined;

    const rows = await db
      .select()
      .from(underwritingDecisions)
      .where(filter as any);

    return {
      total: rows.length,
      approved: rows.filter(r => r.decision === "approve").length,
      review: rows.filter(r => r.decision === "review").length,
      hold: rows.filter(r => r.decision === "hold").length,
      overridden: rows.filter(r => r.overrideAction != null).length,
    };
  }
}
