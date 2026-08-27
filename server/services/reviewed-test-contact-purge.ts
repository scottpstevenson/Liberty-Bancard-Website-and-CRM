import type { PoolClient } from "pg";
import { pool } from "../db";
import { deleteBoundContactFromGhl } from "./ghl-delete-sync";

export const REVIEWED_TEST_CONTACT_PURGE_CONFIRMATION =
  "PURGE REVIEWED SYNTHETIC CONTACTS V1";

export const REVIEWED_TEST_CONTACT_IDS = [
  158917, 158918, 158919, 158920, 158921, 158922, 158925, 158926, 158927,
  158928, 158944, 158988, 158989, 158990, 158991, 158992, 158993, 159055,
  159056, 159057, 159058, 159059, 159060, 159063, 159064, 159065, 159066,
  159098, 159099, 159100, 159101, 159102, 159103, 159105, 159106, 159107,
  159108, 159148, 159149, 159150, 159151, 159152, 159153, 159217, 159218,
  159219, 159220, 159221, 159222, 159240, 159241, 159242, 159243, 159244,
  159245, 159246, 159247, 159248, 159249, 159250, 159294, 159295, 159296,
  159297, 159298, 159299, 159361, 159362, 159363, 159364, 159365, 159366,
  159384, 159428, 159429, 159430, 159431, 159432, 159433,
] as const;

export const REVIEWED_TEST_CONTACT_GHL_BINDINGS = new Map<number, string>([
  [158922, "LC4Q11nWAOw3ZxSebLbG"],
  [158925, "TZHEPHPNEbmHBTocoxRW"],
  [158926, "gWxMuUbtZKd7tsUxAmn6"],
  [158927, "uy0z8WFwKCx5oMElQJG9"],
  [158928, "Ba0DqaNzyiondO4bu1Nw"],
  [158993, "ZMoMYIhnTmZRiGHF0kf3"],
  [159060, "Y3KIB5B8Bl4IcH8270o3"],
  [159063, "wOxmk6LSs3E0TerOzD23"],
  [159064, "c77YsN2XwuFtWrlj4QG6"],
  [159065, "NzspA8XQa7EuyqC8SMnR"],
  [159066, "khxqiZeLfUuNuiZByx9j"],
  [159108, "IMnenMpjei7H6Mr0bsSi"],
  [159153, "hynfM5AWodLNgVku5tsO"],
  [159222, "4J5HipCv5wiZXj9TYEAZ"],
  [159299, "m4ew1jYUvEunAxL9ltL1"],
  [159366, "OL4DVoKAxhmzGIsJyFjQ"],
  [159432, "RLOOEswwnYFbdWSYwkO9"],
  [159433, "nzqbVForZyxnF3tDJBcw"],
]);

const SYNTHETIC_DOMAINS = new Set([
  "libertybancard.test",
  "test.internal",
]);

const DELETE_DIRECT_REFERENCES = new Set([
  "campaign_preview_members.contact_id",
  "contact_ai_cache.contact_id",
  "contact_identity_observations.contact_id",
  "contact_lead_scoring_jobs.contact_id",
  "contact_merge_operations.deprecated_contact_id",
  "contact_merge_operations.survivor_contact_id",
  "contact_merge_redirects.deprecated_contact_id",
  "contact_merge_redirects.survivor_contact_id",
  "contact_nba.contact_id",
  "contact_provider_projections.contact_id",
  "contact_source_events.contact_id",
  "eligibility_snapshots.contact_id",
  "lead_sources.contact_id",
  "merchant_health_scores.contact_id",
  "merchant_mids.contact_id",
  "nba_recommendation_history.contact_id",
  "promotional_enrollment_jobs.contact_id",
  "save_cases.contact_id",
  "sequence_enrollments.contact_id",
  "statement_requests.contact_id",
  "sync_conflicts.contact_id",
  "tasks.contact_id",
  "validation_intents.contact_id",
]);

const DETACH_DIRECT_REFERENCES = new Set([
  "ai_corrections.contact_id",
  "ai_decision_log.contact_id",
  "calendar_events.contact_id",
  "call_logs.contact_id",
  "chargebacks.contact_id",
  "co_branded_proposals.contact_id",
  "communication_events.contact_id",
  "consent_audit_logs.contact_id",
  "contacts.parent_contact_id",
  "deals.contact_id",
  "documents.contact_id",
  "email_logs.contact_id",
  "enrichment_runs.contact_id",
  "equipment_orders.contact_id",
  "equipment_shipments.contact_id",
  "ghl_activity_log.contact_id",
  "health_alerts.contact_id",
  "import_row_dispositions.contact_id",
  "inbox_items.contact_id",
  "live_chats.contact_id",
  "ma_events.counterparty_contact_id",
  "merchant_applications.contact_id",
  "merchant_profiles.contact_id",
  "merchant_referrals.referred_contact_id",
  "merchant_residuals.contact_id",
  "mid_daily_stats.contact_id",
  "nps_responses.contact_id",
  "outbound_messages.contact_id",
  "outbound_send_log.contact_id",
  "prospects.contact_id",
  "prospects.conversion_contact_id",
  "rate_review_requests.contact_id",
  "referrals.contact_id",
  "review_requests.contact_id",
  "rfis.contact_id",
  "sdr_lead_state.contact_id",
  "statement_proposals.contact_id",
  "statement_reviews.contact_id",
  "statement_upload_commands.contact_id",
  "testimonial_submissions.contact_id",
  "tickets.contact_id",
]);

