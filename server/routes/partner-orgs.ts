import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertPartnerOrgSchema, insertPartnerOrgUserSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { upload } from "./helpers";
import path from "path";
import fs from "fs";
import { createContactGhlFirst } from "../services/contact-writer";
import { scoreContact } from "../services/lead-scoring";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { routeContact } from "../services/smart-router";

function isPartnerOrgAdmin(req: any) {
  return req.session?.partnerOrgUserId && req.session?.partnerOrgId;
}

export function registerPartnerOrgsRoutes(app: Express) {
  // ── Public: get branding by slug (no auth required) ────────────────────────
  app.get("/api/partner-org/:slug/branding", async (req, res) => {
    try {
      const org = await storage.getPartnerOrgBySlug(req.params.slug);
      if (!org || org.status !== "active") {
        return res.status(404).json({ message: "Partner portal not found." });
      }
      res.json({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logoUrl: org.logoUrl,
        primaryColor: org.primaryColor,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: submit contact from partner branded page (no auth required) ────
  app.post("/api/contacts/public", async (req, res) => {
    try {
      const {
        firstName, lastName, email, phone, companyName,
        monthlyVolume, utmSource, utmMedium, utmCampaign,
      } = req.body;

      if (!firstName || !email) {
        return res.status(400).json({ message: "First name and email are required." });
      }

      // Resolve partnerOrgId server-side from slug (utmCampaign holds the slug); ignore client-supplied id
      let resolvedOrgId: number | null = null;
      if (utmCampaign) {
        const org = await storage.getPartnerOrgBySlug(utmCampaign);
        if (org && org.status === "active") resolvedOrgId = org.id;
      }

      const contact = await createContactGhlFirst({
        firstName: String(firstName).slice(0, 200),
        lastName: lastName ? String(lastName).slice(0, 200) : "",
        email: String(email).toLowerCase().slice(0, 300),
        phone: phone ? String(phone).slice(0, 50) : null,
        companyName: companyName ? String(companyName).slice(0, 300) : null,
        status: "New",
        utmSource: utmSource || "partner_portal",
        utmMedium: utmMedium || "white_label",
        utmCampaign: utmCampaign || null,
        landingPage: "/partner/" + (utmCampaign || ""),
        partnerOrgId: resolvedOrgId,
        tags: ["partner_portal", utmCampaign ? `partner_${utmCampaign}` : "partner"].filter(Boolean),
        notes: monthlyVolume ? `Monthly volume estimate: ${monthlyVolume}` : null,
      });

      // Fire standard lead pipeline (non-blocking)
      scoreContact(contact.id).catch(err => console.error("[PartnerPortal] Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("[PartnerPortal] Smart routing error:", err));
      autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("[PartnerPortal] Auto-enroll error:", err));
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("[PartnerPortal] Workflow trigger error:", err));

      res.status(201).json({ id: contact.id, message: "Thank you! We'll be in touch within 24 hours." });
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("unique")) {
        return res.status(409).json({ message: "A contact with this email already exists." });
      }
      res.status(500).json({ message: err.message || "Submission failed." });
    }
  });

  // ── Public: partner portal statement upload (no auth required) ─────────────
  app.post("/api/statements/upload", upload.single("file"), async (req, res) => {
    try {
      const { email, partnerSlug } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required." });
      }

      // Resolve partnerOrgId server-side from slug; ignore client-supplied partnerOrgId
      let orgId: number | null = null;
      if (partnerSlug) {
        const org = await storage.getPartnerOrgBySlug(partnerSlug);
        if (org && org.status === "active") orgId = org.id;
      }

      let contact = await storage.getContactByEmail(email.toLowerCase());
      if (!contact) {
        contact = await storage.createContact({
          firstName: req.body.firstName || email.split("@")[0],
          lastName: req.body.lastName || "",
          email: email.toLowerCase(),
          phone: req.body.phone || null,
          companyName: req.body.companyName || null,
          status: "New",
          utmSource: "partner_portal",
          utmMedium: "white_label",
          utmCampaign: partnerSlug || null,
          partnerOrgId: orgId,
          tags: ["partner_portal", partnerSlug ? `partner_${partnerSlug}` : "partner"].filter(Boolean),
        });
      } else if (orgId && !contact.partnerOrgId) {
        await storage.updateContact(contact.id, { partnerOrgId: orgId });
        contact = { ...contact, partnerOrgId: orgId };
      }

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "Statement Received",
        leadSource: "partner_portal",
        campaignName: partnerSlug || undefined,
        notes: `Statement uploaded via partner portal${partnerSlug ? ` (${partnerSlug})` : ""}.`,
        partnerOrgId: orgId || undefined,
      });

      const fileBuffer = req.file?.buffer;
      const rawName = req.file?.originalname || `statement_${Date.now()}`;
      const fileName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, "_");

      if (fileBuffer) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const diskFileName = `${Date.now()}_${fileName}`;
        fs.writeFileSync(path.join(uploadsDir, diskFileName), fileBuffer);
        await storage.createDocument({
          type: "merchant_statement",
          fileName,
          storageKey: `statements/${diskFileName}`,
          dealId: deal.id,
          contactId: contact.id,
          accessScope: "internal",
        });
      }

      await storage.updateDeal(deal.id, { statementReceived: true, docReadinessScore: fileBuffer ? 2 : 1 });
      await storage.createTask({
        dealId: deal.id, contactId: contact.id,
        title: "Review partner statement + send breakdown",
        assignedTo: "Scott Stevenson",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        priority: "high",
      });
      await storage.createAuditLog({ action: "statement_uploaded", entityType: "contact", entityId: contact.id, details: { source: "partner_portal", partnerSlug, hasFile: !!fileBuffer } });

      res.status(201).json({ message: "Statement received! We'll prepare your savings analysis within 24 hours." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Upload failed." });
    }
  });

  // ── Partner org login ───────────────────────────────────────────────────────
  app.post("/api/partner-org/login", async (req, res) => {
    try {
      const { email, password, slug } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }

      // Resolve org by slug first (if provided) so login is strictly scoped to that org
      let user = null;
      let resolvedOrg = null;
      if (slug) {
        resolvedOrg = await storage.getPartnerOrgBySlug(slug);
        if (!resolvedOrg || resolvedOrg.status !== "active") {
          return res.status(404).json({ message: "Partner portal not found or inactive." });
        }
        user = await storage.getPartnerOrgUserByEmailAndOrg(email.toLowerCase(), resolvedOrg.id);
      } else {
        user = await storage.getPartnerOrgUserByEmail(email.toLowerCase());
      }

      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      if (user.status !== "active") {
        return res.status(403).json({ message: "Account is not active." });
      }

      const org = resolvedOrg || await storage.getPartnerOrg(user.partnerOrgId);

      if (!org) {
        return res.status(404).json({ message: "Partner organization not found." });
      }
      if (org.status !== "active") {
        return res.status(403).json({ message: "This partner portal is currently inactive." });
      }

      (req.session as any).partnerOrgUserId = user.id;
      (req.session as any).partnerOrgId = org.id;
      (req.session as any).partnerOrgSlug = org.slug;

      res.json({
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        org: { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, primaryColor: org.primaryColor },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org session check ───────────────────────────────────────────────
  app.get("/api/partner-org/session", async (req, res) => {
    try {
      const partnerOrgUserId = (req.session as any).partnerOrgUserId;
      if (!partnerOrgUserId) {
        return res.status(401).json({ message: "Not authenticated." });
      }
      const user = await storage.getPartnerOrgUser(partnerOrgUserId);
      if (!user || user.status !== "active") {
        return res.status(401).json({ message: "Session invalid." });
      }
      const org = await storage.getPartnerOrg(user.partnerOrgId);
      if (!org || org.status !== "active") {
        return res.status(403).json({ message: "Partner portal is inactive." });
      }
      res.json({
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        org: { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, primaryColor: org.primaryColor },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org logout ──────────────────────────────────────────────────────
  app.post("/api/partner-org/logout", (req, res) => {
    delete (req.session as any).partnerOrgUserId;
    delete (req.session as any).partnerOrgId;
    delete (req.session as any).partnerOrgSlug;
    res.json({ message: "Logged out." });
  });

  // ── Partner org dashboard (pipeline, contacts, commission) ──────────────────
  app.get("/api/partner-org/dashboard", async (req, res) => {
    try {
      const partnerOrgUserId = (req.session as any).partnerOrgUserId;
      const partnerOrgId = (req.session as any).partnerOrgId;
      if (!partnerOrgUserId || !partnerOrgId) {
        return res.status(401).json({ message: "Please log in." });
      }
      const org = await storage.getPartnerOrg(partnerOrgId);
      if (!org) return res.status(404).json({ message: "Organization not found." });

      const [orgDeals, orgContacts] = await Promise.all([
        storage.getDealsByPartnerOrg(partnerOrgId),
        storage.getContactsByPartnerOrg(partnerOrgId),
      ]);

      const closedDeals = orgDeals.filter(d => d.stage === "Closed Won");
      const pipelineDeals = orgDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost");

      const totalCommission = closedDeals.reduce((sum, d) => {
        const rev = parseFloat(d.estMonthlyRevenue || "0");
        return sum + rev * (org.commissionRate || 10) / 100;
      }, 0);

      const now = new Date();
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const mtdDeals = closedDeals.filter(d => d.closedAt && new Date(d.closedAt) >= mtdStart);
      const mtdCommission = mtdDeals.reduce((sum, d) => {
        const rev = parseFloat(d.estMonthlyRevenue || "0");
        return sum + rev * (org.commissionRate || 10) / 100;
      }, 0);

      res.json({
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logoUrl: org.logoUrl,
          primaryColor: org.primaryColor,
          commissionRate: org.commissionRate,
        },
        kpis: {
          totalLeads: orgContacts.length,
          pipelineDeals: pipelineDeals.length,
          closedDeals: closedDeals.length,
          commissionMTD: Math.round(mtdCommission * 100) / 100,
          totalCommissionEarned: Math.round(totalCommission * 100) / 100,
        },
        deals: orgDeals.slice(0, 100).map(d => ({
          id: d.id,
          stage: d.stage,
          pipeline: d.pipeline,
          contactId: d.contactId,
          estMonthlyRevenue: d.estMonthlyRevenue,
          closedAt: d.closedAt,
          createdAt: d.createdAt,
          estimatedCommission: (() => {
            const rev = parseFloat(d.estMonthlyRevenue || "0");
            return Math.round(rev * (org.commissionRate || 10) / 100 * 100) / 100;
          })(),
        })),
        contacts: orgContacts.slice(0, 100).map(c => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          companyName: c.companyName,
          status: c.status,
          createdAt: c.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org: invite a sub-agent/member (uses partner org session) ────────
  app.post("/api/partner-org/invite-user", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId;
    try {
      const inviter = await storage.getPartnerOrgUser((req.session as any).partnerOrgUserId);
      if (!inviter || inviter.role !== "admin") {
        return res.status(403).json({ message: "Only org admins can invite team members." });
      }
      const { email, firstName, lastName, role, password } = req.body;
      if (!email || !firstName || !password) {
        return res.status(400).json({ message: "Email, first name, and password are required." });
      }
      const existing = await storage.getPartnerOrgUserByEmail(email.toLowerCase());
      if (existing && existing.partnerOrgId === partnerOrgId) {
        return res.status(409).json({ message: "A user with this email already exists in your org." });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await storage.createPartnerOrgUser({
        partnerOrgId,
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || "",
        passwordHash,
        role: role || "member",
        status: "active",
      });
      const { passwordHash: _ph, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Partner org: list team members (admin role within org required) ─────────
  app.get("/api/partner-org/team", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId;
    try {
      const requester = await storage.getPartnerOrgUser((req.session as any).partnerOrgUserId);
      if (!requester || requester.role !== "admin") {
        return res.status(403).json({ message: "Only org admins can view the team roster." });
      }
      const users = await storage.getPartnerOrgUsers(partnerOrgId);
      res.json(users.map(({ passwordHash: _ph, ...u }) => u));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: list all partner orgs ────────────────────────────────────────────
  app.get("/api/partner-orgs", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const orgs = await storage.getPartnerOrgs();
      res.json(orgs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: get single partner org ───────────────────────────────────────────
  app.get("/api/partner-orgs/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const org = await storage.getPartnerOrg(Number(req.params.id));
      if (!org) return res.status(404).json({ message: "Not found." });
      res.json(org);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: create partner org ───────────────────────────────────────────────
  app.post("/api/partner-orgs", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const input = insertPartnerOrgSchema.parse(req.body);
      const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const existing = await storage.getPartnerOrgBySlug(slug);
      if (existing) {
        return res.status(409).json({ message: "A partner org with this slug already exists." });
      }
      const org = await storage.createPartnerOrg({ ...input, slug });
      res.status(201).json(org);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(400).json({ message: err.message });
    }
  });

  // ── Admin: update partner org ───────────────────────────────────────────────
  app.patch("/api/partner-orgs/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const updates = req.body;
      const org = await storage.updatePartnerOrg(Number(req.params.id), updates);
      if (!org) return res.status(404).json({ message: "Not found." });
      res.json(org);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Admin: delete partner org ───────────────────────────────────────────────
  app.delete("/api/partner-orgs/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      await storage.deletePartnerOrg(Number(req.params.id));
      res.json({ message: "Deleted." });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Admin: get partner org users ────────────────────────────────────────────
  app.get("/api/partner-orgs/:id/users", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const users = await storage.getPartnerOrgUsers(Number(req.params.id));
      res.json(users.map(({ passwordHash: _ph, ...u }) => u));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: invite user to partner org ──────────────────────────────────────
  app.post("/api/partner-orgs/:id/users", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const { email, firstName, lastName, role, password } = req.body;
      if (!email || !firstName || !password) {
        return res.status(400).json({ message: "Email, first name, and password are required." });
      }
      const orgId = Number(req.params.id);
      const existing = await storage.getPartnerOrgUserByEmail(email.toLowerCase());
      if (existing && existing.partnerOrgId === orgId) {
        return res.status(409).json({ message: "User already exists in this org." });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await storage.createPartnerOrgUser({
        partnerOrgId: orgId,
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || "",
        passwordHash,
        role: role || "member",
        status: "active",
      });
      const { passwordHash: _ph, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Admin: update partner org user ─────────────────────────────────────────
  app.patch("/api/partner-orgs/:orgId/users/:userId", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const { status, role } = req.body;
      const user = await storage.updatePartnerOrgUser(Number(req.params.userId), { status, role });
      if (!user) return res.status(404).json({ message: "Not found." });
      const { passwordHash: _ph, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Admin: get aggregate performance for all orgs ──────────────────────────
  app.get("/api/partner-orgs-performance", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only." });
    }
    try {
      const orgs = await storage.getPartnerOrgs();
      const performance = await Promise.all(
        orgs.map(async (org) => {
          const [deals, contacts] = await Promise.all([
            storage.getDealsByPartnerOrg(org.id),
            storage.getContactsByPartnerOrg(org.id),
          ]);
          const closedDeals = deals.filter(d => d.stage === "Closed Won");
          const totalCommission = closedDeals.reduce((sum, d) => {
            return sum + parseFloat(d.estMonthlyRevenue || "0") * (org.commissionRate || 10) / 100;
          }, 0);
          return {
            ...org,
            dealCount: deals.length,
            closedDealCount: closedDeals.length,
            leadCount: contacts.length,
            totalCommissionEarned: Math.round(totalCommission * 100) / 100,
          };
        })
      );
      res.json(performance);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
