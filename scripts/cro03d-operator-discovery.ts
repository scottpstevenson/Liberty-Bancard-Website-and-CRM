/**
 * CRO-03D operator discovery (dry-run, read-only, NO live provider I/O).
 *
 * Derives the facts an operator ceremony needs before requesting any owner
 * action: exact release identity, migration head, provider secret PRESENCE
 * (never values), production pause state, and singleton (`cro03c_initial_v1`)
 * existence. Prints a redacted structured JSON report and exits non-zero if
 * anything ambiguous/unsafe is detected (fail-closed).
 *
 * This script performs ZERO writes, ZERO provider API calls, and ZERO
 * deployment or singleton mutation. It exists purely to answer: "what does
 * the owner actually need to do next?" per CRO-03D step 1 / section 8.
 */
import { execSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  CRO03C_INITIAL_ROLLOUT_KEY,
  CRO03C_MIGRATION_HEAD,
  CRO03C_PROVIDER_CONTRACTS,
} from "../server/services/cro03/live-execution";
import { PROVIDER_SOURCE_MANIFEST } from "../server/services/provider-manifest";
import { getPauseState } from "../server/services/outbound-pause-authority";

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

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

function releaseIdentity() {
  const sha = git("rev-parse HEAD");
  const tree = git("rev-parse HEAD^{tree}");
  const dirty = git("status --porcelain").length > 0;
  return { sha, tree, dirty };
}

function secretPresence() {
  const out: Record<string, { manifestId: string | null; secretNames: string[]; allPresent: boolean }> = {};
  for (const provider of Object.keys(CRO03C_PROVIDER_CONTRACTS)) {
    const manifestId = CRO03C_TO_MANIFEST_ID[provider] ?? null;
    if (!manifestId) {
      out[provider] = { manifestId: null, secretNames: [], allPresent: true };
      continue;
    }
    const row = PROVIDER_SOURCE_MANIFEST.find((r) => r.id === manifestId);
    const secretNames = row ? [...row.secretNames] : [];
    // Presence only — never read or print the value.
    const allPresent = secretNames.every((name) => Boolean(process.env[name]));
    out[provider] = { manifestId, secretNames, allPresent };
  }
  return out;
}

async function migrationHeadStatus() {
  try {
    const result: any = await db.execute(
      sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`
    );
    const rows = result?.rows ?? result ?? [];
    const appliedHash = rows[0]?.hash ?? null;
    return { expected: CRO03C_MIGRATION_HEAD, appliedHeadHash: appliedHash, readable: true };
  } catch (err: any) {
    return { expected: CRO03C_MIGRATION_HEAD, appliedHeadHash: null, readable: false, error: String(err?.message ?? err) };
  }
}

async function pauseStatus() {
  try {
    const state = await getPauseState();
    return { readable: true, state: state.state, source: state.source };
  } catch (err: any) {
    return { readable: false, error: String(err?.message ?? err) };
  }
}

async function singletonStatus() {
  try {
    const result: any = await db.execute(
      sql`SELECT rollout_key, state, consumed_at FROM cro03c_initial_rollouts WHERE rollout_key = ${CRO03C_INITIAL_ROLLOUT_KEY}`
    );
    const rows = result?.rows ?? result ?? [];
    return {
      readable: true,
      key: CRO03C_INITIAL_ROLLOUT_KEY,
      exists: rows.length > 0,
      state: rows[0]?.state ?? null,
    };
  } catch (err: any) {
    return { readable: false, key: CRO03C_INITIAL_ROLLOUT_KEY, error: String(err?.message ?? err) };
  }
}

export async function runCro03dDiscovery() {
  const [release, secrets, migration, pause, singleton] = await Promise.all([
    Promise.resolve(releaseIdentity()),
    Promise.resolve(secretPresence()),
    migrationHeadStatus(),
    pauseStatus(),
    singletonStatus(),
  ]);

  const missingSecretsByProvider = Object.entries(secrets)
    .filter(([, v]) => !v.allPresent)
    .map(([provider, v]) => ({ provider, missing: v.secretNames.filter((n) => !process.env[n]) }));

  const report = {
    noLiveIO: true,
    generatedAt: new Date().toISOString(),
    release,
    migration,
    pause,
    singleton,
    providerSecretPresence: secrets,
    missingSecretsByProvider,
    ready: {
      cleanTree: !release.dirty,
      migrationReadable: migration.readable,
      pauseReadable: pause.readable && pause.state === "paused",
      singletonAbsent: singleton.readable === true && singleton.exists === false,
      noMissingSecrets: missingSecretsByProvider.length === 0,
    },
  };

  return report;
}

async function main() {
  const report = await runCro03dDiscovery();
  console.log(JSON.stringify(report, null, 2));
  const blocked = !report.ready.cleanTree
    || !report.ready.migrationReadable
    || !report.ready.pauseReadable
    || !report.ready.singletonAbsent;
  if (blocked) {
    console.error("CRO03D_DISCOVERY: PREFLIGHT BLOCKED — see report above.");
    process.exitCode = 1;
  } else if (!report.ready.noMissingSecrets) {
    console.error("CRO03D_DISCOVERY: missing provider secrets — owner action required (see missingSecretsByProvider).");
    process.exitCode = 2;
  } else {
    console.error("CRO03D_DISCOVERY: technical preflight clear. Next owner gate: commercial approval.");
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().finally(() => process.exit(process.exitCode ?? 0));
}
