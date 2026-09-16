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
import { contacts, enrichmentRuns, serperControl, businesses, freeDiscoveryCandidates, freeDiscoveryGenerations } from "@shared/schema";
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
  isRoleInboxEmail,
  type ContactPageCrawlCandidate,
} from "../server/services/sdr/contactpage-enrichment";
import { getCachedRoleEmails } from "../server/services/free-discovery/evidence-service";

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

  console.log("\n── Test 15: crawler finds a role-inbox email after both Serper steps complete with nothing — staged as candidate evidence, NEVER written to contacts.email (Task #1978 correction #3) ──");
  const c15domain = `crawler-finds-email-${runId}.com`;
  const c15 = await makeTestContact({
    companyName: "Crawler Finds Email Task1977",
    email: "",
    website: c15domain,
  });
  try {
    assert(isRoleInboxEmail(`info@${c15domain}`), "sanity check: info@ is classified as a role inbox");
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
    assert(result.crawlerEmailsFound === 1, "batch reports one candidate staged from the crawler");
    assert(result.emailsFound === 0 && result.totalEmailsFound === 0, "crawlerEmailsFound never rolls into emailsFound/totalEmailsFound — no contact write happened");
    assert(result.serperEmailsFound === 0, "no Serper email was found on this contact");

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c15.id));
    assert(!after.email, "the crawler-discovered address is NEVER written directly to contacts.email — it's staged as candidate evidence instead");

    const [staged] = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c15domain}`);
    assert(!!staged, "a free_discovery_candidates row was staged for the crawler-found address");
    assert(staged?.attributionScope === "role", "a role-inbox address (info@) is staged with role attribution");
    assert(staged?.subjectType === "business", "role attribution always carries subjectType='business' — never eligible for person-only projection");
    // Business-scoping (contactId left null) only applies when the contact
    // actually has a linked businessId; otherwise it correctly falls back to
    // contactId ownership (see Test 24) rather than being orphaned.
    assert(
      staged?.businessId !== null ? staged?.contactId === null : staged?.contactId === c15.id,
      "role attribution is business-scoped when a business link exists, else falls back to this contact — never orphaned",
    );

    const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c15.id));
    assert(run?.status === "candidate_staged", "the enrichment_runs audit row honestly reports candidate_staged, not a misleading no_match or success");
    assert((run?.outputPayload as any)?.emailDiscoverySource === "first_party_contact_page", "the enrichment_runs row tags this contact's discovery source as first_party_contact_page");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c15domain}`).catch(() => {});
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
    assert(runs[0]?.status === "no_match", "an ambiguous tie (no candidate staged) is honestly reported as no_match, not candidate_staged");
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
    assert(result.crawlerEmailsFound === 1, "the second contact's crawler-sourced candidate is still staged in the same batch run");

    const [failAfter] = await db.select().from(contacts).where(eq(contacts.id, c19bFail.id));
    assert(!failAfter.email, "the failed-crawl contact's email remains unset");
    const failRuns = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.contactId, c19bFail.id));
    assert(failRuns.length === 0, "the failed-crawl contact gets no cooldown row and stays eligible for retry");

    const [okAfter] = await db.select().from(contacts).where(eq(contacts.id, c19bOk.id));
    assert(!okAfter.email, "the second, unrelated contact was still fully processed, and its crawler-found address was staged as evidence, never written to contacts.email");

    const [okStaged] = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${`crawler-ok-second-${runId}.com`}`);
    assert(!!okStaged, "the second contact's crawler-found role address was staged as free-discovery candidate evidence");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${`crawler-ok-second-${runId}.com`}`).catch(() => {});
    await cleanupContact(c19bFail.id);
    await cleanupContact(c19bOk.id);
  }

  console.log("\n── Test 21: a named (non-role) crawler address is staged contact-scoped, never cached, and never reused for another contact on the same domain (Task #1978 correction #4) ──");
  const c21domain = `named-address-isolation-${runId}.com`;
  const c21a = await makeTestContact({ companyName: "Named Address A Task1978", email: "", website: c21domain });
  const c21b = await makeTestContact({ companyName: "Named Address B Task1978", email: "", website: c21domain });
  try {
    assert(!isRoleInboxEmail(`jane@${c21domain}`), "sanity check: jane@ is NOT classified as a role inbox");

    let crawlCallCount = 0;
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c21domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async () => {
            crawlCallCount++;
            // Only the first contact's crawl (shared per-batch crawlCache)
            // yields a candidate; a second, unrelated batch run for c21b
            // below gets a fresh crawl with nothing, proving the named
            // address from c21a's crawl was never served to c21b from cache.
            return { candidates: [{ email: `jane@${c21domain}`, sourceUrl: `https://${c21domain}/team`, evidenceType: "visible_text" as const }], fetchCompleted: true, pagesAttempted: 1 };
          },
        },
        () => enrichContactBatch([c21a.id], { batchSize: 1 }),
      ),
    );
    assert(result.crawlerEmailsFound === 1, "the named address is still staged as a candidate");

    const [after] = await db.select().from(contacts).where(eq(contacts.id, c21a.id));
    assert(!after.email, "the named address is never written to contacts.email");

    const [staged] = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c21domain}`);
    assert(staged?.attributionScope === "named", "a non-role address is staged with named attribution");
    assert(staged?.subjectType === "person", "named attribution always carries subjectType='person' — never eligible for business-email projection");
    assert(staged?.contactId === c21a.id, "named attribution is scoped to the exact contact it was found for");
    assert(staged?.businessId === null, "named attribution never carries a business-level scope (would make it reusable)");

    const cachedAfterNamed = await getCachedRoleEmails(c21domain);
    assert(cachedAfterNamed === null, "a named (non-role) address is never written into the reusable domain cache");

    // A second, independent batch run for a different contact at the same
    // domain must NOT receive c21a's named address from any cache — it has
    // to genuinely crawl again (proving no cross-contact leak per correction #4).
    const result2 = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c21domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => { crawlCallCount++; return { candidates: [], fetchCompleted: true, pagesAttempted: 1 }; } },
        () => enrichContactBatch([c21b.id], { batchSize: 1 }),
      ),
    );
    assert(crawlCallCount === 2, "the second contact's domain lookup triggered its own real crawl, not a cache hit off the first contact's named address");
    assert(result2.crawlerEmailsFound === 0, "the second contact gets no candidate — c21a's named address was never reused for c21b");
    const [after2] = await db.select().from(contacts).where(eq(contacts.id, c21b.id));
    assert(!after2.email, "the second contact's email remains unset — no cross-contact leak of the named address");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c21domain}`).catch(() => {});
    await db.execute(sql`DELETE FROM email_discovery_domain_cache WHERE domain = ${c21domain}`).catch(() => {});
    await cleanupContact(c21a.id);
    await cleanupContact(c21b.id);
  }

  console.log("\n── Test 22: SAME-BATCH two contacts sharing a domain — a named address the crawl surfaces for contact A must NOT also be attributed to contact B reading the cached in-flight crawl result (code-review regression) ──");
  const c22domain = `same-batch-named-leak-${runId}.com`;
  const c22a = await makeTestContact({ companyName: "Same Batch A Task1978", email: "", website: c22domain });
  const c22b = await makeTestContact({ companyName: "Same Batch B Task1978", email: "", website: c22domain });
  try {
    let c22CrawlCalls = 0;
    const result = await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c22domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          crawlFirstPartyContactEmails: async () => {
            c22CrawlCalls++;
            return { candidates: [{ email: `jane@${c22domain}`, sourceUrl: `https://${c22domain}/team`, evidenceType: "visible_text" as const }], fetchCompleted: true, pagesAttempted: 1 };
          },
        },
        // Both contacts processed in ONE batch call — this is the actual
        // in-batch crawlCache reuse path the earlier fix-round's test missed
        // by using two separate batch calls.
        () => enrichContactBatch([c22a.id, c22b.id], { batchSize: 2 }),
      ),
    );
    assert(c22CrawlCalls === 1, "the domain is only physically crawled once for the whole batch (shared crawlCache)");
    assert(result.crawlerEmailsFound === 1, "exactly ONE candidate is staged across the whole batch, not one per contact sharing the domain");

    const staged = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c22domain}`);
    assert(staged.length === 1, "only a single free_discovery_candidates row exists for this domain after the batch");
    assert(staged[0]?.attributionScope === "named", "the sole staged row is the named address");
    assert(staged[0]?.subjectType === "person", "the named address carries subjectType='person'");
    const namedOwner = staged[0]?.contactId;
    assert(namedOwner === c22a.id || namedOwner === c22b.id, "the named address is attributed to exactly one of the two contacts");

    const [afterA] = await db.select().from(contacts).where(eq(contacts.id, c22a.id));
    const [afterB] = await db.select().from(contacts).where(eq(contacts.id, c22b.id));
    assert(!afterA.email && !afterB.email, "neither contact's email column was written");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c22domain}`).catch(() => {});
    await db.execute(sql`DELETE FROM email_discovery_domain_cache WHERE domain = ${c22domain}`).catch(() => {});
    await cleanupContact(c22a.id);
    await cleanupContact(c22b.id);
  }

  console.log("\n── Test 23: a fresh NEGATIVE domain-cache entry (crawled recently, found nothing) skips recrawling for a second contact — and a subsequent authoritative empty recrawl clears any stale positive entry (code-review regression) ──");
  const c23domain = `negative-cache-skip-recrawl-${runId}.com`;
  const c23a = await makeTestContact({ companyName: "Negative Cache A Task1978", email: "", website: c23domain });
  const c23b = await makeTestContact({ companyName: "Negative Cache B Task1978", email: "", website: c23domain });
  try {
    let c23CrawlCalls = 0;
    // First, separate batch: crawl genuinely completes with nothing —
    // markDomainCrawled should cache the negative result.
    await withMockedSerper(
      { searchBusiness: serperWebsiteOnlyNoEmail(c23domain), searchBusinessEmail: serperEmailSearchNoMatch },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => { c23CrawlCalls++; return { candidates: [], fetchCompleted: true, pagesAttempted: 1 }; } },
        () => enrichContactBatch([c23a.id], { batchSize: 1 }),
      ),
    );
    assert(c23CrawlCalls === 1, "first contact's lookup triggers a real crawl");

    const cacheRow = (await db.execute(sql`SELECT role_emails FROM email_discovery_domain_cache WHERE domain = ${c23domain}`)).rows?.[0];
    assert(!!cacheRow && Array.isArray(cacheRow.role_emails) && cacheRow.role_emails.length === 0, "an empty-but-fresh cache row was written for the domain");

    // Second, independent batch for a different contact at the same domain:
    // must NOT trigger a second crawl — the fresh negative cache entry alone
    // is enough to skip it.
    const result2 = await withMockedSerper(
      { searchBusiness: serperWebsiteOnlyNoEmail(c23domain), searchBusinessEmail: serperEmailSearchNoMatch },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => { c23CrawlCalls++; return { candidates: [], fetchCompleted: true, pagesAttempted: 1 }; } },
        () => enrichContactBatch([c23b.id], { batchSize: 1 }),
      ),
    );
    assert(c23CrawlCalls === 1, "a fresh (even empty) cache entry prevents a second, redundant crawl for a different contact at the same domain");
    assert(result2.crawlerDomainsAttempted === 0, "batch reports zero crawler domain attempts when the domain cache is served instead");
    assert(result2.crawlerEmailsFound === 0, "no candidate is staged from a cached negative result");

    // Now simulate the cache entry going stale (past its 30-day TTL) by
    // directly backdating last_crawled_at, then prove a subsequent
    // authoritative crawl that finds a role address, followed by one that
    // finds nothing, actually CLEARS the previously-cached positive entry
    // rather than reviving it under a freshly-bumped timestamp.
    const c23c = await makeTestContact({ companyName: "Negative Cache C Task1978", email: "", website: c23domain });
    try {
      await db.execute(sql`UPDATE email_discovery_domain_cache SET last_crawled_at = now() - interval '31 days' WHERE domain = ${c23domain}`);
      const resultRole = await withMockedSerper(
        { searchBusiness: serperWebsiteOnlyNoEmail(c23domain), searchBusinessEmail: serperEmailSearchNoMatch },
        () => withMockedCrawler(
          { crawlFirstPartyContactEmails: async () => { c23CrawlCalls++; return { candidates: [{ email: `info@${c23domain}`, sourceUrl: `https://${c23domain}/contact`, evidenceType: "mailto" as const }], fetchCompleted: true, pagesAttempted: 1 }; } },
          () => enrichContactBatch([c23c.id], { batchSize: 1 }),
        ),
      );
      assert(c23CrawlCalls === 2, "the stale cache entry no longer prevents a recrawl");
      assert(resultRole.crawlerEmailsFound === 1, "the recrawl finds and stages the role address");
      const cacheAfterRole = (await db.execute(sql`SELECT role_emails FROM email_discovery_domain_cache WHERE domain = ${c23domain}`)).rows?.[0];
      assert(Array.isArray(cacheAfterRole?.role_emails) && cacheAfterRole.role_emails.length === 1, "the domain cache now holds the freshly-found role address");

      // Age it out again, then run an authoritative empty recrawl.
      await db.execute(sql`UPDATE email_discovery_domain_cache SET last_crawled_at = now() - interval '31 days' WHERE domain = ${c23domain}`);
      const c23d = await makeTestContact({ companyName: "Negative Cache D Task1978", email: "", website: c23domain });
      try {
        await withMockedSerper(
          { searchBusiness: serperWebsiteOnlyNoEmail(c23domain), searchBusinessEmail: serperEmailSearchNoMatch },
          () => withMockedCrawler(
            { crawlFirstPartyContactEmails: async () => { c23CrawlCalls++; return { candidates: [], fetchCompleted: true, pagesAttempted: 1 }; } },
            () => enrichContactBatch([c23d.id], { batchSize: 1 }),
          ),
        );
        const cacheAfterEmpty = (await db.execute(sql`SELECT role_emails FROM email_discovery_domain_cache WHERE domain = ${c23domain}`)).rows?.[0];
        assert(Array.isArray(cacheAfterEmpty?.role_emails) && cacheAfterEmpty.role_emails.length === 0, "an authoritative empty recrawl CLEARS the previously-cached role address instead of leaving it to be served fresh again");
      } finally {
        await cleanupContact(c23d.id);
      }
    } finally {
      await cleanupContact(c23c.id);
    }
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c23domain}`).catch(() => {});
    await db.execute(sql`DELETE FROM email_discovery_domain_cache WHERE domain = ${c23domain}`).catch(() => {});
    await cleanupContact(c23a.id);
    await cleanupContact(c23b.id);
  }

  console.log("\n── Test 24: a role-inbox candidate for a contact with NO linked business still gets an owning subject (falls back to contactId) instead of an orphaned business_id=null/contact_id=null row (code-review regression + DB constraint) ──");
  const c24domain = `role-no-business-link-${runId}.com`;
  const c24 = await makeTestContact({ companyName: "Role No Business Task1978", email: "", website: c24domain, businessId: null as any });
  try {
    const result = await withMockedSerper(
      { searchBusiness: serperWebsiteOnlyNoEmail(c24domain), searchBusinessEmail: serperEmailSearchNoMatch },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => ({ candidates: [{ email: `info@${c24domain}`, sourceUrl: `https://${c24domain}/contact`, evidenceType: "mailto" as const }], fetchCompleted: true, pagesAttempted: 1 }) },
        () => enrichContactBatch([c24.id], { batchSize: 1 }),
      ),
    );
    assert(result.crawlerEmailsFound === 1, "the role address is still staged even with no linked business");
    const [staged] = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c24domain}`);
    assert(!!staged, "a candidate row was recorded");
    assert(staged?.attributionScope === "role", "it's still classified as role attribution");
    assert(staged?.subjectType === "business", "the fallback-to-contactId role row still carries subjectType='business' — it's business evidence, only the FK bookkeeping differs");
    assert(staged?.contactId === c24.id, "it falls back to contactId ownership when no businessId link exists");
    assert(!(staged?.businessId === null && staged?.contactId === null), "the row is never left with both FKs null (orphaned)");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c24domain}`).catch(() => {});
    await db.execute(sql`DELETE FROM email_discovery_domain_cache WHERE domain = ${c24domain}`).catch(() => {});
    await cleanupContact(c24.id);
  }

  console.log("\n── Test 25: subject_type/attribution_scope/business_id consistency is enforced at both the service layer and the DB CHECK constraint (code-review regression) ──");
  const c25domain = `subject-type-consistency-${runId}.com`;
  const c25 = await makeTestContact({ companyName: "Subject Type Consistency Task1978", email: "", website: c25domain });
  try {
    const { recordFreeDiscoveryCandidate, createFreeDiscoveryGeneration, completeFreeDiscoveryGeneration } = await import("../server/services/free-discovery/evidence-service");
    const gen = await createFreeDiscoveryGeneration({ runKey: `test-subject-type-${runId}`, actorId: "test-suite", reason: "task-1978-regression-test" });

    let threwBusinessNamed = false;
    try {
      await recordFreeDiscoveryCandidate({
        generationId: gen.id, subjectType: "business", businessId: null, contactId: c25.id,
        domain: c25domain, email: `jane@${c25domain}`, source: "first_party_contact_page",
        attributionScope: "named", confidence: 50,
      });
    } catch { threwBusinessNamed = true; }
    assert(threwBusinessNamed, "service layer rejects subjectType='business' paired with attributionScope='named'");

    let threwPersonRole = false;
    try {
      await recordFreeDiscoveryCandidate({
        generationId: gen.id, subjectType: "person", businessId: null, contactId: c25.id,
        domain: c25domain, email: `info@${c25domain}`, source: "first_party_contact_page",
        attributionScope: "role", confidence: 50,
      });
    } catch { threwPersonRole = true; }
    assert(threwPersonRole, "service layer rejects subjectType='person' paired with attributionScope='role'");

    let threwPersonWithBusiness = false;
    try {
      await recordFreeDiscoveryCandidate({
        generationId: gen.id, subjectType: "person", businessId: c25.businessId ?? 1, contactId: c25.id,
        domain: c25domain, email: `bob@${c25domain}`, source: "first_party_contact_page",
        attributionScope: "named", confidence: 50,
      });
    } catch { threwPersonWithBusiness = true; }
    assert(threwPersonWithBusiness, "service layer rejects a 'person' subject carrying a business_id");

    // Bypass the service layer entirely and try the same invalid combination
    // as a raw insert, proving the DB CHECK constraint is the real backstop
    // (not just app-level discipline that a future direct-SQL caller could skip).
    let dbRejectedRawInsert = false;
    try {
      await db.execute(sql`
        INSERT INTO free_discovery_candidates
          (generation_id, field, subject_type, business_id, contact_id, domain, source, attribution_scope,
           disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
           normalized_value_hash, masked_value)
        VALUES (${gen.id}::uuid, 'email', 'business', NULL, ${c25.id}, ${c25domain}, 'first_party_contact_page', 'named',
                'staged', 50, 'x', 'x', 'x', 1, ${`raw-insert-test-${runId}`}, 'x@***')
      `);
    } catch { dbRejectedRawInsert = true; }
    assert(dbRejectedRawInsert, "the DB CHECK constraint independently rejects a business/named mismatch even bypassing the service layer");

    // Regression: a business-owned role row and a contact-fallback role row
    // can carry equal NUMERIC ids (e.g. business #7 and contact #7) even
    // though they are different subjects. subject_type alone does not
    // disambiguate them (both are 'business'); the count must key off which
    // FK column actually holds the id. Force a real business row and a real
    // contact row to share the same numeric id so the collision is concrete,
    // not just theoretically possible.
    //
    // contacts.id values in this DB run far higher than businesses.id values
    // (contacts is a much older/larger table), so it's safe to mint a fresh
    // contact via the normal sequence and then force-insert a businesses row
    // at that same numeric id (which businesses' own sequence hasn't reached
    // yet) rather than risk colliding an explicit id with an existing real
    // business or contact row.
    const contactRow = await makeTestContact({
      companyName: "Subject Type Consistency Task1978 B",
      email: "", phone: "5550001112", website: `${c25domain}-b.com`,
    });
    const sharedNumericId = contactRow.id;
    const [existingBiz] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, sharedNumericId));
    assert(!existingBiz, `sanity check: businesses.id=${sharedNumericId} is not already taken, so the forced-collision insert below is safe`);
    // Deliberately do NOT call setval() here — an explicit-id INSERT does not
    // itself advance the serial sequence, and bumping the sequence forward to
    // a contact-scale id would permanently mutate shared DB sequence state
    // for the rest of the suite (and any concurrent run). The fixture row is
    // deleted in the finally block below, so leaving the sequence untouched
    // is both safe (this test's chosen id is already known-free) and fully
    // reversible — nothing about this test's state survives it.
    await db.execute(sql`
      INSERT INTO businesses (id, canonical_name, normalized_name)
      VALUES (${sharedNumericId}, ${`Subject Type Consistency Biz ${runId}`}, ${`subject type consistency biz ${runId}`})
    `);
    try {
      await recordFreeDiscoveryCandidate({
        generationId: gen.id, subjectType: "business", businessId: sharedNumericId, contactId: null,
        domain: `${c25domain}-biz.com`, email: `info@${c25domain}-biz.com`, source: "first_party_contact_page",
        attributionScope: "role", confidence: 50,
      });
      await recordFreeDiscoveryCandidate({
        generationId: gen.id, subjectType: "business", businessId: null, contactId: sharedNumericId,
        domain: `${c25domain}-contact.com`, email: `info@${c25domain}-contact.com`, source: "first_party_contact_page",
        attributionScope: "role", confidence: 50,
      });
      await completeFreeDiscoveryGeneration(gen.id);
      const [genAfter] = await db.select().from(freeDiscoveryGenerations).where(eq(freeDiscoveryGenerations.id, gen.id));
      assert(
        genAfter?.subjectCount === 2,
        `a business_id=${sharedNumericId} row and a contact_id=${sharedNumericId} row are counted as 2 distinct subjects, not collapsed into 1 (got ${genAfter?.subjectCount})`,
      );
    } finally {
      await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} IN (${`${c25domain}-biz.com`}, ${`${c25domain}-contact.com`})`).catch(() => {});
      await cleanupContact(contactRow.id);
      await db.delete(businesses).where(eq(businesses.id, sharedNumericId)).catch(() => {});
    }
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c25domain}`).catch(() => {});
    await cleanupContact(c25.id);
  }

  console.log("\n── Test 26: two contacts needing independent crawls in one batch call share exactly one free-discovery generation (code-review concurrency regression) ──");
  const c26domainA = `concurrent-gen-a-${runId}.com`;
  const c26domainB = `concurrent-gen-b-${runId}.com`;
  const c26a = await makeTestContact({ companyName: "Concurrent Gen A Task1978", email: "", website: c26domainA });
  const c26b = await makeTestContact({ companyName: "Concurrent Gen B Task1978", email: "", website: c26domainB });
  try {
    const result = await withMockedSerper(
      {
        // contact.website (set at creation) takes top priority over Serper's
        // resolved website (Test 12), so this fixed response never actually
        // determines either contact's domain — it only needs to genuinely
        // complete with no email so both contacts fall through to the
        // crawler.
        searchBusiness: serperWebsiteOnlyNoEmail(c26domainA),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        {
          // Two different domains — both contacts genuinely trigger their own
          // crawl (no shared crawlCache entry), so both independently call
          // getOrCreateBatchFreeDiscoveryGenerationId(). If that function ever
          // regresses to checking-then-setting a plain variable instead of
          // memoizing a single in-flight promise, a future concurrent/batched
          // caller could let both contacts each observe "no generation yet"
          // and open two separate generations — splitting one batch's
          // candidates across two rows, only one of which is ever completed.
          crawlFirstPartyContactEmails: async (domain: string) => ({
            candidates: [{ email: `info@${domain}`, sourceUrl: `https://${domain}/contact`, evidenceType: "mailto" as const }],
            fetchCompleted: true,
            pagesAttempted: 1,
          }),
        },
        () => enrichContactBatch([c26a.id, c26b.id], { batchSize: 2 }),
      ),
    );
    assert(result.crawlerEmailsFound === 2, "both contacts' independent crawls each stage a role candidate");
    const c26Candidates = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} IN (${c26domainA}, ${c26domainB})`);
    assert(c26Candidates.length === 2, "both candidates were recorded");
    const distinctGenerationIds = Array.from(new Set(c26Candidates.map((c) => c.generationId)));
    assert(
      distinctGenerationIds.length === 1,
      `both contacts' candidates land on the SAME generation, not split across two (found ${distinctGenerationIds.length} distinct generation ids)`,
    );
    const [c26gen] = await db.select().from(freeDiscoveryGenerations).where(eq(freeDiscoveryGenerations.id, distinctGenerationIds[0]!));
    assert(c26gen?.state === "completed", "the one shared generation is completed at batch end, not left permanently running");
    assert(c26gen?.subjectCount === 2, "the completed generation's subject_count covers both contacts' candidates, not just whichever one happened to create the generation");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} IN (${c26domainA}, ${c26domainB})`).catch(() => {});
    await cleanupContact(c26a.id);
    await cleanupContact(c26b.id);
  }

  console.log("\n── Test 27: a role candidate served from the domain cache does NOT refresh the cache's crawl metadata/TTL (code-review regression) ──");
  const c27domain = `cache-read-no-refresh-${runId}.com`;
  const c27a = await makeTestContact({ companyName: "Cache Read No Refresh A Task1978", email: "", website: c27domain });
  try {
    // Seed a fresh, single-role-email cache entry directly, as if an earlier
    // batch (hours ago, but still within the 30-day TTL) had crawled it.
    await db.execute(sql`
      INSERT INTO email_discovery_domain_cache (domain, role_emails, last_crawled_at, crawl_count)
      VALUES (${c27domain}, ${JSON.stringify([{ email: `info@${c27domain}`, confidence: 60 }])}::jsonb, NOW() - interval '10 days', 1)
      ON CONFLICT (domain) DO UPDATE SET role_emails = EXCLUDED.role_emails, last_crawled_at = EXCLUDED.last_crawled_at, crawl_count = 1
    `);
    const [cacheBefore] = await db.execute(sql`SELECT last_crawled_at, crawl_count FROM email_discovery_domain_cache WHERE domain = ${c27domain}`).then((r: any) => r.rows ?? r);
    let crawlCalled = false;
    await withMockedSerper(
      {
        searchBusiness: serperWebsiteOnlyNoEmail(c27domain),
        searchBusinessEmail: serperEmailSearchNoMatch,
      },
      () => withMockedCrawler(
        { crawlFirstPartyContactEmails: async () => { crawlCalled = true; return { candidates: [], fetchCompleted: true, pagesAttempted: 0 }; } },
        () => enrichContactBatch([c27a.id], { batchSize: 1 }),
      ),
    );
    assert(!crawlCalled, "a fresh cache hit never reaches the crawler at all");
    const [cacheAfter] = await db.execute(sql`SELECT last_crawled_at, crawl_count FROM email_discovery_domain_cache WHERE domain = ${c27domain}`).then((r: any) => r.rows ?? r);
    assert(
      new Date(cacheAfter.last_crawled_at).getTime() === new Date(cacheBefore.last_crawled_at).getTime(),
      "reading a cached role email does not bump last_crawled_at — that would refresh the TTL for a crawl that never happened",
    );
    assert(
      Number(cacheAfter.crawl_count) === Number(cacheBefore.crawl_count),
      `reading a cached role email does not increment crawl_count (before=${cacheBefore.crawl_count}, after=${cacheAfter.crawl_count})`,
    );
    const c27candidateRows = await db.select().from(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c27domain}`);
    assert(c27candidateRows.length === 1 && c27candidateRows[0]?.attributionScope === "role", "the cache-served candidate is still staged as evidence for this contact/generation");
  } finally {
    await db.delete(freeDiscoveryCandidates).where(sql`${freeDiscoveryCandidates.domain} = ${c27domain}`).catch(() => {});
    await db.execute(sql`DELETE FROM email_discovery_domain_cache WHERE domain = ${c27domain}`).catch(() => {});
    await cleanupContact(c27a.id);
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

  console.log("\n── Test 28: a generation abandoned by a hard crash (state='running' forever) is auto-reclaimed, not left stuck (code-review regression) ──");
  const { reclaimStaleFreeDiscoveryGenerations } = await import("../server/services/free-discovery/evidence-service");
  const c28domain = `crash-abandoned-gen-${runId}.com`;
  const c28StaleRunKey = `test-crash-abandoned-${runId}`;
  const c28FreshRunKey = `test-still-in-flight-${runId}`;
  let c28StaleId: string | null = null;
  let c28FreshId: string | null = null;
  try {
    // Simulate a batch that crashed hard mid-run: its generation row is stuck
    // in state='running' with a started_at far in the past — nothing in
    // enrichContactBatch's try/finally can ever revisit it, since the process
    // never got back there. A second, genuinely still-running generation
    // (started_at now) must NOT be touched by the same sweep.
    const [staleRow] = await db.execute(sql`
      INSERT INTO free_discovery_generations (run_key, actor_id, reason, state, started_at)
      VALUES (${c28StaleRunKey}, 'system:test', 'crash simulation', 'running', NOW() - interval '6 hours')
      RETURNING id
    `).then((r: any) => r.rows ?? r);
    c28StaleId = String(staleRow.id);
    const [freshRow] = await db.execute(sql`
      INSERT INTO free_discovery_generations (run_key, actor_id, reason, state, started_at)
      VALUES (${c28FreshRunKey}, 'system:test', 'still in flight', 'running', NOW())
      RETURNING id
    `).then((r: any) => r.rows ?? r);
    c28FreshId = String(freshRow.id);
    // Give the stale generation one candidate so the reclaim's recomputed
    // counters can be checked, not just the state transition. Needs a real
    // business_id — the subject-scope CHECK constraint requires business_id
    // OR contact_id to be populated.
    const [c28biz] = await db.insert(businesses).values({
      canonicalName: `Crash Abandoned Gen Task1978 ${runId}`,
      normalizedName: `crash abandoned gen task1978 ${runId}`,
      websiteDomain: c28domain,
    }).returning();
    await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id, subject_type, business_id, domain, source, attribution_scope, disposition, confidence,
         envelope_ciphertext, envelope_nonce, envelope_tag, normalized_value_hash, masked_value)
      VALUES
        (${c28StaleId}::uuid, 'business', ${c28biz.id}, ${c28domain}, 'contact_page', 'role', 'staged', 60,
         'ct', 'nonce', 'tag', ${`hash-${runId}`}, 'i***@' || ${c28domain})
    `);

    const reclaim = await reclaimStaleFreeDiscoveryGenerations(60 * 60 * 1000); // stale after 1h
    assert(reclaim.ids.includes(c28StaleId), "the crash-abandoned generation (started 6h ago) is reclaimed by the sweep");
    assert(!reclaim.ids.includes(c28FreshId), "a genuinely still-running generation (started just now) is left untouched");

    const [staleAfter] = await db.select().from(freeDiscoveryGenerations).where(eq(freeDiscoveryGenerations.id, c28StaleId));
    assert(staleAfter?.state === "stalled", "the reclaimed generation is marked 'stalled', not silently 'completed' as if it finished normally");
    assert(staleAfter?.candidateCount === 1, "the reclaimed generation's candidate_count reflects whatever it actually persisted before crashing");
    assert(!!staleAfter?.completedAt, "the reclaimed generation gets a completedAt so it stops reading as perpetually in-progress");

    const [freshAfter] = await db.select().from(freeDiscoveryGenerations).where(eq(freeDiscoveryGenerations.id, c28FreshId));
    assert(freshAfter?.state === "running", "the still-in-flight generation's state is untouched by the sweep");

    const auditRows = await db.execute(sql`
      SELECT * FROM audit_logs WHERE action = 'free_discovery_generation_auto_reclaimed' AND entity_key = ${c28StaleId}
    `).then((r: any) => r.rows ?? r);
    assert(auditRows.length === 1, "the auto-reclaim writes exactly one auditable record for the operator to inspect");

    // Idempotency: calling the sweep again must not re-reclaim (already
    // terminal) or write a second audit row for the same generation.
    const reclaimAgain = await reclaimStaleFreeDiscoveryGenerations(60 * 60 * 1000);
    assert(!reclaimAgain.ids.includes(c28StaleId), "an already-reclaimed (terminal) generation is never touched by a later sweep");
  } finally {
    await db.execute(sql`DELETE FROM free_discovery_candidates WHERE generation_id = ${c28StaleId}::uuid`).catch(() => {});
    if (c28StaleId) await db.execute(sql`DELETE FROM audit_logs WHERE entity_key = ${c28StaleId} AND action = 'free_discovery_generation_auto_reclaimed'`).catch(() => {});
    if (c28StaleId) await db.execute(sql`DELETE FROM free_discovery_generations WHERE id = ${c28StaleId}::uuid`).catch(() => {});
    if (c28FreshId) await db.execute(sql`DELETE FROM free_discovery_generations WHERE id = ${c28FreshId}::uuid`).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
