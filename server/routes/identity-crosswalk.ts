/**
 * Identity Crosswalk API routes — admin-only.
 *
 * Authorization: all routes require requireRole('admin').
 * CSRF protection is applied globally by the existing csrfProtection middleware.
 * Unauthenticated requests → 401 (from requireRole). Authenticated non-admin → 403.
 *
 * Run lifecycle:
 *   POST /runs         — freeze watermarks atomically, then setImmediate to start runner
 *   GET  /runs         — paginated list
 *   GET  /runs/:runId  — detail
 *   POST /runs/:runId/pause   — CAS running→paused
 *   POST /runs/:runId/resume  — CAS paused→running + setImmediate
 *   POST /runs/:runId/cancel  — CAS to cancelled
 *   GET  /subjects             — keyset-paginated subject list
 *   GET  /subjects/:id/candidates — candidates for a subject
 *   POST /candidates/:id/decide   — record an admin decision (append-only)
 *   GET  /vertical-candidates      — paginated vertical candidates
 */

import os from "os";
import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { serverError } from "../utils/server-error";
import {
  executeIdentityRun,
  leaseOwnerTag,
} from "../services/identity-crosswalk-runner";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function isUUID(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{3,4}-[0-9a-f]{12}$/i.test(v);
}

function validateUUID(param: string | string[] | undefined, res: any, label: string): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  if (!v || !isUUID(v)) {
    res.status(400).json({ error: `${label} must be a valid UUID` });
    return null;
  }
  return v;
}

function deriveEnvironment(): string {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const sha = process.env.RELEASE_SHA;
  if (nodeEnv === "production" && sha && sha !== "unknown") return "frozen_production_snapshot";
  if (nodeEnv === "production") return "production_readonly_preview";
  return "development_preview";
}

