import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consentEventLabel } from "../shared/consent-event-label";
import { briefingFactsSummary } from "../shared/briefing-facts";
import { executeDeleteBatch, inventoryDependencies, coordinatePendingJobs } from "../server/services/contact-deletion-service";

assert.equal(consentEventLabel("opt_in"), "Opt in");
assert.equal(consentEventLabel("opt_out"), "Opt out");
for (const action of ["global_dnc", "pewc_opt_in", "block_auto_contact", "unchecked", "not_granted", "unknown", "canonical_fact", "reachability_fact"]) {
  assert.notEqual(consentEventLabel(action), "Opt out", action);
}
assert.equal(consentEventLabel("unknown"), "Other consent event");
const ids = [1, 2, 2, 3];
assert.deepEqual((await inventoryDependencies(ids)).eligible, []);
assert.deepEqual((await coordinatePendingJobs(ids)).safe, []);
const result = await executeDeleteBatch(ids, "test-operation");
assert.equal(result.deleted, 0);
assert.equal(result.failed.length, 3);
assert.ok(result.failed.every(row => row.error.includes("retention_contract_unverified")));
assert.deepEqual(await executeDeleteBatch([], "empty"), { deleted: 0, failed: [] });
await assert.rejects(executeDeleteBatch(Array.from({ length: 101 }, (_, i) => i), "over-limit"), /≤100/);
const source = readFileSync("server/services/contact-deletion-service.ts", "utf8");
assert.doesNotMatch(source, /DELETE FROM|pool\.connect|from ["']\.\.\/db/);
const knowledge = readFileSync("server/services/knowledge-base.ts", "utf8");
assert.doesNotMatch(knowledge, /execute\(\{\s*sql:/);
assert.match(knowledge, /AND status = \$\{opts.status\}/);
assert.match(knowledge, /AND audience = \$\{opts.audience\}/);
const ui = readFileSync("client/src/pages/dashboard/contact-detail-tabs/RelationshipsTab.tsx", "utf8");
assert.match(ui, /throw new Error\("Relationship graph unavailable"\)/);
assert.match(ui, /throw new Error\("Relationships unavailable"\)/);
assert.match(ui, /Retry graph/);
assert.match(ui, /Retry relationships/);
const facts = { tasksDueToday: 0, overdueTaskCount: 7, overdueSlaCount: null,
  inboundEventCount: null, outreachReadyCount: 0, closedWonYesterday: null };
for (const fakeModel of [null, "", "All caught up; no tasks overdue", "100 unread messages"]) {
  const summary = briefingFactsSummary(facts, fakeModel);
  assert.match(summary, /Overdue tasks: 7/);
  assert.match(summary, /Tasks due today: 0/);
  assert.match(summary, /SLA breaches: unavailable/);
  assert.doesNotMatch(summary, /All caught up|100 unread/);
}
console.log("Stage 3 B source contracts PASS: neutral consent labels; all product erasure denied without DB import; Knowledge parameter composition; both relationship errors explicit. This is static/pure proof, not HTTP/browser proof.");
