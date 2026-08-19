import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { db } from "../db";
import { storage } from "../storage";
import { botContexts, handoffRules, maEvents, entityRelationships, companies, ghlActivityLog, contacts, systemSettings } from "@shared/schema";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAllBotContexts } from "../services/sdr/conversation-ai";
import { addTag, updateCustomFields, disableConversationAi, isSdrGhlConfigured } from "../services/sdr/ghl-client";
import { requireGhlRouteMutationAllowed } from "./ghl-mutation-pause";
import { serverError } from "../utils/server-error";

const DEFAULT_BOT_SEEDS = [
  {
    contextId: "homepage_general",
    name: "Homepage Qualification Bot",
    systemPrompt: `You are a friendly AI assistant for Liberty Bancard, a leading payment processing company.
Your goal is to qualify website visitors and capture their contact information for a free savings review.

Key behaviors:
- Greet warmly, ask what brings them to Liberty Bancard
- Identify their business type (restaurant, retail, medical, etc.)
- Ask about their current payment processing situation
- NEVER quote specific rates or pricing — say "we tailor pricing to each business"
- Offer a free savings analysis / statement review
- Capture: business name, contact name, email, phone
- If they're interested, offer to book a call with a specialist
- Include compliance disclaimer: "By providing your information, you consent to being contacted by Liberty Bancard regarding payment processing services."

Value propositions to mention naturally:
- Save up to 40% on processing fees
- No long-term contracts
- Next-day funding available
- Free terminal / POS equipment
- 24/7 US-based support
- Transparent pricing with no hidden fees`,
    faqItems: [
      { question: "How much can I save?", answer: "Most merchants save 20-40% on their processing fees." },
      { question: "Do you require a long-term contract?", answer: "No — we offer month-to-month agreements." },
    ],
    autoReplyEnabled: false,
    autoReplyDelaySeconds: 180,
    confidenceThreshold: 60,
    channel: "all",
    active: true,
  },
  {
    contextId: "vertical_restaurant",
    name: "Restaurant Industry Bot",
    systemPrompt: `You are a payment processing specialist for restaurants at Liberty Bancard.
You understand the unique needs of food service businesses.

Key talking points:
- Integration with popular POS systems (Toast, Square, Clover)
- Tip adjustment and tip pooling features
- Online ordering and delivery integration
- Lower rates than typical restaurant processors

Qualification questions:
- How many locations do you have?
- What POS system do you currently use?
- What's your approximate monthly card volume?

NEVER quote specific rates. Always offer a free savings analysis.
Capture: business name, contact name, email, phone.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
    faqItems: [],
    autoReplyEnabled: false,
    autoReplyDelaySeconds: 180,
    confidenceThreshold: 60,
    channel: "all",
    verticalKey: "Restaurant",
    active: true,
  },
  {
    contextId: "vertical_medspa",
    name: "MedSpa / Aesthetics Bot",
    systemPrompt: `You are a payment processing specialist for medical spas and aesthetics practices at Liberty Bancard.

Key talking points:
- HIPAA-aware payment solutions
- Recurring billing for membership programs
- High-ticket transaction support ($300-$2000+ average)
- Chargeback protection for service businesses

NEVER quote specific rates. Always offer a free savings analysis.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
    faqItems: [],
    autoReplyEnabled: false,
    autoReplyDelaySeconds: 180,
    confidenceThreshold: 60,
    channel: "all",
    verticalKey: "Salon/Spa",
    active: true,
  },
  {
    contextId: "vertical_dental",
    name: "Dental Practice Bot",
    systemPrompt: `You are a payment processing specialist for dental practices at Liberty Bancard.

Key talking points:
- Integration with dental practice management software
- Patient financing and payment plan support
- Contactless and mobile check-in payments

NEVER quote specific rates. Always offer a free savings analysis.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
    faqItems: [],
    autoReplyEnabled: false,
    autoReplyDelaySeconds: 180,
    confidenceThreshold: 60,
    channel: "all",
    verticalKey: "Healthcare",
    active: true,
  },
  {
    contextId: "vertical_auto",
    name: "Auto Services Bot",
    systemPrompt: `You are a payment processing specialist for auto repair and service businesses at Liberty Bancard.

Key talking points:
- High-ticket transaction support for repairs
- Fleet and commercial account billing
- Mobile payment for roadside/towing services

NEVER quote specific rates. Always offer a free savings analysis.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
    faqItems: [],
    autoReplyEnabled: false,
    autoReplyDelaySeconds: 180,
    confidenceThreshold: 60,
    channel: "all",
    verticalKey: "Auto",
    active: true,
  },
  {
    contextId: "existing_lead",
    name: "Existing Lead Follow-up Bot",
    systemPrompt: `You are a helpful AI assistant continuing a conversation with someone who has already expressed interest in Liberty Bancard's payment processing services.

Key behaviors:
- Reference their previous interaction if context is available
- Answer follow-up questions about the process
- If they haven't booked yet, gently encourage scheduling a call
- Address common objections about contracts, time, or current processors

NEVER quote specific rates. Guide them toward booking a consultation.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
    faqItems: [],
    autoReplyEnabled: true,
    autoReplyDelaySeconds: 900,
    confidenceThreshold: 60,
    channel: "email",
    active: true,
  },
];

const DEFAULT_HANDOFF_SEEDS = [
  { pattern: "talk to (a |an )?(real |actual |human |live )?person", type: "explicit", description: "Request to speak with a person", active: true },
  { pattern: "speak (to|with) (a |an )?(human|agent|rep|representative)", type: "explicit", description: "Request to speak with agent/rep", active: true },
  { pattern: "real person|stop (the )?bot|not (a )?bot", type: "explicit", description: "Anti-bot signals", active: true },
  { pattern: "this is (ridiculous|absurd|unacceptable|terrible|garbage)", type: "angry", description: "Strong negative sentiment", active: true },
  { pattern: "scam|rip( |-)?off|sue you|lawsuit|worst (company|service)", type: "angry", description: "Escalation threat signals", active: true },
  { pattern: "interchange\\s*(plus|rate|\\+)|basis points|bps\\b", type: "complex_pricing", description: "Technical interchange pricing questions", active: true },
  { pattern: "assessment fees|per(-| )?transaction fee|batch fee|pci (compliance|fee)", type: "complex_pricing", description: "Technical fee questions", active: true },
  { pattern: "i don't understand|already (asked|said|told you) that|going in circles", type: "low_confidence", description: "Repeated confusion signals", active: true },
];

async function ensureSeeded() {
  const existing = await db.select({ id: botContexts.id }).from(botContexts).limit(1);
  if (existing.length > 0) return;
  for (const seed of DEFAULT_BOT_SEEDS) {
    await db.insert(botContexts).values(seed).onConflictDoNothing();
  }
  for (const seed of DEFAULT_HANDOFF_SEEDS) {
    await db.insert(handoffRules).values(seed).onConflictDoNothing();
  }
  console.log("[BotConfig] Seeded bot_contexts and handoff_rules with defaults");
}

export function registerConversationAiConfigRoutes(app: Express) {
  ensureSeeded().catch(err => console.error("[BotConfig] Seed error:", err));

  // ─── Bot Contexts ──────────────────────────────────────────────────────────
  app.get("/api/bot-contexts", isDashboardUser, async (_req, res) => {
    try {
      const rows = await db.select().from(botContexts).orderBy(botContexts.id);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/bot-contexts/:id", isDashboardUser, async (req, res) => {
    try {
      const [row] = await db.select().from(botContexts).where(eq(botContexts.id, Number(req.params.id)));
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/bot-contexts/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1).optional(),
        systemPrompt: z.string().min(10).optional(),
        faqItems: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
        active: z.boolean().optional(),
        autoReplyEnabled: z.boolean().optional(),
        autoReplyDelaySeconds: z.number().int().min(30).max(86400).optional(),
        confidenceThreshold: z.number().int().min(0).max(100).optional(),
        channel: z.enum(["all", "chat", "sms", "email"]).optional(),
      });
      const updates = schema.parse(req.body);
      const [updated] = await db.update(botContexts)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(botContexts.id, Number(req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Not found" });
      await storage.createAuditLog({
        action: "bot_context_updated",
        entityType: "bot_context" as any,
        entityId: updated.id,
        actorType: "user",
        actorId: (req.user as any)?.id?.toString() ?? null,
        details: { contextId: updated.contextId, updates },
      });
      res.json(updated);
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      serverError(res, err);
    }
  });

  app.post("/api/bot-contexts/seed", requireRole("admin"), async (_req, res) => {
    try {
      await db.delete(botContexts);
      for (const seed of DEFAULT_BOT_SEEDS) {
        await db.insert(botContexts).values(seed);
      }
      await db.delete(handoffRules);
      for (const seed of DEFAULT_HANDOFF_SEEDS) {
        await db.insert(handoffRules).values(seed);
      }
      res.json({ ok: true, message: "Bot contexts and handoff rules reset to defaults" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── Handoff Rules ─────────────────────────────────────────────────────────
  app.get("/api/handoff-rules", isDashboardUser, async (_req, res) => {
    try {
      const rows = await db.select().from(handoffRules).orderBy(handoffRules.type, handoffRules.id);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/handoff-rules", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        pattern: z.string().min(1),
        type: z.enum(["explicit", "angry", "complex_pricing", "low_confidence"]),
        description: z.string().optional(),
        active: z.boolean().optional(),
      });
      const data = schema.parse(req.body);
      const [row] = await db.insert(handoffRules).values(data).returning();
      res.status(201).json(row);
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      serverError(res, err);
    }
  });

  app.patch("/api/handoff-rules/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        pattern: z.string().min(1).optional(),
        type: z.enum(["explicit", "angry", "complex_pricing", "low_confidence"]).optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
      });
      const updates = schema.parse(req.body);
      const [row] = await db.update(handoffRules).set(updates).where(eq(handoffRules.id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      serverError(res, err);
    }
  });

  app.delete("/api/handoff-rules/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await db.delete(handoffRules).where(eq(handoffRules.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── Live Bot Conversations ────────────────────────────────────────────────
  app.get("/api/bot-conversations/live", isDashboardUser, async (_req, res) => {
    try {
      const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const logs = await db.select().from(ghlActivityLog)
        .where(and(
          gte(ghlActivityLog.createdAt, cutoff),
        ))
        .orderBy(desc(ghlActivityLog.createdAt))
        .limit(500);

      const botLogs = logs.filter(l =>
        l.metadata && typeof l.metadata === "object" && (l.metadata as any).source === "bot" && l.contactId
      );

      const sessionMap = new Map<number, {
        contactId: number;
        channel: string;
        lastAt: Date;
        messageCount: number;
        lastMessage?: string;
      }>();

      for (const l of botLogs) {
        if (!l.contactId) continue;
        const existing = sessionMap.get(l.contactId);
        if (!existing || l.createdAt! > existing.lastAt) {
          sessionMap.set(l.contactId, {
            contactId: l.contactId,
            channel: l.channel,
            lastAt: l.createdAt ?? new Date(),
            messageCount: (existing?.messageCount ?? 0) + 1,
            lastMessage: l.body?.slice(0, 120) ?? undefined,
          });
        } else {
          existing.messageCount++;
        }
      }

      const sessions = await Promise.all(
        Array.from(sessionMap.values()).map(async s => {
          const contact = await storage.getContact(s.contactId).catch(() => null);
          return {
            ...s,
            lastAt: s.lastAt.toISOString(),
            contactName: contact ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() : `Contact #${s.contactId}`,
            companyName: contact?.companyName ?? "",
            email: contact?.email ?? "",
            minutesActive: Math.round((Date.now() - s.lastAt.getTime()) / 60000),
          };
        })
      );

      res.json(sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/bot-conversations/:contactId/takeover", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      if (contact.ghlContactId && isSdrGhlConfigured()) {
        if (!(await requireGhlRouteMutationAllowed(res))) return;
        await addTag({ contactId: contact.ghlContactId, tags: ["LB-HUMAN-HANDOFF", "LB-CHAT-HANDOFF"] });
        await updateCustomFields(contact.ghlContactId, { lb_owner_type: "human", lb_last_ai_outcome: "human_takeover_dashboard" });
        await disableConversationAi(contact.ghlContactId);
      }

      await storage.createAuditLog({
        action: "bot_conversation_takeover",
        entityType: "contact",
        entityId: contactId,
        actorType: "user",
        actorId: (req.user as any)?.id?.toString() ?? null,
        details: { contactId, takenOverAt: new Date().toISOString() },
      });

      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── M&A Events ────────────────────────────────────────────────────────────
  app.get("/api/ma-events", isDashboardUser, async (req, res) => {
    try {
      const entityType = req.query.entityType as string;
      const entityId = Number(req.query.entityId);
      if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
      const rows = await db.select().from(maEvents)
        .where(and(eq(maEvents.entityType, entityType), eq(maEvents.entityId, entityId)))
        .orderBy(desc(maEvents.createdAt));
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Security: M&A event creation restricted to admin/manager only
  app.post("/api/ma-events", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        entityType: z.enum(["contact", "company"]),
        entityId: z.number().int(),
        eventType: z.enum(["acquired", "merged_into", "rebranded", "closed", "spun_off"]),
        counterpartyName: z.string().optional(),
        counterpartyContactId: z.number().int().optional(),
        eventDate: z.string().optional(),
        note: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const userId = (req.user as any)?.id?.toString() ?? null;
      const [row] = await db.insert(maEvents).values({
        ...data,
        eventDate: data.eventDate ? new Date(data.eventDate) : undefined,
        createdBy: userId,
      }).returning();

      if (data.counterpartyContactId) {
        const relTypeMap: Record<string, string> = {
          acquired: "same_owner",
          merged_into: "same_ein",
          rebranded: "same_address",
          closed: "same_owner",
          spun_off: "same_owner",
        };
        await db.insert(entityRelationships).values({
          sourceEntityType: data.entityType as any,
          sourceEntityId: data.entityId,
          targetEntityType: "contact" as any,
          targetEntityId: data.counterpartyContactId,
          relationshipType: relTypeMap[data.eventType] as any ?? "same_owner",
          confidence: 0.9,
          source: "ma_event",
          metadata: { eventType: data.eventType, maEventId: row.id },
        } as any).onConflictDoNothing();
      }

      await storage.createAuditLog({
        action: "ma_event_created",
        entityType: data.entityType as any,
        entityId: data.entityId,
        actorType: "user",
        actorId: userId,
        details: { eventType: data.eventType, counterpartyName: data.counterpartyName },
      });

      res.status(201).json(row);
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      serverError(res, err);
    }
  });

  app.delete("/api/ma-events/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await db.delete(maEvents).where(eq(maEvents.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── Contact Intelligence ──────────────────────────────────────────────────
  app.patch("/api/contacts/:id/decision-maker", isDashboardUser, async (req, res) => {
    try {
      const schema = z.object({ isDecisionMaker: z.boolean() });
      const { isDecisionMaker } = schema.parse(req.body);
      const [updated] = await db.update(contacts)
        .set({ isDecisionMaker, decisionMakerConfidence: isDecisionMaker ? 100 : 0 } as any)
        .where(eq(contacts.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error" });
      serverError(res, err);
    }
  });

  // NOTE: PATCH /api/contacts/:id/management-type is registered in contacts.ts — removed duplicate here.
  // NOTE: PATCH /api/companies/:id/management-type is registered in contacts.ts — removed duplicate here.

  app.get("/api/contacts/:id/intelligence", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Not found" });

      const [maEventsData, allContacts] = await Promise.all([
        db.select().from(maEvents).where(and(eq(maEvents.entityType, "contact"), eq(maEvents.entityId, contactId))).orderBy(desc(maEvents.createdAt)),
        contact.isParentAccount
          ? storage.getContacts({ limit: 500 }).then(r => (r.data || r).filter((c: any) => c.parentContactId === contactId || c.id === contactId))
          : Promise.resolve([contact]),
      ]);

      const emailHealthSummary = {
        total: allContacts.length,
        active: allContacts.filter((c: any) => !c.emailStatus || c.emailStatus === "active").length,
        bounced: allContacts.filter((c: any) => c.emailStatus === "bounced").length,
        invalid: allContacts.filter((c: any) => c.emailStatus === "invalid").length,
        optedOut: allContacts.filter((c: any) => c.emailStatus === "opted-out" || c.doNotContact).length,
      };

      res.json({
        contactId,
        isDecisionMaker: (contact as any).isDecisionMaker ?? false,
        decisionMakerConfidence: (contact as any).decisionMakerConfidence ?? 0,
        emailStatus: (contact as any).emailStatus ?? "active",
        managementType: (contact as any).managementType ?? "unknown",
        isParentAccount: contact.isParentAccount ?? false,
        emailHealthSummary,
        maEvents: maEventsData,
        childLocations: allContacts.filter((c: any) => c.id !== contactId).map((c: any) => ({
          id: c.id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
          companyName: c.companyName,
          locationName: c.locationName,
          emailStatus: c.emailStatus || "active",
          email: c.email,
        })),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // NOTE: GET /api/sdr/operator/bounce-feedback-summary is registered in sdr.ts with isAdmin — removed duplicate here.
}