// ──────────────────────────────────────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────────────────────────────────────
export function registerIdentityCrosswalkRoutes(app: Express): void {

  // ── POST /api/admin/identity-crosswalk/runs ───────────────────────────────
  // Atomically freeze all watermarks, create run, then trigger runner.
  app.post("/api/admin/identity-crosswalk/runs", requireRole("admin"), async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Capture frozen watermarks
      const [sunbiz, prospects, masterLeads, contacts, businesses] = await Promise.all([
        client.query("SELECT MAX(id) AS max_id, COUNT(*) AS cnt FROM sunbiz_entities"),
        client.query("SELECT MAX(id) AS max_id, COUNT(*) AS cnt FROM prospects"),
        // Freeze the actual terminal tuple (created_at, id) so the composite cursor
        // upper bound is consistent — MAX(created_at) + MAX(id) independently are NOT
        // a valid composite bound since UUIDs are unordered w.r.t. creation time.
        // LEFT JOIN handles the empty-table case: zero rows in master_leads yields one
        // result row with null max_ts / max_uuid and cnt = 0.
        client.query(`
          SELECT t.created_at AS max_ts, t.id::text AS max_uuid, cnt.total AS cnt
          FROM (SELECT COUNT(*) AS total FROM master_leads) cnt
          LEFT JOIN LATERAL (
            SELECT created_at, id FROM master_leads ORDER BY created_at DESC, id DESC LIMIT 1
          ) t ON TRUE
        `),
        client.query("SELECT MAX(id) AS max_id FROM contacts WHERE archived_at IS NULL"),
        client.query("SELECT MAX(id) AS max_id FROM businesses"),
      ]);

      const frozenSunbizMaxId = sunbiz.rows[0].max_id ?? null;
      const frozenProspectsMaxId = prospects.rows[0].max_id ?? null;
      const frozenMlTs = masterLeads.rows[0].max_ts ?? null;
      const frozenMlUuid = masterLeads.rows[0].max_uuid ?? null;
      const frozenContactsMaxId = contacts.rows[0].max_id ?? null;
      const frozenBusinessesMaxId = businesses.rows[0].max_id ?? null;
      const sunbizDenominator = parseInt(sunbiz.rows[0].cnt, 10);
      const prospectsDenominator = parseInt(prospects.rows[0].cnt, 10);
      const mlDenominator = parseInt(masterLeads.rows[0].cnt, 10);

      // Get next generation number
      const genR = await client.query(
        "SELECT COALESCE(MAX(generation), 0) + 1 AS next_gen FROM contact_identity_reconciliation_runs",
      );
      const generation = parseInt(genR.rows[0].next_gen, 10);

      const owner = leaseOwnerTag();

      const insertR = await client.query(
        `INSERT INTO contact_identity_reconciliation_runs
           (generation, rules_version, requested_by_user_id, environment, release_sha,
            status, lease_owner, lease_expires_at,
            frozen_sunbiz_max_id, frozen_prospects_max_id,
            frozen_master_leads_created_at, frozen_master_leads_max_uuid,
            frozen_contacts_max_id, frozen_businesses_max_id,
            sunbiz_denominator, prospects_denominator, master_leads_denominator)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,now()+interval '120 seconds',
                 $7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          generation, "gen1-1.0.0", userId, deriveEnvironment(),
          process.env.RELEASE_SHA ?? null, owner,
          frozenSunbizMaxId, frozenProspectsMaxId,
          frozenMlTs, frozenMlUuid,
          frozenContactsMaxId, frozenBusinessesMaxId,
          sunbizDenominator, prospectsDenominator, mlDenominator,
        ],
      );

      await client.query("COMMIT");

      const runId: string = insertR.rows[0].id;

      // Start runner after commit
      setImmediate(() => {
        executeIdentityRun(runId, owner).catch((err) => {
          console.error(`[IdentityCrosswalk] Runner error for run ${runId}:`, err);
        });
      });

      res.status(201).json({ runId, generation });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (err.code === "23505" && err.constraint === "identity_runs_one_active") {
        return res.status(409).json({
          error: "A run is already pending, running, or paused. Cancel or wait for it to complete.",
        });
      }
      serverError(res, err, "identity crosswalk create run");
    } finally {
      client.release();
    }
  });

  // ── GET /api/admin/identity-crosswalk/runs ────────────────────────────────
  app.get("/api/admin/identity-crosswalk/runs", requireRole("admin"), async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10), 1), 100);
      const cursor = req.query.cursor ? String(req.query.cursor) : null;

      let query: string;
      let params: unknown[];
      if (cursor && isUUID(cursor)) {
        query = `SELECT * FROM contact_identity_reconciliation_runs
                 WHERE id::text < $1 ORDER BY created_at DESC LIMIT $2`;
        params = [cursor, limit];
      } else {
        query = `SELECT * FROM contact_identity_reconciliation_runs ORDER BY created_at DESC LIMIT $1`;
        params = [limit];
      }

      const r = await pool.query(query, params);
      res.json({
        runs: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "identity crosswalk list runs");
    }
  });

  // ── GET /api/admin/identity-crosswalk/runs/:runId ─────────────────────────
  app.get("/api/admin/identity-crosswalk/runs/:runId", requireRole("admin"), async (req, res) => {
    const runId = validateUUID(req.params.runId, res, "runId");
    if (!runId) return;
    try {
      const r = await pool.query(
        `SELECT * FROM contact_identity_reconciliation_runs WHERE id = $1`,
        [runId],
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Run not found" });
      res.json(r.rows[0]);
    } catch (err) {
      serverError(res, err, "identity crosswalk get run");
    }
  });

  // ── POST /api/admin/identity-crosswalk/runs/:runId/pause ─────────────────
  app.post("/api/admin/identity-crosswalk/runs/:runId/pause", requireRole("admin"), async (req, res) => {
    const runId = validateUUID(req.params.runId, res, "runId");
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_identity_reconciliation_runs
         SET status = 'paused', pause_reason = 'Admin-requested pause', updated_at = now()
         WHERE id = $1 AND status = 'running'
         RETURNING id`,
        [runId],
      );
      if ((r.rowCount ?? 0) === 0) {
        return res.status(409).json({ error: "Run is not in running state" });
      }
      res.json({ runId, status: "paused" });
    } catch (err) {
      serverError(res, err, "identity crosswalk pause run");
    }
  });

  // ── POST /api/admin/identity-crosswalk/runs/:runId/resume ─────────────────
  app.post("/api/admin/identity-crosswalk/runs/:runId/resume", requireRole("admin"), async (req, res) => {
    const runId = validateUUID(req.params.runId, res, "runId");
    if (!runId) return;
    const owner = leaseOwnerTag();
    try {
      const r = await pool.query(
        `UPDATE contact_identity_reconciliation_runs
         SET status = 'running', pause_reason = NULL,
             lease_owner = $2,
             lease_expires_at = now() + interval '120 seconds',
             updated_at = now()
         WHERE id = $1 AND status = 'paused'
         RETURNING id`,
        [runId, owner],
      );
      if ((r.rowCount ?? 0) === 0) {
        return res.status(409).json({ error: "Run is not in paused state" });
      }
      setImmediate(() => {
        executeIdentityRun(runId, owner).catch((err) => {
          console.error(`[IdentityCrosswalk] Resume runner error for run ${runId}:`, err);
        });
      });
      res.json({ runId, status: "running" });
    } catch (err) {
      serverError(res, err, "identity crosswalk resume run");
    }
  });

  // ── POST /api/admin/identity-crosswalk/runs/:runId/cancel ─────────────────
  app.post("/api/admin/identity-crosswalk/runs/:runId/cancel", requireRole("admin"), async (req, res) => {
    const runId = validateUUID(req.params.runId, res, "runId");
    if (!runId) return;
    try {
      const r = await pool.query(
        `UPDATE contact_identity_reconciliation_runs
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1 AND status IN ('pending', 'running', 'paused')
         RETURNING id`,
        [runId],
      );
      if ((r.rowCount ?? 0) === 0) {
        return res.status(409).json({ error: "Run cannot be cancelled in its current state" });
      }
      res.json({ runId, status: "cancelled" });
    } catch (err) {
      serverError(res, err, "identity crosswalk cancel run");
    }
  });

  // ── GET /api/admin/identity-crosswalk/runs/:runId/clusters ───────────────
  // Returns SOURCE_CONFLICT subjects grouped into clusters by their shared
  // candidate_id. A "cluster" is the set of source rows that all matched the
  // same contact — surfacing which records are potential duplicates of each other.
  app.get("/api/admin/identity-crosswalk/runs/:runId/clusters", requireRole("admin"), async (req, res) => {
    const runId = validateUUID(req.params.runId, res, "runId");
    if (!runId) return;
    try {
      const limitRaw = parseInt(String(req.query.limit ?? "30"), 10);
      const limit = Math.min(Math.max(isNaN(limitRaw) ? 30 : limitRaw, 1), 100);
      const cursorParam = req.query.cursor ? String(req.query.cursor) : null;

      // A cluster = one contact that is referenced by multiple source rows as a conflict.
      // We return the top-N contacts by conflict count, plus a sample of the sources.
      const params: unknown[] = [runId];
      let pi = 2;
      const cursorCond = cursorParam ? `AND cic.candidate_id > $${pi++}` : "";
      if (cursorParam) params.push(Number(cursorParam));
      params.push(limit + 1);

      // PostgreSQL does not allow LIMIT inside an aggregate's ORDER BY clause.
      // Use array_agg over the full ordered set, then slice to the first 10 elements
      // with a [1:10] array subscript (PostgreSQL arrays are 1-indexed).
      const r = await pool.query(`
        SELECT
          cic.candidate_id                  AS contact_id,
          COUNT(DISTINCT cis.id)::int        AS source_count,
          (array_agg(DISTINCT cis.source_table || ':' || cis.source_id
                     ORDER BY cis.source_table || ':' || cis.source_id))[1:10]
                                            AS sample_sources,
          MAX(cis.created_at)               AS last_seen_at
        FROM contact_identity_candidates cic
        JOIN contact_identity_subjects    cis ON cis.id = cic.subject_id
        WHERE cic.run_id = $1
          AND cic.evidence_class = 'SOURCE_CONFLICT'
          ${cursorCond}
        GROUP BY cic.candidate_id
        HAVING COUNT(DISTINCT cis.id) > 1
        ORDER BY cic.candidate_id ASC
        LIMIT $${pi}
      `, params);

      const rows = r.rows;
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? String(items[items.length - 1].contact_id) : null;

      res.json({ clusters: items, nextCursor });
    } catch (err) {
      serverError(res, err, "identity crosswalk clusters");
    }
  });

  // ── GET /api/admin/identity-crosswalk/subjects ────────────────────────────
  app.get("/api/admin/identity-crosswalk/subjects", requireRole("admin"), async (req, res) => {
    try {
      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
      if (limitRaw < 0) return res.status(400).json({ error: "limit must be a positive integer" });

      const cursor = req.query.cursor ? String(req.query.cursor) : null;
      const runId = req.query.run_id ? String(req.query.run_id) : null;
      const evidenceClass = req.query.evidence_class ? String(req.query.evidence_class) : null;
      const sourceTable = req.query.source_table ? String(req.query.source_table) : null;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      if (cursor && isUUID(cursor)) {
        conditions.push(`s.id::text > $${pi++}`);
        params.push(cursor);
      }
      if (runId && isUUID(runId)) {
        conditions.push(`s.run_id = $${pi++}`);
        params.push(runId);
      }
      if (evidenceClass) {
        conditions.push(`EXISTS (SELECT 1 FROM contact_identity_candidates c WHERE c.subject_id = s.id AND c.evidence_class = $${pi++})`);
        params.push(evidenceClass);
      }
      if (sourceTable) {
        conditions.push(`s.source_table = $${pi++}`);
        params.push(sourceTable);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit);

      const r = await pool.query(
        `SELECT s.* FROM contact_identity_subjects s
         ${where}
         ORDER BY s.id ASC
         LIMIT $${pi}`,
        params,
      );

      res.json({
        subjects: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "identity crosswalk list subjects");
    }
  });

  // ── GET /api/admin/identity-crosswalk/subjects/:subjectId/candidates ───────
  app.get("/api/admin/identity-crosswalk/subjects/:subjectId/candidates", requireRole("admin"), async (req, res) => {
    const subjectId = validateUUID(req.params.subjectId, res, "subjectId");
    if (!subjectId) return;
    try {
      const r = await pool.query(
        `SELECT c.*, array_agg(row_to_json(e.*)) FILTER (WHERE e.id IS NOT NULL) AS evidence
         FROM contact_identity_candidates c
         LEFT JOIN contact_identity_evidence e ON e.candidate_id = c.id
         WHERE c.subject_id = $1
         GROUP BY c.id
         ORDER BY c.confidence_score DESC, c.match_tier ASC`,
        [subjectId],
      );
      res.json({ candidates: r.rows });
    } catch (err) {
      serverError(res, err, "identity crosswalk candidates");
    }
  });

  // ── POST /api/admin/identity-crosswalk/candidates/:candidateId/decide ──────
  app.post("/api/admin/identity-crosswalk/candidates/:candidateId/decide", requireRole("admin"), async (req, res) => {
    const candidateId = validateUUID(req.params.candidateId, res, "candidateId");
    if (!candidateId) return;

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { decision, rationale, target_type, organization_candidate_id, crosswalk_run_id } = req.body as {
      decision?: string;
      rationale?: string;
      target_type?: string;
      organization_candidate_id?: number;
      /** Required when target_type = 'org_candidate': the identity crosswalk run under which this decision is being recorded. */
      crosswalk_run_id?: string;
    };

    const ALLOWED_DECISIONS = ["confirm", "reject", "defer"] as const;
    const ALLOWED_TARGET_TYPES = ["identity_candidate", "org_candidate"] as const;

    if (!decision) return res.status(400).json({ error: "decision is required" });
    if (!(ALLOWED_DECISIONS as readonly string[]).includes(decision)) {
      return res.status(400).json({
        error: `Invalid decision value '${decision}'. Allowed: ${ALLOWED_DECISIONS.join(", ")}`,
      });
    }
    if (!target_type) return res.status(400).json({ error: "target_type is required" });
    if (!(ALLOWED_TARGET_TYPES as readonly string[]).includes(target_type)) {
      return res.status(400).json({
        error: `Invalid target_type '${target_type}'. Allowed: ${ALLOWED_TARGET_TYPES.join(", ")}`,
      });
    }
    if (target_type === "org_candidate" && !organization_candidate_id) {
      return res.status(400).json({ error: "organization_candidate_id is required when target_type is org_candidate" });
    }
    if (target_type === "org_candidate" && !crosswalk_run_id) {
      return res.status(400).json({
        error: "crosswalk_run_id is required when target_type is org_candidate — provide the identity crosswalk run ID under which this decision is being recorded",
      });
    }
    if (target_type === "org_candidate" && crosswalk_run_id && !isUUID(crosswalk_run_id)) {
      return res.status(400).json({ error: "crosswalk_run_id must be a valid UUID" });
    }
    if (target_type === "identity_candidate" && organization_candidate_id) {
      return res.status(400).json({ error: "organization_candidate_id must not be set when target_type is identity_candidate" });
    }

    try {
      if (target_type === "identity_candidate") {
        // ── Identity candidate decision path ──────────────────────────────────
        const candR = await pool.query(
          `SELECT c.*, s.run_id AS subject_run_id
           FROM contact_identity_candidates c
           JOIN contact_identity_subjects s ON s.id = c.subject_id
           WHERE c.id = $1`,
          [candidateId],
        );
        if (candR.rows.length === 0) return res.status(404).json({ error: "Identity candidate not found" });
        const cand = candR.rows[0];

        if (["AMBIGUOUS_MATCH", "SOURCE_CONFLICT", "INSUFFICIENT_EVIDENCE"].includes(cand.evidence_class)) {
          return res.status(422).json({
            error: `Decisions are not allowed for evidence_class '${cand.evidence_class}'. Only EXPLICIT_LINK, DETERMINISTIC_MATCH, and STRONG_REVIEW_CANDIDATE candidates may be decided.`,
          });
        }

        const existingR = await pool.query(
          `SELECT * FROM contact_identity_decisions
           WHERE candidate_id = $1 AND actor_user_id = $2 AND decision = $3
           LIMIT 1`,
          [candidateId, userId, decision],
        );
        if (existingR.rows.length > 0) {
          return res.json({ existing: true, decision: existingR.rows[0] });
        }

        let staleAtDecision = false;
        let currentUpdatedAt: Date | null = null;
        if (cand.candidate_type === "contact") {
          const liveR = await pool.query("SELECT updated_at FROM contacts WHERE id = $1", [cand.candidate_id]);
          if (liveR.rows.length > 0) {
            currentUpdatedAt = liveR.rows[0].updated_at;
            staleAtDecision = cand.candidate_updated_at?.getTime() !== currentUpdatedAt?.getTime();
          }
        }

        const runId = cand.run_id ?? cand.subject_run_id;
        const insertR = await pool.query(
          `INSERT INTO contact_identity_decisions
             (run_id, candidate_id, organization_candidate_id, target_type,
              actor_user_id, decision, evidence_class_at_decision, rationale,
              stale_at_decision, candidate_updated_at_snapshot, current_candidate_updated_at)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [runId, candidateId, target_type,
           userId, decision, cand.evidence_class, rationale ?? null,
           staleAtDecision, cand.candidate_updated_at ?? null, currentUpdatedAt],
        );
        return res.status(201).json({ decision: insertR.rows[0] });

      } else {
        // ── Org-candidate decision path ────────────────────────────────────────
        // contact_identity_decisions.run_id FK → contact_identity_reconciliation_runs
        // contact_organization_candidates.run_id FK → contact_reconciliation_runs (different domain)
        // The caller must supply crosswalk_run_id (an identity crosswalk run ID) explicitly.

        // Validate crosswalk_run_id exists in the identity crosswalk runs table
        const crosswalkRunR = await pool.query(
          `SELECT id FROM contact_identity_reconciliation_runs WHERE id = $1`,
          [crosswalk_run_id],
        );
        if (crosswalkRunR.rows.length === 0) {
          return res.status(404).json({
            error: `Identity crosswalk run '${crosswalk_run_id}' not found in contact_identity_reconciliation_runs`,
          });
        }

        // Verify org candidate exists (independent of the identity run domain)
        const orgR = await pool.query(
          `SELECT id FROM contact_organization_candidates WHERE id = $1`,
          [organization_candidate_id],
        );
        if (orgR.rows.length === 0) {
          return res.status(404).json({ error: "Organization candidate not found" });
        }

        const existingR = await pool.query(
          `SELECT * FROM contact_identity_decisions
           WHERE organization_candidate_id = $1 AND actor_user_id = $2 AND decision = $3
           LIMIT 1`,
          [organization_candidate_id, userId, decision],
        );
        if (existingR.rows.length > 0) {
          return res.json({ existing: true, decision: existingR.rows[0] });
        }

        // Use crosswalk_run_id (identity domain) as run_id — this satisfies the FK constraint
        const insertR = await pool.query(
          `INSERT INTO contact_identity_decisions
             (run_id, candidate_id, organization_candidate_id, target_type,
              actor_user_id, decision, evidence_class_at_decision, rationale,
              stale_at_decision, candidate_updated_at_snapshot, current_candidate_updated_at)
           VALUES ($1,NULL,$2,$3,$4,$5,'N/A',$6,false,NULL,NULL)
           RETURNING *`,
          [crosswalk_run_id, organization_candidate_id, target_type,
           userId, decision, rationale ?? null],
        );
        return res.status(201).json({ decision: insertR.rows[0] });
      }
    } catch (err) {
      serverError(res, err, "identity crosswalk decide");
    }
  });

  // ── GET /api/admin/identity-crosswalk/vertical-candidates ─────────────────
  app.get("/api/admin/identity-crosswalk/vertical-candidates", requireRole("admin"), async (req, res) => {
    try {
      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
      const cursor = req.query.cursor ? String(req.query.cursor) : null;
      const runId = req.query.run_id ? String(req.query.run_id) : null;
      const conflictState = req.query.conflict_state ? String(req.query.conflict_state) : null;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      if (cursor && isUUID(cursor)) {
        conditions.push(`id::text > $${pi++}`);
        params.push(cursor);
      }
      if (runId && isUUID(runId)) {
        conditions.push(`run_id = $${pi++}`);
        params.push(runId);
      }
      if (conflictState) {
        conditions.push(`conflict_state = $${pi++}`);
        params.push(conflictState);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit);

      const r = await pool.query(
        `SELECT * FROM contact_vertical_candidates ${where} ORDER BY id ASC LIMIT $${pi}`,
        params,
      );

      res.json({
        candidates: r.rows,
        nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null,
      });
    } catch (err) {
      serverError(res, err, "identity crosswalk vertical candidates");
    }
  });
}
