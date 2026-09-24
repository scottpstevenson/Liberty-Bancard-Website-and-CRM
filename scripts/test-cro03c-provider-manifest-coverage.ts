/**
 * Source-level regression guard for the only CRO03C live provider dispatcher.
 * A key or `explicitPaidApproval: true` is never sufficient: each paid path
 * must retain both its manifest caller gate and its durable authority check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROVIDER_SOURCE_MANIFEST } from "../server/services/provider-manifest";

const executorPath = "server/services/cro03/live-provider-executors.ts";
const executor = readFileSync(executorPath, "utf8");
const safeEgressPath = "server/services/cro03/live-safe-egress.ts";
const safeEgress = readFileSync(safeEgressPath, "utf8");
const liveCaller = executorPath;
const sfpCaller = "server/services/cro03/sfp-live-provider-adapters.ts";

function manifestRow(id: string) {
  const row = PROVIDER_SOURCE_MANIFEST.find((candidate) => candidate.id === id);
  assert.ok(row, `missing provider manifest row: ${id}`);
  return row;
}

function caseBody(provider: string): string {
  const match = executor.match(new RegExp(`case "${provider}": \\{([\\s\\S]*?)(?=\\n    case "|\\n  \\})`));
  assert.ok(match, `CRO03C executor case missing: ${provider}`);
  return match[1];
}

for (const [provider, sourceId, capability] of [
  ["serper", "serper", "business_discovery"],
  ["apollo", "apollo", "contact_enrichment"],
  ["outscraper", "outscraper", "business_discovery"],
  ["openai", "openai_classification", "classification"],
  ["zerobounce", "zerobounce", "email_validation"],
] as const) {
  const row = manifestRow(sourceId);
  const callers: readonly string[] = row.approvedCallers;
  assert.ok(
    callers.includes(liveCaller),
    `${sourceId} must authorize the exact CRO03C live executor caller`,
  );
  if (["apollo", "outscraper", "openai_classification"].includes(sourceId)) {
    assert.ok(callers.includes(sfpCaller), `${sourceId} must authorize the SFP live adapter caller`);
    assert.ok(
      (row.approvedAdapters as readonly string[]).includes(sfpCaller),
      `${sourceId} must include the SFP live adapter in approvedAdapters`,
    );
  }
  assert.ok((row.capability as readonly string[]).includes(capability), `${sourceId} capability is incomplete`);
  const body = caseBody(provider);
  assert.match(
    body,
    new RegExp(`assertProviderActivation\\(\\{[\\s\\S]*?sourceId: "${sourceId}"[\\s\\S]*?caller: CALLER`),
    `${provider} must use the manifest caller gate`,
  );
  assert.match(
    body,
    /assertCro03cAuthorityBeforeIo\(context\)/,
    `${provider} must require durable authority in addition to manifest approval`,
  );
}

assert.match(caseBody("serper"), /serperGateway\.executeSearch/);
assert.match(caseBody("apollo"), /executeApolloForCro03c/);
assert.match(caseBody("outscraper"), /executeCro03cOutscraper/);
assert.match(caseBody("openai"), /performOpenAiClassification/);
assert.match(caseBody("zerobounce"), /processValidationIntent/);

const firstParty = manifestRow("first_party_web");
assert.ok((firstParty.approvedCallers as readonly string[]).includes(safeEgressPath));
assert.ok((firstParty.capability as readonly string[]).includes("website_parsing"));
assert.match(safeEgress, /assertProviderActivation\(\{[\s\S]*?sourceId: "first_party_web"[\s\S]*?caller: CALLER/);
assert.match(safeEgress, /assertCro03cAuthorityBeforeIo\(this\.options\.context\)/);
assert.match(caseBody("first_party_web"), /createCro03cLiveSafeEgress/);

const legacyFactory = "server/services/cro03/enrichment-factory.ts";
assert.equal((manifestRow("apollo").approvedCallers as readonly string[]).includes(legacyFactory), false);
assert.equal((manifestRow("outscraper").approvedCallers as readonly string[]).includes(legacyFactory), false);
assert.match(
  readFileSync(legacyFactory, "utf8"),
  /export const CRO03_PROVIDER_TRANSPORT_ENABLED = false as const/,
);

console.log("CRO03C provider manifest coverage: PASS");