import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  CRO03D_APPROVED_CANARY_CAP_PER_PROVIDER, CRO03D_APPROVED_COHORT_CAP, CRO03D_APPROVED_MAX_SPEND_MICROS,
  buildUnsignedApprovalPayloads, cmdKeygen, deriveCro03dScope, disposeSigningKey, scopeHash, signApprovalPayload,
} from "./cro03d-ceremony";
import { CRO03C_APPROVAL_DIMENSIONS, verifyCro03cApprovalArtifact } from "../server/services/cro03/approval-artifact";

function mustThrow(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: any) => error?.message === code);
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  PASS ${name}`); } catch (error) {
    failures++;
    console.error(`  FAIL ${name}:`, error instanceof Error ? error.message : error);
  }
}

console.log("=== CRO-03D ceremony tool static tests ===");

// --- Scope derivation: deterministic, redacted, matches approved commercial caps ---
check("scope derivation is deterministic for a fixed instant", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const a = deriveCro03dScope(now);
  const b = deriveCro03dScope(now);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.derivedAt, now.toISOString());
});

check("scope carries exactly the owner-approved commercial caps", () => {
  const scope = deriveCro03dScope();
  assert.equal(scope.cohortCap, CRO03D_APPROVED_COHORT_CAP);
  assert.equal(scope.cohortCap <= 100, true, "cohort cap must respect Section 19's 1-100 bound");
  assert.equal(scope.canaryCapPerProvider, CRO03D_APPROVED_CANARY_CAP_PER_PROVIDER);
  assert.equal(scope.maxSpendMicros, CRO03D_APPROVED_MAX_SPEND_MICROS);
  assert.equal(scope.currency, "USD");
});

check("scope output contains no secret-shaped or credential-shaped values", () => {
  const scope = deriveCro03dScope();
  const json = JSON.stringify(scope);
  // Never a provider API key, DB/Redis URL, or anything resembling one.
  assert.doesNotMatch(json, /(sk-|postgres:\/\/|redis:\/\/|rediss:\/\/|api[_-]?key|secret|password)/i);
  // Only the fixed, known-safe set of top-level keys — nothing extra sneaks in.
  assert.deepEqual(
    Object.keys(scope).sort(),
    ["canaryCapPerProvider", "cohortCap", "currency", "derivedAt", "maxSpendMicros", "migrationHead",
      "providersInScope", "recipeStagePlanHash", "releaseSha", "releaseTree", "rolloutKey"].sort(),
  );
});

check("scopeHash changes when any scoped fact changes", () => {
  const scope = deriveCro03dScope();
  const h1 = scopeHash(scope);
  const h2 = scopeHash({ ...scope, cohortCap: scope.cohortCap - 1 });
  assert.notEqual(h1, h2);
  assert.equal(scopeHash(scope), h1, "hash must be stable for identical input");
});

// --- Approval payload construction: idempotency + shared scope hash ---
check("prepared approval payloads share one scope hash and cover all four dimensions", () => {
  const scope = deriveCro03dScope();
  const payloads = buildUnsignedApprovalPayloads(scope, "cro03d-test-issuer");
  const dims = Object.keys(payloads).sort();
  assert.deepEqual(dims, [...CRO03C_APPROVAL_DIMENSIONS].sort());
  const hashes = new Set(Object.values(payloads).map((p) => p.scopeHash));
  assert.equal(hashes.size, 1, "all four artifacts must share one scope hash");
});

check("re-deriving from the same scope is idempotent (stable idempotencyKey)", () => {
  const scope = deriveCro03dScope(new Date("2026-01-01T00:00:00.000Z"));
  const first = buildUnsignedApprovalPayloads(scope, "issuer-a");
  const second = buildUnsignedApprovalPayloads(scope, "issuer-a");
  for (const dim of CRO03C_APPROVAL_DIMENSIONS) {
    assert.equal(first[dim].idempotencyKey, second[dim].idempotencyKey);
  }
});

// --- Signing round-trip: must verify against the REAL admin-side verifier ---
let keyDir = "";
check("signed artifact round-trips through the canonical verifier", () => {
  keyDir = mkdtempSync(join(tmpdir(), "cro03d-test-key-"));
  const { dir } = cmdKeygen(keyDir);
  const scope = deriveCro03dScope();
  const payloads = buildUnsignedApprovalPayloads(scope, "cro03d-test-issuer");
  const artifact = signApprovalPayload(dir, payloads.operator);
  const publicKeyPem = readFileSync(join(dir, "cro03d-ephemeral-ed25519.pub"), "utf8");
  process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS = JSON.stringify({ "cro03d-test-issuer": publicKeyPem });
  const verified = verifyCro03cApprovalArtifact(artifact);
  assert.equal(verified.receiptId, payloads.operator.receiptId);
  delete process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS;
});

check("tampering with a signed payload after signing is rejected by the canonical verifier", () => {
  assert.ok(keyDir, "requires the signing round-trip test to have run first");
  const scope = deriveCro03dScope();
  const payloads = buildUnsignedApprovalPayloads(scope, "cro03d-test-issuer");
  const artifact = signApprovalPayload(keyDir, payloads.data);
  const publicKeyPem = readFileSync(join(keyDir, "cro03d-ephemeral-ed25519.pub"), "utf8");
  process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS = JSON.stringify({ "cro03d-test-issuer": publicKeyPem });
  const tampered = { ...artifact, payload: { ...artifact.payload, dimension: "finance" as const } };
  mustThrow(() => verifyCro03cApprovalArtifact(tampered), "CRO03C_APPROVAL_SIGNATURE_INVALID");
  delete process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS;
});

// --- Key disposal: destroys the private key and leaves evidence ---
check("dispose-key destroys the private key material and returns destruction evidence", () => {
  assert.ok(keyDir);
  const privPath = join(keyDir, "cro03d-ephemeral-ed25519.pem");
  assert.ok(existsSync(privPath), "private key must exist before disposal");
  const evidence = disposeSigningKey(keyDir);
  assert.ok(/^[0-9a-f]{64}$/.test(evidence.keyDigestBeforeDestruction));
  assert.ok(Number.isFinite(new Date(evidence.destroyedAt).getTime()));
  assert.equal(existsSync(privPath), false, "private key file must be gone");
  assert.equal(existsSync(keyDir), false, "temp key directory must be gone");
  mustThrow(() => disposeSigningKey(keyDir), "CRO03D_SIGNING_KEY_MISSING");
});

// --- CLI gate enforcement: `prepare` must refuse without explicit owner approval ---
check("CLI `prepare` refuses to build signable artifacts without --approved", () => {
  const scopeFile = join(mkdtempSync(join(tmpdir(), "cro03d-test-scope-")), "scope.json");
  writeFileSync(scopeFile, JSON.stringify(deriveCro03dScope()));
  let threw = false;
  try {
    execFileSync("npx", ["tsx", "scripts/cro03d-ceremony.ts", "prepare", "--scope", scopeFile], {
      cwd: join(__dirname, ".."), stdio: "pipe",
    });
  } catch (error: any) {
    threw = true;
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /Refusing to prepare signable artifacts without --approved/);
  }
  assert.ok(threw, "CLI must exit non-zero and print a refusal without --approved");
  rmSync(join(scopeFile, ".."), { recursive: true, force: true });
});

console.log(failures === 0 ? "\nALL CRO-03D CEREMONY TOOL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
if (failures > 0) process.exitCode = 1;
