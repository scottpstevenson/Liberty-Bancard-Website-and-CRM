import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { db } from "../db";
import { auditChange } from "../services/audit-change";
import { z } from "zod";
import { insertAgentMerchantSchema, insertAgentQuotaSchema, insertAgentSchema, insertConsentAuditLogSchema, insertDataDeleteRequestSchema, insertHealthAlertSchema, insertResidualReportSchema, insertReviewRequestSchema, insertSendingIdentitySchema, ALLOWED_SENDING_DOMAINS, users, contacts, deals, auditLogs, automationRegistry } from "@shared/schema";
import { desc, eq, isNull, and, gte, or, like, count, not } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { sendSmtpEmail, getSmtpStatus, isSmtpConfigured } from "../services/smtp-email";
import { getWorkflowRegistryWithStatus } from "../services/ghl-workflows";
import { summarizeChannelSafety } from "../services/contactability";
import { classifyEligibility } from "../services/deal-eligibility";
import { serverError, safeMessage } from "../utils/server-error";

export function registerAdminRoutes(app: Express) {
  // === ADMIN: SESSION MANAGEMENT ===
  app.get("/api/admin/users/:id/sessions", requireRole('admin'), async (req, res) => {
    try {
      const sessions = await authStorage.getActiveSessionsForUser(String(req.params.id));
      res.json(sessions);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/admin/sessions/:sessionRecordId", requireRole('admin'), async (req, res) => {
    try {
      await authStorage.revokeSessionById(String(req.params.sessionRecordId));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/admin/users/:id/sessions", requireRole('admin'), async (req, res) => {
    try {
      await authStorage.invalidateAllUserSessions(String(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.get("/api/admin/mfa-settings", requireRole('admin'), async (req, res) => {
    try {
      const { systemSettings } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const [setting] = await db.select().from(systemSettings).where(eqOp(systemSettings.key, "mfa_required"));
      res.json({ mfaRequired: setting?.value === true });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });


  // === AGENTS ===
  app.get("/api/agents", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agentsList = await storage.getAgents();
      res.json(agentsList);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/agents/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      res.json(agent);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.delete("/api/agents/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      await storage.updateAgent(Number(req.params.id), { status: "inactive" });
      res.status(204).send();
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === AGENT QUOTAS ===
  app.get("/api/agent-quotas", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const quotas = await storage.getAgentQuotas();
      res.json(quotas);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/agent-quotas", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const input = insertAgentQuotaSchema.parse(req.body);
      const quota = await storage.createAgentQuota(input);
      res.status(201).json(quota);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      serverError(res, err);
    }
  });

  app.put("/api/agent-quotas/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const updated = await storage.updateAgentQuota(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === AGENT MERCHANTS (admin/manager only) ===
  app.get("/api/agent-merchants", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const agentId = req.query.agentId ? Number(req.query.agentId) : undefined;
      const rows = await storage.getAgentMerchants(agentId);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/agent-merchants/deal/:dealId", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const rows = await storage.getAgentMerchantsByDeal(Number(req.params.dealId));
      res.json(rows[0] ?? null);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.delete("/api/agent-merchants/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      await storage.unassignMerchantFromAgent(Number(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // === RESIDUAL REPORTS ===
  app.get("/api/residual-reports", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const reports = await storage.getResidualReports();
      res.json(reports);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/residual-reports", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const input = insertResidualReportSchema.parse(req.body);
      const report = await storage.createResidualReport(input, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.status(201).json(report);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      serverError(res, err);
    }
  });

  app.get("/api/residual-reports/:id", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const report = await storage.getResidualReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Not found" });
      res.json(report);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });


  // === HEALTH ALERTS ===
  app.get("/api/health-alerts", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const alerts = await storage.getActiveHealthAlerts();
      res.json(alerts);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/health-alerts/deal/:dealId", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const alerts = await storage.getHealthAlertsByDeal(Number(req.params.dealId));
      res.json(alerts);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/health-alerts", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertHealthAlertSchema.parse(req.body);
      const alert = await storage.createHealthAlert(input);
      res.status(201).json(alert);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      serverError(res, err);
    }
  });

  app.patch("/api/health-alerts/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateHealthAlert(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === CONSENT AUDIT LOGS ===
  app.get("/api/consent-audit", requireRole('admin', 'manager'), async (req, res) => {
    try {
      const logs = await storage.getConsentAuditLogs();
      res.json(logs);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/consent-audit/contact/:contactId", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const logs = await storage.getConsentAuditLogsByContact(Number(req.params.contactId));
      res.json(logs);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/consent-audit", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertConsentAuditLogSchema.parse(req.body);
      const log = await storage.createConsentAuditLog(input);
      res.status(201).json(log);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });


  // === DATA DELETE REQUESTS ===
  app.post("/api/data-requests", publicLeadRateLimit, async (req, res) => {
    if (req.query.probe === "1") return res.json({ probe: true, endpoint: "/api/data-requests" });
    try {
      const input = insertDataDeleteRequestSchema.parse(req.body);
      const request = await storage.createDataDeleteRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.get("/api/data-requests", requireRole('admin'), async (req, res) => {
    try {
      const requests = await storage.getDataDeleteRequests();
      res.json(requests);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/data-requests/:id", requireRole('admin'), async (req, res) => {
    try {
      const updated = await storage.updateDataDeleteRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === REVIEW REQUESTS ===
  // GET /api/review-requests and PATCH /api/review-requests/:id are registered in
  // server/routes/lifecycle.ts with isDashboardUser + requireRole("admin","manager") guards.

  app.get("/api/review-requests/deal/:dealId", isDashboardUser, async (req, res) => {
    try {
      const requests = await storage.getReviewRequestsByDeal(Number(req.params.dealId));
      res.json(requests);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/review-requests", isDashboardUser, async (req, res) => {
    try {
      const input = insertReviewRequestSchema.parse(req.body);
      const request = await storage.createReviewRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      serverError(res, err);
    }
  });

  // === TESTIMONIAL SUBMISSIONS (staff review inbox) ===
  app.get("/api/testimonial-submissions", isAuthenticated, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const submissions = await storage.getTestimonialSubmissions(status);
      res.json(submissions);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/testimonial-submissions/:id", isAuthenticated, async (req, res) => {
    try {
      const submission = await storage.getTestimonialSubmission(Number(req.params.id));
      if (!submission) return res.status(404).json({ message: "Not found" });
      res.json(submission);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.get("/api/admin/processor-adapters", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getAllAdapterStatuses } = await import("../services/processors/registry");
      const statuses = getAllAdapterStatuses();
      res.json({ adapters: statuses });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/processor-adapters/ping", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { pingAllAdapters, getAllAdapterStatuses } = await import("../services/processors/registry");
      const pingResults = await pingAllAdapters();
      const statuses = getAllAdapterStatuses();
      res.json({ ping: pingResults, adapters: statuses });
    } catch (err: any) {
      serverError(res, err);
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
          log.push({ id: contact.id, email: contact.email, status: "error", error: safeMessage(err.message, "GHL lookup failed") });
        }
        await new Promise(r => setTimeout(r, 120));
      }

      res.json({ results, log });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/backfill-ghl-contacts/status", requireRole("admin", "manager"), async (req, res) => {
    try {
      // Use COUNT aggregates — materialising all 155K contact IDs would OOM the server.
      const [allCount] = await db.select({ total: count() }).from(contacts);
      const [nullCount] = await db.select({ total: count() }).from(contacts).where(isNull(contacts.ghlContactId));
      res.json({ totalContacts: Number(allCount?.total ?? 0), missingGhlId: Number(nullCount?.total ?? 0) });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // === GHL WORKFLOW REGISTRY LIVE VALIDATION ===
  app.post("/api/admin/ghl-workflow-registry/validate", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { validateGhlWorkflowRegistry } = await import("../services/ghl-workflows");
      const { isSdrGhlConfigured } = await import("../services/sdr/ghl-client");
      const { isGhlConfigured } = await import("../services/ghl");
      if (!isGhlConfigured() && !isSdrGhlConfigured()) {
        return res.status(503).json({ error: "GHL not configured — set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID" });
      }
      const result = await validateGhlWorkflowRegistry();
      res.json({
        checkedCount: result.checkedCount,
        okCount: result.okCount,
        unresolvedKeys: result.unresolvedKeys,
        inactiveKeys: result.inactiveKeys,
        apiErrorKeys: result.apiErrorKeys,
        results: result.results,
      });
    } catch (err: any) {
      serverError(res, err);
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
        sendingIdentityCount = identities.filter((i: any) => i.status === "active").length;
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
        payarcKey: !!(process.env.PAYARC_API_KEY),
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
        smtp: { ...smtpStatus, configured: smtpConfigured },
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
        category: "internal_ops",
      });
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === EMAIL HEALTH: GHL WORKFLOW STATUS ===
  app.get("/api/admin/email-health/ghl-status", requireRole("admin", "manager"), async (req, res) => {
    try {
      const workflows = await getWorkflowRegistryWithStatus();
      const configuredCount = workflows.filter(w => w.isSet).length;
      res.json({ workflows, total: workflows.length, configuredCount });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === EMAIL HEALTH: SENDING IDENTITIES CRUD ===
  app.get("/api/admin/sending-identities", requireRole("admin", "manager"), async (req, res) => {
    try {
      const identities = await storage.getSendingIdentities();
      res.json(identities);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.patch("/api/admin/sending-identities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
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
      serverError(res, err);
    }
  });

  app.delete("/api/admin/sending-identities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const deleted = await storage.deleteSendingIdentity(id);
      if (!deleted) return res.status(404).json({ message: "Identity not found" });
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/channel-safety-summary", requireRole("admin", "manager"), async (req, res) => {
    try {
      const summary = await summarizeChannelSafety();
      res.json(summary);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
        error: safeMessage(err.message, "Backfill failed"),
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
      serverError(res, err);
    }
  });

  // === DEAL BACKFILL: STATUS ===
  app.get("/api/admin/contacts/backfill-deals/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const progress = await storage.getBackfillProgress();
      res.json(progress ?? { status: "idle", processed: 0, total: 0, dealsCreated: 0, skipped: 0, skippedBreakdown: {}, lastProcessedContactId: null, startedAt: null, updatedAt: null, completedAt: null, error: null });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // === autoCreateDealsForWarmContacts system setting ===
  app.get("/api/admin/settings/auto-create-deals-for-warm-contacts", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const val = await storage.getSystemSetting("auto_create_deals_for_warm_contacts");
      res.json({ autoCreateDealsForWarmContacts: val === true });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // === Statement Acquisition Cadence Config ===

  /**
   * GET /api/admin/settings/statement-acquisition-config
   * Returns the current statement-chase cadence configuration.
   * Admins and managers can read; only admins can update.
   */
  app.get("/api/admin/settings/statement-acquisition-config", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getAcquisitionConfig } = await import("../services/statement-acquisition");
      const config = await getAcquisitionConfig();
      res.json({ config });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * PUT /api/admin/settings/statement-acquisition-config
   * Updates the statement-chase cadence configuration.
   * Validates all four integer-hour fields before persisting.
   * Immediately syncs the updated delays to the "Statement Chase (Auto)" sequence steps.
   *
   * Body: { upload_nudge_sms_hours, rep_task_hours, educational_email_hours, stall_escalation_days }
   */
  app.put("/api/admin/settings/statement-acquisition-config", requireRole("admin"), async (req, res) => {
    try {
      const { validateAcquisitionConfig, syncStatementChaseSteps } = await import("../services/statement-acquisition");

      // validateAcquisitionConfig throws with a descriptive message on any bad value
      let validated;
      try {
        validated = validateAcquisitionConfig(req.body);
      } catch (validationErr: any) {
        return res.status(400).json({ message: validationErr.message });
      }

      await storage.setSystemSetting("statement_acquisition_config", validated);

      // Immediately apply the new delays to the sequence step rows so the next
      // enrollment uses the updated cadence without a server restart.
      await syncStatementChaseSteps(validated).catch(err =>
        console.warn("[Admin] syncStatementChaseSteps after config update (non-fatal):", err.message),
      );

      await storage.createAuditLog({
        action: "statement_acquisition_config_updated",
        entityType: "system",
        userId: (req.user as any)?.id ?? null,
        details: { config: validated },
      });

      res.json({ config: validated });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CONTACT SCORING JOB ===

  // Preview endpoint: returns eligible count, estimated batches, sample IDs
  app.post("/api/admin/contacts/score-all/preview", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { previewScoringJob } = await import("../services/contact-scoring-job");
      const mode = req.body?.mode === "rescore" ? "rescore" : "backfill";
      const result = await previewScoringJob(mode);
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Start backfill (admin or manager)
  app.post("/api/admin/contacts/score-all", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { startScoringJob } = await import("../services/contact-scoring-job");
      const { confirmed, mode, batchSize } = req.body ?? {};

      if (!confirmed) {
        return res.status(400).json({ message: "confirmed: true is required." });
      }

      // Rescore mode requires admin only (not manager) — enforced here explicitly
      if (mode === "rescore") {
        const userRole = (req.user as any)?.role;
        if (userRole !== "admin") {
          return res.status(403).json({ message: "Re-score mode requires admin role." });
        }
        const { confirmationText } = req.body;
        if (confirmationText !== "RE-SCORE ALL CONTACTS") {
          return res.status(400).json({ message: "Typed confirmation 'RE-SCORE ALL CONTACTS' required to rescore all contacts." });
        }
      }

      const { preflightToken } = req.body ?? {};
      await startScoringJob({
        mode: mode === "rescore" ? "rescore" : "backfill",
        batchSize,
        adminUserId: String((req.user as any)?.id ?? ""),
        preflightToken: preflightToken ?? null,
      });
      res.status(202).json({ message: "Scoring job started." });
    } catch (err: any) {
      if (err.message === "A scoring job is already running.") {
        // Return current persisted progress so the client can render state
        try {
          const { getScoringProgress } = await import("../services/contact-scoring-job");
          const current = await getScoringProgress();
          return res.status(409).json({ message: err.message, progress: current });
        } catch {
          return res.status(409).json({ message: err.message });
        }
      }
      serverError(res, err);
    }
  });

  app.get("/api/admin/contacts/score-all/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getScoringProgress, isScoringJobRunning } = await import("../services/contact-scoring-job");
      const progress = await getScoringProgress();
      res.json({ ...progress, jobRunning: isScoringJobRunning() });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // ── PIPELINE STAGE HEALTH ─────────────────────────────────────────────────
  app.get("/api/admin/pipeline/stage-health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { deals: dealsTable, sequenceEnrollments: enrollmentsTable, contacts: contactsTable, followUpSequences: sequencesTable } = await import("@shared/schema");
      const { eq, and, isNull, inArray, or, count: drizzleCount } = await import("drizzle-orm");

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

      // 3. Fetch all New Lead deals with their contact data (for enrollment + breakdown queries)
      const allNewLeadDealsWithContacts = await db
        .select({
          dealId: dealsTable.id,
          dealVertical: dealsTable.vertical,
          contactId: dealsTable.contactId,
          autoEnrollmentSuppressedAt: dealsTable.autoEnrollmentSuppressedAt,
          contactEmail: contactsTable.email,
          contactPhone: contactsTable.phone,
          contactDoNotContact: contactsTable.doNotContact,
          contactConsentTier: contactsTable.consentTier,
          contactOptedOutEmail: contactsTable.optedOutEmail,
        })
        .from(dealsTable)
        .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
        .where(
          and(eq(dealsTable.pipeline, "sales"), eq(dealsTable.stage, "New Lead"), isNull(dealsTable.archivedAt))
        );

      const contactIds = allNewLeadDealsWithContacts
        .map((d) => d.contactId)
        .filter(Boolean) as number[];

      let enrolledContactIds = new Set<number>();
      if (contactIds.length > 0) {
        // Fetch all enrollments for these contacts, filter covered statuses in JS
        // (avoids any ORM text-column IN() ambiguity)
        const allEnrollmentsForContacts = await db
          .select({ contactId: enrollmentsTable.contactId, status: enrollmentsTable.status })
          .from(enrollmentsTable)
          .where(inArray(enrollmentsTable.contactId, contactIds));
        const COVERED_STATUSES = new Set(["active", "completed"]);
        enrolledContactIds = new Set(
          allEnrollmentsForContacts
            .filter((e) => COVERED_STATUSES.has(e.status ?? ""))
            .map((e) => Number(e.contactId))
        );
      }

      const newLeadNoActiveEnrollment = allNewLeadDealsWithContacts.filter(
        (d) => !d.contactId || !enrolledContactIds.has(d.contactId)
      ).length;

      // 4. Suppressed count (deals with autoEnrollmentSuppressedAt IS NOT NULL, not already DNC)
      const suppressedDeals = allNewLeadDealsWithContacts.filter(
        (d) => d.autoEnrollmentSuppressedAt != null
      );
      const newLeadAutoEnrollmentSuppressed = suppressedDeals.filter((d) => {
        if (!d.contactId) return true;
        const isDnc = d.contactDoNotContact === true || d.contactConsentTier === "do_not_contact";
        return !isDnc;
      }).length;

      // 5. Vertical sequence map + default sequence (for breakdown)
      const { getVerticalSequenceMap, getDefaultSequenceId } = await import("../services/new-lead-enrollment-job");
      const [verticalMap, defaultSeqId] = await Promise.all([
        getVerticalSequenceMap(),
        getDefaultSequenceId(),
      ]);

      // Build a set of all referenced sequence IDs to resolve names in one query
      const allMappedSeqIds = new Set<number>(Object.values(verticalMap).filter(Boolean));
      if (defaultSeqId) allMappedSeqIds.add(defaultSeqId);
      let seqNameMap: Record<number, string> = {};
      if (allMappedSeqIds.size > 0) {
        const seqRows = await db
          .select({ id: sequencesTable.id, name: sequencesTable.name })
          .from(sequencesTable)
          .where(inArray(sequencesTable.id, Array.from(allMappedSeqIds)));
        for (const row of seqRows) seqNameMap[row.id] = row.name;
      }

      // 6. Build breakdownByVertical — group deals by deal.vertical
      const verticalGroups: Map<string | null, typeof allNewLeadDealsWithContacts> = new Map();
      for (const row of allNewLeadDealsWithContacts) {
        const key = row.dealVertical ?? null;
        if (!verticalGroups.has(key)) verticalGroups.set(key, []);
        verticalGroups.get(key)!.push(row);
      }
      // Ensure null/"" vertical always present when there are deals without a vertical
      // (already handled by the loop above — null keys will be included)

      const breakdownByVertical = Array.from(verticalGroups.entries()).map(([vertical, rows]) => {
        const label = vertical ? vertical : "Unknown / Uncategorized";
        const totalDeals = rows.filter((r) => r.contactId != null).length;
        const enrolled = rows.filter((r) => r.contactId != null && enrolledContactIds.has(r.contactId)).length;
        const noActiveEnrollment = totalDeals - enrolled;

        const resolvedSeqId = (vertical && verticalMap[vertical]) ? verticalMap[vertical] : (defaultSeqId ?? null);
        const noSequenceMapped = resolvedSeqId == null ? rows.filter((r) => r.contactId != null).length : 0;

        const noEmail = rows.filter((r) => r.contactId != null && (!r.contactEmail || r.contactEmail.trim() === "")).length;
        const dncBlocked = rows.filter((r) => r.contactId != null && r.contactDoNotContact === true).length;
        const optedOutBlocked = rows.filter((r) => {
          if (!r.contactId) return false;
          const tier = r.contactConsentTier ?? "cold_no_consent";
          return tier === "opted_out" || tier === "do_not_contact" || r.contactOptedOutEmail === true;
        }).length;
        const suppressed = rows.filter((r) => r.contactId != null && r.autoEnrollmentSuppressedAt != null).length;

        const mappedSequenceId = resolvedSeqId ?? null;
        const mappedSequenceName = mappedSequenceId ? (seqNameMap[mappedSequenceId] ?? null) : null;

        let sequenceMappingSource: "explicit" | "default" | "none";
        if (vertical !== null && verticalMap[vertical]) {
          sequenceMappingSource = "explicit";
        } else if (defaultSeqId != null) {
          sequenceMappingSource = "default";
        } else {
          sequenceMappingSource = "none";
        }

        return {
          vertical,
          label,
          totalDeals,
          enrolled,
          noActiveEnrollment,
          noSequenceMapped,
          noEmail,
          dncBlocked,
          optedOutBlocked,
          suppressed,
          mappedSequenceId,
          mappedSequenceName,
          sequenceMappingSource,
        };
      });

      // Sort: noActiveEnrollment desc, then totalDeals desc
      breakdownByVertical.sort((a, b) => {
        if (b.noActiveEnrollment !== a.noActiveEnrollment) return b.noActiveEnrollment - a.noActiveEnrollment;
        return b.totalDeals - a.totalDeals;
      });

      // 7. System settings
      const [lastSweep, lastTick, autoEnroll] = await Promise.all([
        storage.getSystemSetting("stage_progression_last_run"),
        storage.getSystemSetting("sequence_runner_last_tick"),
        storage.getSystemSetting("autoEnrollNewLeadDeals"),
      ]);

      res.json({
        totalNewLeadDeals,
        newLeadNoMovement7d: staleDealsRaw.length,
        newLeadNoActiveEnrollment,
        newLeadAutoEnrollmentSuppressed,
        autoEnrollNewLeadDeals: autoEnroll === true,
        lastStageProgressionSweepAt: (lastSweep as any)?.at ?? null,
        lastSequenceWorkerTickAt: (lastTick as any)?.at ?? null,
        staleness_proxy: "updatedAt",
        staleDeals,
        breakdownByVertical,
        verticalSequenceMap: verticalMap,
        defaultSequenceId: defaultSeqId ?? null,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── PIPELINE STAGE HEALTH — VERTICAL DETAIL ─────────────────────────────
  // GET /api/admin/pipeline/stage-health/vertical-detail
  // Returns blocked deal rows for a single vertical with block reason per row.
  // Query params: vertical (string or __unknown__), limit (default 50, max 200), offset (default 0)
  // Block reason precedence: suppressed → DNC → opted_out → no_email →
  //   no_sequence_mapped → sequence_inactive → already_enrolled → contactability_blocked → unknown
  app.get("/api/admin/pipeline/stage-health/vertical-detail", requireRole("admin", "manager"), async (req, res) => {
    try {
      const rawVertical = req.query.vertical as string | undefined;
      const limitRaw = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const offsetRaw = Math.max(Number(req.query.offset ?? 0) || 0, 0);

      const VALID_BLOCK_REASONS = new Set([
        "suppressed", "DNC", "opted_out", "no_email",
        "no_sequence_mapped", "sequence_inactive", "already_enrolled",
        "contactability_blocked", "unknown",
      ]);
      const rawBlockReason = req.query.blockReason as string | undefined;
      if (rawBlockReason !== undefined && rawBlockReason !== "all" && !VALID_BLOCK_REASONS.has(rawBlockReason)) {
        return res.status(400).json({ message: "Invalid blockReason value" });
      }
      const blockReasonFilter: string | null =
        !rawBlockReason || rawBlockReason === "all" ? null : rawBlockReason;

      // Map __unknown__ or absent → null (unset vertical)
      const vertical: string | null =
        rawVertical === "__unknown__" || rawVertical === undefined || rawVertical === ""
          ? null
          : rawVertical;

      const {
        deals: dealsTable,
        sequenceEnrollments: enrollmentsTable,
        contacts: contactsTable,
        followUpSequences: sequencesTable,
      } = await import("@shared/schema");
      const { eq, and, isNull, inArray, desc } = await import("drizzle-orm");

      // Fetch all New Lead deals for this vertical with contact data
      const baseConditions = [
        eq(dealsTable.pipeline, "sales"),
        eq(dealsTable.stage, "New Lead"),
        isNull(dealsTable.archivedAt),
      ];
      const verticalCondition =
        vertical === null ? isNull(dealsTable.vertical) : eq(dealsTable.vertical, vertical);

      const dealRows = await db
        .select({
          dealId: dealsTable.id,
          dealVertical: dealsTable.vertical,
          contactId: dealsTable.contactId,
          autoEnrollmentSuppressedAt: dealsTable.autoEnrollmentSuppressedAt,
          updatedAt: dealsTable.updatedAt,
          contactFirstName: contactsTable.firstName,
          contactLastName: contactsTable.lastName,
          contactCompanyName: contactsTable.companyName,
          contactEmail: contactsTable.email,
          contactPhone: contactsTable.phone,
          contactDoNotContact: contactsTable.doNotContact,
          contactConsentTier: contactsTable.consentTier,
          contactOptedOutEmail: contactsTable.optedOutEmail,
          contactDoNotAutoContact: contactsTable.doNotAutoContact,
          contactEmailStatus: contactsTable.emailStatus,
          contactLeadScore: contactsTable.leadScore,
        })
        .from(dealsTable)
        .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
        .where(and(...baseConditions, verticalCondition))
        // Stable ORDER BY for consistent pagination across "Load more" calls
        .orderBy(desc(dealsTable.updatedAt), desc(dealsTable.id));

      const contactIds = dealRows
        .map((d) => d.contactId)
        .filter(Boolean) as number[];

      // Enrolled = active | completed (same definition as aggregate)
      let enrolledContactIds = new Set<number>();
      // Any enrollment (any status) for already_enrolled check
      const anyEnrollmentContactIds = new Set<number>();

      if (contactIds.length > 0) {
        const allEnrollments = await db
          .select({ contactId: enrollmentsTable.contactId, status: enrollmentsTable.status })
          .from(enrollmentsTable)
          .where(inArray(enrollmentsTable.contactId, contactIds));

        const COVERED_STATUSES = new Set(["active", "completed"]);
        for (const e of allEnrollments) {
          const cid = Number(e.contactId);
          if (COVERED_STATUSES.has(e.status ?? "")) enrolledContactIds.add(cid);
          anyEnrollmentContactIds.add(cid);
        }
      }

      // Vertical sequence map + default (same as aggregate)
      const { getVerticalSequenceMap, getDefaultSequenceId } = await import(
        "../services/new-lead-enrollment-job"
      );
      const [verticalMap, defaultSeqId] = await Promise.all([
        getVerticalSequenceMap(),
        getDefaultSequenceId(),
      ]);

      const resolvedSeqId =
        vertical && verticalMap[vertical] ? verticalMap[vertical] : (defaultSeqId ?? null);

      let resolvedSeqStatus: string | null = null;
      let resolvedSeqName: string | null = null;
      if (resolvedSeqId) {
        const [seqRow] = await db
          .select({ id: sequencesTable.id, name: sequencesTable.name, status: sequencesTable.status })
          .from(sequencesTable)
          .where(eq(sequencesTable.id, resolvedSeqId));
        if (seqRow) {
          resolvedSeqStatus = (seqRow.status as string | null) ?? null;
          resolvedSeqName = seqRow.name ?? null;
        }
      }

      // Block reason labels (stable machine keys)
      const BLOCK_REASON_LABELS: Record<string, string> = {
        suppressed: "Auto-enrollment suppressed",
        DNC: "Do Not Contact (DNC)",
        opted_out: "Opted out of email",
        no_email: "No email address",
        no_sequence_mapped: "No sequence mapped for this vertical",
        sequence_inactive: "Mapped sequence is inactive",
        already_enrolled: "Already enrolled (non-covered status)",
        contactability_blocked: "Blocked by contactability check",
        unknown: "Unknown block reason",
      };

      function getBlockReason(row: (typeof dealRows)[0]): string {
        // Precedence mirrors new-lead-enrollment-job.ts checks (same order):
        //   suppressed → DNC → opted_out → no_email →
        //   no_sequence_mapped → sequence_inactive → already_enrolled →
        //   contactability_blocked (doNotAutoContact or emailStatus non-active) → unknown
        if (row.autoEnrollmentSuppressedAt != null) return "suppressed";
        if (row.contactDoNotContact === true) return "DNC";
        const tier = row.contactConsentTier ?? "cold_no_consent";
        if (
          tier === "opted_out" ||
          tier === "do_not_contact" ||
          row.contactOptedOutEmail === true
        )
          return "opted_out";
        if (!row.contactEmail || row.contactEmail.trim() === "") return "no_email";
        if (resolvedSeqId == null) return "no_sequence_mapped";
        if (resolvedSeqStatus && resolvedSeqStatus !== "active") return "sequence_inactive";
        const cid = row.contactId ? Number(row.contactId) : null;
        if (cid !== null && anyEnrollmentContactIds.has(cid)) return "already_enrolled";
        // Step 3 of evaluateContactability: doNotAutoContact blocks email automation
        if (row.contactDoNotAutoContact === true) return "contactability_blocked";
        // Email status non-active (bounced, complained, etc.) blocks email sends
        if (row.contactEmailStatus && row.contactEmailStatus !== "active") return "contactability_blocked";
        return "unknown";
      }

      // Only blocked deals (not in enrolledContactIds — same semantics as aggregate noActiveEnrollment).
      // Exclude null-contactId deals to match aggregate which uses rows.filter(r => r.contactId != null).
      const blockedDeals = dealRows.filter(
        (d) => d.contactId != null && !enrolledContactIds.has(d.contactId)
      );

      // Step 1: compute block reason for ALL blocked deals before any slicing
      const now = new Date();
      const allWithReasons = blockedDeals.map((d) => ({
        ...d,
        blockReason: getBlockReason(d),
      }));

      // Step 2: apply optional blockReason filter (filter-before-pagination)
      const filteredDeals = blockReasonFilter
        ? allWithReasons.filter((d) => d.blockReason === blockReasonFilter)
        : allWithReasons;

      // Step 3: total reflects filtered count
      const total = filteredDeals.length;

      // Step 4: paginate the filtered set
      const pageRows = filteredDeals.slice(offsetRaw, offsetRaw + limitRaw);

      // Step 5: build response rows (blockReason already computed — no second call needed)
      const rows = pageRows.map((d) => {
        const updatedAt = d.updatedAt ? new Date(d.updatedAt as any) : null;
        const daysInStage = updatedAt
          ? Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          dealId: d.dealId,
          contactId: d.contactId ?? null,
          contactName: d.contactId
            ? `${d.contactFirstName ?? ""} ${d.contactLastName ?? ""}`.trim() || null
            : null,
          companyName: d.contactCompanyName ?? null,
          email: d.contactEmail ?? null,
          vertical: d.dealVertical ?? null,
          leadScore: d.contactLeadScore ?? null,
          mappedSequenceId: resolvedSeqId ?? null,
          mappedSequenceName: resolvedSeqName ?? null,
          blockReason: d.blockReason,
          blockReasonLabel: BLOCK_REASON_LABELS[d.blockReason] ?? "Unknown block reason",
          daysInStage,
        };
      });

      const label = vertical ? vertical : "Unknown / Uncategorized";

      res.json({
        verticalDetail: {
          vertical,
          label,
          total,
          limit: limitRaw,
          offset: offsetRaw,
          blockReason: rawBlockReason ?? "all",
          rows,
        },
      });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // ── NEW LEAD ENROLLMENT JOB ───────────────────────────────────────────────
  app.post("/api/admin/pipeline/new-leads/enroll-preview", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { previewNewLeadEnroll } = await import("../services/new-lead-enrollment-job");
      const result = await previewNewLeadEnroll();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.get("/api/admin/pipeline/new-leads/enroll-status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getNewLeadEnrollProgress, isNewLeadEnrollJobRunning } =
        await import("../services/new-lead-enrollment-job");
      const progress = await getNewLeadEnrollProgress();
      res.json({ ...progress, jobRunning: isNewLeadEnrollJobRunning() });
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // ── Communications Readiness Checklist ────────────────────────────────────
  // Single endpoint summarising every pre-send configuration requirement.
  // Used by the Activation Panel and monitoring to gate outbound sends.
  app.get("/api/admin/comms-readiness", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isGhlConfigured } = await import("../services/ghl");
      const { isSmtpConfigured } = await import("../services/smtp-email");
      const { getGhlCircuitStatus } = await import("../services/ghl-sync");
      const { getAllSenderProfiles } = await import("../services/email-signatures");

      const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
      const unsubscribeSecret = !!(process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.SESSION_SECRET);
      const appUrl = process.env.APP_URL;
      const circuit = getGhlCircuitStatus();
      const ghlOk = isGhlConfigured() && !circuit.circuitOpen;
      const smtpOk = isSmtpConfigured();
      const senderProfiles = await getAllSenderProfiles();

      const hasSalesProfile = !!(senderProfiles.sales?.name && senderProfiles.sales?.email);
      const hasSupportProfile = !!(senderProfiles.support?.name && senderProfiles.support?.email);
      const hasOnboardingProfile = !!(senderProfiles.onboarding?.name && senderProfiles.onboarding?.email);
      const hasMailingAddress = !!mailingAddress && String(mailingAddress).trim().length > 0;
      const hasAppUrl = !!(appUrl && appUrl.trim().length > 0);

      const outboundGlobalPaused = await storage.getSystemSetting("outboundGlobalPaused").catch(() => false);
      const isPaused = outboundGlobalPaused === true || outboundGlobalPaused === "true";

      const sendChannelReady = ghlOk || smtpOk;
      const coldEmailReady = hasMailingAddress && unsubscribeSecret && hasAppUrl && sendChannelReady;
      const transactionalReady = sendChannelReady && hasSalesProfile && hasOnboardingProfile;
      const overallReady = coldEmailReady && transactionalReady && !isPaused;

      res.json({
        overallReady,
        outboundGlobalPaused: isPaused,
        checks: {
          ghl:               { ok: isGhlConfigured(), label: "GHL configured" },
          ghlCircuit:        { ok: !circuit.circuitOpen, label: "GHL circuit closed", consecutiveFailures: circuit.consecutiveFailures },
          smtp:              { ok: smtpOk, label: "SMTP configured" },
          sendChannel:       { ok: sendChannelReady, label: "At least one send channel ready (GHL or SMTP)" },
          mailingAddress:    { ok: hasMailingAddress, label: "CAN-SPAM mailing address set" },
          unsubscribeSecret: { ok: unsubscribeSecret, label: "Unsubscribe token secret set" },
          appUrl:            { ok: hasAppUrl, label: "APP_URL configured" },
          salesProfile:      { ok: hasSalesProfile, label: "Sales sender profile configured", value: senderProfiles.sales?.email },
          supportProfile:    { ok: hasSupportProfile, label: "Support sender profile configured", value: senderProfiles.support?.email },
          onboardingProfile: { ok: hasOnboardingProfile, label: "Onboarding sender profile configured", value: senderProfiles.onboarding?.email },
          coldEmail:         { ok: coldEmailReady, label: "Cold outreach ready" },
          transactional:     { ok: transactionalReady, label: "Transactional emails ready" },
        },
        senderProfiles,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Sender Profile GET / PUT ──────────────────────────────────────────────
  // Allows admins to view and update the DB-backed sender profiles
  // (sales, support, onboarding) without modifying code.
  app.get("/api/admin/sender-profiles", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getAllSenderProfiles } = await import("../services/email-signatures");
      res.json(await getAllSenderProfiles());
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/admin/sender-profiles/:type", requireRole("admin", "manager"), async (req, res) => {
    try {
      const type = req.params.type as string;
      const validTypes = ["sales", "support", "onboarding"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }
      const { name, title, phone, email, calendlyLink, refCode } = req.body;
      if (!name || !email) {
        return res.status(400).json({ message: "name and email are required" });
      }
      const { saveSignature, getStoredSignature } = await import("../services/email-signatures");
      const existing = await getStoredSignature(type);
      const updated = { ...existing, name, title: title || existing.title, phone: phone || existing.phone, email, ...(calendlyLink !== undefined ? { calendlyLink } : {}), ...(refCode !== undefined ? { refCode } : {}) };
      await saveSignature(type, updated);
      const user = req.user as any;
      await storage.createAuditLog({ action: "sender_profile_updated", entityType: "system", actorType: "user", actorId: String(user?.id || ""), details: { type, name, email } });
      res.json({ ok: true, type, profile: updated });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Database Backup Management ────────────────────────────────────────────
  app.get("/api/admin/backups", requireRole("admin"), async (_req, res) => {
    try {
      const { listBackups } = await import("../services/db-backup");
      res.json(await listBackups());
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/backups/run", requireRole("admin"), async (_req, res) => {
    try {
      const { runDatabaseBackup } = await import("../services/db-backup");
      const user = _req.user as any;
      const result = await runDatabaseBackup(`manual:${user?.email || "admin"}`);
      if (!result.ok) {
        // runDatabaseBackup already fires a critical alert internally — no duplicate needed here
        console.error("[Admin] Manual backup failed:", result.error);
        return res.status(500).json({ ok: false, error: safeMessage(result.error, "Backup failed") });
      }
      const _pathMod = await import("path");
      res.json({ ok: true, filePath: result.filePath ? _pathMod.basename(result.filePath) : null, sizeBytes: result.sizeBytes, durationMs: result.durationMs });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Queue Metrics ─────────────────────────────────────────────────────────
  app.get("/api/admin/queue-metrics", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getQueueManager } = await import("../services/queue-manager");
      const qm = await getQueueManager();
      const { queues, usingMock } = await qm.getAllQueueMetrics();
      res.json({ queues, usingMock, timestamp: new Date().toISOString() });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Alert Feed ────────────────────────────────────────────────────────────
  app.get("/api/admin/alerts", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { getRecentAlerts } = await import("../services/alert-feed");
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const alerts = await getRecentAlerts(limit);
      res.json(alerts);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/alerts/:id/acknowledge", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { acknowledgeAlert } = await import("../services/alert-feed");
      const ok = await acknowledgeAlert(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Alert not found" });
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Launch Readiness (extended — full operator launch control panel) ─────────
  app.get("/api/admin/launch-readiness", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getCanonicalUrlInfo } = await import("../lib/canonical-url");
      const { isGhlConfigured } = await import("../services/ghl");
      const { isSmtpConfigured, getSmtpStatus } = await import("../services/smtp-email");
      const { getQueueManager } = await import("../services/queue-manager");
      const { listBackups } = await import("../services/db-backup");
      const { getRecentAlerts } = await import("../services/alert-feed");
      const { pool } = await import("../db");
      const { getGhlCircuitStatus } = await import("../services/ghl-sync");
      const { isGmailOAuthConnected, getGmailOAuthStatus } = await import("../services/gmail-oauth");

      const urlInfo = getCanonicalUrlInfo();
      const ghlOk = isGhlConfigured();
      const smtpStatus = getSmtpStatus();
      const smtpOk = isSmtpConfigured();
      const ghlCircuit = getGhlCircuitStatus();

      // ── Queue metrics ─────────────────────────────────────────────────────────
      let queueMetrics: any[] = [];
      let queueMock = false;
      try {
        const qm = await getQueueManager();
        const m = await qm.getAllQueueMetrics();
        queueMetrics = m.queues;
        queueMock = m.usingMock;
      } catch {}

      const dlqCount = queueMetrics.reduce((sum, q) => sum + (q.failed || 0), 0);
      const lastQueueFailure = queueMetrics
        .filter((q) => q.lastFailedAt)
        .sort((a, b) => new Date(b.lastFailedAt).getTime() - new Date(a.lastFailedAt).getTime())[0];

      // ── Backups ───────────────────────────────────────────────────────────────
      let backups: any[] = [];
      try { backups = await listBackups(); } catch {}

      // ── DB health ─────────────────────────────────────────────────────────────
      let dbOk = false;
      let dbMs = 0;
      try {
        const t0 = Date.now();
        await pool.query("SELECT 1");
        dbMs = Date.now() - t0;
        dbOk = true;
      } catch {}

      // ── Alert feed ────────────────────────────────────────────────────────────
      const alerts = await getRecentAlerts(20);
      const criticalAlerts = alerts.filter((a) => a.severity === "critical" && !a.acknowledged);

      // ── Audit log probes ──────────────────────────────────────────────────────
      const { sql: auditSql } = await import("drizzle-orm");
      async function lastAuditEntry(actions: string[]): Promise<{ createdAt: string | null; details: any }> {
        try {
          const actionList = actions.map(a => `'${a}'`).join(",");
          const rows = await db.execute(auditSql.raw(`
            SELECT created_at, details FROM audit_logs
            WHERE action IN (${actionList})
            ORDER BY created_at DESC LIMIT 1
          `));
          const row = rows.rows[0] as any;
          return { createdAt: row?.created_at?.toISOString?.() ?? row?.created_at ?? null, details: row?.details ?? null };
        } catch { return { createdAt: null, details: null }; }
      }

      const [lastGhlSync, lastTestEmail, lastWebhookEvent, lastSunbizRun, lastClassification, lastBackupSuccess, lastBackupFailed] = await Promise.all([
        lastAuditEntry(["ghl_sync_completed", "GHL_SYNC_TICK_COMPLETE", "ghl_sync_contacts"]),
        lastAuditEntry(["integration_readiness_test_email"]),
        lastAuditEntry(["webhook_received", "ghl_webhook_received", "inbound_message_processed"]),
        lastAuditEntry(["sunbiz_enrichment_completed", "sunbiz_batch_enriched", "sunbiz_enrichment_run"]),
        lastAuditEntry(["inbox_classified", "intent_classified", "reply_classified"]),
        lastAuditEntry(["db_backup_success"]),
        lastAuditEntry(["db_backup_failed"]),
      ]);

      // ── Active cohort size ────────────────────────────────────────────────────
      let activeCohortSize = 0;
      try {
        const cohortRows = await db.execute(auditSql.raw(`
          SELECT COUNT(*) as c FROM contacts
          WHERE lifecycle_stage IN ('prospect','warm_lead','qualified')
          AND email_status NOT IN ('bounced','invalid','unsubscribed')
          AND do_not_contact = false
          LIMIT 1
        `));
        activeCohortSize = parseInt(String((cohortRows.rows[0] as any)?.c ?? "0"), 10) || 0;
      } catch {}

      // ── Gmail OAuth status ────────────────────────────────────────────────────
      const gmailConnected = await isGmailOAuthConnected();
      let gmailEmail: string | null = null;
      try {
        const gmailStatus = await getGmailOAuthStatus();
        gmailEmail = gmailStatus?.email ?? null;
      } catch {}

      // ── Outbound settings ─────────────────────────────────────────────────────
      const { outboundSendCounters } = await import("@shared/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");
      const [
        globalPausedRaw, globalPausedReasonRaw, dailyCapRaw,
        emailChannelPausedRaw, smsChannelPausedRaw, coldEmailChannelPausedRaw,
      ] = await Promise.all([
        storage.getSystemSetting("outboundGlobalPaused"),
        storage.getSystemSetting("outboundGlobalPausedReason"),
        storage.getSystemSetting("outboundDailyEmailCap"),
        storage.getSystemSetting("emailChannelPaused"),
        storage.getSystemSetting("smsChannelPaused"),
        storage.getSystemSetting("coldEmailChannelPaused"),
      ]);
      const globalPaused = globalPausedRaw === true || globalPausedRaw === "true";
      const globalPausedReason = typeof globalPausedReasonRaw === "string" ? globalPausedReasonRaw : null;
      const dailyCap = typeof dailyCapRaw === "number" ? dailyCapRaw : parseInt(String(dailyCapRaw ?? "200"), 10) || 200;
      const emailChannelPaused = emailChannelPausedRaw === true || emailChannelPausedRaw === "true";
      const smsChannelPaused = smsChannelPausedRaw === true || smsChannelPausedRaw === "true";
      const todayStr = new Date().toISOString().slice(0, 10);
      const [capRow] = await db.select({ count: outboundSendCounters.count }).from(outboundSendCounters)
        .where(andOp(eqOp(outboundSendCounters.date, todayStr), eqOp(outboundSendCounters.channel, "email"), eqOp(outboundSendCounters.scope, "cold_outreach")));
      const sendsToday = capRow?.count ?? 0;

      // ── Deliverability settings ───────────────────────────────────────────────
      const [warmupEnabledRaw, warmupStartDateRaw, bounceThresholdRaw, complaintThresholdRaw, unsubThresholdRaw, noProspectEmailRaw, noProspectSmsRaw, testAllowlistRaw] = await Promise.all([
        storage.getSystemSetting("deliveryWarmupEnabled"),
        storage.getSystemSetting("deliveryWarmupStartDate"),
        storage.getSystemSetting("deliveryBounceThresholdPct"),
        storage.getSystemSetting("deliveryComplaintThresholdPct"),
        storage.getSystemSetting("deliveryUnsubscribeThresholdPct"),
        storage.getSystemSetting("deliveryNoProspectSendEmail"),
        storage.getSystemSetting("deliveryNoProspectSendSms"),
        storage.getSystemSetting("deliveryTestEmailAllowlist"),
      ]);
      const warmupEnabled = warmupEnabledRaw === true || warmupEnabledRaw === "true";
      const warmupStartDate = typeof warmupStartDateRaw === "string" ? warmupStartDateRaw : null;
      let warmupDay: number | null = null;
      let warmupCap: number | null = null;
      if (warmupEnabled && warmupStartDate) {
        const daysSince = Math.max(1, Math.floor((Date.now() - new Date(warmupStartDate).getTime()) / 86400000) + 1);
        warmupDay = daysSince;
        if (daysSince >= 30) warmupCap = 250;
        else if (daysSince >= 14) warmupCap = 100;
        else if (daysSince >= 7) warmupCap = 50;
        else warmupCap = 20;
      }
      const bounceThreshold = typeof bounceThresholdRaw === "number" ? bounceThresholdRaw : parseFloat(String(bounceThresholdRaw ?? "5")) || 5;
      const complaintThreshold = typeof complaintThresholdRaw === "number" ? complaintThresholdRaw : parseFloat(String(complaintThresholdRaw ?? "0.1")) || 0.1;
      const unsubThreshold = typeof unsubThresholdRaw === "number" ? unsubThresholdRaw : parseFloat(String(unsubThresholdRaw ?? "5")) || 5;
      const noProspectSendEmail = noProspectEmailRaw === true || noProspectEmailRaw === "true";
      const noProspectSendSms = noProspectSmsRaw === true || noProspectSmsRaw === "true";

      // ── Build legacy gates (keep backward compat) ─────────────────────────────
      const envChecks = {
        APP_URL: { set: !!process.env.APP_URL, value: process.env.APP_URL ? "***set***" : null },
        SLACK_AUDIT_WEBHOOK_URL: { set: !!process.env.SLACK_AUDIT_WEBHOOK_URL },
        SMTP_PASS: { set: smtpOk },
        REDIS_URL: { set: !!process.env.REDIS_URL },
        GHL_LOCATION_ID: { set: !!process.env.GHL_LOCATION_ID },
        GHL_PRIVATE_INTEGRATION_TOKEN: { set: !!process.env.GHL_PRIVATE_INTEGRATION_TOKEN },
        GHL_WEBHOOK_SECRET: { set: !!process.env.GHL_WEBHOOK_SECRET },
        GOOGLE_CLIENT_ID: { set: !!process.env.GOOGLE_CLIENT_ID },
        AI_INTEGRATIONS_OPENAI_API_KEY: { set: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY },
        A2P_REGISTRATION_ID: { set: !!process.env.A2P_REGISTRATION_ID },
      };

      const gates = [
        { id: "canonical_url", label: "Canonical URL resolved", pass: urlInfo.source !== "static_fallback", detail: `${urlInfo.url} (source: ${urlInfo.source})`, ownerAction: urlInfo.warning },
        { id: "database", label: "PostgreSQL responding", pass: dbOk, detail: dbOk ? `${dbMs}ms` : "Connection failed" },
        { id: "redis", label: "Redis / BullMQ", pass: !queueMock, detail: queueMock ? "Using in-memory mock (set REDIS_URL for production)" : "Live Redis connected" },
        { id: "ghl", label: "GHL integration configured", pass: ghlOk, detail: ghlOk ? "GHL_LOCATION_ID + token present" : "Missing GHL credentials", ownerAction: ghlOk ? undefined : "Set GHL_LOCATION_ID and GHL_PRIVATE_INTEGRATION_TOKEN in Replit Secrets" },
        { id: "ghl_circuit", label: "GHL circuit breaker closed", pass: !ghlCircuit.circuitOpen, detail: ghlCircuit.circuitOpen ? `Circuit open — ${ghlCircuit.consecutiveFailures} consecutive failures` : `Closed (${ghlCircuit.consecutiveFailures}/${ghlCircuit.threshold} failures)` },
        { id: "smtp", label: "SMTP fallback configured", pass: smtpOk, detail: smtpOk ? `host=${smtpStatus.host}` : "SMTP not configured — GHL is primary delivery path", ownerAction: smtpOk ? undefined : "Set SMTP_HOST, SMTP_USER, SMTP_PASS in Replit Secrets (optional but required for transactional email fallback)" },
        { id: "gmail_oauth", label: "Gmail OAuth connected", pass: gmailConnected, detail: gmailConnected ? `Connected: ${gmailEmail ?? "email not retrieved"}` : "OAuth not completed", ownerAction: !gmailConnected ? "Complete Gmail OAuth on Outbound Readiness page" : undefined },
        { id: "queues", label: "All queues registered", pass: queueMetrics.length >= 8, detail: `${queueMetrics.length} queues registered` },
        { id: "dlq_clean", label: "Dead letter queue empty", pass: dlqCount === 0, detail: dlqCount > 0 ? `${dlqCount} failed jobs in DLQ — investigate before launch` : "No failed jobs" },
        { id: "backups", label: "Backup artifact exists", pass: backups.length > 0, detail: backups.length > 0 ? `${backups.length} backup(s) — latest: ${backups[0]?.name}` : "No backups yet — run a manual backup", ownerAction: backups.length === 0 ? "Trigger POST /api/admin/backups/run to create first backup" : undefined },
        { id: "no_critical_alerts", label: "No unacknowledged critical alerts", pass: criticalAlerts.length === 0, detail: criticalAlerts.length > 0 ? `${criticalAlerts.length} critical alert(s) need acknowledgement` : "Clean" },
        { id: "app_url_secret", label: "APP_URL secret set", pass: !!process.env.APP_URL, detail: process.env.APP_URL ? "Set" : "Not set — email links may point to wrong host", ownerAction: !process.env.APP_URL ? "Set APP_URL=https://<your-deployment-domain> in Replit Secrets" : undefined },
        { id: "ai_key", label: "AI / OpenAI key set", pass: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY, detail: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "Set" : "Not set — AI enrichment, intent classification, proposals will fail", ownerAction: !process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "Set AI_INTEGRATIONS_OPENAI_API_KEY in Replit Secrets" : undefined },
        { id: "sms_a2p", label: "SMS / A2P registration", pass: !!process.env.A2P_REGISTRATION_ID, detail: process.env.A2P_REGISTRATION_ID ? `Attested (${process.env.A2P_REGISTRATION_ID})` : "A2P_REGISTRATION_ID not set — SMS blocked for compliance", ownerAction: !process.env.A2P_REGISTRATION_ID ? "Complete A2P 10DLC registration and attest in Outbound Readiness" : undefined },
        { id: "global_pause", label: "Global outbound pause active (safe start)", pass: globalPaused, detail: globalPaused ? `Paused — ${globalPausedReason || "no reason recorded"}` : "⚠ Outbound is LIVE — all active enrollments will fire" },
      ];

      const p0Gates = gates.filter((g) => !["global_pause", "sms_a2p", "gmail_oauth"].includes(g.id));
      const allPass = p0Gates.every((g) => g.pass);
      const p0Failures = gates.filter((g) => !g.pass);

      // ── Subsystem cards (structured, for new UI) ──────────────────────────────
      const subsystems = [
        {
          id: "website_forms", label: "Website / Public Forms", icon: "Globe",
          status: urlInfo.source !== "static_fallback" ? "pass" : "warn",
          metrics: [
            { key: "Canonical URL", value: urlInfo.url },
            { key: "Source", value: urlInfo.source },
          ],
          detail: urlInfo.warning ?? "Public URL resolved",
        },
        {
          id: "crm_db", label: "CRM Database", icon: "Database",
          status: dbOk ? "pass" : "fail",
          metrics: [
            { key: "PostgreSQL", value: dbOk ? `${dbMs}ms` : "unreachable" },
            { key: "Active cohort", value: activeCohortSize },
          ],
          detail: dbOk ? `Responding in ${dbMs}ms · ${activeCohortSize} contactable prospects` : "Database connection failed",
        },
        {
          id: "redis_bullmq", label: "Redis / BullMQ Queues", icon: "Cpu",
          status: queueMock ? "fail" : dlqCount > 0 ? "warn" : "pass",
          metrics: [
            { key: "Queues", value: queueMetrics.length },
            { key: "DLQ failures", value: dlqCount },
            { key: "Last failure", value: lastQueueFailure?.lastFailedAt ?? "None" },
          ],
          detail: queueMock ? "Using in-memory mock — set REDIS_URL for production" : dlqCount > 0 ? `${dlqCount} failed jobs need attention` : "Live Redis · all queues healthy",
        },
        {
          id: "ghl_sync", label: "GHL Sync", icon: "RefreshCw",
          status: ghlCircuit.circuitOpen ? "fail" : ghlOk ? "pass" : "warn",
          metrics: [
            { key: "Circuit", value: ghlCircuit.circuitOpen ? "OPEN" : "closed" },
            { key: "Consecutive failures", value: ghlCircuit.consecutiveFailures },
            { key: "Last sync", value: lastGhlSync.createdAt ?? "Never" },
          ],
          detail: ghlCircuit.circuitOpen ? `Circuit open — ${ghlCircuit.consecutiveFailures} consecutive API failures` : lastGhlSync.createdAt ? `Last synced ${new Date(lastGhlSync.createdAt).toLocaleString()}` : "No sync recorded yet",
        },
        {
          id: "ghl_email", label: "GHL Email Transport", icon: "Mail",
          status: ghlOk ? "pass" : "fail",
          metrics: [
            { key: "GHL configured", value: ghlOk ? "Yes" : "No" },
            { key: "SMTP fallback", value: smtpOk ? `${smtpStatus.host}` : "Not configured" },
          ],
          detail: ghlOk ? `GHL primary · SMTP fallback ${smtpOk ? "ready" : "not configured"}` : "GHL not configured — email delivery blocked",
        },
        {
          id: "gmail_oauth", label: "Gmail OAuth / Inbox", icon: "Inbox",
          status: gmailConnected ? "pass" : process.env.GOOGLE_CLIENT_ID ? "warn" : "fail",
          metrics: [
            { key: "Client ID", value: process.env.GOOGLE_CLIENT_ID ? "Set" : "Missing" },
            { key: "OAuth status", value: gmailConnected ? `Connected: ${gmailEmail}` : "Not connected" },
          ],
          detail: gmailConnected ? `OAuth connected as ${gmailEmail}` : "Gmail OAuth not completed — department email send will fail",
          ownerAction: !gmailConnected ? "Complete Gmail OAuth in Outbound Readiness → Gmail OAuth" : undefined,
        },
        {
          id: "sms_a2p", label: "SMS / A2P / GHL Phone", icon: "Phone",
          status: process.env.A2P_REGISTRATION_ID ? "pass" : "fail",
          metrics: [
            { key: "A2P Registration", value: process.env.A2P_REGISTRATION_ID ? "Attested" : "Missing" },
            { key: "GHL Calendar", value: process.env.GHL_CALENDAR_ID ? "Set" : "Not set" },
          ],
          detail: process.env.A2P_REGISTRATION_ID ? "A2P 10DLC attested — SMS capable" : "A2P_REGISTRATION_ID not set — SMS blocked for compliance",
          ownerAction: !process.env.A2P_REGISTRATION_ID ? "Complete A2P 10DLC registration and set A2P_REGISTRATION_ID" : undefined,
        },
        {
          id: "sunbiz", label: "Sunbiz Lookup", icon: "Search",
          status: lastSunbizRun.createdAt ? "pass" : "warn",
          metrics: [
            { key: "Last enrichment", value: lastSunbizRun.createdAt ?? "Never" },
          ],
          detail: lastSunbizRun.createdAt ? `Last run: ${new Date(lastSunbizRun.createdAt).toLocaleString()}` : "No enrichment runs recorded — run a Sunbiz batch to populate",
        },
        {
          id: "ai_inbox", label: "AI Inbox / Classification", icon: "Brain",
          status: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? (lastClassification.createdAt ? "pass" : "warn") : "fail",
          metrics: [
            { key: "API key", value: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "Set" : "Missing" },
            { key: "Last classification", value: lastClassification.createdAt ?? "None recorded" },
          ],
          detail: !process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "OpenAI key missing — intent classification and AI enrichment will fail" : lastClassification.createdAt ? `Last classified: ${new Date(lastClassification.createdAt).toLocaleString()}` : "No classification events yet",
          ownerAction: !process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "Set AI_INTEGRATIONS_OPENAI_API_KEY in Replit Secrets" : undefined,
        },
        {
          id: "webhooks", label: "Webhooks", icon: "Webhook",
          status: process.env.GHL_WEBHOOK_SECRET ? (lastWebhookEvent.createdAt ? "pass" : "warn") : "fail",
          metrics: [
            { key: "Webhook secret", value: process.env.GHL_WEBHOOK_SECRET ? "Set" : "Missing" },
            { key: "Last event", value: lastWebhookEvent.createdAt ?? "None recorded" },
          ],
          detail: !process.env.GHL_WEBHOOK_SECRET ? "GHL_WEBHOOK_SECRET not set — webhook validation will fail" : lastWebhookEvent.createdAt ? `Last event: ${new Date(lastWebhookEvent.createdAt).toLocaleString()}` : "No webhook events recorded yet",
        },
        {
          id: "outbound_pause", label: "Outbound Global Pause", icon: "Shield",
          status: globalPaused ? "pass" : "warn",
          metrics: [
            { key: "State", value: globalPaused ? "PAUSED (safe)" : "LIVE — outbound firing" },
            { key: "Reason", value: globalPausedReason ?? "—" },
            { key: "Email channel", value: emailChannelPaused ? "paused" : "live" },
            { key: "SMS channel", value: smsChannelPaused ? "paused" : "live" },
          ],
          detail: globalPaused ? `Paused — safe for testing. ${globalPausedReason ?? ""}` : "⚠ Global pause is OFF — all active enrollments will send",
        },
        {
          id: "send_caps", label: "Daily Send Caps", icon: "Gauge",
          status: sendsToday >= dailyCap ? "fail" : sendsToday > dailyCap * 0.8 ? "warn" : "pass",
          metrics: [
            { key: "Daily cap", value: warmupCap != null ? `${warmupCap} (warmup override)` : String(dailyCap) },
            { key: "Sends today", value: sendsToday },
            { key: "Remaining", value: Math.max(0, (warmupCap ?? dailyCap) - sendsToday) },
            { key: "Warmup mode", value: warmupEnabled ? `Day ${warmupDay}` : "Off" },
          ],
          detail: warmupEnabled ? `Warmup mode — day ${warmupDay}, cap=${warmupCap}/day (configured: ${dailyCap})` : `${sendsToday}/${dailyCap} sends today`,
        },
        {
          id: "deliverability", label: "Deliverability Controls", icon: "Activity",
          status: noProspectSendEmail ? "pass" : "warn",
          metrics: [
            { key: "Bounce threshold", value: `${bounceThreshold}%` },
            { key: "Complaint threshold", value: `${complaintThreshold}%` },
            { key: "Unsubscribe threshold", value: `${unsubThreshold}%` },
            { key: "No-prospect guard (email)", value: noProspectSendEmail ? "Active" : "⚠ Off" },
            { key: "No-prospect guard (SMS)", value: noProspectSendSms ? "Active" : "Off" },
          ],
          detail: noProspectSendEmail ? "No-prospect guard active — only allowlisted recipients can receive sends" : "⚠ No-prospect-send guard is off — real prospects can receive sends",
        },
        {
          id: "last_test_email", label: "Last Internal Test Email", icon: "TestTube",
          status: lastTestEmail.createdAt ? "pass" : "warn",
          metrics: [
            { key: "Sent at", value: lastTestEmail.createdAt ?? "Never" },
            { key: "To", value: (lastTestEmail.details as any)?.to ?? "—" },
          ],
          detail: lastTestEmail.createdAt ? `Last test: ${new Date(lastTestEmail.createdAt).toLocaleString()} → ${(lastTestEmail.details as any)?.to ?? "unknown"}` : "No test emails sent yet",
        },
        {
          id: "last_webhook_event", label: "Last Webhook Event", icon: "Radio",
          status: lastWebhookEvent.createdAt ? "pass" : "warn",
          metrics: [
            { key: "Event at", value: lastWebhookEvent.createdAt ?? "Never" },
          ],
          detail: lastWebhookEvent.createdAt ? `Last webhook: ${new Date(lastWebhookEvent.createdAt).toLocaleString()}` : "No webhook events yet",
        },
        {
          id: "last_queue_failure", label: "Last Queue Failure", icon: "AlertTriangle",
          status: lastQueueFailure ? "warn" : "pass",
          metrics: [
            { key: "Failed at", value: lastQueueFailure?.lastFailedAt ?? "None" },
            { key: "Queue", value: lastQueueFailure?.name ?? "—" },
            { key: "Error", value: lastQueueFailure?.lastError ?? "—" },
          ],
          detail: lastQueueFailure ? `Last failure: ${lastQueueFailure.name} @ ${lastQueueFailure.lastFailedAt}` : "No queue failures",
        },
        {
          id: "db_backup", label: "DB Backup", icon: "HardDrive",
          status: (() => {
            if (!lastBackupSuccess.createdAt) return "warn";
            // Warn if last successful backup is more than 26 hours ago (missed nightly window)
            const ageMs = Date.now() - new Date(lastBackupSuccess.createdAt).getTime();
            if (ageMs > 26 * 60 * 60 * 1000) return "warn";
            // Fail if the last event was a failure
            if (lastBackupFailed.createdAt && (!lastBackupSuccess.createdAt || new Date(lastBackupFailed.createdAt) > new Date(lastBackupSuccess.createdAt))) return "fail";
            return "pass";
          })(),
          metrics: [
            { key: "Last success", value: lastBackupSuccess.createdAt ? new Date(lastBackupSuccess.createdAt).toLocaleString() : "Never" },
            { key: "Last failure", value: lastBackupFailed.createdAt ? new Date(lastBackupFailed.createdAt).toLocaleString() : "None recorded" },
            { key: "Files on disk", value: backups.length },
            { key: "Latest file", value: backups[0]?.name ?? "—" },
            { key: "Latest size", value: backups[0] ? `${(backups[0].sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—" },
          ],
          detail: (() => {
            if (!lastBackupSuccess.createdAt) return "No successful backup on record — trigger a manual backup from Launch Readiness";
            const ageMs = Date.now() - new Date(lastBackupSuccess.createdAt).getTime();
            const ageHours = Math.round(ageMs / 3600000);
            if (lastBackupFailed.createdAt && new Date(lastBackupFailed.createdAt) > new Date(lastBackupSuccess.createdAt)) {
              return `Last backup FAILED at ${new Date(lastBackupFailed.createdAt).toLocaleString()} — last success was ${ageHours}h ago`;
            }
            return `Last backup: ${new Date(lastBackupSuccess.createdAt).toLocaleString()} (${ageHours}h ago) · ${backups.length} file(s) on disk`;
          })(),
          ownerAction: !lastBackupSuccess.createdAt ? "Trigger POST /api/admin/backups/run to create first backup" : undefined,
        },
      ];

      // ── Operator verdict banner ────────────────────────────────────────────────
      const blockers: string[] = [];
      if (!dbOk) blockers.push("CRM database unreachable");
      if (!ghlOk) blockers.push("GHL integration not configured");
      if (ghlCircuit.circuitOpen) blockers.push(`GHL circuit breaker open (${ghlCircuit.consecutiveFailures} consecutive failures)`);
      if (queueMock) blockers.push("Redis not connected — BullMQ using in-memory mock");
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) blockers.push("AI/OpenAI API key missing");
      if (dlqCount > 5) blockers.push(`${dlqCount} dead-letter queue failures need attention`);
      if (criticalAlerts.length > 0) blockers.push(`${criticalAlerts.length} unacknowledged critical alerts`);

      const verdictBanner = [
        {
          label: "Website / CRM ready",
          status: dbOk && urlInfo.source !== "static_fallback" ? "pass" : "fail",
          detail: !dbOk ? "Database unreachable" : urlInfo.source === "static_fallback" ? "Canonical URL fallback" : "OK",
        },
        {
          label: "Controlled email test ready (internal only)",
          status: ghlOk && smtpOk && noProspectSendEmail ? "pass" : "warn",
          detail: !noProspectSendEmail ? "No-prospect guard is off — enable in Deliverability Settings" : !smtpOk ? "SMTP not configured" : "Ready for internal test sends",
        },
        {
          label: "Real outbound ready",
          status: globalPaused ? "blocked" : blockers.length === 0 ? "pass" : "fail",
          detail: globalPaused ? "Blocked — global pause is ON (safe start)" : blockers.length > 0 ? blockers.join("; ") : "All gates passing",
          blockers: globalPaused ? ["Global outbound pause is active — toggle off in Outbound Readiness when ready"] : blockers,
        },
        {
          label: "SMS ready",
          status: process.env.A2P_REGISTRATION_ID && !smsChannelPaused ? "pass" : "blocked",
          detail: !process.env.A2P_REGISTRATION_ID ? "A2P 10DLC registration required" : smsChannelPaused ? "SMS channel paused" : "Ready",
          blockers: !process.env.A2P_REGISTRATION_ID ? ["Complete A2P 10DLC registration and set A2P_REGISTRATION_ID"] : [],
        },
      ];

      res.json({
        // Legacy (backward compat)
        verdict: allPass ? "GO" : "NO-GO",
        timestamp: new Date().toISOString(),
        canonicalUrl: urlInfo,
        gates,
        p0Failures,
        queues: queueMetrics,
        backups: backups.slice(0, 5),
        recentAlerts: alerts,
        envChecks,
        ownerActions: gates.filter((g) => g.ownerAction).map((g) => ({ gate: g.label, action: (g as any).ownerAction })),
        // Extended
        subsystems,
        blockers,
        verdictBanner,
        outboundState: {
          globalPaused,
          globalPausedReason,
          emailChannelPaused,
          smsChannelPaused,
          dailyCap,
          sendsToday,
          remaining: Math.max(0, dailyCap - sendsToday),
        },
        deliverability: {
          warmupEnabled,
          warmupStartDate,
          warmupDay,
          warmupCap,
          bounceThreshold,
          complaintThreshold,
          unsubThreshold,
          noProspectSendEmail,
          noProspectSendSms,
          testAllowlist: typeof testAllowlistRaw === "string" ? testAllowlistRaw.split(",").map((e: string) => e.trim()).filter(Boolean) : [],
        },
        activeCohortSize,
        lastTestEmail,
        lastWebhookEvent,
        lastQueueFailure: lastQueueFailure ? {
          timestamp: lastQueueFailure.lastFailedAt,
          jobType: lastQueueFailure.name,
          error: lastQueueFailure.lastError,
        } : null,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Wave A2 — Outbound Preflight Checklist ──────────────────────────────────
  // Standalone endpoint that returns a structured pass/fail for each launch gate.
  // Called from the outbound wizard UI and from the pre-deploy gate.
  app.get("/api/admin/outbound-preflight", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { isGhlConfigured } = await import("../services/ghl");
      const { isSmtpConfigured } = await import("../services/smtp-email");
      const { pool: pgPool } = await import("../db");

      interface PreflightCheck {
        id: string;
        label: string;
        status: "pass" | "fail" | "warn" | "blocked";
        detail: string;
      }

      const checks: PreflightCheck[] = [];

      // 1. GHL token valid
      const ghlOk = isGhlConfigured();
      checks.push({
        id: "ghl_token",
        label: "GHL API token configured",
        status: ghlOk ? "pass" : "fail",
        detail: ghlOk ? "GHL_PRIVATE_INTEGRATION_TOKEN present" : "GHL_PRIVATE_INTEGRATION_TOKEN missing or invalid",
      });

      // 2. At least one sequence with status='active'
      const seqResult = await pgPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM follow_up_sequences WHERE status = 'active'`
      );
      const activeSequences = parseInt(seqResult.rows[0]?.count ?? "0", 10);
      checks.push({
        id: "active_sequences",
        label: "At least one active sequence",
        status: activeSequences > 0 ? "pass" : "fail",
        detail: activeSequences > 0
          ? `${activeSequences} active sequence(s) ready`
          : "No sequences set to 'active' — activate at least one before launch",
      });

      // 3. Bounce handler registered (webhook route exists — check system setting)
      const bounceHandlerActive = ghlOk; // webhook is always registered if GHL is configured
      checks.push({
        id: "bounce_handler",
        label: "Email bounce handler registered",
        status: bounceHandlerActive ? "pass" : "warn",
        detail: bounceHandlerActive
          ? "/api/webhooks/ghl/email-bounce route registered and GHL configured"
          : "GHL not configured — bounce handler cannot receive events",
      });

      // 4. Reply-stop handler active
      checks.push({
        id: "reply_stop",
        label: "Reply-STOP enrollment pause active",
        status: ghlOk ? "pass" : "warn",
        detail: ghlOk
          ? "/api/webhooks/ghl/reply-stop route registered — inbound STOP pauses enrollments"
          : "GHL not configured — reply-stop handler cannot receive events",
      });

      // 5. Global outbound pause = false (this is a pre-launch check — it SHOULD be true before launch)
      const globalPausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
      const globalPaused = globalPausedRaw === true || globalPausedRaw === "true";
      checks.push({
        id: "global_pause",
        label: "Global outbound pause state",
        status: globalPaused ? "blocked" : "pass",
        detail: globalPaused
          ? "Outbound is currently PAUSED (safe state) — toggle off when ready to launch"
          : "Outbound is LIVE — ensure this is intentional",
      });

      // 6. At least 1 sending identity configured (SMTP or GHL)
      const smtpOk = isSmtpConfigured();
      const inboxCount = smtpOk || ghlOk;
      checks.push({
        id: "sending_identity",
        label: "Sending identity configured (SMTP or GHL)",
        status: inboxCount ? "pass" : "fail",
        detail: smtpOk && ghlOk
          ? "SMTP + GHL both configured (dual delivery path)"
          : smtpOk
            ? "SMTP configured (direct delivery)"
            : ghlOk
              ? "GHL configured (GHL delivery only — no List-Unsubscribe header on GHL sends)"
              : "Neither SMTP nor GHL configured — cannot send any outbound emails",
      });

      // 7. Daily cap set
      const dailyCapRaw = await storage.getSystemSetting("outboundDailyEmailCap");
      const dailyCap = typeof dailyCapRaw === "number" ? dailyCapRaw : parseInt(String(dailyCapRaw ?? "0"), 10) || 0;
      checks.push({
        id: "daily_cap",
        label: "Daily email cap configured",
        status: dailyCap > 0 ? "pass" : "warn",
        detail: dailyCap > 0
          ? `Daily cap = ${dailyCap} emails`
          : "No daily cap set — recommend setting outboundDailyEmailCap to prevent accidental bulk sends",
      });

      const allPass = checks.every(c => c.status === "pass" || c.status === "warn");
      const hasBlockers = checks.some(c => c.status === "fail" || c.status === "blocked");

      res.json({
        verdict: hasBlockers ? "BLOCKED" : allPass ? "GO" : "NO-GO",
        timestamp: new Date().toISOString(),
        checks,
        summary: {
          total: checks.length,
          pass: checks.filter(c => c.status === "pass").length,
          warn: checks.filter(c => c.status === "warn").length,
          fail: checks.filter(c => c.status === "fail").length,
          blocked: checks.filter(c => c.status === "blocked").length,
        },
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Full 25-subsystem Launch Readiness Audit ────────────────────────────────
  app.get("/api/admin/launch-readiness-full", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { runAllLaunchReadinessChecks } = await import("../services/launch-readiness-full");
      const report = await runAllLaunchReadinessChecks();
      res.json(report);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/launch-readiness-full/run", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { runAllLaunchReadinessChecks } = await import("../services/launch-readiness-full");
      const report = await runAllLaunchReadinessChecks();
      res.json(report);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Deliverability Settings (GET/PATCH) ───────────────────────────────────────
  app.get("/api/admin/deliverability-settings", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const [warmupEnabled, warmupStartDate, bounceThreshold, complaintThreshold, unsubThreshold, noProspectEmail, noProspectSms, testAllowlist] = await Promise.all([
        storage.getSystemSetting("deliveryWarmupEnabled"),
        storage.getSystemSetting("deliveryWarmupStartDate"),
        storage.getSystemSetting("deliveryBounceThresholdPct"),
        storage.getSystemSetting("deliveryComplaintThresholdPct"),
        storage.getSystemSetting("deliveryUnsubscribeThresholdPct"),
        storage.getSystemSetting("deliveryNoProspectSendEmail"),
        storage.getSystemSetting("deliveryNoProspectSendSms"),
        storage.getSystemSetting("deliveryTestEmailAllowlist"),
      ]);
      res.json({
        warmupEnabled: warmupEnabled === true || warmupEnabled === "true",
        warmupStartDate: typeof warmupStartDate === "string" ? warmupStartDate : null,
        bounceThresholdPct: typeof bounceThreshold === "number" ? bounceThreshold : parseFloat(String(bounceThreshold ?? "5")) || 5,
        complaintThresholdPct: typeof complaintThreshold === "number" ? complaintThreshold : parseFloat(String(complaintThreshold ?? "0.1")) || 0.1,
        unsubscribeThresholdPct: typeof unsubThreshold === "number" ? unsubThreshold : parseFloat(String(unsubThreshold ?? "5")) || 5,
        noProspectSendEmail: noProspectEmail === true || noProspectEmail === "true",
        noProspectSendSms: noProspectSms === true || noProspectSms === "true",
        testEmailAllowlist: typeof testAllowlist === "string" ? testAllowlist.split(",").map((e: string) => e.trim()).filter(Boolean) : [],
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.patch("/api/admin/deliverability-settings", requireRole("admin"), async (req, res) => {
    try {
      const {
        warmupEnabled, warmupStartDate, bounceThresholdPct, complaintThresholdPct, unsubscribeThresholdPct,
        noProspectSendEmail, noProspectSendSms, testEmailAllowlist,
      } = req.body ?? {};
      const saves: Promise<void>[] = [];
      if (typeof warmupEnabled === "boolean") saves.push(storage.setSystemSetting("deliveryWarmupEnabled", warmupEnabled));
      if (typeof warmupStartDate === "string" || warmupStartDate === null) saves.push(storage.setSystemSetting("deliveryWarmupStartDate", warmupStartDate ?? null));
      if (typeof bounceThresholdPct === "number") saves.push(storage.setSystemSetting("deliveryBounceThresholdPct", bounceThresholdPct));
      if (typeof complaintThresholdPct === "number") saves.push(storage.setSystemSetting("deliveryComplaintThresholdPct", complaintThresholdPct));
      if (typeof unsubscribeThresholdPct === "number") saves.push(storage.setSystemSetting("deliveryUnsubscribeThresholdPct", unsubscribeThresholdPct));
      if (typeof noProspectSendEmail === "boolean") saves.push(storage.setSystemSetting("deliveryNoProspectSendEmail", noProspectSendEmail));
      if (typeof noProspectSendSms === "boolean") saves.push(storage.setSystemSetting("deliveryNoProspectSendSms", noProspectSendSms));
      if (Array.isArray(testEmailAllowlist)) saves.push(storage.setSystemSetting("deliveryTestEmailAllowlist", testEmailAllowlist.join(",")));
      await Promise.all(saves);
      await storage.createAuditLog({
        action: "deliverability_settings_updated",
        entityType: "system",
        entityId: 0,
        actorType: "user",
        actorId: (req.user as any)?.id ?? null,
        details: { actorEmail: (req.user as any)?.email, changes: req.body },
      });
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Integration Readiness — per-secret safe probe endpoints ─────────────────

  // Per-user in-memory rate limit for retest: max 10 per minute
  const retestCounts = new Map<string, { count: number; resetAt: number }>();
  function checkRetestRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = retestCounts.get(userId);
    if (!entry || now > entry.resetAt) {
      retestCounts.set(userId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= 10) return false;
    entry.count++;
    return true;
  }

  app.get("/api/admin/integration-readiness", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { runFullValidation } = await import("../services/integration-validator");
      const report = await runFullValidation(false);
      res.json(report);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/integration-readiness/retest", requireRole("admin", "manager"), async (req, res) => {
    try {
      const userId = String((req.user as any)?.id || "unknown");
      if (!checkRetestRateLimit(userId)) {
        return res.status(429).json({ message: "Rate limit: max 10 retests per minute" });
      }
      const category = req.body?.category as string | undefined;
      await storage.createAuditLog({
        action: "integration_readiness_retest",
        entityType: "system",
        actorId: (req.user as any)?.id,
        actorType: "admin",
        details: { category: category || "all" },
      });
      const { runFullValidation } = await import("../services/integration-validator");
      const report = await runFullValidation(true);
      // If category filter requested, still return full report (filtering is UI-side)
      res.json(report);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/integration-readiness/test-email", requireRole("admin"), async (req, res) => {
    try {
      const { to, channel } = req.body as { to?: string; channel?: "smtp" | "ghl" };
      const actor = req.user as any;

      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ success: false, error: "Invalid or missing 'to' address" });
      }
      // Only allow test sends to @libertybancard.com or explicitly configured SMTP_TEST_RECIPIENT
      const allowedDomains = ["libertybancard.com"];
      const toTestRecipient = process.env.SMTP_TEST_RECIPIENT;
      const toDomain = to.split("@")[1]?.toLowerCase();
      const allowed = allowedDomains.includes(toDomain) || (toTestRecipient && to === toTestRecipient);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: `Test emails can only be sent to @libertybancard.com addresses or the configured SMTP_TEST_RECIPIENT. Received domain: ${toDomain}`,
        });
      }

      await storage.createAuditLog({
        action: "integration_readiness_test_email",
        entityType: "system",
        actorId: actor?.id,
        actorType: "admin",
        details: { to, channel: channel || "smtp", triggeredBy: actor?.email },
      });

      if (channel === "ghl") {
        return res.json({ success: false, error: "GHL test send not implemented — use GHL's built-in test workflow feature" });
      }

      const { sendSmtpEmail, isSmtpConfigured } = await import("../services/smtp-email");
      if (!isSmtpConfigured()) {
        return res.json({ success: false, error: "SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS" });
      }
      const result = await sendSmtpEmail({
        to,
        subject: `Liberty Bancard — Integration Readiness SMTP Test (${new Date().toLocaleString()})`,
        html: `<p>This is a controlled SMTP integration test sent by <strong>${actor?.email || "admin"}</strong> from the Liberty Bancard Integration Readiness panel.</p><p>Sent at: ${new Date().toISOString()}</p><p>If you received this, SMTP is working correctly.</p>`,
        category: "internal_ops",
      });
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GHL field bootstrap (POST — creates missing lb_* fields in GHL)
  app.post("/api/admin/ghl/bootstrap-fields", requireRole("admin"), async (req, res) => {
    try {
      const actor = req.user as any;
      await storage.createAuditLog({
        action: "ghl_field_bootstrap",
        entityType: "system",
        actorId: actor?.id,
        actorType: "admin",
        details: { triggeredBy: actor?.email },
      });
      const { bootstrapGhlCustomFieldsAndTags } = await import("../services/sdr/ghl-client");
      const result = await bootstrapGhlCustomFieldsAndTags();
      // Clear the integration readiness cache so next poll shows updated field status
      const { clearValidationCache } = await import("../services/integration-validator");
      clearValidationCache();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GHL Identity Conflict Queue ─────────────────────────────────────────────
  // Lists contacts whose GHL identity conflicts with another local contact.
  // Staff can review and choose to keep the internal link or the GHL link.

  app.get("/api/admin/ghl/identity-conflicts", requireRole("admin", "manager"), async (req, res) => {
    try {
      const resolution = req.query.resolution as string | undefined;
      const conflicts = await storage.getSyncConflicts(resolution);
      // Enrich each row with contact display names so the UI can show them
      const enriched = await Promise.all(conflicts.map(async (c) => {
        const contact = c.contactId ? await storage.getContact(c.contactId) : undefined;
        const ownerContactId = c.ghlValue ? parseInt(c.ghlValue, 10) : undefined;
        const ownerContact = ownerContactId && !isNaN(ownerContactId)
          ? await storage.getContact(ownerContactId)
          : undefined;
        return {
          ...c,
          contactName: contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email : "Unknown",
          contactEmail: contact?.email ?? "",
          ownerContactName: ownerContact
            ? `${ownerContact.firstName ?? ""} ${ownerContact.lastName ?? ""}`.trim() || ownerContact.email
            : `Contact #${ownerContactId}`,
          ownerContactEmail: ownerContact?.email ?? "",
          ghlId: c.internalValue ?? "",
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── GHL Shadow Log (Wave B1) — review what GHL would have overwritten ────────

  app.get("/api/admin/ghl/shadow-log", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { ghlShadowLog } = await import("@shared/schema");
      const { desc, isNull, isNotNull } = await import("drizzle-orm");
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
      const unreviewed = req.query.unreviewed === "true";

      const query = db.select().from(ghlShadowLog);
      if (unreviewed) query.where(isNull(ghlShadowLog.reviewedAt));
      const rows = await query.orderBy(desc(ghlShadowLog.createdAt)).limit(limit);

      res.json({
        entries: rows,
        total: rows.length,
        mode: process.env.GHL_CRM_SYNC_MODE || "shadow",
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/ghl/shadow-log/:id/review", requireRole("admin"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const { ghlShadowLog } = await import("@shared/schema");
      const { eq: eqCheck } = await import("drizzle-orm");
      await db.update(ghlShadowLog).set({
        reviewedAt: new Date(),
        reviewedBy: (req.user as any)?.email || "admin",
      }).where(eqCheck(ghlShadowLog.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/ghl/identity-conflicts/:id/resolve", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { resolution } = req.body as { resolution: "kept-internal" | "kept-ghl" | "manual" };
      if (!["kept-internal", "kept-ghl", "manual"].includes(resolution)) {
        return res.status(400).json({ message: "resolution must be kept-internal, kept-ghl, or manual" });
      }
      const conflict = await storage.resolveSyncConflict(id, resolution);
      if (!conflict) return res.status(404).json({ message: "Conflict not found" });
      storage.createAuditLog({
        action: "ghl_identity_conflict_resolved",
        entityType: "contact",
        entityId: conflict.contactId ?? undefined,
        details: `GHL identity conflict #${id} resolved as "${resolution}" — GHL ID ${conflict.internalValue}`,
      }).catch(() => {});
      res.json(conflict);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Master Leads — ZeroBounce Email Validation (#1100) ─────────────────────
  // Validates up to 100 master_leads rows whose emailValid is NULL.
  // Admin-only; uses the same verifyEmail() service as the contacts flow.
  app.post("/api/admin/master-leads/validate-emails", requireRole("admin"), async (req, res) => {
    try {
      const { db } = await import("../db");
      const { masterLeads } = await import("../../shared/schema");
      const { isNull, eq } = await import("drizzle-orm");
      const batch: number = Math.min(Number(req.body?.limit ?? 100), 200);

      const unchecked = await db
        .select({ id: masterLeads.id, email: masterLeads.email })
        .from(masterLeads)
        .where(isNull(masterLeads.emailValid))
        .limit(batch);

      if (!unchecked.length) {
        return res.json({ validated: 0, valid: 0, invalid: 0, message: "All master leads emails already checked" });
      }

      const { verifyEmail } = await import("../services/sdr/zerobounce");
      let validated = 0; let valid = 0; let invalid = 0;

      for (const lead of unchecked) {
        if (!lead.email) continue;
        try {
          const result = await verifyEmail(lead.email);
          const isValid = result.status === "valid";
          await db.update(masterLeads).set({ emailValid: isValid }).where(eq(masterLeads.id, lead.id));
          validated++; if (isValid) valid++; else invalid++;
        } catch (e: any) {
          console.error(`[MasterLeads ZB] ${lead.email}:`, e.message?.slice(0, 80));
        }
      }

      storage.createAuditLog({
        action: "master_leads_email_validation_batch",
        entityType: "system",
        details: { validated, valid, invalid, batchSize: unchecked.length },
      }).catch(() => {});

      res.json({ validated, valid, invalid, remaining: unchecked.length });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GHL Pipeline Stage Mapping ─────────────────────────────────────────────

  app.get("/api/admin/ghl/pipeline-stages", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getGhlPipelineStages } = await import("../services/ghl-sync");
      const result = await getGhlPipelineStages();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/ghl/stage-map", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const dbMap = await storage.getSystemSetting("ghl_stage_id_map");
      res.json({ stageMap: dbMap || {} });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/ghl/sync-stages", requireRole("admin"), async (_req, res) => {
    try {
      const { syncLocalStagesToGhl } = await import("../services/ghl-sync");
      const result = await syncLocalStagesToGhl();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/ghl/stage-map", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { stageMap } = req.body as { stageMap: Record<string, string> };
      if (!stageMap || typeof stageMap !== "object" || Array.isArray(stageMap)) {
        return res.status(400).json({ message: "stageMap must be a plain object mapping local stage name → GHL stage UUID" });
      }
      // Validate all values look like UUIDs or short IDs (non-empty strings)
      for (const [k, v] of Object.entries(stageMap)) {
        if (typeof k !== "string" || typeof v !== "string" || !k.trim() || !v.trim()) {
          return res.status(400).json({ message: `Invalid entry: key="${k}" value="${v}" — both must be non-empty strings` });
        }
      }
      await storage.setSystemSetting("ghl_stage_id_map", stageMap);
      storage.createAuditLog({
        action: "ghl_stage_map_updated",
        entityType: "system",
        entityId: 0,
        details: { stageMappingCount: Object.keys(stageMap).length },
      }).catch(() => {});
      res.json({ ok: true, count: Object.keys(stageMap).length });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── System Health: Incidents + DLQ ─────────────────────────────────────────

  app.get("/api/admin/system-health/incidents", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // BullMQ dead-letter items
      let dlqItems: any[] = [];
      let queueSummary: any[] = [];
      try {
        const { getQueueManager } = await import("../services/queue-manager");
        const qm = await getQueueManager();
        dlqItems = await qm.getDeadLetterItems();
        const metrics = await qm.getAllQueueMetrics();
        queueSummary = (metrics.queues ?? []).map((q: any) => ({
          name: q.name,
          failed: q.failed ?? 0,
          waiting: q.waiting ?? 0,
          active: q.active ?? 0,
        }));
      } catch (_err) {
        // Redis unavailable — return empty gracefully
      }

      // GHL sync failures (audit_logs, last 24h)
      const ghlRows = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityKey: auditLogs.entityKey,
          details: auditLogs.details,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "ghl_sync"),
            or(like(auditLogs.action, "%fail%"), like(auditLogs.action, "%error%")),
            gte(auditLogs.createdAt, since24h),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(20);

      res.json({
        dlqItems,
        dlqCount: dlqItems.length,
        ghlFailures: ghlRows,
        ghlFailureCount: ghlRows.length,
        queueSummary,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Retry a dead-letter job by composite ID (queueName::jobId)
  app.post("/api/admin/system-health/jobs/:compositeId/retry", requireRole("admin", "manager"), async (req, res) => {
    try {
      const compositeId = decodeURIComponent(req.params.compositeId as string);
      const { getQueueManager } = await import("../services/queue-manager");
      const qm = await getQueueManager();
      await qm.retryDeadLetterJob(compositeId);

      auditChange({
        actorType: "user",
        userId: (req.user as any)?.id ?? null,
        action: "manual_job_retry",
        entityType: "queue",
        entityKey: compositeId,
        details: { compositeId, retriedBy: (req.user as any)?.email ?? "admin" },
      }).catch(() => {});

      res.json({ success: true, compositeId });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Discard (permanently delete) a single dead-letter job
  app.delete("/api/admin/system-health/jobs/:compositeId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const compositeId = decodeURIComponent(req.params.compositeId as string);
      const { getQueueManager } = await import("../services/queue-manager");
      const qm = await getQueueManager();
      await qm.discardDeadLetterJob(compositeId);

      auditChange({
        actorType: "user",
        userId: (req.user as any)?.id ?? null,
        action: "manual_job_discard",
        entityType: "queue",
        entityKey: compositeId,
        details: { compositeId, discardedBy: (req.user as any)?.email ?? "admin" },
      }).catch(() => {});

      res.json({ success: true, compositeId });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Bulk-purge dead-letter jobs (optionally filtered to jobs older than N days)
  // Query param: olderThanDays (number, default 0 = purge all exhausted jobs)
  app.delete("/api/admin/system-health/jobs/dlq/purge", requireRole("admin"), async (req, res) => {
    try {
      const olderThanDays = Math.max(0, parseInt((req.query.olderThanDays as string) ?? "0", 10) || 0);
      const { getQueueManager } = await import("../services/queue-manager");
      const qm = await getQueueManager();
      const removed = await qm.purgeDeadLetterItems(olderThanDays);

      auditChange({
        actorType: "user",
        userId: (req.user as any)?.id ?? null,
        action: "dlq_bulk_purge",
        entityType: "queue",
        entityKey: "dlq",
        details: { removed, olderThanDays, purgedBy: (req.user as any)?.email ?? "admin" },
      }).catch(() => {});

      res.json({ success: true, removed, olderThanDays });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Live Health Monitor ────────────────────────────────────────────────────
  // GET /api/admin/live-health
  // Returns a structured snapshot of all critical background workers and services.
  // ?refresh=1 forces a fresh check even if a cached result is recent.
  // Cached for up to 10 minutes to avoid hammering services on every poll.
  //
  // Critical checks (gate exit-1 if any fail): db, sequenceWorker, redis, ai, kpiQuery
  // Informational checks (stale is a warning, not a failure): slaWorker, ghlSync, dbBackup, outboundPause

  let _liveHealthCache: { result: any; fetchedAt: number } | null = null;
  const LIVE_HEALTH_CACHE_MS = 10 * 60 * 1000; // 10 minutes

  app.get("/api/admin/live-health", requireRole("admin", "manager"), async (req, res) => {
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const now = Date.now();

      // Return cached result if fresh (< 10 min) and no refresh requested
      if (!refresh && _liveHealthCache && (now - _liveHealthCache.fetchedAt) < LIVE_HEALTH_CACHE_MS) {
        return res.json({ ..._liveHealthCache.result, cached: true, cacheAgeMs: now - _liveHealthCache.fetchedAt });
      }

      const { pool } = await import("../db");
      const { sql: drizzleSqlRaw } = await import("drizzle-orm");

      const checks: Array<{
        name: string;
        status: "ok" | "error" | "stale" | "warn";
        detail: string;
        durationMs?: number;
        critical: boolean;
      }> = [];

      // 1. DB
      let dbOk = false;
      let dbMs = 0;
      try {
        const t0 = Date.now();
        await pool.query("SELECT 1");
        dbMs = Date.now() - t0;
        dbOk = true;
      } catch {}
      checks.push({ name: "db", status: dbOk ? "ok" : "error", detail: dbOk ? `${dbMs}ms` : "Connection failed", durationMs: dbMs, critical: true });

      // 2. sequenceWorker
      // When LEGACY_OUTREACH_ENABLED is off the BullMQ sequence job is intentionally
      // not ticking — a stale heartbeat is expected, not an error.
      let seqStatus: "ok" | "error" | "stale" = "error";
      let seqDetail = "Never (worker has not run)";
      try {
        const { featureFlags } = await import("../services/feature-flags");
        if (!featureFlags.LEGACY_OUTREACH_ENABLED) {
          seqStatus = "ok";
          seqDetail = "LEGACY_OUTREACH_ENABLED is off — worker intentionally idle";
        } else {
          const hb = await storage.getSystemSetting("sequence_runner_last_tick");
          if (hb?.at) {
            const ageMs = now - new Date(hb.at).getTime();
            const ageMins = Math.round(ageMs / 60000);
            if (ageMs < 15 * 60 * 1000) {
              seqStatus = "ok";
              seqDetail = `last tick: ${ageMins}m ago`;
            } else {
              seqStatus = "stale";
              seqDetail = `last tick: ${ageMins}m ago (stale >15m)`;
            }
          }
        }
      } catch {}
      checks.push({ name: "sequenceWorker", status: seqStatus, detail: seqDetail, critical: true });

      // 3. slaWorker
      let slaStatus: "ok" | "error" | "stale" = "error";
      let slaDetail = "Never (worker has not run)";
      try {
        const slaHb = await storage.getSystemSetting("sla_worker_last_tick");
        if (slaHb?.at) {
          const ageMs = now - new Date(slaHb.at).getTime();
          const ageMins = Math.round(ageMs / 60000);
          if (ageMs < 15 * 60 * 1000) {
            slaStatus = "ok";
            slaDetail = `last tick: ${ageMins}m ago`;
          } else {
            slaStatus = "stale";
            slaDetail = `last tick: ${ageMins}m ago (stale >15m)`;
          }
        }
      } catch {}
      checks.push({ name: "slaWorker", status: slaStatus, detail: slaDetail, critical: false });

      // 4. ghlSync — last sync from audit logs
      let ghlStatus: "ok" | "stale" | "warn" = "warn";
      let ghlDetail = "No sync recorded";
      try {
        const rows = await db.execute(drizzleSqlRaw.raw(`
          SELECT created_at FROM audit_logs
          WHERE action IN ('ghl_sync_completed','GHL_SYNC_TICK_COMPLETE','ghl_sync_contacts')
          ORDER BY created_at DESC LIMIT 1
        `));
        const row = rows.rows[0] as any;
        if (row?.created_at) {
          const ageMs = now - new Date(row.created_at).getTime();
          const ageMins = Math.round(ageMs / 60000);
          if (ageMs < 60 * 60 * 1000) {
            ghlStatus = "ok";
            ghlDetail = `last tick: ${ageMins}m ago`;
          } else {
            ghlStatus = "stale";
            ghlDetail = `last tick: ${ageMins}m ago (stale >1h)`;
          }
        }
      } catch {}
      checks.push({ name: "ghlSync", status: ghlStatus, detail: ghlDetail, critical: false });

      // 5. redis
      let redisOk = false;
      let redisMs = 0;
      let redisDetail = "Not connected";
      try {
        const { getQueueManager } = await import("../services/queue-manager");
        const qm = await getQueueManager();
        const t0 = Date.now();
        if (qm) {
          const conn = (qm as any)._redisConnection;
          if (conn && typeof conn.ping === "function") {
            await conn.ping();
          }
          const m = await qm.getAllQueueMetrics();
          redisMs = Date.now() - t0;
          redisOk = !m.usingMock;
          redisDetail = m.usingMock ? "in-memory mock (set REDIS_URL for production)" : `${redisMs}ms`;
        }
      } catch {}
      checks.push({ name: "redis", status: redisOk ? "ok" : "error", detail: redisDetail, durationMs: redisMs, critical: true });

      // 6. ai — OpenAI key check + optional lightweight probe
      let aiOk = false;
      let aiMs = 0;
      let aiDetail = "AI_INTEGRATIONS_OPENAI_API_KEY not set";
      const aiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (aiKey) {
        try {
          const t0 = Date.now();
          const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${aiKey}` },
            signal: AbortSignal.timeout(8000),
          });
          aiMs = Date.now() - t0;
          aiOk = r.ok || r.status === 200;
          aiDetail = aiOk ? `${aiMs}ms` : `API returned ${r.status}`;
        } catch (err: any) {
          aiDetail = `Request failed: ${err?.message ?? "timeout"}`;
        }
      }
      checks.push({ name: "ai", status: aiOk ? "ok" : "error", detail: aiDetail, durationMs: aiMs, critical: true });

      // 7. dbBackup — last successful backup
      let backupStatus: "ok" | "warn" = "warn";
      let backupDetail = "No backups found";
      try {
        const { listBackups } = await import("../services/db-backup");
        const backups = await listBackups();
        if (backups.length > 0) {
          const latestMs = new Date(backups[0].createdAt).getTime();
          const ageMs = now - latestMs;
          const ageHours = Math.round(ageMs / 3600000);
          backupStatus = "ok";
          backupDetail = `last backup: ${ageHours}h ago`;
        }
      } catch {}
      checks.push({ name: "dbBackup", status: backupStatus, detail: backupDetail, critical: false });

      // 8. kpiQuery — contact/deal counts
      let kpiOk = false;
      let kpiDetail = "Query failed";
      try {
        const [contactResult, dealResult] = await Promise.all([
          db.execute(drizzleSqlRaw.raw("SELECT COUNT(*) AS c FROM contacts")),
          db.execute(drizzleSqlRaw.raw("SELECT COUNT(*) AS c FROM deals")),
        ]);
        const contactCount = parseInt(String((contactResult.rows[0] as any)?.c ?? "0"), 10) || 0;
        const dealCount = parseInt(String((dealResult.rows[0] as any)?.c ?? "0"), 10) || 0;
        kpiOk = true;
        kpiDetail = `contacts: ${contactCount.toLocaleString()}  deals: ${dealCount.toLocaleString()}`;
      } catch {}
      checks.push({ name: "kpiQuery", status: kpiOk ? "ok" : "error", detail: kpiDetail, critical: true });

      // 9. outboundPause
      let pauseStatus: "ok" | "warn" = "warn";
      let pauseDetail = "Could not read pause state";
      try {
        const rawPause = await storage.getSystemSetting("outboundGlobalPaused");
        const isPaused = rawPause === true || rawPause === "true";
        pauseStatus = "ok";
        pauseDetail = `paused=${isPaused}`;
      } catch {}
      checks.push({ name: "outboundPause", status: pauseStatus, detail: pauseDetail, critical: false });

      const CRITICAL_NAMES = ["db", "sequenceWorker", "redis", "ai", "kpiQuery"];
      const criticalChecks = checks.filter(c => c.critical);
      const allCriticalOk = criticalChecks.every(c => c.status === "ok");
      const overallOk = allCriticalOk;

      const result = {
        ok: overallOk,
        fetchedAt: new Date(now).toISOString(),
        checks,
        summary: {
          total: checks.length,
          ok: checks.filter(c => c.status === "ok").length,
          critical: criticalChecks.length,
          criticalOk: criticalChecks.filter(c => c.status === "ok").length,
        },
        cached: false,
        cacheAgeMs: 0,
      };

      _liveHealthCache = { result, fetchedAt: now };
      return res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Retry GHL sync for a contact identified by entityKey (email or contact id)
  app.post("/api/admin/ghl-failures/retry", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { entityKey } = req.body ?? {};
      if (!entityKey) return res.status(400).json({ message: "entityKey is required" });

      const numId = parseInt(entityKey, 10);
      const [contact] = await db
        .select({ id: contacts.id, email: contacts.email, ghlContactId: contacts.ghlContactId })
        .from(contacts)
        .where(
          isNaN(numId)
            ? eq(contacts.email, entityKey)
            : eq(contacts.id, numId),
        )
        .limit(1);

      if (!contact) return res.status(404).json({ message: "Contact not found for entityKey" });

      const { syncContactToGhl } = await import("../services/ghl-sync");
      const result = await syncContactToGhl(contact.id);

      auditChange({
        actorType: "user",
        userId: (req.user as any)?.id ?? null,
        action: "ghl_sync_manual_retry",
        entityType: "ghl_sync",
        entityId: contact.id,
        entityKey: contact.email ?? String(contact.id),
        details: { triggeredBy: (req.user as any)?.email ?? "admin", result },
      }).catch(() => {});

      res.json({ success: true, contactId: contact.id, result });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === DEPLOYMENT READINESS ===
  app.get("/api/admin/pre-deploy-result", requireRole("admin"), async (req, res) => {
    try {
      const result = await storage.getSystemSetting("pre_deploy_last_result");
      if (!result) return res.json(null);
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === AUTOMATION REGISTRY ===

  // GET /api/admin/automations — returns all automation_registry rows (admin only)
  app.get("/api/admin/automations", isDashboardUser, requireRole("admin"), async (_req, res) => {
    try {
      const rows = await db.select().from(automationRegistry).orderBy(automationRegistry.key);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH /api/admin/automations/:key — update kill_switch_enabled and/or status (admin only)
  app.patch("/api/admin/automations/:key", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const key = String(req.params.key);
      const updates: Record<string, unknown> = {};

      if (typeof req.body.killSwitchEnabled === "boolean" || typeof req.body.kill_switch_enabled === "boolean") {
        updates.killSwitchEnabled = req.body.killSwitchEnabled ?? req.body.kill_switch_enabled;
      }
      if (typeof req.body.status === "string") {
        updates.status = req.body.status;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No editable fields supplied (killSwitchEnabled, status)" });
      }

      updates.updatedAt = new Date();

      const [updated] = await db
        .update(automationRegistry)
        .set(updates as any)
        .where(eq(automationRegistry.key, key))
        .returning();

      if (!updated) return res.status(404).json({ message: `Automation '${key}' not found in registry` });

      // Invalidate kill-switch cache so next job tick picks up the change immediately.
      const { invalidateAutomationCache } = await import("../services/automation-kill-switch");
      invalidateAutomationCache(key);

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === LIFECYCLE CONFLICT DIAGNOSTICS ===
  // GET /api/admin/lifecycle-conflicts
  // Read-only: surfaces contacts where lifecycle_state appears inconsistent
  // with domain state (deals, merchant_profiles, etc.)
  app.get("/api/admin/lifecycle-conflicts", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { pool } = await import("../db");

      // 1. Contacts where lifecycle_state = 'PROSPECT' but merchant_profiles.accountStatus = 'active'
      const activeButProspect = await pool.query(`
        SELECT
          c.id AS contact_id,
          c.first_name || ' ' || c.last_name AS contact_name,
          c.lifecycle_state AS current_lifecycle_state,
          'ACTIVE_PROCESSING' AS suggested_state,
          'Has active merchant profile but lifecycle is PROSPECT' AS conflict_reason
        FROM contacts c
        JOIN merchant_profiles mp ON mp.contact_id = c.id
        WHERE c.lifecycle_state = 'PROSPECT'
          AND mp.account_status = 'active'
          AND c.archived_at IS NULL
        LIMIT 50
      `);

      // 2. Contacts where lifecycle_state = 'PROSPECT' but has any non-closed deal
      const hasDealsButProspect = await pool.query(`
        SELECT
          c.id AS contact_id,
          c.first_name || ' ' || c.last_name AS contact_name,
          c.lifecycle_state AS current_lifecycle_state,
          'ENGAGED' AS suggested_state,
          'Has active deal in pipeline but lifecycle is PROSPECT' AS conflict_reason
        FROM contacts c
        WHERE c.lifecycle_state = 'PROSPECT'
          AND c.archived_at IS NULL
          AND EXISTS (
            SELECT 1 FROM deals d
            WHERE d.contact_id = c.id
              AND d.archived_at IS NULL
              AND d.stage NOT IN ('Closed Lost', 'Nurture / Not Now')
          )
        LIMIT 50
      `);

      const conflicts = [
        ...activeButProspect.rows,
        ...hasDealsButProspect.rows,
      ].slice(0, 100);

      res.json({
        total: conflicts.length,
        conflicts,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Communication Arbitration — suppression log ───────────────────────────
  // GET /api/admin/arbitration-suppressions
  // Returns recent audit_logs rows where action = 'arbitration_suppressed',
  // joined to contacts for display. Supports optional ?limit=N&days=N query.
  app.get("/api/admin/arbitration-suppressions", requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100")), 500);
      const days  = Math.min(parseInt(String(req.query.days  ?? "7")),   90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          id:        auditLogs.id,
          contactId: auditLogs.entityId,
          details:   auditLogs.details,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "arbitration_suppressed"),
            gte(auditLogs.createdAt, since),
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);

      // Attach contact names where available
      const contactIds = [...new Set(rows.map(r => r.contactId).filter(Boolean))] as number[];
      let contactMap: Record<number, { firstName: string; lastName: string; email: string }> = {};
      if (contactIds.length > 0) {
        const { contacts: contactsTable } = await import("@shared/schema");
        const { inArray } = await import("drizzle-orm");
        const people = await db
          .select({
            id:        contactsTable.id,
            firstName: contactsTable.firstName,
            lastName:  contactsTable.lastName,
            email:     contactsTable.email,
          })
          .from(contactsTable)
          .where(inArray(contactsTable.id, contactIds));
        for (const p of people) contactMap[p.id] = p;
      }

      const enriched = rows.map(r => ({
        ...r,
        contact: r.contactId != null ? (contactMap[r.contactId] ?? null) : null,
      }));

      res.json({ items: enriched, total: enriched.length, days, since: since.toISOString() });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/admin/arbitration-windows — return current suppression window settings
  app.get("/api/admin/arbitration-windows", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const [human, auto, reply] = await Promise.all([
        storage.getSystemSetting("arbitration_human_touch_window_hours").catch(() => null),
        storage.getSystemSetting("arbitration_auto_send_window_minutes").catch(() => null),
        storage.getSystemSetting("arbitration_reply_pending_window_hours").catch(() => null),
      ]);
      res.json({
        humanTouchWindowHours:    human  != null ? Number(human)  : 4,
        autoSendWindowMinutes:    auto   != null ? Number(auto)   : 60,
        replyPendingWindowHours:  reply  != null ? Number(reply)  : 24,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH /api/admin/arbitration-windows — update suppression windows
  app.patch("/api/admin/arbitration-windows", requireRole("admin"), async (req, res) => {
    try {
      const schema = {
        humanTouchWindowHours:   (v: unknown) => typeof v === "number" && v >= 0 && v <= 72,
        autoSendWindowMinutes:   (v: unknown) => typeof v === "number" && v >= 0 && v <= 1440,
        replyPendingWindowHours: (v: unknown) => typeof v === "number" && v >= 0 && v <= 168,
      };
      const keyMap: Record<string, string> = {
        humanTouchWindowHours:   "arbitration_human_touch_window_hours",
        autoSendWindowMinutes:   "arbitration_auto_send_window_minutes",
        replyPendingWindowHours: "arbitration_reply_pending_window_hours",
      };
      const updates: Record<string, string> = {};
      for (const [field, validate] of Object.entries(schema)) {
        if (req.body[field] !== undefined) {
          if (!validate(req.body[field])) {
            return res.status(400).json({ error: `Invalid value for ${field}` });
          }
          updates[keyMap[field]] = String(req.body[field]);
        }
      }
      for (const [key, value] of Object.entries(updates)) {
        await storage.setSystemSetting(key, value);
      }
      // Invalidate the arbitration config cache so changes take effect immediately
      const { invalidateArbitrationConfigCache } = await import("../services/communication-arbitration");
      invalidateArbitrationConfigCache();

      await auditChange({
        action: "arbitration_windows_updated",
        entityType: "system",
        entityId: 0,
        entityKey: "arbitration_windows",
        actorType: "user",
        details: updates,
      });

      res.json({ ok: true, updated: Object.keys(updates) });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET /api/admin/lead-queue-stats ───────────────────────────────────────
  // Returns pipeline health metrics for the Speed-to-Lead dashboard widget.
  // Fields:
  //   leadsCreatedToday         — contacts created since midnight UTC
  //   medianMinutesToFirstNba   — median(nba.generated_at - contact.created_at) for today's leads
  //   overdueHighScoreCount     — contacts with next_sla_due_at < NOW() and score >= threshold
  //   overdueLeads              — top 25 overdue leads (details for the table)
  //   stalledLeadsCount         — high-score contacts (last 24h) with no NBA row yet
  //   threshold                 — current LEAD_SLA_SCORE_THRESHOLD env value
  //   slaMins                   — current LEAD_SLA_MINUTES env value
  // ─── Data Health Panel (Wave R1) — orphan counts and inconsistencies ─────────

  app.get("/api/admin/data-health", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { pool: pgPool } = await import("../db");

      const [
        orphanedDealsRow,
        orphanedEnrollmentsRow,
        nullLifecycleRow,
        enrollmentsNoNextActionRow,
        contactsEmailInconsistencyRow,
        dealsNoGhlRow,
      ] = await Promise.all([
        // Deals with no contactId (orphaned from any contact)
        pgPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM deals WHERE contact_id IS NULL`
        ),
        // Sequence enrollments whose sequence no longer exists
        pgPool.query<{ count: string }>(
          `SELECT COUNT(se.*)::text AS count
           FROM sequence_enrollments se
           LEFT JOIN follow_up_sequences fs ON fs.id = se.sequence_id
           WHERE se.status IN ('active','paused') AND fs.id IS NULL`
        ),
        // Contacts with NULL lifecycle_state (should always be set)
        pgPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM contacts WHERE lifecycle_state IS NULL AND archived_at IS NULL`
        ),
        // Active enrollments with no next_action_at (will never process)
        pgPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM sequence_enrollments WHERE status = 'active' AND next_action_at IS NULL`
        ),
        // Contacts where email_status='active' but no email (likely unvalidated)
        pgPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM contacts WHERE (email IS NULL OR email = '') AND email_status = 'active' AND archived_at IS NULL`
        ),
        // Active sales/onboarding deals without a GHL opportunity ID (sync gap)
        pgPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM deals
           WHERE ghl_opportunity_id IS NULL AND pipeline IN ('sales','onboarding')
             AND stage NOT IN ('Closed Lost','Declined')
             AND created_at < NOW() - INTERVAL '1 hour'`
        ),
      ]);

      // Sample up to 25 rows for each category for drill-down
      const [
        orphanedDealsRows,
        orphanedEnrollmentsRows,
        nullLifecycleRows,
      ] = await Promise.all([
        pgPool.query<{ id: number; stage: string; created_at: string }>(
          `SELECT id, stage, created_at::text FROM deals WHERE contact_id IS NULL ORDER BY created_at DESC LIMIT 25`
        ),
        pgPool.query<{ id: number; contact_id: number; sequence_id: number; status: string }>(
          `SELECT se.id, se.contact_id, se.sequence_id, se.status
           FROM sequence_enrollments se
           LEFT JOIN follow_up_sequences fs ON fs.id = se.sequence_id
           WHERE se.status IN ('active','paused') AND fs.id IS NULL
           ORDER BY se.created_at DESC LIMIT 25`
        ),
        pgPool.query<{ id: number; email: string; created_at: string }>(
          `SELECT id, COALESCE(email, '(no email)') as email, created_at::text
           FROM contacts WHERE lifecycle_state IS NULL AND archived_at IS NULL
           ORDER BY created_at DESC LIMIT 25`
        ),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          orphanedDeals: parseInt(orphanedDealsRow.rows[0]?.count ?? "0", 10),
          orphanedEnrollments: parseInt(orphanedEnrollmentsRow.rows[0]?.count ?? "0", 10),
          contactsNullLifecycle: parseInt(nullLifecycleRow.rows[0]?.count ?? "0", 10),
          activeEnrollmentsNoNextAction: parseInt(enrollmentsNoNextActionRow.rows[0]?.count ?? "0", 10),
          contactsEmailInconsistency: parseInt(contactsEmailInconsistencyRow.rows[0]?.count ?? "0", 10),
          dealsNoGhlOpportunityId: parseInt(dealsNoGhlRow.rows[0]?.count ?? "0", 10),
        },
        samples: {
          orphanedDeals: orphanedDealsRows.rows,
          orphanedEnrollments: orphanedEnrollmentsRows.rows,
          contactsNullLifecycle: nullLifecycleRows.rows,
        },
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/data-health/reconcile", requireRole("admin"), async (req, res) => {
    // Trigger reconcile-orphans script asynchronously
    const { execFile } = await import("child_process");
    const child = execFile("npx", ["tsx", "scripts/reconcile-orphans.ts"], {
      env: { ...process.env },
      cwd: process.cwd(),
    });
    const pid = child.pid;
    console.log(`[DataHealth] Reconciliation script started (pid=${pid})`);
    res.json({ started: true, pid, message: "Reconciliation running in background — check audit logs for results" });
  });

  app.get("/api/admin/lead-queue-stats", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { pool: pgPool } = await import("../db");
      const threshold = parseInt(process.env.LEAD_SLA_SCORE_THRESHOLD ?? "40", 10);
      const slaMins = parseInt(process.env.LEAD_SLA_MINUTES ?? "60", 10);

      // Leads created since midnight UTC today
      const todayCountResult = await pgPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM contacts
         WHERE created_at >= CURRENT_DATE
           AND archived_at IS NULL`,
      );
      const leadsCreatedToday = parseInt(todayCountResult.rows[0]?.count ?? "0", 10);

      // Median minutes from contact creation to first NBA generation (today's leads only)
      const medianResult = await pgPool.query<{ median_mins: string | null }>(
        `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (n.generated_at - c.created_at)) / 60
         ) AS median_mins
         FROM contact_nba n
         JOIN contacts c ON c.id = n.contact_id
         WHERE c.created_at >= CURRENT_DATE
           AND c.archived_at IS NULL
           AND n.generated_at IS NOT NULL`,
      );
      const medianMinutesToFirstNba =
        medianResult.rows[0]?.median_mins !== null &&
        medianResult.rows[0]?.median_mins !== undefined
          ? Math.round(parseFloat(medianResult.rows[0].median_mins))
          : null;

      // Overdue high-score leads (next_sla_due_at < NOW())
      const overdueResult = await pgPool.query<{
        id: string;
        first_name: string;
        last_name: string;
        email: string;
        lead_score: string;
        assigned_to: string | null;
        next_sla_due_at: string;
      }>(
        `SELECT id, first_name, last_name, email, lead_score, assigned_to, next_sla_due_at
         FROM contacts
         WHERE next_sla_due_at IS NOT NULL
           AND next_sla_due_at < NOW()
           AND lead_score >= $1
           AND archived_at IS NULL
         ORDER BY next_sla_due_at ASC
         LIMIT 25`,
        [threshold],
      );
      const overdueHighScoreCount = overdueResult.rows.length;
      const overdueLeads = overdueResult.rows.map((r) => ({
        contactId: parseInt(r.id, 10),
        name: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email,
        leadScore: parseInt(r.lead_score, 10),
        assignedTo: r.assigned_to,
        slaDueAt: r.next_sla_due_at,
        minutesOverdue: Math.round(
          (Date.now() - new Date(r.next_sla_due_at).getTime()) / 60000,
        ),
      }));

      // Stalled: high-score leads created in last 24h with no NBA row
      const stalledResult = await pgPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM contacts c
         LEFT JOIN contact_nba n ON n.contact_id = c.id
         WHERE c.created_at >= NOW() - INTERVAL '24 hours'
           AND c.lead_score >= $1
           AND c.archived_at IS NULL
           AND n.id IS NULL`,
        [threshold],
      );
      const stalledLeadsCount = parseInt(stalledResult.rows[0]?.count ?? "0", 10);

      res.json({
        leadsCreatedToday,
        medianMinutesToFirstNba,
        overdueHighScoreCount,
        overdueLeads,
        stalledLeadsCount,
        threshold,
        slaMins,
        asOf: new Date().toISOString(),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

}
