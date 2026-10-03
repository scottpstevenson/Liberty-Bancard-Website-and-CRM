/** Re-resolve mirror tarballs using exact public npm metadata, not URL substitution.
 * The final npm regeneration and clean-install/policy gates remain independent.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2] ?? "package-lock.json";
const lock = JSON.parse(readFileSync(path, "utf8"));
let resolved = 0;
for (const [location, entry] of Object.entries<any>(lock.packages)) {
  if (!location || entry.link || !entry.resolved || entry.resolved.startsWith("https://registry.npmjs.org/")) continue;
  const name = location.split("node_modules/").at(-1)!;
  const metadata = JSON.parse(execFileSync("npm", [
    "view", `${name}@${entry.version}`, "name", "version", "dist", "--json",
    "--registry=https://registry.npmjs.org",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(metadata.name, name);
  assert.equal(metadata.version, entry.version);
  assert.equal(metadata.dist.integrity, entry.integrity, `Artifact identity mismatch: ${name}`);
  const source = new URL(metadata.dist.tarball);
  assert.equal(source.origin, "https://registry.npmjs.org");
  assert.equal(source.username + source.password + source.search + source.hash, "");
  assert.ok(source.pathname.endsWith(".tgz"));
  entry.resolved = source.href;
  resolved++;
}
writeFileSync(path, JSON.stringify(lock, null, 2) + "\n");
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund",
  "--registry=https://registry.npmjs.org"], { stdio: "inherit" });
console.log(`Verified ${resolved} public artifact identities and regenerated npm lock provenance.`);