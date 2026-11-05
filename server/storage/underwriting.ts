import { db } from "../db";
import { productionDealSql } from "../services/deal-production-scope";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import {
  underwritingRules,
  underwritingDecisions,
  deals,
  type UnderwritingRules,
  type InsertUnderwritingRules,
  type UnderwritingDecision,
  type InsertUnderwritingDecision,
} from "@shared/schema";

export class UnderwritingStorage {
  /**
   * Pure read (S5-24). A missing configuration is reported as `undefined`; a GET never
   * inserts default thresholds. Rules are created only by the authorized update command.
   */
  async getUnderwritingRules(): Promise<UnderwritingRules | undefined> {
    const [row] = await db.select().from(underwritingRules).where(eq(underwritingRules.id, 1));
    return row;
  }

  /** Authorized command: updates the singleton row, or creates it from exactly the supplied values. */
  async updateUnderwritingRules(updates: Partial<InsertUnderwritingRules>): Promise<UnderwritingRules> {
    const [row] = await db
      .insert(underwritingRules)
      .values({ ...updates, id: 1 } as any)
      .onConflictDoUpdate({ target: underwritingRules.id, set: { ...updates, updatedAt: new Date() } as any })
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
      .orderBy(desc(underwritingDecisions.createdAt), desc(underwritingDecisions.id))
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
    // SQL aggregate: never loads the decision table into memory.
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`(count(*) filter (where ${underwritingDecisions.decision} = 'approve'))::int`,
        review: sql<number>`(count(*) filter (where ${underwritingDecisions.decision} = 'review'))::int`,
        hold: sql<number>`(count(*) filter (where ${underwritingDecisions.decision} = 'hold'))::int`,
        overridden: sql<number>`(count(*) filter (where ${underwritingDecisions.overrideAction} is not null))::int`,
      })
      .from(underwritingDecisions)
      .innerJoin(deals, and(eq(deals.id, underwritingDecisions.dealId), sql.raw(productionDealSql("deals"))))
      .where(since ? gte(underwritingDecisions.createdAt, since) : undefined);
    return {
      total: Number(row?.total ?? 0), approved: Number(row?.approved ?? 0), review: Number(row?.review ?? 0),
      hold: Number(row?.hold ?? 0), overridden: Number(row?.overridden ?? 0),
    };
  }
}
