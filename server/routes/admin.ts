import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { db } from "../db";
import { auditChange } from "../services/audit-change";
import { z } from "zod";
import { insertAgentMerchantSchema, insertAgentQuotaSchema, insertAgentSchema, insertConsentAuditLogSchema, insertDataDeleteRequestSchema, insertHealthAlertSchema, insertResidualReportSchema, insertReviewRequestSchema, insertSendingIdentitySchema, ALLOWED_SENDING_DOMAINS, users, contacts, auditLogs } from "@shared/schema";
import { desc, eq, isNull, and, gte, or, like, count, not } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { sendSmtpEmail, getSmtpStatus, isSmtpConfigured } from "../services/smtp-email";
import { getWorkflowRegistryWithStatus } from "../services/ghl-workflows";

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

}
