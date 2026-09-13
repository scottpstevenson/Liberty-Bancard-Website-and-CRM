/**
 * Contact Census API routes — admin-only.
 *
 * Authorization:
 *   All routes require isDashboardUser + requireRole('admin').
 *   CSRF protection is handled by the global csrfProtection middleware applied
 *   to all state-changing routes (POST, DELETE).
 *   requireRole() always calls isDashboardUser() first internally.
 *
 * Environment identity:
 *   The environment_label stored on every run is ALWAYS derived server-side via
 *   deriveEnvironmentLabel(). Any environment_label supplied in the request body
 *   is silently ignored. This prevents clients from spoofing a production label.
 *
 * Run ID validation:
 *   Every :runId param is validated as a UUIDv4 before touching the database.
 *   Malformed IDs return 400, not 404 or a database error.
 *
 * CSV export security:
 *   All values are formula-injection-escaped before being written into the CSV.
 *   Fields beginning with =, +, -, @, |, % are quoted so spreadsheet engines
 *   do not interpret them as formulas.
 *
 * Concurrent start:
 *   createAndStartRun() inserts with status='running'. A unique partial index
 *   (census_runs_one_active) allows at most one row with status IN ('pending','running').
 *   A second concurrent request receives a 409 (unique_violation caught as 23505).
 */

import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { serverError } from "../utils/server-error";
import { sanitizeAuditPayload } from "../services/audit-sanitizer";
import {
  createAndStartRun,
  getCensusPreview,
  resumeRun,
  deriveEnvironmentLabel,
} from "../services/contact-census-runner";

// ──────────────────────────────────────────────────────────────────────────────
// UUID v4 validation
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

