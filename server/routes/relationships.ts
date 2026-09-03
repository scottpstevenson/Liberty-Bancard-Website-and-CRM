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
import { serverError } from "../utils/server-error";
import { authorizeContactAccess, authorizeDealAccess, authorizeBusinessAccess } from "../services/crm-object-access";

type RelationshipEndpoint = { entityType: string; entityId: number };

/**
 * Relationship rows are not an access grant.  In particular, a relationship
 * discovered from an accessible contact must not disclose a second contact (or
 * its ID) which is outside the caller's CRM scope.
 */
async function authorizeRelationshipEndpoint(req: any, res: any, endpoint: RelationshipEndpoint): Promise<boolean> {
  if (!Number.isInteger(endpoint.entityId) || endpoint.entityId <= 0) {
    res.status(404).json({ message: "Not found", code: "CRM_OBJECT_NOT_FOUND" });
    return false;
  }
  if (["admin", "manager"].includes((req.user as any)?.role)) {
    if (await canScopeRelationshipCounterparty(req, endpoint)) return true;
    res.status(404).json({ message: "Not found", code: "CRM_OBJECT_NOT_FOUND" });
    return false;
  }
  if (endpoint.entityType === "contact") return Boolean(await authorizeContactAccess(req, res, endpoint.entityId));
  if (endpoint.entityType === "deal" || endpoint.entityType === "mid") return Boolean(await authorizeDealAccess(req, res, endpoint.entityId));
  // The route itself is admin/manager-only for writes.  These relationship
  // endpoint types do not have an agent object-access authority, so never make
  // them visible to agents through a graph expansion.
  return ["admin", "manager"].includes((req.user as any)?.role);
}

async function canScopeRelationshipCounterparty(req: any, endpoint: RelationshipEndpoint): Promise<boolean> {
  const user = req.user as { role?: string; email?: string | null } | undefined;
  if (!Number.isInteger(endpoint.entityId) || endpoint.entityId <= 0) return false;
  // Existence is part of scope: do not turn a dangling historical edge into an
  // ID-bearing response, even for a privileged dashboard user.
  if (user?.role === "admin" || user?.role === "manager") {
    if (endpoint.entityType === "contact") return Boolean(await storage.getContact(endpoint.entityId).catch(() => undefined));
    if (endpoint.entityType === "deal" || endpoint.entityType === "mid") return Boolean(await storage.getDeal(endpoint.entityId).catch(() => undefined));
    if (endpoint.entityType === "company") return Boolean(await storage.getCompany(endpoint.entityId).catch(() => undefined));
    if (endpoint.entityType === "partner" || endpoint.entityType === "iso_partner") return Boolean(await storage.getPartner(endpoint.entityId).catch(() => undefined));
    return false;
  }
  if (user?.role !== "agent" || !user.email) return false;
  if (endpoint.entityType === "contact") {
    const contact = await storage.getContact(endpoint.entityId).catch(() => undefined);
    return Boolean(contact && (contact.assignedTo === null || contact.assignedTo === user.email));
  }
  if (endpoint.entityType === "deal" || endpoint.entityType === "mid") {
    const deal = await storage.getDeal(endpoint.entityId).catch(() => undefined);
    return Boolean(deal && !deal.archivedAt && (deal.owner === null || deal.owner === user.email));
  }
  return false;
}

function canExposeRelationshipToDashboardUser(req: any, endpoint: RelationshipEndpoint): boolean {
  // entity_relationships is candidate/heuristic evidence, not the reviewed
  // CRO-02 relationship projection. General dashboard roles receive no raw
  // candidate graph nodes, labels, IDs, notes, or risk reasons.
  void endpoint;
  return ["admin", "manager"].includes((req.user as any)?.role);
}

