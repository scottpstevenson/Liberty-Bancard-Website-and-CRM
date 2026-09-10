/**
 * MI-02: Source Registry Admin Routes
 *
 * GET  /api/admin/source-registry                   — list adapters with status/counts
 * POST /api/admin/source-registry/:key/import       — trigger import (multipart CSV upload, returns 202)
 * GET  /api/admin/source-registry/runs/:id          — run status (live polling)
 * GET  /api/admin/source-registry/:key/runs         — run history for adapter
 *
 * All routes: isDashboardUser + requireRole("admin")
 *
 * Import design:
 * - Admin downloads CSV from the adapter's documented source URL (bulkDownloadUrl)
 * - Admin uploads the CSV file to this endpoint (multipart/form-data, field "csv")
 * - CSV is stored in source_import_runs.csv_data (bytea) — NOT in BullMQ job payload
 * - BullMQ job receives only the run_id; the worker reads from the DB column
 * - csv_data is NULLed after the run completes to free space
 * - isFullSnapshot defaults to FALSE; tombstoning requires explicit opt-in (isFullSnapshot=true)
 */

import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { uploadCsvLarge } from "./helpers";
import { createImportRun, setRunCsvData, runSourceImport, getImportRunStatus } from "../services/source-registry/import-runner";
import { IMPLEMENTED_ADAPTER_KEYS } from "../services/source-registry/registry";
import { QUEUE_NAMES } from "../services/queue-names";
import { getQueueManagerProducers } from "../services/queue-manager";
import { serverError } from "../utils/server-error";

/** Maximum CSV size accepted by the import endpoint (50 MB) */
const MAX_CSV_BYTES = 50 * 1024 * 1024;

