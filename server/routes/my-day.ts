import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import { storage } from "../storage";
import { agents, agentMerchants, agentQuotas, deals, contacts, tasks, callLogs, SALES_STAGES } from "@shared/schema";
import { eq, and, lte, gte, isNull, or, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";

const ALLOWED_ACTIVITY_TYPES = ["call", "email", "sms", "meeting", "voicemail"] as const;

const logActivitySchema = z.object({
  contactId: z.number().int().positive(),
  type: z.enum(ALLOWED_ACTIVITY_TYPES).default("call"),
  notes: z.string().max(1000).optional(),
});

const moveStageSchema = z.object({
  stage: z.enum(SALES_STAGES as unknown as [string, ...string[]]),
});

interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

async function getAgentForUser(userId: string) {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

function getAuthUser(req: Request, res: Response): AuthUser | null {
  const user = req.user as AuthUser | undefined;
  if (!user?.id) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return user;
}

export function registerMyDayRoutes(app: Express) {
  app.get("/api/my-day", isAuthenticated, async (req, res) => {
    try {
      const user = getAuthUser(req, res);
      if (!user) return;

      const agent = await getAgentForUser(user.id);
      if (!agent) {
        return res.json({
          agent: null,
          contacts: [],
          dealsByStage: {},
          openDeals: [],
          quota: null,
          closedWonThisMonth: 0,
          tasksToday: [],
        });
      }

      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

      const agentDealLinks = await db
        .select()
        .from(agentMerchants)
        .where(eq(agentMerchants.agentId, agent.id));

      const agentDealIds = agentDealLinks
        .map((am) => am.dealId)
        .filter((id): id is number => typeof id === "number" && !isNaN(id));

      let myDeals: (typeof deals.$inferSelect)[] = [];
      if (agentDealIds.length > 0) {
        myDeals = await db
          .select()
          .from(deals)
          .where(and(inArray(deals.id, agentDealIds), isNull(deals.archivedAt)))
          .orderBy(desc(deals.updatedAt));
      }

      const allQuotas = await db
        .select()
        .from(agentQuotas)
        .where(eq(agentQuotas.agentId, agent.id))
        .orderBy(desc(agentQuotas.createdAt));

      const quota =
        allQuotas.find((q) => {
          const start = new Date(q.periodStart);
          const end = new Date(q.periodEnd);
          return today >= start && today <= end;
        }) ??
        allQuotas[0] ??
        null;

      const dealContactIds = myDeals
        .map((d) => d.contactId)
        .filter((id): id is number => typeof id === "number" && !isNaN(id));

      let myContacts: (typeof contacts.$inferSelect)[] = [];
      if (dealContactIds.length > 0) {
        myContacts = await db
          .select()
          .from(contacts)
          .where(and(inArray(contacts.id, dealContactIds), isNull(contacts.archivedAt)))
          .orderBy(desc(contacts.leadScore))
          .limit(20);
      }

      const agentName = `${agent.firstName} ${agent.lastName}`;

      const myTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            or(eq(tasks.assignedTo, agentName), eq(tasks.assignedTo, user.email ?? "")),
            or(
              and(gte(tasks.dueDate, startOfToday), lte(tasks.dueDate, endOfToday)),
              and(
                lte(tasks.dueDate, startOfToday),
                or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress"))
              )
            )
          )
        )
        .orderBy(tasks.dueDate)
        .limit(20);

      const openDeals = myDeals.filter(
        (d) => d.stage !== "Closed Won" && d.stage !== "Closed Lost"
      );

      const closedWonThisMonth = myDeals.filter((d) => {
        if (d.stage !== "Closed Won" || !d.closedAt) return false;
        const closed = new Date(d.closedAt);
        return closed >= startOfMonth && closed <= endOfMonth;
      });

      const dealsByStage: Record<string, typeof openDeals> = {};
      for (const d of openDeals) {
        if (!dealsByStage[d.stage]) dealsByStage[d.stage] = [];
        dealsByStage[d.stage].push(d);
      }

      const contactsForDeals = myContacts.map((c) => {
        const relatedDeal = myDeals.find((d) => d.contactId === c.id);
        return {
          ...c,
          dealStage: relatedDeal?.stage ?? null,
          dealId: relatedDeal?.id ?? null,
        };
      });

      let quotaWithActuals = quota;
      if (quota) {
        const periodStart = new Date(quota.periodStart);
        const periodEnd = new Date(quota.periodEnd);
        const liveActualDeals = myDeals.filter((d) => {
          if (d.stage !== "Closed Won" || !d.closedAt) return false;
          const closed = new Date(d.closedAt);
          return closed >= periodStart && closed <= periodEnd;
        }).length;
        quotaWithActuals = { ...quota, actualDeals: liveActualDeals };
      }

      let recentActivity: Array<{
        id: number;
        contactId: number | null;
        outcome: string | null;
        summary: string | null;
        createdAt: Date | null;
        contactFirstName: string | null;
        contactLastName: string | null;
        contactCompanyName: string | null;
      }> = [];

      if (dealContactIds.length > 0) {
        recentActivity = await db
          .select({
            id: callLogs.id,
            contactId: callLogs.contactId,
            outcome: callLogs.outcome,
            summary: callLogs.summary,
            createdAt: callLogs.createdAt,
            contactFirstName: contacts.firstName,
            contactLastName: contacts.lastName,
            contactCompanyName: contacts.companyName,
          })
          .from(callLogs)
          .leftJoin(contacts, eq(callLogs.contactId, contacts.id))
          .where(inArray(callLogs.contactId, dealContactIds))
          .orderBy(desc(callLogs.createdAt))
          .limit(10);
      }

      return res.json({
        agent,
        contacts: contactsForDeals,
        dealsByStage,
        openDeals,
        quota: quotaWithActuals,
        closedWonThisMonth: closedWonThisMonth.length,
        tasksToday: myTasks,
        recentActivity,
      });
    } catch (err) {
      console.error("my-day GET error:", err);
      res.status(500).json({ message: "Failed to load dashboard data" });
    }
  });

  app.post("/api/my-day/log-activity", isAuthenticated, async (req, res) => {
    try {
      const user = getAuthUser(req, res);
      if (!user) return;

      const parsed = logActivitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      }
      const { contactId, type } = parsed.data;

      const agent = await getAgentForUser(user.id);
      if (!agent) {
        return res.status(403).json({ message: "No agent record found for your account" });
      }

      const agentDealLinks = await db
        .select({ dealId: agentMerchants.dealId })
        .from(agentMerchants)
        .where(eq(agentMerchants.agentId, agent.id));

      const agentDealIds = agentDealLinks
        .map((am) => am.dealId)
        .filter((id): id is number => typeof id === "number");

      if (agentDealIds.length === 0) {
        return res.status(403).json({ message: "No deals assigned to your account" });
      }

      const linkedDeals = await db
        .select({ contactId: deals.contactId })
        .from(deals)
        .where(inArray(deals.id, agentDealIds));

      const allowedContactIds = linkedDeals
        .map((d) => d.contactId)
        .filter((id): id is number => typeof id === "number");

      if (!allowedContactIds.includes(contactId)) {
        return res.status(403).json({ message: "Contact not assigned to you" });
      }

      const [contactBefore] = await db.select().from(contacts).where(eq(contacts.id, contactId));
      const [contactAfter] = await db
        .update(contacts)
        .set({
          lastContactedAt: new Date(),
          lastContactChannel: type,
          contactAttempts: sql`${contacts.contactAttempts} + 1`,
        })
        .where(eq(contacts.id, contactId))
        .returning();
      const { auditChange } = await import("../services/audit-change");
      await auditChange({ actorType: "user", userId: user.id ?? null, action: "contact_activity_logged",
        entityType: "contact", entityId: contactId,
        before: (contactBefore ?? null) as unknown as Record<string, unknown>,
        after: (contactAfter ?? null) as unknown as Record<string, unknown> });

      const relatedDeal = await db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.contactId, contactId), inArray(deals.id, agentDealIds)))
        .limit(1);

      await db.insert(callLogs).values({
        contactId,
        dealId: relatedDeal[0]?.id ?? null,
        direction: "outbound",
        outcome: type,
        summary: parsed.data.notes || null,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("my-day log-activity error:", err);
      res.status(500).json({ message: "Failed to log activity" });
    }
  });

  app.patch("/api/my-day/deals/:id/stage", isAuthenticated, async (req, res) => {
    try {
      const user = getAuthUser(req, res);
      if (!user) return;

      const dealId = parseInt(req.params.id, 10);
      if (isNaN(dealId)) {
        return res.status(400).json({ message: "Invalid deal id" });
      }

      const parsed = moveStageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stage", errors: parsed.error.flatten() });
      }
      const { stage } = parsed.data;

      const agent = await getAgentForUser(user.id);
      if (!agent) {
        return res.status(403).json({ message: "No agent record found for your account" });
      }

      const link = await db
        .select()
        .from(agentMerchants)
        .where(and(eq(agentMerchants.agentId, agent.id), eq(agentMerchants.dealId, dealId)))
        .limit(1);

      if (link.length === 0) {
        return res.status(403).json({ message: "Deal not assigned to you" });
      }

      const updatePayload: Record<string, unknown> = { stage };
      if (stage === "Closed Won") {
        updatePayload.closedAt = new Date();
      }

      await storage.updateDeal(dealId, updatePayload as any, { actorType: "user", userId: user.id ?? null });
      res.json({ success: true });
    } catch (err) {
      console.error("my-day move-stage error:", err);
      res.status(500).json({ message: "Failed to update deal stage" });
    }
  });
}
