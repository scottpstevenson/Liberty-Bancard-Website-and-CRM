#!/usr/bin/env npx tsx
/**
 * scan-csrf-fetch.ts — Client-side CSRF compliance scanner
 *
 * Scans client/src for raw fetch() calls that use non-safe HTTP methods
 * (POST, PUT, PATCH, DELETE) without attaching a CSRF token via getCsrfToken().
 *
 * Background:
 *   Authenticated mutations made via raw fetch() bypass the canonical apiRequest()
 *   helper, which automatically attaches the X-CSRF-Token header. Unauthenticated
 *   or token-authenticated flows (merchant application, statement upload) are
 *   explicitly exempt via the PUBLIC_FLOW and TOKEN_AUTH_FLOW classifications.
 *
 * Exemption model (in priority order):
 *   1. Files in EXEMPT_FILES (entirely public/pre-auth/token-auth flows): PASS
 *   2. Per-call-site CSRF_EXEMPT comment on preceding or same line: PASS
 *   3. The mutation method is confirmed within the specific fetch options block
 *      AND X-CSRF-Token or getCsrfToken appears in that options block: PASS
 *   4. The specific fetch options reference a `headers` variable by name;
 *      that variable's definition (within 40 lines) contains getCsrfToken or
 *      X-CSRF-Token: PASS
 *   5. All other raw mutation fetch() calls: FAIL
 *
 * Token coverage check (steps 3-4) is scoped to the exact fetch call's
 * options argument and the specific headers variable it references — not a
 * broad surrounding-line window. This prevents false passes from unrelated
 * getCsrfToken() calls in adjacent functions or fetch calls.
 *
 * Mutation detection uses the same options-block extraction to avoid false
 * positives from adjacent fetch calls whose method declaration falls within
 * an 8-line lookahead of an unrelated fetch.
 *
 * Exit codes:
 *   0 — all call sites have CSRF coverage or are explicitly classified
 *   1 — one or more unclassified authenticated mutation call sites found
 *
 * Usage:
 *   npx tsx scripts/scan-csrf-fetch.ts
 */

import fs from "fs";
import path from "path";

const CLIENT_SRC = path.join(process.cwd(), "client", "src");

/**
 * Files that serve exclusively public or token-authenticated flows.
 * Every fetch() mutation in these files is either pre-authentication (login,
 * signup) or uses a token in the URL/body instead of a session cookie.
 * Session-cookie authenticated mutations MUST use getCsrfToken() and CANNOT
 * be added here — they belong in the per-call-site CSRF_EXEMPT allowlist
 * or the main authenticated code path.
 *
 * Files listed here have been manually audited to confirm NO session-cookie
 * authenticated mutations exist in them (only public/pre-auth/token-auth).
 */
const EXEMPT_FILES = new Set([
  // PUBLIC_FLOW: merchant application — unauthenticated public form submission
  "client/src/pages/MerchantApplication.tsx",
  // TOKEN_AUTH_FLOW: statement upload — authenticated via upload token, not session cookie
  "client/src/pages/MerchantStatementUpload.tsx",
  // PUBLIC_FLOW: main auth hook — all calls are pre-auth (login, logout, signup, TOTP verify)
  //   No session exists yet; CSRF does not apply to pre-auth operations.
  "client/src/hooks/use-auth.ts",
  // PUBLIC_FLOW: partner login portal — login, forgot-password, reset-password, set-password
  //   All calls are pre-auth or use reset tokens, not session cookies.
  "client/src/pages/PartnerLogin.tsx",
  // PUBLIC_FLOW: partner portal — partner login, logout, and password reset flows
  //   All calls are pre-auth or token-authenticated.
  "client/src/pages/PartnerPortal.tsx",
  // PUBLIC_FLOW: affiliate program — signup, login, logout, track-click
  //   All calls are public registration/auth flows.
  "client/src/pages/AffiliateProgram.tsx",
  // PUBLIC_FLOW: partner-branded landing page — contacts/public, statements/upload
  //   Public form submission endpoints, no session cookie required.
  "client/src/pages/PartnerBrandedPage.tsx",
  // PUBLIC_FLOW: public AI chat widget — all /api/public/ and /api/assistant/chat
  //   Explicitly public endpoints designed to be called without authentication.
  "client/src/components/ChatWidget.tsx",
  // TOKEN_AUTH_FLOW: co-branded proposal viewer — accept via URL token, not session cookie
  "client/src/pages/CoBrandedProposalViewer.tsx",
  // PUBLIC_FLOW: ISO partner program application — public partner application form
  "client/src/pages/ISOPartnerProgram.tsx",
  // TOKEN_AUTH_FLOW: NPS survey — token-authenticated submit + public review click tracking
  //   Token comes from email link; no session cookie involved.
  "client/src/pages/NpsSurvey.tsx",
  // TOKEN_AUTH_FLOW: portal invite activation — activated via invite token, not session cookie
  "client/src/pages/ActivatePortal.tsx",
  // PUBLIC_FLOW: analytics utility library — called from both public and authenticated pages.
  //   The phone-call-click endpoint is a public analytics write.
  //   Authenticated callers (e.g., ContactDetail.tsx) attach getCsrfToken() directly
  //   at their call site rather than relying on this utility.
  "client/src/lib/analytics.ts",
  // PUBLIC_FLOW: public equipment shop order form — /api/equipment-order is a public
  //   commerce endpoint (no credentials: "include"; no session auth required).
  "client/src/pages/TerminalShop.tsx",
]);

