import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const route = read("server/routes/cr06-feedback.ts");
const service = read("server/services/cr06-feedback.ts");
const migration = read("migrations/0185_cr06_history_and_feedback.sql");

for (const event of [
  "delivered", "hard_bounce", "soft_bounce", "complaint", "unsubscribe",
  "provider_rejected", "provider_failed", "replied",
]) {
  assert.match(route, new RegExp(`"${event}"`));
  assert.match(migration, new RegExp(`'${event}'`));
}

assert.doesNotMatch(route, /z\.record\(z\.unknown\(\)\)/);
assert.match(route, /payload: z\.object\(\{/);
assert.match(route, /\}\)\.strict\(\)\.optional\(\)/);
assert.match(service, /Receipt first:/);
assert.match(service, /ON CONFLICT \(source,event_key\) DO NOTHING/);
assert.match(service, /recordReachabilityObservation/);
assert.match(service, /applyConsentCommand/);
assert.match(service, /terminalizeSequenceEnrollment/);
assert.match(service, /ON CONFLICT \(provider,provider_event_key\) DO NOTHING/);

for (const table of [
  "cr06_artifacts", "cr06_rollout_manifests", "cr06_campaign_gates",
  "cr06_preparation_runs", "cr06_prepared_enrollments",
  "cr06_manual_task_intents", "cr06_delivery_intents",
]) {
  assert.match(migration, new RegExp(table));
}

console.log("CR-06 strict feedback and history source checks passed");