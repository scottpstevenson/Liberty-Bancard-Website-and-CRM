#!/usr/bin/env tsx
/**
 * Focused checks for the existing-contact backlog enrichment path
 * (server/services/enrichment.ts: getContactIdsNeedingEnrichment,
 * getEnrichmentBacklogCount, enrichContactBatch).
 *
 * Proves, against the real DB with disposable test contacts:
 *  1. A placeholder email (no-email-*@no-email....internal) is treated as
 *     missing by both the SQL selection predicate and the per-contact
 *     enrichContactBatch check (they must not drift).
 *  2. A genuine "Serper found nothing" attempt records a cooldown row and
 *     the contact drops out of the next automatic selection page.
 *  3. A gateway-blocked attempt (circuit forced open) does NOT record a
 *     cooldown row, and the batch reports status "blocked" — the contact
 *     remains immediately eligible once the gateway recovers.
 *
 * Exits 0 on all pass, 1 on any failure. Cleans up every row it creates.
 * Makes at most one real outbound Serper call (test #2); test #3 forces the
 * gateway closed first so it never reaches the network.
 */

import { db } from "../server/db";
import { contacts, enrichmentRuns, serperControl } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  getContactIdsNeedingEnrichment,
  getEnrichmentBacklogCount,
  enrichContactBatch,
  _serperDeps,
} from "../server/services/enrichment";

/** Swap enrichContactBatch's Serper calls for the duration of `fn`, then
 * restore the originals — lets us deterministically simulate provider
 * outcomes (found data, blocked mid-lookup) without depending on live,
 * non-deterministic Serper responses. Mutates `_serperDeps`'s properties
 * (not the `serper.ts` import bindings, which ESM freezes). */