const CASCADE_DIRECT_REFERENCES = new Set([
  "ai_corrections.contact_id",
  "communication_events.contact_id",
  "contact_lifecycle_history.contact_id",
  "contact_nba.contact_id",
  "contact_provider_projections.contact_id",
  "eligibility_snapshots.contact_id",
  "equipment_shipments.contact_id",
  "merchant_mids.contact_id",
  "nba_recommendation_history.contact_id",
  "promotional_enrollment_jobs.contact_id",
  "save_cases.contact_id",
  "validation_intents.contact_id",
]);

interface ReviewedContact {
  id: number;
  email: string;
  ghl_contact_id: string | null;
}

interface DirectReference {
  table_name: string;
  column_name: string;
  not_null: boolean;
  delete_action: string;
}

export interface ReviewedPurgePreflight {
  expected: number;
  present: number;
  stillSynthetic: number;
  ghlLinked: number;
  ready: boolean;
}

export interface ReviewedPurgeResult extends ReviewedPurgePreflight {
  ghlDeleted: number;
  ghlSkipped: number;
  localDeleted: number;
  detachedRows: number;
  deletedDependentRows: number;
  archivedDeals: number;
}

function assertSafeIdentifier(value: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
}

export function isReviewedSyntheticEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 && SYNTHETIC_DOMAINS.has(normalized.slice(at + 1));
}

export function reviewedGhlBindingsMatch(
  rows: Array<{ id: number; ghl_contact_id: string | null }>,
): boolean {
  const linkedCount = rows.filter((row) => row.ghl_contact_id !== null).length;
  return (
    linkedCount === REVIEWED_TEST_CONTACT_GHL_BINDINGS.size &&
    rows.every((row) => {
      const expectedGhlId = REVIEWED_TEST_CONTACT_GHL_BINDINGS.get(row.id) ?? null;
      return row.ghl_contact_id === expectedGhlId;
    })
  );
}

