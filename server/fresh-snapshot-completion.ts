import fs from "fs";
import path from "path";

const FOUNDATION_MIGRATION_TAG = "0076_outbound_launch_foundation";

export interface MigrationQueryClient {
  query(queryText: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface FreshSnapshotCompletionResult {
  appliedFoundation: boolean;
  missingComponents: string[];
}

/**
 * The migration runner creates drizzle.__drizzle_migrations before deciding
 * whether to apply the canonical snapshot. Exclude only that exact table and its
 * generated SERIAL sequence; every other user relation means the target is not empty.
 */
export async function assertSnapshotTargetIsEmpty(
  client: MigrationQueryClient,
): Promise<void> {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT (
        n.nspname = 'drizzle'
        AND (
          (c.relname = '__drizzle_migrations' AND c.relkind = 'r')
          OR
          (c.relname = '__drizzle_migrations_id_seq' AND c.relkind = 'S')
        )
      )
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

async function readFoundationFingerprint(
  client: MigrationQueryClient,
): Promise<string[]> {
  const { rows } = await client.query(`
    /* foundation_fingerprint_issues */
    WITH expected_tables(table_name) AS (
      VALUES ('outbound_send_log'), ('webhook_event_log')
    ),
    expected_columns(table_name, column_name, udt_name, is_nullable, default_pattern) AS (
      VALUES
        ('outbound_send_log', 'id',                     'int4',        false, '^nextval\\(.+::regclass\\)$'),
        ('outbound_send_log', 'idempotency_key',        'text',        false, NULL),
        ('outbound_send_log', 'sequence_id',            'int4',        true,  NULL),
        ('outbound_send_log', 'sequence_enrollment_id', 'int4',        true,  NULL),
        ('outbound_send_log', 'contact_id',             'int4',        true,  NULL),
        ('outbound_send_log', 'step_order',             'int4',        true,  NULL),
        ('outbound_send_log', 'channel',                'text',        false, NULL),
        ('outbound_send_log', 'from_address',           'text',        true,  NULL),
        ('outbound_send_log', 'to_address',             'text',        false, NULL),
        ('outbound_send_log', 'subject',                'text',        true,  NULL),
        ('outbound_send_log', 'provider_message_id',    'text',        true,  NULL),
        ('outbound_send_log', 'status',                 'text',        false, '^''pending''::text$'),
        ('outbound_send_log', 'failure_reason',         'text',        true,  NULL),
        ('outbound_send_log', 'next_action_at',         'timestamptz', true,  NULL),
        ('outbound_send_log', 'sent_at',                'timestamptz', true,  NULL),
        ('outbound_send_log', 'delivered_at',           'timestamptz', true,  NULL),
        ('outbound_send_log', 'failed_at',              'timestamptz', true,  NULL),
        ('outbound_send_log', 'created_at',             'timestamptz', false, '^now\\(\\)$'),
        ('outbound_send_log', 'updated_at',             'timestamptz', false, '^now\\(\\)$'),
        ('webhook_event_log', 'id',             'int4',        false, '^nextval\\(.+::regclass\\)$'),
        ('webhook_event_log', 'event_id',       'text',        false, NULL),
        ('webhook_event_log', 'event_type',     'text',        false, NULL),
        ('webhook_event_log', 'source',         'text',        false, '^''ghl''::text$'),
        ('webhook_event_log', 'contact_id',     'int4',        true,  NULL),
        ('webhook_event_log', 'ghl_contact_id', 'text',        true,  NULL),
        ('webhook_event_log', 'processed_at',   'timestamptz', false, '^now\\(\\)$'),
        ('webhook_event_log', 'result_summary', 'text',        true,  NULL)
    ),
    expected_unique(table_name, column_name) AS (
      VALUES
        ('outbound_send_log', 'idempotency_key'),
        ('webhook_event_log', 'event_id')
    ),
    expected_fks(table_name, column_name, referenced_table, referenced_column) AS (
      VALUES
        ('outbound_send_log', 'sequence_id',            'follow_up_sequences',  'id'),
        ('outbound_send_log', 'sequence_enrollment_id', 'sequence_enrollments', 'id'),
        ('outbound_send_log', 'contact_id',             'contacts',             'id')
    ),
    expected_indexes(index_name, table_name, column_names, descending) AS (
      VALUES
        ('idx_osl_enrollment', 'outbound_send_log', ARRAY['sequence_enrollment_id']::text[], ARRAY[false]::boolean[]),
        ('idx_osl_contact',    'outbound_send_log', ARRAY['contact_id', 'created_at']::text[], ARRAY[false, true]::boolean[]),
        ('idx_osl_status',     'outbound_send_log', ARRAY['status']::text[], ARRAY[false]::boolean[]),
        ('idx_osl_created',    'outbound_send_log', ARRAY['created_at']::text[], ARRAY[true]::boolean[]),
        ('idx_wel_event_id',   'webhook_event_log', ARRAY['event_id']::text[], ARRAY[false]::boolean[]),
        ('idx_wel_contact',    'webhook_event_log', ARRAY['contact_id']::text[], ARRAY[false]::boolean[]),
        ('idx_wel_type',       'webhook_event_log', ARRAY['event_type', 'processed_at']::text[], ARRAY[false, true]::boolean[])
    ),
    actual_indexes AS (
      SELECT
        index_class.relname AS index_name,
        table_class.relname AS table_name,
        array_agg(attribute.attname::text ORDER BY index_key.ordinality) AS column_names,
        array_agg(
          ((index_meta.indoption[index_key.ordinality - 1] & 1) = 1)
          ORDER BY index_key.ordinality
        ) AS descending,
        index_meta.indisvalid,
        index_meta.indisunique,
        index_meta.indpred IS NULL AS is_unfiltered,
        access_method.amname AS access_method
      FROM pg_index index_meta
      JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_class.relam
      CROSS JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS index_key(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = table_class.oid
       AND attribute.attnum = index_key.attnum
      WHERE table_namespace.nspname = 'public'
      GROUP BY
        index_class.relname,
        table_class.relname,
        index_meta.indisvalid,
        index_meta.indisunique,
        index_meta.indpred,
        access_method.amname
    ),
    issues(component) AS (
      SELECT 'table:public.' || expected.table_name || ':missing'
      FROM expected_tables expected
      WHERE to_regclass('public.' || expected.table_name) IS NULL

      UNION ALL

      SELECT 'column:' || expected.table_name || '.' || expected.column_name || ':missing'
      FROM expected_columns expected
      LEFT JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL

      UNION ALL

      SELECT 'column:' || expected.table_name || '.' || expected.column_name || ':type'
      FROM expected_columns expected
      JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE actual.udt_name <> expected.udt_name

      UNION ALL

      SELECT 'column:' || expected.table_name || '.' || expected.column_name || ':nullability'
      FROM expected_columns expected
      JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE (actual.is_nullable = 'YES') <> expected.is_nullable

      UNION ALL

      SELECT 'column:' || expected.table_name || '.' || expected.column_name || ':default'
      FROM expected_columns expected
      JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
      WHERE
        (expected.default_pattern IS NULL AND actual.column_default IS NOT NULL)
        OR
        (expected.default_pattern IS NOT NULL AND COALESCE(actual.column_default, '') !~ expected.default_pattern)

      UNION ALL

      SELECT 'unique:' || expected.table_name || '.' || expected.column_name || ':missing'
      FROM expected_unique expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_meta
        JOIN pg_class source_table ON source_table.oid = constraint_meta.conrelid
        JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
        JOIN pg_attribute source_column
          ON source_column.attrelid = source_table.oid
         AND source_column.attname = expected.column_name
        WHERE source_schema.nspname = 'public'
          AND source_table.relname = expected.table_name
          AND constraint_meta.contype = 'u'
          AND constraint_meta.conkey = ARRAY[source_column.attnum]::smallint[]
      )

      UNION ALL

      SELECT
        'foreign-key:' || expected.table_name || '.' || expected.column_name ||
        '->' || expected.referenced_table || '.' || expected.referenced_column || ':missing'
      FROM expected_fks expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_meta
        JOIN pg_class source_table ON source_table.oid = constraint_meta.conrelid
        JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
        JOIN pg_attribute source_column
          ON source_column.attrelid = source_table.oid
         AND source_column.attname = expected.column_name
        JOIN pg_class referenced_table ON referenced_table.oid = constraint_meta.confrelid
        JOIN pg_namespace referenced_schema ON referenced_schema.oid = referenced_table.relnamespace
        JOIN pg_attribute referenced_column
          ON referenced_column.attrelid = referenced_table.oid
         AND referenced_column.attname = expected.referenced_column
        WHERE source_schema.nspname = 'public'
          AND referenced_schema.nspname = 'public'
          AND source_table.relname = expected.table_name
          AND referenced_table.relname = expected.referenced_table
          AND constraint_meta.contype = 'f'
          AND constraint_meta.confdeltype = 'n'
          AND constraint_meta.conkey = ARRAY[source_column.attnum]::smallint[]
          AND constraint_meta.confkey = ARRAY[referenced_column.attnum]::smallint[]
      )

      UNION ALL

      SELECT 'index:' || expected.index_name || ':missing-or-mismatched'
      FROM expected_indexes expected
      LEFT JOIN actual_indexes actual
        ON actual.index_name = expected.index_name
       AND actual.table_name = expected.table_name
      WHERE actual.index_name IS NULL
        OR actual.column_names <> expected.column_names
        OR actual.descending <> expected.descending
        OR NOT actual.indisvalid
        OR actual.indisunique
        OR NOT actual.is_unfiltered
        OR actual.access_method <> 'btree'
    )
    SELECT COALESCE(
      array_agg(component ORDER BY component),
      ARRAY[]::text[]
    ) AS missing_components
    FROM issues
  `);
  if (rows.length !== 1) {
    throw new Error(
      `[DB Migrate] Invalid 0076 foundation fingerprint result: expected one row, received ${rows.length}.`,
    );
  }
  const missingComponents = rows[0]?.missing_components;
  if (
    !Array.isArray(missingComponents) ||
    missingComponents.some((component) => typeof component !== "string")
  ) {
    throw new Error(
      "[DB Migrate] Invalid 0076 foundation fingerprint result: missing_components must be a string array.",
    );
  }
  return missingComponents;
}

/**
 * Completes the canonical 0109 snapshot only for the invocation that applied it
 * to an empty database. Existing databases are verified but never repaired.
 */
export async function verifyOrCompleteFreshSnapshotFoundation(
  client: MigrationQueryClient,
  appliedFreshSnapshot: boolean,
): Promise<FreshSnapshotCompletionResult> {
  const missingBefore = await readFoundationFingerprint(client);

  if (missingBefore.length === 0) {
    return { appliedFoundation: false, missingComponents: [] };
  }

  if (!appliedFreshSnapshot) {
    throw new Error(
      `[DB Migrate] Existing database 0076 foundation mismatch: ` +
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

  const missingAfter = await readFoundationFingerprint(client);
  if (missingAfter.length > 0) {
    throw new Error(
      `[DB Migrate] Fresh snapshot completion failed; 0076 foundation mismatch: ` +
        missingAfter.join(", "),
    );
  }

  console.log(
    `[DB Migrate] Completed fresh 0109 snapshot with ${FOUNDATION_MIGRATION_TAG}.`,
  );
  return { appliedFoundation: true, missingComponents: [] };
}
