#!/usr/bin/env tsx
/**
 * Offline dependency-lock policy and evidence generator.
 *
 * This intentionally does not invoke npm, execute package lifecycle hooks, or
 * make network requests. It is safe to run before a build and after a locked
 * install.  `--strict-sources` is available for releases that require public
 * HTTPS tarball locations; existing mirror locations are reported separately
 * so their portability debt cannot be mistaken for a clean graph.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type Json = Record<string, any>;
type Finding = { severity: "error" | "warning"; code: string; detail: string };

export function readJson(file: string): Json {
  return JSON.parse(readFileSync(file, "utf8")) as Json;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dependencySections(pkg: Json): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
}

export function inspectLock(packageJson: Json, lock: Json, strictSources = false): Finding[] {
  const findings: Finding[] = [];
  if (lock.lockfileVersion !== 3) {
    findings.push({ severity: "error", code: "LOCKFILE_VERSION", detail: "package-lock.json must use lockfileVersion 3" });
  }
  const root = lock.packages?.[""];
  if (!root) {
    findings.push({ severity: "error", code: "LOCK_ROOT_MISSING", detail: "package-lock.json has no root package record" });
    return findings;
  }

  for (const [section, expected] of Object.entries(dependencySections(packageJson))) {
    const actual = dependencySections(root)[section];
    if (actual !== expected) {
      findings.push({
        severity: "error",
        code: "ROOT_SPEC_MISMATCH",
        detail: `${section} differs between package.json and package-lock.json`,
      });
    }
  }

  for (const [location, record] of Object.entries<Json>(lock.packages ?? {})) {
    if (!location || record.link) continue;
    if (!record.version) {
      findings.push({ severity: "error", code: "PACKAGE_VERSION_MISSING", detail: `${location} has no locked version` });
    }
    // npm lockfile v3 intentionally omits tarball provenance for files bundled
    // inside another published package. Their parent tarball's SRI is the
    // artifact boundary; treating these records as independent downloads
    // produces false failures for optional WASM/native bundles.
    if (record.inBundle === true) continue;
    if (!record.resolved || !record.integrity) {
      findings.push({ severity: "error", code: "PACKAGE_PROVENANCE_MISSING", detail: `${location} lacks resolved URL or integrity` });
      continue;
    }
    let resolved: URL;
    try {
      resolved = new URL(record.resolved);
    } catch {
      findings.push({ severity: "error", code: "RESOLVED_URL_INVALID", detail: `${location} has an invalid resolved URL` });
      continue;
    }
    if (resolved.protocol !== "https:") {
      findings.push({
        severity: strictSources ? "error" : "warning",
        code: "NON_HTTPS_TARBALL",
        detail: `${location} resolves through ${resolved.host}; strict portable releases require HTTPS`,
      });
    }
    if (resolved.protocol === "file:" || resolved.protocol === "git:" || resolved.protocol === "git+ssh:") {
      findings.push({ severity: "error", code: "NON_PORTABLE_SOURCE", detail: `${location} uses ${resolved.protocol}` });
    }
  }
  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail));
}

function nativeEvidence(directory: string): { lifecyclePackages: string[]; nativeBinaries: string[] } {
  if (!existsSync(directory)) return { lifecyclePackages: [], nativeBinaries: [] };
  const lifecyclePackages: string[] = [];
  const nativeBinaries: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === ".bin") continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || !entry.startsWith(".")) visit(full);
      } else if (entry === "package.json") {
        try {
          const pkg = readJson(full);
          if (["preinstall", "install", "postinstall", "prepare"].some(hook => pkg.scripts?.[hook])) {
            lifecyclePackages.push(path.relative(directory, path.dirname(full)));
          }
        } catch { /* malformed third-party metadata is inventory-only */ }
      } else if (entry.endsWith(".node")) {
        nativeBinaries.push(path.relative(directory, full));
      }
    }
  };
  visit(directory);
  return {
    lifecyclePackages: [...new Set(lifecyclePackages)].sort(),
    nativeBinaries: [...new Set(nativeBinaries)].sort(),
  };
}

export function buildEvidence(cwd = process.cwd(), strictSources = false): Json {
  const pkg = readJson(path.join(cwd, "package.json"));
  const lockPath = path.join(cwd, "package-lock.json");
  const lockText = readFileSync(lockPath, "utf8");
  const lock = JSON.parse(lockText) as Json;
  const packages = Object.entries<Json>(lock.packages ?? {}).filter(([location]) => location !== "");
  const sourceHosts = [...new Set(packages.map(([, item]) => {
    if (item.inBundle === true) return "bundled";
    try { return item.resolved ? new URL(item.resolved).host : "missing"; } catch { return "invalid"; }
  }))].sort();
  const evidence = nativeEvidence(path.join(cwd, "node_modules"));
  return {
    schemaVersion: 1,
    lockfile: { version: lock.lockfileVersion, sha256: sha256(lockText), packageCount: packages.length, sourceHosts },
    toolchain: { node: process.version, npmUserAgent: process.env.npm_config_user_agent ?? null },
    installPolicy: { command: "npm ci --include=dev --ignore-scripts --no-audit --no-fund", lifecycleHooksExecuted: false },
    nativeAndLifecycleEvidence: evidence,
    findings: inspectLock(pkg, lock, strictSources),
  };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const strictSources = args.has("--strict-sources");
  const outputIndex = process.argv.indexOf("--output");
  const evidence = buildEvidence(process.cwd(), strictSources);
  const output = JSON.stringify(evidence, null, 2) + "\n";
  if (outputIndex !== -1) {
    const target = process.argv[outputIndex + 1];
    if (!target) throw new Error("--output requires a path");
    writeFileSync(path.resolve(process.cwd(), target), output, { mode: 0o644 });
    console.log(`dependency-policy-evidence: wrote ${target}`);
  } else {
    console.log(output);
  }
  const errors = evidence.findings.filter((finding: Finding) => finding.severity === "error");
  if (errors.length) {
    console.error(`dependency-policy-evidence: FAIL — ${errors.length} policy error(s)`);
    process.exitCode = 1;
  } else {
    console.log(`dependency-policy-evidence: PASS — ${evidence.lockfile.packageCount} locked packages fingerprinted`);
  }
}

if (path.basename(process.argv[1] ?? "") === "dependency-policy-evidence.ts") main();