export function registerSourceRegistryRoutes(app: Express) {
  // ── GET /api/admin/source-registry — list all adapters ────────────────────
  app.get("/api/admin/source-registry", isDashboardUser, requireRole("admin"), async (_req, res) => {
    try {
      // CTE-based query — aggregates run metadata and subject counts independently
      // to avoid a runs × records Cartesian expansion at government-dataset scale.
      const adapters = await pool.query(`
        WITH run_agg AS (
          SELECT
            adapter_key,
            MAX(completed_at) FILTER (WHERE status = 'completed') AS last_completed_at,
            (array_agg(status ORDER BY created_at DESC))[1]       AS last_import_status,
            (array_agg(id ORDER BY created_at DESC)
               FILTER (WHERE status IN ('queued','running')))[1]  AS active_run_id
          FROM source_import_runs
          GROUP BY adapter_key
        ),
        subject_agg AS (
          SELECT source_system AS adapter_key, COUNT(*)::int AS record_count
          FROM cro03_source_subjects
          WHERE tombstoned_at IS NULL
          GROUP BY source_system
        )
        SELECT
          a.adapter_key,
          a.source_name,
          a.source_type,
          a.county_fips,
          a.active,
          a.schedule_disabled,
          a.status,
          a.terms_url,
          a.created_at,
          COALESCE(s.record_count, 0)   AS record_count,
          r.last_completed_at,
          r.last_import_status,
          r.active_run_id
        FROM source_registry_adapters a
        LEFT JOIN run_agg r     ON r.adapter_key = a.adapter_key
        LEFT JOIN subject_agg s ON s.adapter_key = a.adapter_key
        ORDER BY a.adapter_key
      `);

      res.json({
        adapters: adapters.rows.map((row) => ({
          adapterKey: row.adapter_key,
          sourceName: row.source_name,
          sourceType: row.source_type,
          countyFips: row.county_fips,
          active: row.active,
          scheduleDisabled: row.schedule_disabled,
          status: row.status,
          termsUrl: row.terms_url,
          recordCount: row.record_count ?? 0,
          lastCompletedAt: row.last_completed_at ?? null,
          lastImportStatus: row.last_import_status ?? null,
          activeRunId: row.active_run_id ?? null,
          canImport: IMPLEMENTED_ADAPTER_KEYS.has(row.adapter_key),
        })),
      });
    } catch (err) {
      console.error("[SourceRegistry] list error:", err);
      serverError(res, err);
    }
  });

  // ── POST /api/admin/source-registry/:adapterKey/import ────────────────────
  // Accepts a multipart CSV upload (field: "csv"). Returns 202 with import_run_id.
  // CSV is stored in source_import_runs.csv_data (bytea); BullMQ job gets only runId.
  app.post(
    "/api/admin/source-registry/:adapterKey/import",
    isDashboardUser,
    requireRole("admin"),
    (req, res, next) => uploadCsvLarge.single("csv")(req, res, next),
    async (req, res) => {
      try {
        const adapterKey = String(req.params.adapterKey);

        if (!IMPLEMENTED_ADAPTER_KEYS.has(adapterKey)) {
          return res.status(400).json({
            error: "SOURCE_REGISTRY_ADAPTER_NOT_IMPLEMENTED",
            message: `Adapter '${adapterKey}' is a stub — bulk/API availability unverified`,
          });
        }

        // Require CSV upload
        const csvBuffer: Buffer | undefined = (req as any).file?.buffer;
        if (!csvBuffer || csvBuffer.length === 0) {
          return res.status(400).json({
            error: "SOURCE_REGISTRY_CSV_REQUIRED",
            message: "A CSV file must be uploaded via the 'csv' multipart field. Download the source CSV from the adapter's documented URL and upload it here.",
          });
        }

        if (csvBuffer.length > MAX_CSV_BYTES) {
          return res.status(413).json({
            error: "SOURCE_REGISTRY_CSV_TOO_LARGE",
            message: `CSV is ${csvBuffer.length} bytes; maximum accepted is ${MAX_CSV_BYTES} bytes (${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB).`,
          });
        }

        // isFullSnapshot defaults to FALSE for safety.
        // Tombstoning only fires when the caller explicitly opts in (isFullSnapshot=true).
        // The UI requires a deliberate confirmation checkbox before sending true.
        const isFullSnapshot: boolean =
          req.body?.isFullSnapshot === "true" || req.body?.isFullSnapshot === true;

        // Create run record atomically with CSV data in one transaction.
        // is_full_snapshot and csv_data are stored on the row BEFORE any job is
        // enqueued, so the worker always finds both on the row.
        // The unique partial index (adapter_key) WHERE status IN ('queued','running')
        // blocks both queued AND running duplicates atomically. Returns null on conflict.
        const created = await createImportRun(adapterKey, isFullSnapshot, csvBuffer);
        if (!created) {
          // Look up existing active run for conflict response
          const active = await pool.query<{ id: string; status: string }>(
            `SELECT id, status FROM source_import_runs
             WHERE adapter_key = $1 AND status IN ('queued','running') LIMIT 1`,
            [adapterKey]
          );
          return res.status(409).json({
            error: "SOURCE_REGISTRY_IMPORT_ALREADY_ACTIVE",
            message: `An import for '${adapterKey}' is already ${active.rows[0]?.status ?? "active"}`,
            import_run_id: active.rows[0]?.id ?? null,
          });
        }

        const { runId } = created;

        // Enqueue BullMQ job with ONLY the runId — all intent (adapterKey, isFullSnapshot)
        // is read from the DB row by the worker. No source PII or intent transits Redis.
        let enqueued = false;
        try {
          const qm = getQueueManagerProducers();
          if (qm) {
            const queue = qm.getQueue(QUEUE_NAMES.SOURCE_REGISTRY_IMPORT);
            if (queue) {
              await queue.add("run", { runId }, {
                // BullMQ 5 rejects custom job IDs containing ':' — use dash separator
                jobId: `source-registry-import-${runId}`,
              });
              enqueued = true;
            }
          }
        } catch (queueErr) {
          console.warn("[SourceRegistry] BullMQ enqueue failed, using setImmediate fallback:", queueErr);
        }

        if (!enqueued) {
          // Synchronous background run (development / test / BullMQ unavailable).
          // Bounded to MAX_FALLBACK_ATTEMPTS retries with 5s delay between attempts.
          // On exhaustion, the run is permanently marked failed and the adapter slot
          // is released — same terminal semantics as BullMQ's exhausted-attempts hook.
          const MAX_FALLBACK_ATTEMPTS = 3;
          const FALLBACK_RETRY_DELAY_MS = 5_000;
          const runIdForFallback = runId;

          const attemptFallbackRun = async (attempt: number): Promise<void> => {
            try {
              // runSourceImport throws on retryable failures; returns on non-retryable.
              await runSourceImport({ runId: runIdForFallback });
            } catch (retryableErr: any) {
              if (attempt < MAX_FALLBACK_ATTEMPTS) {
                console.warn(
                  `[SourceRegistry] fallback run attempt ${attempt}/${MAX_FALLBACK_ATTEMPTS} failed (retrying):`,
                  retryableErr?.message
                );
                setTimeout(() => attemptFallbackRun(attempt + 1), FALLBACK_RETRY_DELAY_MS);
              } else {
                // All fallback attempts exhausted — mark the run permanently failed
                // so the adapter slot is released and the admin UI stops polling.
                console.error(
                  `[SourceRegistry] fallback run exhausted all ${MAX_FALLBACK_ATTEMPTS} attempts — marking run failed:`,
                  retryableErr?.message
                );
                const { pool: _pool } = await import("../db");
                await _pool.query(
                  `UPDATE source_import_runs
                   SET status = 'failed', completed_at = NOW(), csv_data = NULL,
                       error_text = $2
                   WHERE id = $1::uuid AND status IN ('queued', 'running')`,
                  [runIdForFallback, `SOURCE_REGISTRY_EXHAUSTED (fallback): ${String(retryableErr?.message ?? "").substring(0, 1600)}`]
                ).catch(() => {});
              }
            }
          };

          setImmediate(() => attemptFallbackRun(1));
        }

        return res.status(202).json({ import_run_id: runId, adapterKey, status: "queued", enqueued });
      } catch (err) {
        console.error("[SourceRegistry] import trigger error:", err);
        serverError(res, err);
      }
    }
  );

  // ── GET /api/admin/source-registry/runs/:runId — poll run status ──────────
  // MUST be registered BEFORE /:adapterKey/runs to avoid Express route collision.
  app.get(
    "/api/admin/source-registry/runs/:runId",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const run = await getImportRunStatus(String(req.params.runId));
        if (!run) return res.status(404).json({ error: "Run not found" });
        res.json(run);
      } catch (err) {
        serverError(res, err);
      }
    }
  );

  // ── GET /api/admin/source-registry/:adapterKey/runs — run history ─────────
  app.get(
    "/api/admin/source-registry/:adapterKey/runs",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const adapterKey = String(req.params.adapterKey);
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const result = await pool.query(
          `SELECT id, status, records_processed, records_new, records_updated, records_tombstoned,
                  started_at, completed_at, error_text, created_at
           FROM source_import_runs WHERE adapter_key = $1
           ORDER BY created_at DESC LIMIT $2`,
          [adapterKey, limit]
        );
        res.json({ runs: result.rows });
      } catch (err) {
        serverError(res, err);
      }
    }
  );
}
