import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addExactNonNegativeDecimals, calculateApolloRequestWork, deriveOutscraperResultRetentionBound,
  documentedApolloSearchCredits, parseApolloUsageReceipt, apolloPersonMatchesEmployerScope,
  parseOutscraperContacts, parseOutscraperTaskReference,
} from "../server/services/sdr/sfp-provider-contracts";
import { PROVIDER_SOURCE_MANIFEST, assertValidProviderManifest } from "../server/services/provider-manifest";

process.env.DATABASE_URL ??= "postgres://offline-test:offline-test@127.0.0.1:1/offline_test";
process.env.APOLLO_API_KEY = "fixture-apollo-key";
process.env.OUTSCRAPER_API_KEY = "fixture-outscraper-key";
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

async function testPureProviderContracts() {
  const exact = parseApolloUsageReceipt(new Headers({ "x-request-id": "req-1" }), { credits_consumed: "0.3750" });
  assert.deepEqual(exact, {
    certainty: "exact", quantity: "0.375", providerReference: "req-1",
  });
  const conflicting = parseApolloUsageReceipt(new Headers({ "x-credits-used": "0.25" }), {
    credits_consumed: "0.5",
  });
  assert.equal(conflicting.certainty, "unknown");
  assert.equal(parseApolloUsageReceipt(new Headers(), { total_entries: 2 }).certainty, "unknown");
  assert.equal(addExactNonNegativeDecimals(["0.1", "0.2", "0.0005"]), "0.3005");
  assert.equal(documentedApolloSearchCredits("/api/v1/mixed_companies/search"), "1");
  assert.equal(documentedApolloSearchCredits("/api/v1/mixed_people/api_search"), "0");
  assert.equal(documentedApolloSearchCredits("/api/v1/people/bulk_match"), null);
  assert.deepEqual(calculateApolloRequestWork({
    endpointPath: "/api/v1/mixed_companies/search",
    requestBody: {},
    responseBody: { organizations: [{ id: "org-1" }] },
    requestSucceeded: true,
  }), { workUnit: "request", reservedUnits: 1, completedUnits: 1 });
  assert.deepEqual(calculateApolloRequestWork({
    endpointPath: "/api/v1/mixed_people/api_search",
    requestBody: { organization_ids: ["org-1"], per_page: 10 },
    responseBody: { people: [
      { id: "person-1", organization: { name: "Example Dental", has_phone: false } },
      { id: "person-2", organization_id: "other-org" },
    ] },
    requestSucceeded: true,
    employerScope: { organizationId: "org-1", names: ["Example Dental"], domains: ["example.com"] },
  }), { workUnit: "person", reservedUnits: 10, completedUnits: 1 });
  assert.deepEqual(calculateApolloRequestWork({
    endpointPath: "/api/v1/people/bulk_match",
    requestBody: { details: [{ id: "person-1" }] },
    responseBody: { matches: [{ id: "person-1", organization_id: "org-1" }] },
    requestSucceeded: true,
    employerScope: { organizationId: "org-1", names: ["Example Dental"], domains: ["example.com"] },
  }), { workUnit: "person", reservedUnits: 1, completedUnits: 1 });
  assert.deepEqual(calculateApolloRequestWork({
    endpointPath: "/api/v1/people/bulk_match",
    requestBody: { details: [{ id: "person-1" }] },
    responseBody: { matches: [{ id: "person-1", organization_id: "other-org" }] },
    requestSucceeded: true,
    employerScope: { organizationId: "org-1", names: ["Example Dental"], domains: ["example.com"] },
  }), { workUnit: "person", reservedUnits: 1, completedUnits: 0 });
  const employerScope = { organizationId: "org-1", names: ["Example Dental"], domains: ["example.com"] };
  assert.equal(apolloPersonMatchesEmployerScope(
    { id: "person-1", organization: { name: "Example Dental" } },
    new Set(["org-1"]), employerScope,
  ), true);
  assert.equal(apolloPersonMatchesEmployerScope(
    { id: "person-1", organization: { id: "other-org", name: "Example Dental" } },
    new Set(["org-1"]), employerScope,
  ), false, "explicit different employer ID overrides a name match");
  assert.equal(apolloPersonMatchesEmployerScope(
    { id: "person-1", organization: { id: "org-1", name: "Other Company" } },
    new Set(["org-1"]), employerScope,
  ), false, "an employer-name contradiction still denies an otherwise matching ID");
  assert.equal(apolloPersonMatchesEmployerScope(
    { id: "person-1", organization: { name: "Other Company" } },
    new Set(["org-1"]), employerScope,
  ), false, "documented server filter cannot override explicit employer contradiction");

  const contacts = parseOutscraperContacts({
    contacts: [{
      full_name: "Jane Example", title: "Managing Partner",
      emails: [{ email: "jane@example.com" }, { email: "jane@example.com" }],
    }],
  });
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0].emails, ["jane@example.com"]);
  assert.equal(contacts[0].name, "Jane Example");
  assert.equal(contacts[0].title, "Managing Partner");

  assert.deepEqual(parseOutscraperTaskReference({ id: "task-123", status: "processing" }), {
    requestId: "task-123", state: "pending",
  });
  assert.deepEqual(parseOutscraperTaskReference({ id: "task-123", status: "finished" }), {
    requestId: "task-123", state: "completed",
  });
  assert.deepEqual(parseOutscraperTaskReference({ id: "task-123", status: "Success" }), {
    requestId: "task-123", state: "completed",
  });
  assert.deepEqual(parseOutscraperTaskReference({
    id: "task-123", status: "Success", completed_at: "2099-01-01T00:00:00Z",
  }), { requestId: "task-123", state: "completed" });
  assert.deepEqual(parseOutscraperTaskReference({
    status: "queued",
    results_location: "https://api.outscraper.com/requests/task-from-location",
  }), { requestId: "task-from-location", state: "pending" });

  const readyWithoutTimestamp = deriveOutscraperResultRetentionBound({
    state: "completed",
    submittedAt: "2026-07-20T10:00:00Z",
    lastPendingObservedAt: "2026-07-20T11:00:00Z",
    observedAt: "2026-07-20T12:00:00Z",
  });
  assert.deepEqual(readyWithoutTimestamp, {
    expired: false,
    completionTimeLowerBoundAt: "2026-07-20T11:00:00.000Z",
    completionTimeBoundKind: "last_pending_observed",
    resultsExpiresAt: "2026-07-20T15:00:00.000Z",
  });
  const latePendingAfterExpiry = deriveOutscraperResultRetentionBound({
    state: "pending",
    submittedAt: "2026-07-20T10:00:00Z",
    lastPendingObservedAt: readyWithoutTimestamp.completionTimeLowerBoundAt,
    observedAt: "2026-07-20T15:00:00.001Z",
    existingResultsExpiresAt: readyWithoutTimestamp.resultsExpiresAt,
  });
  assert.equal(latePendingAfterExpiry.expired, true);
  assert.equal(latePendingAfterExpiry.resultsExpiresAt, readyWithoutTimestamp.resultsExpiresAt);
}