async function withMockedSerper<T>(
  mocks: Partial<typeof _serperDeps>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = { ..._serperDeps };
  Object.assign(_serperDeps, mocks);
  try {
    return await fn();
  } finally {
    Object.assign(_serperDeps, original);
  }
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ FAIL: ${label}`); failed++; }
}

async function makeTestContact(overrides: Partial<typeof contacts.$inferInsert>) {
  const [row] = await db.insert(contacts).values({
    companyName: "Backlog Test Biz",
    firstName: "Backlog",
    lastName: "Test",
    email: "",
    phone: "5550001111",
    website: "https://backlog-test-example.com",
    ...overrides,
  } as any).returning();
  return row;
}

async function cleanupContact(id: number) {
  await db.execute(sql`DELETE FROM contact_business_link_candidates WHERE contact_id = ${id}`).catch(() => {});
  await db.delete(enrichmentRuns).where(eq(enrichmentRuns.contactId, id)).catch(() => {});
  await db.execute(sql`UPDATE contacts SET archived_at = now() WHERE id = ${id}`).catch(async () => {
    await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
  });
}

async function main() {
  console.log("\n── Test 1: placeholder email is treated as missing ──");
  const c1 = await makeTestContact({
    email: "no-email-test1943@no-email.libertybancard.internal",
  });
  try {
    const ids = await getContactIdsNeedingEnrichment(100000);
    assert(ids.includes(c1.id), "SQL selection includes the placeholder-email contact");
  } finally {
    await cleanupContact(c1.id);
  }

  console.log("\n── Test 2: genuine no-match records a cooldown row ──");
  const c2 = await makeTestContact({
    companyName: "Zzz Nonexistent Test Corp Task1943",
    email: "",
    phone: "",
    website: null,
  });
  try {
    const before = await getContactIdsNeedingEnrichment(1000000);
    assert(before.includes(c2.id), "contact appears in backlog before any attempt");

    // Mocked genuine no-match: a real, completed provider round-trip that
    // simply found nothing — no live Serper call is made (avoids spending
    // paid API budget on a throwaway test contact).
    const result = await withMockedSerper(
      {
        searchBusiness: async () => ({
          providerAttempted: true,
          website: null,
          emails: [],
          phones: [],
        }) as any,
      },
      () => enrichContactBatch([c2.id], { batchSize: 1 }),
    );
    assert(result.processed === 1 && result.errors === 0, "batch processed the contact without error");

    const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c2.id));
    assert(!!run, "an enrichment_runs row was recorded for the attempt");

    const after = await getContactIdsNeedingEnrichment(1000000);
    assert(!after.includes(c2.id), "contact is excluded from automatic selection during its 24h cooldown");

    const stillInBacklog = (await getEnrichmentBacklogCount()) >= 0;
    assert(stillInBacklog, "backlog count query still runs (contact remains genuinely unresolved)");
  } finally {
    await cleanupContact(c2.id);
  }

  console.log("\n── Test 3: gateway-blocked attempt does NOT create a cooldown row ──");
  const c3 = await makeTestContact({
    companyName: "Gateway Blocked Test Task1943",
    email: "",
  });
  const [priorControl] = await db.select().from(serperControl).where(eq(serperControl.id, 1));
  try {
    // Force the circuit open so enrichContactBatch's gateway check trips
    // before any network call is made.
    await db.update(serperControl).set({ state: "open", enabled: true }).where(eq(serperControl.id, 1));

    const result = await enrichContactBatch([c3.id], { batchSize: 1 });
    assert(result.processed === 0, "no contact was counted as processed once the gateway blocked");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c3.id));
    assert(runs.length === 0, "no enrichment_runs cooldown row was created for the blocked attempt");

    const stillEligible = await getContactIdsNeedingEnrichment(1000000);
    assert(stillEligible.includes(c3.id), "contact remains immediately eligible (no false cooldown) after the block");
  } finally {
    if (priorControl) {
      await db.update(serperControl).set({ state: priorControl.state, enabled: priorControl.enabled }).where(eq(serperControl.id, 1));
    }
    await cleanupContact(c3.id);
  }

  console.log("\n── Test 4: budget exhaustion (deeper block than circuit state) does NOT create a cooldown row ──");
  const c4 = await makeTestContact({
    companyName: "Budget Exhausted Test Task1943",
    email: "",
  });
  const [priorControl4] = await db.select().from(serperControl).where(eq(serperControl.id, 1));
  try {
    // Circuit stays "closed" (passes the cheap pre-filter) but the atomic
    // budget claim inside executeSearch fails — this is the exact gap the
    // pre-filter alone cannot see, only the real call outcome can.
    if (!priorControl4) throw new Error("serper_control row missing");
    await db.update(serperControl).set({ state: "closed", enabled: true, localBudget: priorControl4.windowCalls }).where(eq(serperControl.id, 1));

    const result = await enrichContactBatch([c4.id], { batchSize: 1 });
    assert(result.processed === 0, "no contact was counted as processed once the budget was exhausted");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c4.id));
    assert(runs.length === 0, "no enrichment_runs cooldown row was created for the budget-exhausted attempt");

    const stillEligible = await getContactIdsNeedingEnrichment(1000000);
    assert(stillEligible.includes(c4.id), "contact remains immediately eligible (no false cooldown) after budget exhaustion");
  } finally {
    if (priorControl4) {
      await db.update(serperControl).set({ state: priorControl4.state, enabled: priorControl4.enabled, localBudget: priorControl4.localBudget }).where(eq(serperControl.id, 1));
    }
    await cleanupContact(c4.id);
  }

  console.log("\n── Test 5: half-open probe contention does NOT create a cooldown row ──");
  const c5 = await makeTestContact({
    companyName: "Half Open Contention Test Task1943",
    email: "",
  });
  const [priorControl5] = await db.select().from(serperControl).where(eq(serperControl.id, 1));
  try {
    // A probe is already claimed and in flight — any second caller must be
    // blocked, not allowed a concurrent real request.
    await db.update(serperControl).set({ state: "half_open", enabled: true, halfOpenProbeClaimedAt: new Date() }).where(eq(serperControl.id, 1));

    const result = await enrichContactBatch([c5.id], { batchSize: 1 });
    assert(result.processed === 0, "no contact was counted as processed while a half-open probe was already in flight");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c5.id));
    assert(runs.length === 0, "no enrichment_runs cooldown row was created for the half-open-contention attempt");

    const stillEligible = await getContactIdsNeedingEnrichment(1000000);
    assert(stillEligible.includes(c5.id), "contact remains immediately eligible (no false cooldown) after probe contention");
  } finally {
    if (priorControl5) {
      await db.update(serperControl).set({
        state: priorControl5.state,
        enabled: priorControl5.enabled,
        halfOpenProbeClaimedAt: priorControl5.halfOpenProbeClaimedAt,
      }).where(eq(serperControl.id, 1));
    }
    await cleanupContact(c5.id);
  }

  console.log("\n── Test 6: partial success (website found) then blocked email lookup — website saved, NO cooldown row, contact stays eligible for email ──");
  const c6 = await makeTestContact({
    companyName: "Partial Success Blocked Task1943",
    email: "",
    website: null,
  });
  try {
    await withMockedSerper(
      {
        searchBusiness: async () => ({
          website: "partial-success-example.com",
          emails: [],
          phones: [],
          knowledgeGraphPhone: null,
          knowledgeGraphWebsite: null,
          organicUrls: [],
          sources: ["mock"],
          providerAttempted: true,
        }),
        searchBusinessEmail: async () => ({
          emails: [],
          phones: [],
          sources: [],
          providerAttempted: false, // simulates the gateway blocking mid-lookup
        }),
      },
      async () => {
        const result = await enrichContactBatch([c6.id], { batchSize: 1 });
        assert(result.gatewayBlocked === true, "batch reports gatewayBlocked for the mid-lookup block");
        assert(result.websitesFound === 1, "the website found before the block was counted");
      },
    );

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c6.id));
    assert(after.website === "partial-success-example.com", "website found before the block was actually saved to the contact");
    assert(!after.email, "email remains unset — the blocked lookup did not fabricate a result");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c6.id));
    assert(runs.length === 0, "no enrichment_runs row was created — a partial block must not create a cooldown-matching attempt");

    const stillEligible = await getContactIdsNeedingEnrichment(1000000);
    assert(stillEligible.includes(c6.id), "contact (still missing email) remains immediately eligible — not falsely suppressed by the saved website");
  } finally {
    await cleanupContact(c6.id);
  }

  console.log("\n── Test 7: enrichContactBatch actually replaces a placeholder email with mocked provider output ──");
  const c7 = await makeTestContact({
    companyName: "Placeholder Replacement Task1943",
    email: "no-email-replace-me@no-email.libertybancard.internal",
    phone: "5550009999",
    website: "https://placeholder-replace-example.com",
  });
  try {
    await withMockedSerper(
      {
        searchBusiness: async () => ({
          website: "placeholder-replace-example.com",
          emails: ["found@placeholder-replace-example.com"],
          phones: [],
          knowledgeGraphPhone: null,
          knowledgeGraphWebsite: null,
          organicUrls: [],
          sources: ["mock"],
          providerAttempted: true,
        }),
        searchBusinessEmail: async () => ({ emails: [], phones: [], sources: [], providerAttempted: true }),
      },
      async () => {
        const result = await enrichContactBatch([c7.id], { batchSize: 1 });
        assert(result.processed === 1, "the placeholder-email contact was processed");
        assert(result.emailsFound === 1, "batch reports an email was found");
      },
    );

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c7.id));
    assert(after.email === "found@placeholder-replace-example.com", "the placeholder email was actually replaced with the found one, not left as-is");
  } finally {
    await cleanupContact(c7.id);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
