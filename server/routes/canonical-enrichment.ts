import {
  CanonicalReleaseError, describeCanonicalRelease, executeCanonicalRelease, previewCanonicalRelease,
  resolveCanonicalHold, revokeCanonicalRelease, writeReleasePolicy, type HoldResolution,
} from "../services/sfp-canonical-release";
import { LaunchInventoryDeadlineError, readSfpLaunchInventory } from "../services/sfp-launch-inventory";
import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { readCanonicalEnrichmentStatus } from "../services/canonical-enrichment-status";
import { BacklogDeadlineError, readCanonicalEnrichmentBacklog } from "../services/canonical-enrichment-backlog";
import {
  BacklogHistoryDeadlineError, BacklogIntentConflictError, BacklogProcessInputError, enqueueBacklogProcess, readLastBacklogPriorityRun, requireBacklogCommandId, validateBacklogProcessRequest,
} from "../services/canonical-enrichment-backlog-run";
import { storage } from "../storage";
import {
  UploadLedgerInputError, listUploadLedgerRuns, readUploadLedgerPage, readUploadLedgerSummary,
} from "../services/canonical-upload-ledger";

/** Exact error, SQLSTATE and timing for an unavailable read. The client only ever sees a typed unavailable body. */
function logReadFailure(label: string, error: unknown, startedAt: number) {
  const e: any = error;
  const code = e?.code ?? e?.cause?.code ?? "n/a";
  console.error(`[canonical-enrichment] ${label} failed after ${Date.now() - startedAt}ms sqlstate=${code}: ${e?.cause?.message ?? e?.message ?? String(error)}`);
}

