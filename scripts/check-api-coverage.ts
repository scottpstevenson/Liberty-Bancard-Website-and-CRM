#!/usr/bin/env tsx
/**
 * Task #169 — API surface coverage check.
 *
 * Scans client/src for `apiRequest`/`useQuery`/`fetch` calls referencing
 * `/api/...` paths, then ripgreps server/ for matching Express route
 * registrations. Reports any frontend call without a server handler.
 *
 * Exit code 1 if there are unmatched paths, 0 otherwise. Wire into CI.
 */
import { execSync } from "node:child_process";

interface Match { file: string; line: number; path: string }

function rg(pattern: string, dir: string): string {
  try {
    return execSync(`rg --no-heading --line-number -o "${pattern}" ${dir}`, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function extractClientPaths(): Set<string> {
  const out = new Set<string>();
  const raw = rg("['\\\"\\\`]/api/[A-Za-z0-9_./?:\\-\\$\\{\\}]+", "client/src");
  for (const line of raw.split("\n")) {
    const m = line.match(/['"`](\/api\/[^'"`,)\s]*)/);
    if (!m) continue;
    let p = m[1];
    p = p.replace(/\$\{[^}]+\}/g, ":param");
    p = p.replace(/\?.*$/, "");
    p = p.replace(/\/$/, "");
    if (p.length > "/api".length) out.add(p);
  }
  return out;
}

function extractServerPaths(): Set<string> {
  const out = new Set<string>();
  const raw = rg("app\\.(get|post|put|patch|delete|use)\\(\\\"/api/[^\\\"]+\\\"", "server");
  for (const line of raw.split("\n")) {
    const m = line.match(/"(\/api\/[^"]+)"/);
    if (m) out.add(m[1]);
  }
  return out;
}

function pathMatches(clientPath: string, serverPaths: Set<string>): boolean {
  if (serverPaths.has(clientPath)) return true;
  const cParts = clientPath.split("/");
  for (const sp of serverPaths) {
    const sParts = sp.split("/");
    if (sParts.length !== cParts.length) continue;
    let ok = true;
    for (let i = 0; i < sParts.length; i++) {
      const s = sParts[i];
      const c = cParts[i];
      if (s.startsWith(":")) continue;
      if (s === c) continue;
      ok = false;
      break;
    }
    if (ok) return true;
  }
  // Tolerate trailing /:param style frontend calls vs root server route.
  for (const sp of serverPaths) {
    if (clientPath.startsWith(sp + "/")) return true;
  }
  return false;
}

// Pre-existing client→server mismatches found at the time of Task #169.
// Any NEW mismatch fails CI; an existing one only triggers a warning until
// follow-up #194 cleans them up (so the gate enforces "no regressions").
const KNOWN_MISMATCHES = new Set<string>([
  "/api/lead-intelligence/full",
  "/api/public/proposal",
  "/api/sdr/discovery/nightly/${start",
  "/api/sdr/merchants",
  "/api/sms-inbox/thread",
  "/api/voice-conversations/1/messages",
]);

function main() {
  const clientPaths = extractClientPaths();
  const serverPaths = extractServerPaths();
  const missing: string[] = [];
  for (const p of clientPaths) {
    if (!pathMatches(p, serverPaths)) missing.push(p);
  }
  console.log(`Scanned ${clientPaths.size} client API paths against ${serverPaths.size} server handlers.`);

  const newMissing = missing.filter((p) => !KNOWN_MISMATCHES.has(p));
  const knownMissing = missing.filter((p) => KNOWN_MISMATCHES.has(p));

  if (knownMissing.length > 0) {
    console.warn(`! ${knownMissing.length} pre-existing unmatched paths (tracked by follow-up #194):`);
    for (const p of knownMissing.sort()) console.warn(`  - ${p}`);
  }
  if (newMissing.length === 0) {
    console.log("✓ No NEW client /api/ paths without a matching server handler.");
    process.exit(0);
  }
  console.error(`✗ ${newMissing.length} NEW client /api/ paths have no matching server handler:`);
  for (const p of newMissing.sort()) console.error(`  - ${p}`);
  console.error("Either implement the server handler, remove the client call, or add the path to KNOWN_MISMATCHES with justification.");
  process.exit(1);
}

main();
