import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertEntityRelationshipSchema } from "@shared/schema";
import {
  extractRelationshipsForContact,
  scanApplicationRisk,
  propagateRiskFlagToRelatedEntities,
} from "../services/relationship-extractor";

export function registerRelationshipsRoutes(app: Express) {
  app.get("/api/contacts/:id/relationships", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const relationships = await storage.getEntityRelationships("contact", contactId);
      const enriched = await Promise.all(
        relationships.map(async (rel) => {
          const isSource = rel.sourceEntityType === "contact" && rel.sourceEntityId === contactId;
          const counterpartyType = isSource ? rel.targetEntityType : rel.sourceEntityType;
          const counterpartyId = isSource ? rel.targetEntityId : rel.sourceEntityId;

          let targetName = `${counterpartyType} #${counterpartyId}`;
          let targetUrl: string | null = null;

          if (counterpartyType === "contact") {
            const contact = await storage.getContact(counterpartyId).catch(() => null);
            if (contact) {
              targetName = `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""}`;
              targetUrl = `/dashboard/contacts/${contact.id}`;
            }
          } else if (counterpartyType === "company") {
            const companies = await storage.getCompanies().catch(() => []);
            const company = companies.find((c) => c.id === counterpartyId);
            if (company) {
              targetName = company.legalName;
            }
          } else if (counterpartyType === "deal") {
            const deal = await storage.getDeal(counterpartyId).catch(() => null);
            if (deal) {
              targetName = `Deal #${deal.id} — ${deal.stage}`;
              targetUrl = `/dashboard/deals/${deal.id}`;
            }
          }

          return {
            ...rel,
            targetEntityType: counterpartyType,
            targetEntityId: counterpartyId,
            targetName,
            targetUrl,
          };
        }),
      );
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/relationships/scan", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      await extractRelationshipsForContact(contactId);
      const relationships = await storage.getEntityRelationships("contact", contactId);
      res.json({ message: "Relationship scan complete", count: relationships.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/relationships/risk-scan", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const result = await scanApplicationRisk(contactId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/relationships", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = insertEntityRelationshipSchema.extend({
        note: z.string().optional(),
      });
      const input = schema.parse(req.body);
      const rel = await storage.createEntityRelationship({ ...input, source: "manual" });
      res.status(201).json(rel);
    } catch (err: any) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/relationships/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const relId = Number(req.params.id);
      const { reason } = req.body ?? {};
      await storage.dismissEntityRelationship(relId, (req.user as any)?.username || "admin", reason);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/relationships/propagate-risk", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const { riskReason } = req.body ?? {};
      if (!riskReason) return res.status(400).json({ message: "riskReason is required" });
      const count = await propagateRiskFlagToRelatedEntities(contactId, riskReason);
      res.json({ success: true, flaggedRelationships: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/relationships/graph/:entityType/:entityId", isDashboardUser, async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const id = Number(entityId);

      const rels = await storage.getEntityRelationships(entityType as any, id);

      const nodes: Array<{ id: string; label: string; type: string; riskFlag?: boolean }> = [
        { id: `${entityType}_${id}`, label: "This Contact", type: entityType },
      ];
      const edges: Array<{
        source: string;
        target: string;
        label: string;
        riskFlag?: boolean;
        confidence?: number;
      }> = [];

      const seenNodes = new Set<string>([`${entityType}_${id}`]);

      for (const rel of rels) {
        if (rel.dismissedAt) continue;
        const isSource = rel.sourceEntityType === entityType && rel.sourceEntityId === id;
        const counterpartyType = isSource ? rel.targetEntityType : rel.sourceEntityType;
        const counterpartyId = isSource ? rel.targetEntityId : rel.sourceEntityId;
        const counterpartyKey = `${counterpartyType}_${counterpartyId}`;

        if (!seenNodes.has(counterpartyKey)) {
          let label = `${counterpartyType} #${counterpartyId}`;
          if (counterpartyType === "contact") {
            const contact = await storage.getContact(counterpartyId).catch(() => null);
            if (contact) {
              label = `${contact.firstName} ${contact.lastName}`;
            }
          } else if (counterpartyType === "company") {
            const company = await storage.getCompany(counterpartyId).catch(() => null);
            if (company) {
              label = company.legalName;
            }
          } else if (counterpartyType === "mid") {
            const deal = await storage.getDeal(counterpartyId).catch(() => null);
            if (deal) {
              label = deal.mid ? `MID: ${deal.mid}` : `Deal #${counterpartyId}`;
            }
          } else if (counterpartyType === "iso_partner") {
            const partner = await storage.getPartner(counterpartyId).catch(() => null);
            if (partner) {
              label = partner.companyName;
            }
          }
          nodes.push({
            id: counterpartyKey,
            label,
            type: counterpartyType,
            riskFlag: rel.riskFlag ?? false,
          });
          seenNodes.add(counterpartyKey);
        }

        edges.push({
          source: `${entityType}_${id}`,
          target: counterpartyKey,
          label: rel.relationshipType.replace(/_/g, " "),
          riskFlag: rel.riskFlag ?? false,
          confidence: rel.confidence ?? 1,
        });
      }

      res.json({ nodes, edges });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
