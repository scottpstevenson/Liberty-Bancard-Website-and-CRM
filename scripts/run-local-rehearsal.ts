#!/usr/bin/env tsx
/**
 * Deliberately local-only entry point.  It never accepts or reads a database URL.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildCanonicalReference, captureCatalog, createLocalRehearsalDatabases, deterministicCatalogDiff, launchLocalPostgres16, restoreVerifiedBackup, validateBackupReceipt, verifyLocalClusterIdentity } from "./local-rehearsal-core";

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const dump = value("--backup"), receipt = value("--receipt");
const execute = args.includes("--execute") && process.env.LOCAL_REHEARSAL_EXECUTE === "true";
if (!dump || !receipt) {
  console.error("Provide or authorize access to one current verified production PostgreSQL backup/clone.");
  process.exitCode = 1;
} else {
  let cluster: Awaited<ReturnType<typeof launchLocalPostgres16>> | undefined;
  const cleanup = async () => { await cluster?.stop(); cluster = undefined; };
  const signal = () => { void cleanup().finally(() => process.exit(1)); };
  process.once("SIGINT", signal); process.once("SIGTERM", signal);
  try {
    const verified = await validateBackupReceipt(path.resolve(dump), path.resolve(receipt));
    cluster = await launchLocalPostgres16();
    await verifyLocalClusterIdentity(cluster);
    const databases = await createLocalRehearsalDatabases(cluster);
    await verifyLocalClusterIdentity(cluster, databases.reference.database);
    const report: Record<string, unknown> = {
      schemaVersion: 1, mode: execute ? "execute-authorized" : "analysis-preflight",
      releaseSha: process.env.RELEASE_SHA ?? "unknown", backup: { file: path.basename(verified.file), sha256: verified.sha256, capturedAt: verified.capturedAt },
      cluster: { data: cluster.data, socket: cluster.socket, port: cluster.port, pid: cluster.pid },
      databases: { reference: databases.reference.database, restored: databases.restored.database },
      externalMutationCounters: { network: 0, providers: 0, productionTargets: 0 },
      certified: false,
    };
    if (execute) {
      const canonical = await buildCanonicalReference(databases.reference);
      await fs.rm(canonical.workdir, { recursive: true, force: true });
      // A restored dump is only ever directed at the random launcher-owned database.
      await restoreVerifiedBackup(databases.restored, path.resolve(dump), verified);
      const reference = canonical.catalog;
      const restored = await captureCatalog(databases.restored);
      const categories = [...new Set([...Object.keys(reference), ...Object.keys(restored)])]
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      const differences = Object.fromEntries(categories.map(category => [category, deterministicCatalogDiff(reference[category] ?? "[]", restored[category] ?? "[]")]));
      Object.assign(report, {
        beforeFingerprints: Object.fromEntries(Object.entries(restored).map(([k, v]) => [k, createHash("sha256").update(v).digest("hex")])),
        referenceFingerprints: Object.fromEntries(Object.entries(reference).map(([k, v]) => [k, createHash("sha256").update(v).digest("hex")])),
        canonicalJournal: { entries: canonical.entries.map(entry => ({ idx: entry.idx, tag: entry.tag, when: entry.when, hash: canonical.hashes[entry.tag] })), fingerprint: canonical.journal },
        differences, postconditions: ["UNVERIFIABLE: semantic migration data-effect evaluators are not yet implemented"],
        journalPlan: "No journal adoption is performed by local rehearsal tooling.",
      });
      process.exitCode = 1; // certification is fail-closed until canonical replay exists.
    }
    const receipts = path.resolve("receipts");
    await fs.mkdir(receipts, { recursive: true, mode: 0o700 });
    const reportFile = path.join(receipts, `local-rehearsal-${Date.now()}-${verified.sha256.slice(0, 12)}.json`);
    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ mode: report.mode, report: path.relative(process.cwd(), reportFile), certified: false }));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", signal); process.removeListener("SIGTERM", signal);
    await cleanup();
  }
}