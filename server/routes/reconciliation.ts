/**
 * Contact Reconciliation API routes — admin-only.
 *
 * Authorization: all routes require requireRole('admin').
 * Run ID params validated as UUIDv4 before any DB query.
 * CSV export values are formula-injection-escaped.
 * Cluster ID params also validated as UUIDv4.
 *
 * POST routes require CSRF (global csrfProtection middleware).
 * Environment label is always derived server-side.
 *
 * Write-scope enforcement:
 *   Proposal approvals use reconciliation-approval.ts which direct-writes
 *   only the 5 allowed fields (first_name, last_name, phone, company_name, vertical).
 *   No GHL projection insert. CAS contact_updated_at guard prevents stale writes.
 */

import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { serverError } from "../utils/server-error";
import { deriveEnvironmentLabel } from "../services/contact-census-runner";
import {
  createAndStartReconRun,
  resumeReconRun,
} from "../services/contact-reconciliation-runner";
import {
  approveProposal,
  rejectProposal,
  revertProposal,
} from "../services/reconciliation-approval";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function isUUIDv4(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function validateRunId(runId: string | string[] | undefined, res: any): string | null {
  const id = Array.isArray(runId) ? runId[0] : runId;
  if (!id || !isUUIDv4(id)) {
    res.status(400).json({ error: "runId must be a valid UUID v4" });
    return null;
  }
  return id;
}

function validateClusterId(clusterId: string | string[] | undefined, res: any): string | null {
  const id = Array.isArray(clusterId) ? clusterId[0] : clusterId;
  if (!id || !isUUIDv4(id)) {
    res.status(400).json({ error: "clusterId must be a valid UUID v4" });
    return null;
  }
  return id;
}

function csvCell(v: string | boolean | number | null | undefined): string {
  const raw = v == null ? "" : String(v);
  // Prefix formula-triggering characters with an apostrophe so spreadsheets treat
  // the value as a literal string rather than evaluating it as a formula.
  const s = /^[=+\-@|%\t]/.test(raw) ? `'${raw}` : raw;
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("'")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ──────────────────────────────────────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────────────────────────────────────
export function registerReconciliationRoutes(app: Express): void {

  // ── POST /api/admin/reconciliation/runs ───────────────────────────────────
  // Start a new reconciliation run from a completed census run.
  app.post("/api/admin/reconciliation/runs", requireRole("admin"), async (req, res) => {
    try {
      const { sourceCensusRunId } = req.body as { sourceCensusRunId?: string };

      if (!sourceCensusRunId || !isUUIDv4(sourceCensusRunId)) {
        return res.status(400).json({ error: "sourceCensusRunId must be a valid UUID v4" });
      }

      // Verify source census run exists and is completed
      const censusR = await pool.query(
        `SELECT id, status FROM contact_census_runs WHERE id = $1`,
        [sourceCensusRunId],
      );
      if (censusR.rows.length === 0) {
        return res.status(404).json({ error: "Source census run not found" });
      }
      if (censusR.rows[0].status !== "completed") {
        return res.status(409).json({
          error: `Source census run is in status '${censusR.rows[0].status}' — must be 'completed' to start reconciliation`,
        });
      }

      const requestedBy = (req.user as any)?.email ?? "admin";
      const environmentLabel = deriveEnvironmentLabel();

      const runId = await createAndStartReconRun({
        sourceCensusRunId,
        requestedBy,
        environmentLabel,
      });

      res.status(201).json({ runId, status: "running", environmentLabel });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "A reconciliation run is already in progress. Pause or wait for it to complete.",
        });
      }
      serverError(res, err, "reconciliation start run");
    }
  });

  // ── GET /api/admin/reconciliation/runs ────────────────────────────────────
  app.get("/api/admin/reconciliation/runs", requireRole("admin"), async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
      const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);

      const r = await pool.query(
        `SELECT id, source_census_run_id, environment_label, rules_version,
                requested_by, status, pause_reason, failure_reason,
                lease_owner, lease_expires_at,
                max_contact_id_at_start, denominator_at_start,
                total_processed, total_proposed, total_org_candidates, total_clusters,
                cursor_contact_census_member_id, lane_counts, dimension_counts,
                completed_at, failed_at, created_at, updated_at
         FROM contact_reconciliation_runs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const countR = await pool.query(`SELECT COUNT(*) AS n FROM contact_reconciliation_runs`);

      res.json({
        runs: r.rows,
        total: parseInt(countR.rows[0].n, 10),
        limit,
        offset,
      });
    } catch (err) {
      serverError(res, err, "reconciliation list runs");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId ─────────────────────────────
  app.get("/api/admin/reconciliation/runs/:runId", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(`SELECT * FROM contact_reconciliation_runs WHERE id = $1`, [runId]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Run not found" });
      res.json(r.rows[0]);
    } catch (err) {
      serverError(res, err, "reconciliation get run");
    }
  });

  // ── POST /api/admin/reconciliation/runs/:runId/pause ──────────────────────
  app.post("/api/admin/reconciliation/runs/:runId/pause", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_reconciliation_runs
         SET status='paused', pause_reason='Paused by admin request', updated_at=now()
         WHERE id=$1 AND status='running'
         RETURNING id, status`,
        [runId],
      );
      if (r.rows.length === 0) return res.status(409).json({ error: "Run is not currently running" });
      res.json({ runId, status: "paused" });
    } catch (err) {
      serverError(res, err, "reconciliation pause run");
    }
  });

  // ── POST /api/admin/reconciliation/runs/:runId/resume ─────────────────────
  app.post("/api/admin/reconciliation/runs/:runId/resume", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const ok = await resumeReconRun(runId);
      if (!ok) return res.status(409).json({ error: "Run is not paused, or another run is already active." });
      res.json({ runId, status: "running" });
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Another reconciliation run is already in progress." });
      serverError(res, err, "reconciliation resume run");
    }
  });

  // ── DELETE /api/admin/reconciliation/runs/:runId ──────────────────────────
  app.delete("/api/admin/reconciliation/runs/:runId", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_reconciliation_runs
         SET status='cancelled', updated_at=now()
         WHERE id=$1 AND status IN ('running','paused','pending')
         RETURNING id`,
        [runId],
      );
      if (r.rows.length === 0) return res.status(409).json({ error: "Run is not in a cancellable state" });
      res.json({ runId, status: "cancelled" });
    } catch (err) {
      serverError(res, err, "reconciliation cancel run");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/lanes ───────────────────────
  app.get("/api/admin/reconciliation/runs/:runId/lanes", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT primary_lane, COUNT(*) AS count
         FROM contact_reconciliation_members WHERE run_id=$1
         GROUP BY primary_lane ORDER BY count DESC`,
        [runId],
      );
      res.json(r.rows);
    } catch (err) {
      serverError(res, err, "reconciliation lanes");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/dimensions ──────────────────
  app.get("/api/admin/reconciliation/runs/:runId/dimensions", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11] = await Promise.all([
        pool.query(`SELECT name_quality_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT email_quality_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT phone_quality_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT company_quality_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT vertical_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT duplicate_risk_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT business_gap_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT org_aggregation_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT normalization_opportunity AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT cluster_candidacy_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT overall_action_state AS value, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
      ]);

      res.json({
        r1_name_quality: r1.rows, r2_email_quality: r2.rows, r3_phone_quality: r3.rows,
        r4_company_quality: r4.rows, r5_vertical: r5.rows, r6_duplicate_risk: r6.rows,
        r7_business_gap: r7.rows, r8_org_aggregation: r8.rows,
        r9_normalization: r9.rows, r10_cluster: r10.rows, r11_action: r11.rows,
      });
    } catch (err) {
      serverError(res, err, "reconciliation dimensions");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/members ─────────────────────
  app.get("/api/admin/reconciliation/runs/:runId/members", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { lane, cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(limitQ ?? "50", 10), 1), 500);
      const cursorId = cursor ? Math.max(parseInt(cursor, 10), 0) : 0;

      const conditions = [`run_id = $1`, `id > $2`];
      const params: unknown[] = [runId, cursorId];
      let pi = 3;

      if (lane) { conditions.push(`primary_lane = $${pi++}`); params.push(lane); }

      const r = await pool.query(
        `SELECT id, contact_id, census_lane, primary_lane, gap_codes,
                name_quality_state, email_quality_state, phone_quality_state,
                company_quality_state, vertical_state, duplicate_risk_state,
                business_gap_state, org_aggregation_state, normalization_opportunity,
                has_business_id, has_company_name, has_email, has_phone,
                has_vertical, has_first_name, has_last_name
         FROM contact_reconciliation_members
         WHERE ${conditions.join(" AND ")}
         ORDER BY id ASC LIMIT $${pi}`,
        [...params, limit],
      );

      res.json({
        members: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "reconciliation members");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/org-candidates ─────────────
  app.get("/api/admin/reconciliation/runs/:runId/org-candidates", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(limitQ ?? "50", 10), 1), 500);
      const cursorId = cursor ? Math.max(parseInt(cursor, 10), 0) : 0;

      const r = await pool.query(
        `SELECT c.id, c.normalized_name, c.raw_sample_name, c.created_at,
                COUNT(m.id) AS member_count
         FROM contact_organization_candidates c
         JOIN contact_organization_candidate_members m ON m.candidate_id = c.id
         WHERE c.run_id = $1 AND c.id > $2
         GROUP BY c.id
         ORDER BY member_count DESC, c.id ASC
         LIMIT $3`,
        [runId, cursorId, limit],
      );

      res.json({
        candidates: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "reconciliation org candidates");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/clusters ───────────────────
  app.get("/api/admin/reconciliation/runs/:runId/clusters", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(limitQ ?? "50", 10), 1), 500);
      const cursorCursor = cursor ?? "";

      const r = await pool.query(
        `SELECT c.id, c.cluster_key, c.cluster_reason, c.created_at,
                COUNT(m.id) AS member_count
         FROM contact_duplicate_clusters c
         JOIN contact_duplicate_cluster_members m ON m.cluster_id = c.id
         WHERE c.run_id = $1 AND c.id::text > $2
         GROUP BY c.id
         ORDER BY member_count DESC, c.id ASC
         LIMIT $3`,
        [runId, cursorCursor, limit],
      );

      res.json({
        clusters: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "reconciliation clusters");
    }
  });

  // ── GET /api/admin/reconciliation/org-candidates/:candidateId/members ──────
  // Returns members from contact_organization_candidate_members.
  // Distinct from /clusters/:clusterId/members which queries contact_duplicate_cluster_members.
  app.get("/api/admin/reconciliation/org-candidates/:candidateId/members", requireRole("admin"), async (req, res) => {
    const candidateIdRaw = Array.isArray(req.params.candidateId) ? req.params.candidateId[0] : req.params.candidateId;
    const candidateId = parseInt(candidateIdRaw ?? "", 10);
    if (!candidateId || isNaN(candidateId) || candidateId <= 0) {
      return res.status(400).json({ error: "candidateId must be a positive integer" });
    }
    try {
      const r = await pool.query(
        `SELECT m.id, m.candidate_id, m.contact_id, m.created_at
         FROM contact_organization_candidate_members m
         WHERE m.candidate_id = $1
         ORDER BY m.id ASC`,
        [candidateId],
      );
      res.json({ members: r.rows });
    } catch (err) {
      serverError(res, err, "org candidate members");
    }
  });

  // ── GET /api/admin/reconciliation/clusters/:clusterId/members ─────────────
  app.get("/api/admin/reconciliation/clusters/:clusterId/members", requireRole("admin"), async (req, res) => {
    const clusterId = validateClusterId(req.params.clusterId, res);
    if (!clusterId) return;
    try {
      const r = await pool.query(
        `SELECT m.id, m.contact_id, m.is_primary, m.created_at
         FROM contact_duplicate_cluster_members m
         WHERE m.cluster_id = $1
         ORDER BY m.is_primary DESC, m.id ASC`,
        [clusterId],
      );
      res.json({ members: r.rows });
    } catch (err) {
      serverError(res, err, "reconciliation cluster members");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/proposals ──────────────────
  app.get("/api/admin/reconciliation/runs/:runId/proposals", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { status, proposalType, cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(limitQ ?? "50", 10), 1), 500);
      const cursorId = cursor ? Math.max(parseInt(cursor, 10), 0) : 0;

      const conditions = [`run_id = $1`, `id > $2`];
      const params: unknown[] = [runId, cursorId];
      let pi = 3;

      if (status) { conditions.push(`status = $${pi++}`); params.push(status); }
      if (proposalType) { conditions.push(`proposal_type = $${pi++}`); params.push(proposalType); }

      const whereClause = conditions.join(" AND ");

      const [r, countR] = await Promise.all([
        pool.query(
          `SELECT id, contact_id, proposal_type, field_name, current_value, proposed_value,
                  confidence, status, reviewed_by, reviewed_at, created_at
           FROM contact_normalization_proposals
           WHERE ${whereClause}
           ORDER BY id ASC LIMIT $${pi}`,
          [...params, limit],
        ),
        pool.query(
          `SELECT COUNT(*) AS n FROM contact_normalization_proposals WHERE ${whereClause}`,
          params,
        ),
      ]);

      res.json({
        proposals: r.rows,
        total: parseInt(countR.rows[0].n, 10),
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "reconciliation proposals");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/proposals/export ────────────
  // Dedicated CSV export for proposals (separate from the general /export endpoint).
  app.get("/api/admin/reconciliation/runs/:runId/proposals/export", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { status, proposalType } = req.query as Record<string, string>;

      const conditions: string[] = [`run_id = $1`];
      const params: unknown[] = [runId];
      let pi = 2;

      if (status) { conditions.push(`status = $${pi++}`); params.push(status); }
      if (proposalType) { conditions.push(`proposal_type = $${pi++}`); params.push(proposalType); }

      const r = await pool.query(
        `SELECT id, contact_id, proposal_type, field_name,
                current_value, proposed_value, confidence, status,
                reviewed_by, reviewed_at, created_at
         FROM contact_normalization_proposals
         WHERE ${conditions.join(" AND ")}
         ORDER BY contact_id, field_name`,
        params,
      );

      const header = "proposal_id,contact_id,proposal_type,field_name,current_value,proposed_value,confidence,status,reviewed_by,reviewed_at";
      const lines = [header];
      for (const row of r.rows) {
        lines.push([
          csvCell(row.id), csvCell(row.contact_id),
          csvCell(row.proposal_type), csvCell(row.field_name),
          csvCell(row.current_value), csvCell(row.proposed_value),
          csvCell(row.confidence), csvCell(row.status),
          csvCell(row.reviewed_by), csvCell(row.reviewed_at),
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="recon-proposals-${runId.slice(0, 8)}.csv"`);
      return res.send(lines.join("\n"));
    } catch (err) {
      serverError(res, err, "reconciliation proposals export");
    }
  });

  // ── POST /api/admin/reconciliation/proposals/:id/approve ─────────────────
  app.post("/api/admin/reconciliation/proposals/:id/approve", requireRole("admin"), async (req, res) => {
    const proposalId = parseInt(String(req.params.id), 10);
    if (isNaN(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: "Invalid proposal ID" });
    }
    try {
      const approvedBy = (req.user as any)?.email ?? "admin";
      const result = await approveProposal(proposalId, approvedBy);
      res.json(result);
    } catch (err) {
      serverError(res, err, "reconciliation approve proposal");
    }
  });

  // ── POST /api/admin/reconciliation/proposals/:id/reject ──────────────────
  app.post("/api/admin/reconciliation/proposals/:id/reject", requireRole("admin"), async (req, res) => {
    const proposalId = parseInt(String(req.params.id), 10);
    if (isNaN(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: "Invalid proposal ID" });
    }
    try {
      const rejectedBy = (req.user as any)?.email ?? "admin";
      const result = await rejectProposal(proposalId, rejectedBy);
      res.json(result);
    } catch (err) {
      serverError(res, err, "reconciliation reject proposal");
    }
  });

  // ── POST /api/admin/reconciliation/proposals/:id/revert ──────────────────
  app.post("/api/admin/reconciliation/proposals/:id/revert", requireRole("admin"), async (req, res) => {
    const proposalId = parseInt(String(req.params.id), 10);
    if (isNaN(proposalId) || proposalId <= 0) {
      return res.status(400).json({ error: "Invalid proposal ID" });
    }
    try {
      const revertedBy = (req.user as any)?.email ?? "admin";
      const result = await revertProposal(proposalId, revertedBy);
      res.json(result);
    } catch (err) {
      serverError(res, err, "reconciliation revert proposal");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/export ─────────────────────
  app.get("/api/admin/reconciliation/runs/:runId/export", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const runR = await pool.query(
        `SELECT status FROM contact_reconciliation_runs WHERE id = $1`, [runId],
      );
      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const { lane, type } = req.query as Record<string, string>;

      if (type === "proposals") {
        // Export normalization proposals as CSV
        const conditions: string[] = [`p.run_id = $1`];
        const params: unknown[] = [runId];
        let pi = 2;

        if (lane) {
          // Filter to proposals for contacts in the given reconciliation lane
          conditions.push(
            `p.contact_id IN (SELECT contact_id FROM contact_reconciliation_members WHERE run_id = $1 AND primary_lane = $${pi++})`,
          );
          params.push(lane);
        }

        const r = await pool.query(
          `SELECT p.id, p.contact_id, p.proposal_type, p.field_name,
                  p.current_value, p.proposed_value, p.confidence, p.status
           FROM contact_normalization_proposals p
           WHERE ${conditions.join(" AND ")}
           ORDER BY p.contact_id, p.field_name`,
          params,
        );

        const header = "proposal_id,contact_id,proposal_type,field_name,current_value,proposed_value,confidence,status";
        const lines = [header];
        for (const row of r.rows) {
          lines.push([
            csvCell(row.id), csvCell(row.contact_id),
            csvCell(row.proposal_type), csvCell(row.field_name),
            csvCell(row.current_value), csvCell(row.proposed_value),
            csvCell(row.confidence), csvCell(row.status),
          ].join(","));
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="recon-proposals-${runId.slice(0, 8)}.csv"`);
        return res.send(lines.join("\n"));
      }

      // Default: export reconciliation members
      const params: unknown[] = [runId];
      let laneClause = "";
      let pi = 2;
      if (lane) { laneClause = `AND primary_lane = $${pi++}`; params.push(lane); }

      const r = await pool.query(
        `SELECT contact_id, primary_lane, gap_codes, census_lane,
                name_quality_state, email_quality_state, phone_quality_state,
                has_business_id, has_company_name, has_email, has_phone, has_vertical
         FROM contact_reconciliation_members
         WHERE run_id = $1 ${laneClause}
         ORDER BY contact_id`,
        params,
      );

      const header = "contact_id,primary_lane,gap_codes,census_lane,name_quality,email_quality,phone_quality,has_business_id,has_company_name,has_email,has_phone,has_vertical";
      const lines = [header];
      for (const row of r.rows) {
        lines.push([
          csvCell(row.contact_id), csvCell(row.primary_lane),
          csvCell((row.gap_codes ?? []).join(";")), csvCell(row.census_lane),
          csvCell(row.name_quality_state), csvCell(row.email_quality_state),
          csvCell(row.phone_quality_state), csvCell(row.has_business_id),
          csvCell(row.has_company_name), csvCell(row.has_email),
          csvCell(row.has_phone), csvCell(row.has_vertical),
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="recon-members-${runId.slice(0, 8)}.csv"`);
      res.send(lines.join("\n"));
    } catch (err) {
      serverError(res, err, "reconciliation export");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/summary ────────────────────
  app.get("/api/admin/reconciliation/runs/:runId/summary", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const [runR, laneR, proposalR, orgR, clusterR] = await Promise.all([
        pool.query(
          `SELECT status, total_processed, total_proposed, total_org_candidates, total_clusters,
                  source_census_run_id, environment_label, completed_at, created_at
           FROM contact_reconciliation_runs WHERE id = $1`,
          [runId],
        ),
        pool.query(
          `SELECT primary_lane, COUNT(*) AS count FROM contact_reconciliation_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`,
          [runId],
        ),
        pool.query(
          `SELECT status, COUNT(*) AS count FROM contact_normalization_proposals WHERE run_id=$1 GROUP BY 1`,
          [runId],
        ),
        pool.query(`SELECT COUNT(*) AS n FROM contact_organization_candidates WHERE run_id=$1`, [runId]),
        pool.query(`SELECT COUNT(*) AS n FROM contact_duplicate_clusters WHERE run_id=$1`, [runId]),
      ]);

      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const run = runR.rows[0];
      const laneBreakdown: Record<string, number> = {};
      for (const row of laneR.rows) laneBreakdown[row.primary_lane] = parseInt(row.count, 10);

      const proposalsByStatus: Record<string, number> = {};
      for (const row of proposalR.rows) proposalsByStatus[row.status] = parseInt(row.count, 10);

      res.json({
        run,
        laneBreakdown,
        proposalsByStatus,
        orgCandidateCount: parseInt(orgR.rows[0].n, 10),
        clusterCount: parseInt(clusterR.rows[0].n, 10),
      });
    } catch (err) {
      serverError(res, err, "reconciliation summary");
    }
  });
}
