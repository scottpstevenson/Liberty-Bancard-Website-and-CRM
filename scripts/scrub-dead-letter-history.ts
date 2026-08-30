#!/usr/bin/env tsx
/**
 * Replace legacy DLQ free-form data with strict snapshots.
 * Dry-run is the default. --execute is required for a write.
 *
 * Resume with --after-id=<last printed id>; --count-only reports scope without
 * reading/writing payloads. This script intentionally addresses only
 * review_queue.source_type = dead_letter_job.
 */
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const countOnly = args.includes("--count-only");
const afterArg = args.find((arg) => arg.startsWith("--after-id="));
const afterId = afterArg ? Number(afterArg.slice("--after-id=".length)) : 0;
const batchArg = args.find((arg) => arg.startsWith("--batch-size="));
const batchSize = Math.min(Math.max(Number(batchArg?.slice(13) ?? 100), 1), 500);
const snapshotArg = args.find((arg) => arg.startsWith("--snapshot-id="));
const suppliedSnapshotId = snapshotArg ? Number(snapshotArg.slice("--snapshot-id=".length)) : null;
if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(batchSize)) {
  throw new Error("Invalid --after-id or --batch-size");
}
if (suppliedSnapshotId != null && (!Number.isSafeInteger(suppliedSnapshotId) || suppliedSnapshotId < 0)) {
  throw new Error("Invalid --snapshot-id");
}
if (execute && process.env.RVR05_AUTHORIZE_DLQ_SCRUB !== "yes") {
  throw new Error("--execute requires RVR05_AUTHORIZE_DLQ_SCRUB=yes");
}

async function main() {
  const [{ db }, { reviewQueue }, { and, eq, gt, lte, asc, count, desc }, { sanitizeDeadLetterEvent }] =
    await Promise.all([
      import("../server/db"),
      import("../shared/schema"),
      import("drizzle-orm"),
      import("../server/services/audit-sanitizer"),
    ]);
  const scope = eq(reviewQueue.sourceType, "dead_letter_job");
  if (countOnly) {
    const [result] = await db.select({ count: count() }).from(reviewQueue).where(scope);
    console.log(JSON.stringify({ source_type: "dead_letter_job", count: Number(result?.count ?? 0), mode: "count-only" }));
    return;
  }
  const snapshotId = suppliedSnapshotId ?? (
    await db.select({ id: reviewQueue.id }).from(reviewQueue)
      .where(scope).orderBy(desc(reviewQueue.id)).limit(1)
  )[0]?.id ?? 0;
  const rows = await db.select().from(reviewQueue)
    .where(and(scope, gt(reviewQueue.id, afterId), lte(reviewQueue.id, snapshotId)))
    .orderBy(asc(reviewQueue.id)).limit(batchSize);
  let changed = 0;
  for (const row of rows) {
    const metadata = sanitizeDeadLetterEvent(row.metadata);
    // Fixed notes prevent raw legacy exceptions from being retained.
    const needsWrite = row.notes !== "Historical DLQ event; inspect protected job record."
      || JSON.stringify(row.metadata) !== JSON.stringify(metadata);
    if (!needsWrite) continue;
    changed++;
    if (execute) {
      await db.update(reviewQueue)
        .set({ notes: "Historical DLQ event; inspect protected job record.", metadata, updatedAt: new Date() })
        .where(and(eq(reviewQueue.id, row.id), scope));
    }
  }
  const lastId = rows[rows.length - 1]?.id ?? afterId;
  console.log(JSON.stringify({
    source_type: "dead_letter_job", mode: execute ? "execute" : "dry-run",
    scanned: rows.length, would_change: changed, snapshot_id: snapshotId, after_id: lastId,
    resume: rows.length === batchSize ? `--snapshot-id=${snapshotId} --after-id=${lastId}` : null,
  }));
}
main().catch((err) => { console.error("[scrub-dead-letter-history]", err.message); process.exitCode = 1; });