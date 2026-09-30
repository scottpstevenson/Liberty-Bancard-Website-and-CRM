/**
 * NBA routes — Next Best Action Engine API
 *
 * GET  /api/contacts/:id/nba            — current recommendation for a contact
 * POST /api/contacts/:id/nba/execute    — mark as executed (human)
 * POST /api/contacts/:id/nba/dismiss    — dismiss recommendation
 * GET  /api/nba/priority                — manager priority queue
 * POST /api/nba/compute/:id             — admin: force recompute for a contact
 */

import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { NBAService } from "../services/nba-service";
import { authorizeContactAccess } from "../services/crm-object-access";

// Keep the contact NBA response contract explicit. Drizzle rows are
// camelCase; serializing only the fields used by the CRM avoids an accidental
// snake_case assumption in consumers and preserves nullability from storage.
function serializeContactNba(nba: Awaited<ReturnType<typeof NBAService.getNBA>>) {
  if (!nba) return null;
  return {
    id: nba.id,
    contactId: nba.contactId,
    actionType: nba.actionType,
    channel: nba.channel ?? null,
    ownerRole: nba.ownerRole ?? null,
    dueAt: nba.dueAt ?? null,
    urgency: nba.urgency,
    reasonCode: nba.reasonCode,
    explanation: nba.explanation ?? null,
    confidence: nba.confidence ?? null,
    humanRequired: nba.humanRequired,
    automationEligible: nba.automationEligible,
    status: nba.status,
  };
}

export function registerNbaRoutes(app: Express) {

  // -------------------------------------------------------------------------
  // GET /api/contacts/:id/nba
  // -------------------------------------------------------------------------
  app.get("/api/contacts/:id/nba", isDashboardUser, async (req, res) => {
  const contactId = parseInt(req.params.id as string);
  if (isNaN(contactId)) {
    return res.status(400).json({ error: "Invalid contact ID" });
  }

  try {
    if (!await authorizeContactAccess(req, res, contactId)) return;
    const nba = await NBAService.getNBA(contactId);
    if (!nba) {
      // Trigger a fresh compute if none exists
      const computed = await NBAService.computeNBA(contactId).catch(() => null);
      if (!computed) {
        return res.json({ nba: null, message: "No NBA computed for this contact" });
      }
      const fresh = await NBAService.getNBA(contactId);
      return res.json({ nba: serializeContactNba(fresh) });
    }
    return res.json({ nba: serializeContactNba(nba) });
  } catch (err: any) {
    console.error("[NBA] GET contact NBA error:", err);
    return res.status(500).json({ error: "Failed to retrieve NBA" });
  }
});

  // -------------------------------------------------------------------------
  // POST /api/contacts/:id/nba/execute
  // -------------------------------------------------------------------------
  app.post("/api/contacts/:id/nba/execute", isDashboardUser, async (req, res) => {
  const contactId = parseInt(req.params.id as string);
  if (isNaN(contactId)) {
    return res.status(400).json({ error: "Invalid contact ID" });
  }

  try {
    if (!await authorizeContactAccess(req, res, contactId)) return;
    await NBAService.executeNBA(contactId, "HUMAN_EXECUTED");
    // Compute next NBA immediately
    NBAService.computeNBA(contactId).catch(err =>
      console.warn("[NBA] Post-execute recompute failed:", err?.message),
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[NBA] Execute error:", err);
    return res.status(500).json({ error: "Failed to execute NBA" });
  }
});

  // -------------------------------------------------------------------------
  // POST /api/contacts/:id/nba/dismiss
  // -------------------------------------------------------------------------
  app.post("/api/contacts/:id/nba/dismiss", isDashboardUser, async (req, res) => {
  const contactId = parseInt(req.params.id as string);
  if (isNaN(contactId)) {
    return res.status(400).json({ error: "Invalid contact ID" });
  }

  const userId = (req.user as any)?.id;
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    if (!await authorizeContactAccess(req, res, contactId)) return;
    await NBAService.dismissNBA(contactId, userId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[NBA] Dismiss error:", err);
    return res.status(500).json({ error: "Failed to dismiss NBA" });
  }
});

  // -------------------------------------------------------------------------
  // GET /api/nba/priority
  // -------------------------------------------------------------------------
  app.get("/api/nba/priority", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  const offset = parseInt(String(req.query.offset ?? "0"));
  const filter = (req.query.filter as string) || null;

  const validFilters = ["highest_value", "overdue", "human_required", "at_risk"];
  const safeFilter = validFilters.includes(filter ?? "") ? (filter as any) : null;

  try {
    const rows = await NBAService.getPriorityQueue({ limit, offset, filter: safeFilter });
    return res.json({ items: rows, limit, offset });
  } catch (err: any) {
    console.error("[NBA] Priority queue error:", err);
    return res.status(500).json({ error: "Failed to retrieve priority queue" });
  }
});

  // -------------------------------------------------------------------------
  // POST /api/nba/compute/:id
  // -------------------------------------------------------------------------
  app.post("/api/nba/compute/:id", isDashboardUser, requireRole("admin"), async (req, res) => {
  const contactId = parseInt(req.params.id as string);
  if (isNaN(contactId)) {
    return res.status(400).json({ error: "Invalid contact ID" });
  }

  try {
    const rec = await NBAService.computeNBA(contactId);
    return res.json({ success: true, nba: rec });
  } catch (err: any) {
    console.error("[NBA] Force compute error:", err);
    return res.status(500).json({ error: "Failed to compute NBA", detail: err?.message });
  }
});

} // end registerNbaRoutes
