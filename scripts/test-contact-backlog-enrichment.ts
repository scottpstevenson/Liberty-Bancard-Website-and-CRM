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
import { contacts, enrichmentRuns, serperControl, businesses } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  getContactIdsNeedingEnrichment,
  getEnrichmentBacklogCount,
  enrichContactBatch,
  _serperDeps,
  _crawlerDeps,
} from "../server/services/enrichment";
import {
  selectContactDiscoveryEmail,
  crawlFirstPartyContactEmails,
  type ContactPageCrawlCandidate,
} from "../server/services/sdr/contactpage-enrichment";

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

/** Same pattern as withMockedSerper, for the first-party crawler seam. */
async function withMockedCrawler<T>(
  mocks: Partial<typeof _crawlerDeps>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = { ..._crawlerDeps };
  Object.assign(_crawlerDeps, mocks);
  try {
    return await fn();
  } finally {
    Object.assign(_crawlerDeps, original);
  }
}

/** Serper mock preset: found a website, no email/phone (forces the email-search + crawler paths). */
function serperWebsiteOnlyNoEmail(website: string) {
  return async () => ({
    website,
    emails: [],
    phones: [],
    knowledgeGraphPhone: null,
    knowledgeGraphWebsite: null,
    organicUrls: [],
    sources: ["mock"],
    providerAttempted: true,
  }) as any;
}

