/**
 * READ-ONLY dependency inventory for stale test contacts.
 * Matching prefixes: wh-test-ghl-*, ghl-deal-test-*, c1-test-*, venroll-test-*, go-live-check-*
 * Zero mutations — only COUNT and detail queries.
 */
import { pool } from "../server/db";

const PREFIXES = [
  "wh-test-ghl-%",
  "ghl-deal-test-%",
  "c1-test-%",
  "venroll-test-%",
  "go-live-check-%",
];

const WHERE_CLAUSE = PREFIXES.map((_, i) => `ghl_contact_id ILIKE $${i + 1}`).join(" OR ");

async function q(label: string, sql: string, params: unknown[] = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`\n=== ${label} === ERROR: ${msg}`);
  }
}

async function run() {
  console.log(`Observation time: ${new Date().toISOString()}`);

  // ── 1. Master count: stale test contacts by prefix ───────────────────────
  await q("STALE_CONTACTS_BY_PREFIX", `
    SELECT
      CASE
        WHEN ghl_contact_id ILIKE 'wh-test-ghl-%' THEN 'wh-test-ghl-*'
        WHEN ghl_contact_id ILIKE 'ghl-deal-test-%' THEN 'ghl-deal-test-*'
        WHEN ghl_contact_id ILIKE 'c1-test-%' THEN 'c1-test-*'
        WHEN ghl_contact_id ILIKE 'venroll-test-%' THEN 'venroll-test-*'
        WHEN ghl_contact_id ILIKE 'go-live-check-%' THEN 'go-live-check-*'
        ELSE 'other'
      END AS prefix_group,
      COUNT(*) AS n
    FROM contacts
    WHERE (${WHERE_CLAUSE})
    GROUP BY 1 ORDER BY n DESC`, PREFIXES);

  // Get the actual contact IDs for FK lookups
  const idResult = await pool.query(`
    SELECT id FROM contacts WHERE (${WHERE_CLAUSE})`, PREFIXES);
  const ids = idResult.rows.map((r: { id: number }) => r.id);
  console.log(`\n=== STALE_CONTACT_IDS_COUNT === ${ids.length} contact IDs found`);
  if (ids.length === 0) { await pool.end(); return; }

  // ── 2. Deals ─────────────────────────────────────────────────────────────
  await q("DEP_DEALS", `
    SELECT COUNT(*) AS n, COUNT(DISTINCT contact_id) AS unique_contacts
    FROM deals WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 3. SDR merchants (may reference by contact id or ghl_contact_id) ─────
  await q("DEP_SDR_MERCHANTS_BY_CONTACT", `
    SELECT COUNT(*) AS n
    FROM sdr_merchants
    WHERE primary_contact_id = ANY($1::int[])`, [ids]);

  await q("DEP_SDR_MERCHANTS_GHL_ID", `
    SELECT COUNT(*) AS n
    FROM sdr_merchants
    WHERE ghl_contact_id = ANY(
      SELECT ghl_contact_id FROM contacts WHERE (${WHERE_CLAUSE})
    )`, PREFIXES);

  // ── 4. SDR lead state ────────────────────────────────────────────────────
  await q("DEP_SDR_LEAD_STATE", `
    SELECT COUNT(*) AS n FROM sdr_lead_state
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 5. SDR lead events ───────────────────────────────────────────────────
  await q("DEP_SDR_LEAD_EVENTS", `
    SELECT COUNT(*) AS n FROM sdr_lead_events
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 6. Contact source events ─────────────────────────────────────────────
  await q("DEP_CONTACT_SOURCE_EVENTS", `
    SELECT COUNT(*) AS n FROM contact_source_events
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 7. Communication events ───────────────────────────────────────────────
  await q("DEP_COMMUNICATION_EVENTS", `
    SELECT COUNT(*) AS n FROM communication_events
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 8. Post-enrichment enrollment intents ────────────────────────────────
  await q("DEP_PE_INTENTS", `
    SELECT COUNT(*) AS n FROM post_enrichment_enrollment_intents
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 9. ZeroBounce attempts ────────────────────────────────────────────────
  await q("DEP_ZB_ATTEMPTS", `
    SELECT COUNT(*) AS n FROM zerobounce_attempts
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 10. Sequence enrollments (if table exists) ────────────────────────────
  await q("DEP_SEQUENCE_ENROLLMENTS", `
    SELECT COUNT(*) AS n FROM sequence_enrollments
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 11. Analytics events ──────────────────────────────────────────────────
  await q("DEP_ANALYTICS_EVENTS", `
    SELECT COUNT(*) AS n FROM analytics_events
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 12. Save cases ────────────────────────────────────────────────────────
  await q("DEP_SAVE_CASES", `
    SELECT COUNT(*) AS n FROM save_cases
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 13. Entity memory ─────────────────────────────────────────────────────
  await q("DEP_ENTITY_MEMORY", `
    SELECT COUNT(*) AS n FROM entity_memory
    WHERE entity_id = ANY(SELECT id::text FROM contacts WHERE (${WHERE_CLAUSE}))
       OR entity_id = ANY(SELECT ghl_contact_id FROM contacts WHERE (${WHERE_CLAUSE}))`, [...PREFIXES, ...PREFIXES]);

  // ── 14. Lifecycle events ──────────────────────────────────────────────────
  await q("DEP_LIFECYCLE_EVENTS", `
    SELECT COUNT(*) AS n FROM lifecycle_events
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 15. Audit logs (related_id = contact id, as text) ────────────────────
  await q("DEP_AUDIT_LOGS", `
    SELECT COUNT(*) AS n FROM audit_logs
    WHERE related_id = ANY(SELECT id::text FROM contacts WHERE (${WHERE_CLAUSE}))`, PREFIXES);

  // ── 16. SLA tasks ─────────────────────────────────────────────────────────
  await q("DEP_SLA_TASKS", `
    SELECT COUNT(*) AS n FROM tasks
    WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 17. Deals with GHL opportunity IDs (would break GHL sync if left) ────
  await q("DEALS_WITH_GHL_OPPORTUNITY", `
    SELECT COUNT(*) AS n, COUNT(ghl_opportunity_id) AS n_with_ghl_opp
    FROM deals WHERE contact_id = ANY($1::int[])`, [ids]);

  // ── 18. Sample of contacts (10 rows) for manual review ───────────────────
  await q("STALE_CONTACTS_SAMPLE", `
    SELECT id, email, first_name, last_name, ghl_contact_id, created_at
    FROM contacts WHERE (${WHERE_CLAUSE})
    ORDER BY created_at DESC LIMIT 10`, PREFIXES);

  // ── 19. Orphaned merchants (no primary_contact_id but ghl_contact_id matches) ─
  await q("DEP_SDR_MERCHANTS_ORPHANED", `
    SELECT COUNT(*) AS n FROM sdr_merchants m
    WHERE primary_contact_id IS NULL
      AND EXISTS (
        SELECT 1 FROM contacts c
        WHERE (${WHERE_CLAUSE.replace(/ghl_contact_id/g, 'c.ghl_contact_id')})
          AND c.ghl_contact_id = m.ghl_contact_id
      )`, PREFIXES);

  await pool.end();
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
