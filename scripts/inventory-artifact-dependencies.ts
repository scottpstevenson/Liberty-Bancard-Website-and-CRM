#!/usr/bin/env tsx
/**
 * Produces a redacted, deterministic inventory of external Node modules
 * referenced by a built server artifact. No module is loaded or executed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { readJson } from "./dependency-policy-evidence";

// These imports are deliberately optional feature probes in bundled upstream
// code. They must remain visible in the evidence, but are not required
// production artifact dependencies and are absent from this lock graph.
const OPTIONAL_RUNTIME_PROBES = new Set(["pg-native", "supports-color"]);

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

export function artifactSpecifiers(source: string): string[] {
  const matches = source.matchAll(/\brequire\(\s*["']([^"'./][^"']*)["']\s*\)|\bimport\s+(?:[\w*$\s{},]+\s+from\s+)?["']([^"'./][^"']*)["']/g);
  return [...new Set([...matches]
    .map(match => packageName(match[1] ?? match[2]))
    .filter(name => name && !builtinModules.includes(name) && !name.startsWith("node:")))]
    .sort();
}

export function inventoryArtifactDependencies(distDirectory: string, lock: Record<string, any>): Record<string, unknown> {
  const artifact = path.join(distDirectory, "index.cjs");
  if (!existsSync(artifact)) throw new Error(`${artifact} not found; build the artifact before inventorying it`);
  const source = readFileSync(artifact, "utf8");
  const dependencies = artifactSpecifiers(source).map(name => {
    const record = lock.packages?.[`node_modules/${name}`];
    return {
      name,
      version: record?.version ?? null,
      integrity: record?.integrity ?? null,
      provenanceRecorded: Boolean(record?.resolved && record?.integrity),
      optionalRuntimeProbe: OPTIONAL_RUNTIME_PROBES.has(name),
    };
  });
  return {
    schemaVersion: 1,
    artifact: path.relative(process.cwd(), artifact),
    artifactSha256: createHash("sha256").update(source).digest("hex"),
    dependencies,
    optionalRuntimeProbes: dependencies.filter(item => item.optionalRuntimeProbe).map(item => item.name),
    unresolvedDependencies: dependencies
      .filter(item => !item.provenanceRecorded && !item.optionalRuntimeProbe)
      .map(item => item.name),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--dir");
  const outputFlag = args.indexOf("--output");
  const distDirectory = path.resolve(process.cwd(), dirFlag === -1 ? "dist" : (args[dirFlag + 1] || "dist"));
  const inventory = inventoryArtifactDependencies(distDirectory, readJson(path.join(process.cwd(), "package-lock.json")));
  const output = JSON.stringify(inventory, null, 2) + "\n";
  if (outputFlag !== -1) {
    const target = args[outputFlag + 1];
    if (!target) throw new Error("--output requires a path");
    writeFileSync(path.resolve(process.cwd(), target), output, { mode: 0o644 });
    console.log(`inventory-artifact-dependencies: wrote ${target}`);
  } else {
    console.log(output);
  }
  if ((inventory.unresolvedDependencies as string[]).length) {
    console.error("inventory-artifact-dependencies: FAIL — artifact has unprovenanced external dependencies");
    process.exitCode = 1;
  }
}

if (path.basename(process.argv[1] ?? "") === "inventory-artifact-dependencies.ts") main();