async function testApolloBusinessOnlyFlow() {
  const { executeSfpApolloDiscovery } = await import("../server/services/cro03/sfp-live-provider-adapters");
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const requestReceipts: Array<{ operationId: string; quantity: string | undefined }> = [];
  const requestWorkReceipts: Array<{
    operationId: string;
    workUnit: "request" | "person";
    reservedUnits: number;
    completedUnits: number;
  }> = [];
  let checkpoints = 0;
  let healthSignals = 0;
  let submittedTaskId: string | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.endsWith("/api/v1/mixed_companies/search")) {
      return jsonResponse({
        organizations: [{
          id: "org-1", name: "Example Dental", primary_domain: "example.com",
          city: "Miami", state: "FL", street_address: "1 Main St",
        }],
        credits_consumed: "1",
      }, 200, {
        "x-request-id": body.q_organization_domains ? "apollo-org-domain" : "apollo-org-name",
      });
    }
    if (url.endsWith("/api/v1/mixed_people/api_search")) {
      assert.deepEqual(body.organization_ids, ["org-1"]);
      assert.ok(Array.isArray(body.person_titles));
      return jsonResponse({
        people: [{
          id: "person-1", first_name: "Jane", last_name_obfuscated: "Ex***e", title: "Owner",
          organization: { name: "Example Dental", has_industry: true, has_phone: false },
          has_email: true,
        }],
        credits_consumed: "0",
      }, 200, { "x-request-id": "apollo-people-1" });
    }
    if (url.endsWith("/api/v1/people/bulk_match")) {
      const payload = JSON.stringify(body);
      assert.ok(payload.includes('"id":"person-1"'));
      assert.ok(!/reveal_personal_emails|reveal_phone_number|run_waterfall/i.test(payload));
      return jsonResponse({
        matches: [{
          id: "person-1", first_name: "Jane", last_name: "Example",
          organization_id: "org-1",
          email: "jane@example.com", personal_email: "private@example.net",
        }],
        credits_consumed: "0.3",
      }, 200, { "x-request-id": "apollo-enrich-1" });
    }
    throw new Error(`unexpected Apollo fixture URL: ${url}`);
  };
  const result = await executeSfpApolloDiscovery({
    businessId: 10,
    businessName: "Example Dental",
    domain: "example.com",
    city: "Miami",
    state: "FL",
    address: "1 Main St",
    resultCap: 10,
  }, {
    fetchImpl: fakeFetch,
    beforeRequest: async () => { checkpoints++; },
    recordCreditSignal: async () => { healthSignals++; },
    dispatchApolloRequest: async (url, init, requestScope) => {
      const response = await fakeFetch(url, init);
      const body = await response.clone().json() as Record<string, unknown>;
      const receipt = parseApolloUsageReceipt(response.headers, body);
      const operationId = `apollo-operation-${requestReceipts.length + 1}`;
      requestReceipts.push({
        operationId,
        quantity: receipt.certainty === "exact" ? receipt.quantity : undefined,
      });
      requestWorkReceipts.push({
        operationId,
        ...calculateApolloRequestWork({
        endpointPath: new URL(url).pathname,
        requestBody: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responseBody: body,
        requestSucceeded: response.ok,
          employerScope: requestScope,
        }),
      });
      return { response, operationId };
    },
  });
  assert.equal(result.outcome, "success");
  assert.ok(!("billing" in result), "SFP must not collapse request receipts into one Apollo operation receipt");
  if (result.outcome !== "success") return;
  assert.deepEqual(result.personIds, ["person-1"]);
  assert.equal(result.people[0].email, "jane@example.com");
  assert.equal(result.people[0].ownerEmail, "jane@example.com");
  assert.equal(result.organizationOperationId, "apollo-operation-2");
  assert.deepEqual(result.personOperationIds, ["apollo-operation-3"]);
  assert.equal(result.emailEnrichmentOperationId, "apollo-operation-4");
  assert.deepEqual(result.requestOperationIds, [
    "apollo-operation-1", "apollo-operation-2", "apollo-operation-3", "apollo-operation-4",
  ]);
  assert.equal(result.people[0].personOperationId, "apollo-operation-3");
  assert.equal(result.people[0].emailEnrichmentOperationId, "apollo-operation-4");
  assert.deepEqual(requestReceipts.map((receipt) => receipt.quantity), ["1", "1", "0", "0.3"]);
  assert.deepEqual(requestWorkReceipts.map(({ operationId, workUnit, reservedUnits, completedUnits }) =>
    [operationId, workUnit, reservedUnits, completedUnits]), [
    ["apollo-operation-1", "request", 1, 1], ["apollo-operation-2", "request", 1, 1],
    ["apollo-operation-3", "person", 10, 1], ["apollo-operation-4", "person", 1, 1],
  ]);
  assert.deepEqual(
    result.people.map((person) => [person.personOperationId, person.emailEnrichmentOperationId]),
    [["apollo-operation-3", "apollo-operation-4"]],
  );
  assert.equal(requests.length, 4);
  assert.equal(checkpoints, 4);
  assert.equal(healthSignals, 4);
}

