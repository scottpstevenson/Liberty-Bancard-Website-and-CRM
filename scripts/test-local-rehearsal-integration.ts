#!/usr/bin/env tsx
/**
 * No external database is used here. CI images without PostgreSQL binaries skip
 * the executable portion rather than substituting an externally configured URL.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { buildCanonicalReference, captureCatalog, createLocalRehearsalDatabases, launchLocalPostgres16, restoreVerifiedBackup, validateBackupReceipt, verifyLocalClusterIdentity, withLocalClient } from "./local-rehearsal-core";

try { execFileSync("initdb", ["--version"], { stdio: "ignore" }); }
catch { console.log("Local rehearsal integration skipped: initdb is unavailable."); process.exit(0); }
const dir = await mkdtemp(path.join(os.tmpdir(), "rehearsal-fixture-"));
const dump = path.join(dir, "fixture.sql.gz");
await writeFile(dump, "fixture");
const digest = createHash("sha256").update("fixture").digest("hex");
const receipt = path.join(dir, "fixture.json");
await writeFile(receipt, JSON.stringify({ status: "completed", databaseIdentity: { production: true }, capturedAt: new Date().toISOString(), sizeBytes: 7, sha256: digest, dumpFormat: "sql.gz", pgDumpExitCode: 0, streamFinished: true, file: "fixture.sql.gz" }));
await validateBackupReceipt(dump, receipt);
await assert.rejects(() => validateBackupReceipt(dump, path.join(dir, "missing.json")));
let cluster: Awaited<ReturnType<typeof launchLocalPostgres16>> | undefined;
try {
  cluster = await launchLocalPostgres16();
  await verifyLocalClusterIdentity(cluster);
  const databases = await createLocalRehearsalDatabases(cluster);
  await withLocalClient(databases.restored, async client => {
    await client.query("CREATE TABLE local_rehearsal_identity_test (id integer PRIMARY KEY)");
    const { rows } = await client.query("SELECT inet_server_addr() AS tcp_address");
    assert.equal(rows[0].tcp_address, null, "private socket connection must not use TCP");
  });
  // Exact replay is exercised in its own isolated migration tree. The result
  // is not a certification claim; it proves the filtered endpoint can replay.
  const canonical = await buildCanonicalReference(databases.reference);
  assert.ok(canonical.entries.at(-1)?.tag === "0202_cro03c_transport_invocation_checkpoint");
  await withLocalClient(databases.restored, async client => { await client.query("DROP TABLE local_rehearsal_identity_test"); });
  // Fixture is produced from the private canonical database, never from an
  // externally configured target. It exercises the SQL.gz restore path.
  const sql = execFileSync("pg_dump", ["--no-owner", "-h", cluster.socket.realpath, "-p", String(cluster.port), "-U", process.env.USER || process.env.LOGNAME || "runner", databases.reference.database]);
  const rehearsalDump = path.join(dir, "canonical.sql.gz");
  await writeFile(rehearsalDump, gzipSync(sql));
  const rehearsalBytes = await (await import("node:fs/promises")).readFile(rehearsalDump);
  const rehearsalReceipt = path.join(dir, "canonical.json");
  await writeFile(rehearsalReceipt, JSON.stringify({ status: "completed", databaseIdentity: { production: true }, capturedAt: new Date().toISOString(), sizeBytes: rehearsalBytes.length, sha256: createHash("sha256").update(rehearsalBytes).digest("hex"), dumpFormat: "sql.gz", pgDumpExitCode: 0, streamFinished: true, file: "canonical.sql.gz" }));
  const attested = await validateBackupReceipt(rehearsalDump, rehearsalReceipt);
  await restoreVerifiedBackup(databases.restored, rehearsalDump, attested);
  const referenceCatalog = await captureCatalog(databases.reference), restoredCatalog = await captureCatalog(databases.restored);
  const unequal = Object.keys(referenceCatalog).filter(key => referenceCatalog[key] !== restoredCatalog[key]);
  if (unequal.length) {
    const category = unequal[0], left = new Set((JSON.parse(referenceCatalog[category]) as unknown[]).map(JSON.stringify)), right = new Set((JSON.parse(restoredCatalog[category]) as unknown[]).map(JSON.stringify));
    const missing = JSON.parse([...left].find(item => !right.has(item))!);
    const candidate = (JSON.parse(restoredCatalog[category]) as any[]).find(item => item.name === missing.name && item.table === missing.table);
    console.error(JSON.stringify({ missing, candidate }));
  }
  assert.deepEqual(unequal, [], `restored catalog differs in ${unequal.join(",")}`);
  await rm(canonical.workdir, { recursive: true, force: true });
} finally {
  await cluster?.stop();
  await rm(dir, { recursive: true, force: true });
}
console.log("Local rehearsal private-cluster integration passed.");