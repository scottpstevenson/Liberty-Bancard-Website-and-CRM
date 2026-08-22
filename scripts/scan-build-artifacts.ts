#!/usr/bin/env tsx
/**
 * Redacting production-build artifact scanner.
 *
 * Scans dist/index.cjs plus every HTML, JS, CSS, JSON, and source-map file
 * under dist/public. Findings intentionally print only a path and a rule ID:
 * matched credential values are never written to stdout or stderr.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCANNED_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".html", ".css", ".json", ".map"]);
const SECRET_ENV_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "DATABASE_URL",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GITHUB_TOKEN",
  "MERCHANT_DATA_ENCRYPTION_KEY",
  "REDIS_URL",
  "SESSION_SECRET",
  "SMTP_PASS",
] as const;

const DETECTION_RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: "PRIVATE_KEY_BLOCK", pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/ },
  { id: "GITHUB_TOKEN", pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/ },
  { id: "AWS_ACCESS_KEY", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  {
    id: "EMBEDDED_CREDENTIAL_ASSIGNMENT",
    // Do not treat a generic "Token" label as a credential: bundled HTTP
    // parsing code commonly uses it for an auth scheme. Concrete sensitive
    // field names still catch conventional embedded configuration values.
    pattern: /\b(?:api[_-]?key|client[_-]?secret|password|secret|access[_-]?token|private[_-]?token)\b\s*(?:=|:)\s*["'][^"'\r\n]{12,}["']/i,
  },
  { id: "DATABASE_URL_WITH_PASSWORD", pattern: /\b(?:postgres(?:ql)?|mysql):\/\/[^:\s"'\\]+:[^@\s"'\\]+@/i },
];

export interface ArtifactFinding {
  path: string;
  rule: string;
}

function listArtifactFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listArtifactFiles(fullPath));
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

export function scanBuildArtifacts(distDirectory: string): ArtifactFinding[] {
  const files = [
    path.join(distDirectory, "index.cjs"),
    ...listArtifactFiles(path.join(distDirectory, "public")),
  ].filter((file, index, all) => existsSync(file) && all.indexOf(file) === index);

  const findings: ArtifactFinding[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const rule of DETECTION_RULES) {
      if (rule.pattern.test(content)) {
        findings.push({ path: file, rule: rule.id });
      }
      rule.pattern.lastIndex = 0;
    }
    for (const envKey of SECRET_ENV_KEYS) {
      const value = process.env[envKey];
      if (value && value.length >= 8 && content.includes(value)) {
        findings.push({ path: file, rule: `ENV_VALUE_${envKey}` });
      }
    }
  }

  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}

function main(): void {
  const dirFlag = process.argv.indexOf("--dir");
  const distDirectory = path.resolve(
    process.cwd(),
    dirFlag === -1 ? "dist" : (process.argv[dirFlag + 1] || "dist"),
  );
  const findings = scanBuildArtifacts(distDirectory);

  if (findings.length === 0) {
    console.log("scan-build-artifacts: PASS — no credential patterns found in production artifacts");
    return;
  }

  console.error(`scan-build-artifacts: FAIL — ${findings.length} redacted finding(s):`);
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${path.relative(process.cwd(), finding.path)}`);
  }
  process.exitCode = 1;
}

main();