export function registerRelationshipsRoutes(app: Express) {
  app.get("/api/contacts/:id/relationships", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (!await authorizeContactAccess(req, res, contactId)) return;
      const relationships = await storage.getEntityRelationships("contact", contactId);
      const enriched = await Promise.all(
        relationships.map(async (rel) => {
          const isSource = rel.sourceEntityType === "contact" && rel.sourceEntityId === contactId;
          const counterpartyType = isSource ? rel.targetEntityType : rel.sourceEntityType;
          const counterpartyId = isSource ? rel.targetEntityId : rel.sourceEntityId;

          if (!canExposeRelationshipToDashboardUser(req, { entityType: counterpartyType, entityId: counterpartyId })) return null;
          // Scope before fetching a name or retaining an identifier in the
          // response. authorize* emits the same 404 shape for a direct object,
          // but relationship expansion must omit inaccessible neighbors rather
          // than turning one hidden neighbor into an endpoint-level oracle.
          const scoped = await canScopeRelationshipCounterparty(req, {
            entityType: counterpartyType,
            entityId: counterpartyId,
          });
          if (!scoped) return null;

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
      res.json(enriched.filter((relationship): relationship is NonNullable<typeof relationship> => relationship !== null));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/relationships/scan", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (!await authorizeContactAccess(req, res, contactId)) return;
      await extractRelationshipsForContact(contactId);
      const relationships = await storage.getEntityRelationships("contact", contactId);
      res.json({ message: "Relationship scan complete", count: relationships.length });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/relationships/risk-scan", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (!await authorizeContactAccess(req, res, contactId)) return;
      const result = await scanApplicationRisk(contactId);
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/relationships", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = insertEntityRelationshipSchema.extend({
        note: z.string().optional(),
      });
      const input = schema.parse(req.body);
      if (!await authorizeRelationshipEndpoint(req, res, {
        entityType: input.sourceEntityType, entityId: input.sourceEntityId,
      })) return;
      if (!await authorizeRelationshipEndpoint(req, res, {
        entityType: input.targetEntityType, entityId: input.targetEntityId,
      })) return;
      const rel = await storage.createEntityRelationship({ ...input, source: "manual" });
      res.status(201).json(rel);
    } catch (err: any) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.delete("/api/relationships/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const relId = Number(req.params.id);
      const { reason } = req.body ?? {};
      const relationship = await storage.getEntityRelationship(relId);
      if (!relationship) return res.status(404).json({ message: "Not found", code: "CRM_OBJECT_NOT_FOUND" });
      if (!await authorizeRelationshipEndpoint(req, res, {
        entityType: relationship.sourceEntityType, entityId: relationship.sourceEntityId,
      })) return;
      if (!await authorizeRelationshipEndpoint(req, res, {
        entityType: relationship.targetEntityType, entityId: relationship.targetEntityId,
      })) return;
      await storage.dismissEntityRelationship(relId, (req.user as any)?.username || "admin", reason);
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/relationships/propagate-risk", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (!await authorizeContactAccess(req, res, contactId)) return;
      const { riskReason } = req.body ?? {};
      if (!riskReason) return res.status(400).json({ message: "riskReason is required" });
      const count = await propagateRiskFlagToRelatedEntities(contactId, riskReason);
      res.json({ success: true, flaggedRelationships: count });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/relationships/graph/:entityType/:entityId", isDashboardUser, async (req, res) => {
    try {
      const entityType = String(req.params.entityType);
      const entityId = String(req.params.entityId);
      const id = Number(entityId);
      if (entityType === "contact" && !await authorizeContactAccess(req, res, id)) return;
      if (entityType === "deal" && !await authorizeDealAccess(req, res, id)) return;
      if (entityType === "business" && !await authorizeBusinessAccess(req, res, id)) return;
      if (!["contact", "deal", "business"].includes(entityType)) {
        return res.status(404).json({ message: "Not found", code: "CRM_OBJECT_NOT_FOUND" });
      }

      const rels = await storage.getEntityRelationships(entityType as any, id);

      const nodes: Array<{ id: string; label: string; type: string; riskFlag?: boolean }> = [
        { id: `${entityType}_${id}`, label: "This Contact", type: entityType as string },
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
        if (!canExposeRelationshipToDashboardUser(req, { entityType: counterpartyType, entityId: counterpartyId })) continue;
        if (!await canScopeRelationshipCounterparty(req, {
          entityType: counterpartyType,
          entityId: counterpartyId,
        })) continue;
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
              const { maskMid: _maskMidRelGraph } = await import("../utils/mask-mid");
              label = deal.mid ? `MID: ${_maskMidRelGraph(deal.mid)}` : `Deal #${counterpartyId}`;
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
      serverError(res, err);
    }
  });
}
