#!/usr/bin/env npx tsx
/**
 * CRO-03D minimum operator tooling: scope derivation + ephemeral signing helper.
 *
 * This tool performs NO live I/O. It never touches provider secrets, the
 * database, or any HTTP endpoint. It only:
 *   1. derives a redacted, deterministic scope summary from repo/code facts
 *      (git SHA/tree, migration head, recipe/stage-plan hash, commercial caps);
 *   2. generates a temporary local-only Ed25519 signing keypair, per Task
 *      #1738 Section 10 (never written to the repo, secrets, or env);
 *   3. builds and signs the four approval artifacts (operator/data/finance/
 *      legal) using the *exact* payload shape verified by
 *      server/services/cro03/approval-artifact.ts, so a signed artifact from
 *      this tool is guaranteed importable by the real admin API;
 *   4. securely disposes of the private key material on request, recording
 *      destruction evidence.
 *
 * Deployment-inventory generation is intentionally NOT included here: its
 * payload requires live fleet/topology facts (worker identities, queue
 * topology hash) that only exist once this release is actually deployed
 * (Task #1738 Section 15). Build that once a target deployment exists.
 *
 * Usage:
 *   npx tsx scripts/cro03d-ceremony.ts scope [--out FILE]
 *   npx tsx scripts/cro03d-ceremony.ts keygen [--dir DIR]
 *   npx tsx scripts/cro03d-ceremony.ts prepare --scope FILE --approved
 *   npx tsx scripts/cro03d-ceremony.ts sign --keydir DIR --prepared FILE --out FILE
 *   npx tsx scripts/cro03d-ceremony.ts dispose-key --keydir DIR
 */
import { execSync } from "node:child_process";
import { generateKeyPairSync, sign as ed25519Sign, createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRO03C_CURRENT_MIGRATION_HEAD, CRO03C_INITIAL_ROLLOUT_KEY, stableCro03RecipeHash,
} from "../server/services/cro03/contracts";
import { CRO03B_UNIFIED_RECIPE } from "../server/services/cro03/recipe-contract";
import {
  CRO03C_APPROVAL_ARTIFACT_VERSION, CRO03C_APPROVAL_DIMENSIONS, canonicalCro03cApprovalPayload,
  type Cro03cApprovalDimension, type Cro03cSignedApprovalPayload, type Cro03cSignedApprovalArtifact,
} from "../server/services/cro03/approval-artifact";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Owner-approved commercial scope (Task #1738 Section 13). These are the
// figures presented to and confirmed by the owner in chat: a $150 hard
// spend ceiling, a <=100-record initial cohort, and a <=10-unit-per-provider
// canary cap. Keep this the single source of truth so `scope` cannot drift
// from what was actually approved.
// ---------------------------------------------------------------------------
export const CRO03D_APPROVED_COHORT_CAP = 100;
export const CRO03D_APPROVED_CANARY_CAP_PER_PROVIDER = 10;
export const CRO03D_APPROVED_MAX_SPEND_MICROS = 150_000_000; // $150.00 in USD micros

export interface Cro03dRedactedScope {
  releaseSha: string;
  releaseTree: string;
  migrationHead: string;
  recipeStagePlanHash: string;
  rolloutKey: string;
  providersInScope: readonly string[];
  cohortCap: number;
  canaryCapPerProvider: number;
  maxSpendMicros: number;
  currency: "USD";
  derivedAt: string;
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: join(__dirname, ".."), encoding: "utf8" }).trim();
}

/** No secrets, no PII, no provider keys, no infrastructure identifiers. */
export function deriveCro03dScope(now: Date = new Date()): Cro03dRedactedScope {
  const releaseSha = git("rev-parse HEAD");
  const releaseTree = git("rev-parse HEAD^{tree}");
  const stagePlanHash = stableCro03RecipeHash(
    CRO03B_UNIFIED_RECIPE.steps.map((step) => ({ id: step.id, provider: step.provider, operation: step.operation })),
  );
  const providersInScope = [...new Set(
    CRO03B_UNIFIED_RECIPE.steps.map((step) => step.provider).filter((p) => ["apollo", "serper", "outscraper", "openai", "zerobounce"].includes(p)),
  )].sort();
  return {
    releaseSha, releaseTree, migrationHead: CRO03C_CURRENT_MIGRATION_HEAD, recipeStagePlanHash: stagePlanHash,
    rolloutKey: CRO03C_INITIAL_ROLLOUT_KEY, providersInScope, cohortCap: CRO03D_APPROVED_COHORT_CAP,
    canaryCapPerProvider: CRO03D_APPROVED_CANARY_CAP_PER_PROVIDER, maxSpendMicros: CRO03D_APPROVED_MAX_SPEND_MICROS,
    currency: "USD", derivedAt: now.toISOString(),
  };
}

export function scopeHash(scope: Cro03dRedactedScope): string {
  return stableCro03RecipeHash(scope);
}

/** Deterministically builds the four unsigned approval payloads sharing one scope hash. */
export function buildUnsignedApprovalPayloads(
  scope: Cro03dRedactedScope, issuerId: string, validityMs: number = 24 * 3600 * 1000,
): Record<Cro03cApprovalDimension, Cro03cSignedApprovalPayload> {
  const issuedAt = new Date(scope.derivedAt);
  const expiresAt = new Date(issuedAt.getTime() + validityMs);
  const hash = scopeHash(scope);
  const out = {} as Record<Cro03cApprovalDimension, Cro03cSignedApprovalPayload>;
  for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
    out[dimension] = {
      artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
      receiptId: randomUUID(),
      idempotencyKey: `cro03d-${dimension}-${scope.releaseSha}`,
      issuerId,
      dimension,
      scope: scope as unknown as Record<string, unknown>,
      scopeHash: hash,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }
  return out;
}

