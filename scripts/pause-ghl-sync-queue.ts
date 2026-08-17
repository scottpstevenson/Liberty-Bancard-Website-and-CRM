#!/usr/bin/env tsx
/**
 * Pause or resume the ghl-sync BullMQ queue (pause state persists in Redis and
 * is honored by the running worker). Used during test-contact cleanup windows.
 *
 * Usage: npx tsx scripts/pause-ghl-sync-queue.ts pause|resume|status
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "../server/services/queue-connection";

async function main() {
  const cmd = process.argv[2];
  if (!["pause", "resume", "status"].includes(cmd ?? "")) {
    console.error("Usage: pause-ghl-sync-queue.ts pause|resume|status");
    process.exit(2);
  }
  const connection = await getRedisConnection();
  const q = new Queue("ghl-sync", { connection });
  if (cmd === "pause") await q.pause();
  if (cmd === "resume") await q.resume();
  const paused = await q.isPaused();
  console.log(`ghl-sync queue paused=${paused} at ${new Date().toISOString()}`);
  await q.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
