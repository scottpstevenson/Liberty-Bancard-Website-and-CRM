/**
 * Governed Contact Hard-Delete Routes (#1784)
 *
 * POST /api/admin/contacts/bulk-delete-snapshot  — freeze a selection
 * POST /api/admin/contacts/bulk-hard-delete/preview — dependency preview
 * POST /api/admin/contacts/bulk-hard-delete      — execute governed deletion
 *
 * All endpoints require admin role. GHL is never called here (local DB only).
 * BACKGROUND_JOB_PROFILE=off is never changed.
 * record_class is never written here.
 */

import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool, db } from "../db";
import { sql } from "drizzle-orm";
import { contacts as contactsTable } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { inventoryDependencies, coordinatePendingJobs, executeDeleteBatch } from "../services/contact-deletion-service";
import { storage } from "../storage";
import crypto from "crypto";

const ELIGIBLE_CLASSES = new Set(["test", "demo", "synthetic"]);
const SNAPSHOT_EXPIRY_HOURS = 24;

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

export function registerContactDeletionRoutes(app: Express): void {

  // ── POST /api/admin/contacts/bulk-delete-snapshot ──────────────────────────
  // Freeze a selection of contact IDs into a durable snapshot.
  // Accepts: { contactIds: number[] } OR { selectAllFilter: { recordClass: string } }
  // Returns: { snapshotId, total, expiresAt }
  app.post(
    "/api/admin/contacts/bulk-delete-snapshot",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const actorId: number = (req.user as any)?.id;
        if (!actorId) return res.status(401).json({ error: "No authenticated user" });

        const body = req.body as {
          contactIds?: unknown;
          selectAllFilter?: { recordClass?: string };
        };

        let contactIds: number[];
        let filterParams: Record<string, unknown> = {};

        if (Array.isArray(body.contactIds)) {
          contactIds = body.contactIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
          filterParams = { source: "explicit" };
        } else if (body.selectAllFilter && typeof body.selectAllFilter === "object") {
          const { recordClass } = body.selectAllFilter;
          if (!recordClass || !ELIGIBLE_CLASSES.has(recordClass)) {
            return res.status(400).json({
              error: "selectAllFilter.recordClass must be one of: test, demo, synthetic",
            });
          }
          filterParams = { source: "filter", recordClass };
          const rows = await db
            .select({ id: contactsTable.id })
            .from(contactsTable)
            .where(
              sql`archived_at IS NULL AND record_class = ${recordClass}`
            );
          contactIds = rows.map((r) => r.id);
        } else {
          return res.status(400).json({
            error: "Body must include contactIds (array) or selectAllFilter ({ recordClass })",
          });
        }

        if (contactIds.length === 0) {
          return res.status(400).json({ error: "No contacts to snapshot" });
        }
        if (contactIds.length > 10000) {
          return res.status(400).json({ error: "Snapshot size exceeds maximum of 10,000 contacts" });
        }

        const client = await pool.connect();
        try {
          const result = await client.query<{ id: string; expires_at: string }>(
            `INSERT INTO bulk_delete_snapshots (actor_user_id, contact_ids, filter_params)
             VALUES ($1, $2::int[], $3::jsonb)
             RETURNING id, expires_at`,
            [actorId, contactIds, JSON.stringify(filterParams)]
          );
          const snap = result.rows[0];
          return res.json({
            snapshotId: snap.id,
            total: contactIds.length,
            expiresAt: snap.expires_at,
          });
        } finally {
          client.release();
        }
      } catch (err: any) {
        console.error("[contact-deletion] snapshot error:", err.message);
        res.status(500).json({ error: "Failed to create snapshot" });
      }
    }
  );

  // ── POST /api/admin/contacts/bulk-hard-delete/preview ──────────────────────
  // Preview which contacts in a snapshot are eligible, blocked, or missing.
  // Accepts: { snapshotId: string }
  // Returns: { previewId, selected, eligible, blocked, missing, dependentSummary }
  app.post(
    "/api/admin/contacts/bulk-hard-delete/preview",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const actorId: number = (req.user as any)?.id;
        if (!actorId) return res.status(401).json({ error: "No authenticated user" });

        const { snapshotId } = req.body as { snapshotId?: string };
        if (!snapshotId || !isValidUuid(snapshotId)) {
          return res.status(400).json({ error: "snapshotId must be a valid UUID" });
        }

        const client = await pool.connect();
        let snapshotContactIds: number[];
        try {
          const snapResult = await client.query<{ contact_ids: number[]; actor_user_id: number; expires_at: string }>(
            `SELECT contact_ids, actor_user_id, expires_at FROM bulk_delete_snapshots WHERE id = $1::uuid`,
            [snapshotId]
          );
          if (snapResult.rows.length === 0) {
            return res.status(404).json({ error: "Snapshot not found or expired" });
          }
          const snap = snapResult.rows[0];
          if (snap.actor_user_id !== actorId) {
            return res.status(403).json({ error: "Snapshot belongs to a different user" });
          }
          if (new Date(snap.expires_at) < new Date()) {
            return res.status(410).json({ error: "Snapshot has expired" });
          }
          snapshotContactIds = snap.contact_ids;
        } finally {
          client.release();
        }

        // Step 1: Check which contacts still exist and their current class
        const existingRows = await db
          .select({ id: contactsTable.id, recordClass: contactsTable.recordClass })
          .from(contactsTable)
          .where(inArray(contactsTable.id, snapshotContactIds));

        const existingMap = new Map(existingRows.map((r) => [r.id, r.recordClass]));
        const missing = snapshotContactIds.filter((id) => !existingMap.has(id));
        const present = snapshotContactIds.filter((id) => existingMap.has(id));

        // Step 2: Class check — only test/demo/synthetic may be permanently deleted
        const blocked: Array<{ contactId: number; reason: string; details: string }> = [];
        const classEligible: number[] = [];
        for (const id of present) {
          const cls = existingMap.get(id)!;
          if (!ELIGIBLE_CLASSES.has(cls)) {
            blocked.push({
              contactId: id,
              reason: "ineligible_class",
              details: `Contact class '${cls}' is not eligible for permanent deletion. Only test, demo, and synthetic contacts may be deleted.`,
            });
          } else {
            classEligible.push(id);
          }
        }

        // Step 3: Dependency inventory
        const { eligible: depEligible, blocked: depBlocked } = await inventoryDependencies(classEligible);
        blocked.push(...depBlocked);

        // Step 4: Pending-job coordination (additional check)
        const { safe: eligible, blocked: jobBlocked } = await coordinatePendingJobs(depEligible);
        // Filter duplicates (pending_job may already appear from inventory)
        const alreadyBlocked = new Set(blocked.map((b) => b.contactId));
        for (const jb of jobBlocked) {
          if (!alreadyBlocked.has(jb.contactId)) blocked.push(jb);
        }
        const finalEligible = eligible.filter((id) => !alreadyBlocked.has(id));

        // Step 5: Generate a previewId bound to this state
        const previewFingerprint = crypto
          .createHash("sha256")
          .update(JSON.stringify({ snapshotId, eligible: finalEligible.sort(), blocked: blocked.map((b) => b.contactId).sort() }))
          .digest("hex");
        const previewId = `${snapshotId}:${previewFingerprint}`;

        return res.json({
          previewId,
          snapshotId,
          selected: snapshotContactIds.length,
          eligible: finalEligible,
          eligibleCount: finalEligible.length,
          blocked,
          blockedCount: blocked.length,
          missing: missing.length,
          confirmationPhrase: `DELETE ${finalEligible.length} CONTACTS`,
        });
      } catch (err: any) {
        console.error("[contact-deletion] preview error:", err.message);
        res.status(500).json({ error: "Failed to generate preview" });
      }
    }
  );

  // ── POST /api/admin/contacts/bulk-hard-delete ──────────────────────────────
  // Execute governed permanent deletion.
  // Accepts: { previewId, idempotencyKey, confirmationPhrase }
  // Returns: { operationId, selected, deleted, blocked, missing, failed, pending }
  app.post(
    "/api/admin/contacts/bulk-hard-delete",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const actorId: number = (req.user as any)?.id;
        if (!actorId) return res.status(401).json({ error: "No authenticated user" });

        const { previewId, idempotencyKey, confirmationPhrase } = req.body as {
          previewId?: string;
          idempotencyKey?: string;
          confirmationPhrase?: string;
        };

        if (!previewId || typeof previewId !== "string") {
          return res.status(400).json({ error: "previewId is required" });
        }
        if (!idempotencyKey || !isValidUuid(idempotencyKey)) {
          return res.status(400).json({ error: "idempotencyKey must be a valid UUIDv4" });
        }
        if (!confirmationPhrase || typeof confirmationPhrase !== "string") {
          return res.status(400).json({ error: "confirmationPhrase is required" });
        }

        // Parse previewId: "snapshotId:fingerprint"
        const colonIdx = previewId.indexOf(":");
        if (colonIdx === -1) return res.status(400).json({ error: "Invalid previewId format" });
        const snapshotId = previewId.substring(0, colonIdx);
        if (!isValidUuid(snapshotId)) return res.status(400).json({ error: "Invalid previewId: bad snapshotId" });

        // ── Idempotency: look up or create operation row ─────────────────
        const client = await pool.connect();
        let operationId: string;
        let existingResult: any;
        try {
          // Try to find an existing operation for this key+actor
          const existing = await client.query<{ id: string; status: string; result_json: any; preview_id: string; actor_user_id: number }>(
            `SELECT id, status, result_json, preview_id, actor_user_id
             FROM bulk_delete_operations
             WHERE idempotency_key = $1::uuid AND actor_user_id = $2`,
            [idempotencyKey, actorId]
          );

          if (existing.rows.length > 0) {
            const op = existing.rows[0];
            // Same key + same actor + same previewId → idempotent return
            if (op.preview_id === previewId) {
              if (op.status === "completed" || op.status === "failed") {
                return res.json({ operationId: op.id, ...op.result_json });
              }
              // Still running — return current state
              return res.json({ operationId: op.id, status: op.status, ...op.result_json });
            }
            // Same key + different previewId → 409 conflict
            return res.status(409).json({
              error: "Idempotency key already used with a different previewId",
              existingOperationId: op.id,
            });
          }

          // Check if same key used by different actor
          const crossActor = await client.query(
            `SELECT id FROM bulk_delete_operations WHERE idempotency_key = $1::uuid AND actor_user_id != $2`,
            [idempotencyKey, actorId]
          );
          if (crossActor.rows.length > 0) {
            return res.status(409).json({ error: "Idempotency key already used by a different user" });
          }

          // Create new operation row
          const newOp = await client.query<{ id: string }>(
            `INSERT INTO bulk_delete_operations (idempotency_key, actor_user_id, snapshot_id, preview_id, status, result_json)
             VALUES ($1::uuid, $2, $3::uuid, $4, 'running', '{}'::jsonb)
             RETURNING id`,
            [idempotencyKey, actorId, snapshotId, previewId]
          );
          operationId = newOp.rows[0].id;
        } catch (err: any) {
          // UNIQUE constraint violation — concurrent request with same key+actor
          if (err.code === "23505") {
            const existing2 = await client.query<{ id: string; status: string; result_json: any }>(
              `SELECT id, status, result_json FROM bulk_delete_operations
               WHERE idempotency_key = $1::uuid AND actor_user_id = $2`,
              [idempotencyKey, actorId]
            );
            if (existing2.rows.length > 0) {
              return res.json({ operationId: existing2.rows[0].id, status: existing2.rows[0].status, ...existing2.rows[0].result_json });
            }
          }
          throw err;
        } finally {
          client.release();
        }

        // ── Revalidate snapshot ──────────────────────────────────────────
        const snapClient = await pool.connect();
        let snapshotContactIds: number[];
        try {
          const snapResult = await snapClient.query<{ contact_ids: number[]; actor_user_id: number; expires_at: string }>(
            `SELECT contact_ids, actor_user_id, expires_at FROM bulk_delete_snapshots WHERE id = $1::uuid`,
            [snapshotId]
          );
          if (snapResult.rows.length === 0 || snapResult.rows[0].actor_user_id !== actorId) {
            await snapClient.query(
              `UPDATE bulk_delete_operations SET status = 'failed', updated_at = now(),
               result_json = '{"error":"snapshot_not_found"}'::jsonb WHERE id = $1::uuid`,
              [operationId]
            );
            return res.status(404).json({ error: "Snapshot not found or belongs to different user" });
          }
          if (new Date(snapResult.rows[0].expires_at) < new Date()) {
            await snapClient.query(
              `UPDATE bulk_delete_operations SET status = 'failed', updated_at = now(),
               result_json = '{"error":"snapshot_expired"}'::jsonb WHERE id = $1::uuid`,
              [operationId]
            );
            return res.status(410).json({ error: "Snapshot has expired" });
          }
          snapshotContactIds = snapResult.rows[0].contact_ids;
        } finally {
          snapClient.release();
        }

        // ── Revalidate class and dependencies ───────────────────────────
        const existingRows = await db
          .select({ id: contactsTable.id, recordClass: contactsTable.recordClass })
          .from(contactsTable)
          .where(inArray(contactsTable.id, snapshotContactIds));

        const existingMap = new Map(existingRows.map((r) => [r.id, r.recordClass]));
        const missing = snapshotContactIds.filter((id) => !existingMap.has(id)).length;
        const present = snapshotContactIds.filter((id) => existingMap.has(id));

        const revalidatedBlocked: Array<{ contactId: number; reason: string; details: string }> = [];
        const classEligible: number[] = [];
        for (const id of present) {
          const cls = existingMap.get(id)!;
          if (!ELIGIBLE_CLASSES.has(cls)) {
            revalidatedBlocked.push({ contactId: id, reason: "ineligible_class", details: `class is now '${cls}'` });
          } else {
            classEligible.push(id);
          }
        }

        const { eligible: depEligible, blocked: depBlocked } = await inventoryDependencies(classEligible);
        revalidatedBlocked.push(...depBlocked);

        const { safe: finalEligible, blocked: jobBlocked } = await coordinatePendingJobs(depEligible);
        const alreadyBlocked = new Set(revalidatedBlocked.map((b) => b.contactId));
        for (const jb of jobBlocked) {
          if (!alreadyBlocked.has(jb.contactId)) revalidatedBlocked.push(jb);
        }
        const eligibleIds = finalEligible.filter((id) => !alreadyBlocked.has(id));

        // ── Validate confirmation phrase ─────────────────────────────────
        const expectedPhrase = `DELETE ${eligibleIds.length} CONTACTS`;
        if (confirmationPhrase.trim() !== expectedPhrase) {
          const updateClient = await pool.connect();
          try {
            await updateClient.query(
              `UPDATE bulk_delete_operations SET status = 'failed', updated_at = now(),
               result_json = $2::jsonb WHERE id = $1::uuid`,
              [operationId, JSON.stringify({ error: "phrase_mismatch", expected: expectedPhrase })]
            );
          } finally { updateClient.release(); }
          return res.status(400).json({
            error: `Confirmation phrase does not match. Expected: "${expectedPhrase}"`,
            expected: expectedPhrase,
            eligibleCount: eligibleIds.length,
          });
        }

        // ── Execute deletion in bounded batches ──────────────────────────
        const BATCH_SIZE = 100;
        let totalDeleted = 0;
        const allFailed: Array<{ contactId: number; error: string }> = [];

        for (let i = 0; i < eligibleIds.length; i += BATCH_SIZE) {
          const batch = eligibleIds.slice(i, i + BATCH_SIZE);
          try {
            const { deleted, failed } = await executeDeleteBatch(batch, operationId);
            totalDeleted += deleted;
            allFailed.push(...failed);
          } catch (err: any) {
            // Batch-level failure — mark all as failed, continue with next batch
            console.error(`[contact-deletion] batch ${i / BATCH_SIZE} failed:`, err.message);
            allFailed.push(...batch.map((id) => ({ contactId: id, error: err.message })));
          }
        }

        // ── Write deletion audit receipt ─────────────────────────────────
        await storage.createAuditLog({
          action: "contacts_bulk_hard_deleted",
          entityType: "contact",
          userId: String(actorId),
          details: {
            operationId,
            snapshotId,
            previewId,
            selected: snapshotContactIds.length,
            deleted: totalDeleted,
            blocked: revalidatedBlocked.length,
            missing,
            failed: allFailed.length,
            blockedReasons: revalidatedBlocked.map((b) => ({ contactId: b.contactId, reason: b.reason })),
          },
        });

        // ── Finalize operation record ─────────────────────────────────────
        const finalResult = {
          operationId,
          selected: snapshotContactIds.length,
          deleted: totalDeleted,
          blocked: revalidatedBlocked.length,
          blockedDetails: revalidatedBlocked,
          missing,
          failed: allFailed.length,
          pending: 0,
        };

        const finalClient = await pool.connect();
        try {
          await finalClient.query(
            `UPDATE bulk_delete_operations
             SET status = 'completed', updated_at = now(), result_json = $2::jsonb
             WHERE id = $1::uuid`,
            [operationId, JSON.stringify(finalResult)]
          );
        } finally { finalClient.release(); }

        return res.json(finalResult);
      } catch (err: any) {
        console.error("[contact-deletion] hard-delete error:", err.message);
        res.status(500).json({ error: "Deletion operation failed" });
      }
    }
  );
}