async function testApolloTimeoutRetryHasIndependentReceipts() {
  const { performApolloSearch } = await import("../server/services/sdr/apollo");
  const attempts: Array<{ operationId: string; outcome: "unknown" | "exact"; quantity?: string }> = [];
  const requestUrls: string[] = [];
  const result = await performApolloSearch({
    legalName: "Example Dental", domain: "example.com", city: "Miami", state: "FL",
    address: "1 Main St", resultCap: 10,
  }, {
    recordCreditSignal: async () => {},
    dispatchRequest: async (url) => {
      requestUrls.push(url);
      const operationId = `timeout-retry-operation-${requestUrls.length}`;
      if (requestUrls.length === 1) {
        attempts.push({ operationId, outcome: "unknown" });
        const timeout = Object.assign(new Error("APOLLO_TIMEOUT"), {
          name: "AbortError",
          apolloOperationIds: [operationId],
          apolloAmbiguousOperationIds: [operationId],
        });
        throw timeout;
      }
      const isOrganizationSearch = url.endsWith("/api/v1/mixed_companies/search");
      const response = isOrganizationSearch
        ? jsonResponse({
          organizations: [{
            id: "org-1", name: "Example Dental", primary_domain: "example.com",
            city: "Miami", state: "FL", street_address: "1 Main St",
          }],
          credits_consumed: "1",
        }, 200, { "x-request-id": operationId })
        : jsonResponse({
          people: [{
            id: "person-1", first_name: "Jane",
            organization: { name: "Example Dental", has_industry: true, has_phone: false },
          }],
          credits_consumed: "0",
        }, 200, { "x-request-id": operationId });
      attempts.push({
        operationId, outcome: "exact", quantity: isOrganizationSearch ? "1" : "0",
      });
      return { response, operationId, operationIds: [operationId] };
    },
  });
  assert.equal(result.outcome, "success");
  assert.equal(requestUrls.length, 4, "timeout causes exactly one explicit second HTTP attempt");
  assert.equal(attempts.length, requestUrls.length, "every network attempt has its own operation receipt");
  assert.equal(new Set(attempts.map((attempt) => attempt.operationId)).size, attempts.length);
  assert.deepEqual(attempts.map(({ outcome, quantity }) => [outcome, quantity]), [
    ["unknown", undefined], ["exact", "1"], ["exact", "1"], ["exact", "0"],
  ]);
  assert.equal(result.billing.certainty, "unknown", "the retry cannot erase ambiguous first-attempt spend");
  if (result.outcome === "success") {
    assert.deepEqual(result.requestOperationIds, attempts.map((attempt) => attempt.operationId));
  }
}

