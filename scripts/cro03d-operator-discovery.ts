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
import { sql } from "drizzle-orm";
import {
  CRO03C_INITIAL_ROLLOUT_KEY,
  CRO03C_MIGRATION_HEAD,
  CRO03C_PROVIDER_CONTRACTS,
} from "../server/services/cro03/live-execution";
import { PROVIDER_SOURCE_MANIFEST } from "../server/services/provider-manifest";

/**
 * Position (0-based) of the CRO-03C migration head inside the checked-out
 * journal. Drizzle applies journal entries strictly in order and never skips
 * one, so "applied migration row count >= requiredJournalPosition + 1" is a
 * sound proof that the CRO-03C migration head has actually been applied to
 * the target database — even if later, unrelated migrations have since been
 * applied on top of it (which is expected and not a CRO-03D concern).
 */
export function requiredJournalPosition(): number {
  const journal = JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"));
  const idx = (journal.entries as Array<{ tag: string; idx: number }>).findIndex((e) => e.tag === CRO03C_MIGRATION_HEAD);
  if (idx < 0) {
    throw new Error(`CRO03C_MIGRATION_HEAD (${CRO03C_MIGRATION_HEAD}) not found in migrations/meta/_journal.json`);
  }
  return idx;
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
  requiredJournalPosition: number;
  appliedMigrationCount: number | null;
  readable: boolean;
  matches: boolean;
  error?: string;
}

export interface Cro03dPauseStatus {
  readable: boolean;
  state?: string;
  source?: string;
  error?: string;
}

export interface Cro03dSingletonStatus {
  readable: boolean;
  key: string;
  exists?: boolean;
  state?: string | null;
  error?: string;
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
  /** Reads the number of rows applied in the canonical migrations ledger. */
  getAppliedMigrationCount: () => Promise<number>;
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

async function realAppliedMigrationCount(): Promise<number> {
  const { db } = await import("../server/db");
  const result: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`);
  const rows = result?.rows ?? result ?? [];
  return Number(rows[0]?.n ?? 0);
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
  getAppliedMigrationCount: realAppliedMigrationCount,
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

  const journalPosition = requiredJournalPosition();
  let migration: Cro03dMigrationStatus;
  try {
    const appliedMigrationCount = await deps.getAppliedMigrationCount();
    migration = {
      expected: CRO03C_MIGRATION_HEAD,
      requiredJournalPosition: journalPosition,
      appliedMigrationCount,
      readable: true,
      // Drizzle applies journal entries strictly in order with no gaps, so this
      // proves the CRO-03C migration head has actually landed in the target DB.
      matches: appliedMigrationCount >= journalPosition + 1,
    };
  } catch (err: any) {
    migration = {
      expected: CRO03C_MIGRATION_HEAD,
      requiredJournalPosition: journalPosition,
      appliedMigrationCount: null,
      readable: false,
      matches: false,
      error: String(err?.message ?? err),
    };
  }

  let pause: Cro03dPauseStatus;
  try {
    const state = await deps.getPauseState();
    pause = { readable: true, state: state.state, source: state.source };
  } catch (err: any) {
    pause = { readable: false, error: String(err?.message ?? err) };
  }

  let singleton: Cro03dSingletonStatus;
  try {
    const row = await deps.getSingletonRow();
    singleton = { readable: true, key: CRO03C_INITIAL_ROLLOUT_KEY, exists: row !== null, state: row?.state ?? null };
  } catch (err: any) {
    singleton = { readable: false, key: CRO03C_INITIAL_ROLLOUT_KEY, error: String(err?.message ?? err) };
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

function redactedErrorReport(err: unknown) {
  return {
    noLiveIO: true,
    generatedAt: new Date().toISOString(),
    blocked: true,
    reason: "CRO03D_DISCOVERY_UNHANDLED_ERROR",
    error: String((err as any)?.message ?? err),
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
    .catch((err) => {
      // Fail-closed: an unhandled setup error must never look like a clean
      // exit. Print a redacted blocked report and force a non-zero exit.
      console.log(JSON.stringify(redactedErrorReport(err), null, 2));
      console.error("CRO03D_DISCOVERY: PREFLIGHT BLOCKED — unhandled error during discovery.");
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode ?? 1));
}
