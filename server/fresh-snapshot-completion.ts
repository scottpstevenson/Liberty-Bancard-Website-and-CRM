import fs from "fs";
import path from "path";

const FOUNDATION_MIGRATION_TAG = "0076_outbound_launch_foundation";
const REQUIRED_FOUNDATION_RELATIONS = [
  "outbound_send_log",
  "webhook_event_log",
] as const;

export interface MigrationQueryClient {
  query(queryText: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface FreshSnapshotCompletionResult {
  appliedFoundation: boolean;
  relations: Record<(typeof REQUIRED_FOUNDATION_RELATIONS)[number], boolean>;
}

/**
 * The migration runner creates drizzle.__drizzle_migrations before deciding
 * whether to apply the canonical snapshot, so that metadata schema is excluded.
 * Every other user relation means this is not an empty snapshot target.
 */
export async function assertSnapshotTargetIsEmpty(
  client: MigrationQueryClient,
): Promise<void> {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'drizzle')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ORDER BY n.nspname, c.relname
    LIMIT 20
  `);
  if (rows.length === 0) return;

  const relations = rows.map((row) => {
    const schemaName = String(row.schema_name ?? "unknown");
    const relationName = String(row.relation_name ?? "unknown");
    return `${schemaName}.${relationName}`;
  });
  throw new Error(
    "[DB Migrate] Refusing canonical snapshot bootstrap on a non-empty " +
      `noncanonical database. Existing relation(s): ${relations.join(", ")}`,
  );
}

async function readFoundationRelations(
  client: MigrationQueryClient,
): Promise<FreshSnapshotCompletionResult["relations"]> {
  const { rows } = await client.query(`
    SELECT
      to_regclass('public.outbound_send_log') IS NOT NULL AS outbound_send_log,
      to_regclass('public.webhook_event_log') IS NOT NULL AS webhook_event_log
  `);
  const row = rows[0] ?? {};
  return {
    outbound_send_log: row.outbound_send_log === true,
    webhook_event_log: row.webhook_event_log === true,
  };
}

function missingRelations(
  relations: FreshSnapshotCompletionResult["relations"],
): string[] {
  return REQUIRED_FOUNDATION_RELATIONS.filter((relation) => !relations[relation]);
}

/**
 * Completes the canonical 0109 snapshot only for the invocation that applied it
 * to an empty database. Existing databases are verified but never repaired.
 */
export async function verifyOrCompleteFreshSnapshotFoundation(
  client: MigrationQueryClient,
  appliedFreshSnapshot: boolean,
): Promise<FreshSnapshotCompletionResult> {
  const before = await readFoundationRelations(client);
  const missingBefore = missingRelations(before);

  if (missingBefore.length === 0) {
    return { appliedFoundation: false, relations: before };
  }

  if (!appliedFreshSnapshot) {
    throw new Error(
      `[DB Migrate] Existing database schema drift: required pre-snapshot relation(s) missing: ` +
        `${missingBefore.join(", ")}. Refusing to replay ${FOUNDATION_MIGRATION_TAG} ` +
        "against an existing database.",
    );
  }

  const migrationPath = path.join(
    process.cwd(),
    "migrations",
    `${FOUNDATION_MIGRATION_TAG}.sql`,
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error(
      `[DB Migrate] Fresh snapshot completion SQL missing: ${migrationPath}`,
    );
  }

  await client.query(fs.readFileSync(migrationPath, "utf8"));

  const after = await readFoundationRelations(client);
  const missingAfter = missingRelations(after);
  if (missingAfter.length > 0) {
    throw new Error(
      `[DB Migrate] Fresh snapshot completion failed; required relation(s) still missing: ` +
        missingAfter.join(", "),
    );
  }

  console.log(
    `[DB Migrate] Completed fresh 0109 snapshot with ${FOUNDATION_MIGRATION_TAG}.`,
  );
  return { appliedFoundation: true, relations: after };
}