async function testApolloAmbiguousIdentityRemainsHeld() {
  const { performApolloSearch } = await import("../server/services/sdr/apollo");
  let peopleRequests = 0;
  let organizationRequests = 0;
  const result = await performApolloSearch({
    legalName: "Example Dental", domain: "example.com", city: "Miami", state: "FL",
    address: "1 Main St", resultCap: 10,
  }, {
    recordCreditSignal: async () => {},
    dispatchRequest: async (url) => {
      if (!url.endsWith("/api/v1/mixed_companies/search")) {
        peopleRequests++;
        throw new Error("people search must not follow ambiguous organization resolution");
      }
      const operationId = `ambiguous-org-${++organizationRequests}`;
      return {
        response: jsonResponse({
          organizations: [
            { id: "org-1", name: "Example Dental", primary_domain: "example.com", city: "Miami", state: "FL", street_address: "1 Main St" },
            { id: "org-2", name: "Example Dental", primary_domain: "example.com", city: "Miami", state: "FL", street_address: "1 Main St" },
          ],
          credits_consumed: "1",
        }),
        operationId,
        operationIds: [operationId],
      };
    },
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(peopleRequests, 0);
}

async function testApolloBulkTimeoutRetryUsesItsOwnOperations() {
  const { performApolloBusinessEmailEnrichment } = await import("../server/services/sdr/apollo");
  const attempts: Array<{ operationId: string; outcome: "unknown" | "exact" }> = [];
  const scope = { organizationId: "org-1", names: ["Example Dental"], domains: ["example.com"] };
  const result = await performApolloBusinessEmailEnrichment(["person-1"], {
    dispatchRequest: async () => {
      const operationId = `bulk-attempt-${attempts.length + 1}`;
      if (attempts.length === 0) {
        attempts.push({ operationId, outcome: "unknown" });
        throw Object.assign(new Error("APOLLO_TIMEOUT"), {
          name: "AbortError",
          apolloOperationIds: [operationId],
          apolloAmbiguousOperationIds: [operationId],
        });
      }
      attempts.push({ operationId, outcome: "exact" });
      return {
        response: jsonResponse({
          status: "success", total_requested_enrichments: 1, unique_enriched_records: 1,
          missing_records: 0, credits_consumed: 0.3,
          matches: [{ id: "person-1", organization_id: "org-1", email: "jane@example.com" }],
        }, 200, { "x-request-id": operationId }),
        operationId,
        operationIds: [operationId],
      };
    },
  }, scope);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].operationId, attempts[1].operationId);
  assert.deepEqual(result.requestOperationIds, attempts.map((attempt) => attempt.operationId));
  assert.equal(result.requestOperationId, attempts[1].operationId);
  assert.equal(result.billing.certainty, "unknown");
  assert.deepEqual(result.people, [{ personId: "person-1", email: "jane@example.com" }]);
}

