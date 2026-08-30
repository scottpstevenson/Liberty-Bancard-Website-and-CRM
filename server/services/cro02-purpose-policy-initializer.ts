/**
 * Insert-only, idempotent CRO-02 purpose-policy initializer.
 *
 * Production is provisioned by Replit Publish schema synchronization, not by
 * the app's Drizzle migration runner, so the `commercial_purpose_policies`
 * table can exist without the eight frozen v1 seed rows that
 * `migrations/0170_cro02_versioned_purpose_policies.sql` inserts in the
 * Drizzle-migrated dev path. This initializer converges production onto the
 * same eight canonical rows before `assertCro02PurposePolicies()` runs.
 *
 * It must never modify the migration journal, run schema DDL, change or
 * delete an existing policy row, switch anything out of shadow mode, or
 * produce any commercial side effect (GHL, campaigns, enrollment, outreach,
 * budgets, pause state). It only inserts missing canonical rows and verifies
 * the result.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  CRO02_POLICY_VERSION,
  CRO02_PURPOSE_POLICY_DOCUMENTS,
  commercialPurposePolicyFingerprint,
  type CommercialEffect,
  type CommercialPurposePolicyDocument,
} from "./commercial-resolution";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

type Tx = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

// Expected shape of the pre-existing table. Any mismatch fails closed rather
// than attempting to reconcile schema — schema changes belong to Replit
// Publish, not this initializer.
const EXPECTED_COLUMNS: Record<string, string> = {
  purpose: "text",
  policy_version: "integer",
  required_edges: "jsonb",
  mode: "text",
  updated_at: "timestamp with time zone",
};

async function assertTableShape(tx: Tx): Promise<void> {
  const found = rows(
    await tx.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'commercial_purpose_policies'
    `),
  );
  if (found.length === 0) throw new Error("CRO02_POLICY_TABLE_MISSING");
  const byName = new Map(found.map((r: any) => [r.column_name, r.data_type]));
  for (const [column, dataType] of Object.entries(EXPECTED_COLUMNS)) {
    if (byName.get(column) !== dataType) {
      throw new Error(`CRO02_POLICY_TABLE_SHAPE_INVALID:${column}`);
    }
  }
}

function fingerprintOf(document: CommercialPurposePolicyDocument | null | undefined): string | null {
  if (!document) return null;
  return commercialPurposePolicyFingerprint(document);
}

/**
 * Converge `commercial_purpose_policies` onto the exact eight canonical v1
 * shadow rows. Existing rows are never updated or deleted; a row that
 * conflicts with the canonical document, fingerprint, or shadow mode causes
 * startup to fail closed rather than being silently corrected.
 */
export async function initializeCro02PurposePolicies(): Promise<void> {
  const effects = Object.keys(CRO02_PURPOSE_POLICY_DOCUMENTS) as CommercialEffect[];

  await db.transaction(async (tx) => {
    // Serialize concurrent startups (e.g. multiple app instances booting at
    // once) on a single dedicated advisory-lock key so exactly one process
    // performs the insert while the others observe the converged result.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('cro02:v1:purpose-policy-init', 1700))`);

    await assertTableShape(tx as unknown as Tx);

    const existing = rows(
      await tx.execute(sql`
        SELECT purpose, policy_version, required_edges, mode
        FROM commercial_purpose_policies
        WHERE policy_version = ${CRO02_POLICY_VERSION}
      `),
    );
    const existingByPurpose = new Map(existing.map((r: any) => [r.purpose as string, r]));

    // Step 1: fail closed on any conflicting existing row. Never touch it.
    for (const effect of effects) {
      const row = existingByPurpose.get(effect);
      if (!row) continue;
      const expectedFp = commercialPurposePolicyFingerprint(CRO02_PURPOSE_POLICY_DOCUMENTS[effect]);
      const actualFp = fingerprintOf(row.required_edges as CommercialPurposePolicyDocument | null);
      if (row.mode !== "shadow" || Number(row.policy_version) !== CRO02_POLICY_VERSION || actualFp !== expectedFp) {
        throw new Error(`CRO02_POLICY_INIT_CONFLICT:${effect}`);
      }
    }

    // Step 2: insert only the canonical rows that are missing. ON CONFLICT DO
    // NOTHING makes this safe under concurrent execution — the composite
    // primary key (purpose, policy_version) is the conflict target.
    for (const effect of effects) {
      if (existingByPurpose.has(effect)) continue;
      const document = CRO02_PURPOSE_POLICY_DOCUMENTS[effect];
      await tx.execute(sql`
        INSERT INTO commercial_purpose_policies (purpose, policy_version, required_edges, mode)
        VALUES (${effect}, ${CRO02_POLICY_VERSION}, ${JSON.stringify(document)}::jsonb, 'shadow')
        ON CONFLICT (purpose, policy_version) DO NOTHING
      `);
    }

    // Step 3: re-read and require exactly the eight canonical rows before
    // returning control to assertCro02PurposePolicies().
    const finalRows = rows(
      await tx.execute(sql`
        SELECT purpose, policy_version, required_edges, mode
        FROM commercial_purpose_policies
        WHERE policy_version = ${CRO02_POLICY_VERSION} AND mode = 'shadow'
      `),
    );
    if (finalRows.length !== effects.length) {
      throw new Error("CRO02_POLICY_INIT_INCOMPLETE");
    }
    const finalByPurpose = new Map(finalRows.map((r: any) => [r.purpose as string, r]));
    for (const effect of effects) {
      const row = finalByPurpose.get(effect);
      const expectedFp = commercialPurposePolicyFingerprint(CRO02_PURPOSE_POLICY_DOCUMENTS[effect]);
      const actualFp = row ? fingerprintOf(row.required_edges as CommercialPurposePolicyDocument | null) : null;
      if (!row || row.mode !== "shadow" || actualFp !== expectedFp) {
        throw new Error(`CRO02_POLICY_INIT_VERIFY_FAILED:${effect}`);
      }
    }
  });
}