function keyPaths(dir: string) {
  return { priv: join(dir, "cro03d-ephemeral-ed25519.pem"), pub: join(dir, "cro03d-ephemeral-ed25519.pub") };
}

/** Generates the ephemeral local-only signing key. Never returns/logs the private key material. */
export function cmdKeygen(dir?: string): { dir: string; publicKeyPem: string } {
  const keyDir = dir ?? mkdtempSync(join(tmpdir(), "cro03d-signing-"));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { priv, pub } = keyPaths(keyDir);
  writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
  chmodSync(keyDir, 0o700);
  return { dir: keyDir, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

/** Signs one approval payload with the ephemeral private key at keyDir. */
export function signApprovalPayload(keyDir: string, payload: Cro03cSignedApprovalPayload): Cro03cSignedApprovalArtifact {
  const { priv } = keyPaths(keyDir);
  if (!existsSync(priv)) throw new Error("CRO03D_SIGNING_KEY_MISSING");
  const privateKey = readFileSync(priv, "utf8");
  const signature = ed25519Sign(null, Buffer.from(canonicalCro03cApprovalPayload(payload), "utf8"), privateKey);
  return { payload, signature: signature.toString("base64") };
}

/** Overwrites and deletes private key material; returns a destruction-evidence record. */
export function disposeSigningKey(keyDir: string): { destroyedAt: string; keyDigestBeforeDestruction: string } {
  const { priv, pub } = keyPaths(keyDir);
  if (!existsSync(priv)) throw new Error("CRO03D_SIGNING_KEY_MISSING");
  const contents = readFileSync(priv);
  const keyDigestBeforeDestruction = createHash("sha256").update(contents).digest("hex");
  // Best-effort overwrite before unlink; not a guarantee on all filesystems,
  // but strictly better than a bare unlink, and the private key never leaves
  // this local temp directory to begin with.
  writeFileSync(priv, Buffer.alloc(contents.length, 0));
  unlinkSync(priv);
  if (existsSync(pub)) unlinkSync(pub);
  try { rmdirSync(keyDir); } catch { /* directory may hold other operator files; not fatal */ }
  return { destroyedAt: new Date().toISOString(), keyDigestBeforeDestruction };
}

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) continue;
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) { flags[key] = next; i++; } else { flags[key] = true; }
  }
  return { cmd, flags };
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === "scope") {
    const scope = deriveCro03dScope();
    const summary = { ...scope, scopeHash: scopeHash(scope) };
    console.log("=== CRO-03D redacted scope summary (no secrets, no PII) ===");
    console.log(JSON.stringify(summary, null, 2));
    if (typeof flags.out === "string") writeFileSync(flags.out, JSON.stringify(summary, null, 2));
    return;
  }
  if (cmd === "keygen") {
    const { dir, publicKeyPem } = cmdKeygen(typeof flags.dir === "string" ? flags.dir : undefined);
    console.log(`Ephemeral Ed25519 keypair generated at ${dir} (private key never printed).`);
    console.log("Public key (safe to record):");
    console.log(publicKeyPem);
    return;
  }
  if (cmd === "prepare") {
    if (!flags.approved) {
      console.error("Refusing to prepare signable artifacts without --approved (owner must approve the scope first).");
      process.exitCode = 1;
      return;
    }
    if (typeof flags.scope !== "string") throw new Error("--scope FILE is required");
    const scope: Cro03dRedactedScope = JSON.parse(readFileSync(flags.scope, "utf8"));
    const issuerId = typeof flags.issuer === "string" ? flags.issuer : "cro03d-operator";
    const payloads = buildUnsignedApprovalPayloads(scope, issuerId);
    const out = typeof flags.out === "string" ? flags.out : "cro03d-prepared-artifacts.json";
    writeFileSync(out, JSON.stringify(payloads, null, 2));
    console.log(`Prepared 4 unsigned approval payloads (operator/data/finance/legal) -> ${out}`);
    return;
  }
  if (cmd === "sign") {
    if (typeof flags.keydir !== "string" || typeof flags.prepared !== "string") {
      throw new Error("--keydir DIR and --prepared FILE are required");
    }
    const payloads: Record<Cro03cApprovalDimension, Cro03cSignedApprovalPayload> = JSON.parse(readFileSync(flags.prepared, "utf8"));
    const signed = {} as Record<Cro03cApprovalDimension, Cro03cSignedApprovalArtifact>;
    for (const dimension of CRO03C_APPROVAL_DIMENSIONS) signed[dimension] = signApprovalPayload(flags.keydir, payloads[dimension]);
    const out = typeof flags.out === "string" ? flags.out : "cro03d-signed-artifacts.json";
    writeFileSync(out, JSON.stringify(signed, null, 2));
    console.log(`Signed 4 approval artifacts -> ${out}`);
    return;
  }
  if (cmd === "dispose-key") {
    if (typeof flags.keydir !== "string") throw new Error("--keydir DIR is required");
    const evidence = disposeSigningKey(flags.keydir);
    console.log("Signing key destroyed. Evidence:");
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  console.error("Unknown command. Use: scope | keygen | prepare | sign | dispose-key");
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error); process.exitCode = 1; });
