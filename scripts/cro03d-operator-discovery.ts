/**
 * CRO-03D operator discovery (dry-run, read-only, NO live provider I/O).
 *
 * Derives the facts an operator ceremony needs before requesting any owner
 * action: exact release identity, migration head, provider secret PRESENCE
 * (never values), production pause state, and singleton (`cro03c_initial_v1`)
 * existence. Prints a redacted structured JSON report and exits non-zero if
 * anything ambiguous/unsafe is detected (fail-closed).
 *
 * This module performs ZERO writes, ZERO provider API calls, and ZERO
 * deployment or singleton mutation. It exists purely to answer: "what does
 * the owner actually need to do next?" per CRO-03D step 1 / section 8.
 *
 * All I/O (git, db, pause authority) is injected via `Cro03dDiscoveryDeps` so
 * this module can be exercised by a genuinely static/deterministic test
 * (scripts/test-cro03d-operator-discovery.ts) without a live database or git
 * checkout, and so the "no provider network I/O" property is structural
 * (this module never imports `fetch`/`undici`/any provider client), not just
 * self-declared.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CRO03C_INITIAL_ROLLOUT_KEY,
  CRO03C_MIGRATION_HEAD,
  CRO03C_PROVIDER_CONTRACTS,
} from "../server/services/cro03/live-execution";
import { PROVIDER_SOURCE_MANIFEST } from "../server/services/provider-manifest";

/**
 * The journal is NOT a reliable positional/count proof of what has been
 * applied: this repo's migrator baselines a consolidated snapshot migration
 * and records some guarded migrations' hashes directly without ever adding a
 * journal entry (see scripts/check-migration-integrity.ts). A row-count or
 * journal-position comparison against `drizzle.__drizzle_migrations` can
 * therefore pass even when the CRO-03C migration head was never applied. The
 * only sound proof is the exact SHA-256 content hash the migrator itself
 * records — computed with the SAME algorithm as `computeMigrationHash` in
 * server/db-migrate.ts (guarded/ folder first, else migrations/ root; sha256
 * of the raw utf8 file content) — existing as a row in the ledger.
 */
export function requiredMigrationHash(): string {
  const guardedPath = new URL(`../migrations/guarded/${CRO03C_MIGRATION_HEAD}.sql`, import.meta.url);
  const rootPath = new URL(`../migrations/${CRO03C_MIGRATION_HEAD}.sql`, import.meta.url);
  let content: string;
  try {
    content = readFileSync(guardedPath, "utf8");
  } catch {
    content = readFileSync(rootPath, "utf8");
  }
  return createHash("sha256").update(content).digest("hex");
}

// cro03c provider key -> provider-manifest id (for secretNames lookup).
// internal_source has no manifest entry: it never calls an external provider.
const CRO03C_TO_MANIFEST_ID: Readonly<Record<string, string | null>> = {
  internal_source: null,
  first_party_web: "first_party_web",
  rdap: "rdap",
  jsonld: "jsonld",
  serper: "serper",
  outscraper: "outscraper",
  openai: "openai_classification",
  apollo: "apollo",
  zerobounce: "zerobounce",
};

export interface Cro03dReleaseIdentity {
  sha: string;
  tree: string;
  dirty: boolean;
}

export interface Cro03dMigrationStatus {
  expected: string;
  expectedHash: string;
  readable: boolean;
  matches: boolean;
  errorKind?: string;
}

export interface Cro03dPauseStatus {
  readable: boolean;
  state?: string;
  source?: string;
  errorKind?: string;
}

export interface Cro03dSingletonStatus {
  readable: boolean;
  key: string;
  exists?: boolean;
  state?: string | null;
  errorKind?: string;
}

export interface Cro03dSecretPresenceEntry {
  manifestId: string | null;
  secretNames: string[];
  allPresent: boolean;
}

