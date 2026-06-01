import { db } from "../db";
import {
  merchantHealthScores, churnScoreWeights, contacts, deals, agentMerchants, agents,
  type MerchantHealthScore, type InsertMerchantHealthScore,
  type ChurnScoreWeight, type InsertChurnScoreWeight,
} from "@shared/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

const DEFAULT_WEIGHTS: InsertChurnScoreWeight[] = [
  { signalKey: "volume_trend", label: "Processing Volume Trend", weight: 1.5, description: "Declining processing volume signals churn risk" },
  { signalKey: "chargeback_trend", label: "Chargeback Ratio Trend", weight: 1.5, description: "Rising chargeback ratio signals elevated risk" },
  { signalKey: "ticket_velocity", label: "Support Ticket Velocity", weight: 1.0, description: "Increasing support tickets indicate dissatisfaction" },
  { signalKey: "nps_score", label: "NPS Score", weight: 1.0, description: "Low NPS score indicates churn intent" },
  { signalKey: "portal_activity", label: "Portal Activity", weight: 0.75, description: "Days since last merchant portal login" },
  { signalKey: "outreach_response", label: "Outreach Response Rate", weight: 0.75, description: "Non-response to outreach indicates disengagement" },
];

export class ChurnStorage {
  async getMerchantHealthScores(filters?: { riskTier?: string; vertical?: string; agentOwner?: string }): Promise<MerchantHealthScore[]> {
    // Order by effective score: override takes precedence over computed score
    let rows = await db
      .select()
      .from(merchantHealthScores)
      .orderBy(desc(sql<number>`COALESCE(${merchantHealthScores.overrideScore}, ${merchantHealthScores.churnScore})`));

    if (!filters || (!filters.riskTier && !filters.vertical && !filters.agentOwner)) {
      return rows;
    }

    // Filter by risk tier
    if (filters.riskTier && filters.riskTier !== "all") {
      rows = rows.filter(r => r.riskTier === filters.riskTier);
    }

    // Filter by vertical — requires joining with contacts
    if (filters.vertical && filters.vertical !== "all") {
      const contactIds = rows.map(r => r.contactId);
      if (contactIds.length === 0) return [];
      const matchingContacts = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(
          inArray(contacts.id, contactIds),
          eq(contacts.vertical, filters.vertical),
        ));
      const matchingIds = new Set(matchingContacts.map(c => c.id));
      rows = rows.filter(r => matchingIds.has(r.contactId));
    }

    // Filter by agent owner — resolve via deals → agentMerchants → agents
    if (filters.agentOwner && filters.agentOwner !== "all") {
      const contactIds = rows.map(r => r.contactId);
      if (contactIds.length === 0) return [];

      const agentName = filters.agentOwner.toLowerCase().trim();

      // Get all deals for these contacts
      const dealsForContacts = await db
        .select({ id: deals.id, contactId: deals.contactId })
        .from(deals)
        .where(inArray(deals.contactId, contactIds));

      const dealIds = dealsForContacts.map(d => d.id);
      if (dealIds.length === 0) return rows.filter(() => false);

      // Get agent assignments for those deals
      const assignments = await db
        .select({ agentId: agentMerchants.agentId, dealId: agentMerchants.dealId })
        .from(agentMerchants)
        .where(inArray(agentMerchants.dealId, dealIds));

      const agentIds = [...new Set(assignments.map(a => a.agentId))];
      if (agentIds.length === 0) return rows.filter(() => false);

      // Get agent records and filter by name
      const agentRecords = await db
        .select({ id: agents.id, firstName: agents.firstName, lastName: agents.lastName })
        .from(agents)
        .where(inArray(agents.id, agentIds));

      const matchingAgentIds = new Set(
        agentRecords
          .filter(a => `${a.firstName} ${a.lastName}`.toLowerCase().includes(agentName))
          .map(a => a.id)
      );

      // Build contactId → has matching agent
      const dealContactMap = new Map(dealsForContacts.map(d => [d.id, d.contactId]));
      const contactsWithMatchingAgent = new Set<number>();
      for (const assign of assignments) {
        if (matchingAgentIds.has(assign.agentId)) {
          const cid = dealContactMap.get(assign.dealId);
          if (cid) contactsWithMatchingAgent.add(cid);
        }
      }

      rows = rows.filter(r => contactsWithMatchingAgent.has(r.contactId));
    }

    return rows;
  }

  async getMerchantHealthScoreByContact(contactId: number): Promise<MerchantHealthScore | undefined> {
    const [row] = await db
      .select()
      .from(merchantHealthScores)
      .where(eq(merchantHealthScores.contactId, contactId))
      .orderBy(desc(merchantHealthScores.computedAt))
      .limit(1);
    return row;
  }

  async upsertMerchantHealthScore(data: InsertMerchantHealthScore): Promise<MerchantHealthScore> {
    const existing = await this.getMerchantHealthScoreByContact(data.contactId);
    if (existing) {
      const [updated] = await db
        .update(merchantHealthScores)
        .set({ ...data, computedAt: new Date() })
        .where(eq(merchantHealthScores.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(merchantHealthScores)
      .values({ ...data, computedAt: new Date() })
      .returning();
    return created;
  }

  async updateMerchantHealthScore(id: number, updates: Partial<InsertMerchantHealthScore>): Promise<MerchantHealthScore | undefined> {
    const [updated] = await db
      .update(merchantHealthScores)
      .set(updates)
      .where(eq(merchantHealthScores.id, id))
      .returning();
    return updated;
  }

  async getChurnScoreWeights(): Promise<ChurnScoreWeight[]> {
    const rows = await db.select().from(churnScoreWeights).orderBy(churnScoreWeights.signalKey);
    if (rows.length === 0) {
      await this.seedDefaultWeights();
      return await db.select().from(churnScoreWeights).orderBy(churnScoreWeights.signalKey);
    }
    return rows;
  }

  async upsertChurnScoreWeight(signalKey: string, weight: number, label?: string, description?: string): Promise<ChurnScoreWeight> {
    const existing = await db.select().from(churnScoreWeights).where(eq(churnScoreWeights.signalKey, signalKey)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db
        .update(churnScoreWeights)
        .set({ weight, updatedAt: new Date(), ...(label ? { label } : {}), ...(description ? { description } : {}) })
        .where(eq(churnScoreWeights.signalKey, signalKey))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(churnScoreWeights)
      .values({ signalKey, weight, label: label || signalKey, description: description || null })
      .returning();
    return created;
  }

  private async seedDefaultWeights(): Promise<void> {
    for (const w of DEFAULT_WEIGHTS) {
      await db
        .insert(churnScoreWeights)
        .values(w)
        .onConflictDoNothing();
    }
  }

  async getMerchantHealthScoresByTier(tier: string): Promise<MerchantHealthScore[]> {
    return await db
      .select()
      .from(merchantHealthScores)
      .where(eq(merchantHealthScores.riskTier, tier))
      .orderBy(desc(merchantHealthScores.churnScore));
  }

  async getChurnRiskSummary(): Promise<{ tier: string; count: number }[]> {
    const rows = await db
      .select({
        tier: merchantHealthScores.riskTier,
        count: sql<number>`count(*)`,
      })
      .from(merchantHealthScores)
      .groupBy(merchantHealthScores.riskTier);
    return rows.map(r => ({ tier: r.tier, count: Number(r.count) }));
  }
}
