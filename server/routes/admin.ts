import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { db } from "../db";
import { auditChange } from "../services/audit-change";
import { z } from "zod";
import { insertAgentMerchantSchema, insertAgentQuotaSchema, insertAgentSchema, insertConsentAuditLogSchema, insertDataDeleteRequestSchema, insertHealthAlertSchema, insertResidualReportSchema, insertReviewRequestSchema, insertSendingIdentitySchema, ALLOWED_SENDING_DOMAINS, users, contacts, deals, auditLogs } from "@shared/schema";
import { desc, eq, isNull, and, gte, or, like, count, not } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { sendSmtpEmail, getSmtpStatus, isSmtpConfigured } from "../services/smtp-email";
import { getWorkflowRegistryWithStatus } from "../services/ghl-workflows";
import { summarizeChannelSafety } from "../services/contactability";
import { classifyEligibility } from "../services/deal-eligibility";

export function registerAdminRoutes(app: Express) {
  // === ADMIN: SESSION MANAGEMENT ===
  app.get("/api/admin/users/:id/sessions", requireRole('admin'), async (req, res) => {
    try {
      const sessions = await authStorage.getActiveSessionsForUser(String(req.params.id));
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/sessions/:sessionRecordId", requireRole('admin'), async (req, res) => {
    try {
      await authStorage.revokeSessionById(String(req.params.sessionRecordId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/users/:id/sessions", requireRole('admin'), async (req, res) => {
    try {
      await authStorage.invalidateAllUserSessions(String(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ADMIN: USER MANAGEMENT ===
  app.get("/api/admin/users", requireRole('admin'), async (req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        authProvider: users.authProvider,
        emailVerified: users.emailVerified,
        totpEnabled: users.totpEnabled,
        permissions: users.permissions,
        createdAt: users.createdAt,
      }).from(users).orderBy(desc(users.createdAt));
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/mfa-settings", requireRole('admin'), async (req, res) => {
    try {
      const { systemSettings } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const [setting] = await db.select().from(systemSettings).where(eqOp(systemSettings.key, "mfa_required"));
      res.json({ mfaRequired: setting?.value === true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/mfa-settings", requireRole('admin'), async (req, res) => {
    try {
      const { mfaRequired } = req.body;
      if (typeof mfaRequired !== 'boolean') return res.status(400).json({ message: "mfaRequired must be a boolean" });
      const { systemSettings } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      await db.insert(systemSettings).values({ key: "mfa_required", value: mfaRequired }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: mfaRequired, updatedAt: new Date() },
      });
      res.json({ mfaRequired });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === PCI ASSESSMENT CHECKLIST ===
  const PCI_ASSESSMENT_SETTINGS_KEY = "pci_assessment_checklist_state";

  app.get("/api/admin/pci-assessment", isDashboardUser, async (req, res) => {
    try {
      const { systemSettings } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const [setting] = await db.select().from(systemSettings).where(eqOp(systemSettings.key, PCI_ASSESSMENT_SETTINGS_KEY));
      const value = (setting?.value as { checkedRequirementIds?: string[]; updatedAt?: string; updatedBy?: string } | null) ?? null;
      res.json({
        checkedRequirementIds: Array.isArray(value?.checkedRequirementIds) ? value!.checkedRequirementIds : [],
        updatedAt: value?.updatedAt ?? null,
        updatedBy: value?.updatedBy ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/pci-assessment", isDashboardUser, async (req, res) => {
    try {
      const { checkedRequirementIds } = req.body || {};
      if (!Array.isArray(checkedRequirementIds) || !checkedRequirementIds.every((id: unknown) => typeof id === "string")) {
        return res.status(400).json({ message: "checkedRequirementIds must be an array of strings" });
      }
      const { PCI_REQUIREMENT_ID_SET } = await import("@shared/pci-requirements");
      const unknownIds = checkedRequirementIds.filter((id: string) => !PCI_REQUIREMENT_ID_SET.has(id));
      if (unknownIds.length > 0) {
        return res.status(400).json({ message: `Unknown PCI requirement id(s): ${unknownIds.join(", ")}` });
      }
      const { systemSettings } = await import("@shared/schema");
      const dedupedIds = Array.from(new Set(checkedRequirementIds));
      const value = {
        checkedRequirementIds: dedupedIds,
        updatedAt: new Date().toISOString(),
        updatedBy: (req.user as any)?.id ?? null,
      };
      await db.insert(systemSettings).values({ key: PCI_ASSESSMENT_SETTINGS_KEY, value }).onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
      res.json(value);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/users/:id/reset-2fa", requireRole('admin'), async (req, res) => {
    try {
      const { authStorage } = await import("../replit_integrations/auth/storage");
      const userId = String(req.params.id);
      const [before] = await db.select().from(users).where(eq(users.id, userId));
      await authStorage.adminResetTotp(userId);
      const [updated] = await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, userId)).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      auditChange({ actorType: "user", userId: (req.user as any)?.id ?? null, action: "user_2fa_admin_reset",
        entityType: "user", entityKey: userId,
        before: before ? { totpEnabled: before.totpEnabled } : null,
        after: { totpEnabled: false, totpSecret: null } });
      const { passwordHash, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/users/:id/role", requireRole('admin'), async (req, res) => {
    try {
      const { role } = req.body;
      if (!['admin', 'manager', 'agent', 'merchant'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const [existing] = await db.select().from(users).where(eq(users.id, String(req.params.id)));
      const [updated] = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      auditChange({
        action: "user_role_changed",
        entityType: "user",
        entityId: null,
        entityKey: updated.id,
        before: existing ? { userId: existing.id, role: existing.role } : null,
        after: { userId: updated.id, role: updated.role },
        userId: (req.user as any)?.id ?? null,
        actorType: "user",
      }).catch(() => {});
      // Invalidate all existing sessions immediately — the user must re-login to get the new role
      authStorage.invalidateAllUserSessions(updated.id).catch((err) =>
        console.error("[Admin] Failed to invalidate sessions after role change:", err)
      );
      const { passwordHash, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENTS ===
  app.get("/api/agents", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agentsList = await storage.getAgents();
      res.json(agentsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.hireDate && typeof body.hireDate === 'string') { body.hireDate = new Date(body.hireDate); }
      const input = insertAgentSchema.parse(body);
      const agent = await storage.createAgent(input);
      res.status(201).json(agent);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/agents/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.hireDate && typeof body.hireDate === 'string') { body.hireDate = new Date(body.hireDate); }
      const updated = await storage.updateAgent(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/agents/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      await storage.updateAgent(Number(req.params.id), { status: "inactive" });
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENT QUOTAS ===
  app.get("/api/agent-quotas", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const quotas = await storage.getAgentQuotas();
      res.json(quotas);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-quotas", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const input = insertAgentQuotaSchema.parse(req.body);
      const quota = await storage.createAgentQuota(input);
      res.status(201).json(quota);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/agent-quotas/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const updated = await storage.updateAgentQuota(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENT MERCHANTS (admin/manager only) ===
  app.get("/api/agent-merchants", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agentId = req.query.agentId ? Number(req.query.agentId) : undefined;
      const rows = await storage.getAgentMerchants(agentId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agent-merchants/deal/:dealId", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const rows = await storage.getAgentMerchantsByDeal(Number(req.params.dealId));
      res.json(rows[0] ?? null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/agent-merchants/deal/:dealId/assign", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const { agentId } = req.body;

      const existing = await storage.getAgentMerchantsByDeal(dealId);
      for (const row of existing) {
        await storage.unassignMerchantFromAgent(row.id);
      }

      if (!agentId) {
        return res.json({ success: true, assignment: null });
      }

      const agent = await storage.getAgent(Number(agentId));
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      let merchantName: string | undefined;
      if (deal.contactId) {
        const contact = await storage.getContact(deal.contactId);
        if (contact) {
          merchantName = contact.companyName || `${contact.firstName} ${contact.lastName}`.trim() || undefined;
        }
      }

      const row = await storage.assignMerchantToAgent({
        agentId: Number(agentId),
        dealId,
        merchantName,
        mid: deal.mid || undefined,
      });
      res.json({ success: true, assignment: row });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-merchants", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const input = insertAgentMerchantSchema.parse(req.body);
      const existingAssignments = await storage.getAgentMerchantsByDeal(input.dealId);
      if (existingAssignments.length > 0) {
        return res.status(409).json({ message: "Merchant is already assigned to an agent. Unassign it first." });
      }
      const row = await storage.assignMerchantToAgent(input);
      res.status(201).json(row);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/agent-merchants/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const { mid, merchantName } = req.body || {};
      const updates: Record<string, unknown> = {};
      if (mid !== undefined) updates.mid = mid === "" ? null : mid;
      if (merchantName !== undefined) updates.merchantName = merchantName === "" ? null : merchantName;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No editable fields supplied" });
      const updated = await storage.updateAgentMerchant(Number(req.params.id), updates as any);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/agent-merchants/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      await storage.unassignMerchantFromAgent(Number(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === RESIDUAL CALCULATOR (admin only) ===
  app.post("/api/agents/residual-calculator", requireRole('admin'), async (req, res) => {
    try {
      const { agentId, totalResidual, month } = req.body;
      if (!agentId || totalResidual === undefined) {
        return res.status(400).json({ message: "agentId and totalResidual are required" });
      }
      const agent = await storage.getAgent(Number(agentId));
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const total = parseFloat(String(totalResidual));
      const splitPct = (agent.commissionSplitPercent ?? 50) / 100;

      const assignedMerchants = await storage.getAgentMerchants(Number(agentId));

      let breakdown: Array<{ id: number; dealId: number; merchantName: string; share: number; repShare: number; ownerShare: number; source: string }> = [];

      if (month) {
        const monthResiduals = await storage.getMerchantResidualsByMonth(month);
        const assignedDealIds = new Set(assignedMerchants.map(m => m.dealId));
        const actualResiduals = monthResiduals.filter(r => r.dealId && assignedDealIds.has(r.dealId));

        if (actualResiduals.length > 0) {
          const actualTotal = actualResiduals.reduce((s, r) => s + parseFloat(r.netRevenue || "0"), 0);
          const scaleFactor = actualTotal > 0 ? total / actualTotal : 1;
          breakdown = actualResiduals.map(r => {
            const share = parseFloat(r.netRevenue || "0") * scaleFactor;
            return {
              id: r.id,
              dealId: r.dealId!,
              merchantName: r.merchantName || `Merchant #${r.dealId}`,
              share,
              repShare: share * splitPct,
              ownerShare: share * (1 - splitPct),
              source: "actual",
            };
          });
        }
      }

      if (breakdown.length === 0) {
        const perMerchantShare = assignedMerchants.length > 0 ? total / assignedMerchants.length : 0;
        breakdown = assignedMerchants.map(m => ({
          id: m.id,
          dealId: m.dealId,
          merchantName: m.merchantName || `Merchant #${m.dealId}`,
          share: perMerchantShare,
          repShare: perMerchantShare * splitPct,
          ownerShare: perMerchantShare * (1 - splitPct),
          source: "estimated",
        }));
      }

      const repPayout = breakdown.reduce((s, b) => s + b.repShare, 0) || total * splitPct;
      const ownerOverride = total - repPayout;

      res.json({
        agentId: agent.id,
        agentName: `${agent.firstName} ${agent.lastName}`,
        splitPercent: agent.commissionSplitPercent ?? 50,
        totalResidual: total,
        repPayout,
        ownerOverride,
        month: month || null,
        breakdown,
        breakdownSource: breakdown.length > 0 ? breakdown[0].source : "estimated",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === RESIDUAL REPORTS ===
  app.get("/api/residual-reports", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const reports = await storage.getResidualReports();
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/residual-reports", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const input = insertResidualReportSchema.parse(req.body);
      const report = await storage.createResidualReport(input, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.status(201).json(report);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/residual-reports/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const report = await storage.getResidualReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Not found" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-residuals", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const month = req.query.month as string | undefined;
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const agentId = req.query.agentId ? Number(req.query.agentId) : undefined;
      if (dealId) {
        const residuals = await storage.getMerchantResidualsByDeal(dealId);
        res.json(residuals);
      } else if (agentId && month) {
        const residuals = await storage.getMerchantResidualsByMonth(month);
        res.json(residuals.filter(r => r.agentId === agentId));
      } else if (agentId) {
        const residuals = await storage.getMerchantResiduals();
        res.json(residuals.filter(r => r.agentId === agentId));
      } else if (month) {
        const residuals = await storage.getMerchantResidualsByMonth(month);
        res.json(residuals);
      } else {
        const residuals = await storage.getMerchantResiduals();
        res.json(residuals);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === HEALTH ALERTS ===
  app.get("/api/health-alerts", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const alerts = await storage.getActiveHealthAlerts();
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/health-alerts/deal/:dealId", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const alerts = await storage.getHealthAlertsByDeal(Number(req.params.dealId));
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/health-alerts", isAuthenticated, async (req, res) => {
    try {
      const input = insertHealthAlertSchema.parse(req.body);
      const alert = await storage.createHealthAlert(input);
      res.status(201).json(alert);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/health-alerts/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateHealthAlert(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === CONSENT AUDIT LOGS ===
  app.get("/api/consent-audit", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const logs = await storage.getConsentAuditLogs();
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/consent-audit/contact/:contactId", isAuthenticated, async (req, res) => {
    try {
      const logs = await storage.getConsentAuditLogsByContact(Number(req.params.contactId));
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/consent-audit", isAuthenticated, async (req, res) => {
    try {
      const input = insertConsentAuditLogSchema.parse(req.body);
      const log = await storage.createConsentAuditLog(input);
      res.status(201).json(log);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });


  // === DATA DELETE REQUESTS ===
  app.post("/api/data-requests", publicLeadRateLimit, async (req, res) => {
    try {
      const input = insertDataDeleteRequestSchema.parse(req.body);
      const request = await storage.createDataDeleteRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/data-requests", requireRole('admin'), async (req, res) => {
    try {
      const requests = await storage.getDataDeleteRequests();
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/data-requests/:id", requireRole('admin'), async (req, res) => {
    try {
      const updated = await storage.updateDataDeleteRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === REVIEW REQUESTS ===
  app.get("/api/review-requests", isAuthenticated, async (req, res) => {
    try {
      const requests = await storage.getReviewRequests();
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/review-requests/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const requests = await storage.getReviewRequestsByDeal(Number(req.params.dealId));
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/review-requests", isAuthenticated, async (req, res) => {
    try {
      const input = insertReviewRequestSchema.parse(req.body);
      const request = await storage.createReviewRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/review-requests/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReviewRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === TESTIMONIAL SUBMISSIONS (staff review inbox) ===
  app.get("/api/testimonial-submissions", isAuthenticated, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const submissions = await storage.getTestimonialSubmissions(status);
      res.json(submissions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/testimonial-submissions/:id", isAuthenticated, async (req, res) => {
    try {
      const submission = await storage.getTestimonialSubmission(Number(req.params.id));
      if (!submission) return res.status(404).json({ message: "Not found" });
      res.json(submission);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/testimonial-submissions/:id", isAuthenticated, async (req, res) => {
    try {
      const allowed = ["status", "publish", "reviewNotes", "reviewedBy"] as const;
      const updates: Record<string, any> = {};
      for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
      if (updates.status && !["pending", "approved", "rejected"].includes(updates.status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const user: any = req.user;
      if (updates.status && updates.status !== "pending" && !updates.reviewedBy) {
        updates.reviewedBy = user?.email || user?.id || "staff";
      }
      const updated = await storage.updateTestimonialSubmission(Number(req.params.id), updates);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/processor-adapters", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getAllAdapterStatuses } = await import("../services/processors/registry");
      const statuses = getAllAdapterStatuses();
      res.json({ adapters: statuses });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/processor-adapters/ping", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { pingAllAdapters, getAllAdapterStatuses } = await import("../services/processors/registry");
      const pingResults = await pingAllAdapters();
      const statuses = getAllAdapterStatuses();
      res.json({ ping: pingResults, adapters: statuses });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GHL CONTACT ID BACKFILL ===
  app.post("/api/admin/backfill-ghl-contacts", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { isGhlConfigured, lookupGhlContactByEmail } = await import("../services/ghl");
      if (!isGhlConfigured()) {
        return res.status(503).json({ message: "GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID." });
      }

      const rows = await db
        .select()
        .from(contacts)
        .where(isNull(contacts.ghlContactId));

      const results = { matched: 0, notFound: 0, errors: 0, total: rows.length };
      const log: Array<{ id: number; email: string; status: string; ghlId?: string; error?: string }> = [];

      for (const contact of rows) {
        if (!contact.email) { results.errors++; log.push({ id: contact.id, email: "", status: "skipped_no_email" }); continue; }
        try {
          const ghlId = await lookupGhlContactByEmail(contact.email);
          if (ghlId) {
            await db.update(contacts).set({ ghlContactId: ghlId }).where(eq(contacts.id, contact.id));
            results.matched++;
            log.push({ id: contact.id, email: contact.email, status: "matched", ghlId });
          } else {
            results.notFound++;
            log.push({ id: contact.id, email: contact.email, status: "not_found" });
          }
        } catch (err: any) {
          results.errors++;
          log.push({ id: contact.id, email: contact.email, status: "error", error: err.message });
        }
        await new Promise(r => setTimeout(r, 120));
      }

      res.json({ results, log });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/backfill-ghl-contacts/status", requireRole("admin", "manager"), async (req, res) => {
    try {
      const allCount = await db.select({ id: contacts.id }).from(contacts);
      const nullCount = await db.select({ id: contacts.id }).from(contacts).where(isNull(contacts.ghlContactId));
      res.json({ totalContacts: allCount.length, missingGhlId: nullCount.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GHL HEALTH CHECK (cached 30s) ===
  let _ghlHealthCache: { data: any; at: number } | null = null;
  const GHL_HEALTH_TTL_MS = 30_000;

  app.get("/api/admin/ghl-health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const now = Date.now();
      if (_ghlHealthCache && now - _ghlHealthCache.at < GHL_HEALTH_TTL_MS) {
        return res.json({ ..._ghlHealthCache.data, cached: true });
      }
      const { checkGhlHealth } = await import("../services/ghl");
      const result = await checkGhlHealth();
      const ghlStatus = result.connected ? "ok" : (
        result.error?.toLowerCase().includes("not configured") ? "unconfigured" : "expired"
      );

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [failureCountRow] = await db
        .select({ total: count() })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.entityType, "ghl_sync"),
          or(like(auditLogs.action, "%fail%"), like(auditLogs.action, "%error%")),
          gte(auditLogs.createdAt, since24h)
        ));

      const [lastSuccessRow] = await db
        .select({ createdAt: auditLogs.createdAt })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.entityType, "ghl_sync"),
          not(like(auditLogs.action, "%fail%")),
          not(like(auditLogs.action, "%error%"))
        ))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);

      const payload = {
        ...result,
        status: ghlStatus,
        failureCount: failureCountRow?.total ?? 0,
        lastSync: lastSuccessRow?.createdAt?.toISOString() ?? null,
        checkedAt: new Date().toISOString(),
        cached: false,
      };
      _ghlHealthCache = { data: payload, at: now };
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GHL SYNC RETRY ===
  app.post("/api/admin/ghl-sync/retry", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ message: "contactId is required" });

      const { isGhlConfigured, upsertGhlContact } = await import("../services/ghl");
      if (!isGhlConfigured()) {
        return res.status(503).json({ message: "GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID." });
      }
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, Number(contactId)));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const result = await upsertGhlContact(contact);
      await auditChange({ entityType: "ghl_sync", entityId: contact.id, entityKey: contact.email || String(contact.id), action: "ghl_sync_retry_success", details: { ghlContactId: result } });
      res.json({ success: true, ghlContactId: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // === GHL WORKFLOW ID TEST ===
  app.post("/api/admin/ghl-workflows/:workflowId/test", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { workflowId } = req.params;
      if (!workflowId || workflowId.length < 8) {
        return res.status(400).json({ valid: false, error: "Invalid workflow ID format" });
      }
      const { isGhlConfigured } = await import("../services/ghl");
      if (!isGhlConfigured()) {
        return res.status(503).json({ valid: false, error: "GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID." });
      }
      const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      const base = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
      const url = `${base}/workflows/${workflowId}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
          ...(locationId ? { "location-id": locationId } : {}),
        },
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const wf = (data as any)?.workflow ?? data;
        const name = wf?.name || workflowId;
        const isActive = wf?.status === "published" || wf?.isActive === true || wf?.status === "active";
        if (!isActive && wf?.status !== undefined) {
          return res.json({ valid: true, active: false, name, warning: `Workflow exists but is not active (status: ${wf.status}). Contacts may not be enrolled.` });
        }
        return res.json({ valid: true, active: isActive !== false, name });
      } else if (resp.status === 404) {
        return res.json({ valid: false, error: "Workflow not found in GHL. Check the ID." });
      } else if (resp.status === 401 || resp.status === 403) {
        return res.json({ valid: false, error: "GHL token rejected. Re-authenticate in GHL Settings → Private Integrations." });
      } else {
        return res.json({ valid: false, error: `GHL returned HTTP ${resp.status}` });
      }
    } catch (err: any) {
      res.status(500).json({ valid: false, error: err.message });
    }
  });

  // === SYSTEM READINESS ===
  app.get("/api/admin/system-readiness", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isGhlConfigured } = await import("../services/ghl");
      const { isSmtpConfigured, getSmtpStatus } = await import("../services/smtp-email");
      const { GHL_WORKFLOW_REGISTRY } = await import("../services/ghl-workflows");
      const { featureFlags } = await import("../services/feature-flags");

      // GHL status
      let ghlStatus: "ok" | "expired" | "unconfigured" = "unconfigured";
      let ghlLocationName: string | undefined;
      const ghlConfigured = isGhlConfigured();
      if (ghlConfigured) {
        try {
          const { checkGhlHealth } = await import("../services/ghl");
          const test = await checkGhlHealth();
          ghlStatus = test.connected ? "ok" : "expired";
          ghlLocationName = test.locationName;
        } catch { ghlStatus = "expired"; }
      }

      // GHL workflow IDs
      const configuredWorkflows = GHL_WORKFLOW_REGISTRY.filter(
        w => !!(process.env[w.envKey])
      );
      const dbWorkflows: string[] = [];
      for (const w of GHL_WORKFLOW_REGISTRY) {
        if (!process.env[w.envKey]) {
          try {
            const saved = await storage.getSystemSetting(`ghl_workflow_env_${w.envKey}`);
            if (saved) dbWorkflows.push(w.envKey);
          } catch { /* ignore */ }
        }
      }
      const workflowIdsConfigured = configuredWorkflows.length + dbWorkflows.length;

      // SMTP
      const smtpStatus = getSmtpStatus();
      const smtpConfigured = isSmtpConfigured();

      // OpenAI
      const openaiConfigured = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

      // Redis
      const redisUrl = process.env.REDIS_URL;
      const redisReal = !!(redisUrl && redisUrl !== "");

      // Sending identities
      let sendingIdentityCount = 0;
      try {
        const identities = await storage.getSendingIdentities();
        sendingIdentityCount = identities.filter(i => i.status === "active").length;
      } catch { /* ignore */ }

      // Feature flags
      const flags = {
        sdrEnabled: featureFlags.SDR_ENABLED,
        orchestratorEnabled: featureFlags.ORCHESTRATOR_ENABLED,
        legacyOutreachEnabled: featureFlags.LEGACY_OUTREACH_ENABLED,
        voiceAiEnabled: featureFlags.VOICE_AI_ENABLED,
        smsEnabled: featureFlags.SMS_ENABLED,
        nightlyDiscoveryEnabled: featureFlags.NIGHTLY_DISCOVERY_ENABLED,
      };

      // Key env vars presence
      const envChecks = {
        ghlToken: !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN),
        ghlLocationId: !!(process.env.GHL_LOCATION_ID),
        adminEmail: !!(process.env.ADMIN_DIGEST_EMAIL),
        serperApiKey: !!(process.env.SERPER_API_KEY),
        apolloApiKey: !!(process.env.APOLLO_API_KEY),
        apifyToken: !!(process.env.APIFY_API_TOKEN),
        outscraperKey: !!(process.env.OUTSCRAPER_API_KEY),
        appUrl: !!(process.env.APP_URL),
        nmiKey: !!(process.env.NMI_SECURITY_KEY),
        ghlWebhookSecret: !!(process.env.GHL_WEBHOOK_SECRET),
        smtpPass: !!(process.env.SMTP_PASS),
        smtpHost: !!(process.env.SMTP_HOST),
        smtpUser: !!(process.env.SMTP_USER),
        ghlDefaultWorkflow: !!(process.env.GHL_DEFAULT_WORKFLOW_ID),
        ghlBookingLink: !!(process.env.GHL_DEFAULT_BOOKING_LINK),
      };

      // Build action items
      const actions: string[] = [];
      if (!smtpConfigured) {
        if (!envChecks.smtpHost) actions.push("Set SMTP_HOST to enable email delivery fallback");
        else if (!envChecks.smtpPass) actions.push("Set SMTP_PASS — SMTP_HOST/USER are set but auth is missing, all transactional emails are silently failing");
      }
      if (ghlStatus === "unconfigured") {
        actions.push("Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID to enable GHL sync, comms, and workflows");
      } else if (ghlStatus === "expired") {
        actions.push("GHL token is expired — regenerate in GHL Settings → Private Integrations and update GHL_PRIVATE_INTEGRATION_TOKEN");
      }
      if (workflowIdsConfigured < GHL_WORKFLOW_REGISTRY.length) {
        actions.push(`Configure ${GHL_WORKFLOW_REGISTRY.length - workflowIdsConfigured} GHL Workflow IDs in GHL Workflow ID Manager — all automation is silently failing without them`);
      }
      if (!openaiConfigured) {
        actions.push("Set AI_INTEGRATIONS_OPENAI_API_KEY — AI enrichment, intent classification, blueprint/proposal generation will all fail");
      }
      if (sendingIdentityCount < 3) {
        actions.push(`Add more sending identities — only ${sendingIdentityCount} active (recommend 3+ for inbox rotation)`);
      }
      if (!redisReal) {
        actions.push("Set REDIS_URL for production BullMQ job queue — currently using in-memory fallback (jobs lost on restart)");
      }
      if (!envChecks.adminEmail) {
        actions.push("Set ADMIN_DIGEST_EMAIL — daily/weekly digests have no recipient without it");
      }
      if (!envChecks.serperApiKey && flags.legacyOutreachEnabled) {
        actions.push("Set SERPER_API_KEY — required for deep enrichment in Outreach Command Center");
      }
      if (!envChecks.ghlWebhookSecret) {
        actions.push("Set GHL_WEBHOOK_SECRET — webhook signature validation is disabled (security risk)");
      }

      res.json({
        ghl: { status: ghlStatus, configured: ghlConfigured, locationName: ghlLocationName, workflowIdsConfigured, workflowIdsTotal: GHL_WORKFLOW_REGISTRY.length },
        smtp: { configured: smtpConfigured, ...smtpStatus },
        openai: { configured: openaiConfigured },
        redis: { real: redisReal, url: redisReal ? "configured" : "not set (using in-memory mock)" },
        sdr: flags,
        sendingIdentities: { activeCount: sendingIdentityCount },
        env: envChecks,
        actions,
        overallHealthy: actions.length === 0,
        criticalIssues: actions.filter(a => a.toLowerCase().includes("silently failing") || a.toLowerCase().includes("fail") || a.toLowerCase().includes("expired") || a.toLowerCase().includes("security")).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === GHL FAILURES (admin + manager) ===
  app.get("/api/admin/ghl-failures", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const failures = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          entityKey: auditLogs.entityKey,
          details: auditLogs.details,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "ghl_sync"),
            or(like(auditLogs.action, "%fail%"), like(auditLogs.action, "%error%")),
            gte(auditLogs.createdAt, since24h)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);
      res.json({ logs: failures });
    } catch (err: any) {
      res.status(500).json({ logs: [], error: err.message });
    }
  });

  // === EMAIL HEALTH: SMTP STATUS ===
  app.get("/api/admin/email-health/smtp-status", requireRole("admin", "manager"), async (req, res) => {
    try {
      const status = getSmtpStatus();
      res.json({
        configured: isSmtpConfigured(),
        hasHost: !!process.env.SMTP_HOST,
        hasUser: !!process.env.SMTP_USER,
        hasPass: !!process.env.SMTP_PASS,
        host: status.host,
        port: status.port,
        user: status.user,
        from: status.from,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === EMAIL HEALTH: SMTP TEST ===
  app.post("/api/admin/email-health/test-smtp", requireRole("admin", "manager"), async (req, res) => {
    try {
      const adminUser = req.user as any;
      const toEmail = adminUser?.email;
      if (!toEmail) {
        return res.status(400).json({ success: false, error: "No email address on your account" });
      }
      const result = await sendSmtpEmail({
        to: toEmail,
        subject: "Liberty Bancard — SMTP Test",
        html: `<p>This is a test email sent from the Liberty Bancard Email Health admin panel at ${new Date().toLocaleString()}.</p><p>If you received this, SMTP is configured correctly.</p>`,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // === EMAIL HEALTH: GHL WORKFLOW STATUS ===
  app.get("/api/admin/email-health/ghl-status", requireRole("admin", "manager"), async (req, res) => {
    try {
      const workflows = await getWorkflowRegistryWithStatus();
      const configuredCount = workflows.filter(w => w.isSet).length;
      res.json({ workflows, total: workflows.length, configuredCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === EMAIL HEALTH: SENDING IDENTITIES CRUD ===
  app.get("/api/admin/sending-identities", requireRole("admin", "manager"), async (req, res) => {
    try {
      const identities = await storage.getSendingIdentities();
      res.json(identities);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  function validateSendingDomain(emailAddress: string | undefined): string | null {
    if (!emailAddress) return null;
    const atIdx = emailAddress.lastIndexOf("@");
    if (atIdx === -1) return "Email address must contain @";
    const domain = emailAddress.slice(atIdx + 1).toLowerCase();
    if (!(ALLOWED_SENDING_DOMAINS as readonly string[]).includes(domain)) {
      return `Domain "${domain}" is not allowed. Permitted domains: ${ALLOWED_SENDING_DOMAINS.join(", ")}`;
    }
    return null;
  }

  app.post("/api/admin/sending-identities", requireRole("admin", "manager"), async (req, res) => {
    try {
      const parsed = insertSendingIdentitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }
      const domainError = validateSendingDomain(parsed.data.emailAddress);
      if (domainError) return res.status(400).json({ message: domainError });
      const identity = await storage.createSendingIdentity(parsed.data);
      res.status(201).json(identity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/sending-identities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const parsed = insertSendingIdentitySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }
      if (parsed.data.emailAddress) {
        const domainError = validateSendingDomain(parsed.data.emailAddress);
        if (domainError) return res.status(400).json({ message: domainError });
      }
      const identity = await storage.updateSendingIdentity(id, parsed.data);
      if (!identity) return res.status(404).json({ message: "Identity not found" });
      res.json(identity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/sending-identities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const deleted = await storage.deleteSendingIdentity(id);
      if (!deleted) return res.status(404).json({ message: "Identity not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/channel-safety-summary", requireRole("admin", "manager"), async (req, res) => {
    try {
      const summary = await summarizeChannelSafety();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Build the set of businessIds that already have at least one active deal — refresh each batch
  async function getBusinessIdsWithDeals(): Promise<Set<number>> {
    const rows = await db
      .select({ businessId: contacts.businessId })
      .from(deals)
      .innerJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(isNull(deals.archivedAt), not(isNull(contacts.businessId))));
    const s = new Set<number>();
    for (const r of rows) { if (r.businessId) s.add(r.businessId); }
    return s;
  }

  // === DEAL BACKFILL: PREVIEW ===
  // Cursor-paginated full eligibility scan — deterministic, no extrapolation.
  // Optional `limit` in request body caps how many orphan contacts are scanned.
  app.post("/api/admin/contacts/backfill-deals/preview", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { source, vertical, minScore = 45, limit } = req.body || {};
      // Enforce warm/hot-only semantic: floor at 45 so cold contacts are never previewed
      const parsedScore = Math.max(45, Math.min(100, Number(minScore) || 45));
      // Honor caller-supplied limit; undefined = scan all
      const scanCap = limit ? Math.min(Math.max(Number(limit), 1), 100_000) : undefined;

      // Accurate total count via COUNT(*) — always reflects the full population
      const totalOrphanContacts = await storage.getOrphanContactCount({
        source: source || undefined,
        vertical: vertical || undefined,
        minScore: parsedScore,
      });

      // Full cursor-based eligibility scan — no sampling, no extrapolation
      const businessIdsWithDeals = await getBusinessIdsWithDeals();
      const skippedBreakdown = { cold: 0, existingDeal: 0, missingIdentity: 0, duplicateBusiness: 0, placeholderEmailOnly: 0, suppressedOrDnc: 0, anonymous: 0 };
      let wouldCreate = 0;
      const sampleDisplay: Awaited<ReturnType<typeof storage.getOrphanContactCandidates>> = [];
      let lastId: number | null = null;
      let scanned = 0;
      const previewBatch = 500;

      while (true) {
        const remaining = scanCap !== undefined ? scanCap - scanned : previewBatch;
        if (remaining <= 0) break;
        const batch = await storage.getOrphanContactCandidates({
          source: source || undefined,
          vertical: vertical || undefined,
          minScore: parsedScore,
          afterId: lastId ?? undefined,
          limit: Math.min(previewBatch, remaining),
        });
        if (batch.length === 0) break;
        for (const c of batch) {
          const verdict = classifyEligibility(c, businessIdsWithDeals, parsedScore);
          if (verdict === "eligible") {
            wouldCreate++;
            if (sampleDisplay.length < 5) sampleDisplay.push(c);
            // Mirror apply behavior: once a contact from a business is deemed eligible,
            // subsequent contacts sharing that businessId must be skipped (duplicate-business gate)
            if (c.businessId) businessIdsWithDeals.add(c.businessId);
          } else if (verdict === "cold") skippedBreakdown.cold++;
          else if (verdict === "anonymous") skippedBreakdown.anonymous++;
          else if (verdict === "placeholder_email") skippedBreakdown.placeholderEmailOnly++;
          else if (verdict === "suppressed_dnc") skippedBreakdown.suppressedOrDnc++;
          else if (verdict === "missing_identity") skippedBreakdown.missingIdentity++;
          else if (verdict === "duplicate_business") skippedBreakdown.duplicateBusiness++;
          lastId = c.id;
          scanned++;
        }
      }

      await storage.createAuditLog({
        action: "contacts_deal_backfill_previewed",
        entityType: "system",
        details: { totalOrphanContacts, scanned, wouldCreateDeals: wouldCreate, skippedBreakdown, minScore: parsedScore, source, vertical },
        userId: (req.user as any)?.id ?? null,
      });

      res.json({
        totalOrphanContacts,
        scanned,
        wouldCreateDeals: wouldCreate,
        skippedCold: skippedBreakdown.cold,
        skippedExistingDeal: skippedBreakdown.existingDeal,
        skippedMissingIdentity: skippedBreakdown.missingIdentity,
        skippedDuplicateBusiness: skippedBreakdown.duplicateBusiness,
        skippedPlaceholderEmailOnly: skippedBreakdown.placeholderEmailOnly,
        skippedSuppressedOrDnc: skippedBreakdown.suppressedOrDnc,
        skippedAnonymous: skippedBreakdown.anonymous,
        sampleCandidates: sampleDisplay,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === DEAL BACKFILL: START (async, cursor-paginated, resumable) ===
  // Uses afterId cursor so it never loads more than batchSize rows at a time —
  // safe for populations of 153k+ contacts. Progress is written after every batch.
  async function runBackfillAsync(opts: { minScore: number; batchSize: number; source?: string; vertical?: string; adminUserId: string | null; startedAt: string; initialTotal: number }) {
    const { minScore, batchSize, source, vertical, adminUserId, startedAt, initialTotal } = opts;

    let processed = 0;
    let dealsCreated = 0;
    let skipped = 0;
    const skippedBreakdown = { cold: 0, existingDeal: 0, missingIdentity: 0, duplicateBusiness: 0, placeholderEmailOnly: 0, suppressedOrDnc: 0, anonymous: 0 };
    let lastProcessedContactId: number | null = null;

    // Restore cursor from prior run (resumable)
    const savedProgress = await storage.getBackfillProgress() as any;
    if (savedProgress?.lastProcessedContactId && savedProgress?.status === "running") {
      processed = savedProgress.processed ?? 0;
      dealsCreated = savedProgress.dealsCreated ?? 0;
      skipped = savedProgress.skipped ?? 0;
      lastProcessedContactId = savedProgress.lastProcessedContactId ?? null;
      if (savedProgress.skippedBreakdown) Object.assign(skippedBreakdown, savedProgress.skippedBreakdown);
    }

    try {
      // Cursor loop — fetches batchSize rows at a time, no global pre-fetch
      while (true) {
        // Check cancel before every batch
        const currentProg = await storage.getBackfillProgress() as any;
        if (currentProg?.cancelRequested) {
          await storage.setBackfillProgress({
            status: "cancelled",
            processed, total: initialTotal, dealsCreated, skipped, skippedBreakdown,
            lastProcessedContactId,
            startedAt, updatedAt: new Date().toISOString(), completedAt: null,
            cancelRequested: true, error: null,
          });
          await storage.createAuditLog({ action: "contacts_deal_backfill_cancelled", entityType: "system", userId: adminUserId, details: { processed, dealsCreated, skipped } });
          return;
        }

        const batch = await storage.getOrphanContactCandidates({
          source, vertical, minScore,
          afterId: lastProcessedContactId ?? undefined,
          limit: batchSize,
        });

        if (batch.length === 0) break; // cursor exhausted — done

        // Refresh businessIds-with-deals once per batch to stay current
        const businessIdsWithDeals = await getBusinessIdsWithDeals();

        for (const c of batch) {
          const verdict = classifyEligibility(c, businessIdsWithDeals, minScore);
          if (verdict === "eligible") {
            try {
              await storage.createDeal({
                contactId: c.id,
                pipeline: "sales",
                stage: "New Lead",
                leadSource: c.leadSource || "backfill",
                notes: `Auto-created by deal backfill. Contact: ${c.firstName} ${c.lastName}${c.companyName ? ` (${c.companyName})` : ""}. Score: ${c.leadScore}.`,
              }, { actorType: "system", userId: adminUserId });
              dealsCreated++;
              businessIdsWithDeals.add(c.businessId!); // prevent duplicates within the same batch
            } catch (err) {
              console.error(`[DealBackfill] Deal creation failed for contact ${c.id}:`, err);
              skipped++;
              skippedBreakdown.existingDeal++;
            }
          } else {
            skipped++;
            if (verdict === "cold") skippedBreakdown.cold++;
            else if (verdict === "anonymous") skippedBreakdown.anonymous++;
            else if (verdict === "placeholder_email") skippedBreakdown.placeholderEmailOnly++;
            else if (verdict === "suppressed_dnc") skippedBreakdown.suppressedOrDnc++;
            else if (verdict === "missing_identity") skippedBreakdown.missingIdentity++;
            else if (verdict === "duplicate_business") skippedBreakdown.duplicateBusiness++;
          }
          processed++;
          lastProcessedContactId = c.id;
        }

        // Persist after every batch — re-read to preserve any cancel that arrived
        // during this batch (never unconditionally reset cancelRequested to false)
        const midProg = await storage.getBackfillProgress() as any;
        await storage.setBackfillProgress({
          status: "running",
          processed, total: initialTotal, dealsCreated, skipped, skippedBreakdown,
          lastProcessedContactId,
          startedAt, updatedAt: new Date().toISOString(), completedAt: null,
          cancelRequested: midProg?.cancelRequested ?? false, error: null,
        });

        await storage.createAuditLog({ action: "contacts_deal_backfill_batch_completed", entityType: "system", userId: adminUserId,
          details: { lastContactId: lastProcessedContactId, processed, dealsCreated, skipped } });

        await new Promise(r => setTimeout(r, 50)); // yield to event loop
      }

      await storage.setBackfillProgress({
        status: "completed",
        processed, total: initialTotal, dealsCreated, skipped, skippedBreakdown,
        lastProcessedContactId,
        startedAt, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        cancelRequested: false, error: null,
      });
      await storage.createAuditLog({ action: "contacts_deal_backfill_completed", entityType: "system", userId: adminUserId,
        details: { processed, dealsCreated, skipped, skippedBreakdown } });
    } catch (err: any) {
      console.error("[DealBackfill] Fatal error:", err);
      const prev = await storage.getBackfillProgress() as any;
      await storage.setBackfillProgress({
        ...(prev ?? {}),
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: err.message,
      });
      await storage.createAuditLog({ action: "contacts_deal_backfill_failed", entityType: "system", userId: opts.adminUserId, details: { error: err.message } });
    }
  }

  app.post("/api/admin/contacts/backfill-deals", requireRole("admin", "manager"), async (req, res) => {
    try {
      // Only accept the known safe fields; any caller-supplied count fields are intentionally ignored
      // to prevent a caller from spoofing a low count and bypassing the confirmation safeguard.
      const { confirmed, confirmationText, minScore = 45, batchSize = 200, source, vertical } = req.body || {};

      if (!confirmed) return res.status(400).json({ message: "confirmed: true is required" });

      // Enforce warm/hot-only semantic: floor at 45 so cold contacts never receive deals
      const clampedMinScore = Math.max(45, Math.min(100, Number(minScore) || 45));

      // Server-computed orphan count — conservative upper bound (actual eligible subset is smaller
      // after identity/DNC/placeholder/duplicate-business gates). Never trust caller-supplied counts.
      const orphanCount = await storage.getOrphanContactCount({
        source: source || undefined,
        vertical: vertical || undefined,
        minScore: clampedMinScore,
      });

      // Confirmation safeguard: typed phrase required when the orphan population is >= 100.
      // Using the server-side orphan count (not a client-provided value) prevents bypass.
      if (orphanCount >= 100 && confirmationText !== "CREATE DEALS") {
        return res.status(400).json({
          message: `${orphanCount} orphan contacts found (eligible subset will be smaller). Send confirmationText: "CREATE DEALS" to proceed.`,
          orphanCount,
        });
      }

      // Check if already running — allow override if run is stale (stuck > 1 hour without progress)
      const existing = await storage.getBackfillProgress() as any;
      const isRunning = existing?.status === "running";
      if (isRunning) {
        const updatedMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const stale = Date.now() - updatedMs > 60 * 60 * 1000; // 1 hour
        if (!stale) {
          return res.status(409).json({ message: "A backfill is already running. Check /status or cancel first." });
        }
        // Stale run — fall through and resume from persisted cursor
      }

      const adminUserId = (req.user as any)?.id ?? null;

      if (isRunning) {
        // Stale restart: preserve cursor — only reset the heartbeat timestamp so the run no
        // longer appears stale. runBackfillAsync will read the saved cursor and resume.
        await storage.setBackfillProgress({
          ...existing,
          status: "running",
          cancelRequested: false,
          updatedAt: new Date().toISOString(),
          error: null,
        });
      } else {
        // Fresh start: reset cursor and counters
        const startedAt = new Date().toISOString();
        await storage.setBackfillProgress({
          status: "running",
          processed: 0, total: orphanCount, dealsCreated: 0, skipped: 0,
          skippedBreakdown: { cold: 0, existingDeal: 0, missingIdentity: 0, duplicateBusiness: 0, placeholderEmailOnly: 0, suppressedOrDnc: 0, anonymous: 0 },
          lastProcessedContactId: null,
          startedAt,
          updatedAt: startedAt,
          completedAt: null,
          cancelRequested: false,
          error: null,
        });
      }

      const finalProgress = await storage.getBackfillProgress() as any;
      const startedAt = finalProgress?.startedAt ?? new Date().toISOString();
      const initialTotal = finalProgress?.total ?? orphanCount;

      await storage.createAuditLog({ action: "contacts_deal_backfill_started", entityType: "system", userId: adminUserId,
        details: { totalCandidates: initialTotal, minScore: clampedMinScore, batchSize, source, vertical, resumed: isRunning } });

      // Fire and forget — cursor-paginated async runner, never loads full population
      setImmediate(() => {
        runBackfillAsync({
          minScore: clampedMinScore,
          batchSize: Math.min(Math.max(Number(batchSize) || 200, 100), 500),
          source: source || undefined,
          vertical: vertical || undefined,
          adminUserId,
          startedAt,
          initialTotal,
        }).catch(err => console.error("[DealBackfill] Async runner error:", err));
      });

      res.status(202).json({ message: isRunning ? "Backfill resumed" : "Backfill started", totalCandidates: initialTotal });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === DEAL BACKFILL: STATUS ===
  app.get("/api/admin/contacts/backfill-deals/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const progress = await storage.getBackfillProgress();
      res.json(progress ?? { status: "idle", processed: 0, total: 0, dealsCreated: 0, skipped: 0, skippedBreakdown: {}, lastProcessedContactId: null, startedAt: null, updatedAt: null, completedAt: null, error: null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === DEAL BACKFILL: CANCEL ===
  app.post("/api/admin/contacts/backfill-deals/cancel", requireRole("admin", "manager"), async (req, res) => {
    try {
      const existing = await storage.getBackfillProgress() as any;
      if (!existing || existing.status !== "running") {
        return res.status(400).json({ message: "No running backfill to cancel" });
      }
      await storage.setBackfillProgress({ ...existing, cancelRequested: true, updatedAt: new Date().toISOString() });
      await storage.createAuditLog({ action: "contacts_deal_backfill_cancelled", entityType: "system", userId: (req.user as any)?.id ?? null,
        details: { cancelledAt: new Date().toISOString() } });
      res.json({ message: "Cancel requested. The running backfill will stop after its current batch." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === autoCreateDealsForWarmContacts system setting ===
  app.get("/api/admin/settings/auto-create-deals-for-warm-contacts", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const val = await storage.getSystemSetting("auto_create_deals_for_warm_contacts");
      res.json({ autoCreateDealsForWarmContacts: val === true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/settings/auto-create-deals-for-warm-contacts", requireRole("admin"), async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") return res.status(400).json({ message: "enabled must be a boolean" });
      await storage.setSystemSetting("auto_create_deals_for_warm_contacts", enabled);
      await storage.createAuditLog({ action: "setting_auto_create_deals_updated", entityType: "system", userId: (req.user as any)?.id ?? null, details: { autoCreateDealsForWarmContacts: enabled } });
      res.json({ autoCreateDealsForWarmContacts: enabled });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CONTACT SCORING JOB ===
  app.post("/api/admin/contacts/score-all/preview", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { previewScoringJob } = await import("../services/contact-scoring-job");
      const result = await previewScoringJob(false);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/contacts/score-all", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { isScoringJobRunning, startScoringJob } = await import("../services/contact-scoring-job");
      const { confirmed, confirmationText, rescore, batchSize } = req.body ?? {};

      if (!confirmed) {
        return res.status(400).json({ message: "confirmed: true is required." });
      }

      if (rescore === true && confirmationText !== "SCORE CONTACTS") {
        return res.status(400).json({ message: "Typed confirmation 'SCORE CONTACTS' required to rescore all contacts." });
      }

      if (isScoringJobRunning()) {
        return res.status(409).json({ message: "A scoring job is already running." });
      }

      await startScoringJob({ rescore: !!rescore, batchSize, adminUserId: (req.user as any)?.id ?? null });
      res.status(202).json({ message: "Scoring job started." });
    } catch (err: any) {
      if (err.message === "A scoring job is already running.") {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/contacts/score-all/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getScoringProgress, isScoringJobRunning } = await import("../services/contact-scoring-job");
      const progress = await getScoringProgress();
      res.json({ ...progress, jobRunning: isScoringJobRunning() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/contacts/score-all/cancel", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isScoringJobRunning, cancelScoringJob } = await import("../services/contact-scoring-job");
      if (!isScoringJobRunning()) {
        return res.status(400).json({ message: "No scoring job is currently running." });
      }
      await cancelScoringJob();
      res.json({ message: "Cancel requested. The job will stop after the current batch." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === BULK ENROLLMENT JOB ===
  app.post("/api/admin/contacts/bulk-enroll/preview", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { previewBulkEnroll } = await import("../services/bulk-enrollment-job");
      const { vertical, minScore, sequenceId, campaignId } = req.body ?? {};
      if (!vertical) return res.status(400).json({ message: "vertical is required." });
      const result = await previewBulkEnroll({
        vertical,
        minScore: Number(minScore) || 70,
        sequenceId: sequenceId ? Number(sequenceId) : undefined,
        campaignId: campaignId ? Number(campaignId) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/contacts/bulk-enroll", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { isBulkEnrollJobRunning, startBulkEnrollJob, previewBulkEnroll } = await import("../services/bulk-enrollment-job");
      const { vertical, minScore, sequenceId, campaignId, confirmed, confirmationText } = req.body ?? {};

      if (!vertical) return res.status(400).json({ message: "vertical is required." });
      if (!confirmed) return res.status(400).json({ message: "confirmed: true is required." });

      if (isBulkEnrollJobRunning()) {
        return res.status(409).json({ message: "A bulk enrollment job is already running." });
      }

      const preview = await previewBulkEnroll({
        vertical,
        minScore: Number(minScore) || 70,
        sequenceId: sequenceId ? Number(sequenceId) : undefined,
        campaignId: campaignId ? Number(campaignId) : undefined,
      });

      if (preview.eligible >= 100 && confirmationText !== "ENROLL") {
        return res.status(400).json({
          message: `Typed confirmation 'ENROLL' required when eligible count is ≥ 100 (found ${preview.eligible}).`,
          eligible: preview.eligible,
          requiresTypedConfirmation: true,
        });
      }

      await startBulkEnrollJob({
        vertical,
        minScore: Number(minScore) || 70,
        sequenceId: sequenceId ? Number(sequenceId) : undefined,
        campaignId: campaignId ? Number(campaignId) : undefined,
      });

      res.status(202).json({ message: "Bulk enrollment job started.", eligible: preview.eligible });
    } catch (err: any) {
      if (err.message === "A bulk enrollment job is already running.") {
        return res.status(409).json({ message: err.message });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/admin/contacts/bulk-enroll/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getBulkEnrollProgress, isBulkEnrollJobRunning } = await import("../services/bulk-enrollment-job");
      const progress = await getBulkEnrollProgress();
      res.json({ ...progress, jobRunning: isBulkEnrollJobRunning() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/contacts/bulk-enroll/cancel", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isBulkEnrollJobRunning, cancelBulkEnrollJob } = await import("../services/bulk-enrollment-job");
      if (!isBulkEnrollJobRunning()) {
        return res.status(400).json({ message: "No bulk enrollment job is currently running." });
      }
      await cancelBulkEnrollJob();
      res.json({ message: "Cancel requested. The job will stop after the current contact." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PIPELINE STAGE HEALTH ─────────────────────────────────────────────────
  app.get("/api/admin/pipeline/stage-health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { deals: dealsTable, sequenceEnrollments: enrollmentsTable } = await import("@shared/schema");
      const { eq, and, isNull, inArray, count: drizzleCount } = await import("drizzle-orm");

      // 1. Total New Lead deals (non-archived)
      const [totalRow] = await db.select({ count: drizzleCount() }).from(dealsTable).where(
        and(eq(dealsTable.pipeline, "sales"), eq(dealsTable.stage, "New Lead"), isNull(dealsTable.archivedAt))
      );
      const totalNewLeadDeals = totalRow?.count ?? 0;

      // 2. Stuck 7+ days (uses updatedAt — documented limitation)
      const staleDealsRaw = await storage.getDealsStuckInStage("New Lead", 7 * 24 * 60);
      const staleDeals = staleDealsRaw.slice(0, 25).map((d: any) => ({
        dealId: d.id,
        contactId: d.contactId,
        vertical: d.vertical ?? null,
        updatedAt: d.updatedAt,
        createdAt: d.createdAt,
      }));

      // 3. New Lead deals with no active enrollment
      const allNewLeadDeals = await db.select({
        id: dealsTable.id,
        contactId: dealsTable.contactId,
      }).from(dealsTable).where(
        and(eq(dealsTable.pipeline, "sales"), eq(dealsTable.stage, "New Lead"), isNull(dealsTable.archivedAt))
      );
      const contactIds = allNewLeadDeals.map((d: any) => d.contactId).filter(Boolean) as number[];
      let enrolledContactIds = new Set<number>();
      if (contactIds.length > 0) {
        const activeEnrollments = await db
          .select({ contactId: enrollmentsTable.contactId })
          .from(enrollmentsTable)
          .where(
            and(
              inArray(enrollmentsTable.contactId, contactIds),
              eq(enrollmentsTable.status, "active")
            )
          );
        enrolledContactIds = new Set(activeEnrollments.map((e: any) => e.contactId));
      }
      const newLeadNoActiveEnrollment = allNewLeadDeals.filter(
        (d: any) => !d.contactId || !enrolledContactIds.has(d.contactId)
      ).length;

      // 4. System settings
      const [lastSweep, lastTick, autoEnroll] = await Promise.all([
        storage.getSystemSetting("stage_progression_last_run"),
        storage.getSystemSetting("sequence_runner_last_tick"),
        storage.getSystemSetting("autoEnrollNewLeadDeals"),
      ]);

      res.json({
        totalNewLeadDeals,
        newLeadNoMovement7d: staleDealsRaw.length,
        newLeadNoActiveEnrollment,
        autoEnrollNewLeadDeals: autoEnroll === true,
        lastStageProgressionSweepAt: (lastSweep as any)?.at ?? null,
        lastSequenceWorkerTickAt: (lastTick as any)?.at ?? null,
        staleness_proxy: "updatedAt",
        staleDeals,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── NEW LEAD ENROLLMENT SETTINGS ──────────────────────────────────────────
  app.post("/api/admin/pipeline/vertical-sequence-map", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { setVerticalSequenceMap, setDefaultSequenceId } = await import("../services/new-lead-enrollment-job");
      const { verticalMap, defaultSequenceId } = req.body ?? {};
      if (verticalMap !== undefined) {
        if (typeof verticalMap !== "object" || Array.isArray(verticalMap)) {
          return res.status(400).json({ message: "verticalMap must be an object." });
        }
        await setVerticalSequenceMap(verticalMap);
      }
      if (defaultSequenceId !== undefined) {
        await setDefaultSequenceId(defaultSequenceId === null ? null : Number(defaultSequenceId));
      }
      res.json({ saved: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/pipeline/auto-enroll-toggle", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { setAutoEnrollEnabled } = await import("../services/new-lead-enrollment-job");
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled must be a boolean." });
      }
      await setAutoEnrollEnabled(enabled);
      res.json({ autoEnrollNewLeadDeals: enabled });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── NEW LEAD ENROLLMENT JOB ───────────────────────────────────────────────
  app.post("/api/admin/pipeline/new-leads/enroll-preview", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { previewNewLeadEnroll } = await import("../services/new-lead-enrollment-job");
      const result = await previewNewLeadEnroll();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/pipeline/new-leads/enroll", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { isNewLeadEnrollJobRunning, startNewLeadEnroll, previewNewLeadEnroll } =
        await import("../services/new-lead-enrollment-job");
      const { confirmed, confirmationText } = req.body ?? {};

      if (!confirmed) {
        return res.status(400).json({ message: "confirmed: true is required." });
      }
      if (isNewLeadEnrollJobRunning()) {
        return res.status(409).json({ message: "A new-lead enrollment job is already running." });
      }

      const preview = await previewNewLeadEnroll();
      if (preview.eligible >= 100 && confirmationText !== "ENROLL") {
        return res.status(400).json({
          message: `Typed confirmation 'ENROLL' required when eligible count is ≥ 100 (found ${preview.eligible}).`,
          eligible: preview.eligible,
          requiresTypedConfirmation: true,
        });
      }

      await startNewLeadEnroll();
      res.status(202).json({ started: true, eligible: preview.eligible });
    } catch (err: any) {
      if (err.message === "A new-lead enrollment job is already running.") {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/pipeline/new-leads/enroll-status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getNewLeadEnrollProgress, isNewLeadEnrollJobRunning } =
        await import("../services/new-lead-enrollment-job");
      const progress = await getNewLeadEnrollProgress();
      res.json({ ...progress, jobRunning: isNewLeadEnrollJobRunning() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/pipeline/new-leads/enroll-cancel", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isNewLeadEnrollJobRunning, cancelNewLeadEnroll } =
        await import("../services/new-lead-enrollment-job");
      if (!isNewLeadEnrollJobRunning()) {
        return res.status(400).json({ message: "No new-lead enrollment job is currently running." });
      }
      await cancelNewLeadEnroll();
      res.json({ cancelled: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── CAN-SPAM cold-email config health ─────────────────────────────────────
  app.get("/api/admin/cold-email-health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
      const hasMailingAddress = !!mailingAddress && String(mailingAddress).trim().length > 0;

      const hasUnsubscribeTokenSecret =
        !!(process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.SESSION_SECRET);

      const appUrl = process.env.APP_URL;
      const hasAppUrl = !!(appUrl && appUrl.trim().length > 0);

      const coldEmailReady = hasMailingAddress && hasUnsubscribeTokenSecret && hasAppUrl;

      res.json({
        hasMailingAddress,
        hasUnsubscribeTokenSecret,
        hasAppUrl,
        coldEmailReady,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