export interface Cro03dDiscoveryDeps {
  /** Returns exact git release identity. Never shells out to a network. */
  getReleaseIdentity: () => Cro03dReleaseIdentity;
  /** Reads current process env for secret PRESENCE only (never returns values). */
  getEnv: () => NodeJS.ProcessEnv;
  /** Returns true iff a row with the given exact content hash exists in the ledger. */
  hasMigrationHash: (hash: string) => Promise<boolean>;
  /** Reads canonical outbound pause state. */
  getPauseState: () => Promise<{ state: string; source: string }>;
  /** Reads whether the cro03c_initial_v1 singleton row exists, and its state if so. */
  getSingletonRow: () => Promise<{ state: string } | null>;
}

function realReleaseIdentity(): Cro03dReleaseIdentity {
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  const sha = git("rev-parse HEAD");
  const tree = git("rev-parse HEAD^{tree}");
  const dirty = git("status --porcelain").length > 0;
  return { sha, tree, dirty };
}

async function realHasMigrationHash(hash: string): Promise<boolean> {
  const { db } = await import("../server/db");
  const result: any = await db.execute(
    sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1`
  );
  const rows = result?.rows ?? result ?? [];
  return rows.length > 0;
}

async function realPauseState(): Promise<{ state: string; source: string }> {
  const { getPauseState } = await import("../server/services/outbound-pause-authority");
  const state = await getPauseState();
  return { state: state.state, source: state.source };
}

async function realSingletonRow(): Promise<{ state: string } | null> {
  const { db } = await import("../server/db");
  const result: any = await db.execute(
    sql`SELECT state FROM cro03c_initial_rollouts WHERE rollout_key = ${CRO03C_INITIAL_ROLLOUT_KEY}`
  );
  const rows = result?.rows ?? result ?? [];
  return rows.length > 0 ? { state: String(rows[0].state) } : null;
}

/** Real dependency set (used only by the direct CLI run, never by static tests). */
export const REAL_CRO03D_DEPS: Cro03dDiscoveryDeps = {
  getReleaseIdentity: realReleaseIdentity,
  getEnv: () => process.env,
  hasMigrationHash: realHasMigrationHash,
  getPauseState: realPauseState,
  getSingletonRow: realSingletonRow,
};

export function deriveSecretPresence(env: NodeJS.ProcessEnv): Record<string, Cro03dSecretPresenceEntry> {
  const out: Record<string, Cro03dSecretPresenceEntry> = {};
  for (const provider of Object.keys(CRO03C_PROVIDER_CONTRACTS)) {
    const manifestId = CRO03C_TO_MANIFEST_ID[provider] ?? null;
    if (!manifestId) {
      out[provider] = { manifestId: null, secretNames: [], allPresent: true };
      continue;
    }
    const row = PROVIDER_SOURCE_MANIFEST.find((r) => r.id === manifestId);
    const secretNames = row ? [...row.secretNames] : [];
    // Presence only — never read or print the value.
    const allPresent = secretNames.every((name) => Boolean(env[name]));
    out[provider] = { manifestId, secretNames, allPresent };
  }
  return out;
}

export interface Cro03dDiscoveryReport {
  noLiveIO: true;
  generatedAt: string;
  release: Cro03dReleaseIdentity;
  migration: Cro03dMigrationStatus;
  pause: Cro03dPauseStatus;
  singleton: Cro03dSingletonStatus;
  providerSecretPresence: Record<string, Cro03dSecretPresenceEntry>;
  missingSecretsByProvider: { provider: string; missing: string[] }[];
  ready: {
    cleanTree: boolean;
    migrationReadable: boolean;
    migrationHeadMatches: boolean;
    pauseReadable: boolean;
    pausedAsRequired: boolean;
    singletonAbsent: boolean;
    noMissingSecrets: boolean;
  };
}

/**
 * Pure(ish) orchestration: every external effect is read via `deps`, so this
 * function is fully deterministic and testable without a live database, git
 * checkout, or network — and, structurally, this module never imports a
 * provider client, `fetch`, or `undici`, so it cannot perform provider I/O.
 */
export async function runCro03dDiscovery(deps: Cro03dDiscoveryDeps = REAL_CRO03D_DEPS): Promise<Cro03dDiscoveryReport> {
  const env = deps.getEnv();
  const release = deps.getReleaseIdentity();
  const providerSecretPresence = deriveSecretPresence(env);

  const expectedHash = requiredMigrationHash();
  let migration: Cro03dMigrationStatus;
  try {
    const present = await deps.hasMigrationHash(expectedHash);
    migration = { expected: CRO03C_MIGRATION_HEAD, expectedHash, readable: true, matches: present };
  } catch {
    // Errors are intentionally NOT surfaced verbatim: exception text from a
    // database driver can embed connection strings, hostnames, or other
    // sensitive detail. Only an opaque, non-identifying kind is reported.
    migration = { expected: CRO03C_MIGRATION_HEAD, expectedHash, readable: false, matches: false, errorKind: "migration_ledger_unreadable" };
  }

  let pause: Cro03dPauseStatus;
  try {
    const state = await deps.getPauseState();
    pause = { readable: true, state: state.state, source: state.source };
  } catch {
    pause = { readable: false, errorKind: "pause_state_unreadable" };
  }

  let singleton: Cro03dSingletonStatus;
  try {
    const row = await deps.getSingletonRow();
    singleton = { readable: true, key: CRO03C_INITIAL_ROLLOUT_KEY, exists: row !== null, state: row?.state ?? null };
  } catch {
    singleton = { readable: false, key: CRO03C_INITIAL_ROLLOUT_KEY, errorKind: "singleton_unreadable" };
  }

  const missingSecretsByProvider = Object.entries(providerSecretPresence)
    .filter(([, v]) => !v.allPresent)
    .map(([provider, v]) => ({ provider, missing: v.secretNames.filter((n) => !env[n]) }));

  const report: Cro03dDiscoveryReport = {
    noLiveIO: true,
    generatedAt: new Date().toISOString(),
    release,
    migration,
    pause,
    singleton,
    providerSecretPresence,
    missingSecretsByProvider,
    ready: {
      cleanTree: !release.dirty,
      migrationReadable: migration.readable,
      migrationHeadMatches: migration.readable && migration.matches,
      pauseReadable: pause.readable,
      pausedAsRequired: pause.readable === true && pause.state === "paused",
      singletonAbsent: singleton.readable === true && singleton.exists === false,
      noMissingSecrets: missingSecretsByProvider.length === 0,
    },
  };

  return report;
}

function redactedErrorReport() {
  // Deliberately omits the caught exception's message/stack: driver errors
  // can embed connection strings, hostnames, or other sensitive detail, and
  // this report must stay safe to paste into chat, logs, or a packet.
  return {
    noLiveIO: true,
    generatedAt: new Date().toISOString(),
    blocked: true,
    reason: "CRO03D_DISCOVERY_UNHANDLED_ERROR",
  };
}

async function main() {
  const report = await runCro03dDiscovery();
  console.log(JSON.stringify(report, null, 2));
  const technicalGateClear = report.ready.cleanTree
    && report.ready.migrationReadable
    && report.ready.migrationHeadMatches
    && report.ready.pauseReadable
    && report.ready.pausedAsRequired
    && report.ready.singletonAbsent;
  if (!technicalGateClear) {
    console.error("CRO03D_DISCOVERY: PREFLIGHT BLOCKED — see report above.");
    process.exitCode = 1;
    return;
  }
  if (!report.ready.noMissingSecrets) {
    console.error("CRO03D_DISCOVERY: missing provider secrets — owner action required (see missingSecretsByProvider).");
    process.exitCode = 2;
    return;
  }
  console.error("CRO03D_DISCOVERY: technical preflight clear. Next owner gate: commercial approval.");
  process.exitCode = 0;
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .catch(() => {
      // Fail-closed: an unhandled setup error must never look like a clean
      // exit. Print a redacted blocked report and force a non-zero exit.
      console.log(JSON.stringify(redactedErrorReport(), null, 2));
      console.error("CRO03D_DISCOVERY: PREFLIGHT BLOCKED — unhandled error during discovery.");
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode ?? 1));
}
