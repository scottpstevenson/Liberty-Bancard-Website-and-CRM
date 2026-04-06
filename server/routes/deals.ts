import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertDealCompetitorSchema, insertDealSchema, insertPipelineStageSchema, insertStageAutomationRuleSchema } from "@shared/schema";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { scoreContact } from "../services/lead-scoring";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { estimateFromContact, estimateFromDeal, estimateFromProspect } from "../services/volume-estimator";
import { createPreferenceAwareNotification, sendCriticalEmailNotification } from "../services/digest-service";
import { parse } from "csv-parse/sync";
import path from "path";

export function registerDealsRoutes(app: Express) {
  // === DEALS ===
  app.get("/api/deals", isAuthenticated, async (req, res) => {
    try {
      const pipeline = req.query.pipeline as string | undefined;
      const deals = pipeline ? await storage.getDealsByPipeline(pipeline) : await storage.getDeals();
      res.json(deals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals", isAuthenticated, async (req, res) => {
    try {
      const input = insertDealSchema.parse(req.body);
      const deal = await storage.createDeal(input);
      await storage.createAuditLog({ action: "deal_created", entityType: "deal", entityId: deal.id, details: { pipeline: deal.pipeline, stage: deal.stage } });
      if (deal.contactId) {
        scoreContact(deal.contactId).catch(err => console.error("Lead scoring error:", err));
      }
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint generation error:", err));
      res.status(201).json(deal);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/deals/:id", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Not found" });
      res.json(deal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/deals/:id", isAuthenticated, async (req, res) => {
    try {
      const old = await storage.getDeal(Number(req.params.id));
      const updated = await storage.updateDeal(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      if (old && old.stage !== updated.stage) {
        await storage.createAuditLog({ action: "deal_stage_changed", entityType: "deal", entityId: updated.id, details: { from: old.stage, to: updated.stage } });
        await createPreferenceAwareNotification({ channel: "internal", title: "Deal Stage Changed", message: `Deal #${updated.id} moved from "${old.stage}" to "${updated.stage}"`, type: "info", metadata: { dealId: updated.id, eventType: "deal_stage_changed" } }, "deal_stage_changed");

        if (updated.stage === "Closed Won") {
          const closedContact = updated.contactId ? await storage.getContact(updated.contactId) : null;
          await createPreferenceAwareNotification({ channel: "internal", title: "Deal Closed Won!", message: `Deal #${updated.id}${closedContact ? ` — ${closedContact.firstName} ${closedContact.lastName}` : ""} has been closed won.`, type: "alert", metadata: { dealId: updated.id, eventType: "deal_closed_won" } }, "deal_closed_won");
          sendCriticalEmailNotification({ eventType: "deal_closed_won", subject: `Closed Won: Deal #${updated.id}${closedContact ? ` — ${closedContact.companyName || closedContact.firstName}` : ""}`, body: `<h3>Deal Closed Won</h3><p>Deal #${updated.id} has moved to <strong>Closed Won</strong>.</p>${closedContact ? `<p>Contact: ${closedContact.firstName} ${closedContact.lastName}${closedContact.companyName ? ` (${closedContact.companyName})` : ""}</p>` : ""}<p>Owner: ${updated.owner || "Unassigned"}</p>`, ownerName: updated.owner }).catch(err => console.error("Closed won email error:", err));
        }

        try {
          const matchingRules = await storage.getMatchingStageRules(updated.pipeline, old.stage, updated.stage);
          for (const rule of matchingRules) {
            const ruleActions = (rule.actions as any[]) || [];
            for (const action of ruleActions) {
              if (action.type === "create_task") {
                await storage.createTask({
                  title: action.title || `Auto: Stage moved to ${updated.stage}`,
                  assignedTo: action.assignedTo || updated.owner || "Unassigned",
                  priority: action.priority || "medium",
                  dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                  dealId: updated.id,
                  contactId: updated.contactId || undefined,
                });
              } else if (action.type === "send_notification") {
                await storage.createNotification({
                  channel: action.channel || "internal",
                  title: action.title || `Stage Automation: ${rule.name}`,
                  message: action.message || `Deal moved to ${updated.stage}`,
                  type: "info",
                });
              } else if (action.type === "create_follow_up") {
                const followUpDate = new Date(Date.now() + (action.delayHours || 24) * 3600000);
                await storage.createTask({
                  title: action.title || `Follow up: ${updated.stage}`,
                  assignedTo: updated.owner || "Unassigned",
                  priority: "high",
                  dueDate: followUpDate,
                  dealId: updated.id,
                  contactId: updated.contactId || undefined,
                  description: action.description || `Auto-generated follow-up from stage automation rule: ${rule.name}`,
                });
              } else if (action.type === "enroll_sequence" && action.sequenceId) {
                await storage.createSequenceEnrollment({
                  sequenceId: action.sequenceId,
                  contactId: updated.contactId || undefined,
                  dealId: updated.id,
                  status: "active",
                  nextActionAt: new Date(),
                  currentStep: 0,
                });
              }
            }
            await storage.createAuditLog({
              action: "stage_rule_triggered",
              entityType: "deal",
              entityId: updated.id,
              details: { ruleName: rule.name, fromStage: old.stage, toStage: updated.stage },
            });
          }
        } catch (ruleErr) {
          console.error("Stage automation error:", ruleErr);
        }

        try {
          const contact = updated.contactId ? await storage.getContact(updated.contactId) : null;
          const volumeEst = estimateFromDeal(updated, contact);
          await storage.updateDeal(updated.id, {
            estimatedGrossProfitBps: volumeEst.estimatedGrossProfitBps,
            estimatedGrossProfitMonthly: volumeEst.estimatedGrossProfitMonthly,
            estimatedNetProfitMonthly: volumeEst.estimatedNetProfitMonthly,
            merchantTier: volumeEst.merchantTier,
          });
          if (contact) {
            await storage.updateContact(contact.id, {
              estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
              estimatedResidual: volumeEst.estimatedResidual,
              volumeConfidence: volumeEst.volumeConfidence,
            });
          }
        } catch (volErr) {
          console.error("Volume estimate recalc error:", volErr);
        }

        autoEnrollFromTrigger("deal_stage_changed", {
          contactId: updated.contactId || undefined,
          dealId: updated.id,
          toStage: updated.stage,
          fromStage: old.stage,
          pipeline: updated.pipeline,
        } as any).catch(err => console.error("Auto-enroll on stage change error:", err));

        triggerWorkflowsByEvent("deal_stage_changed", {
          entityType: "deal",
          entityId: updated.id,
          contactId: updated.contactId || undefined,
          dealId: updated.id,
        }, { toStage: updated.stage, fromStage: old.stage }).catch(err => console.error("Workflow trigger error:", err));
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const estimate = estimateFromDeal(deal, contact);
      await storage.updateDeal(deal.id, {
        estimatedGrossProfitBps: estimate.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: estimate.estimatedGrossProfitMonthly,
        estimatedNetProfitMonthly: estimate.estimatedNetProfitMonthly,
        merchantTier: estimate.merchantTier,
      });
      if (contact) {
        await storage.updateContact(contact.id, {
          estimatedProcessingVolume: estimate.estimatedProcessingVolume,
          estimatedResidual: estimate.estimatedResidual,
          volumeConfidence: estimate.volumeConfidence,
        });
      }
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const contact = await storage.getContact(Number(req.params.id));
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const estimate = estimateFromContact(contact);
      await storage.updateContact(contact.id, {
        estimatedProcessingVolume: estimate.estimatedProcessingVolume,
        estimatedResidual: estimate.estimatedResidual,
        volumeConfidence: estimate.volumeConfidence,
      });
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/prospects/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const prospect = await storage.getProspect(Number(req.params.id));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      const estimate = estimateFromProspect(prospect);
      await storage.updateProspect(prospect.id, {
        estimatedVolume: estimate.estimatedProcessingVolume,
        estimatedResidual: estimate.estimatedResidual,
        estimatedAvgTicket: estimate.estimatedAvgTicket,
      });
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === DEAL COMPETITORS ===
  app.get("/api/deal-competitors", isAuthenticated, async (req, res) => {
    try {
      const competitors = await storage.getDealCompetitors();
      res.json(competitors);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/deal-competitors/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const competitors = await storage.getDealCompetitorsByDeal(Number(req.params.dealId));
      res.json(competitors);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deal-competitors", isAuthenticated, async (req, res) => {
    try {
      const input = insertDealCompetitorSchema.parse(req.body);
      const competitor = await storage.createDealCompetitor(input);
      res.status(201).json(competitor);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/deal-competitors/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateDealCompetitor(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === STAGE AUTOMATION RULES ===
  app.get("/api/stage-rules", isAuthenticated, async (req, res) => {
    try {
      const pipeline = req.query.pipeline as string | undefined;
      const rules = await storage.getStageAutomationRules(pipeline);
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stage-rules/:id", isAuthenticated, async (req, res) => {
    try {
      const rule = await storage.getStageAutomationRule(Number(req.params.id));
      if (!rule) return res.status(404).json({ message: "Not found" });
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stage-rules", isAuthenticated, async (req, res) => {
    try {
      const input = insertStageAutomationRuleSchema.parse(req.body);
      const rule = await storage.createStageAutomationRule(input);
      await storage.createAuditLog({ action: "stage_rule_created", entityType: "stage_rule", entityId: rule.id, details: { name: rule.name, pipeline: rule.pipeline } });
      res.status(201).json(rule);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/stage-rules/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateStageAutomationRule(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/stage-rules/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteStageAutomationRule(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === PIPELINE STAGES CONFIGURATION ===
  app.get("/api/pipeline-stages", isAuthenticated, async (req, res) => {
    try {
      const pipeline = req.query.pipeline ? String(req.query.pipeline) : undefined;
      const stages = await storage.getPipelineStages(pipeline);
      res.json(stages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pipeline-stages", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const input = insertPipelineStageSchema.parse(req.body);
      const stage = await storage.createPipelineStage(input);
      res.status(201).json(stage);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/pipeline-stages/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const updated = await storage.updatePipelineStage(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/pipeline-stages/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      await storage.deletePipelineStage(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pipeline-stages/reorder", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { stages } = req.body;
      if (!Array.isArray(stages)) return res.status(400).json({ message: "stages array required" });
      for (const s of stages) {
        await storage.updatePipelineStage(s.id, { sortOrder: s.sortOrder });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AUTO DEAL STAGE PROGRESSION ===
  app.post("/api/ai/auto-progress-deals", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const progressions: Array<{ dealId: number; from: string; to: string; reason: string }> = [];

      const stageOrder = ["New Lead", "Statement Collected", "Under Review", "Proposal Sent", "Negotiation", "Verbal Commit", "Closed Won"];

      for (const deal of salesDeals) {
        const currentIndex = stageOrder.indexOf(deal.stage);
        if (currentIndex < 0) continue;

        let shouldAdvance = false;
        let reason = "";

        if (deal.stage === "New Lead" && deal.lastStatementReviewDate) {
          shouldAdvance = true;
          reason = "Statement document received - advancing to review";
        }
        if (deal.stage === "Statement Collected" && deal.recommendedPath) {
          shouldAdvance = true;
          reason = "Statement review completed with recommendation - advancing to proposal";
        }
        if (deal.stage === "Under Review" && deal.effectiveRate) {
          shouldAdvance = true;
          reason = "Review analysis complete - advancing to proposal sent";
        }

        if (shouldAdvance && currentIndex + 1 < stageOrder.length) {
          const nextStage = stageOrder[currentIndex + 1];
          await storage.updateDeal(deal.id, { stage: nextStage });
          progressions.push({ dealId: deal.id, from: deal.stage, to: nextStage, reason });
          await storage.createAuditLog({ action: "deal_auto_progressed", entityType: "deal", entityId: deal.id, details: { from: deal.stage, to: nextStage, reason } });
        }
      }

      res.json({ progressed: progressions.length, progressions });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === ENHANCED DEAL STAGE CHANGE WITH AUTOMATION ===
  // (Stage automation is now handled in the existing PUT /api/deals/:id route enhancement)

}
