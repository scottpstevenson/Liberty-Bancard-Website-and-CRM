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
  ALL_QUALITY_SIGNAL_CODES,
  QUALITY_SIGNAL_CODE_SET,
  SIGNAL_SEVERITY,
  SIGNAL_DESCRIPTIONS,
  normalizeNanpPhone,
} from "../services/contact-quality-signals";
import { runEmailPreFilter } from "../services/email-pre-filter";
import { applyConsentCommand } from "../services/consent-authority";
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

      const { rulesVersion, previewAcceptanceToken } = req.body as {
        sourceCensusRunId?: string;
        rulesVersion?: string;
        previewAcceptanceToken?: string;
      };
      const resolvedRulesVersion = rulesVersion === "quality-v1" ? "quality-v1" : undefined;

      // ── Quality-v1 preview gate ───────────────────────────────────────────────
      // A full quality-v1 run requires an admin to have reviewed the bounded preview
      // first. The preview endpoint stores an acceptance token in system_settings.
      // The caller must pass that token key back here.
      if (resolvedRulesVersion === "quality-v1") {
        const expectedKey = `quality_v1_preview_accepted:${sourceCensusRunId}`;
        if (!previewAcceptanceToken || previewAcceptanceToken !== expectedKey) {
          return res.status(409).json({
            error:
              "A quality-v1 run requires a reviewed preview. Run POST /runs/:previewRunId/quality-preview first, then pass the returned acceptanceToken as previewAcceptanceToken.",
          });
        }
        // Verify the token exists and is not expired
        const tokenR = await pool.query(
          `SELECT value FROM system_settings WHERE key = $1`,
          [expectedKey],
        );
        if (tokenR.rows.length === 0) {
          return res.status(409).json({
            error: "Preview acceptance token not found. Run the quality preview first.",
          });
        }
        // node-postgres returns JSONB columns as already-parsed objects; handle both.
        const rawValue = tokenR.rows[0].value;
        const tokenData: { sourceCensusRunId?: string; expiresAt?: string } =
          typeof rawValue === "string" ? JSON.parse(rawValue) : (rawValue as any);
        if (!tokenData.expiresAt || new Date(tokenData.expiresAt) < new Date()) {
          return res.status(409).json({
            error: "Preview acceptance token has expired (24 h limit). Re-run the quality preview.",
          });
        }
      }

      const runId = await createAndStartReconRun({
        sourceCensusRunId,
        requestedBy,
        environmentLabel,
        rulesVersion: resolvedRulesVersion,
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

      const { lane, type, signal_code: signalCode } = req.query as Record<string, string>;

      // ── Quality-signals CSV export ──────────────────────────────────────────
      if (type === "quality-signals") {
        if (signalCode && !QUALITY_SIGNAL_CODE_SET.has(signalCode)) {
          return res.status(400).json({ error: `Unknown signal_code: ${signalCode}` });
        }
        const params: unknown[] = [runId];
        let signalClause = "";
        let pi = 2;
        if (signalCode) {
          signalClause = `AND $${pi++} = ANY(m.quality_signal_codes)`;
          params.push(signalCode);
        }
        // Stream via server-side cursor (keyset on contact_id)
        const BATCH = 500;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const suffix = signalCode ? `-${signalCode}` : "";
        res.setHeader("Content-Disposition", `attachment; filename="quality-signals-${runId.slice(0, 8)}${suffix}.csv"`);
        res.write("contact_id,name,company,email,phone,quality_signal_codes,email_status,email_validation_updated_at,do_not_contact,do_not_auto_contact,suppression_reason\n");
        let lastId = 0;
        while (true) {
          const batchParams = [...params, lastId, BATCH];
          const piLast = pi;
          const piLimit = pi + 1;
          const r = await pool.query(
            `SELECT m.contact_id,
                    TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS name,
                    c.company_name,
                    c.email,
                    c.phone,
                    m.quality_signal_codes,
                    c.email_status,
                    c.email_validation_updated_at,
                    c.do_not_contact,
                    c.do_not_auto_contact,
                    c.suppression_reason
             FROM contact_reconciliation_members m
             JOIN contacts c ON c.id = m.contact_id
             WHERE m.run_id = $1 ${signalClause}
               AND m.contact_id > $${piLast}
             ORDER BY m.contact_id ASC
             LIMIT $${piLimit}`,
            batchParams,
          );
          if (r.rows.length === 0) break;
          for (const row of r.rows) {
            res.write([
              csvCell(row.contact_id),
              csvCell(row.name || ""),
              csvCell(row.company_name || ""),
              csvCell(row.email || ""),
              csvCell(row.phone || ""),
              csvCell((row.quality_signal_codes ?? []).join(";")),
              csvCell(row.email_status || ""),
              csvCell(row.email_validation_updated_at ? new Date(row.email_validation_updated_at).toISOString() : ""),
              csvCell(row.do_not_contact ? "true" : "false"),
              csvCell(row.do_not_auto_contact ? "true" : "false"),
              csvCell(row.suppression_reason || ""),
            ].join(",") + "\n");
          }
          lastId = r.rows[r.rows.length - 1].contact_id;
          if (r.rows.length < BATCH) break;
        }
        return res.end();
      }

      // ── Shared-phone merge-candidate CSV export ─────────────────────────────
      if (type === "shared-phone") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="shared-phone-${runId.slice(0, 8)}.csv"`);
        res.write("normalized_phone,contact_id,name,company,quality_signal_codes\n");
        const BATCH = 500;
        let lastId = 0;
        while (true) {
          const r = await pool.query(
            `SELECT m.contact_id,
                    TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS name,
                    c.company_name,
                    c.phone,
                    m.quality_signal_codes
             FROM contact_reconciliation_members m
             JOIN contacts c ON c.id = m.contact_id
             WHERE m.run_id = $1
               AND 'SHARED_PHONE_REVIEW' = ANY(m.quality_signal_codes)
               AND m.contact_id > $2
             ORDER BY m.contact_id ASC
             LIMIT $3`,
            [runId, lastId, BATCH],
          );
          if (r.rows.length === 0) break;
          for (const row of r.rows) {
            const normalized = normalizeNanpPhone(row.phone) ?? "";
            res.write([
              csvCell(normalized),
              csvCell(row.contact_id),
              csvCell(row.name || ""),
              csvCell(row.company_name || ""),
              csvCell((row.quality_signal_codes ?? []).join(";")),
            ].join(",") + "\n");
          }
          lastId = r.rows[r.rows.length - 1].contact_id;
          if (r.rows.length < BATCH) break;
        }
        return res.end();
      }

      // ── Shared-email merge-candidate CSV export ─────────────────────────────
      if (type === "shared-email") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="shared-email-${runId.slice(0, 8)}.csv"`);
        res.write("normalized_email,contact_id,name,company,quality_signal_codes\n");
        const BATCH = 500;
        let lastId = 0;
        while (true) {
          const r = await pool.query(
            `SELECT m.contact_id,
                    TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS name,
                    c.company_name,
                    c.email,
                    m.quality_signal_codes
             FROM contact_reconciliation_members m
             JOIN contacts c ON c.id = m.contact_id
             WHERE m.run_id = $1
               AND 'SHARED_EMAIL_REVIEW' = ANY(m.quality_signal_codes)
               AND m.contact_id > $2
             ORDER BY m.contact_id ASC
             LIMIT $3`,
            [runId, lastId, BATCH],
          );
          if (r.rows.length === 0) break;
          for (const row of r.rows) {
            const normalized = row.email ? row.email.trim().toLowerCase() : "";
            res.write([
              csvCell(normalized),
              csvCell(row.contact_id),
              csvCell(row.name || ""),
              csvCell(row.company_name || ""),
              csvCell((row.quality_signal_codes ?? []).join(";")),
            ].join(",") + "\n");
          }
          lastId = r.rows[r.rows.length - 1].contact_id;
          if (r.rows.length < BATCH) break;
        }
        return res.end();
      }

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

  // ── POST /api/admin/reconciliation/runs/:runId/remediation/validate-emails ─
  // Idempotent. Creates or returns the in-progress validate-emails operation.
  // Runs the local email pre-filter then hands passing contacts to the canonical
  // ZeroBounce authority. Does NOT create a second campaign or BullMQ path.
  app.post(
    "/api/admin/reconciliation/runs/:runId/remediation/validate-emails",
    requireRole("admin"),
    async (req, res) => {
      const runId = validateRunId(req.params.runId, res);
      if (!runId) return;
      // Declared outside try so the catch block can mark it failed.
      let _validateOpId: string | null = null;
      try {
        const actorId = String((req.user as any)?.id ?? "system");
        const runR = await pool.query(
          `SELECT id, status, rules_version FROM contact_reconciliation_runs WHERE id = $1`,
          [runId],
        );
        if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });
        const recon = runR.rows[0];
        if (recon.rules_version !== "quality-v1") {
          return res.status(400).json({ error: "Remediation requires a quality-v1 run" });
        }

        // Idempotency: return existing in-flight or most recent completed operation.
        const existingOp = (await pool.query(
          `SELECT id, status, result_summary FROM contact_remediation_operations
           WHERE run_id = $1 AND signal_code = 'EMAIL_UNVALIDATED' AND operation_type = 'validate_emails'
             AND status IN ('pending','running')
           LIMIT 1`,
          [runId],
        )).rows[0];
        if (existingOp) {
          return res.json({ operationId: existingOp.id, status: existingOp.status, alreadyRunning: true, resultSummary: existingOp.result_summary });
        }

        // Create operation record (partial unique index prevents race).
        let opId: string;
        try {
          const ins = await pool.query(
            `INSERT INTO contact_remediation_operations
               (run_id, signal_code, operation_type, status, initiated_by)
             VALUES ($1, 'EMAIL_UNVALIDATED', 'validate_emails', 'running', $2)
             RETURNING id`,
            [runId, actorId],
          );
          opId = ins.rows[0].id;
          _validateOpId = opId; // expose to outer catch so failures can be recorded
        } catch (insErr: any) {
          if (insErr?.code === "23505") {
            const winner = (await pool.query(
              `SELECT id, status, result_summary FROM contact_remediation_operations
               WHERE run_id = $1 AND signal_code = 'EMAIL_UNVALIDATED' AND operation_type = 'validate_emails'
                 AND status IN ('pending','running')
               LIMIT 1`,
              [runId],
            )).rows[0];
            if (winner) return res.json({ operationId: winner.id, status: winner.status, alreadyRunning: true, resultSummary: winner.result_summary });
          }
          throw insErr;
        }

        // Load the EMAIL_UNVALIDATED cohort, excluding DNC_GLOBAL / AUTO_CONTACT_BLOCKED.
        const membersR = await pool.query(
          `SELECT m.contact_id, c.email
           FROM contact_reconciliation_members m
           JOIN contacts c ON c.id = m.contact_id
           WHERE m.run_id = $1
             AND 'EMAIL_UNVALIDATED' = ANY(m.quality_signal_codes)
             AND NOT ('DNC_GLOBAL' = ANY(m.quality_signal_codes))
             AND NOT ('AUTO_CONTACT_BLOCKED' = ANY(m.quality_signal_codes))`,
          [runId],
        );

        const allMembers = membersR.rows as Array<{ contact_id: number; email: string | null }>;

        // Count DNC/blocked skipped
        const dncSkippedR = await pool.query(
          `SELECT COUNT(*)::int AS n FROM contact_reconciliation_members
           WHERE run_id = $1
             AND 'EMAIL_UNVALIDATED' = ANY(quality_signal_codes)
             AND (
               'DNC_GLOBAL' = ANY(quality_signal_codes)
               OR 'AUTO_CONTACT_BLOCKED' = ANY(quality_signal_codes)
             )`,
          [runId],
        );
        const dncSkipped = dncSkippedR.rows[0]?.n ?? 0;

        // Run local pre-filter
        const contacts = allMembers.map(r => ({ contactId: r.contact_id, email: r.email }));
        const preFilter = await runEmailPreFilter(contacts);

        // Collect passing contact IDs for ZeroBounce
        const passingIds = preFilter.outcomes
          .filter(o => o.gate === "pass")
          .map(o => o.contactId);

        // Helper: mark the remediation operation failed and re-throw.
        async function failOperation(reason: string, err: unknown): Promise<never> {
          await pool.query(
            `UPDATE contact_remediation_operations
             SET status = 'failed', completed_at = now(),
                 result_summary = jsonb_set(COALESCE(result_summary, '{}'), '{failure_reason}', $1)
             WHERE id = $2`,
            [JSON.stringify(reason), opId],
          );
          throw err;
        }

        let zbQueued = 0;
        let zbResult: any = null;

        if (passingIds.length > 0) {
          // Delegate to canonical ZB authority (via internal call to the validate-emails-batch logic).
          // INVARIANT: the campaign we create must have filter_definition.contactIds = passingIds so
          // the worker validates exactly those contacts, not an unrelated cohort.
          const { checkZeroBounceBudget } = await import("../services/zerobounce-daily-limiter");
          const { markStaleRunsInterrupted } = await import("../services/zerobounce-campaign-worker");
          const { enqueueZeroBounceRun } = await import("../services/queue-manager");
          const { buildZbEligibilityWhere } = await import("../services/zerobounce-eligibility");

          const isZbConfigured = !!process.env.ZEROBOUNCE_API_KEY;
          if (!isZbConfigured) {
            zbResult = { skipped: true, reason: "ZeroBounce not configured" };
          } else {
            const budget = await checkZeroBounceBudget();
            if (!budget.allowed) {
              zbResult = { skipped: true, reason: `Daily cap reached (${budget.used}/${budget.limit})` };
            } else {
              await markStaleRunsInterrupted();

              // Check for an existing active campaign. We must NOT reuse one whose
              // filter_definition does not contain our exact passingIds — its worker will
              // validate a different cohort and our counts would be wrong.
              const existingCampaign = (await pool.query(
                `SELECT id, filter_definition FROM zerobounce_campaigns WHERE status = 'active' LIMIT 1`,
              )).rows[0];

              if (existingCampaign) {
                // An active campaign already exists. Report it as busy — do not reuse
                // it, because its filter_definition may select a different cohort.
                const existingRunning = (await pool.query(
                  `SELECT id FROM zerobounce_runs WHERE campaign_id = $1 AND state = 'running' LIMIT 1`,
                  [existingCampaign.id],
                )).rows[0];
                zbResult = {
                  skipped: true,
                  reason: "An existing ZeroBounce campaign is active. Retry after it completes.",
                  activeCampaignId: existingCampaign.id,
                  existingRunId: existingRunning?.id ?? null,
                };
              } else {
                // No active campaign — create one with the exact passing contact IDs.
                const filter = { issue: "unvalidated_email", minLeadScore: 0, contactIds: passingIds };
                const countR = await pool.query(
                  `SELECT COUNT(*)::int AS n FROM contacts WHERE ${buildZbEligibilityWhere(filter)}`,
                );
                const initialTotal = countR.rows[0]?.n ?? 0;
                const ins = await pool.query(
                  `INSERT INTO zerobounce_campaigns (filter_definition, initial_eligible_total, created_by)
                   VALUES ($1::jsonb, $2, $3)
                   ON CONFLICT DO NOTHING RETURNING *`,
                  [JSON.stringify(filter), initialTotal, actorId],
                );

                // If the insert raced and lost, another process created an incompatible campaign.
                // Fail the operation so the caller can retry after that campaign completes.
                const campaign = ins.rows[0];
                if (!campaign) {
                  zbResult = { skipped: true, reason: "Concurrent campaign creation race; retry after existing campaign completes." };
                } else {
                  // Insert the run. Partial unique index closes the remaining race.
                  let zbRun: any;
                  try {
                    zbRun = (await pool.query(
                      `INSERT INTO zerobounce_runs (campaign_id, contact_limit, state, last_heartbeat_at)
                       VALUES ($1, $2, 'running', NOW()) RETURNING *`,
                      [campaign.id, passingIds.length],
                    )).rows[0];
                  } catch (runInsErr: any) {
                    if (runInsErr?.code === "23505") {
                      const winner = (await pool.query(
                        `SELECT id FROM zerobounce_runs WHERE campaign_id = $1 AND state = 'running' LIMIT 1`,
                        [campaign.id],
                      )).rows[0];
                      zbResult = { alreadyRunning: true, zbRunId: winner?.id ?? null, campaignId: campaign.id };
                    } else {
                      throw runInsErr;
                    }
                  }

                  if (zbRun) {
                    // Enqueue the BullMQ job. Failure here must mark the ZB run interrupted
                    // AND the remediation operation failed — never silently swallow.
                    let bullJobId: string | null = null;
                    try {
                      bullJobId = await enqueueZeroBounceRun(zbRun.id);
                    } catch (enqErr) {
                      await pool.query(
                        `UPDATE zerobounce_runs SET state = 'interrupted', stop_reason = 'enqueue_failed', finished_at = NOW() WHERE id = $1`,
                        [zbRun.id],
                      );
                      await failOperation("Background queue unavailable; ZeroBounce run not started. Retry.", enqErr);
                    }
                    if (!bullJobId) {
                      await pool.query(
                        `UPDATE zerobounce_runs SET state = 'interrupted', stop_reason = 'enqueue_failed', finished_at = NOW() WHERE id = $1`,
                        [zbRun.id],
                      );
                      await failOperation("Background queue returned no job ID. Retry.", new Error("enqueueZeroBounceRun returned null"));
                    }
                    await pool.query(`UPDATE zerobounce_runs SET bull_job_id = $1 WHERE id = $2`, [bullJobId, zbRun.id]);
                    zbQueued = passingIds.length;
                    zbResult = { zbRunId: zbRun.id, campaignId: campaign.id, queued: passingIds.length };
                  }
                }
              }
            }
          }
        }

        const resultSummary = {
          eligible: allMembers.length,
          locally_syntax_rejected: preFilter.counts.syntax_rejected,
          locally_placeholder_rejected: preFilter.counts.placeholder_rejected,
          no_mx_authoritative: preFilter.counts.no_mx_authoritative,
          disposable_rejected: preFilter.counts.disposable_rejected,
          dns_indeterminate: preFilter.counts.dns_indeterminate,
          dnc_skipped: dncSkipped,
          already_blocked_skipped: 0,
          zb_queued: zbQueued,
          zb_result: zbResult,
          failed: 0,
        };

        await pool.query(
          `UPDATE contact_remediation_operations
           SET status = 'completed', completed_at = now(), result_summary = $1
           WHERE id = $2`,
          [JSON.stringify(resultSummary), opId],
        );

        res.json({ operationId: opId, status: "completed", resultSummary });
      } catch (err) {
        // Ensure operation is transitioned to 'failed' on any unhandled exception,
        // so the partial unique index doesn't permanently block retries.
        if (_validateOpId) {
          try {
            await pool.query(
              `UPDATE contact_remediation_operations
               SET status = 'failed', completed_at = now()
               WHERE id = $1 AND status = 'running'`,
              [_validateOpId],
            );
          } catch { /* best-effort */ }
        }
        serverError(res, err, "remediation validate-emails");
      }
    },
  );

  // ── POST /api/admin/reconciliation/runs/:runId/remediation/suppress-fake-phones
  // Idempotent. Sets do_not_auto_contact = true for PHONE_PLACEHOLDER / PHONE_MALFORMED
  // contacts via the canonical consent authority. Does NOT set do_not_contact.
  app.post(
    "/api/admin/reconciliation/runs/:runId/remediation/suppress-fake-phones",
    requireRole("admin"),
    async (req, res) => {
      const runId = validateRunId(req.params.runId, res);
      if (!runId) return;
      try {
        const actorId = String((req.user as any)?.id ?? "system");
        const runR = await pool.query(
          `SELECT id, status, rules_version FROM contact_reconciliation_runs WHERE id = $1`,
          [runId],
        );
        if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });
        const recon = runR.rows[0];
        if (recon.rules_version !== "quality-v1") {
          return res.status(400).json({ error: "Remediation requires a quality-v1 run" });
        }

        // Idempotency
        const existingOp = (await pool.query(
          `SELECT id, status, result_summary FROM contact_remediation_operations
           WHERE run_id = $1 AND signal_code = 'PHONE_PLACEHOLDER' AND operation_type = 'suppress_fake_phones'
             AND status IN ('pending','running')
           LIMIT 1`,
          [runId],
        )).rows[0];
        if (existingOp) {
          return res.json({ operationId: existingOp.id, status: existingOp.status, alreadyRunning: true, resultSummary: existingOp.result_summary });
        }

        let opId: string;
        try {
          const ins = await pool.query(
            `INSERT INTO contact_remediation_operations
               (run_id, signal_code, operation_type, status, initiated_by)
             VALUES ($1, 'PHONE_PLACEHOLDER', 'suppress_fake_phones', 'running', $2)
             RETURNING id`,
            [runId, actorId],
          );
          opId = ins.rows[0].id;
        } catch (insErr: any) {
          if (insErr?.code === "23505") {
            const winner = (await pool.query(
              `SELECT id, status, result_summary FROM contact_remediation_operations
               WHERE run_id = $1 AND signal_code = 'PHONE_PLACEHOLDER' AND operation_type = 'suppress_fake_phones'
                 AND status IN ('pending','running')
               LIMIT 1`,
              [runId],
            )).rows[0];
            if (winner) return res.json({ operationId: winner.id, status: winner.status, alreadyRunning: true, resultSummary: winner.result_summary });
          }
          throw insErr;
        }

        // Load the fake-phone cohort (PHONE_PLACEHOLDER OR PHONE_MALFORMED)
        const membersR = await pool.query(
          `SELECT m.contact_id, c.do_not_auto_contact
           FROM contact_reconciliation_members m
           JOIN contacts c ON c.id = m.contact_id
           WHERE m.run_id = $1
             AND (
               'PHONE_PLACEHOLDER' = ANY(m.quality_signal_codes)
               OR 'PHONE_MALFORMED' = ANY(m.quality_signal_codes)
             )`,
          [runId],
        );

        const allContacts = membersR.rows as Array<{ contact_id: number; do_not_auto_contact: boolean }>;
        const toSuppress = allContacts.filter(r => !r.do_not_auto_contact);
        const alreadyBlocked = allContacts.length - toSuppress.length;

        let suppressed = 0;
        let failed = 0;

        // Apply via canonical consent authority — one command per contact in a batch.
        // Audit rows are written by applyConsentCommand internally.
        for (const contact of toSuppress) {
          try {
            await applyConsentCommand({
              subject: { type: "contact", id: contact.contact_id },
              kind: "block_auto_contact",
              eventNamespace: "bulk_remediation",
              eventKey: `remediation:${opId}:contact:${contact.contact_id}`,
              source: "quality_signal_remediation",
              actorId,
              evidence: {
                operationId: opId,
                runId,
                suppressionReason: "fake_phone_detected",
                signalCodes: ["PHONE_PLACEHOLDER", "PHONE_MALFORMED"],
              },
            });
            suppressed++;
          } catch {
            failed++;
          }
        }

        const resultSummary = {
          eligible: allContacts.length,
          already_blocked_skipped: alreadyBlocked,
          suppressed,
          failed,
          dnc_skipped: 0,
        };

        await pool.query(
          `UPDATE contact_remediation_operations
           SET status = 'completed', completed_at = now(), result_summary = $1
           WHERE id = $2`,
          [JSON.stringify(resultSummary), opId],
        );

        res.json({ operationId: opId, status: "completed", resultSummary });
      } catch (err) {
        serverError(res, err, "remediation suppress-fake-phones");
      }
    },
  );

  // ── GET /api/admin/reconciliation/runs/:runId/remediation/:operationId ───
  app.get(
    "/api/admin/reconciliation/runs/:runId/remediation/:operationId",
    requireRole("admin"),
    async (req, res) => {
      const runId = validateRunId(req.params.runId, res);
      if (!runId) return;
      const opId = req.params.operationId;
      try {
        const r = await pool.query(
          `SELECT id, run_id, signal_code, operation_type, status, initiated_by,
                  created_at, completed_at, result_summary
           FROM contact_remediation_operations
           WHERE id = $1 AND run_id = $2`,
          [opId, runId],
        );
        if (r.rows.length === 0) return res.status(404).json({ error: "Operation not found" });
        res.json(r.rows[0]);
      } catch (err) {
        serverError(res, err, "remediation operation status");
      }
    },
  );

  // ── GET /api/admin/reconciliation/runs/:runId/summary ────────────────────
  app.get("/api/admin/reconciliation/runs/:runId/summary", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const [runR, laneR, proposalR, orgR, clusterR] = await Promise.all([
        pool.query(
          `SELECT status, total_processed, total_proposed, total_org_candidates, total_clusters,
                  source_census_run_id, environment_label, completed_at, created_at,
                  rules_version, quality_flagged_contacts, quality_signal_instances,
                  suppressed_cosmetic_candidates, quality_signal_counts
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

  // ── GET /api/admin/reconciliation/runs/:runId/quality-summary ────────────
  // Returns per-signal breakdown for quality-v1 runs.
  app.get("/api/admin/reconciliation/runs/:runId/quality-summary", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const runR = await pool.query(
        `SELECT status, rules_version, total_processed,
                quality_flagged_contacts, quality_signal_instances,
                suppressed_cosmetic_candidates, quality_signal_counts,
                source_census_run_id, environment_label, completed_at, created_at
         FROM contact_reconciliation_runs WHERE id = $1`,
        [runId],
      );
      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const run = runR.rows[0];
      // Use denominator_at_start from the frozen census run (authoritative count of
      // eligible contacts at the time the census was taken), not total_processed
      // (which may differ if archived contacts were filtered during processing).
      const censusR2 = await pool.query(
        `SELECT denominator_at_start FROM contact_census_runs WHERE id = $1`,
        [run.source_census_run_id],
      );
      const denominator = censusR2.rows.length > 0
        ? parseInt(censusR2.rows[0].denominator_at_start ?? "0", 10)
        : parseInt(run.total_processed ?? "0", 10);
      const signalCounts: Record<string, number> = run.quality_signal_counts ?? {};

      // Build canonical signal rows for all 26 codes.
      // For in-progress runs we derive live counts from member rows.
      let liveCounts: Record<string, number> | null = null;
      if (run.status !== "completed") {
        const liveR = await pool.query(
          `SELECT unnest(quality_signal_codes) AS code, COUNT(*) AS n
           FROM contact_reconciliation_members WHERE run_id = $1
           GROUP BY 1`,
          [runId],
        );
        liveCounts = {};
        for (const row of liveR.rows) liveCounts[row.code as string] = parseInt(row.n, 10);
      }

      const effectiveCounts = liveCounts ?? signalCounts;

      const signals = ALL_QUALITY_SIGNAL_CODES.map((code) => {
        const count = effectiveCounts[code] ?? 0;
        return {
          code,
          severity: SIGNAL_SEVERITY[code],
          description: SIGNAL_DESCRIPTIONS[code],
          instanceCount: count,
          contactCount: count, // distinct-contact counts require a separate aggregation; populated on completion
          pct: denominator > 0 ? Number(((count / denominator) * 100).toFixed(2)) : 0,
        };
      }).filter((s) => s.instanceCount > 0);

      // For completed runs: query distinct-contact counts per signal
      if (run.status === "completed") {
        const distinctR = await pool.query(
          `SELECT unnest(quality_signal_codes) AS code, COUNT(DISTINCT contact_id) AS n
           FROM contact_reconciliation_members WHERE run_id = $1
           GROUP BY 1`,
          [runId],
        );
        const distinctMap: Record<string, number> = {};
        for (const row of distinctR.rows) distinctMap[row.code as string] = parseInt(row.n, 10);
        for (const s of signals) s.contactCount = distinctMap[s.code] ?? s.instanceCount;
      }

      // Historical proposal count (all runs, not scoped to this run)
      const histR = await pool.query(
        `SELECT COUNT(*) AS n FROM contact_normalization_proposals
         WHERE run_id != $1`,
        [runId],
      );

      res.json({
        runId,
        rulesVersion: run.rules_version,
        status: run.status,
        environmentLabel: run.environment_label,
        sourceCensusRunId: run.source_census_run_id,
        denominator,
        processedContacts: parseInt(run.total_processed ?? "0", 10),
        contactsWithAnySignal: parseInt(run.quality_flagged_contacts ?? "0", 10),
        qualitySignalInstances: parseInt(run.quality_signal_instances ?? "0", 10),
        suppressedCosmeticCandidates: parseInt(run.suppressed_cosmetic_candidates ?? "0", 10),
        historicalProposals: parseInt(histR.rows[0].n, 10),
        signals,
        completedAt: run.completed_at,
        createdAt: run.created_at,
      });
    } catch (err) {
      serverError(res, err, "quality summary");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/quality-members ────────────
  // Paginated list of members with a given quality signal code.
  app.get("/api/admin/reconciliation/runs/:runId/quality-members", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;

    const { signal_code, cursor: cursorParam, limit: limitParam } = req.query as Record<string, string>;

    // Allowlist signal codes
    if (!signal_code) {
      return res.status(400).json({ error: "signal_code is required" });
    }
    if (!QUALITY_SIGNAL_CODE_SET.has(signal_code)) {
      return res.status(400).json({ error: `Invalid signal_code. Must be one of: ${ALL_QUALITY_SIGNAL_CODES.join(", ")}` });
    }

    const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 200);
    const cursor = parseInt(cursorParam ?? "0", 10) || 0;

    try {
      const r = await pool.query(
        `SELECT m.id, m.contact_id, m.primary_lane, m.census_lane,
                m.quality_signal_codes, m.quality_signal_details,
                c.first_name, c.last_name, c.company_name
         FROM contact_reconciliation_members m
         JOIN contacts c ON c.id = m.contact_id
         WHERE m.run_id = $1
           AND $2 = ANY(m.quality_signal_codes)
           AND m.id > $3
         ORDER BY m.id ASC
         LIMIT $4`,
        [runId, signal_code, cursor, limit + 1],
      );

      const hasMore = r.rows.length > limit;
      const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
      const nextCursor = hasMore ? rows[rows.length - 1].id : null;

      res.json({
        members: rows.map((row) => ({
          memberId: row.id,
          contactId: row.contact_id,
          primaryLane: row.primary_lane,
          censusLane: row.census_lane,
          signalCodes: row.quality_signal_codes ?? [],
          signalDetails: row.quality_signal_details ?? {},
          firstName: row.first_name || null,
          lastName: row.last_name || null,
          companyName: row.company_name || null,
        })),
        nextCursor,
        hasMore,
      });
    } catch (err) {
      serverError(res, err, "quality members");
    }
  });

  // ── GET /api/admin/reconciliation/runs/:runId/clusters ───────────────────
  // Scoped to the selected reconciliation run (not the identity-crosswalk run).
  app.get("/api/admin/reconciliation/runs/:runId/clusters", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10) || 50, 200);
    const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10) || 0, 0);
    try {
      const [clusterR, totalR] = await Promise.all([
        pool.query(
          `SELECT id, cluster_key, cluster_reason, created_at
           FROM contact_duplicate_clusters
           WHERE run_id = $1
           ORDER BY created_at ASC
           LIMIT $2 OFFSET $3`,
          [runId, limit, offset],
        ),
        pool.query(
          `SELECT COUNT(*) AS n FROM contact_duplicate_clusters WHERE run_id = $1`,
          [runId],
        ),
      ]);

      res.json({
        clusters: clusterR.rows,
        total: parseInt(totalR.rows[0].n, 10),
        limit,
        offset,
      });
    } catch (err) {
      serverError(res, err, "reconciliation clusters");
    }
  });

  // ── GET /api/admin/reconciliation/clusters/:clusterId/members ────────────
  app.get("/api/admin/reconciliation/clusters/:clusterId/members", requireRole("admin"), async (req, res) => {
    const clusterId = validateClusterId(req.params.clusterId, res);
    if (!clusterId) return;
    try {
      const r = await pool.query(
        `SELECT m.contact_id, c.first_name, c.last_name, c.email, c.phone, c.company_name
         FROM contact_duplicate_cluster_members m
         JOIN contacts c ON c.id = m.contact_id
         WHERE m.cluster_id = $1
         ORDER BY m.contact_id ASC`,
        [clusterId],
      );
      res.json({ members: r.rows });
    } catch (err) {
      serverError(res, err, "cluster members");
    }
  });

  // ── POST /api/admin/reconciliation/quality-preview ───────────────────────
  // Bounded dry-run preview (≤5000 contacts, deterministic stratified sample).
  // Operates directly on a completed census run — no reconciliation run required.
  // Read-only. No inserts. No mutations. No external provider calls.
  //
  // Returns an acceptanceToken that must be passed to POST /runs as
  // previewAcceptanceToken to start a full quality-v1 run. The token is stored
  // in system_settings keyed to the source census run ID and is valid for 24 h.
  //
  // This census-scoped endpoint breaks the circular dependency that would arise
  // if preview required an existing quality-v1 run (which itself requires a token).
  app.post("/api/admin/reconciliation/quality-preview", requireRole("admin"), async (req, res) => {
    const { censusRunId } = req.body as { censusRunId?: string };
    if (!censusRunId || !isUUIDv4(censusRunId)) {
      return res.status(400).json({ error: "censusRunId must be a valid UUID v4" });
    }
    const PREVIEW_LIMIT = 5000;
    try {
      // Verify the census run exists and is completed
      const censusCheckR = await pool.query(
        `SELECT id, status FROM contact_census_runs WHERE id = $1`,
        [censusRunId],
      );
      if (censusCheckR.rows.length === 0) return res.status(404).json({ error: "Census run not found" });
      if (censusCheckR.rows[0].status !== "completed") {
        return res.status(409).json({ error: "Census run must be in 'completed' status" });
      }

      const sourceCensusRunId = censusRunId;

      const { pool: dbPool } = await import("../db");
      const client = await dbPool.connect();
      try {
        // ── Shared cohorts (normalized NANP before grouping) ──────────────────
        const [sharedPhoneRows, sharedEmailRows] = await Promise.all([
          // Wrap in subquery — PostgreSQL does not allow SELECT aliases in HAVING.
          client.query(`
            SELECT normalized_phone, contact_count, domain_count
            FROM (
              SELECT
                CASE
                  WHEN length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 11
                       AND left(regexp_replace(c.phone, '[^0-9]', '', 'g'), 1) = '1'
                  THEN right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
                  WHEN length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 10
                  THEN regexp_replace(c.phone, '[^0-9]', '', 'g')
                END AS normalized_phone,
                COUNT(DISTINCT c.id) AS contact_count,
                COUNT(DISTINCT lower(split_part(c.email, '@', 2)))
                  FILTER (WHERE c.email IS NOT NULL AND TRIM(c.email) <> '') AS domain_count
              FROM contact_census_members ccm
              JOIN contacts c ON c.id = ccm.contact_id
              WHERE ccm.run_id = $1
                AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''
                AND c.archived_at IS NULL
              GROUP BY normalized_phone
            ) sub
            WHERE normalized_phone IS NOT NULL AND contact_count > 1
          `, [sourceCensusRunId]),
          client.query(`
            SELECT lower(trim(c.email)) AS normalized_email,
                   COUNT(DISTINCT c.id) AS contact_count,
                   COUNT(DISTINCT lower(split_part(c.email, '@', 2))) AS domain_count
            FROM contact_census_members ccm
            JOIN contacts c ON c.id = ccm.contact_id
            WHERE ccm.run_id = $1
              AND c.email IS NOT NULL AND TRIM(c.email) <> ''
              AND c.archived_at IS NULL
            GROUP BY lower(trim(c.email)) HAVING COUNT(DISTINCT c.id) > 1
          `, [sourceCensusRunId]),
        ]);

        const { buildQualityRunContext: buildCtx, classifyContactQuality: classify } = await import("../services/contact-quality-signals");
        const qualityCtx = buildCtx(
          new Date(),
          sharedPhoneRows.rows.map((row: any) => ({
            normalized_phone: row.normalized_phone as string,
            contact_count: parseInt(row.contact_count, 10),
            domain_count: parseInt(row.domain_count, 10),
          })),
          sharedEmailRows.rows.map((r: any) => ({
            normalized_email: r.normalized_email,
            contact_count: parseInt(r.contact_count, 10),
            domain_count: parseInt(r.domain_count, 10),
          })),
        );

        // ── Deterministic stratified sample ───────────────────────────────────
        // Take a proportional slice from each distinct census lane by ID order.
        // This ensures every lane (actives, suppressed, DNC, etc.) is represented
        // even when one lane dominates the census by count.
        const sampleR = await client.query(`
          WITH lane_alloc AS (
            SELECT
              primary_lane,
              COUNT(*) AS lane_total,
              GREATEST(1, ROUND(COUNT(*) * $2::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0))) AS lane_take
            FROM contact_census_members
            WHERE run_id = $1
            GROUP BY primary_lane
          ),
          ranked AS (
            SELECT
              ccm.contact_id, ccm.primary_lane, ccm.id AS member_id,
              ROW_NUMBER() OVER (PARTITION BY ccm.primary_lane ORDER BY ccm.id ASC) AS rn
            FROM contact_census_members ccm
            WHERE ccm.run_id = $1
          )
          SELECT
            r.contact_id, r.primary_lane AS census_lane,
            c.first_name, c.last_name, c.email, c.phone, c.company_name,
            c.email_status, c.email_validation_updated_at,
            c.do_not_contact, c.do_not_auto_contact, c.dnc_reason, c.dnc_date,
            c.suppression_reason, c.opted_out_email, c.opt_out_status, c.unsubscribe_status,
            c.bounce_status, c.complaint_status, c.sms_status, c.sms_consent_status,
            c.consent_tier, c.next_allowed_contact_date, c.business_id
          FROM ranked r
          JOIN lane_alloc la ON la.primary_lane = r.primary_lane
          JOIN contacts c ON c.id = r.contact_id
          WHERE r.rn <= la.lane_take
            AND c.archived_at IS NULL
          ORDER BY r.primary_lane, r.contact_id
          LIMIT $2
        `, [sourceCensusRunId, PREVIEW_LIMIT]);

        const batchIds = sampleR.rows.map((r: any) => r.contact_id as number);
        // Crosswalk (read-only set-based)
        let cwMap = new Map<number, "candidate" | "conflict">();
        if (batchIds.length > 0) {
          const cwR = await client.query(`
            SELECT cis.existing_fk_contact_id AS contact_id,
                   COUNT(DISTINCT cid.id) FILTER (WHERE cid.decision='approved' AND NOT cid.stale_at_decision) AS approved_count,
                   COUNT(DISTINCT cand.id) FILTER (WHERE cid.decision='approved' AND NOT cid.stale_at_decision AND cand.candidate_type='business') AS biz_count
            FROM contact_identity_subjects cis
            JOIN contact_identity_reconciliation_runs cirr ON cirr.id=cis.run_id AND cirr.status='completed'
            LEFT JOIN contact_identity_decisions cid ON cid.subject_id=cis.id
            LEFT JOIN contact_identity_candidates cand ON cand.id=cid.candidate_id
            WHERE cis.existing_fk_contact_id = ANY($1::int[])
            GROUP BY cis.existing_fk_contact_id
          `, [batchIds]);
          for (const row of cwR.rows) {
            const cid = parseInt(row.contact_id, 10);
            if (parseInt(row.biz_count, 10) > 1) cwMap.set(cid, "conflict");
            else if (parseInt(row.approved_count, 10) > 0 && parseInt(row.biz_count, 10) >= 1) cwMap.set(cid, "candidate");
          }
        }

        // ── Classify (pure function — no writes, no provider calls) ───────────
        const signalCounts: Record<string, number> = {};
        let flaggedCount = 0;
        let instanceCount = 0;

        for (const raw of sampleR.rows) {
          const result = classify({
            contactId: raw.contact_id,
            firstName: raw.first_name || null,
            lastName: raw.last_name || null,
            phone: raw.phone || null,
            email: raw.email || null,
            emailStatus: raw.email_status || null,
            emailValidationUpdatedAt: raw.email_validation_updated_at ? new Date(raw.email_validation_updated_at) : null,
            doNotContact: raw.do_not_contact ?? false,
            doNotAutoContact: raw.do_not_auto_contact ?? false,
            dncReason: raw.dnc_reason || null,
            dncDate: raw.dnc_date ? new Date(raw.dnc_date) : null,
            suppressionReason: raw.suppression_reason || null,
            optedOutEmail: raw.opted_out_email ?? null,
            optOutStatus: raw.opt_out_status || null,
            unsubscribeStatus: raw.unsubscribe_status || null,
            bounceStatus: raw.bounce_status || null,
            complaintStatus: raw.complaint_status || null,
            smsStatus: raw.sms_status || null,
            smsConsentStatus: raw.sms_consent_status || null,
            consentTier: raw.consent_tier || null,
            nextAllowedContactDate: raw.next_allowed_contact_date ? new Date(raw.next_allowed_contact_date) : null,
            businessId: raw.business_id != null ? parseInt(raw.business_id) : null,
            companyName: raw.company_name || null,
            crosswalkDecisionType: cwMap.get(raw.contact_id as number) ?? "none",
          }, qualityCtx);

          if (result.signalCodes.length > 0) flaggedCount++;
          instanceCount += result.signalCodes.length;
          for (const code of result.signalCodes) {
            signalCounts[code] = (signalCounts[code] ?? 0) + 1;
          }
        }

        // ── Generate acceptance token and persist to system_settings ──────────
        // The token gates starting a full quality-v1 run. Stored under a key
        // scoped to the source census run so each census requires its own preview.
        const tokenPayload = {
          sourceCensusRunId,
          previewKind: "census-scoped",
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          contactsScanned: sampleR.rows.length,
        };
        const tokenJson = JSON.stringify(tokenPayload);
        const settingsKey = `quality_v1_preview_accepted:${sourceCensusRunId}`;
        await client.query(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [settingsKey, tokenJson],
        );

        res.json({
          previewKind: "dry-run-read-only-stratified",
          contactsScanned: sampleR.rows.length,
          contactsWithAnySignal: flaggedCount,
          signalInstances: instanceCount,
          signalCounts,
          cosmeticProposals: 0,
          canonicalMutations: 0,
          acceptanceToken: settingsKey,
          note: "Preview complete. Call POST /runs with rulesVersion=quality-v1 and previewAcceptanceToken to start a full run.",
        });
      } finally {
        client.release();
      }
    } catch (err) {
      serverError(res, err, "quality preview");
    }
  });
}