async function loadReviewedContacts(
  client: Pick<PoolClient, "query">,
  lock = false,
): Promise<ReviewedContact[]> {
  const result = await client.query<ReviewedContact>(
    `SELECT id, email, ghl_contact_id
       FROM contacts
      WHERE id = ANY($1::int[])
      ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    [Array.from(REVIEWED_TEST_CONTACT_IDS)],
  );
  return result.rows;
}

function summarizePreflight(rows: ReviewedContact[]): ReviewedPurgePreflight {
  const stillSynthetic = rows.filter((row) =>
    isReviewedSyntheticEmail(row.email),
  ).length;
  const ghlLinked = rows.filter((row) => row.ghl_contact_id !== null).length;
  const ghlBindingsMatch = reviewedGhlBindingsMatch(rows);
  return {
    expected: REVIEWED_TEST_CONTACT_IDS.length,
    present: rows.length,
    stillSynthetic,
    ghlLinked,
    ready:
      rows.length === REVIEWED_TEST_CONTACT_IDS.length &&
      stillSynthetic === REVIEWED_TEST_CONTACT_IDS.length &&
      ghlBindingsMatch,
  };
}

function assertReady(preflight: ReviewedPurgePreflight): void {
  if (!preflight.ready) {
    throw new Error(
      `Reviewed purge manifest drifted: expected ${preflight.expected}, present ${preflight.present}, synthetic ${preflight.stillSynthetic}`,
    );
  }
}

async function loadDirectReferences(
  client: Pick<PoolClient, "query">,
): Promise<DirectReference[]> {
  const result = await client.query<DirectReference>(`
    SELECT child.relname AS table_name,
           attribute.attname AS column_name,
           attribute.attnotnull AS not_null,
           constraint_row.confdeltype AS delete_action
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace
      JOIN unnest(constraint_row.conkey) WITH ORDINALITY child_key(attnum, ord) ON true
      JOIN unnest(constraint_row.confkey) WITH ORDINALITY parent_key(attnum, ord)
        ON parent_key.ord = child_key.ord
      JOIN pg_attribute attribute
        ON attribute.attrelid = child.oid
       AND attribute.attnum = child_key.attnum
     WHERE constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.contacts'::regclass
       AND namespace_row.nspname = 'public'
     ORDER BY child.relname, attribute.attname
  `);
  return result.rows;
}

function assertReferencesClassified(references: DirectReference[]): void {
  const unknown = references
    .map((reference) => `${reference.table_name}.${reference.column_name}`)
    .filter(
      (key) =>
        !DELETE_DIRECT_REFERENCES.has(key) &&
        !DETACH_DIRECT_REFERENCES.has(key) &&
        !CASCADE_DIRECT_REFERENCES.has(key),
    );
  if (unknown.length > 0) {
    throw new Error(
      `Reviewed purge blocked by unclassified contact references: ${unknown.join(", ")}`,
    );
  }
}

export async function preflightReviewedTestContactPurge(): Promise<ReviewedPurgePreflight> {
  const rows = await loadReviewedContacts(pool);
  return summarizePreflight(rows);
}

export async function executeReviewedTestContactPurge(
  actorUserId: string | null,
): Promise<ReviewedPurgeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedRows = await loadReviewedContacts(client, true);
    const locked = summarizePreflight(lockedRows);
    assertReady(locked);

    let ghlDeleted = 0;
    let ghlSkipped = 0;
    for (const row of lockedRows) {
      const expectedGhlId = REVIEWED_TEST_CONTACT_GHL_BINDINGS.get(row.id);
      if (!expectedGhlId) {
        ghlSkipped++;
        continue;
      }
      const result = await deleteBoundContactFromGhl(row.id, expectedGhlId);
      if (!result.ok || result.reason === "ghl_not_configured") {
        throw new Error(
          `GHL deletion failed for reviewed contact ${row.id}: ${result.reason ?? "unknown error"}`,
        );
      }
      ghlDeleted++;
    }

    const references = await loadDirectReferences(client);
    assertReferencesClassified(references);

    let detachedRows = 0;
    let deletedDependentRows = 0;
    const archivedDealsResult = await client.query(
      `UPDATE deals
          SET archived_at = COALESCE(archived_at, NOW()),
              updated_at = NOW()
        WHERE contact_id = ANY($1::int[])`,
      [Array.from(REVIEWED_TEST_CONTACT_IDS)],
    );

    for (const reference of references) {
      const key = `${reference.table_name}.${reference.column_name}`;
      assertSafeIdentifier(reference.table_name);
      assertSafeIdentifier(reference.column_name);

      if (reference.table_name === "contacts") {
        const result = await client.query(
          `UPDATE contacts
              SET parent_contact_id = NULL
            WHERE parent_contact_id = ANY($1::int[])
              AND id <> ALL($1::int[])`,
          [Array.from(REVIEWED_TEST_CONTACT_IDS)],
        );
        detachedRows += result.rowCount ?? 0;
        continue;
      }

      if (CASCADE_DIRECT_REFERENCES.has(key)) continue;

      if (DELETE_DIRECT_REFERENCES.has(key)) {
        const result = await client.query(
          `DELETE FROM ${reference.table_name}
                 WHERE ${reference.column_name} = ANY($1::int[])`,
          [Array.from(REVIEWED_TEST_CONTACT_IDS)],
        );
        deletedDependentRows += result.rowCount ?? 0;
        continue;
      }

      if (reference.not_null) {
        throw new Error(`Cannot detach required contact reference ${key}`);
      }
      const result = await client.query(
        `UPDATE ${reference.table_name}
            SET ${reference.column_name} = NULL
          WHERE ${reference.column_name} = ANY($1::int[])`,
        [Array.from(REVIEWED_TEST_CONTACT_IDS)],
      );
      detachedRows += result.rowCount ?? 0;
    }

    const deleteResult = await client.query(
      `DELETE FROM contacts
             WHERE id = ANY($1::int[])
         RETURNING id`,
      [Array.from(REVIEWED_TEST_CONTACT_IDS)],
    );
    if (deleteResult.rowCount !== REVIEWED_TEST_CONTACT_IDS.length) {
      throw new Error(
        `Local purge deleted ${deleteResult.rowCount ?? 0} contacts; expected ${REVIEWED_TEST_CONTACT_IDS.length}`,
      );
    }

    const summary: ReviewedPurgeResult = {
      ...locked,
      ghlDeleted,
      ghlSkipped,
      localDeleted: deleteResult.rowCount,
      detachedRows,
      deletedDependentRows,
      archivedDeals: archivedDealsResult.rowCount ?? 0,
    };

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, details, created_at)
       VALUES ($1, 'reviewed_test_contacts_purged', 'contact_purge', $2::jsonb, NOW())`,
      [
        actorUserId,
        JSON.stringify({
          manifest: "synthetic-reviewed-v1",
          expected: summary.expected,
          ghlDeleted: summary.ghlDeleted,
          ghlSkipped: summary.ghlSkipped,
          localDeleted: summary.localDeleted,
          detachedRows: summary.detachedRows,
          deletedDependentRows: summary.deletedDependentRows,
          archivedDeals: summary.archivedDeals,
        }),
      ],
    );

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}