async function testOutscraperAsyncAndContacts() {
  const { executeSfpOutscraperDiscovery } = await import("../server/services/cro03/sfp-live-provider-adapters");
  const { performOutscraperLeadsAndContacts, performOutscraperTaskResults } =
    await import("../server/services/sdr/outscraper");
  const requests: string[] = [];
  let checkpoints = 0;
  let healthSignals = 0;
  let submittedTaskId: string | null = null;
  const asyncSearch = await executeSfpOutscraperDiscovery({
    businessId: 20,
    businessName: "Example Dental",
    domain: "example.com",
    city: "Miami",
    state: "FL",
    resultLimit: 2,
    async: true,
  }, {
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      assert.equal(new URL(url).pathname, "/maps/search");
      assert.equal(new URL(url).searchParams.get("async"), "true");
      assert.equal(new URL(url).searchParams.get("limit"), "2");
      return jsonResponse({ id: "outs-task-123", status: "Pending" });
    },
    beforeRequest: async () => { checkpoints++; },
    recordCreditSignal: async () => { healthSignals++; },
    onTaskSubmitted: async (task) => { submittedTaskId = task.requestId; },
  });
  assert.equal(asyncSearch.ok, true);
  assert.equal(asyncSearch.consideredResultCount, 0);
  assert.equal(asyncSearch.results.length, 0);
  assert.deepEqual(asyncSearch.task, {
    requestId: "outs-task-123", state: "pending", resultsLocation: null,
  });
  assert.equal(asyncSearch.billing?.certainty, "unknown");
  assert.equal(submittedTaskId, "outs-task-123");

  const completed = await performOutscraperTaskResults("outs-task-123", {
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      assert.equal(new URL(url).pathname, "/requests/outs-task-123");
      return jsonResponse({
        id: "outs-task-123",
        status: "Success",
        data: [{
          name: "Example Dental", site: "https://example.com",
          full_address: "1 Main St, Miami, FL", city: "Miami", state: "FL",
          place_id: "place-1",
          contacts: [{
            full_name: "Jane Example", title: "Managing Partner",
            emails: [{ email: "jane@example.com" }],
          }],
        }],
      });
    },
    beforeRequest: async () => { checkpoints++; },
    recordCreditSignal: async () => { healthSignals++; },
  });
  assert.equal(completed.task?.state, "completed");
  assert.equal(completed.consideredResultCount, 1);
  assert.equal(completed.results[0].website, "example.com");
  assert.equal(completed.results[0].contacts[0].name, "Jane Example");
  assert.deepEqual(completed.results[0].contacts[0].emails, ["jane@example.com"]);
  assert.equal(completed.billing?.certainty, "exact");
  assert.equal(completed.billing?.quantity, "1");
  assert.equal(completed.billing?.unit, "result");

  const expiredResponseLooksPending = await performOutscraperTaskResults("outs-task-123", {
    fetchImpl: async (input) => {
      requests.push(String(input));
      return jsonResponse({ id: "outs-task-123", status: "Pending" });
    },
  });
  assert.equal(expiredResponseLooksPending.task?.state, "pending");
  const noLateDeadlineExtension = deriveOutscraperResultRetentionBound({
    state: "pending",
    submittedAt: "2026-07-20T10:00:00Z",
    lastPendingObservedAt: "2026-07-20T11:00:00Z",
    observedAt: "2026-07-20T15:00:00.001Z",
    existingResultsExpiresAt: "2026-07-20T15:00:00.000Z",
  });
  assert.equal(noLateDeadlineExtension.expired, true);
  assert.equal(noLateDeadlineExtension.resultsExpiresAt, "2026-07-20T15:00:00.000Z");

  const contactResult = await performOutscraperLeadsAndContacts(["example.com"], {
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/leads-and-contacts");
      assert.deepEqual(parsed.searchParams.getAll("query"), ["example.com"]);
      assert.equal(parsed.searchParams.get("async"), "false");
      return jsonResponse({
        data: [{
          query: "example.com",
          site: "https://example.com",
          contacts: [{
            full_name: "John Example", job_title: "Owner",
            emails: ["john@example.com"],
          }],
        }],
      });
    },
    beforeRequest: async () => { checkpoints++; },
    recordCreditSignal: async () => { healthSignals++; },
  });
  assert.equal(contactResult.ok, true);
  assert.equal(contactResult.records.length, 1);
  assert.equal(contactResult.records[0].contacts[0].title, "Owner");
  assert.equal(contactResult.consideredContactCount, 1);
  assert.equal(contactResult.billing.certainty, "unknown");
  assert.equal(requests.length, 4);
  assert.equal(checkpoints, 3);
  assert.equal(healthSignals, 3);
}

