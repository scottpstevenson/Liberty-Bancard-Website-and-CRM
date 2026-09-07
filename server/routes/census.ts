/**
 * Contact Census API routes — admin-only.
 *
 * All state-changing endpoints require:
 *   - isDashboardUser (session check)
 *   - requireRole('admin')
 *   - CSRF token (handled by global middleware)
 *
 * No PII exposed in census member rows.
 */

import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { serverError } from "../utils/server-error";
import {
  createAndStartRun,
  getCensusPreview,
  hasAnyActiveRun,
  isRunActive,
} from "../services/contact-census-runner";

export function registerCensusRoutes(app: Express): void {

  // ── GET /api/admin/census/preview ──────────────────────────────────────────
  // Returns counts without creating a run. Must respond within 5 seconds.
  app.get("/api/admin/census/preview", requireRole("admin"), async (_req, res) => {
    try {
      const preview = await getCensusPreview();
      res.json(preview);
    } catch (err) {
      serverError(res, err, "census preview");
    }
  });

  // ── POST /api/admin/census/runs ────────────────────────────────────────────
  // Create and start a new census run.
  app.post("/api/admin/census/runs", requireRole("admin"), async (req, res) => {
    try {
      const { environmentLabel } = req.body as {
        environmentLabel?: string;
      };

      const validLabels = [
        "development_preview",
        "production_readonly_preview",
        "frozen_production_snapshot",
      ];
      if (!environmentLabel || !validLabels.includes(environmentLabel)) {
        return res.status(400).json({
          error: `environmentLabel must be one of: ${validLabels.join(", ")}`,
        });
      }

      if (hasAnyActiveRun()) {
        return res.status(409).json({
          error: "A census run is already in progress. Pause or wait for it to complete.",
        });
      }

      const requestedBy = (req.user as any)?.email ?? "admin";
      const runId = await createAndStartRun({
        requestedBy,
        environmentLabel: environmentLabel as any,
        releaseSha: process.env.RELEASE_SHA,
      });

      res.status(201).json({ runId, status: "running" });
    } catch (err: any) {
      if (err.message?.includes("already in progress")) {
        return res.status(409).json({ error: err.message });
      }
      serverError(res, err, "census start run");
    }
  });

  // ── GET /api/admin/census/runs ─────────────────────────────────────────────
  app.get("/api/admin/census/runs", requireRole("admin"), async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
      const offset = parseInt((req.query.offset as string) ?? "0", 10);

      const r = await pool.query(
        `SELECT id, snapshot_type, environment_label, rules_version, release_sha,
                db_identity_token, as_of, requested_by, status, pause_reason,
                denominator_at_start, total_processed, total_excluded, provider_call_count,
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
    try {
      const r = await pool.query(
        `SELECT * FROM contact_census_runs WHERE id = $1`,
        [req.params.runId],
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const run = r.rows[0];
      run.is_active = isRunActive(run.id);
      res.json(run);
    } catch (err) {
      serverError(res, err, "census get run");
    }
  });

  // ── POST /api/admin/census/runs/:runId/pause ───────────────────────────────
  app.post("/api/admin/census/runs/:runId/pause", requireRole("admin"), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE contact_census_runs
         SET status = 'paused', pause_reason = 'Paused by admin request', updated_at = now()
         WHERE id = $1 AND status = 'running'
         RETURNING id, status`,
        [req.params.runId],
      );
      if (r.rows.length === 0) {
        return res.status(409).json({ error: "Run is not currently running" });
      }
      res.json({ runId: req.params.runId, status: "paused" });
    } catch (err) {
      serverError(res, err, "census pause run");
    }
  });

  // ── POST /api/admin/census/runs/:runId/resume ──────────────────────────────
  app.post("/api/admin/census/runs/:runId/resume", requireRole("admin"), async (req, res) => {
    try {
      if (hasAnyActiveRun()) {
        return res.status(409).json({ error: "Another census run is already in progress." });
      }

      const r = await pool.query(
        `UPDATE contact_census_runs
         SET status = 'running', pause_reason = NULL, updated_at = now()
         WHERE id = $1 AND status = 'paused'
         RETURNING id`,
        [req.params.runId],
      );
      if (r.rows.length === 0) {
        return res.status(409).json({ error: "Run is not currently paused" });
      }

      const runId = r.rows[0].id;
      const { executeCensusRun } = await import("../services/contact-census-runner");
      setImmediate(() => executeCensusRun(runId).catch(e => console.error("[CensusRunner] Resume error:", e)));

      res.json({ runId, status: "running" });
    } catch (err) {
      serverError(res, err, "census resume run");
    }
  });

  // ── DELETE /api/admin/census/runs/:runId ───────────────────────────────────
  app.delete("/api/admin/census/runs/:runId", requireRole("admin"), async (req, res) => {
    try {
      await pool.query(
        `UPDATE contact_census_runs
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1 AND status IN ('running','paused','pending')`,
        [req.params.runId],
      );
      res.json({ runId: req.params.runId, status: "cancelled" });
    } catch (err) {
      serverError(res, err, "census cancel run");
    }
  });

  // ── GET /api/admin/census/runs/:runId/lanes ────────────────────────────────
  app.get("/api/admin/census/runs/:runId/lanes", requireRole("admin"), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT primary_lane, COUNT(*) AS count
         FROM contact_census_members WHERE run_id = $1
         GROUP BY primary_lane ORDER BY count DESC`,
        [req.params.runId],
      );
      res.json(r.rows);
    } catch (err) {
      serverError(res, err, "census lanes");
    }
  });

  // ── GET /api/admin/census/runs/:runId/dimensions ──────────────────────────
  app.get("/api/admin/census/runs/:runId/dimensions", requireRole("admin"), async (req, res) => {
    try {
      const runId = req.params.runId;
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
    try {
      const r = await pool.query(
        `SELECT phone_quality_state AS state, COUNT(*) AS count
         FROM contact_census_members WHERE run_id = $1
         GROUP BY 1 ORDER BY count DESC`,
        [req.params.runId],
      );
      res.json(r.rows);
    } catch (err) {
      serverError(res, err, "census phone quality");
    }
  });

  // ── GET /api/admin/census/runs/:runId/members ──────────────────────────────
  app.get("/api/admin/census/runs/:runId/members", requireRole("admin"), async (req, res) => {
    try {
      const { lane, record_class, cursor, limit: limitQ } = req.query as Record<string, string>;
      const limit = Math.min(parseInt(limitQ ?? "50", 10), 500);
      const cursorId = cursor ? parseInt(cursor, 10) : 0;

      const conditions = [`run_id = $1`, `id > $2`];
      const params: unknown[] = [req.params.runId, cursorId];
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

      res.json({ members: r.rows, nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null });
    } catch (err) {
      serverError(res, err, "census members");
    }
  });

  // ── GET /api/admin/census/runs/:runId/sample ───────────────────────────────
  app.get("/api/admin/census/runs/:runId/sample", requireRole("admin"), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT DISTINCT ON (primary_lane) primary_lane, contact_id, gap_codes,
                record_class, identity_state, contactability_state, validation_state,
                compliance_state, has_business_id, has_company_name, has_email,
                has_phone, lead_source
         FROM contact_census_members
         WHERE run_id = $1
         ORDER BY primary_lane, contact_id`,
        [req.params.runId],
      );
      // Get up to 3 per lane
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
    try {
      const runR = await pool.query(
        `SELECT denominator_at_start, total_processed, total_excluded, status,
                mutation_proof_before, mutation_proof_after, provider_call_count
         FROM contact_census_runs WHERE id = $1`,
        [req.params.runId],
      );
      if (runR.rows.length === 0) return res.status(404).json({ error: "Run not found" });

      const run = runR.rows[0];
      const memberCountR = await pool.query(
        `SELECT COUNT(*) AS n FROM contact_census_members WHERE run_id = $1`,
        [req.params.runId],
      );
      const memberCount = parseInt(memberCountR.rows[0].n, 10);

      const denominator = run.denominator_at_start ?? 0;
      const processed = run.total_processed ?? 0;
      const excluded = run.total_excluded ?? 0;
      const reconciles = processed + excluded === denominator;

      res.json({
        denominator,
        totalProcessed: processed,
        totalExcluded: excluded,
        memberRowsActual: memberCount,
        reconciles,
        providerCallCount: run.provider_call_count ?? 0,
        mutationProofBefore: run.mutation_proof_before,
        mutationProofAfter: run.mutation_proof_after,
      });
    } catch (err) {
      serverError(res, err, "census reconciliation");
    }
  });

  // ── GET /api/admin/census/runs/:runId/export ───────────────────────────────
  app.get("/api/admin/census/runs/:runId/export", requireRole("admin"), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT contact_id, primary_lane, gap_codes, record_class, validation_state,
                has_business_id, has_company_name, has_email, has_phone, lead_source
         FROM contact_census_members WHERE run_id = $1 ORDER BY contact_id`,
        [req.params.runId],
      );

      const lines = ["contact_id,primary_lane,gap_codes,record_class,validation_state,has_business_id,has_company_name,has_email,has_phone,lead_source"];
      for (const row of r.rows) {
        lines.push([
          row.contact_id,
          row.primary_lane,
          (row.gap_codes ?? []).join(";"),
          row.record_class,
          row.validation_state,
          row.has_business_id,
          row.has_company_name,
          row.has_email,
          row.has_phone,
          row.lead_source ?? "",
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="census-${req.params.runId.slice(0, 8)}.csv"`);
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
