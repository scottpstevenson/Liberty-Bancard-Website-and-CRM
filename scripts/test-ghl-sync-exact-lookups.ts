/**
 * Proves the GHL sync task/deal lookups are exact-key queries, not first-N scans.
 * Seeds >500 newer rows after the target so a limit-500 window would miss it.
 * All fixtures are removed in finally. Run: npx tsx scripts/test-ghl-sync-exact-lookups.ts
 */
import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import { contacts, deals, tasks } from "../shared/schema";
import { eq, inArray, like } from "drizzle-orm";

const RUN = `ghl-exact-${Date.now()}`;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${label}`); else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function main() {
  const ids = { contact: 0, deals: [] as number[], tasks: [] as number[] };
  try {
    const [c] = await db.insert(contacts).values({
      firstName: "Exact", lastName: "Lookup", email: `${RUN}@test.internal`, phone: `+1555${String(Date.now()).slice(-7)}`,
    } as any).returning();
    ids.contact = c.id;

    // Target rows are the OLDEST; 520 newer rows follow so a newest-500 window excludes them.
    const old = new Date(Date.now() - 3 * 86400_000);
    const [targetDeal] = await db.insert(deals).values({
      contactId: c.id, name: `${RUN}-target`, pipeline: "sales", stage: "new", createdAt: old, updatedAt: old,
    } as any).returning();
    const [targetTask] = await db.insert(tasks).values({
      title: `${RUN}-target`, createdAt: old,
    } as any).returning();
    ids.deals.push(targetDeal.id); ids.tasks.push(targetTask.id);

    const fillerDeals = Array.from({ length: 520 }, (_, i) => ({
      contactId: c.id, name: `${RUN}-filler-${i}`, pipeline: "sales", stage: "new", ghlOpportunityId: `${RUN}-opp-${i}`,
    }));
    const insertedDeals = await db.insert(deals).values(fillerDeals as any).returning({ id: deals.id });
    ids.deals.push(...insertedDeals.map(d => d.id));
    const insertedTasks = await db.insert(tasks).values(
      Array.from({ length: 520 }, (_, i) => ({ title: `${RUN}-filler-${i}` })) as any,
    ).returning({ id: tasks.id });
    ids.tasks.push(...insertedTasks.map(t => t.id));

    console.log("\n[1] task lookup by id beyond the newest 500");
    const newest500 = await storage.getTasks({ limit: 500 });
    check("fixture is outside the newest-500 window", !newest500.some((t: any) => t.id === targetTask.id));
    const found = await storage.getTasks({ taskId: targetTask.id, limit: 1 });
    check("exact lookup finds the old task", found.length === 1 && found[0].id === targetTask.id);
    const missing = await storage.getTasks({ taskId: 2147483000, limit: 1 });
    check("unknown id returns nothing", missing.length === 0);
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, targetTask.id));
    check("soft-deleted task still hidden by read authority",
      (await storage.getTasks({ taskId: targetTask.id, limit: 1 })).length === 0);

    console.log("\n[2] unsynced-deal lookup beyond the newest 500");
    const newest500Deals = await storage.getDeals({ limit: 500 });
    check("fixture is outside the newest-500 deal window", !newest500Deals.data.some(d => d.id === targetDeal.id));
    // Pending set is global in a shared DB; page wide enough to include our target.
    const pending = await storage.getDealsPendingGhlSync(100000);
    check("pending query includes the old unsynced deal", pending.some(d => d.id === targetDeal.id));
    check("pending query excludes deals with a GHL opportunity id",
      !pending.some(d => d.name?.startsWith(`${RUN}-filler`)));
    check("pending query honours limit", (await storage.getDealsPendingGhlSync(5)).length <= 5);
  } finally {
    if (ids.tasks.length) await db.delete(tasks).where(inArray(tasks.id, ids.tasks));
    if (ids.deals.length) await db.delete(deals).where(inArray(deals.id, ids.deals));
    await db.delete(deals).where(like(deals.name, `${RUN}%`));
    if (ids.contact) await db.delete(contacts).where(eq(contacts.id, ids.contact));
    await pool.end();
  }
  if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
  console.log("\nAll checks passed");
}
main().catch(e => { console.error(e); process.exit(1); });
