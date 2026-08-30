#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { buildLocalRehearsalEnvironment, deterministicCatalogDiff, normalizeCatalog } from "./local-rehearsal-core";

const env = buildLocalRehearsalEnvironment({
  DATABASE_URL: "must-not-pass", PRODUCTION_DATABASE_URL: "must-not-pass",
  PGHOST: "must-not-pass", PGPASSWORD: "must-not-pass", PGSERVICE: "must-not-pass",
  OPENAI_API_KEY: "must-not-pass", GHL_API_KEY: "must-not-pass",
});
for (const key of ["DATABASE_URL", "PRODUCTION_DATABASE_URL", "PGHOST", "PGPASSWORD", "PGSERVICE", "OPENAI_API_KEY", "GHL_API_KEY"]) {
  assert.equal(env[key], undefined, `rehearsal child leaked ${key}`);
}
assert.equal(env.VG_PROVIDER_DENY_MODE, "1");
assert.equal(env.GHL_TRANSPORT_FAILFAST, "true");
const a = normalizeCatalog([{ owner: "ignored", name: "b" }, { name: "a", oid: 9 }]);
const b = normalizeCatalog([{ name: "a", oid: 2 }, { name: "b", owner: "different" }]);
assert.equal(a, b, "normalization must omit unstable fields");
assert.deepEqual(deterministicCatalogDiff(a, b), []);
assert.deepEqual(deterministicCatalogDiff('[{"name":"a"}]', '[{"name":"b"}]'), ['missing:{"name":"a"}', 'unexpected:{"name":"b"}']);
console.log("Local rehearsal safety primitives passed.");