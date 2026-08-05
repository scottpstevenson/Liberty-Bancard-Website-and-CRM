import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { parseId } from "./helpers";
import { storage } from "../storage";
import { db } from "../db";
import { merchantOnboardingStages, deals, contacts, tasks, MERCHANT_ONBOARDING_STAGE_KEYS } from "@shared/schema";
import { eq, and, lt, isNull } from "drizzle-orm";

export function registerOnboardingStagesRoutes(app: Express) {
  // ── GET all stages for a deal ──────────────────────────────────────────────
  app.get("/api/deals/:id/onboarding-stages", isDashboardUser, async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (dealId === null) return res.status(404).json({ message: "Deal not found" });
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const stages = await storage.getMerchantOnboardingStages(dealId);
      res.json(stages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Initialize stages for a deal (idempotent) ──────────────────────────────
  app.post("/api/deals/:id/onboarding-stages/initialize", isDashboardUser, async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (dealId === null) return res.status(404).json({ message: "Deal not found" });
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const stages = await storage.initializeMerchantOnboardingStages(dealId);
      await storage.createAuditLog({
        action: "onboarding_stages_initialized",
        entityType: "deal",
        entityId: dealId,
        details: { stageCount: stages.length },
      });
      res.json(stages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH a single stage ───────────────────────────────────────────────────
  app.patch("/api/deals/:id/onboarding-stages/:stageKey", isDashboardUser, async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (dealId === null) return res.status(404).json({ message: "Deal not found" });
      const stageKey = req.params.stageKey;
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      if (!MERCHANT_ONBOARDING_STAGE_KEYS.includes(stageKey as any)) {
        return res.status(400).json({ message: `Invalid stage key: ${stageKey}` });
      }

      const { status, owner, dueDate, notes, equipmentOrderRef } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };

      if (status !== undefined) {
        const validStatuses = ["pending", "in_progress", "complete", "blocked"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ message: `Invalid status: ${status}` });
        }
        updates.status = status;
        if (status === "complete") {
          updates.completedAt = new Date();
        } else {
          updates.completedAt = null;
        }
      }
      if (owner !== undefined) updates.owner = owner;
      if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
      if (notes !== undefined) updates.notes = notes;
      if (equipmentOrderRef !== undefined) updates.equipmentOrderRef = equipmentOrderRef;

      const stage = await storage.upsertMerchantOnboardingStage(dealId, String(stageKey), updates);

      // Write to audit log
      await storage.createAuditLog({
        action: "onboarding_stage_updated",
        entityType: "deal",
        entityId: dealId,
        details: { stageKey, ...updates },
      });

      // If stage moves to complete, log GHL stage note (non-blocking)
      if (status === "complete") {
        storage.createAuditLog({
          action: "onboarding_stage_completed",
          entityType: "deal",
          entityId: dealId,
          details: { stageKey, label: MERCHANT_ONBOARDING_STAGE_KEYS.includes(stageKey as any) ? stageKey : stageKey },
        }).catch(() => {});
      }

      res.json(stage);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET overdue stages across all onboarding deals ────────────────────────
  app.get("/api/onboarding-stages/overdue", isDashboardUser, async (req, res) => {
    try {
      const now = new Date();
      const overdue = await db
        .select({
          id: merchantOnboardingStages.id,
          dealId: merchantOnboardingStages.dealId,
          stageKey: merchantOnboardingStages.stageKey,
          status: merchantOnboardingStages.status,
          owner: merchantOnboardingStages.owner,
          dueDate: merchantOnboardingStages.dueDate,
          notes: merchantOnboardingStages.notes,
        })
        .from(merchantOnboardingStages)
        .where(
          and(
            lt(merchantOnboardingStages.dueDate, now),
            isNull(merchantOnboardingStages.completedAt),
          )
        )
        .limit(100);
      res.json(overdue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET account health summary for a contact ──────────────────────────────
  app.get("/api/contacts/:contactId/account-health", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseId(req.params.contactId);
      if (contactId === null) return res.status(404).json({ message: "Contact not found" });
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const contactDeals = await db
        .select()
        .from(deals)
        .where(eq(deals.contactId, contactId))
        .limit(50);
      const onboardingDeal = contactDeals.find(d => d.pipeline === "onboarding" && !d.archivedAt);
      const primaryDeal = contactDeals.find(d => !d.archivedAt) || null;

      // Compute health badge
      const lastContactDate = contact.lastContactedAt;
      const daysSinceContact = lastContactDate
        ? Math.floor((Date.now() - new Date(lastContactDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Volume trend from mid stats
      let processingVolumeTrend: "up" | "down" | "flat" | null = null;
      let chargebackRatio: number | null = null;
      let lastBatchDate: string | null = null;

      if (primaryDeal?.mid) {
        const stats = await storage.getMidDailyStatsByDeal(primaryDeal.id, 60);
        if (stats.length > 0) {
          lastBatchDate = stats[0]?.date || null;
          const recent = stats.slice(0, 30);
          const older = stats.slice(30, 60);
          const recentVol = recent.reduce((s, r) => s + (Number(r.volume) || 0), 0);
          const olderVol = older.reduce((s, r) => s + (Number(r.volume) || 0), 0);
          if (olderVol > 0) {
            processingVolumeTrend = recentVol > olderVol * 1.05 ? "up" : recentVol < olderVol * 0.95 ? "down" : "flat";
          }
          const totalVol = recent.reduce((s, r) => s + (Number(r.volume) || 0), 0);
          const totalCb = recent.reduce((s, r) => s + (Number(r.chargebackAmount) || 0), 0);
          chargebackRatio = totalVol > 0 ? totalCb / totalVol : 0;
        }
      }

      // Compute health status
      let healthStatus: "Healthy" | "At Risk" | "Attention Needed" = "Healthy";
      const reasons: string[] = [];

      if (chargebackRatio !== null && chargebackRatio > 0.01) {
        healthStatus = "At Risk";
        reasons.push(`Chargeback ratio ${(chargebackRatio * 100).toFixed(2)}% exceeds 1%`);
      }
      if (processingVolumeTrend === "down") {
        if (healthStatus === "Healthy") healthStatus = "At Risk";
        reasons.push("Processing volume declining");
      }
      if (daysSinceContact !== null && daysSinceContact > 90) {
        if (healthStatus === "Healthy") healthStatus = "Attention Needed";
        reasons.push(`No contact in ${daysSinceContact} days`);
      }

      // Get onboarding stages progress
      let onboardingProgress: { total: number; complete: number; pct: number } | null = null;
      if (onboardingDeal) {
        const stages = await storage.getMerchantOnboardingStages(onboardingDeal.id);
        const complete = stages.filter(s => s.status === "complete").length;
        onboardingProgress = {
          total: stages.length || MERCHANT_ONBOARDING_STAGE_KEYS.length,
          complete,
          pct: stages.length > 0 ? Math.round((complete / stages.length) * 100) : 0,
        };
      }

      // Scheduled touchpoints due (query directly)
      const allTasks = await db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status, source: tasks.source, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(eq(tasks.contactId, contactId), eq(tasks.status, "pending")))
        .limit(20);
      const pendingTouchpoints = allTasks.filter(t => t.source === "retention_touchpoint");

      res.json({
        contactId,
        healthStatus,
        healthReasons: reasons,
        lastContactDate: contact.lastContactedAt,
        daysSinceContact,
        processingVolumeTrend,
        chargebackRatio,
        lastBatchDate,
        onboardingProgress,
        pendingTouchpoints: pendingTouchpoints.length,
        primaryDealId: primaryDeal?.id || null,
        onboardingDealId: onboardingDeal?.id || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST: Create scheduled retention touchpoints for a contact ────────────
  app.post("/api/contacts/:contactId/retention-touchpoints", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = parseId(req.params.contactId);
      if (contactId === null) return res.status(404).json({ message: "Contact not found" });
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const now = new Date();
      const assignedTo = req.body.assignedTo || "Account Manager";

      const touchpoints = [
        {
          title: `Quarterly Rate Review — ${contact.companyName || contact.firstName}`,
          daysFromNow: 90,
          description: "Quarterly rate review touchpoint. Review current processing rates and identify savings opportunities.",
        },
        {
          title: `PCI Compliance Reminder — ${contact.companyName || contact.firstName}`,
          daysFromNow: 365,
          description: "Annual PCI compliance reminder. Confirm merchant has completed PCI questionnaire and is compliant.",
        },
        {
          title: `Equipment Refresh Check — ${contact.companyName || contact.firstName}`,
          daysFromNow: 540,
          description: "18-month equipment check. Review terminal age, software version, and recommend upgrade if needed.",
        },
        {
          title: `Referral Ask — ${contact.companyName || contact.firstName}`,
          daysFromNow: 60,
          description: "Ask merchant for a referral. Merchant has been active 60+ days — a good time to request introductions.",
        },
      ];

      const created = [];
      for (const tp of touchpoints) {
        const dueDate = new Date(now.getTime() + tp.daysFromNow * 24 * 60 * 60 * 1000);
        const task = await storage.createTask({
          contactId,
          title: tp.title,
          description: tp.description,
          assignedTo,
          dueDate,
          priority: "normal",
          source: "retention_touchpoint",
        } as any);
        created.push(task);
      }

      await storage.createAuditLog({
        action: "retention_touchpoints_created",
        entityType: "contact",
        entityId: contactId,
        details: { count: created.length, assignedTo },
      });

      res.json({ created: created.length, tasks: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET partner referral pipeline ─────────────────────────────────────────
  app.get("/api/partners/referral-pipeline", requireRole("admin", "manager"), async (req, res) => {
    try {
      const partners = await storage.getPartners();

      // Enrich each partner with referred merchant info
      const enriched = await Promise.all(
        partners.map(async (p) => {
          const partnerReferrals = await storage.getReferralsByPartner(p.id);
          const linkedContacts = partnerReferrals
            .filter(r => r.contactId)
            .map(r => r.contactId as number);

          // Sum pipeline value from deals linked to referred contacts
          let pipelineValue = 0;
          for (const cId of linkedContacts.slice(0, 10)) {
            const cDeals = await db
              .select({ totalVolume: deals.totalVolume })
              .from(deals)
              .where(eq(deals.contactId, cId))
              .limit(5);
            pipelineValue += cDeals.reduce((s, d) => s + (Number(d.totalVolume) || 0), 0);
          }

          // Get next follow-up task for the referral owner
          let nextFollowupDue: Date | null = null;
          if (p.referralOwner) {
            const followupRows = await db
              .select({ dueDate: tasks.dueDate })
              .from(tasks)
              .where(and(eq(tasks.assignedTo, p.referralOwner), eq(tasks.status, "pending")))
              .orderBy(tasks.dueDate)
              .limit(5);
            const row = followupRows.find(r => r.dueDate !== null);
            nextFollowupDue = row?.dueDate ?? null;
          }

          return {
            ...p,
            referredMerchantCount: partnerReferrals.length,
            pipelineValue,
            nextFollowupDue,
          };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH partner (enhanced fields: referralOwner, commissionStatus, etc.) ─
  app.patch("/api/partners/:id/tracking", requireRole("admin", "manager"), async (req, res) => {
    try {
      const partnerId = parseId(req.params.id);
      if (partnerId === null) return res.status(404).json({ message: "Partner not found" });
      const partner = await storage.getPartner(partnerId);
      if (!partner) return res.status(404).json({ message: "Partner not found" });

      const { referralOwner, commissionStatus, lastContactAt, partnerCategory, notes } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };

      if (referralOwner !== undefined) updates.referralOwner = referralOwner;
      if (commissionStatus !== undefined) {
        const validStatuses = ["pending", "approved", "paid"];
        if (!validStatuses.includes(commissionStatus)) {
          return res.status(400).json({ message: "commissionStatus must be pending, approved, or paid" });
        }
        updates.commissionStatus = commissionStatus;
      }
      if (lastContactAt !== undefined) updates.lastContactAt = lastContactAt ? new Date(lastContactAt) : null;
      if (partnerCategory !== undefined) updates.partnerCategory = partnerCategory;
      if (notes !== undefined) updates.notes = notes;

      const updated = await storage.updatePartner(partnerId, updates as any);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST: Link referral source on application to partner ──────────────────
  app.post("/api/partners/link-referral", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { contactId, dealId, referralSource, referredCompany, referredName, referredEmail } = req.body;

      if (!referralSource) return res.status(400).json({ message: "referralSource is required" });

      // Find partner by company name or affiliate code matching the referral source
      const allPartners = await storage.getPartners();
      const matched = allPartners.find(
        p => p.companyName?.toLowerCase() === referralSource.toLowerCase()
          || p.affiliateCode?.toLowerCase() === referralSource.toLowerCase()
          || p.contactName?.toLowerCase() === referralSource.toLowerCase()
      );

      if (!matched) {
        return res.status(404).json({ message: `No partner found matching referral source: ${referralSource}` });
      }

      // Create referral record
      const referral = await storage.createReferral({
        partnerId: matched.id,
        contactId: contactId || null,
        dealId: dealId || null,
        referredName: referredName || null,
        referredEmail: referredEmail || null,
        referredCompany: referredCompany || null,
        status: "pending",
      });

      // Update partner referred_count
      await storage.updatePartner(matched.id, {
        referredCount: (matched.referredCount || 0) + 1,
        updatedAt: new Date(),
      } as any);

      // Create follow-up task for referral owner
      if (matched.referralOwner) {
        await storage.createTask({
          contactId: contactId || undefined,
          dealId: dealId || undefined,
          title: `Follow up with referred lead — ${referredCompany || referredName || referredEmail || "New Lead"}`,
          description: `Referred by partner: ${matched.companyName}. Source: ${referralSource}`,
          assignedTo: matched.referralOwner,
          priority: "high",
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          source: "partner_referral",
        } as any);
      }

      // Create 30-day follow-up task for the partner
      await storage.createTask({
        title: `Partner check-in — ${matched.companyName}`,
        description: `Monthly check-in with partner ${matched.companyName}. Review recent referrals and pipeline status.`,
        assignedTo: matched.referralOwner || "Account Manager",
        priority: "normal",
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        source: "partner_followup",
      } as any);

      await storage.createAuditLog({
        action: "partner_referral_linked",
        entityType: "contact",
        entityId: contactId || undefined,
        details: { partnerId: matched.id, referralSource, referralId: referral.id },
      });

      res.json({ referral, partner: matched, tasksCreated: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
