import { pool } from "../db";
/** Non-sending repair of existing observations using the original canonical source's explicit relation only.
 * No historical stage or nearest-deal inference. The same-transaction source triggers own new observations.
 */
export async function reconcilePhase7ConversionEvidence(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("PHASE7_RECONCILIATION_LIMIT");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout='5000'");
    const candidates = (
      await c.query(
        `WITH pending AS(SELECT DISTINCT ON(source_type,source_id,stage) * FROM conversion_journey_evidence WHERE source_type IN('inbound_request','statement_request','statement_upload') ORDER BY source_type,source_id,stage,source_version DESC),links AS(
 SELECT e.*,r.contact_id AS current_contact,r.deal_id AS current_deal FROM pending e JOIN inbound_requests r ON e.source_type='inbound_request' AND r.id::text=e.source_id
 UNION ALL SELECT e.*,r.contact_id,r.deal_id FROM pending e JOIN statement_requests r ON e.source_type='statement_request' AND r.id::text=e.source_id
 UNION ALL SELECT e.*,r.contact_id,r.deal_id FROM pending e JOIN statement_upload_commands r ON e.source_type='statement_upload' AND e.source_id=r.id::text||':document:'||r.document_id::text)
 SELECT l.* FROM links l JOIN contacts c ON c.id=l.current_contact JOIN deals d ON d.id=l.current_deal JOIN contacts dc ON dc.id=d.contact_id WHERE (d.contact_id=c.id OR dc.business_id=c.business_id) AND d.pipeline='sales' AND d.record_class='production' AND d.archived_at IS NULL AND c.record_class='production' AND c.archived_at IS NULL AND l.journey_key IS NULL AND c.business_id IS NOT NULL AND l.current_deal IS NOT NULL ORDER BY l.ingested_at,l.id LIMIT $1`,
        [limit],
      )
    ).rows;
    let repaired = 0;
    for (const row of candidates) {
      await c.query(`SELECT phase7_emit_conversion($1,$2,$3,$4,$5,$6,$7)`, [
        row.source_type,
        row.source_id,
        row.stage,
        row.current_contact,
        row.current_deal,
        row.occurred_at,
        JSON.stringify({ source: row.dimensions.source ?? "unknown" }),
      ]);
      repaired++;
    }
    await c.query("COMMIT");
    return {
      examined: candidates.length,
      repaired,
      complete: candidates.length < limit,
      historicalReplay: false,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
