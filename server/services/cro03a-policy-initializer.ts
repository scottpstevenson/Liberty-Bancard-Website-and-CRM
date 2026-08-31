/**
 * Insert-only, idempotent CRO-03A candidate-qualification policy initializer.
 *
 * Production is provisioned by Replit Publish schema synchronization, not by
 * the app's Drizzle migration runner, so `cro03a_policy_documents` and
 * `cro03a_policy_control` can exist without the frozen v1 seed row that
 * `migrations/0187_cro03a_candidate_qualification.sql` inserts (and activates)
 * in the Drizzle-migrated dev path. This initializer converges production
 * onto that exact same canonical row before any CRO-03A discovery/
 * qualification endpoint can be used.
 *
 * It must never modify the migration journal, run schema DDL, change or
 * delete an existing policy row, or reassign an already-active policy. It
 * only inserts the missing canonical row (and points the singleton control
 * row at it only while that control row is still unset) and verifies the
 * result. Same shape and guarantees as
 * server/services/cro02-purpose-policy-initializer.ts.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

type Tx = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export const CRO03A_SEED_POLICY_KEY = "south_florida_candidate_qualification";
export const CRO03A_SEED_POLICY_VERSION = 1;
// Exact content of the row `migrations/0187_cro03a_candidate_qualification.sql`
// inserts. Must stay byte-for-byte identical to that migration's seed values.
export const CRO03A_SEED_POLICY_DOCUMENT = {
  geographyReferenceVersion: "south-florida-fips-v1",
  counties: { Broward: "12011", "Miami-Dade": "12086", "Palm Beach": "12099" },
  disabledCounties: { Monroe: "12087" },
  verticalAlgorithmVersion: "v1",
  subverticalMapVersion: "1",
  fitVersion: "v1",
  targetVerticals: ["Auto", "Healthcare", "Salon/Spa"],
  selectedMinimum: 70,
  reviewMinimum: 50,
  freshnessDays: 90,
  sourceCensus: [
    "prospects", "sunbiz_entities", "provider_csv_rows", "sdr_merchants",
    "lead_discovery_results", "master_leads", "public_web",
  ],
} as const;
export const CRO03A_SEED_POLICY_HASH = "c8e8e64ae1e50c3a56542db8413538f041432100f0852c1e89f7e6f3b2a91cac";

const EXPECTED_DOC_COLUMNS: Record<string, string> = {
  policy_key: "text", version: "integer", policy: "jsonb", policy_hash: "text", status: "text",
};
const EXPECTED_CONTROL_COLUMNS: Record<string, string> = {
  active_policy_id: "uuid", expected_version: "integer",
};

async function assertTableShape(tx: Tx, table: string, expected: Record<string, string>): Promise<void> {
  const found = rows(
    await tx.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `),
  );
  if (found.length === 0) throw new Error(`CRO03A_POLICY_INIT_TABLE_MISSING:${table}`);
  const byName = new Map(found.map((r: any) => [r.column_name, r.data_type]));
  for (const [column, dataType] of Object.entries(expected)) {
    if (byName.get(column) !== dataType) throw new Error(`CRO03A_POLICY_INIT_TABLE_SHAPE_INVALID:${table}.${column}`);
  }
}

/**
 * Converge `cro03a_policy_documents` / `cro03a_policy_control` onto the exact
 * canonical v1 seed row. Never updates or deletes an existing row; a row
 * that conflicts with the canonical content/hash causes startup to fail
 * closed rather than being silently corrected. If the control singleton
 * already points at any active policy (including this one, converged on a
 * prior boot), it is left untouched.
 */
export async function initializeCro03aPolicy(): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize concurrent startups on a dedicated advisory-lock key so
    // exactly one process performs the insert while others observe the
    // converged result.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('cro03a:v1:policy-init', 1800))`);

    await assertTableShape(tx as unknown as Tx, "cro03a_policy_documents", EXPECTED_DOC_COLUMNS);
    await assertTableShape(tx as unknown as Tx, "cro03a_policy_control", EXPECTED_CONTROL_COLUMNS);

    const existingDoc = rows(
      await tx.execute(sql`
        SELECT id, policy, policy_hash, status FROM cro03a_policy_documents
        WHERE policy_key = ${CRO03A_SEED_POLICY_KEY} AND version = ${CRO03A_SEED_POLICY_VERSION}
      `),
    )[0];

    // Step 1: fail closed on a conflicting existing document row. Never touch it.
    if (existingDoc && (String(existingDoc.policy_hash) !== CRO03A_SEED_POLICY_HASH || existingDoc.status !== "active")) {
      throw new Error("CRO03A_POLICY_INIT_CONFLICT:document");
    }

    // Step 2: insert the canonical document row only if it is missing.
    // ON CONFLICT DO NOTHING makes this safe under concurrent execution —
    // the composite unique index (policy_key, version) is the conflict target.
    if (!existingDoc) {
      await tx.execute(sql`
        INSERT INTO cro03a_policy_documents (policy_key, version, policy, policy_hash, status, created_by)
        VALUES (${CRO03A_SEED_POLICY_KEY}, ${CRO03A_SEED_POLICY_VERSION},
                ${JSON.stringify(CRO03A_SEED_POLICY_DOCUMENT)}::jsonb, ${CRO03A_SEED_POLICY_HASH}, 'active',
                'cro03a-policy-initializer')
        ON CONFLICT (policy_key, version) DO NOTHING
      `);
    }

    const doc = rows(
      await tx.execute(sql`
        SELECT id, policy_hash, status FROM cro03a_policy_documents
        WHERE policy_key = ${CRO03A_SEED_POLICY_KEY} AND version = ${CRO03A_SEED_POLICY_VERSION}
      `),
    )[0];
    if (!doc || String(doc.policy_hash) !== CRO03A_SEED_POLICY_HASH || doc.status !== "active") {
      throw new Error("CRO03A_POLICY_INIT_VERIFY_FAILED:document");
    }

    // Step 3: point the singleton control row at it, but ONLY while the
    // control row has never been assigned an active policy — never
    // reassign or override an operator's existing activation decision.
    const control = rows(await tx.execute(sql`
      SELECT active_policy_id, expected_version FROM cro03a_policy_control WHERE id = 1 FOR UPDATE
    `))[0];
    if (!control) throw new Error("CRO03A_POLICY_INIT_CONTROL_ROW_MISSING");
    if (control.active_policy_id == null) {
      await tx.execute(sql`
        UPDATE cro03a_policy_control
           SET active_policy_id = ${doc.id}::uuid, expected_version = ${CRO03A_SEED_POLICY_VERSION},
               updated_by = 'cro03a-policy-initializer', updated_at = NOW()
         WHERE id = 1 AND active_policy_id IS NULL
      `);
    } else if (control.active_policy_id !== doc.id) {
      // A different policy is already active — leave it alone. This is not
      // a conflict; it just means an operator already activated something.
      return;
    }

    // Step 4: re-verify the converged state before returning control.
    const finalControl = rows(await tx.execute(sql`
      SELECT active_policy_id FROM cro03a_policy_control WHERE id = 1
    `))[0];
    if (!finalControl || finalControl.active_policy_id !== doc.id) {
      throw new Error("CRO03A_POLICY_INIT_VERIFY_FAILED:control");
    }
  });
}