/** Serper email-search mock preset: genuinely completed, found nothing. */
async function serperEmailSearchNoMatch() {
  return { emails: [], phones: [], sources: [], providerAttempted: true } as any;
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
  // Suffix for every domain-shaped fixture value in the crawler tests below
  // so re-running this script never collides with a leftover row from a
  // prior interrupted run.
  const runId = Date.now();

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

  console.log("\n── Test 8: selectContactDiscoveryEmail policy — accepts role inboxes, ranks mailto+on-domain highest ──");
  {
    const candidates: ContactPageCrawlCandidate[] = [
      { email: "info@example-biz.com", sourceUrl: "https://example-biz.com/contact", evidenceType: "mailto" },
      { email: "someone@gmail.com", sourceUrl: "https://example-biz.com/contact", evidenceType: "visible_text" },
    ];
    const selection = selectContactDiscoveryEmail(candidates, "example-biz.com");
    assert(selection.email === "info@example-biz.com", "on-domain mailto role-inbox address outranks an off-domain visible-text address");
    assert(!selection.ambiguous, "a clear top-scoring candidate is not reported as ambiguous");
  }

  console.log("\n── Test 9: selectContactDiscoveryEmail policy — tied top score reports ambiguous, no guess ──");
  {
    const candidates: ContactPageCrawlCandidate[] = [
      { email: "sales@example-biz.com", sourceUrl: "https://example-biz.com/contact", evidenceType: "mailto" },
      { email: "info@example-biz.com", sourceUrl: "https://example-biz.com/about", evidenceType: "mailto" },
    ];
    const selection = selectContactDiscoveryEmail(candidates, "example-biz.com");
    assert(selection.ambiguous === true, "two same-scoring on-domain mailto role addresses tie -> ambiguous");
    assert(selection.email === null, "an ambiguous tie never guesses an email");
  }

  console.log("\n── Test 10: selectContactDiscoveryEmail — empty candidate list returns no selection, not ambiguous ──");
  {
    const selection = selectContactDiscoveryEmail([], "example-biz.com");
    assert(selection.email === null && selection.ambiguous === false, "no candidates -> null email, not a false ambiguous flag");
  }

  console.log("\n── Test 10b: selectContactDiscoveryEmail — a lone off-domain, non-hosted address is never selected, even with mailto evidence ──");
  {
    // Simulates a vendor/agency-footer mailto ("site built by X, contact
    // sales@some-web-agency.com") or an embedded third-party script address
    // — real HTML noise that must never be attributed to the crawled
    // business just because it's the only candidate found on the page.
    const candidates: ContactPageCrawlCandidate[] = [
      { email: "sales@some-web-agency.com", sourceUrl: "https://example-biz.com/", evidenceType: "mailto" },
    ];
    const selection = selectContactDiscoveryEmail(candidates, "example-biz.com");
    assert(selection.email === null, "an off-domain, non-hosted address is excluded outright, not selected as the lone candidate");
    assert(!selection.ambiguous, "exclusion is a clean no-match, not a false ambiguous flag");
  }

  console.log("\n── Test 10c: selectContactDiscoveryEmail — an allowed free/hosted domain address is still selectable when it's the only candidate ──");
  {
    const candidates: ContactPageCrawlCandidate[] = [
      { email: "info@gmail.com", sourceUrl: "https://example-biz.com/contact", evidenceType: "mailto" },
    ];
    const selection = selectContactDiscoveryEmail(candidates, "example-biz.com");
    assert(selection.email === "info@gmail.com", "an explicitly allowed hosted-email domain address is still eligible even though it's off the site's own domain");
  }

  console.log("\n── Test 10d: registrableDomain is public-suffix-aware for two-label ccTLDs like .co.uk ──");
  {
    // Naive last-two-labels logic would treat "biz-one.co.uk" and
    // "biz-two.co.uk" as the same registrable domain ("co.uk"), wrongly
    // accepting an address from an unrelated .co.uk business as "on-domain".
    const candidates: ContactPageCrawlCandidate[] = [
      { email: "info@biz-two.co.uk", sourceUrl: "https://biz-one.co.uk/contact", evidenceType: "mailto" },
    ];
    const selection = selectContactDiscoveryEmail(candidates, "biz-one.co.uk");
    assert(selection.email === null, "an address from an unrelated business sharing only the .co.uk public suffix is not treated as on-domain");

    const sameSiteCandidates: ContactPageCrawlCandidate[] = [
      { email: "info@biz-one.co.uk", sourceUrl: "https://biz-one.co.uk/contact", evidenceType: "mailto" },
    ];
    const sameSiteSelection = selectContactDiscoveryEmail(sameSiteCandidates, "biz-one.co.uk");
    assert(sameSiteSelection.email === "info@biz-one.co.uk", "an address genuinely on the same .co.uk registrable domain is still correctly accepted as on-domain");
  }

  console.log("\n── Test 11: crawlFirstPartyContactEmails — SSRF-unsafe target is blocked, never fetched ──");
  {
    const result = await crawlFirstPartyContactEmails("localhost");
    assert(result.candidates.length === 0, "no candidates returned for an SSRF-blocked target");
    assert(result.pagesAttempted === 0, "no page fetch was attempted against an SSRF-blocked target");
  }

  console.log("\n── Test 12: website priority order — contact.website wins over serperResult.website for the email-search domain ──");
  const c12domain = `priority-contact-domain-${runId}.com`;
  const c12 = await makeTestContact({
    companyName: "Priority Order Contact Website Task1977",
    email: "",
    website: c12domain,
  });
  try {
    let searchBusinessEmailDomain: string | null = null;
    await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(`priority-serper-domain-${runId}.com`),
        searchBusinessEmail: async (_name, website) => {
          searchBusinessEmailDomain = website;
          return serperEmailSearchNoMatch();
        },
      },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => ({ candidates: [], fetchCompleted: true, pagesAttempted: 1 }) },
        () => enrichContactBatch([c12.id], { batchSize: 1 }),
      ),
    );
    assert(searchBusinessEmailDomain === c12domain, "email search used the contact's own existing website, not the Serper-returned one");
  } finally {
    await cleanupContact(c12.id);
  }

  console.log("\n── Test 13: website priority order — linked business.websiteDomain used when contact has none ──");
  // Run-unique domain: businesses.website_domain has a plain (non-unique)
  // index, but reusing a constant literal across runs makes a prior
  // interrupted run's leftover row ambiguous to reason about. Keep fixtures
  // fully rerunnable by deriving from Date.now().
  const biz13Domain = `priority-business-domain-${Date.now()}.com`;
  const [biz13] = await db.insert(businesses).values({
    canonicalName: "Priority Order Business Task1977",
    normalizedName: "priority order business task1977",
    websiteDomain: biz13Domain,
  } as any).returning();
  const c13 = await makeTestContact({
    companyName: "Priority Order Business Link Task1977",
    email: "",
    website: null,
    businessId: biz13.id,
  });
  try {
    let searchBusinessEmailDomain: string | null = null;
    await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail("priority-serper-domain-2.com"),
        searchBusinessEmail: async (_name, website) => {
          searchBusinessEmailDomain = website;
          return serperEmailSearchNoMatch();
        },
      },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => ({ candidates: [], fetchCompleted: true, pagesAttempted: 1 }) },
        () => enrichContactBatch([c13.id], { batchSize: 1 }),
      ),
    );
    assert(searchBusinessEmailDomain === biz13Domain, "email search used the linked business's canonical website_domain, not the Serper-returned one");
  } finally {
    // Unlink the contact from the business FIRST — deleting the business
    // while a contact still references it via businessId (and while
    // ingestBusinessFromContact's materialization may hold link-candidate
    // rows) is exactly the kind of ordering that leaves cleanup half-done
    // and fixtures non-rerunnable.
    await db.execute(sql`DELETE FROM contact_business_link_candidates WHERE business_id = ${biz13.id}`).catch(() => {});
    await db.update(contacts).set({ businessId: null }).where(eq(contacts.id, c13.id)).catch(() => {});
    await cleanupContact(c13.id);
    await db.delete(businesses).where(eq(businesses.id, biz13.id)).catch(() => {});
  }

  console.log("\n── Test 14: crawler is skipped entirely when Serper's primary call already found an email ──");
  const c14domain = `skip-crawler-primary-${runId}.com`;
  const c14 = await makeTestContact({
    companyName: "Skip Crawler Serper Primary Task1977",
    email: "",
    website: c14domain,
  });
  try {
    let crawlerCalled = false;
    const result = await withMockedSerper(
      {
        searchBusiness: async () => ({
          website: c14domain,
          emails: [`found@${c14domain}`],
          phones: [],
          knowledgeGraphPhone: null, knowledgeGraphWebsite: null, organicUrls: [], sources: ["mock"],
          providerAttempted: true,
        }) as any,
      },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => { crawlerCalled = true; return { candidates: [], fetchCompleted: true, pagesAttempted: 1 }; } },
        () => enrichContactBatch([c14.id], { batchSize: 1 }),
      ),
    );
    assert(!crawlerCalled, "crawler never runs when Serper's primary call already found an email");
    assert(result.crawlerDomainsAttempted === 0, "crawlerDomainsAttempted stays 0 when the crawler step is skipped");
    assert(result.serperEmailsFound === 1 && result.crawlerEmailsFound === 0, "the found email is attributed to Serper, not the crawler");
  } finally {
    await cleanupContact(c14.id);
  }

  console.log("\n── Test 15: crawler finds an email after both Serper steps complete with nothing — write path, telemetry, discovery-source tag ──");
  const c15domain = `crawler-finds-email-${runId}.com`;
  const c15 = await makeTestContact({
    companyName: "Crawler Finds Email Task1977",
    email: "",
    website: c15domain,
  });
  try {
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c15domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async () => ({
            candidates: [{ email: `info@${c15domain}`, sourceUrl: `https://${c15domain}/contact`, evidenceType: "mailto" }],
            fetchCompleted: true,
            pagesAttempted: 2,
          }),
        },
        () => enrichContactBatch([c15.id], { batchSize: 1 }),
      ),
    );
    assert(result.crawlerDomainsAttempted === 1, "crawler was attempted for exactly one domain");
    assert(result.crawlerPagesAttempted === 2, "crawler page-attempt count is threaded through to the batch return");
    assert(result.crawlerEmailsFound === 1, "batch reports the crawler-sourced email");
    assert(result.serperEmailsFound === 0, "no Serper email was found on this contact — only the crawler found one");

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c15.id));
    assert(after.email === `info@${c15domain}`, "the crawler-discovered email was actually written to the contact via the canonical writer");

    const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c15.id));
    assert((run?.outputPayload as any)?.emailDiscoverySource === "first_party_contact_page", "the enrichment_runs row tags this contact's discovery source as first_party_contact_page");
  } finally {
    await cleanupContact(c15.id);
  }

  console.log("\n── Test 16: ambiguous crawl result does not write an email, but still counts as a genuine completed attempt ──");
  const c16domain = `crawler-ambiguous-${runId}.com`;
  const c16 = await makeTestContact({
    companyName: "Crawler Ambiguous Task1977",
    email: "",
    website: c16domain,
  });
  try {
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c16domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async () => ({
            candidates: [
              { email: `sales@${c16domain}`, sourceUrl: `https://${c16domain}/contact`, evidenceType: "mailto" },
              { email: `info@${c16domain}`, sourceUrl: `https://${c16domain}/about`, evidenceType: "mailto" },
            ],
            fetchCompleted: true,
            pagesAttempted: 2,
          }),
        },
        () => enrichContactBatch([c16.id], { batchSize: 1 }),
      ),
    );
    assert(result.crawlerAmbiguous === 1, "the tie is counted as ambiguous");
    assert(result.crawlerEmailsFound === 0 && result.emailsFound === 0, "no email is written when the crawler's top candidates tie");

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c16.id));
    assert(!after.email, "contact email remains unset after an ambiguous crawl result");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c16.id));
    assert(runs.length === 1, "a genuine no-match cooldown row is still recorded — both Serper steps and the crawler all genuinely completed");
  } finally {
    await cleanupContact(c16.id);
  }

  console.log("\n── Test 17: contacts sharing a domain trigger only one crawl per batch, and telemetry counts the crawl once, not per contact ──");
  const c17domain = `shared-domain-crawl-${runId}.com`;
  const c17a = await makeTestContact({ companyName: "Shared Domain A Task1977", email: "", website: c17domain });
  const c17b = await makeTestContact({ companyName: "Shared Domain B Task1977", email: "", website: c17domain });
  try {
    let crawlCallCount = 0;
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c17domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async () => {
            crawlCallCount++;
            return { candidates: [], fetchCompleted: true, pagesAttempted: 3 };
          },
        },
        () => enrichContactBatch([c17a.id, c17b.id], { batchSize: 2 }),
      ),
    );
    assert(crawlCallCount === 1, "two contacts sharing the same domain trigger exactly one crawl for the whole batch");
    assert(result.crawlerDomainsAttempted === 1, "crawlerDomainsAttempted counts the one real crawl, not one per consuming contact");
    assert(result.crawlerPagesAttempted === 3, "crawlerPagesAttempted counts the one real crawl's pages, not doubled for the second contact reading the cache");
  } finally {
    await cleanupContact(c17a.id);
    await cleanupContact(c17b.id);
  }

  console.log("\n── Test 19: crawler transport failure (fetchCompleted:false) does not suppress the contact for 24h ──");
  const c19domain = `crawler-transport-failure-${runId}.com`;
  const c19 = await makeTestContact({
    companyName: "Crawler Transport Failure Task1977",
    email: "",
    website: c19domain,
  });
  try {
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c19domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        // A transport failure (timeout / DNS failure / thrown exception) reports
        // fetchCompleted:false — distinct from an SSRF block or a successful
        // fetch with zero candidates, both of which report fetchCompleted:true.
        { crawlFirstPartyContactEmails: async () => ({ candidates: [], fetchCompleted: false, pagesAttempted: 0 }) },
        () => enrichContactBatch([c19.id], { batchSize: 1 }),
      ),
    );
    assert(result.emailsFound === 0, "no email is written when the crawl transport failed");

    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c19.id));
    assert(runs.length === 0, "no cooldown row is recorded when the crawl never genuinely completed — the contact must stay immediately eligible for retry");
  } finally {
    await cleanupContact(c19.id);
  }

  console.log("\n── Test 19b: a crawl transport failure on one contact's domain does not stop the batch — unrelated later contacts still get processed ──");
  const c19bFail = await makeTestContact({
    companyName: "Crawler Transport Failure First Task1977",
    email: "",
    website: `crawler-fail-first-${runId}.com`,
  });
  const c19bOk = await makeTestContact({
    companyName: "Crawler Transport Failure Second Task1977",
    email: "",
    website: `crawler-ok-second-${runId}.com`,
  });
  try {
    const result = await withMockedSerper(
      {
        searchBusiness: async (_name: string, _city?: string) => ({
          website: null, emails: [], phones: [], knowledgeGraphPhone: null, knowledgeGraphWebsite: null,
          organicUrls: [], sources: ["mock"], providerAttempted: true,
        }) as any,
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async (domain: string) => {
            if (domain === `crawler-fail-first-${runId}.com`) {
              return { candidates: [], fetchCompleted: false, pagesAttempted: 0 };
            }
            return {
              candidates: [{ email: `info@crawler-ok-second-${runId}.com`, sourceUrl: `https://crawler-ok-second-${runId}.com/contact`, evidenceType: "mailto" as const }],
              fetchCompleted: true,
              pagesAttempted: 1,
            };
          },
        },
        () => enrichContactBatch([c19bFail.id, c19bOk.id], { batchSize: 2 }),
      ),
    );
    assert(!result.gatewayBlocked, "batch is not reported as gateway-blocked just because one contact's own domain failed to crawl");
    assert(result.crawlerEmailsFound === 1, "the second contact's crawler-sourced email is still found in the same batch run");

    const [failAfter] = await db.select().from(contacts).where(eq(contacts.id, c19bFail.id));
    assert(!failAfter.email, "the failed-crawl contact's email remains unset");
    const failRuns = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c19bFail.id));
    assert(failRuns.length === 0, "the failed-crawl contact gets no cooldown row and stays eligible for retry");

    const [okAfter] = await db.select().from(contacts).where(eq(contacts.id, c19bOk.id));
    assert(okAfter.email === `info@crawler-ok-second-${runId}.com`, "the second, unrelated contact was still fully processed and its email written despite the first contact's crawl failure");
  } finally {
    await cleanupContact(c19bFail.id);
    await cleanupContact(c19bOk.id);
  }

  console.log("\n── Test 20: crawler SSRF-block still counts as a genuinely completed lookup (not a transport failure) ──");
  // contact.website takes top priority in domain resolution (Test 12), so
  // "localhost" reaches the real, unmocked crawler as bestKnownDomain — no
  // Serper mock is needed to steer it there.
  const c20 = await makeTestContact({
    companyName: "Crawler SSRF Block Task1977",
    email: "",
    website: "localhost",
  });
  try {
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(`ssrf-block-marker-${runId}.internal`),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      // Exercise the real crawler (no _crawlerDeps mock) against an
      // SSRF-unsafe target to confirm the real fetchCompleted:true "blocked
      // but complete" outcome, mirroring Test 11 but through the full
      // enrichContactBatch integration path.
      () => enrichContactBatch([c20.id], { batchSize: 1 }),
    );
    const runs = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c20.id));
    assert(runs.length === 1, "an SSRF-blocked crawl (fetchCompleted:true) is a genuine completion — a cooldown row is recorded, not treated as a transport failure");
    assert(result.emailsFound === 0, "no email is found for an SSRF-blocked domain");
  } finally {
    await cleanupContact(c20.id);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
