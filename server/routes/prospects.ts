import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertEnrichmentJobSchema, insertProspectListSchema, insertProspectSchema } from "@shared/schema";
import { enrichProspect, processEnrichmentQueue, runEnrichmentJob } from "../services/enrichment";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { scoreContact } from "../services/lead-scoring";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { getRoutingRecommendation, routeContact } from "../services/smart-router";
import { getEntityDetail, parseSunbizCsv, searchSunbiz, streamCorevtFromZip } from "../services/sunbiz-scraper";
import { isMassEnrichmentRunning, promoteQualifiedToContacts, reEnrichAllSunbizEntities, runMassEnrichment } from "../services/daily-outreach";
import { convertToProspect, deepEnrichEntity, enrichSunbizEntity, isPipelineRunning, processSunbizEnrichmentQueue, runAutoDeduplication, runBulkAIClassification, runDailyEnrichmentPipeline } from "../services/sunbiz-enrichment";
import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { upload, uploadLarge } from "./helpers";

export function registerProspectsRoutes(app: Express) {
  // === PROSPECT LISTS ===
  app.get("/api/prospect-lists", async (req, res) => {
    const lists = await storage.getProspectLists();
    res.json(lists);
  });

  app.get("/api/prospect-lists/:id", async (req, res) => {
    const list = await storage.getProspectList(Number(req.params.id));
    if (!list) return res.status(404).json({ message: "List not found" });
    res.json(list);
  });

  app.post("/api/prospect-lists", async (req, res) => {
    try {
      const input = insertProspectListSchema.parse(req.body);
      const list = await storage.createProspectList(input);
      res.status(201).json(list);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });


  // === PROSPECTS ===
  app.get("/api/prospects", async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const prospects = await storage.getProspects(listId);
    res.json(prospects);
  });

  app.get("/api/prospects/:id", async (req, res) => {
    const prospect = await storage.getProspect(Number(req.params.id));
    if (!prospect) return res.status(404).json({ message: "Prospect not found" });
    res.json(prospect);
  });

  app.post("/api/prospects", async (req, res) => {
    try {
      const input = insertProspectSchema.parse(req.body);
      const prospect = await storage.createProspect(input);
      res.status(201).json(prospect);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/prospects/:id", async (req, res) => {
    const updated = await storage.updateProspect(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  });

  app.post("/api/prospects/:id/convert", isAuthenticated, async (req, res) => {
    try {
      const prospect = await storage.getProspect(Number(req.params.id));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (prospect.contactId) return res.json({ message: "Already converted", contactId: prospect.contactId });

      const contact = await storage.createContact({
        firstName: prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Unknown",
        lastName: prospect.ownerLastName || "",
        email: prospect.email || prospect.ownerEmail || "",
        phone: prospect.phone || prospect.ownerPhone || "",
        companyName: prospect.companyName || "",
        vertical: prospect.vertical || "",
        status: "new",
        notes: "Source: prospect_conversion",
        monthlyVolume: prospect.estimatedVolume || "",
        currentProvider: prospect.estimatedProcessor || "",
      });

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        owner: "Scott Stevenson",
        notes: `Estimated volume: ${prospect.estimatedVolume || "N/A"}`,
      });

      await storage.updateProspect(prospect.id, { contactId: contact.id, status: "converted" });

      scoreContact(contact.id).catch(err => console.error("Scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint error:", err));

      try {
        const { autoEnrollFromTrigger } = await import("../services/sequence-worker");
        await autoEnrollFromTrigger("contact_created", { contactId: contact.id });
      } catch {}

      try {
        const matchingRules = await storage.getMatchingStageRules("sales", null, "New Lead");
        for (const rule of matchingRules) {
          const ruleActions = (rule.actions as any[]) || [];
          for (const action of ruleActions) {
            if (action.type === "create_task") {
              await storage.createTask({
                title: action.title || "Auto: New Lead",
                assignedTo: action.assignedTo || "Scott Stevenson",
                priority: action.priority || "medium",
                dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                dealId: deal.id,
                contactId: contact.id,
              });
            } else if (action.type === "send_notification") {
              await storage.createNotification({
                channel: action.channel || "internal",
                title: action.title || `Stage Automation: ${rule.name}`,
                message: action.message || "New lead entered pipeline",
                type: "info",
              });
            } else if (action.type === "enroll_sequence" && action.sequenceName) {
              const seqs = await storage.getFollowUpSequences();
              const seq = seqs.find((s: any) => s.name === action.sequenceName);
              if (seq) {
                await storage.createSequenceEnrollment({
                  sequenceId: seq.id,
                  contactId: contact.id,
                  dealId: deal.id,
                  status: "active",
                  nextActionAt: new Date(),
                  currentStep: 0,
                });
              }
            }
          }
          await storage.createAuditLog({
            action: "stage_rule_triggered",
            entityType: "deal",
            entityId: deal.id,
            details: { ruleName: rule.name, fromStage: null, toStage: "New Lead", source: "prospect_conversion" },
          });
        }
      } catch (ruleErr) {
        console.error("Stage rule error on conversion:", ruleErr);
      }

      await storage.createAuditLog({
        action: "prospect_converted",
        entityType: "contact",
        entityId: contact.id,
        details: { prospectId: prospect.id, dealId: deal.id, company: prospect.companyName },
      });

      res.json({ contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/prospects/convert-batch", isAuthenticated, async (req, res) => {
    try {
      const { prospectIds } = req.body as { prospectIds: number[] };
      if (!prospectIds?.length) return res.status(400).json({ message: "No prospect IDs provided" });

      const results: Array<{ prospectId: number; contactId: number; dealId: number }> = [];
      for (const pid of prospectIds.slice(0, 50)) {
        const prospect = await storage.getProspect(pid);
        if (!prospect || prospect.contactId) continue;

        const contact = await storage.createContact({
          firstName: prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Unknown",
          lastName: prospect.ownerLastName || "",
          email: prospect.email || prospect.ownerEmail || "",
          phone: prospect.phone || prospect.ownerPhone || "",
          companyName: prospect.companyName || "",
          vertical: prospect.vertical || "",
          status: "new",
          notes: "Source: prospect_conversion",
          monthlyVolume: prospect.estimatedVolume || "",
          currentProvider: prospect.estimatedProcessor || "",
        });

        const deal = await storage.createDeal({
          contactId: contact.id,
          pipeline: "sales",
          stage: "New Lead",
          owner: "Scott Stevenson",
          notes: `Estimated volume: ${prospect.estimatedVolume || "N/A"}`,
        });

        await storage.updateProspect(pid, { contactId: contact.id, status: "converted" });

        scoreContact(contact.id).catch(() => {});
        routeContact(contact.id).catch(() => {});
        generateDealBlueprint(deal.id).catch(() => {});

        results.push({ prospectId: pid, contactId: contact.id, dealId: deal.id });
      }

      try {
        const { autoEnrollFromTrigger } = await import("../services/sequence-worker");
        for (const r of results) {
          await autoEnrollFromTrigger("contact_created", { contactId: r.contactId });
        }
      } catch {}

      try {
        const matchingRules = await storage.getMatchingStageRules("sales", null, "New Lead");
        for (const r of results) {
          for (const rule of matchingRules) {
            const ruleActions = (rule.actions as any[]) || [];
            for (const action of ruleActions) {
              if (action.type === "create_task") {
                await storage.createTask({
                  title: action.title || "Auto: New Lead",
                  assignedTo: action.assignedTo || "Scott Stevenson",
                  priority: action.priority || "medium",
                  dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                  dealId: r.dealId,
                  contactId: r.contactId,
                });
              } else if (action.type === "send_notification") {
                await storage.createNotification({
                  channel: action.channel || "internal",
                  title: action.title || `Stage Automation: ${rule.name}`,
                  message: action.message || "New lead entered pipeline",
                  type: "info",
                });
              } else if (action.type === "enroll_sequence" && action.sequenceName) {
                const seqs = await storage.getFollowUpSequences();
                const seq = seqs.find((s: any) => s.name === action.sequenceName);
                if (seq) {
                  await storage.createSequenceEnrollment({
                    sequenceId: seq.id,
                    contactId: r.contactId,
                    dealId: r.dealId,
                    status: "active",
                    nextActionAt: new Date(),
                    currentStep: 0,
                  });
                }
              }
            }
            await storage.createAuditLog({
              action: "stage_rule_triggered",
              entityType: "deal",
              entityId: r.dealId,
              details: { ruleName: rule.name, fromStage: null, toStage: "New Lead", source: "batch_conversion" },
            });
          }
        }
      } catch (ruleErr) {
        console.error("Stage rule error on batch conversion:", ruleErr);
      }

      res.json({ converted: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // CSV Upload endpoint
  app.post("/api/prospects/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });

      const listName = (req.body.listName as string) || `Import ${new Date().toLocaleDateString()}`;
      const list = await storage.createProspectList({
        name: listName,
        fileName: req.file.originalname || "upload.csv",
        totalRecords: records.length,
      });

      const columnMap: Record<string, string> = {
        "company": "companyName", "company_name": "companyName", "business": "companyName", "business_name": "companyName", "name": "companyName",
        "dba": "dba", "doing_business_as": "dba",
        "email": "email", "email_address": "email", "contact_email": "email",
        "phone": "phone", "phone_number": "phone", "telephone": "phone", "contact_phone": "phone",
        "website": "website", "url": "website", "web": "website",
        "owner_first_name": "ownerFirstName", "first_name": "ownerFirstName", "firstname": "ownerFirstName", "owner_first": "ownerFirstName", "contact_first_name": "ownerFirstName",
        "owner_last_name": "ownerLastName", "last_name": "ownerLastName", "lastname": "ownerLastName", "owner_last": "ownerLastName", "contact_last_name": "ownerLastName",
        "owner_email": "ownerEmail",
        "owner_phone": "ownerPhone",
        "address": "address", "street": "address", "street_address": "address",
        "city": "city",
        "state": "state", "st": "state",
        "zip": "zip", "zipcode": "zip", "zip_code": "zip", "postal": "zip", "postal_code": "zip",
        "vertical": "vertical", "industry": "vertical", "category": "vertical", "type": "vertical",
        "volume": "estimatedVolume", "estimated_volume": "estimatedVolume", "monthly_volume": "estimatedVolume",
        "processor": "estimatedProcessor", "current_processor": "estimatedProcessor",
        "employees": "employeeCount", "employee_count": "employeeCount",
        "year_established": "yearEstablished", "established": "yearEstablished", "year": "yearEstablished",
        "google_rating": "googleRating", "rating": "googleRating",
        "google_reviews": "googleReviews", "reviews": "googleReviews",
      };

      const prospectInserts = (records as Record<string, string>[]).map((row: Record<string, string>) => {
        const mapped: Record<string, any> = { listId: list.id };
        for (const [csvCol, value] of Object.entries(row)) {
          const normalizedCol = csvCol.toLowerCase().trim().replace(/\s+/g, "_");
          const schemaField = columnMap[normalizedCol];
          if (schemaField && value) {
            mapped[schemaField] = value;
          }
        }
        return mapped;
      }).filter((p: Record<string, any>) => p.companyName || p.email || p.phone);

      const created = await storage.createProspectsBulk(prospectInserts);

      await storage.updateProspectList(list.id, {
        totalRecords: created.length,
      });

      res.status(201).json({
        list,
        imported: created.length,
        skipped: records.length - created.length,
      });
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });


  // === ENRICHMENT ===
  app.get("/api/enrichment-jobs", async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const jobs = await storage.getEnrichmentJobs(listId);
    res.json(jobs);
  });

  app.post("/api/enrichment-jobs", async (req, res) => {
    try {
      const input = insertEnrichmentJobSchema.parse(req.body);
      const job = await storage.createEnrichmentJob(input);

      if (input.prospectId) {
        enrichProspect(input.prospectId).catch(console.error);
      } else if (input.listId) {
        const prospects = await storage.getProspects(input.listId);
        await storage.updateEnrichmentJob(job.id, { totalCount: prospects.length });
        runEnrichmentJob(job.id).catch(console.error);
      }

      res.status(201).json(job);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/enrichment/process-queue", async (req, res) => {
    processEnrichmentQueue().catch(console.error);
    res.json({ message: "Enrichment queue processing started" });
  });


  // === SUNBIZ LEAD GEN CLEANER ===
  app.get("/api/sunbiz/entities", isAuthenticated, async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const entities = await storage.getSunbizEntities(listId);
    res.json(entities);
  });

  app.get("/api/sunbiz/entities/:id", isAuthenticated, async (req, res) => {
    const entity = await storage.getSunbizEntity(Number(req.params.id));
    if (!entity) return res.status(404).json({ message: "Entity not found" });
    res.json(entity);
  });

  app.get("/api/sunbiz/stats", isAuthenticated, async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const stats = await storage.getSunbizStats(listId);
    res.json(stats);
  });

  app.post("/api/sunbiz/search", isAuthenticated, async (req, res) => {
    try {
      const { query, entityType } = req.body;
      if (!query) return res.status(400).json({ message: "Search query required" });
      const results = await searchSunbiz(query, entityType);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/import-detail", isAuthenticated, async (req, res) => {
    try {
      const { detailUrl, listId } = req.body;
      if (!detailUrl) return res.status(400).json({ message: "Detail URL required" });
      const detail = await getEntityDetail(detailUrl);
      if (!detail) return res.status(404).json({ message: "Could not fetch entity detail" });

      const existing = detail.filingNumber ? await storage.getSunbizEntityByFiling(detail.filingNumber) : null;
      if (existing) return res.json(existing);

      const entity = await storage.createSunbizEntity({
        entityName: detail.entityName,
        filingNumber: detail.filingNumber || undefined,
        feiEinNumber: detail.feiEinNumber || undefined,
        entityType: detail.entityType || undefined,
        entityStatus: detail.entityStatus || undefined,
        filingDate: detail.filingDate || undefined,
        lastEvent: detail.lastEvent || undefined,
        lastEventDate: detail.lastEventDate || undefined,
        principalAddress: detail.principalAddress || undefined,
        principalCity: detail.principalCity || undefined,
        principalState: detail.principalState || "FL",
        principalZip: detail.principalZip || undefined,
        mailingAddress: detail.mailingAddress || undefined,
        registeredAgentName: detail.registeredAgentName || undefined,
        registeredAgentAddress: detail.registeredAgentAddress || undefined,
        officers: detail.officers.length > 0 ? detail.officers : undefined,
        detailUrl: detail.detailUrl || undefined,
        listId: listId || undefined,
        source: "sunbiz",
        enrichmentStatus: "pending",
      });

      res.json(entity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });

      const listName = req.body.listName || `Sunbiz Import ${new Date().toLocaleDateString()}`;
      const list = await storage.createProspectList({
        name: listName,
        description: `Sunbiz directory upload: ${req.file.originalname}`,
        fileName: req.file.originalname,
        totalRecords: records.length,
        status: "processing",
      });

      const parsed = parseSunbizCsv(records as Record<string, string>[]);
      const entities = parsed.map(p => ({
        entityName: p.entityName || "",
        filingNumber: p.filingNumber || undefined,
        feiEinNumber: p.feiEinNumber || undefined,
        entityType: p.entityType || undefined,
        entityStatus: p.entityStatus || "Active",
        filingDate: p.filingDate || undefined,
        principalAddress: p.principalAddress || undefined,
        principalCity: p.principalCity || undefined,
        principalState: p.principalState || "FL",
        principalZip: p.principalZip || undefined,
        mailingAddress: p.mailingAddress || undefined,
        registeredAgentName: p.registeredAgentName || undefined,
        registeredAgentAddress: p.registeredAgentAddress || undefined,
        officers: p.officers || undefined,
        dba: p.dba || undefined,
        website: p.website || undefined,
        email: p.email || undefined,
        phone: p.phone || undefined,
        detailUrl: p.detailUrl || undefined,
        listId: list.id,
        source: "sunbiz",
        enrichmentStatus: "pending" as const,
        searchQuery: listName,
      }));

      const created = await storage.createSunbizEntitiesBulk(entities);

      await storage.updateProspectList(list.id, {
        totalRecords: created.length,
        status: "ready",
      });

      res.json({ list, imported: created.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/upload-corevt", isAuthenticated, uploadLarge.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path;
      const listName = req.body.listName || `Sunbiz Corevt Import ${new Date().toLocaleDateString()}`;
      const maxRecords = parseInt(req.body.maxRecords) || 10000;
      const onlyWithAddress = req.body.onlyWithAddress === "true";

      const list = await storage.createProspectList({
        name: listName,
        description: `Sunbiz corevt fixed-width upload: ${req.file.originalname}`,
        fileName: req.file.originalname || "corevt.zip",
        totalRecords: 0,
        status: "processing",
      });

      let totalImported = 0;

      try {
        for await (const batch of streamCorevtFromZip(filePath, { maxRecords })) {
          const filtered = onlyWithAddress
            ? batch.filter(e => e.principalAddress || e.principalCity)
            : batch;

          if (filtered.length === 0) continue;

          const entities = filtered.map(p => ({
            entityName: p.entityName || "",
            filingNumber: p.filingNumber || undefined,
            feiEinNumber: p.feiEinNumber || undefined,
            entityType: p.entityType || undefined,
            entityStatus: p.entityStatus || "Active",
            filingDate: p.filingDate || undefined,
            principalAddress: p.principalAddress || undefined,
            principalCity: p.principalCity || undefined,
            principalState: p.principalState || "FL",
            principalZip: p.principalZip || undefined,
            mailingAddress: p.mailingAddress || undefined,
            registeredAgentName: p.registeredAgentName || undefined,
            registeredAgentAddress: p.registeredAgentAddress || undefined,
            officers: p.officers && p.officers.length > 0 ? p.officers : undefined,
            dba: p.dba || undefined,
            website: p.website || undefined,
            email: p.email || undefined,
            phone: p.phone || undefined,
            detailUrl: p.detailUrl || undefined,
            listId: list.id,
            source: "corevt",
            enrichmentStatus: "pending" as const,
            searchQuery: listName,
          }));

          const created = await storage.createSunbizEntitiesBulk(entities);
          totalImported += created.length;
        }
      } finally {
        try { fs.unlinkSync(filePath); } catch {}
      }

      await storage.updateProspectList(list.id, {
        totalRecords: totalImported,
        status: "ready",
      });

      res.json({ list: { ...list, totalRecords: totalImported }, imported: totalImported });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/entities/:id/enrich", isAuthenticated, async (req, res) => {
    try {
      const result = await enrichSunbizEntity(Number(req.params.id));
      if (!result) return res.status(404).json({ message: "Entity not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/enrich-batch", isAuthenticated, async (req, res) => {
    try {
      const limit = req.body.limit || 10;
      const processed = await processSunbizEnrichmentQueue(limit);
      res.json({ processed });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/entities/:id/convert", isAuthenticated, async (req, res) => {
    try {
      const prospectId = await convertToProspect(Number(req.params.id), req.body.listId);
      if (!prospectId) return res.status(404).json({ message: "Entity not found" });
      res.json({ prospectId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/convert-batch", isAuthenticated, async (req, res) => {
    try {
      const { entityIds, listId } = req.body;
      if (!entityIds || !Array.isArray(entityIds)) return res.status(400).json({ message: "entityIds array required" });
      const results: number[] = [];
      for (const id of entityIds) {
        const prospectId = await convertToProspect(id, listId);
        if (prospectId) results.push(prospectId);
      }
      res.json({ converted: results.length, prospectIds: results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sunbiz/entities/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateSunbizEntity(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Entity not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sunbiz/export", isAuthenticated, async (req, res) => {
    try {
      const listId = req.query.listId ? Number(req.query.listId) : undefined;
      const entities = await storage.getSunbizEntities(listId);
      const enrichedOnly = req.query.enrichedOnly === "true";
      const filtered = enrichedOnly ? entities.filter(e => e.enrichmentStatus === "enriched") : entities;

      const headers = ["Entity Name", "DBA", "Filing Number", "Entity Type", "Status", "Filing Date", "Principal Address", "City", "State", "Zip", "Owner Name", "Owner Email", "Owner Phone", "Website", "Email", "Phone", "Vertical", "Score", "AI Summary", "Officers"];
      const csvRows = [headers.join(",")];
      for (const e of filtered) {
        const officers = (e.officers as any[]) || [];
        const officerStr = officers.map((o: any) => `${o.title}: ${o.name}`).join("; ");
        csvRows.push([
          `"${(e.entityName || "").replace(/"/g, '""')}"`,
          `"${(e.dba || "").replace(/"/g, '""')}"`,
          e.filingNumber || "",
          e.entityType || "",
          e.entityStatus || "",
          e.filingDate || "",
          `"${(e.principalAddress || "").replace(/"/g, '""')}"`,
          e.principalCity || "",
          e.principalState || "",
          e.principalZip || "",
          `"${(e.ownerName || "").replace(/"/g, '""')}"`,
          e.ownerEmail || "",
          e.ownerPhone || "",
          e.website || "",
          e.email || "",
          e.phone || "",
          e.vertical || "",
          e.score || "",
          `"${(e.aiSummary || "").replace(/"/g, '""')}"`,
          `"${officerStr.replace(/"/g, '""')}"`,
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="sunbiz-leads-${Date.now()}.csv"`);
      res.send(csvRows.join("\n"));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === LEAD INTELLIGENCE ENGINE ===
  app.post("/api/lead-intelligence/score/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const breakdown = await scoreContact(contactId);
      if (!breakdown) return res.status(404).json({ message: "Contact not found" });
      res.json(breakdown);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/score/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contact = await storage.getContact(Number(req.params.contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      res.json({
        leadScore: contact.leadScore || 0,
        revPotentialScore: contact.revPotentialScore || 0,
        switchabilityScore: contact.switchabilityScore || 0,
        uwConfidenceScore: contact.uwConfidenceScore || 0,
        engagementScore: contact.engagementScore || 0,
        scoreBreakdown: contact.scoreBreakdown || null,
        lastScoredAt: contact.lastScoredAt,
        tier: (contact.leadScore || 0) >= 70 ? "hot" : (contact.leadScore || 0) >= 45 ? "warm" : (contact.leadScore || 0) >= 20 ? "cold" : "unqualified",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/blueprint/:dealId", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const blueprint = await generateDealBlueprint(dealId);
      if (!blueprint) return res.status(404).json({ message: "Deal not found or blueprint generation failed" });
      res.json(blueprint);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/blueprint/:dealId", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      res.json({
        dealBlueprint: deal.dealBlueprint,
        recommendedProgram: deal.recommendedProgram,
        hardwarePackage: deal.hardwarePackage,
        estMonthlyRevenue: deal.estMonthlyRevenue,
        underwritingPath: deal.underwritingPath,
        competitivePositioning: deal.competitivePositioning,
        repBriefing: deal.repBriefing,
        repOpener: deal.repOpener,
        likelyObjections: deal.likelyObjections,
        blueprintGeneratedAt: deal.blueprintGeneratedAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/route/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const result = await routeContact(contactId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/routing/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const recommendation = await getRoutingRecommendation(contactId);
      res.json(recommendation);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/doc-readiness/:dealId", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const docs = {
        statementReceived: deal.statementReceived || false,
        voidedCheckReceived: deal.voidedCheckReceived || false,
        idReceived: deal.idReceived || false,
        appCompleted: deal.appCompleted || false,
      };
      const completed = Object.values(docs).filter(Boolean).length;
      const total = 4;

      let stage = "Lead";
      if (completed >= 4) stage = "Submit to Processor";
      else if (completed >= 3) stage = "Underwriting Ready";
      else if (completed >= 2) stage = "Proposal Stage";
      else if (completed >= 1) stage = "Qualified";

      const missing: string[] = [];
      if (!docs.statementReceived) missing.push("Processing Statement");
      if (!docs.appCompleted) missing.push("Merchant Application");
      if (!docs.voidedCheckReceived) missing.push("Voided Check");
      if (!docs.idReceived) missing.push("Owner ID");

      res.json({
        ...docs,
        docReadinessScore: completed,
        docReadinessMax: total,
        docReadinessPercent: Math.round((completed / total) * 100),
        readinessStage: stage,
        missing,
        lastNudgeAt: deal.lastNudgeAt,
        nextNudgeAt: deal.nextNudgeAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/full/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const contactDeals = await storage.getDealsByContact(contactId);
      const primaryDeal = contactDeals[0] || null;

      const scoring = {
        leadScore: contact.leadScore || 0,
        revPotentialScore: contact.revPotentialScore || 0,
        switchabilityScore: contact.switchabilityScore || 0,
        uwConfidenceScore: contact.uwConfidenceScore || 0,
        engagementScore: contact.engagementScore || 0,
        scoreBreakdown: typeof contact.scoreBreakdown === 'object' && contact.scoreBreakdown
          ? (contact.scoreBreakdown as any).summary || JSON.stringify(contact.scoreBreakdown)
          : contact.scoreBreakdown || "",
        lastScoredAt: contact.lastScoredAt,
        tier: (contact.leadScore || 0) >= 70 ? "hot" : (contact.leadScore || 0) >= 45 ? "warm" : (contact.leadScore || 0) >= 20 ? "cold" : "unqualified",
      };

      let blueprint = null;
      let docReadiness = null;

      if (primaryDeal) {
        blueprint = {
          dealId: primaryDeal.id,
          recommendedProgram: primaryDeal.recommendedProgram,
          hardwarePackage: primaryDeal.hardwarePackage,
          estMonthlyRevenue: primaryDeal.estMonthlyRevenue,
          underwritingPath: primaryDeal.underwritingPath,
          competitivePositioning: primaryDeal.competitivePositioning,
          repBriefing: primaryDeal.repBriefing,
          repOpener: primaryDeal.repOpener,
          likelyObjections: primaryDeal.likelyObjections,
          blueprintGeneratedAt: primaryDeal.blueprintGeneratedAt,
        };

        const docs = {
          statementReceived: primaryDeal.statementReceived || false,
          voidedCheckReceived: primaryDeal.voidedCheckReceived || false,
          idReceived: primaryDeal.idReceived || false,
          appCompleted: primaryDeal.appCompleted || false,
        };
        const completed = Object.values(docs).filter(Boolean).length;
        const missing: string[] = [];
        if (!docs.statementReceived) missing.push("Processing Statement");
        if (!docs.appCompleted) missing.push("Merchant Application");
        if (!docs.voidedCheckReceived) missing.push("Voided Check");
        if (!docs.idReceived) missing.push("Owner ID");

        docReadiness = {
          ...docs,
          score: completed,
          max: 4,
          percent: Math.round((completed / 4) * 100),
          missing,
        };
      }

      const routingRec = await getRoutingRecommendation(contactId);

      const complianceStatus = {
        doNotContact: contact.doNotContact || false,
        consentSms: contact.consentSms || false,
        consentEmail: contact.consentEmail || false,
        smsOptInAt: contact.smsOptInAt,
        coolingUntil: contact.coolingUntil,
        contactAttempts: contact.contactAttempts || 0,
        dncReason: contact.dncReason,
      };

      res.json({
        contact: {
          id: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          company: contact.companyName,
          vertical: contact.vertical,
          monthlyVolume: contact.monthlyVolume,
          currentProvider: contact.currentProvider,
          painPoints: contact.painPoints,
          contractStatus: contact.contractStatus,
          lookingReason: contact.lookingReason,
          referralSource: contact.referralSource,
        },
        scoring,
        blueprint,
        docReadiness,
        routing: routingRec,
        compliance: complianceStatus,
        deal: primaryDeal ? {
          id: primaryDeal.id,
          stage: primaryDeal.stage,
          pipeline: primaryDeal.pipeline,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/score-batch", isAuthenticated, async (req, res) => {
    try {
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds)) return res.status(400).json({ message: "contactIds array required" });
      let scored = 0;
      for (const id of contactIds.slice(0, 50)) {
        try {
          await scoreContact(id);
          scored++;
        } catch (e) {}
      }
      res.json({ scored, total: contactIds.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === BATCH RE-ENRICHMENT & CLASSIFICATION ===
  app.post("/api/sunbiz/re-enrich-all", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const limit = Number(req.body?.limit) || 200;
    res.json({ message: `Re-enrichment started for up to ${limit} entities.`, started: true });
    reEnrichAllSunbizEntities(limit).catch(err => console.error("[Re-Enrich API] Error:", err));
  });

  app.get("/api/sunbiz/enrichment-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("enrichment_progress");
    res.json(progress || { status: "idle" });
  });

  app.post("/api/sunbiz/mass-enrich", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    if (isMassEnrichmentRunning()) return res.status(409).json({ message: "Mass enrichment is already running" });
    const limit = Number(req.body?.limit) || 2000;
    res.json({ message: `Mass enrichment started for up to ${limit} hot/warm entities.`, started: true });
    runMassEnrichment(limit).catch(err => console.error("[Mass Enrich API] Error:", err));
  });

  app.get("/api/sunbiz/mass-enrich-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("mass_enrichment_progress");
    res.json({ progress: progress || { status: "idle" }, running: isMassEnrichmentRunning() });
  });

  app.post("/api/sunbiz/promote-qualified", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const result = await promoteQualifiedToContacts();
    res.json(result);
  });

  app.post("/api/sunbiz/bulk-ai-classify", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const limit = Number(req.body?.limit) || 5000;
    res.json({ message: `AI classification started for up to ${limit} entities.`, started: true });
    runBulkAIClassification(limit).catch(err => console.error("[AI Classify API] Error:", err));
  });

  app.get("/api/sunbiz/ai-classify-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("ai_classify_progress");
    res.json({ progress: progress || { status: "idle" } });
  });

  app.post("/api/sunbiz/run-pipeline", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    if (isPipelineRunning()) return res.status(409).json({ message: "Pipeline is already running" });
    const classifyLimit = req.body?.classifyLimit !== undefined ? Number(req.body.classifyLimit) : 5000;
    const enrichLimit = req.body?.enrichLimit !== undefined ? Number(req.body.enrichLimit) : 1000;
    res.json({ message: `Full pipeline started: classify ${classifyLimit}, enrich ${enrichLimit}.`, started: true });
    runDailyEnrichmentPipeline({ classifyLimit, enrichLimit }).catch(err => console.error("[Pipeline API] Error:", err));
  });

  app.get("/api/sunbiz/pipeline-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("daily_pipeline_progress");
    res.json({ progress: progress || { status: "idle" }, running: isPipelineRunning() });
  });

  app.post("/api/sunbiz/deep-enrich/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const result = await deepEnrichEntity(Number(req.params.id));
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Enrichment failed" });
    }
  });

  app.post("/api/sunbiz/deduplicate", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const limit = Number(req.body?.limit) || 500;
    const result = await runAutoDeduplication(limit);
    res.json({ message: `Deduplication complete: checked ${result.checked} groups, merged ${result.merged} records.`, ...result });
  });

  app.get("/api/sunbiz/enrichment-dashboard", isAuthenticated, async (req, res) => {
    try {
      const dashboard = await storage.getSunbizEnrichmentDashboard();
      const pipelineProgress = await storage.getSystemSetting("daily_pipeline_progress");
      res.json({
        ...dashboard,
        pipeline: { progress: pipelineProgress || { status: "idle" }, running: isPipelineRunning() },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch dashboard" });
    }
  });

  app.get("/api/sunbiz/verticals", isAuthenticated, async (req, res) => {
    try {
      const dashboard = await storage.getSunbizEnrichmentDashboard();
      const verticals = Object.entries(dashboard.verticals)
        .filter(([name]) => name !== "Unclassified" && name !== "Other")
        .map(([name, data]: [string, any]) => ({
          name,
          total: data.total,
          withContact: data.withContact,
          contactRate: data.total > 0 ? Math.round((data.withContact / data.total) * 100) : 0,
        }))
        .sort((a, b) => b.withContact - a.withContact);
      res.json({ verticals, totalClassified: dashboard.classified, readyForOutreach: dashboard.readyForOutreach });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch verticals" });
    }
  });

}
