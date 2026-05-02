import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { z } from "zod";
import { insertAgentMerchantSchema, insertAgentQuotaSchema, insertAgentSchema, insertConsentAuditLogSchema, insertDataDeleteRequestSchema, insertHealthAlertSchema, insertResidualReportSchema, insertReviewRequestSchema, users } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import path from "path";

export function registerAdminRoutes(app: Express) {
  // === ADMIN: USER MANAGEMENT ===
  app.get("/api/admin/users", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
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

  app.get("/api/admin/mfa-settings", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { systemSettings } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const [setting] = await db.select().from(systemSettings).where(eqOp(systemSettings.key, "mfa_required"));
      res.json({ mfaRequired: setting?.value === true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/mfa-settings", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
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

  app.post("/api/admin/users/:id/reset-2fa", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { authStorage } = await import("../replit_integrations/auth/storage");
      await authStorage.adminResetTotp(String(req.params.id));
      const [updated] = await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { passwordHash, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/users/:id/role", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { role } = req.body;
      if (!['admin', 'manager', 'agent', 'merchant'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const [updated] = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { passwordHash, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENTS ===
  app.get("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const agentsList = await storage.getAgents();
      res.json(agentsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
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

  app.patch("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const body = { ...req.body };
      if (body.hireDate && typeof body.hireDate === 'string') { body.hireDate = new Date(body.hireDate); }
      const updated = await storage.updateAgent(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      await storage.updateAgent(Number(req.params.id), { status: "inactive" });
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENT QUOTAS ===
  app.get("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const quotas = await storage.getAgentQuotas();
      res.json(quotas);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const input = insertAgentQuotaSchema.parse(req.body);
      const quota = await storage.createAgentQuota(input);
      res.status(201).json(quota);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/agent-quotas/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const updated = await storage.updateAgentQuota(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AGENT MERCHANTS (admin/manager only) ===
  app.get("/api/agent-merchants", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      const agentId = req.query.agentId ? Number(req.query.agentId) : undefined;
      const rows = await storage.getAgentMerchants(agentId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-merchants", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
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

  app.delete("/api/agent-merchants/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== 'admin' && user?.role !== 'manager') return res.status(403).json({ message: "Admin or manager role required" });
      await storage.unassignMerchantFromAgent(Number(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === RESIDUAL CALCULATOR (admin only) ===
  app.post("/api/agents/residual-calculator", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    if (user?.role !== 'admin') return res.status(403).json({ message: "Admin role required" });
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
  app.get("/api/residual-reports", isAuthenticated, async (req, res) => {
    try {
      const reports = await storage.getResidualReports();
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/residual-reports", isAuthenticated, async (req, res) => {
    try {
      const input = insertResidualReportSchema.parse(req.body);
      const report = await storage.createResidualReport(input);
      res.status(201).json(report);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/residual-reports/:id", isAuthenticated, async (req, res) => {
    try {
      const report = await storage.getResidualReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Not found" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-residuals", isAuthenticated, async (req, res) => {
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
  app.get("/api/health-alerts", isAuthenticated, async (req, res) => {
    try {
      const alerts = await storage.getActiveHealthAlerts();
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/health-alerts/deal/:dealId", isAuthenticated, async (req, res) => {
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
  app.get("/api/consent-audit", isAuthenticated, async (req, res) => {
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
  app.post("/api/data-requests", async (req, res) => {
    try {
      const input = insertDataDeleteRequestSchema.parse(req.body);
      const request = await storage.createDataDeleteRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/data-requests", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const requests = await storage.getDataDeleteRequests();
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/data-requests/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
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

}
