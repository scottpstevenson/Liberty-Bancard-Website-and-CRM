/*
 * Focused deterministic Apollo resolver check.  Every request uses injected
 * fetch; this script never contacts Apollo.
 */
import assert from "node:assert/strict";
import {
  resolveApolloOrganizationForCro03Worker,
  resolveApolloOrganizationForFrozenIdentity,
  type ApolloFetch,
} from "../server/services/sdr/apollo";

process.env.APOLLO_API_KEY = "test-key";

const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const organization = {
  id: "org-42",
  name: "Acme Payments LLC",
  dba_name: "Acme Pay",
  primary_domain: "acmepay.test",
  street_address: "10 Main St",
  city: "Miami",
  state: "FL",
};
const fetchMock: ApolloFetch = async (url, init) => {
  const body = JSON.parse(String(init.body));
  requests.push({ url, body });
  if (url.endsWith("/organizations/search")) {
    // Deliberately reorder results on each query; selection cannot use order.
    return new Response(JSON.stringify({ organizations: [
      { ...organization, id: "org-other", name: "Other Co", dba_name: "Other", primary_domain: "other.test" },
      organization,
    ].reverse() }), { status: 200 });
  }
  assert.deepEqual(body.organization_ids, ["org-42"]);
  return new Response(JSON.stringify({ people: [{
    first_name: "Ada", last_name: "Lovelace", organization: { id: "org-42", ...organization },
  }, {
    first_name: "Wrong", organization: { id: "org-other" },
  }] }), { status: 200 });
};

const resolved = await resolveApolloOrganizationForFrozenIdentity({
  domain: "https://www.acmepay.test",
  legalName: "Acme Payments LLC",
  dbaName: "Acme Pay",
  city: "Miami",
  state: "FL",
  address: "10 Main St",
}, fetchMock);
assert.equal(resolved.outcome, "success");
if (resolved.outcome !== "success") throw new Error("Expected a unique organization resolution");
assert.equal(resolved.organizationId, "org-42");
assert.equal(resolved.people.length, 1);
assert.deepEqual(requests[0].body.q_organization_domains, ["acmepay.test"]);
assert.deepEqual(requests[0].body.organization_locations, ["Miami, FL"]);
assert.equal(requests.at(-1)?.body.organization_ids?.[0], "org-42");

const ambiguous = await resolveApolloOrganizationForFrozenIdentity(
  { domain: "acmepay.test", city: "Miami", state: "FL" },
  async (url, init) => new Response(JSON.stringify({
    organizations: url.endsWith("/organizations/search")
      ? [organization, { ...organization, id: "org-99" }].reverse()
      : [],
  }), { status: 200 }),
);
assert.equal(ambiguous.outcome, "ambiguous");
assert.deepEqual(ambiguous.alternatives.map((item) => item.organizationId), ["org-42", "org-99"]);
assert.equal("people" in ambiguous, false);

const noResult = await resolveApolloOrganizationForFrozenIdentity(
  { legalName: "Missing Co", city: "Miami", state: "FL" },
  async () => new Response(JSON.stringify({ organizations: [] }), { status: 200 }),
);
assert.equal(noResult.outcome, "no_result");
assert.equal("organization" in noResult, false);
assert.equal("people" in noResult, false);

// A forged runtime context cannot reach the production transport wrapper.
let productionFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  productionFetchCalls++;
  throw new Error("Production fetch must not be reached");
};
try {
  await assert.rejects(
    () => resolveApolloOrganizationForCro03Worker(
      { domain: "acmepay.test" },
      {
        kind: "cro03_worker",
        provider: "apollo",
        caller: "unapproved",
        explicitPaidApproval: false,
      } as any,
    ),
    /Unapproved provider caller/,
  );
  assert.equal(productionFetchCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Apollo organization resolution checks passed.");