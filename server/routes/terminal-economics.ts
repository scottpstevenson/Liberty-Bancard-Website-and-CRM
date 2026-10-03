import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { computeDealTerminalEconomics, getEconomicsConfig } from "../services/terminal-economics";
import { normalizeTaskCompletionState } from "../services/task-normalization";
import { serverError } from "../utils/server-error";
import { readTerminalRecommendationReport } from "../services/terminal-report-authority";

export function registerTerminalEconomicsRoutes(app: Express) {

  app.get("/api/equipment-models", isDashboardUser, async (_req, res) => {
    try {
      const models = await storage.getEquipmentModels();
      res.json(models);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/equipment-models/public", async (_req, res) => {
    try {
      const models = await storage.getEquipmentModels(true);
      res.json(models);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/equipment-models", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { name, category, description, msrp, libertyCost, isActive } = req.body;
      if (!name) return res.status(400).json({ message: "name is required" });
      const model = await storage.createEquipmentModel({
        name,
        category: category || "Terminal",
        description: description || null,
        msrp: Number(msrp) || 0,
        libertyCost: Number(libertyCost) || 0,
        isActive: isActive !== false,
      });
      await storage.createAuditLog({
        action: "equipment_model_created",
        entityType: "equipment_model",
        entityId: model.id,
        details: { name: model.name, libertyCost: model.libertyCost, msrp: model.msrp },
      });
      res.status(201).json(model);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/equipment-models/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateEquipmentModel(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      await storage.createAuditLog({
        action: "equipment_model_updated",
        entityType: "equipment_model",
        entityId: updated.id,
        details: req.body,
      });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/equipment-models/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteEquipmentModel(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/deals/:id/terminal-economics", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const result = await computeDealTerminalEconomics(dealId);
      if (!result) {
        return res.json({ available: false, reason: "No terminal recommendation or matching model" });
      }
      res.json({ available: true, ...result });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/terminal-economics/check-approval", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const result = await computeDealTerminalEconomics(dealId);
      if (!result || result.tier !== "red") {
        return res.json({ approvalRequired: false, tier: result?.tier || null });
      }

      if (deal.terminalApprovalStatus === "pending_approval" || deal.terminalApprovalStatus === "approved") {
        return res.json({ approvalRequired: true, approvalStatus: deal.terminalApprovalStatus, tier: "red" });
      }

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const merchantName = contact?.companyName || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || `Deal #${dealId}`;
      const paybackStr = result.paybackMonths ? `${result.paybackMonths}-month` : "unknown";

      const managers = await storage.getUsersByRole(["manager"]);
      const managerEmail = managers[0]?.email || process.env.ADMIN_EMAIL || "admin";

      const task = await storage.createAuthorityTask({
        dealId,
        contactId: deal.contactId || undefined,
        title: `Terminal approval needed — ${merchantName} — $${result.terminalCost.toFixed(0)} terminal, ${paybackStr} payback`,
        description: `Terminal "${result.terminalModel}" on Deal #${dealId} (${merchantName}) has a payback period of ${result.paybackMonths ?? "N/A"} months (threshold: ${result.yellowThreshold} months). Manager approval required before committing the free terminal.\n\nTerminal cost: $${result.terminalCost.toFixed(0)}\nMonthly GP: $${result.estimatedMonthlyGrossProfit.toFixed(0)}\nPayback: ${result.paybackMonths ?? "N/A"} months\n\nApprove or reject at: /dashboard/pipeline?deal=${dealId}`,
        assignedTo: managerEmail,
        priority: "high",
        dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });

      await storage.updateDeal(dealId, {
        terminalApprovalStatus: "pending_approval",
        terminalApprovalTaskId: task.id,
      } as any);

      await storage.createNotification({
        channel: "internal",
        title: "Terminal Approval Required",
        message: `Deal #${dealId} (${merchantName}) — ${result.terminalModel} terminal has ${result.paybackMonths ?? "N/A"}mo payback. Manager approval needed.`,
        type: "urgent",
        metadata: { dealId, terminalModel: result.terminalModel, paybackMonths: result.paybackMonths },
      });

      await storage.createAuditLog({
        action: "terminal_approval_requested",
        entityType: "deal",
        entityId: dealId,
        details: { terminalModel: result.terminalModel, terminalCost: result.terminalCost, paybackMonths: result.paybackMonths, taskId: task.id },
      });

      res.json({ approvalRequired: true, approvalStatus: "pending_approval", tier: "red", taskId: task.id });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/terminal-economics/approve", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      await storage.updateDeal(dealId, { terminalApprovalStatus: "approved" } as any);

      if (deal.terminalApprovalTaskId) {
        const existingTask = await storage.getTaskById(deal.terminalApprovalTaskId);
        const approveUpdate = normalizeTaskCompletionState(
          {
            status: "completed",
            completedAt: new Date(),
            description: `APPROVED by manager (${(req.user as any)?.email ?? "manager"}).\n\nDeal: /dashboard/pipeline?deal=${dealId}`,
          },
          existingTask ?? { status: "pending", completedAt: null },
        );
        await storage.updateTask(deal.terminalApprovalTaskId, approveUpdate);
      }

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const merchantName = contact?.companyName || `Deal #${dealId}`;

      await storage.createNotification({
        channel: "internal",
        title: "Terminal Approved",
        message: `Terminal for Deal #${dealId} (${merchantName}) has been approved by manager.`,
        type: "info",
        recipientId: deal.owner || undefined,
        metadata: { dealId },
      });

      await storage.createAuditLog({
        action: "terminal_approval_approved",
        entityType: "deal",
        entityId: dealId,
        details: { approvedBy: (req.user as any)?.id, terminalModel: deal.terminalRecommendation },
      });

      res.json({ success: true, terminalApprovalStatus: "approved" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/terminal-economics/reject", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const { reason } = req.body;
      await storage.updateDeal(dealId, { terminalApprovalStatus: "rejected" } as any);

      if (deal.terminalApprovalTaskId) {
        const existingTask = await storage.getTaskById(deal.terminalApprovalTaskId);
        const rejectUpdate = normalizeTaskCompletionState(
          { status: "completed", completedAt: new Date() },
          existingTask ?? { status: "pending", completedAt: null },
        );
        await storage.updateTask(deal.terminalApprovalTaskId, rejectUpdate);
      }

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const merchantName = contact?.companyName || `Deal #${dealId}`;

      await storage.createNotification({
        channel: "internal",
        title: "Terminal Rejected",
        message: `Terminal for Deal #${dealId} (${merchantName}) was rejected by manager.${reason ? ` Reason: ${reason}` : ""}`,
        type: "alert",
        recipientId: deal.owner || undefined,
        metadata: { dealId, reason },
      });

      await storage.createAuditLog({
        action: "terminal_approval_rejected",
        entityType: "deal",
        entityId: dealId,
        details: { rejectedBy: (req.user as any)?.id, reason, terminalModel: deal.terminalRecommendation },
      });

      res.json({ success: true, terminalApprovalStatus: "rejected" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/terminal-economics-config", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const config = await getEconomicsConfig();
      res.json(config);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/terminal-economics-config", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { greenThresholdMonths, yellowThresholdMonths } = req.body;
      const green = Number(greenThresholdMonths);
      const yellow = Number(yellowThresholdMonths);
      if (!green || !yellow || green <= 0 || yellow <= green) {
        return res.status(400).json({ message: "greenThresholdMonths must be > 0 and yellowThresholdMonths must be > greenThresholdMonths" });
      }
      await storage.setSystemSetting("terminal_economics_config", { greenThresholdMonths: green, yellowThresholdMonths: yellow });
      await storage.createAuditLog({
        action: "terminal_economics_config_updated",
        entityType: "system_setting",
        entityId: 0,
        details: { greenThresholdMonths: green, yellowThresholdMonths: yellow },
      });
      res.json({ success: true, greenThresholdMonths: green, yellowThresholdMonths: yellow });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/terminal-roi-report", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = await getEconomicsConfig();
      const page = Number(req.query.page ?? 0);
      if (!Number.isSafeInteger(page) || page < 0) return res.status(400).json({ message: "Invalid page" });
      res.json({ ...await readTerminalRecommendationReport(page, config), config });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
