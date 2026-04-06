import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { z } from "zod";
import { insertAgentQuotaSchema, insertAgentSchema, insertConsentAuditLogSchema, insertDataDeleteRequestSchema, insertHealthAlertSchema, insertResidualReportSchema, insertReviewRequestSchema, users } from "@shared/schema";
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
        createdAt: users.createdAt,
      }).from(users).orderBy(desc(users.createdAt));
      res.json(allUsers);
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
      const agentsList = await storage.getAgents();
      res.json(agentsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const input = insertAgentSchema.parse(req.body);
      const agent = await storage.createAgent(input);
      res.status(201).json(agent);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateAgent(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === AGENT QUOTAS ===
  app.get("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const quotas = await storage.getAgentQuotas();
      res.json(quotas);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const input = insertAgentQuotaSchema.parse(req.body);
      const quota = await storage.createAgentQuota(input);
      res.status(201).json(quota);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/agent-quotas/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateAgentQuota(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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
      res.status(400).json({ message: err.message });
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
      if (dealId) {
        const residuals = await storage.getMerchantResidualsByDeal(dealId);
        res.json(residuals);
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
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/health-alerts/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateHealthAlert(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });


  // === DATA DELETE REQUESTS ===
  app.post("/api/data-requests", async (req, res) => {
    try {
      const input = insertDataDeleteRequestSchema.parse(req.body);
      const request = await storage.createDataDeleteRequest(input);
      res.status(201).json(request);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
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
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/review-requests/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReviewRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}