/**
 * Per-call-site comment that explicitly classifies a fetch() call as exempt.
 * The comment must appear on the line before or the same line as the fetch() call.
 * Format: // CSRF_EXEMPT: <PUBLIC_FLOW|TOKEN_AUTH_FLOW|NO_MUTATION> <reason>
 */
const CSRF_EXEMPT_COMMENT = /\/\/\s*CSRF_EXEMPT:/;

/**
 * Non-safe HTTP methods that require CSRF protection on authenticated routes.
 */
const MUTATION_METHODS = /method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i;

/**
 * CSRF token patterns used for direct detection within fetch options.
 */
const CSRF_DIRECT_PATTERNS: RegExp[] = [
  /getCsrfToken\s*\(/,
  /X-CSRF-Token/i,
  /x-csrf-token/i,
];

// ── Options-block extraction ───────────────────────────────────────────────

/**
 * Extract the second argument (options object) from a fetch() call starting
 * at fetchLineIdx. Tracks string literals and brace depth to avoid false matches.
 *
 * Returns the raw text of the options argument (between the comma after the URL
 * and the closing parenthesis of the fetch call), or '' if not found.
 */
function extractFetchOptionsBlock(lines: string[], fetchLineIdx: number): string {
  const maxLookAhead = 15;
  const code = lines
    .slice(fetchLineIdx, Math.min(fetchLineIdx + maxLookAhead, lines.length))
    .join("\n");

  const fetchPos = code.indexOf("fetch(");
  if (fetchPos === -1) return "";

  let i = fetchPos + "fetch(".length;
  let depth = 1; // inside the outer fetch(...)
  let inStr: string | null = null;
  let commaAt = -1;
  let closeAt = -1;

  while (i < code.length) {
    const ch = code[i];

    if (inStr !== null) {
      if (ch === "\\") { i += 2; continue; } // skip escape sequence
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }

    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === ")") { closeAt = i; break; }
    } else if (ch === "," && depth === 1 && commaAt === -1) {
      commaAt = i; // separator between URL arg and options arg
    }
    i++;
  }

  if (commaAt === -1) return "";
  return closeAt !== -1 ? code.slice(commaAt + 1, closeAt) : code.slice(commaAt + 1);
}

// ── CSRF coverage detection ────────────────────────────────────────────────

/**
 * Given the options block of a fetch() call, return the name of the variable
 * used as the `headers` property value (if it is a variable reference rather
 * than an inline object literal). Returns null if headers is absent, inline,
 * or this call does not provide a headers property.
 *
 * Handles:
 *   `headers: uploadHeaders`  → "uploadHeaders"
 *   `headers,`                → "headers"    (ES shorthand)
 *   `headers: { ... }`        → null         (inline — checked directly)
 */
function extractHeadersVarName(optionsBlock: string): string | null {
  // Match `headers: identifierName` (not followed by `{`)
  const explicitMatch = optionsBlock.match(
    /\bheaders\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=[,}\n])/
  );
  if (explicitMatch && !/\bheaders\s*:\s*\{/.test(optionsBlock)) {
    return explicitMatch[1];
  }
  // Match `headers,` (ES shorthand — variable named "headers")
  if (/\bheaders\s*,/.test(optionsBlock) || /\bheaders\s*\n/.test(optionsBlock)) {
    return "headers";
  }
  return null;
}

/**
 * Look back through enclosing scope for the definition of `varName` and check
 * whether it was initialized with a CSRF token (getCsrfToken or X-CSRF-Token).
 *
 * Searches up to 40 lines before fetchLineIdx for `const/let/var varName`.
 */
function varDefHasCsrf(lines: string[], fetchLineIdx: number, varName: string): boolean {
  const escapedName = varName.replace(/[$]/g, "\\$");
  const lookback = lines.slice(Math.max(0, fetchLineIdx - 40), fetchLineIdx).join("\n");
  // Find most recent declaration or first assignment of this variable
  const defPattern = new RegExp(`(?:const|let|var)\\s+${escapedName}\\b`);
  const defIdx = lookback.search(defPattern);
  if (defIdx === -1) return false;
  // Check if getCsrfToken or X-CSRF-Token appears after the declaration
  const afterDef = lookback.slice(defIdx);
  return CSRF_DIRECT_PATTERNS.some((p) => p.test(afterDef));
}

