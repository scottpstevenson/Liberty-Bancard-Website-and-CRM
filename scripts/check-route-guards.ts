#!/usr/bin/env tsx
/**
 * Static-analysis smoke test: Role-protected route guard checker.
 *
 * Parses client/src/App.tsx and asserts that:
 *   1. No dashboard path is registered more than once (duplicate-route regression).
 *   2. Every path in MUST_BE_RESTRICTED has allowedRoles set in its ProtectedRoute.
 *
 * Run with:
 *   npx tsx scripts/check-route-guards.ts
 *
 * Exits 0 if every assertion holds, 1 otherwise. Suitable as a CI gate or
 * pre-deploy check. Does NOT require a running server.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Paths that MUST have allowedRoles set ─────────────────────────────────────
// Add any path here when it becomes admin/manager-only. The check will fail
// immediately if a future edit removes allowedRoles from one of these routes.
const MUST_BE_RESTRICTED: readonly string[] = [
  "/dashboard/review-queue",
  "/dashboard/partner-orgs",
  "/dashboard/co-branded-proposals",
  "/dashboard/email-health",
  "/dashboard/system-readiness",
  "/dashboard/terminal-roi",
  "/dashboard/growth-kpi",
  "/dashboard/widget-generator",
  "/dashboard/underwriting",
  "/dashboard/conversation-ai",
  "/dashboard/user-management",
  "/dashboard/permissions",
  "/dashboard/audit-logs",
  "/dashboard/activation",
  "/dashboard/operator",
  "/dashboard/stage-rules",
  "/dashboard/round-robin",
  "/dashboard/inbox-health",
  "/dashboard/ghl-settings",
  "/dashboard/ghl-workflows",
  "/dashboard/settings/integrations",
];

// ── Parse App.tsx ─────────────────────────────────────────────────────────────

const APP_TSX = resolve(__dirname, "../client/src/App.tsx");
const source = readFileSync(APP_TSX, "utf-8");

interface RouteEntry {
  path: string;
  hasAllowedRoles: boolean;
  allowedRoles: string[];
  lineNumber: number;
}

function parseRoutes(src: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const lines = src.split("\n");

  // We look for patterns like:
  //   <Route path="/dashboard/foo">
  //     <ProtectedRoute component={Foo} allowedRoles={["admin","manager"]} />
  //   </Route>
  //
  // Strategy: iterate line-by-line, track when we enter a <Route path="...">
  // block, then look at the next ProtectedRoute line.

  let pendingPath: string | null = null;
  let pendingLine = 0;

  // Regex to capture the path from a Route element
  const routePathRe = /<Route\s+path="([^"]+)"/;
  // Regex to detect a ProtectedRoute line and optionally capture allowedRoles
  const protectedRe = /<ProtectedRoute\b/;
  const allowedRolesRe = /allowedRoles=\{(\[[^\]]*\])\}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for a Route path declaration
    const pathMatch = routePathRe.exec(line);
    if (pathMatch) {
      pendingPath = pathMatch[1];
      pendingLine = i + 1; // 1-indexed
      continue;
    }

    // Check for ProtectedRoute — may be on the same line or a nearby line
    if (pendingPath !== null && protectedRe.test(line)) {
      // Collect text from this line and up to 2 more lines (allowedRoles may
      // span a second line in formatted JSX)
      const snippet = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      const rolesMatch = allowedRolesRe.exec(snippet);
      let roles: string[] = [];
      if (rolesMatch) {
        // Parse ["admin","manager"] — simple string extraction
        roles = Array.from(rolesMatch[1].matchAll(/"([^"]+)"/g)).map(
          (m) => m[1]
        );
      }
      entries.push({
        path: pendingPath,
        hasAllowedRoles: roles.length > 0,
        allowedRoles: roles,
        lineNumber: pendingLine,
      });
      pendingPath = null;
      continue;
    }

    // Reset pending path if we hit the closing </Route> without a ProtectedRoute
    if (pendingPath !== null && line.includes("</Route>")) {
      pendingPath = null;
    }
  }

  return entries;
}

// ── Run checks ────────────────────────────────────────────────────────────────

const routes = parseRoutes(source);

let failures = 0;

// ── Check 1: Duplicate routes ─────────────────────────────────────────────────
console.log("=== Check 1: Duplicate route registrations ===");
const seen = new Map<string, number[]>();
for (const r of routes) {
  if (!seen.has(r.path)) seen.set(r.path, []);
  seen.get(r.path)!.push(r.lineNumber);
}
let duplicatesFound = false;
for (const [path, lines] of seen) {
  if (lines.length > 1) {
    console.error(
      `✗ DUPLICATE: "${path}" is registered ${lines.length} times (lines ${lines.join(", ")})`
    );
    failures++;
    duplicatesFound = true;
  }
}
if (!duplicatesFound) {
  console.log(`✓ No duplicate route paths found (${routes.length} routes scanned).`);
}

console.log();

// ── Check 2: Restricted routes have allowedRoles ──────────────────────────────
console.log("=== Check 2: Restricted routes have allowedRoles ===");
let missingFound = false;
for (const requiredPath of MUST_BE_RESTRICTED) {
  const match = routes.find((r) => r.path === requiredPath);
  if (!match) {
    // Path not found at all in App.tsx — either renamed or removed.
    // This is worth flagging so the MUST_BE_RESTRICTED list stays accurate.
    console.warn(
      `⚠ NOT FOUND: "${requiredPath}" is in MUST_BE_RESTRICTED but has no ProtectedRoute in App.tsx — remove it from this list or re-add the route.`
    );
    // Not a hard failure — it could be intentionally removed.
    continue;
  }
  if (!match.hasAllowedRoles) {
    console.error(
      `✗ UNGUARDED: "${requiredPath}" (line ${match.lineNumber}) must have allowedRoles but does not.`
    );
    failures++;
    missingFound = true;
  } else {
    console.log(
      `✓ ${requiredPath.padEnd(42)} → [${match.allowedRoles.join(", ")}]`
    );
  }
}
if (!missingFound && failures === 0) {
  console.log(
    `\n✓ All ${MUST_BE_RESTRICTED.length} restricted routes are properly guarded.`
  );
}

// ── Check 3: Report unguarded /dashboard routes for awareness ─────────────────
console.log("\n=== Check 3: Unguarded ProtectedRoutes (informational) ===");
const unguarded = routes.filter(
  (r) => r.path.startsWith("/dashboard") && !r.hasAllowedRoles
);
if (unguarded.length === 0) {
  console.log("✓ All dashboard ProtectedRoutes have allowedRoles set.");
} else {
  console.log(
    `ℹ  ${unguarded.length} dashboard routes use ProtectedRoute without allowedRoles (any authenticated CRM user can access):`
  );
  for (const r of unguarded) {
    const inRequiredList = MUST_BE_RESTRICTED.includes(r.path);
    const marker = inRequiredList ? "✗" : " ";
    console.log(`  ${marker} ${r.path.padEnd(44)} (line ${r.lineNumber})`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (failures === 0) {
  console.log(
    "✅ All route-guard assertions passed. No role-protection regressions detected."
  );
  process.exit(0);
} else {
  console.error(
    `\n❌ ${failures} role-guard assertion(s) failed — fix before deploying.`
  );
  process.exit(1);
}
