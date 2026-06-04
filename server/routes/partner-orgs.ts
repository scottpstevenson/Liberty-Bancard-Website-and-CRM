import type { Express } from "express";
import { isAuthenticated, isDashboardUser } from "../replit_integrations/auth";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
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
import {
  createCoBrandedProposal,
  sendCoBrandedProposalEmail,
  trackProposalView,
  generateCoBrandedProposalHtml,
  generateCoBrandedProposalPdf,
} from "../services/co-branded-proposal";

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
  app.post("/api/contacts/public", publicLeadRateLimit, async (req, res) => {
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
  app.post("/api/statements/upload", publicLeadRateLimit, upload.single("file"), async (req, res) => {
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

  // ─────────────────────────────────────────────────────────────────────────────
  // ── CO-BRANDED PROPOSALS ──────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function getBaseUrl(req: any): string {
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    return process.env.APP_URL ||
      (replitDomain ? `https://${replitDomain}` : `${req.protocol}://${req.get("host")}`);
  }

  // ── Partner org: create a co-branded proposal (partner session) ────────────
  app.post("/api/partner-org/proposals", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId as number;
    try {
      const {
        merchantName, merchantEmail, merchantMonthlyVolume, merchantEffectiveRate,
        pricingPlan, customMessage, contactId, dealId,
      } = req.body;

      if (!merchantName || typeof merchantName !== "string") {
        return res.status(400).json({ message: "Merchant name is required." });
      }

      const user = await storage.getPartnerOrgUser((req.session as any).partnerOrgUserId);

      const proposal = await createCoBrandedProposal({
        partnerOrgId,
        dealId: dealId ? Number(dealId) : undefined,
        contactId: contactId ? Number(contactId) : undefined,
        merchantName: String(merchantName).slice(0, 300),
        merchantEmail: merchantEmail ? String(merchantEmail).slice(0, 300) : undefined,
        merchantMonthlyVolume: merchantMonthlyVolume ? String(merchantMonthlyVolume) : undefined,
        merchantEffectiveRate: merchantEffectiveRate ? String(merchantEffectiveRate) : undefined,
        pricingPlan: pricingPlan || "interchangePlus",
        customMessage: customMessage ? String(customMessage).slice(0, 2000) : undefined,
        createdBy: user ? `${user.firstName} ${user.lastName}`.trim() : "Partner",
      });

      res.status(201).json(proposal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org: list proposals ────────────────────────────────────────────
  app.get("/api/partner-org/proposals", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId as number;
    try {
      const proposals = await storage.getCoBrandedProposals(partnerOrgId);
      const baseUrl = getBaseUrl(req);
      const enriched = proposals.map(p => ({
        ...p,
        viewerUrl: `${baseUrl}/co-branded-proposal/${p.token}`,
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org: send a proposal via email ─────────────────────────────────
  app.post("/api/partner-org/proposals/:id/send", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId as number;
    try {
      const proposal = await storage.getCoBrandedProposal(Number(req.params.id));
      if (!proposal || proposal.partnerOrgId !== partnerOrgId) {
        return res.status(404).json({ message: "Proposal not found." });
      }
      const baseUrl = getBaseUrl(req);

      const { merchantEmail } = req.body;
      if (merchantEmail) {
        if (proposal.contactId) {
          await storage.updateContact(proposal.contactId, { email: merchantEmail });
        }
      }

      const sent = await sendCoBrandedProposalEmail(proposal.id, baseUrl);
      if (!sent) {
        return res.status(500).json({ message: "Failed to deliver email. Please configure GHL or SMTP." });
      }
      res.json({ message: "Proposal sent successfully." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Partner org: delete a proposal ────────────────────────────────────────
  app.delete("/api/partner-org/proposals/:id", async (req, res) => {
    if (!isPartnerOrgAdmin(req)) {
      return res.status(401).json({ message: "Please log in to your partner portal." });
    }
    const partnerOrgId = (req.session as any).partnerOrgId as number;
    try {
      const proposal = await storage.getCoBrandedProposal(Number(req.params.id));
      if (!proposal || proposal.partnerOrgId !== partnerOrgId) {
        return res.status(404).json({ message: "Proposal not found." });
      }
      await storage.deleteCoBrandedProposal(proposal.id);
      res.json({ message: "Deleted." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: view co-branded proposal (tracking) ────────────────────────────
  app.get("/api/public/co-branded-proposal/:token", async (req, res) => {
    try {
      const proposal = await storage.getCoBrandedProposalByToken(req.params.token);
      if (!proposal) return res.status(404).json({ message: "Proposal not found." });

      const org = await storage.getPartnerOrg(proposal.partnerOrgId!);
      if (!org) return res.status(404).json({ message: "Partner not found." });

      await trackProposalView(req.params.token);

      res.json({
        id: proposal.id,
        merchantName: proposal.merchantName,
        merchantMonthlyVolume: proposal.merchantMonthlyVolume,
        merchantEffectiveRate: proposal.merchantEffectiveRate,
        pricingPlan: proposal.pricingPlan,
        proposalData: proposal.proposalData,
        customMessage: proposal.customMessage,
        status: proposal.status,
        partner: {
          name: org.name,
          logoUrl: org.logoUrl,
          primaryColor: org.primaryColor,
          tagline: org.tagline,
          contactName: org.contactName,
          email: org.email,
          phone: org.phone,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: accept a proposal ─────────────────────────────────────────────
  app.post("/api/public/co-branded-proposal/:token/accept", async (req, res) => {
    try {
      const proposal = await storage.getCoBrandedProposalByToken(req.params.token);
      if (!proposal) return res.status(404).json({ message: "Proposal not found." });
      if (!proposal.acceptedAt) {
        await storage.updateCoBrandedProposal(proposal.id, {
          status: "accepted",
          acceptedAt: new Date(),
        });
      }
      res.json({ message: "Proposal accepted." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: tracking pixel for email open tracking ─────────────────────────
  app.get("/api/public/co-branded-proposal/:token/viewed", async (req, res) => {
    try {
      await trackProposalView(req.params.token);
    } catch {
    }
    const pixel = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.set({
      "Content-Type": "image/gif",
      "Content-Length": String(pixel.length),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    });
    res.end(pixel);
  });

  // ── Admin: generate co-branded proposal for a deal ─────────────────────────
  app.post("/api/deals/:dealId/co-branded-proposal", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found." });

      const partnerOrgId = req.body.partnerOrgId || deal.partnerOrgId;
      if (!partnerOrgId) {
        return res.status(400).json({ message: "This deal is not linked to a partner organization." });
      }

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const merchantName = contact?.companyName ||
        (contact ? `${contact.firstName} ${contact.lastName}`.trim() : req.body.merchantName || "Unknown Merchant");

      const user = req.user as any;
      const proposal = await createCoBrandedProposal({
        partnerOrgId: Number(partnerOrgId),
        dealId,
        contactId: deal.contactId ?? undefined,
        merchantName,
        merchantMonthlyVolume: deal.totalVolume || contact?.monthlyVolume || req.body.merchantMonthlyVolume,
        merchantEffectiveRate: deal.effectiveRate || req.body.merchantEffectiveRate,
        pricingPlan: req.body.pricingPlan || deal.recommendedPath?.toLowerCase().replace(/\s+/g, "") || "interchangePlus",
        customMessage: req.body.customMessage,
        proposalData: deal.savingsProposal as any,
        createdBy: user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "Admin",
      });

      const baseUrl = getBaseUrl(req);
      res.status(201).json({
        ...proposal,
        viewerUrl: `${baseUrl}/co-branded-proposal/${proposal.token}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: list co-branded proposals for a deal ────────────────────────────
  app.get("/api/deals/:dealId/co-branded-proposals", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const allProposals = await storage.getAllCoBrandedProposals();
      const dealProposals = allProposals.filter(p => p.dealId === dealId);
      const baseUrl = getBaseUrl(req);
      res.json(dealProposals.map(p => ({
        ...p,
        viewerUrl: `${baseUrl}/co-branded-proposal/${p.token}`,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: send any co-branded proposal ───────────────────────────────────
  app.post("/api/co-branded-proposals/:id/send", isDashboardUser, async (req, res) => {
    try {
      const proposal = await storage.getCoBrandedProposal(Number(req.params.id));
      if (!proposal) return res.status(404).json({ message: "Proposal not found." });
      const baseUrl = getBaseUrl(req);
      const sent = await sendCoBrandedProposalEmail(proposal.id, baseUrl);
      if (!sent) {
        return res.status(500).json({ message: "Failed to deliver email. Please configure GHL or SMTP." });
      }
      res.json({ message: "Proposal sent successfully." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: list all co-branded proposals ──────────────────────────────────
  app.get("/api/co-branded-proposals", isDashboardUser, async (req, res) => {
    try {
      const proposals = await storage.getAllCoBrandedProposals();
      const baseUrl = getBaseUrl(req);
      res.json(proposals.map(p => ({ ...p, viewerUrl: `${baseUrl}/co-branded-proposal/${p.token}` })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Public: download proposal as printable HTML document ──────────────────
  app.get("/api/public/co-branded-proposal/:token/download", async (req, res) => {
    try {
      const proposal = await storage.getCoBrandedProposalByToken(req.params.token);
      if (!proposal) return res.status(404).json({ message: "Proposal not found." });

      const org = await storage.getPartnerOrg(proposal.partnerOrgId!);
      if (!org) return res.status(404).json({ message: "Partner not found." });

      const baseUrl = getBaseUrl(req);
      const pdfBuffer = await generateCoBrandedProposalPdf({
        org,
        merchantName: proposal.merchantName || "Merchant",
        merchantMonthlyVolume: proposal.merchantMonthlyVolume ?? undefined,
        merchantEffectiveRate: proposal.merchantEffectiveRate ?? undefined,
        pricingPlan: proposal.pricingPlan ?? undefined,
        customMessage: proposal.customMessage ?? undefined,
        proposalData: proposal.proposalData,
        token: proposal.token,
        baseUrl,
      });

      const slug = (proposal.merchantName || "merchant").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const fileName = `savings-proposal-${slug}.pdf`;

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      });
      res.send(pdfBuffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
