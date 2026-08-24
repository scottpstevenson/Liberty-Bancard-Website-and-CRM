/**
 * Outreach Queue Routes
 *
 * GET  /api/outreach-queue          — paginated list of contacts ready for outreach
 * GET  /api/outreach-queue/count    — badge count (light, no data)
 * POST /api/outreach-queue/:id/start — enroll in vertical/default sequence + advance deal stage
 * POST /api/outreach-queue/:id/skip  — mark contact as skipped (hidden until re-enriched)
 */
import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool, db } from "../db";
import { contacts, sequenceEnrollments, deals, followUpSequences } from "@shared/schema";
import { eq, and, isNull, or, sql, inArray, desc, not } from "drizzle-orm";
import { storage } from "../storage";
import { serverError } from "../utils/server-error";
import { getVerticalSequenceMap, getDefaultSequenceId } from "../services/new-lead-enrollment-job";
import { readyForOutreachPredicate } from "../services/outreach-queue-membership";
import { invalidPagination, parseStrictPagination } from "../services/crm-object-access";

// ─── Score tier helper ────────────────────────────────────────────────────────
function scoreTier(leadScore: number | null): "hot" | "warm" | "cold" | "unqualified" {
  const s = leadScore ?? 0;
  if (s >= 70) return "hot";
  if (s >= 45) return "warm";
  if (s >= 20) return "cold";
  return "unqualified";
}

// ─── Score sort order for SQL ─────────────────────────────────────────────────
// Primary: tier (hot ≥ warm ≥ cold ≥ unqualified)
// Secondary: lead_score DESC within the same tier (99 before 70, both are "hot")
// Tertiary: created_at DESC as tie-breaker
const SCORE_ORDER_SQL = `
  CASE
    WHEN COALESCE(c.lead_score, 0) >= 70 THEN 3
    WHEN COALESCE(c.lead_score, 0) >= 45 THEN 2
    WHEN COALESCE(c.lead_score, 0) >= 20 THEN 1
    ELSE 0
  END DESC, COALESCE(c.lead_score, 0) DESC, c.created_at DESC
`;

