#!/usr/bin/env npx tsx
/**
 * RVR-03 — deterministic recurrence scan for a deliberately small set of
 * credential, public-identity, token-authority, and channel-audit callsites.
 *
 * This is intentionally a lexical scanner, not a broad secret scanner. Each
 * rule names the unsafe callsite/form it owns so ordinary identifiers,
 * documentation, and unrelated logging are not treated as evidence.
 * Diagnostics contain a path, rule, and line only: matched source is never
 * returned or printed.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolve } from "path";

export type Rvr03Rule =
  | "RVR03_CREDENTIAL_LITERAL_MAPPING"
  | "RVR03_FIXED_CREDENTIAL_OUTPUT"
  | "RVR03_QUERY_TOKEN_AUTH_LINK"
  | "RVR03_RAW_CREDENTIAL_URL_OR_ERROR_LOG"
  | "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG"
  | "RVR03_PUBLIC_IDENTITY_VALIDATION"
  | "RVR03_DUPLICATE_TOKEN_AUTHORITY"
  | "RVR03_ROUTE_LOCAL_TOKEN_AUTHORITY"
  | "RVR03_GET_TOKEN_VALIDATION"
  | "RVR03_IDENTITY_BEARING_PUBLIC_VALIDATION_RESPONSE"
  | "RVR03_QUERY_BEARER_READ"
  | "RVR03_PLAINTEXT_TEMPORARY_PASSWORD"
  | "RVR03_MATH_RANDOM_CREDENTIAL"
  | "RVR03_LEGACY_TOKEN_FIELD_BYPASS"
  | "RVR03_AUTH_POST_CACHE_CONTRACT"
  | "RVR03_UNSAFE_OG_FS_PRIMITIVE"
  | "RVR03_UNSANITIZED_CHANNEL_AUDIT_WRITE"
  | "RVR03_SCOPE_INVALID";

export interface Rvr03Source {
  path: string;
  content: string;
}

export interface Rvr03Finding {
  path: string;
  rule: Rvr03Rule;
  line: number;
}

const LITERAL_CREDENTIAL_MAPPING =
  /\b(?:password|passwordHash|apiKey|token|secret)\s*:\s*["'`][^"'`]+["'`]/i;
const FIXED_CREDENTIAL_OUTPUT =
  /\bconsole\.(?:log|error|warn)\s*\([^)]*(?:[(,]\s*(?:TEST_)?(?:password|pass|token|secret|apiKey)\b|\$\{\s*(?:TEST_)?(?:password|pass|token|secret|apiKey)\b)/i;
const QUERY_TOKEN_AUTH_LINK =
  /\b(?:href|url|location|redirect(?:Url)?)\s*[:=][^\n]*\?[^#\n]*\b(?:token|access_token|auth_token|reset_token)=/i;
const RAW_CREDENTIAL_URL_OR_ERROR_LOG =
  /\b(?:console\.(?:log|error|warn)|logger\.(?:info|warn|error)|logError)\s*\([^)]*(?:https?:\/\/[^/\s"'`]+:[^@\s"'`]+@|[(,]\s*(?:password|token|secret|apiKey|credential(?:s)?)\b|\$\{\s*(?:password|token|secret|apiKey|credential(?:s)?)\b)/i;
const RAW_OPERATIONAL_DIAGNOSTIC_LOG =
  /\b(?:console\.(?:log|error|warn)|logger\.(?:info|warn|error))\s*\([^\n]*(?:,\s*(?:err|error|e)\b|\b(?:err|error)\.message\b|\bresult\.error\b|,\s*(?:providerResponse|providerResult|response)\b|\$\{[^}]*\bemail\b[^}]*\})/i;
const PUBLIC_IDENTITY_VALIDATION = /\bvalidatePublicIdentity\s*\(/;
const TOKEN_AUTHORITY = /\b(?:jwt\.verify|verify(?:Access|Reset|Session)?Token)\s*\(/g;
const ROUTE_LOCAL_TOKEN_AUTHORITY = /\b(?:const|let|var)\s+(?:reset|invite|verification|auth|action|access)Token\s*=\s*crypto\.(?:randomBytes|createHash|createHmac)\s*\(/i;
const GET_TOKEN_VALIDATION = /\b(?:app|router)\.get\s*\([\s\S]{0,2400}\b(?:isAuthActionValid|validatePublicIdentity)\s*\(/;
const PUBLIC_VALIDATION_RESPONSE = /\b(?:app|router)\.(?:get|post)\s*\(\s*["'`][^"'`]*\/validate[^"'`]*["'`][\s\S]{0,2400}\b(?:isAuthActionValid|validatePublicIdentity)\s*\([\s\S]{0,1400}\b(?:res\.(?:json|send)\s*\(\s*\{[\s\S]{0,500}\b(?:email|userId|identity|firstName|lastName)\b)/;
const CHANNEL_AUDIT_WRITE = /\bdb\.insert\s*\(\s*channelAuditLog\s*\)\.values\s*\(/;
const QUERY_BEARER_READ = /\b(?:req\.query(?:\?\.)?\.token|URLSearchParams\s*\(\s*window\.location\.search\s*\)\.get\s*\(\s*["'`]token)/;
const PLAINTEXT_TEMPORARY_PASSWORD = /\b(?:temporary|temp|initial|default)\w*(?:password|pass)\w*\s*=\s*["'`][^"'`]+["'`]/i;
const MATH_RANDOM_CREDENTIAL = /\b\w*(?:token|secret|password|pass|credential)\w*\s*=\s*Math\.random\s*\(/i;
const LEGACY_TOKEN_BYPASS = /(?:\.set\s*\(\s*\{[^}\n]*\b(?:resetToken|verificationToken|passwordResetToken|inviteToken)\s*:(?!\s*null\b)|\beq\s*\(\s*\w+\.(?:resetToken|verificationToken|passwordResetToken|inviteToken)\b|\b(?:setPartnerResetToken|getPartnerByResetToken|setPartnerInviteToken|getPartnerByInviteToken|getUserByResetToken|getUserByVerificationToken|setPasswordResetToken|setVerificationToken)\s*\()/;
// Descriptor-based, O_NOFOLLOW cache I/O is allowed. Direct pathname sync
// reads/writes and destructive/replacing primitives are not.
const UNSAFE_OG_FS_PRIMITIVE = /\b(?:fs\.(?:readFileSync|writeFileSync)\s*\(\s*(?!fd\b)|fs\.(?:appendFileSync|rmSync|renameSync|copyFileSync)\s*\()/;

/** Explicit production ownership scope; no glob may silently shrink this gate. */
export const RVR03_PRODUCTION_SCOPE = [
  "scripts/reset-admin-password.ts",
  "server/services/auth-actions.ts",
  "server/replit_integrations/auth/replitAuth.ts",
  "server/replit_integrations/auth/storage.ts",
  "server/routes.ts",
  "server/routes/merchant-portal-invite.ts",
  "server/services/merchant-portal-invite.ts",
  "server/routes/merchants.ts",
  "server/routes/partner-orgs.ts",
  "server/routes/partners.ts",
  "server/storage/partners.ts",
  "client/src/lib/auth-action-fragment.ts",
  "client/src/pages/ActivatePortal.tsx",
  "client/src/pages/PartnerLogin.tsx",
  "client/src/pages/PartnerPortal.tsx",
  "client/src/pages/PartnerOrgDashboard.tsx",
  "client/src/pages/ResetPassword.tsx",
  "client/src/pages/VerifyEmail.tsx",
  "server/storage/audit.ts",
  "server/routes/activation.ts",
  "server/routes/og.ts",
  "server/utils/server-error.ts",
  "server/middleware/csrf.ts",
  "server/middleware/public-rate-limit.ts",
] as const;