export const RELEASE_STATUS_DEADLINE_MS = 10_000;
export class ReadDeadlineError extends Error { constructor() { super("READ_DEADLINE_EXCEEDED"); } }
/** Answers the caller at the deadline; a late result is discarded. The pool statement timeout still bounds the database side. */
export function withReadDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ReadDeadlineError()), deadlineMs); });
  late.catch(() => undefined);
  work.catch(() => undefined);
  return Promise.race([work, late]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * The effect (release, revoke, hold resolution, queue request) has already committed when the audit row is
 * written. An audit failure must be reported as a committed effect with an unrecorded audit, never as
 * "nothing happened".
 */
async function auditCommittedEffect(entry: Parameters<typeof storage.createAuditLog>[0], label: string): Promise<"recorded" | "failed"> {
  try {
    await storage.createAuditLog(entry);
    return "recorded";
  } catch (error) {
    logReadFailure(`audit for committed ${label}`, error, Date.now());
    return "failed";
  }
}

export function registerCanonicalEnrichmentRoutes(app: Express) {
  app.get("/api/canonical-enrichment/status", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    const startedAt = Date.now();
    try {
      res.set("Cache-Control", "no-store");
      res.json(await readCanonicalEnrichmentStatus());
    } catch (error) {
      logReadFailure("status", error, startedAt);
      res.status(503).json({ message: "Canonical enrichment status is unavailable; counts were not calculated." });
    }
  });

  // One backlog across every intake family. Cached read model; `?fresh=1` forces a recount (admin only).
  // The response never reads process history: that is its own bounded endpoint, so a slow or failed history
  // query can neither delay nor fail the aggregate, and the aggregate deadline is the response deadline.
  app.get("/api/canonical-enrichment/backlog", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const startedAt = Date.now();
    res.set("Cache-Control", "no-store");
    const fresh = req.query.fresh === "1" && (req.user as any)?.role === "admin";
    try {
      res.json(await readCanonicalEnrichmentBacklog({ fresh }));
    } catch (error) {
      logReadFailure("backlog", error, startedAt);
      const timedOut = error instanceof BacklogDeadlineError;
      res.status(503).json({
        code: timedOut ? "BACKLOG_DEADLINE_EXCEEDED" : "BACKLOG_UNAVAILABLE",
        message: timedOut
          ? "The enrichment backlog count did not finish in time and was cancelled; nothing was counted."
          : "The enrichment backlog is unavailable; nothing was counted.",
      });
    }
  });

  // Process history on its own: it never waits for, or fails with, the aggregate backlog count.
  app.get("/api/canonical-enrichment/backlog-process-history", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    const startedAt = Date.now();
    res.set("Cache-Control", "no-store");
    try {
      res.json({ lastPriorityRun: await readLastBacklogPriorityRun() });
    } catch (error) {
      logReadFailure("process history", error, startedAt);
      const timedOut = error instanceof BacklogHistoryDeadlineError;
      res.status(503).json({ code: timedOut ? "PROCESS_HISTORY_DEADLINE_EXCEEDED" : "PROCESS_HISTORY_UNAVAILABLE", message: "The last process run is unavailable; this is not 'no previous run'." });
    }
  });

  // Current prepared recipients re-checked against every launch requirement. Read-only; sends nothing.
  app.get("/api/canonical-enrichment/launch-inventory", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const startedAt = Date.now();
    try {
      res.set("Cache-Control", "no-store");
      const fresh = req.query.fresh === "1" && (req.user as any)?.role === "admin";
      res.json(await readSfpLaunchInventory({ fresh }));
    } catch (error) {
      logReadFailure("launch inventory", error, startedAt);
      if (error instanceof LaunchInventoryDeadlineError) {
        res.status(503).json({
          code: "LAUNCH_INVENTORY_DEADLINE_EXCEEDED", phase: error.phase, progress: error.progress,
          message: "The launch inventory did not finish in time and was cancelled; nothing was counted. Contact checks already finished are kept, so a retry continues from them.",
        });
        return;
      }
      res.status(503).json({ code: "LAUNCH_INVENTORY_UNAVAILABLE", message: "The launch inventory is unavailable; nothing was counted." });
    }
  });

  // Narrow operator release of current canonical recipients. Preview is read-only. Execute and revoke
  // are admin-only and audit-logged. None of these lift the outbound pause.
  const actor = (req: any) => String(req.user?.id ?? req.user?.email ?? "unknown");
  const releaseError = (res: any, error: unknown) => {
    if (error instanceof CanonicalReleaseError) return res.status(error.status).json({ code: error.code, message: error.message });
    return res.status(503).json({ code: "RELEASE_UNCONFIRMED", message: "The release request could not be confirmed. It may or may not have committed: check the release status before doing anything else. Repeating the same request is safe because it replays the same release; do not start a different one until you have checked." });
  };
  app.get("/api/canonical-enrichment/release", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    const startedAt = Date.now();
    try {
      res.set("Cache-Control", "no-store");
      const { readSenderCapacity } = await import("../services/sfp-sender-capacity");
      // Whole-read bound: the release panel must answer or say it is unavailable, never wait on a stalled read.
      const [status, capacity] = await withReadDeadline(
        Promise.all([describeCanonicalRelease(), readSenderCapacity().catch(() => null)]), RELEASE_STATUS_DEADLINE_MS);
      res.json({ ...status, capacity });
    } catch (error) {
      logReadFailure("release state", error, startedAt);
      const timedOut = error instanceof ReadDeadlineError;
      res.status(503).json({ code: timedOut ? "RELEASE_STATUS_DEADLINE_EXCEEDED" : "RELEASE_STATUS_UNAVAILABLE", message: "The release state is unavailable." });
    }
  });
  // Read-only: what each current launch package renders for a fictional recipient. Writes and sends nothing.
  app.get("/api/canonical-enrichment/seed-test/rendering", isDashboardUser, requireRole("admin"), async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const { previewSeedRendering } = await import("../services/sfp-seed-test");
      res.json(await previewSeedRendering());
    } catch { res.status(503).json({ message: "The seed rendering is unavailable; nothing was rendered." }); }
  });
  // Operator seed test: one real message to ONE explicitly authorized mailbox, through the real cold sender, renderer
  // and SMTP service. Never a prospect; the global outbound pause still applies. See sfp-seed-test.ts.
  type SeedLib = typeof import("../services/sfp-seed-test");
  const withSeed = (handler: (lib: SeedLib, req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-store");
      await handler(await import("../services/sfp-seed-test"), req, res);
    } catch (error: any) {
      if (error?.name === "SeedTestError") return res.status(error.status).json({ code: error.code, message: error.message });
      res.status(503).json({ message: "The seed test is unavailable; nothing was sent." });
    }
  };
  app.get("/api/canonical-enrichment/seed-test/status", isDashboardUser, requireRole("admin"),
    withSeed(async (lib, _req, res) => { res.json(await lib.readSeedStatus()); }));
  app.post("/api/canonical-enrichment/seed-test/authorize", isDashboardUser, requireRole("admin"),
    withSeed(async (lib, req, res) => {
      const authorization = await lib.authorizeSeedMailbox({ mailbox: req.body?.mailbox, expiresInHours: req.body?.expiresInHours,
        maxMessages: req.body?.maxMessages, actorId: actor(req) });
      await storage.createAuditLog({ action: "sfp_seed_test_mailbox_authorized", entityType: "sfp_seed_test", userId: actor(req),
        details: { mailboxHash: authorization.mailboxHash, expiresAt: authorization.expiresAt, maxMessages: authorization.maxMessages } } as any);
      res.json({ authorization });
    }));
  app.post("/api/canonical-enrichment/seed-test/revoke", isDashboardUser, requireRole("admin"),
    withSeed(async (lib, req, res) => {
      const result = await lib.revokeSeedMailbox();
      await storage.createAuditLog({ action: "sfp_seed_test_mailbox_revoked", entityType: "sfp_seed_test", userId: actor(req), details: result } as any);
      res.json(result);
    }));
  app.post("/api/canonical-enrichment/seed-test/send/preview", isDashboardUser, requireRole("admin"),
    withSeed(async (lib, req, res) => { res.json(await lib.previewSeedSend({ packageKey: String(req.body?.packageKey ?? ""), stepOrder: Number(req.body?.stepOrder) })); }));
  app.post("/api/canonical-enrichment/seed-test/send", isDashboardUser, requireRole("admin"),
    withSeed(async (lib, req, res) => {
      const result = await lib.executeSeedSend({ packageKey: String(req.body?.packageKey ?? ""), stepOrder: Number(req.body?.stepOrder),
        previewHash: String(req.body?.previewHash ?? ""), idempotencyKey: req.header("Idempotency-Key") ?? "", actorId: actor(req) });
      await storage.createAuditLog({ action: "sfp_seed_test_send", entityType: "sfp_seed_test", userId: actor(req),
        details: { replayed: result.replayed, state: result.receipt.state, packageKey: result.receipt.packageKey,
          stepOrder: result.receipt.stepOrder, mailboxHash: result.receipt.mailboxHash } } as any);
      res.json(result);
    }));
  app.post("/api/canonical-enrichment/release/preview", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await previewCanonicalRelease(Number(req.body?.limit)));
    } catch (error) { releaseError(res, error); }
  });
  app.post("/api/canonical-enrichment/release/execute", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const commandKey = req.header("Idempotency-Key") ?? "";
      const result = await executeCanonicalRelease({
        requestedLimit: Number(req.body?.limit), snapshotHash: String(req.body?.snapshotHash ?? ""),
        commandKey, expiresInHours: Number(req.body?.expiresInHours), actorId: actor(req),
      });
      // The release is committed here. A failed audit write is reported alongside the receipt.
      const audit = await auditCommittedEffect({
        action: "sfp_canonical_release_executed", entityType: "sfp_canonical_release",
        entityKey: result.release.releaseId, userId: actor(req),
        details: { replayed: result.replayed, releaseId: result.release.releaseId, size: result.release.enrollmentIds.length,
          admissionClosesAt: result.release.admissionClosesAt, journeyExpiresAt: result.release.journeyExpiresAt,
          snapshotHash: result.release.snapshotHash },
      } as any, "release");
      res.json({ replayed: result.replayed, release: result.release, committed: true, audit });
    } catch (error) { releaseError(res, error); }
  });
  app.post("/api/canonical-enrichment/release/revoke", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const result = await revokeCanonicalRelease(actor(req));
      const audit = await auditCommittedEffect({
        action: "sfp_canonical_release_revoked", entityType: "sfp_canonical_release", userId: actor(req),
        details: { ...result },
      } as any, "revoke");
      res.json({ ...result, committed: true, audit });
    } catch (error) { releaseError(res, error); }
  });

  // Administrator-configurable admission policy (size ceiling, admission window, journey period). Bounded and audited.
  app.put("/api/canonical-enrichment/release/policy", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const policy = await writeReleasePolicy(req.body, actor(req));
      const audit = await auditCommittedEffect({
        action: "sfp_canonical_release_policy_updated", entityType: "sfp_canonical_release", userId: actor(req), details: { ...policy },
      } as any, "release policy");
      res.json({ policy, committed: true, audit });
    } catch (error) { releaseError(res, error); }
  });
  // Operator decision for a held journey (uncertain delivery, repeated unsent). Never automatic.
  app.post("/api/canonical-enrichment/release/enrollments/:id/resolve", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const resolution = String(req.body?.resolution ?? "") as HoldResolution;
      if (!["delivered", "not_delivered", "clear_hold"].includes(resolution)) {
        return res.status(400).json({ code: "RESOLUTION_INVALID", message: "resolution must be delivered, not_delivered or clear_hold" });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ code: "ENROLLMENT_INVALID" });
      const result = await resolveCanonicalHold(id, resolution);
      const audit = await auditCommittedEffect({
        action: "sfp_canonical_hold_resolved", entityType: "sequence_enrollment", entityKey: String(id), userId: actor(req),
        details: { resolution, ...result },
      } as any, "hold resolution");
      res.status(result.resolved ? 200 : 409).json({ ...result, committed: result.resolved, audit });
    } catch (error) { releaseError(res, error); }
  });

  // Optional: ask the existing background worker to work the highest-priority backlog now.
  // It adds no new send, spend or enrollment path; ordinary scheduled passes continue regardless.
  app.post("/api/canonical-enrichment/backlog/process", isDashboardUser, requireRole("admin"), async (req, res) => {
    let request;
    let commandId: string;
    try { request = validateBacklogProcessRequest(req.body); commandId = requireBacklogCommandId(req.body); }
    catch (error) {
      if (error instanceof BacklogProcessInputError) return res.status(400).json({ message: error.message });
      return res.status(400).json({ message: "Invalid request." });
    }
    const actorId = String((req.user as any)?.id ?? "");
    let result;
    try {
      result = await enqueueBacklogProcess(request, commandId, actorId);
    } catch (error) {
      if (error instanceof BacklogIntentConflictError) return res.status(409).json({ code: "INTENT_CONFLICT", message: error.message });
      logReadFailure("backlog process enqueue", error, Date.now());
      return res.status(503).json({ code: "PROCESS_UNCONFIRMED", message: "The request could not be confirmed as queued. It may have been queued; repeating the same request is recognized and cannot queue it twice." });
    }
    // Queued (or deduplicated) at this point; the audit write can no longer undo that.
    const audit = await auditCommittedEffect({
      action: "canonical_backlog_process_requested", entityType: "canonical_enrichment_backlog",
      entityKey: result.jobId ?? "not_queued", userId: String((req.user as any)?.id ?? ""),
      details: { ...request, commandId, outcome: result.outcome, accepted: result.accepted, alreadyQueued: result.alreadyQueued },
    }, "backlog process request");
    res.status(result.accepted ? 202 : 503).json({ ...result, ...(result.accepted ? {} : { code: "QUEUE_UNAVAILABLE" }), audit });
  });

  // Read-only, paginated original-coordinate ledger. Bounded: at most 100 rows per page.
  const ledgerGuard = [isDashboardUser, requireRole("admin", "manager")] as const;
  const ledgerError = (res: any, error: unknown) => {
    if (error instanceof UploadLedgerInputError) return res.status(400).json({ code: error.message });
    return res.status(503).json({ message: "The upload ledger is unavailable; nothing was calculated." });
  };
  app.get("/api/canonical-enrichment/uploads", ...ledgerGuard, async (_req, res) => {
    try { res.set("Cache-Control", "no-store"); res.json({ uploads: await listUploadLedgerRuns() }); }
    catch (error) { ledgerError(res, error); }
  });
  app.get("/api/canonical-enrichment/uploads/:executionId/summary", ...ledgerGuard, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); res.json(await readUploadLedgerSummary(req.params.executionId)); }
    catch (error) { ledgerError(res, error); }
  });
  app.get("/api/canonical-enrichment/uploads/:executionId/rows", ...ledgerGuard, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await readUploadLedgerPage({ executionId: req.params.executionId, after: req.query.after,
        limit: req.query.limit, filter: req.query.filter }));
    } catch (error) { ledgerError(res, error); }
  });
}
