import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { insertCollateralPacketSchema, insertDocumentSchema, insertKnowledgeBaseSchema } from "@shared/schema";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { autoGenerateProposal } from "../services/proposal-engine";
import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { upload } from "./helpers";

export function registerDocumentsRoutes(app: Express) {
  // === DOCUMENTS ===
  app.get("/api/documents", isAuthenticated, async (req, res) => {
    const documents = await storage.getDocuments();
    res.json(documents);
  });

  app.post("/api/documents", isAuthenticated, async (req, res) => {
    try {
      const input = insertDocumentSchema.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/documents/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { type, contactId, dealId, accessScope } = req.body;
      const fileName = req.file.originalname;
      const storageKey = `uploads/${Date.now()}_${fileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const doc = await storage.createDocument({
        contactId: contactId ? Number(contactId) : null,
        dealId: dealId ? Number(dealId) : null,
        type: type || "general",
        fileName,
        storageKey,
        accessScope: accessScope || "internal",
      });

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/documents/download/:id", isAuthenticated, async (req, res) => {
    try {
      const docs = await storage.getDocuments();
      const doc = docs.find(d => d.id === Number(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });

      const uploadsDir = path.join(process.cwd(), "uploads");
      const files = fs.readdirSync(uploadsDir);
      const matchingFile = files.find(f => doc.storageKey?.includes(f) || f.includes(doc.fileName));

      if (matchingFile) {
        res.download(path.join(uploadsDir, matchingFile), doc.fileName);
      } else {
        res.status(404).json({ message: "File not found on disk" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/documents/contact/:contactId", isAuthenticated, async (req, res) => {
    const docs = await storage.getDocuments();
    const contactDocs = docs.filter(d => d.contactId === Number(req.params.contactId));
    res.json(contactDocs);
  });

  app.post("/api/merchant-portal/upload-statement", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user as any;
      const fileName = req.file.originalname;
      const fileNameLower = fileName.toLowerCase();
      const storageKey = `statements/${Date.now()}_${fileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const explicitDocType = req.body?.docType;
      const validDocTypes = ["merchant_statement", "voided_check", "government_id", "application"];
      let docType: string;

      if (explicitDocType && validDocTypes.includes(explicitDocType)) {
        docType = explicitDocType;
      } else {
        docType = "merchant_statement";
        if (/\bvoid(ed)?\b/.test(fileNameLower) || /\bcheck\b/.test(fileNameLower) || /\bbank\b/.test(fileNameLower)) {
          docType = "voided_check";
        } else if (/\blicense\b/.test(fileNameLower) || /\bpassport\b/.test(fileNameLower) || /\bgov(ernment)?[_-]?id\b/.test(fileNameLower) || /\bphoto[_-]?id\b/.test(fileNameLower) || /\bdriver/i.test(fileNameLower)) {
          docType = "government_id";
        } else if (/\bapplication\b/.test(fileNameLower)) {
          docType = "application";
        }
      }

      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      const uploaderContact = allContacts.find((c: any) => c.userId === user.id || c.email === user.email);
      const uploaderContactId = uploaderContact?.id || null;

      const targetDealId = req.body?.dealId ? Number(req.body.dealId) : null;
      let associatedDealId: number | null = null;
      let dealId: number | undefined;
      if (uploaderContact) {
        const { data: allDeals } = await storage.getDeals({ limit: 500 });
        if (targetDealId) {
          const matchingDeal = allDeals.find(d => d.id === targetDealId && d.contactId === uploaderContact.id);
          if (matchingDeal) associatedDealId = matchingDeal.id;
        }
        const existingDeal = allDeals.find(d => d.contactId === uploaderContact.id);
        if (existingDeal) {
          dealId = existingDeal.id;
        } else {
          const newDeal = await storage.createDeal({
            contactId: uploaderContact.id,
            pipeline: "sales",
            stage: "Statement Received",
            notes: `Statement uploaded via merchant portal: ${fileName}`,
            leadSource: "merchant_portal",
          });
          dealId = newDeal.id;
        }
      }

      const doc = await storage.createDocument({
        type: docType,
        fileName,
        storageKey,
        accessScope: "merchant",
        contactId: uploaderContactId,
        dealId: associatedDealId || dealId,
      });

      await storage.createNotification({
        channel: "internal",
        title: "New Document Uploaded",
        message: `${user.firstName} ${user.lastName} uploaded: ${fileName} (${docType})`,
        type: "info",
      });

      if (dealId) {
        await storage.updateDeal(dealId, { statementReceived: true });
        generateDealBlueprint(dealId).catch(err => console.error("Blueprint generation error:", err));
        const uploadedBuffer = req.file?.buffer;
        autoGenerateProposal(dealId, uploadedBuffer).catch(err => console.error("Auto-proposal error:", err));
      }

      if (uploaderContactId) {
        const { data: allDeals } = await storage.getDeals({ limit: 500 });
        const merchantDeals = allDeals.filter(
          d => d.pipeline === "onboarding" &&
            d.contactId === uploaderContactId &&
            !["Active (30 Days)", "Active (7 Days)"].includes(d.stage)
        );

        const allDocs = await storage.getDocuments();

        const dealsToUpdate = associatedDealId
          ? merchantDeals.filter(d => d.id === associatedDealId)
          : merchantDeals.length === 1
            ? merchantDeals
            : [];

        for (const deal of dealsToUpdate) {
          const dealDocs = allDocs.filter(
            (d: any) =>
              (d.dealId === deal.id) ||
              (d.contactId === uploaderContactId && !d.dealId)
          );

          const hasStatement = deal.statementReceived || dealDocs.some(d => d.type === "merchant_statement");
          const hasVoidedCheck = deal.voidedCheckReceived || dealDocs.some(d => d.type === "voided_check");
          const hasId = deal.idReceived || dealDocs.some(d => d.type === "government_id");

          const docUpdates: Record<string, any> = {};
          if (hasStatement && !deal.statementReceived) docUpdates.statementReceived = true;
          if (hasVoidedCheck && !deal.voidedCheckReceived) docUpdates.voidedCheckReceived = true;
          if (hasId && !deal.idReceived) docUpdates.idReceived = true;

          const totalDocs = [hasStatement, hasVoidedCheck, hasId].filter(Boolean).length;
          docUpdates.docReadinessScore = Math.round((totalDocs / 3) * 100);

          if (Object.keys(docUpdates).length > 0) {
            await storage.updateDeal(deal.id, docUpdates);
          }

          if (hasStatement && hasVoidedCheck && hasId && deal.appCompleted) {
            if (deal.stage === "Contract Sent" || deal.stage === "Application Started") {
              await storage.updateDeal(deal.id, { stage: "Underwriting Submitted" });
              await storage.createNotification({
                channel: "internal",
                title: "Auto-Advanced to Underwriting",
                message: `Deal #${deal.id} auto-advanced to Underwriting - all documents collected and application complete.`,
                type: "success",
              });
              await storage.createAuditLog({
                action: "auto_advance_underwriting",
                entityType: "deal",
                entityId: deal.id,
                details: { reason: "All documents collected and application complete", docReadinessScore: 100 },
              });

              const steps = await storage.getOnboardingStepsByDeal(deal.id);
              const docsStep = steps.find(s => s.stepName === "Documents Collected");
              if (docsStep && docsStep.status !== "completed") {
                await storage.updateOnboardingStep(docsStep.id, { status: "completed", completedAt: new Date() });
              }
              const uwStep = steps.find(s => s.stepName === "Underwriting Review");
              if (uwStep && uwStep.status === "pending") {
                await storage.updateOnboardingStep(uwStep.id, { status: "in_progress" });
              }
            }
          }
        }
      }

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === COLLATERAL PACKETS ===
  app.get("/api/collateral-packets", isAuthenticated, async (req, res) => {
    const packets = await storage.getCollateralPackets();
    res.json(packets);
  });

  app.post("/api/collateral-packets", isAuthenticated, async (req, res) => {
    try {
      const input = insertCollateralPacketSchema.parse(req.body);
      const packet = await storage.createCollateralPacket(input);
      res.status(201).json(packet);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });


  // === KNOWLEDGE BASE ===
  app.get("/api/knowledge-base", isAuthenticated, async (req, res) => {
    try {
      const articles = await storage.getPublishedArticles();
      res.json(articles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/knowledge-base/category/:category", isAuthenticated, async (req, res) => {
    try {
      const articles = await storage.getKnowledgeBaseByCategory(req.params.category);
      res.json(articles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/knowledge-base/:id", isAuthenticated, async (req, res) => {
    try {
      const article = await storage.getKnowledgeBaseArticle(Number(req.params.id));
      if (!article) return res.status(404).json({ message: "Not found" });
      res.json(article);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/knowledge-base", isAuthenticated, async (req, res) => {
    try {
      const input = insertKnowledgeBaseSchema.parse(req.body);
      const article = await storage.createKnowledgeBaseArticle(input);
      res.status(201).json(article);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/knowledge-base/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateKnowledgeBaseArticle(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}