export function loadRvr03ProductionScope(repoRoot = process.cwd()): Rvr03Source[] {
  const sources: Rvr03Source[] = [];
  for (const relativePath of RVR03_PRODUCTION_SCOPE) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      // Keep the requested path but use a non-string sentinel only through the
      // invalid-scope branch below; absence cannot become an empty successful scan.
      return [{ path: relativePath, content: undefined as unknown as string }];
    }
    sources.push({ path: relativePath, content: fs.readFileSync(absolutePath, "utf8") });
  }
  return sources;
}

const PRODUCTION_MINIMA: ReadonlyArray<{ path: string; pattern: RegExp; minimum: number }> = [
  { path: "server/services/auth-actions.ts", pattern: /\bissueAuthAction\s*\(/g, minimum: 1 },
  { path: "server/services/auth-actions.ts", pattern: /\bconsumeAuthAction(?:<[^>]+>)?\s*\(/g, minimum: 1 },
  { path: "server/services/auth-actions.ts", pattern: /\bisAuthActionValid\s*\(/g, minimum: 1 },
  { path: "client/src/lib/auth-action-fragment.ts", pattern: /window\.location\.hash/g, minimum: 2 },
  { path: "server/storage/audit.ts", pattern: /\bsanitizeChannelAuditEntry\s*\(/g, minimum: 2 },
  { path: "server/middleware/csrf.ts", pattern: /\bcsrf/gi, minimum: 1 },
  { path: "server/middleware/public-rate-limit.ts", pattern: /\brateLimit|rate.limit/gi, minimum: 1 },
];

function matchCount(content: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].length;
}

function linesMatching(content: string, pattern: RegExp): number[] {
  const flags = pattern.flags.replace("g", "");
  const oneLine = new RegExp(pattern.source, flags);
  return content.split(/\r?\n/).flatMap((line, index) => oneLine.test(line) ? [index + 1] : []);
}

function finding(path: string, rule: Rvr03Rule, line: number): Rvr03Finding {
  return { path, rule, line };
}

/**
 * Scan an explicit, non-empty source scope. Missing and zero-file scopes are
 * findings rather than successful no-ops, which prevents an empty glob or
 * failed scope collector from silently disabling this gate.
 */
export function scanRvr03SecurityStatic(scope?: readonly Rvr03Source[]): Rvr03Finding[] {
  if (!scope || scope.length === 0) {
    return [finding("<scope>", "RVR03_SCOPE_INVALID", 0)];
  }

  const findings: Rvr03Finding[] = [];
  const isFullProductionScope =
    scope.length === RVR03_PRODUCTION_SCOPE.length &&
    RVR03_PRODUCTION_SCOPE.every((expected) => scope.some((source) => source.path === expected));
  if (isFullProductionScope) {
    for (const invariant of PRODUCTION_MINIMA) {
      const source = scope.find((item) => item.path === invariant.path);
      if (!source || matchCount(source.content, invariant.pattern) < invariant.minimum) {
        findings.push(finding(invariant.path, "RVR03_SCOPE_INVALID", 0));
      }
    }
  }
  for (const source of scope) {
    if (!source.path || typeof source.content !== "string") {
      findings.push(finding(source.path || "<scope>", "RVR03_SCOPE_INVALID", 0));
      continue;
    }

    for (const line of linesMatching(source.content, LITERAL_CREDENTIAL_MAPPING)) {
      findings.push(finding(source.path, "RVR03_CREDENTIAL_LITERAL_MAPPING", line));
    }
    for (const line of linesMatching(source.content, FIXED_CREDENTIAL_OUTPUT)) {
      findings.push(finding(source.path, "RVR03_FIXED_CREDENTIAL_OUTPUT", line));
    }
    for (const line of linesMatching(source.content, QUERY_TOKEN_AUTH_LINK)) {
      findings.push(finding(source.path, "RVR03_QUERY_TOKEN_AUTH_LINK", line));
    }
    for (const line of linesMatching(source.content, RAW_CREDENTIAL_URL_OR_ERROR_LOG)) {
      findings.push(finding(source.path, "RVR03_RAW_CREDENTIAL_URL_OR_ERROR_LOG", line));
    }
    const ownsCredentialDiagnostics =
      source.path === "server/routes/partners.ts" ||
      source.path === "server/routes/partner-orgs.ts" ||
      source.path === "server/routes/merchant-portal-invite.ts" ||
      source.path === "server/services/merchant-portal-invite.ts";
    // server-error.ts is the sanctioned redacting adapter and is deliberately
    // not eligible for this direct-call rule.
    if (ownsCredentialDiagnostics) {
      for (const line of linesMatching(source.content, RAW_OPERATIONAL_DIAGNOSTIC_LOG)) {
        findings.push(finding(source.path, "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG", line));
      }
    }

    // The public endpoint's identity assertion must be adjacent to its narrow
    // validation call; accepting a generic auth helper here would widen trust.
    for (const line of linesMatching(source.content, PUBLIC_IDENTITY_VALIDATION)) {
      const neighborhood = source.content.split(/\r?\n/).slice(Math.max(0, line - 2), line + 1).join("\n");
      if (!/\bassertPublicIdentityScope\s*\(/.test(neighborhood)) {
        findings.push(finding(source.path, "RVR03_PUBLIC_IDENTITY_VALIDATION", line));
      }
    }

    const authorities = [...source.content.matchAll(TOKEN_AUTHORITY)];
    if (authorities.length > 1) {
      const offset = authorities[1].index ?? 0;
      const line = source.content.slice(0, offset).split(/\r?\n/).length;
      findings.push(finding(source.path, "RVR03_DUPLICATE_TOKEN_AUTHORITY", line));
    }

    if (source.path.startsWith("server/routes/")) {
      for (const line of linesMatching(source.content, ROUTE_LOCAL_TOKEN_AUTHORITY)) {
        findings.push(finding(source.path, "RVR03_ROUTE_LOCAL_TOKEN_AUTHORITY", line));
      }
    }
    if (GET_TOKEN_VALIDATION.test(source.content)) {
      const offset = source.content.search(GET_TOKEN_VALIDATION);
      findings.push(finding(source.path, "RVR03_GET_TOKEN_VALIDATION",
        source.content.slice(0, offset).split(/\r?\n/).length));
    }
    if (PUBLIC_VALIDATION_RESPONSE.test(source.content)) {
      const offset = source.content.search(PUBLIC_VALIDATION_RESPONSE);
      findings.push(finding(source.path, "RVR03_IDENTITY_BEARING_PUBLIC_VALIDATION_RESPONSE",
        source.content.slice(0, offset).split(/\r?\n/).length));
    }
    for (const line of linesMatching(source.content, QUERY_BEARER_READ)) {
      findings.push(finding(source.path, "RVR03_QUERY_BEARER_READ", line));
    }
    for (const line of linesMatching(source.content, PLAINTEXT_TEMPORARY_PASSWORD)) {
      findings.push(finding(source.path, "RVR03_PLAINTEXT_TEMPORARY_PASSWORD", line));
    }
    for (const line of linesMatching(source.content, MATH_RANDOM_CREDENTIAL)) {
      findings.push(finding(source.path, "RVR03_MATH_RANDOM_CREDENTIAL", line));
    }
    for (const line of linesMatching(source.content, LEGACY_TOKEN_BYPASS)) {
      findings.push(finding(source.path, "RVR03_LEGACY_TOKEN_FIELD_BYPASS", line));
    }
    if (
      source.path.startsWith("server/routes/") &&
      /\b(?:app|router)\.post\s*\(\s*["'`][^"'`]*\/(?:api\/auth|partner(?:-org)?\/(?:invite|activate|reset|verify))/i.test(source.content) &&
      (!/Cache-Control["']?\s*,\s*["']no-store/.test(source.content) || !/Referrer-Policy["']?\s*,\s*["']no-referrer/.test(source.content))
    ) {
      findings.push(finding(source.path, "RVR03_AUTH_POST_CACHE_CONTRACT", 0));
    }
    if (source.path === "server/routes/og.ts") {
      for (const line of linesMatching(source.content, UNSAFE_OG_FS_PRIMITIVE)) {
        findings.push(finding(source.path, "RVR03_UNSAFE_OG_FS_PRIMITIVE", line));
      }
    }
    for (const line of linesMatching(source.content, CHANNEL_AUDIT_WRITE)) {
      const neighborhood = source.content.split(/\r?\n/).slice(line - 1, line + 5).join("\n");
      if (!/\bsanitizeChannelAudit(?:Entry|Payload|Snapshot|Text)\s*\(/.test(neighborhood)) {
        findings.push(finding(source.path, "RVR03_UNSANITIZED_CHANNEL_AUDIT_WRITE", line));
      }
    }
  }

  return findings.sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));
}

function hasRule(scope: readonly Rvr03Source[], rule: Rvr03Rule): boolean {
  return scanRvr03SecurityStatic(scope).some((item) => item.rule === rule);
}

function run() {
  let passed = 0;
  let failed = 0;
  const check = (name: string, condition: boolean) => {
    if (condition) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.error(`  ✗ ${name}`);
    }
  };

  console.log("RVR-03 security static recurrence scanner:");
  check("missing scope fails closed", hasRule(undefined as unknown as Rvr03Source[], "RVR03_SCOPE_INVALID"));
  check("zero-file scope fails closed", hasRule([], "RVR03_SCOPE_INVALID"));
  check("literal credential mapping is rejected", hasRule(
    [{ path: "fixture/credential-map.ts", content: `const account = { password: "synthetic-only-value" };` }],
    "RVR03_CREDENTIAL_LITERAL_MAPPING",
  ));
  check("fixed credential output is rejected", hasRule(
    [{ path: "fixture/fixed-password.ts", content: `console.log("password", TEST_PASSWORD);` }],
    "RVR03_FIXED_CREDENTIAL_OUTPUT",
  ));
  check("query-token auth link is rejected", hasRule(
    [{ path: "fixture/reset-link.ts", content: `const url = "/reset?token=synthetic-only-token";` }],
    "RVR03_QUERY_TOKEN_AUTH_LINK",
  ));
  check("raw credential URL/error logging is rejected", hasRule(
    [{ path: "fixture/error-log.ts", content: `console.error("https://demo:synthetic-only-password@example.test");` }],
    "RVR03_RAW_CREDENTIAL_URL_OR_ERROR_LOG",
  ));
  check("caught error object logging is rejected", hasRule(
    [{ path: "server/routes/partners.ts", content: `try { work(); } catch (err) { console.error("failed", err); }` }],
    "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG",
  ));
  check("error message and provider result logging is rejected", hasRule(
    [{ path: "server/routes/partner-orgs.ts", content: `logger.warn("failed", error.message, result.error);` }],
    "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG",
  ));
  check("provider response logging is rejected", hasRule(
    [{ path: "server/services/merchant-portal-invite.ts", content: `console.error("delivery", providerResponse);` }],
    "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG",
  ));
  check("email interpolation logging is rejected", hasRule(
    [{ path: "server/routes/partners.ts", content: "console.warn(`delivery failed for ${email}`);" }],
    "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG",
  ));
  check("sanctioned operational diagnostic adapter owns its redacted sink", !hasRule(
    [{ path: "server/utils/server-error.ts", content: `console.error("Operational diagnostic", safePayload);` }],
    "RVR03_RAW_OPERATIONAL_DIAGNOSTIC_LOG",
  ));
  check("public identity validation requires its scoped assertion", hasRule(
    [{ path: "fixture/public-identity.ts", content: `validatePublicIdentity(input);` }],
    "RVR03_PUBLIC_IDENTITY_VALIDATION",
  ));
  check("duplicate token authority is rejected", hasRule(
    [{ path: "fixture/token-authority.ts", content: `verifyAccessToken(a);\nverifyAccessToken(b);` }],
    "RVR03_DUPLICATE_TOKEN_AUTHORITY",
  ));
  check("route-local crypto token authority is rejected", hasRule(
    [{ path: "server/routes/unsafe.ts", content: `const resetToken = crypto.randomBytes(32);` }],
    "RVR03_ROUTE_LOCAL_TOKEN_AUTHORITY",
  ));
  check("GET token validation is rejected", hasRule(
    [{ path: "server/routes/unsafe-get.ts", content: `app.get("/validate", async () => isAuthActionValid(token, purpose));` }],
    "RVR03_GET_TOKEN_VALIDATION",
  ));
  check("identity-bearing public validation response is rejected", hasRule(
    [{
      path: "server/routes/unsafe-validation.ts",
      content: `app.post("/validate", async (_req, res) => { await isAuthActionValid(token, purpose); res.json({ email: user.email }); });`,
    }],
    "RVR03_IDENTITY_BEARING_PUBLIC_VALIDATION_RESPONSE",
  ));
  check("query bearer reads are rejected", hasRule(
    [{ path: "client/src/pages/unsafe.tsx", content: `new URLSearchParams(window.location.search).get("token");` }],
    "RVR03_QUERY_BEARER_READ",
  ));
  check("plaintext temporary password is rejected", hasRule(
    [{ path: "fixture/temp-password.ts", content: `const temporaryPassword = "synthetic-only";` }],
    "RVR03_PLAINTEXT_TEMPORARY_PASSWORD",
  ));
  check("Math.random credential generation is rejected", hasRule(
    [{ path: "fixture/random-token.ts", content: `const resetToken = Math.random();` }],
    "RVR03_MATH_RANDOM_CREDENTIAL",
  ));
  check("legacy auth token field bypass is rejected", hasRule(
    [{ path: "server/replit_integrations/auth/storage.ts", content: `db.update(users).set({ resetToken: token });` }],
    "RVR03_LEGACY_TOKEN_FIELD_BYPASS",
  ));
  check("missing auth POST cache contract is rejected", hasRule(
    [{ path: "server/routes/unsafe.ts", content: `app.post("/api/auth/reset", async () => {});` }],
    "RVR03_AUTH_POST_CACHE_CONTRACT",
  ));
  check("unsafe OG synchronous fs primitive is rejected", hasRule(
    [{ path: "server/routes/og.ts", content: `fs.writeFileSync(file, data);` }],
    "RVR03_UNSAFE_OG_FS_PRIMITIVE",
  ));
  check("unsanitized channel-audit write is rejected", hasRule(
    [{ path: "fixture/channel-audit.ts", content: `db.insert(channelAuditLog).values(entry);` }],
    "RVR03_UNSANITIZED_CHANNEL_AUDIT_WRITE",
  ));

  const safeScope = [{
    path: "fixture/safe.ts",
    content: [
      "assertPublicIdentityScope(input);",
      "validatePublicIdentity(input);",
      "const token = verifyAccessToken(input);",
      "db.insert(channelAuditLog).values(sanitizeChannelAuditEntry(input));",
    ].join("\n"),
  }];
  const safeFindings = scanRvr03SecurityStatic(safeScope);
  check("narrow rules allow sanctioned callsites", safeFindings.length === 0);
  const diagnostics = JSON.stringify(scanRvr03SecurityStatic([
    { path: "fixture/redaction.ts", content: `const x = { password: "synthetic-never-print" };` },
  ]));
  check("findings redact matched source", !diagnostics.includes("synthetic-never-print"));
  const productionFindings = scanRvr03SecurityStatic(loadRvr03ProductionScope());
  check("explicit repository-owned production scope is nonzero and clean", productionFindings.length === 0);

  if (productionFindings.length > 0) {
    for (const item of productionFindings) {
      console.error(`  [${item.rule}] ${item.path}:${item.line}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}