/**
 * Returns true if the fetch() call at fetchLineIdx has CSRF token coverage.
 *
 * Coverage is established by one of:
 *   A) A CSRF pattern directly within the fetch options block
 *   B) A headers variable referenced in the options whose definition includes
 *      getCsrfToken or X-CSRF-Token in the enclosing scope
 *
 * Coverage is NOT established by unrelated getCsrfToken() calls nearby.
 */
function hasCsrfCoverage(lines: string[], fetchLineIdx: number, optionsBlock: string): boolean {
  // A) Direct: CSRF pattern in the options block itself
  if (CSRF_DIRECT_PATTERNS.some((p) => p.test(optionsBlock))) return true;

  // B) Indirect: options reference a headers variable — look up its definition
  const headersVar = extractHeadersVarName(optionsBlock);
  if (headersVar) {
    return varDefHasCsrf(lines, fetchLineIdx, headersVar);
  }

  return false;
}

// ── File scanner ────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  snippet: string;
  verdict: "PASS" | "FAIL";
  reason: string;
}

const findings: Finding[] = [];
let scanned = 0;

function scanFile(filePath: string): void {
  const relPath = path.relative(process.cwd(), filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  // Files classified as entirely public/pre-auth/token-auth — pass all
  if (EXEMPT_FILES.has(relPath)) {
    // Count exempt call sites for reporting
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("fetch(")) continue;
      const optionsBlock = extractFetchOptionsBlock(lines, i);
      if (!MUTATION_METHODS.test(optionsBlock)) continue;
      findings.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim().slice(0, 80),
        verdict: "PASS",
        reason: "Exempt: public/token-authenticated flow (see EXEMPT_FILES classification)",
      });
      scanned++;
    }
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("fetch(")) continue;

    // Extract this fetch call's options block. This is the single source of
    // truth for both mutation detection and CSRF coverage — prevents false
    // positives from adjacent fetch calls whose method declaration might fall
    // within a naive multi-line lookahead.
    const optionsBlock = extractFetchOptionsBlock(lines, i);
    if (!MUTATION_METHODS.test(optionsBlock)) continue; // Not a mutation

    scanned++;

    // 1. Per-call-site exempt comment (same or preceding line)
    const prevLine = i > 0 ? lines[i - 1] : "";
    if (CSRF_EXEMPT_COMMENT.test(line) || CSRF_EXEMPT_COMMENT.test(prevLine)) {
      findings.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim().slice(0, 80),
        verdict: "PASS",
        reason: "Exempt: per-call-site CSRF_EXEMPT classification",
      });
      continue;
    }

    // 2. Options-block scoped CSRF coverage check
    if (hasCsrfCoverage(lines, i, optionsBlock)) {
      findings.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim().slice(0, 80),
        verdict: "PASS",
        reason: "CSRF token present in fetch options or referenced headers variable",
      });
      continue;
    }

    // No CSRF coverage found
    findings.push({
      file: relPath,
      line: i + 1,
      snippet: line.trim().slice(0, 80),
      verdict: "FAIL",
      reason:
        "Raw fetch() mutation: no CSRF token in options block or referenced headers variable. " +
        "Fix: inline getCsrfToken() in the headers, reference a headers variable that includes it, " +
        "or add // CSRF_EXEMPT: <reason> if this is a public/token-auth flow.",
    });
  }
}

function walkDir(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".next", "__tests__"].includes(entry.name)) continue;
      walkDir(full);
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      scanFile(full);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log("\n── Client-side CSRF Fetch Scanner ──────────────────────────────\n");
console.log(`  Scanning: ${CLIENT_SRC}`);

if (!fs.existsSync(CLIENT_SRC)) {
  console.error("  ✗ client/src directory not found");
  process.exit(1);
}

walkDir(CLIENT_SRC);

const failures = findings.filter((f) => f.verdict === "FAIL");
const passes = findings.filter((f) => f.verdict === "PASS");

console.log(`\n  Scanned ${scanned} mutation fetch() call sites across client/src\n`);

if (passes.length > 0) {
  console.log("  PASS call sites:");
  for (const f of passes) {
    console.log(`    ✓ ${f.file}:${f.line} — ${f.reason}`);
  }
}

if (failures.length > 0) {
  console.log("\n  FAIL call sites:");
  for (const f of failures) {
    console.error(`    ✗ ${f.file}:${f.line}: ${f.snippet}`);
    console.error(`      Reason: ${f.reason}`);
  }
  console.error(
    `\n✗ CSRF fetch scan FAILED: ${failures.length} unclassified authenticated mutation(s) found.`
  );
  console.error(
    "  Fix: attach getCsrfToken() from @/lib/queryClient, or add // CSRF_EXEMPT: <reason> comment."
  );
  process.exit(1);
} else {
  console.log(
    `\n✅ CSRF fetch scan PASSED: all ${scanned} mutation call sites have CSRF coverage or explicit classification.\n`
  );
  process.exit(0);
}
