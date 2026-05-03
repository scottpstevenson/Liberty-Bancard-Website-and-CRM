import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertCollateralPacketSchema, insertDocumentSchema, insertKnowledgeBaseSchema } from "@shared/schema";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { advanceDealStage } from "../services/deal-stage-service";
import { autoGenerateProposal } from "../services/proposal-engine";
import path from "path";
import fs from "fs";
import { upload } from "./helpers";

export function registerDocumentsRoutes(app: Express) {
  // === MERCHANT DOCUMENT VAULT ===

  // Helper: check if a user can access a contact's documents
  // Admin and manager roles always have access; reps only if they own the contact.
  async function canAccessContactDocs(user: any, contactId: number | null): Promise<boolean> {
    const role = user?.role;
    if (!role) return false;
    if (['admin', 'manager'].includes(role)) return true;
    if (!contactId) return false;
    const contact = await storage.getContact(contactId);
    if (!contact) return false;
    const userDisplay = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return (
      contact.assignedTo === user.email ||
      (!!userDisplay && contact.assignedTo === userDisplay)
    );
  }

  // GET /api/merchant-documents - admin/manager index of all documents
  app.get("/api/merchant-documents", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (!['admin', 'manager'].includes(user?.role)) {
        return res.status(403).json({ message: "Admin/Manager only" });
      }
      const allDocs = await storage.getDocuments();
      const category = req.query.category as string | undefined;
      const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;

      let docs = allDocs;
      if (category && category !== "all") {
        docs = docs.filter(d => d.category === category);
      }
      if (contactId) {
        docs = docs.filter(d => d.contactId === contactId);
      }
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/merchant-documents/contact/:contactId - get docs for a specific merchant
  app.get("/api/merchant-documents/contact/:contactId", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const cid = Number(req.params.contactId);
      if (!await canAccessContactDocs(user, cid)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const docs = await storage.getDocumentsByContact(cid);
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/merchant-documents/upload - upload a document to a merchant record
  app.post("/api/merchant-documents/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user as any;
      const { category, contactId, dealId } = req.body;

      // Verify the user can access this contact before uploading
      if (contactId && !await canAccessContactDocs(user, Number(contactId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const timestamp = Date.now();
      const safeFileName = `${timestamp}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageKey = `merchant_docs/${safeFileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads", "merchant_docs");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, safeFileName), req.file.buffer);

      const uploadedBy = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown" : "Unknown";

      const doc = await storage.createDocument({
        contactId: contactId ? Number(contactId) : null,
        dealId: dealId ? Number(dealId) : null,
        type: category || "Other",
        category: category || "Other",
        fileName,
        fileSize,
        mimeType,
        uploadedBy,
        storageKey,
        accessScope: "internal",
      });

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/merchant-documents/:id/download - download a document
  app.get("/api/merchant-documents/:id/download", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const doc = await storage.getDocumentById(Number(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!await canAccessContactDocs(user, doc.contactId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (doc.storageKey) {
        // Try to find the file by storageKey
        const uploadsDir = path.join(process.cwd(), "uploads");
        const relativePath = doc.storageKey.replace(/^uploads\//, "");
        const filePath = path.join(uploadsDir, relativePath);

        if (fs.existsSync(filePath)) {
          return res.download(filePath, doc.fileName);
        }

        // Fallback: search in merchant_docs subdir
        const merchantDocPath = path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey));
        if (fs.existsSync(merchantDocPath)) {
          return res.download(merchantDocPath, doc.fileName);
        }

        // Search entire uploads dir for matching file
        const allFiles = fs.readdirSync(uploadsDir);
        const match = allFiles.find(f => doc.storageKey?.includes(f) || f.includes(path.basename(doc.storageKey || "")));
        if (match) {
          return res.download(path.join(uploadsDir, match), doc.fileName);
        }
      }

      return res.status(404).json({ message: "File not found on disk" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/merchant-documents/:id - delete a document
  app.delete("/api/merchant-documents/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const doc = await storage.getDocumentById(Number(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!await canAccessContactDocs(user, doc.contactId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Try to delete file from disk
      if (doc.storageKey) {
        const uploadsDir = path.join(process.cwd(), "uploads");

        const tryPaths = [
          path.join(uploadsDir, doc.storageKey.replace(/^uploads\//, "")),
          path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey)),
          path.join(uploadsDir, path.basename(doc.storageKey)),
        ];

        for (const p of tryPaths) {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            break;
          }
        }
      }

      await storage.deleteDocument(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === LEGACY DOCUMENTS (kept for backward compatibility) ===
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

      const categoryMap: Record<string, string> = {
        merchant_statement: "Processing Statement",
        voided_check: "Voided Check",
        government_id: "Photo ID",
        application: "Application",
      };

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
        category: categoryMap[docType] || "Other",
        fileName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email : undefined,
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
        metadata: { contactId: uploaderContactId || undefined, dealId: associatedDealId || dealId || undefined, entityType: dealId ? "deal" : "contact", entityId: dealId || uploaderContactId || undefined },
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
              await advanceDealStage(deal.id, "Underwriting Submitted", "document_auto_advance");
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