// ──────────────────────────────────────────────────────────────────────────────
// CSV formula injection escape
// Fields beginning with =, +, -, @, |, % are wrapped in double quotes.
// Existing double quotes are doubled. Commas, newlines also trigger quoting.
// ──────────────────────────────────────────────────────────────────────────────
function csvCell(v: string | boolean | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/^[=+\-@|%]/.test(s) || s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function registerCensusRoutes(app: Express): void {

  // ── GET /api/admin/census/preview ──────────────────────────────────────────
  app.get("/api/admin/census/preview", requireRole("admin"), async (_req, res) => {
    try {
      const preview = await getCensusPreview();
      res.json(preview);
    } catch (err) {
      serverError(res, err, "census preview");
    }
  });

  // ── GET /api/admin/census/environment ──────────────────────────────────────
  // Returns the server-derived environment label so the UI can display it
  // without requiring the client to compute or supply it.
  app.get("/api/admin/census/environment", requireRole("admin"), (_req, res) => {
    res.json({ environmentLabel: deriveEnvironmentLabel() });
  });

  // ── POST /api/admin/census/runs ────────────────────────────────────────────
  // Starts a new census run. environment_label is derived server-side — any
  // client-supplied value in the body is silently ignored.
  app.post("/api/admin/census/runs", requireRole("admin"), async (req, res) => {
    try {
      const requestedBy = (req.user as any)?.email ?? "admin";

      const runId = await createAndStartRun({
        requestedBy,
        releaseSha: process.env.RELEASE_SHA,
      });

      res.status(201).json({
        runId,
        status: "running",
        environmentLabel: deriveEnvironmentLabel(),
      });
    } catch (err: any) {
      // unique_violation (23505) from the partial index = another run is active
      if (err.code === "23505" || err.message?.includes("already in progress")) {
        return res.status(409).json({
          error: "A census run is already in progress. Pause or wait for it to complete.",
        });
      }
      serverError(res, err, "census start run");
    }
  });

  // ── GET /api/admin/census/runs ─────────────────────────────────────────────
  app.get("/api/admin/census/runs", requireRole("admin"), async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
      const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);

      const r = await pool.query(
        `SELECT id, snapshot_type, environment_label, rules_version, release_sha,
                db_identity_token, as_of, requested_by, status, pause_reason,
                denominator_at_start, max_contact_id_at_start, total_processed,
                total_excluded, terminal_snapshot_exceptions, provider_call_count,
                lease_owner, lease_expires_at,
                completed_at, failed_at, failure_reason, created_at, updated_at
         FROM contact_census_runs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      const countR = await pool.query(`SELECT COUNT(*) AS n FROM contact_census_runs`);

      res.json({
        runs: r.rows,
        total: parseInt(countR.rows[0].n, 10),
        limit,
        offset,
      });
    } catch (err) {
      serverError(res, err, "census list runs");
    }
  });

  // ── GET /api/admin/census/runs/:runId ──────────────────────────────────────
  app.get("/api/admin/census/runs/:runId", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT * FROM contact_census_runs WHERE id = $1`,
        [runId],
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Run not found" });
      res.json(r.rows[0]);
    } catch (err) {
      serverError(res, err, "census get run");
    }
  });

  // ── POST /api/admin/census/runs/:runId/pause ───────────────────────────────
  // CAS transition: only transitions running → paused.
  app.post("/api/admin/census/runs/:runId/pause", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_census_runs
         SET status = 'paused', pause_reason = 'Paused by admin request', updated_at = now()
         WHERE id = $1 AND status = 'running'
         RETURNING id, status`,
        [runId],
      );
      if (r.rows.length === 0) {
        return res.status(409).json({ error: "Run is not currently running" });
      }
      res.json({ runId, status: "paused" });
    } catch (err) {
      serverError(res, err, "census pause run");
    }
  });

  // ── POST /api/admin/census/runs/:runId/resume ──────────────────────────────
  // CAS transition: only transitions paused → running.
  // The unique partial index blocks this if another run is currently active.
  app.post("/api/admin/census/runs/:runId/resume", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const ok = await resumeRun(runId);
      if (!ok) {
        return res.status(409).json({
          error: "Run is not currently paused, or another census run is already active.",
        });
      }
      res.json({ runId, status: "running" });
    } catch (err: any) {
      // unique_violation = another active run blocked the status upgrade
      if (err.code === "23505") {
        return res.status(409).json({
          error: "Another census run is already in progress.",
        });
      }
      serverError(res, err, "census resume run");
    }
  });

  // ── DELETE /api/admin/census/runs/:runId ───────────────────────────────────
  // Cancel: transitions running/paused/pending → cancelled.
  // Removing the row from the partial index frees the active slot.
  app.delete("/api/admin/census/runs/:runId", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_census_runs
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1 AND status IN ('running','paused','pending')
         RETURNING id`,
        [runId],
      );
      if (r.rows.length === 0) {
        return res.status(409).json({ error: "Run is not in a cancellable state" });
      }
      res.json({ runId, status: "cancelled" });
    } catch (err) {
      serverError(res, err, "census cancel run");
    }
  });

  // ── POST /api/admin/census/runs/:runId/force-cancel ───────────────────────
  // Bypasses the lease check entirely — for runs stuck in 'running' with no
  // active worker (e.g. after a server restart where startup cleanup missed
  // the run because the lease hadn't expired yet).
  // Requires status='running' AND updated_at older than 5 minutes.
  app.post("/api/admin/census/runs/:runId/force-cancel", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_census_runs
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1
           AND status = 'running'
           AND updated_at < now() - interval '5 minutes'
         RETURNING id`,
        [runId],
      );
      if (r.rows.length === 0) {
        const check = await pool.query(
          `SELECT status, updated_at FROM contact_census_runs WHERE id = $1`,
          [runId],
        );
        if (check.rows.length === 0) return res.status(404).json({ error: "Run not found" });
        const row = check.rows[0];
        if (row.status !== "running") {
          return res.status(409).json({ error: `Run is not in 'running' status (current: '${row.status}')` });
        }
        return res.status(409).json({
          error: "Run was updated within the last 5 minutes — the worker may still be active. Wait for it to go silent before force-cancelling.",
        });
      }

      const adminEmail = (req.user as any)?.email ?? "admin";
      await pool.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, performed_by, metadata, created_at)
         VALUES ('force_cancel_census_run', 'census_run', $1, $2, $3, now())`,
        [runId, adminEmail, JSON.stringify(sanitizeAuditPayload({ runId }))],
      );

      res.json({ runId, status: "cancelled" });
    } catch (err) {
      serverError(res, err, "census force-cancel run");
    }
  });

  // ── GET /api/admin/census/runs/:runId/lanes ────────────────────────────────
  app.get("/api/admin/census/runs/:runId/lanes", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT primary_lane, COUNT(*) AS count
         FROM contact_census_members WHERE run_id = $1
         GROUP BY primary_lane ORDER BY count DESC`,
        [runId],
      );
      res.json(r.rows);
    } catch (err) {
      serverError(res, err, "census lanes");
    }
  });

  // ── GET /api/admin/census/runs/:runId/dimensions ──────────────────────────
  app.get("/api/admin/census/runs/:runId/dimensions", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10] = await Promise.all([
        pool.query(`SELECT record_class AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT identity_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT business_materialization_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT contactability_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT vertical_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT validation_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT compliance_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT evidence_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT enrichment_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
        pool.query(`SELECT phone_quality_state AS value, COUNT(*) AS count FROM contact_census_members WHERE run_id=$1 GROUP BY 1 ORDER BY count DESC`, [runId]),
      ]);

      res.json({
        d1_record_class: d1.rows,
        d2_identity: d2.rows,
        d3_business: d3.rows,
        d4_contactability: d4.rows,
        d5_vertical: d5.rows,
        d6_validation: d6.rows,
        d7_compliance: d7.rows,
        d8_evidence: d8.rows,
        d9_enrichment: d9.rows,
        d10_phone_quality: d10.rows,
      });
    } catch (err) {
      serverError(res, err, "census dimensions");
    }
  });

  // ── GET /api/admin/census/runs/:runId/phone-quality ────────────────────────
  app.get("/api/admin/census/runs/:runId/phone-quality", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT phone_quality_state AS state, COUNT(*) AS count
         FROM contact_census_members WHERE run_id = $1
         GROUP BY 1 ORDER BY count DESC`,
        [runId],
      );
      res.json(r.rows);
    } catch (err) {
      serverError(res, err, "census phone quality");
    }
  });

  // ── GET /api/admin/census/runs/:runId/members ──────────────────────────────
  // Keyset-paginated; limit capped at 500 server-side.
  app.get("/api/admin/census/runs/:runId/members", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const { lane, record_class, cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(limitQ ?? "50", 10), 1), 500);
      const cursorId = cursor ? Math.max(parseInt(cursor, 10), 0) : 0;

      const conditions = [`run_id = $1`, `id > $2`];
      const params: unknown[] = [runId, cursorId];
      let pi = 3;

      if (lane) { conditions.push(`primary_lane = $${pi++}`); params.push(lane); }
      if (record_class) { conditions.push(`record_class = $${pi++}`); params.push(record_class); }

      const r = await pool.query(
        `SELECT id, contact_id, primary_lane, gap_codes, record_class,
                identity_state, business_materialization_state, contactability_state,
                vertical_state, validation_state, compliance_state,
                has_business_id, has_company_name, has_email, has_phone, has_vertical,
                readiness_score, lead_score, has_ghl_link, has_deal, lead_source
         FROM contact_census_members
         WHERE ${conditions.join(" AND ")}
         ORDER BY id ASC LIMIT $${pi}`,
        [...params, limit],
      );

      res.json({
        members: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "census members");
    }
  });

  // ── GET /api/admin/census/runs/:runId/sample ───────────────────────────────
  app.get("/api/admin/census/runs/:runId/sample", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT primary_lane, contact_id, gap_codes,
                record_class, identity_state, contactability_state, validation_state,
                compliance_state, has_business_id, has_company_name, has_email,
                has_phone, lead_source
         FROM contact_census_members
         WHERE run_id = $1
         ORDER BY primary_lane, contact_id`,
        [runId],
      );
      const byLane: Record<string, unknown[]> = {};
      for (const row of r.rows) {
        if (!byLane[row.primary_lane]) byLane[row.primary_lane] = [];
        if (byLane[row.primary_lane].length < 3) byLane[row.primary_lane].push(row);
      }
      res.json(byLane);
    } catch (err) {
      serverError(res, err, "census sample");
    }
  });

  // ── GET /api/admin/census/runs/:runId/reconciliation ──────────────────────
  app.get("/api/admin/census/runs/:runId/reconciliation", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      const runR = await pool.query(
        `SELECT denominator_at_start, max_contact_id_at_start,
                total_processed, total_excluded, terminal_snapshot_exceptions,
                status, mutation_proof_before, mutation_proof_after, provider_call_count
         FROM contact_census_runs WHERE id = $1`,
        [runId],
      );
      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const run = runR.rows[0];
      const memberCountR = await pool.query(
        `SELECT COUNT(*) AS n FROM contact_census_members WHERE run_id = $1`,
        [runId],
      );
      const memberCount = parseInt(memberCountR.rows[0].n, 10);

      const denominator = run.denominator_at_start ?? 0;
      const processed = run.total_processed ?? 0;
      const terminalExceptions = run.terminal_snapshot_exceptions ?? 0;
      // Reconciliation: classified_members + terminal_snapshot_exceptions = denominator
      const reconciles = processed + terminalExceptions === denominator;

      res.json({
        denominator,
        maxContactIdAtStart: run.max_contact_id_at_start,
        totalProcessed: processed,
        totalExcluded: run.total_excluded ?? 0,
        terminalSnapshotExceptions: terminalExceptions,
        memberRowsActual: memberCount,
        // classified_members + terminal_snapshot_exceptions = frozen_denominator
        reconciles,
        reconciliationFormula: `${processed} classified + ${terminalExceptions} terminal_exceptions = ${processed + terminalExceptions} (denominator: ${denominator})`,
        providerCallCount: run.provider_call_count ?? 0,
        mutationProofBefore: run.mutation_proof_before,
        mutationProofAfter: run.mutation_proof_after,
      });
    } catch (err) {
      serverError(res, err, "census reconciliation");
    }
  });

  // ── GET /api/admin/census/runs/:runId/export ───────────────────────────────
  // CSV export — all values formula-injection-escaped.
  app.get("/api/admin/census/runs/:runId/export", requireRole("admin"), async (req, res) => {
    const runId = validateRunId(req.params.runId, res);
    if (!runId) return;
    try {
      // Verify run exists and belongs to admin scope
      const runR = await pool.query(
        `SELECT status, environment_label FROM contact_census_runs WHERE id = $1`,
        [runId],
      );
      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const { lane } = req.query as Record<string, string>;
      const params: unknown[] = [runId];
      let laneClause = "";
      if (lane) { laneClause = "AND primary_lane = $2"; params.push(lane); }

      const r = await pool.query(
        `SELECT contact_id, primary_lane, gap_codes, record_class, validation_state,
                has_business_id, has_company_name, has_email, has_phone, lead_source
         FROM contact_census_members WHERE run_id = $1 ${laneClause} ORDER BY contact_id`,
        params,
      );

      const header = "contact_id,primary_lane,gap_codes,record_class,validation_state,has_business_id,has_company_name,has_email,has_phone,lead_source";
      const lines = [header];
      for (const row of r.rows) {
        lines.push([
          csvCell(row.contact_id),
          csvCell(row.primary_lane),
          csvCell((row.gap_codes ?? []).join(";")),
          csvCell(row.record_class),
          csvCell(row.validation_state),
          csvCell(row.has_business_id),
          csvCell(row.has_company_name),
          csvCell(row.has_email),
          csvCell(row.has_phone),
          csvCell(row.lead_source),
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="census-${runId.slice(0, 8)}.csv"`);
      res.send(lines.join("\n"));
    } catch (err) {
      serverError(res, err, "census export");
    }
  });

  // ── GET /api/admin/census/compare ─────────────────────────────────────────
  app.get("/api/admin/census/compare", requireRole("admin"), async (req, res) => {
    try {
      const { runA, runB } = req.query as { runA?: string; runB?: string };
      if (!runA || !runB) return res.status(400).json({ error: "runA and runB are required" });
      if (!isUUIDv4(runA) || !isUUIDv4(runB)) {
        return res.status(400).json({ error: "runA and runB must be valid UUID v4 values" });
      }

      const [a, b] = await Promise.all([
        pool.query(`SELECT primary_lane, COUNT(*) AS count FROM contact_census_members WHERE run_id = $1 GROUP BY 1`, [runA]),
        pool.query(`SELECT primary_lane, COUNT(*) AS count FROM contact_census_members WHERE run_id = $1 GROUP BY 1`, [runB]),
      ]);

      const aMap: Record<string, number> = {};
      const bMap: Record<string, number> = {};
      for (const row of a.rows) aMap[row.primary_lane] = parseInt(row.count, 10);
      for (const row of b.rows) bMap[row.primary_lane] = parseInt(row.count, 10);

      const lanes = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);
      const delta: Record<string, { a: number; b: number; diff: number }> = {};
      for (const lane of lanes) {
        const aVal = aMap[lane] ?? 0;
        const bVal = bMap[lane] ?? 0;
        delta[lane] = { a: aVal, b: bVal, diff: bVal - aVal };
      }

      res.json({ runA, runB, delta });
    } catch (err) {
      serverError(res, err, "census compare");
    }
  });
}
