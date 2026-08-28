#!/usr/bin/env tsx
/**
 * Task #1718 — static client audit for CRO-03 retirement vocabulary.
 *
 * A client must not offer request-detached legacy enrichment routes as if they
 * were live CRO-03 commands. This scan intentionally fails closed, naming each
 * source location that must be removed or replaced by a truthful disabled /
 * retired status before the client can claim CRO-03 convergence.
 */
import fs from "node:fs";
import path from "node:path";

const CLIENT_ROOT = "client/src";
const RETIRED_ENDPOINTS = [
  "/api/sunbiz/re-enrich-all",
  "/api/lead-ops/bulk-enrich",
  "/api/sdr/serper-enrichment/",
  "/api/contacts/bulk-enrich-linkedin",
  "/api/contacts/${contactId}/enrich-linkedin",
];
const TRUTHFUL_STATUS = /\b(retired|disabled|unavailable|not available|canonical intake|CRO-03)\b/i;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) :
      /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
}

const failures: string[] = [];
for (const file of files(CLIENT_ROOT)) {
  const source = fs.readFileSync(file, "utf8");
  for (const endpoint of RETIRED_ENDPOINTS) {
    let index = source.indexOf(endpoint);
    while (index >= 0) {
      const line = source.slice(0, index).split("\n").length;
      const context = source.slice(Math.max(0, index - 500), Math.min(source.length, index + endpoint.length + 500));
      const vocabulary = TRUTHFUL_STATUS.test(context);
      failures.push(`${file}:${line}: retired endpoint ${endpoint}${vocabulary ? " still invoked despite nearby truthful vocabulary" : " lacks truthful retired/disabled vocabulary"}`);
      index = source.indexOf(endpoint, index + endpoint.length);
    }
  }
}

if (failures.length) {
  console.error("CRO-03 client endpoint scan failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("CRO-03 client endpoint scan passed: no retired enrichment endpoint usage found.");