export function registerOutreachQueueRoutes(app: Express) {
  // ── GET /api/outreach-queue — paginated queue ─────────────────────────────
  app.get("/api/outreach-queue", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const role = user?.role as string | undefined;
      const isAdmin = role === "admin" || role === "manager";

      const pagination = parseStrictPagination(req.query as Record<string, unknown>, {
        defaultLimit: 50,
        maxLimit: 100,
        page: true,
      });
      if ("error" in pagination) return invalidPagination(res);
      const { page, limit, offset } = pagination;

      const filterScore    = req.query.score    ? String(req.query.score)    : undefined;
      const filterVertical = req.query.vertical ? String(req.query.vertical) : undefined;
      const filterCity     = req.query.city     ? String(req.query.city)     : undefined;
      const filterAssigned = req.query.assignedTo ? String(req.query.assignedTo) : undefined;

      const membership = readyForOutreachPredicate({ alias: "c", ownerEmail: !isAdmin ? user?.email ?? "" : undefined });
      const params: unknown[] = [...membership.params];
      const conditions: string[] = [membership.where];

      // Role-based visibility: agents only see their own contacts
      if (isAdmin && filterAssigned) {
        if (filterAssigned === "unassigned") {
          conditions.push(`c.assigned_to IS NULL`);
        } else {
          params.push(filterAssigned);
          conditions.push(`c.assigned_to = $${params.length}`);
        }
      }

      // Score filter (derived from lead_score)
      if (filterScore === "hot") {
        conditions.push(`COALESCE(c.lead_score, 0) >= 70`);
      } else if (filterScore === "warm") {
        conditions.push(`COALESCE(c.lead_score, 0) >= 45 AND COALESCE(c.lead_score, 0) < 70`);
      } else if (filterScore === "cold") {
        conditions.push(`COALESCE(c.lead_score, 0) >= 20 AND COALESCE(c.lead_score, 0) < 45`);
      }

      if (filterVertical) {
        params.push(filterVertical);
        conditions.push(`c.vertical = $${params.length}`);
      }
      if (filterCity) {
        params.push(`%${filterCity.toLowerCase()}%`);
        conditions.push(`LOWER(COALESCE(c.city,'')) LIKE $${params.length}`);
      }

      const whereClause = conditions.join(" AND ");

      const [countResult, rowsResult] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS total FROM contacts c WHERE ${whereClause}`,
          params,
        ),
        pool.query(
          `SELECT
             c.id,
             c.first_name AS "firstName",
             c.last_name  AS "lastName",
             c.company_name AS "companyName",
             c.email,
             c.phone,
             c.vertical,
             c.city,
             c.state,
             c.lead_score AS "leadScore",
             c.assigned_to AS "assignedTo",
             c.created_at  AS "createdAt",
             c.last_scored_at AS "lastScoredAt",
             c.email_status AS "emailStatus"
           FROM contacts c
           WHERE ${whereClause}
           ORDER BY ${SCORE_ORDER_SQL}
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
      ]);

      const data = rowsResult.rows.map((row: any) => ({
        ...row,
        scoreTier: scoreTier(row.leadScore),
      }));

      res.json({
        data,
        total: countResult.rows[0]?.total ?? 0,
        page,
        limit,
      });
    } catch (err: any) {
      console.error("[outreach-queue GET]", err.message);
      serverError(res, err);
    }
  });

  // ── GET /api/outreach-queue/assignees — distinct reps with queued leads ──
  // Admin/manager only. Returns the full list of reps (assigned_to values) that
  // have at least one lead in the outreach queue so the filter dropdown is
  // complete regardless of which page is currently displayed.
  app.get("/api/outreach-queue/assignees", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT c.assigned_to AS "assignedTo"
        FROM contacts c
        WHERE c.archived_at IS NULL
          AND (
            (c.phone IS NOT NULL AND TRIM(c.phone) <> '')
            OR (c.email IS NOT NULL AND TRIM(c.email) <> ''
                AND COALESCE(c.email_status,'unvalidated') NOT IN ('bounced','invalid','opted_out','unsafe','unvalidated'))
          )
          AND (c.do_not_contact IS NULL OR c.do_not_contact = FALSE)
          AND c.outreach_queue_skipped_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM sequence_enrollments se
            WHERE se.contact_id = c.id AND se.status IN ('active','paused')
          )
        ORDER BY c.assigned_to ASC NULLS FIRST
      `);
      res.json({
        assignees: result.rows.map((r: any) => r.assignedTo),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET /api/outreach-queue/count — lightweight badge endpoint ────────────
  app.get("/api/outreach-queue/count", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const role = user?.role as string | undefined;
      const isAdmin = role === "admin" || role === "manager";

      const membership = readyForOutreachPredicate({ alias: "contacts", ownerEmail: !isAdmin ? user?.email ?? "" : undefined });
      const params: unknown[] = [...membership.params];
      const conditions: string[] = [membership.where];

      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM contacts WHERE ${conditions.join(" AND ")}`,
        params,
      );
      res.json({ count: result.rows[0]?.count ?? 0 });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── POST /api/outreach-queue/:id/start — enroll & advance deal ───────────
  app.post("/api/outreach-queue/:id/start", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(contactId) || contactId <= 0) {
        return res.status(400).json({ message: "Invalid contact ID" });
      }

      const user = req.user as any;
      const role = user?.role as string | undefined;
      const isAdmin = role === "admin" || role === "manager";

      // Load contact
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      // ── Object-level authorization: agents may only act on their own contacts ──
      if (!isAdmin) {
        const assignedTo = (contact as any).assignedTo as string | null | undefined;
        if (assignedTo !== user?.email) {
          return res.status(403).json({ message: "You do not have permission to start outreach for this contact" });
        }
      }

      // ── Server-side eligibility gate (mirrors queue query criteria) ──────────
      if ((contact as any).archivedAt) {
        return res.status(422).json({ message: "Contact is archived" });
      }
      if ((contact as any).doNotContact) {
        return res.status(422).json({ message: "Contact is marked Do Not Contact" });
      }
      const hasPhone = !!(contact as any).phone?.trim();
      const badEmailStatuses = ["bounced", "invalid", "opted_out", "unsafe", "unvalidated"];
      const emailOk = !!(contact as any).email?.trim() && !badEmailStatuses.includes((contact as any).emailStatus ?? "");
      if (!hasPhone && !emailOk) {
        return res.status(422).json({ message: "Contact has no reachable phone or email" });
      }

      // Resolve sequence before entering the transaction
      const [verticalMap, defaultSeqId] = await Promise.all([
        getVerticalSequenceMap(),
        getDefaultSequenceId(),
      ]);

      const contactVertical = (contact as any).vertical as string | null | undefined;
      let sequenceId: number | null = null;

      if (contactVertical && verticalMap[contactVertical]) {
        sequenceId = verticalMap[contactVertical];
      } else if (defaultSeqId) {
        sequenceId = defaultSeqId;
      }

      if (!sequenceId) {
        return res.status(422).json({
          message: "No sequence configured for this vertical and no default sequence set. Configure a default sequence in Outreach settings.",
        });
      }

      // Verify sequence exists and is active
      const [seqRow] = await db
        .select({ id: followUpSequences.id, status: followUpSequences.status, name: followUpSequences.name })
        .from(followUpSequences)
        .where(eq(followUpSequences.id, sequenceId))
        .limit(1);

      if (!seqRow) {
        return res.status(422).json({ message: "Configured sequence no longer exists" });
      }
      if ((seqRow as any).status !== "active") {
        return res.status(422).json({
          message: `Sequence "${(seqRow as any).name}" is not active. Activate it in Sequences settings first.`,
        });
      }

      // ── Atomic enrollment: lock the contact row, recheck any active/paused
      //    enrollment, then insert — all in one transaction.  This prevents a
      //    concurrent request (or a background auto-enroller choosing a different
      //    sequence) from creating a second active enrollment between our check
      //    and insert above.
      const pgClient = await pool.connect();
      let enrollment: { id: number } | null = null;
      let alreadyEnrolledResult: { id: number; status: string } | null = null;

      try {
        await pgClient.query("BEGIN");

        // Lock the contact row so concurrent starts must wait
        await pgClient.query(
          `SELECT id FROM contacts WHERE id = $1 FOR UPDATE`,
          [contactId],
        );

        // Recheck inside the transaction — any source of enrollment is covered
        const existingRows = await pgClient.query(
          `SELECT id, status FROM sequence_enrollments WHERE contact_id = $1 AND status IN ('active','paused') LIMIT 1`,
          [contactId],
        );
        if (existingRows.rows.length > 0) {
          alreadyEnrolledResult = existingRows.rows[0] as { id: number; status: string };
        } else {
          const nowIso = new Date().toISOString();
          const inserted = await pgClient.query(
            `INSERT INTO sequence_enrollments
               (sequence_id, contact_id, current_step, status, next_action_at, metadata, created_at, updated_at)
             VALUES ($1, $2, 0, 'active', $3, $4, $3, $3)
             RETURNING id`,
            [
              sequenceId,
              contactId,
              nowIso,
              JSON.stringify({ enrolledBy: user?.email ?? "manual", source: "outreach_queue" }),
            ],
          );
          enrollment = inserted.rows[0] as { id: number };
        }

        await pgClient.query("COMMIT");
      } catch (txErr) {
        await pgClient.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        pgClient.release();
      }

      if (alreadyEnrolledResult) {
        return res.json({
          alreadyEnrolled: true,
          enrollmentId: alreadyEnrolledResult.id,
          message: `Contact is already in an ${alreadyEnrolledResult.status} sequence`,
        });
      }

      // Clear skip flag if it was set
      await pool.query(
        `UPDATE contacts SET outreach_queue_skipped_at = NULL WHERE id = $1`,
        [contactId],
      );

      // Advance deal stage to "Enriched" if currently on "New Lead"
      const dealRows = await pool.query(
        `SELECT id, stage FROM deals WHERE contact_id = $1 AND archived_at IS NULL AND pipeline = 'sales' ORDER BY created_at DESC LIMIT 1`,
        [contactId],
      );
      let dealAdvanced = false;
      if (dealRows.rows.length > 0 && dealRows.rows[0].stage === "New Lead") {
        await storage.updateDeal(dealRows.rows[0].id, { stage: "Enriched" } as any, {
          userId: user?.id ?? null,
          actorType: "user",
          actorId: user?.id ?? null,
        });
        dealAdvanced = true;
      }

      // Audit log
      await storage.createAuditLog({
        action: "outreach_queue_start",
        entityType: "contact",
        entityId: contactId,
        userId: user?.id ?? null,
        details: {
          sequenceId,
          sequenceName: (seqRow as any).name,
          enrollmentId: enrollment!.id,
          dealAdvanced,
          source: "outreach_queue",
        },
      });

      res.json({
        success: true,
        enrollmentId: enrollment!.id,
        sequenceName: (seqRow as any).name,
        dealAdvanced,
      });
    } catch (err: any) {
      console.error("[outreach-queue start]", err.message);
      serverError(res, err);
    }
  });

  // ── POST /api/outreach-queue/:id/skip — hide from queue temporarily ───────
  app.post("/api/outreach-queue/:id/skip", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(contactId) || contactId <= 0) {
        return res.status(400).json({ message: "Invalid contact ID" });
      }

      const user = req.user as any;
      const role = user?.role as string | undefined;
      const isAdmin = role === "admin" || role === "manager";

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      // ── Object-level authorization: agents may only skip their own contacts ──
      if (!isAdmin) {
        const assignedTo = (contact as any).assignedTo as string | null | undefined;
        if (assignedTo !== user?.email) {
          return res.status(403).json({ message: "You do not have permission to skip this contact" });
        }
      }

      await pool.query(
        `UPDATE contacts SET outreach_queue_skipped_at = NOW() WHERE id = $1`,
        [contactId],
      );

      await storage.createAuditLog({
        action: "outreach_queue_skip",
        entityType: "contact",
        entityId: contactId,
        userId: user?.id ?? null,
        details: { source: "outreach_queue" },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[outreach-queue skip]", err.message);
      serverError(res, err);
    }
  });
}