async function testManifestAndDurableTaskMigration() {
  assertValidProviderManifest();
  const outscraper = PROVIDER_SOURCE_MANIFEST.find((row) => row.id === "outscraper");
  const apollo = PROVIDER_SOURCE_MANIFEST.find((row) => row.id === "apollo");
  assert.ok(outscraper?.capability.includes("contact_enrichment"));
  assert.equal(outscraper?.durableOperation, "batch");
  assert.ok(outscraper?.budget.additionalUnits?.includes("contact"));
  assert.ok(outscraper?.budget.additionalUnits?.includes("request"));
  assert.ok(outscraper?.approvedCallers.includes("server/services/cro03/sfp-paid-waterfall.ts"));
  assert.equal(apollo?.budget.unit, "person");
  assert.ok(apollo?.budget.additionalUnits?.includes("request"));
  const migration = await readFile("migrations/0317_sfp_provider_retrieval_tasks.sql", "utf8");
  const waterfall = await readFile("server/services/cro03/sfp-paid-waterfall.ts", "utf8");
  const apolloAdapter = await readFile("server/services/cro03/sfp-live-provider-adapters.ts", "utf8");
  const providerContracts = await readFile("server/services/sdr/sfp-provider-contracts.ts", "utf8");
  const schema = await readFile("shared/schema.ts", "utf8");
  for (const field of [
    "provider_task_id", "submission_operation_id", "stage_run_id", "business_id",
    "request_fingerprint", "next_poll_at", "expires_at", "lease_token",
    "lease_expires_at", "attempt_count", "completed_result_hashes",
    "provider_completed_at", "completion_time_lower_bound_at", "completion_time_bound_kind",
    "results_expires_at",
  ]) assert.ok(migration.includes(field), `migration missing ${field}`);
  assert.match(migration, /results_expires_at = provider_completed_at \+ INTERVAL '4 hours'/);
  assert.match(migration, /results_expires_at = completion_time_lower_bound_at \+ INTERVAL '4 hours'/);
  assert.match(schema, /completionTimeLowerBoundAt: timestamp\("completion_time_lower_bound_at"[\s\S]*?\.notNull\(\)/);
  assert.match(schema, /completionTimeBoundKind: text\("completion_time_bound_kind"\)\.notNull\(\)/);
  assert.doesNotMatch(providerContracts, /body\.completed_at|body\.completedAt|body\.finished_at|body\.finishedAt/);
  assert.doesNotMatch(waterfall, /OUTSCRAPER_COMPLETION_TIMESTAMP_MISSING/);
  assert.match(migration, /UNIQUE \(provider, provider_task_id\)/);
  assert.match(migration, /state IN \('submitted', 'polling', 'completed', 'no_result', 'failed', 'expired'\)/);
  assert.match(waterfall, /const dueTasks = rows\(await db\.execute\(sql`[\s\S]*?FROM sfp_provider_retrieval_tasks/);
  assert.match(waterfall, /const taskRun = await processSfpOutscraperRetrievalTask\(\{/);
  assert.match(waterfall, /onTaskSubmitted: async \(task\) => \{/);
  assert.match(waterfall, /dispatchApolloRequest/);
  assert.match(waterfall, /provider: "apollo"[\s\S]*?workUnit: "request"[\s\S]*?units: 1/);
  assert.match(waterfall, /apollo_organization_search_documented_one_per_page/);
  assert.match(waterfall, /apollo_people_api_search_documented_zero/);
  assert.match(waterfall, /const reservedWork = calculateApolloRequestWork/);
  assert.match(waterfall, /const workCompleted = completedWork\.completedUnits/);
  assert.match(waterfall, /apolloAttemptCounts/);
  assert.match(waterfall, /operationId: field === "email" \? emailEnrichmentOperationId : personOperationId/);
  assert.match(waterfall, /attemptNumber,\s*\}\)\}/);
  assert.match(waterfall, /apolloAmbiguousOperationIds/);
  assert.match(apolloAdapter, /enrichment\.requestOperationIds/);
  assert.match(apolloAdapter, /dispatchRequest: deps\.dispatchApolloRequest/);
  assert.match(providerContracts, /docs\.apollo\.io\/reference\/people-api-search/);
  assert.match(providerContracts, /docs\.apollo\.io\/reference\/bulk-people-enrichment/);
  assert.doesNotMatch(apolloAdapter, /addExactNonNegativeDecimals/);
  assert.match(waterfall, /idempotencyKey: `sfp-outs-task:\$\{input\.taskId\}:contacts`/);
}

await testPureProviderContracts();
await testApolloBusinessOnlyFlow();
await testApolloTimeoutRetryHasIndependentReceipts();
await testApolloAmbiguousIdentityRemainsHeld();
await testApolloBulkTimeoutRetryUsesItsOwnOperations();
await testOutscraperAsyncAndContacts();
await testManifestAndDurableTaskMigration();
console.log("SFP provider contracts, gated fake-transport flows, and async-task migration passed.");