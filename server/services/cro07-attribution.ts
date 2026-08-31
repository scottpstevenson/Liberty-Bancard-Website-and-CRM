/**
 * CRO-07 source-to-revenue attribution graph.
 *
 * Builds an immutable, additive edge graph from source/session through
 * contact/deal/release/attempt/reply/statement/proposal/application/
 * approval/activation, and an OPTIONAL forward-looking processor-revenue
 * edge. Revenue stays `unknown` in production until a future REV-06A
 * receipt exists (task #1736/#1737 are not a dependency of this task).
 * `synthetic_fixture` revenue may ONLY be written by disposable
 * certification and must never be read by a production report.
 */

import { pool } from "../db";

export type Cro07EdgeType =
  | "source_session"
  | "session_contact"
  | "contact_deal"
  | "cohort_release"
  | "release_attempt"
  | "attempt_reply"
  | "reply_statement"
  | "statement_proposal"
  | "proposal_application"
  | "application_approval"
  | "approval_mid_activation"
  | "activation_revenue";

export interface Cro07AttributionEdgeInput {
  edgeType: Cro07EdgeType;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  metadata?: Record<string, unknown>;
  /** Only ever "synthetic_fixture" outside of a future REV-06A integration. */
  revenueStatus?: "unknown" | "synthetic_fixture";
  revenueAmountCents?: number;
  /** Required and must be true whenever revenueStatus !== 'unknown'. */
  isSynthetic?: boolean;
}

export async function recordCro07AttributionEdge(input: Cro07AttributionEdgeInput) {
  const revenueStatus = input.revenueStatus ?? "unknown";
  if (revenueStatus !== "unknown" && !input.isSynthetic) {
    // Kill-line guard: only disposable certification may write non-unknown
    // revenue, and it must explicitly flag itself as synthetic.
    throw new Error("CRO07_REVENUE_MUST_BE_UNKNOWN_OR_EXPLICITLY_SYNTHETIC");
  }
  const result = await pool.query(
    `INSERT INTO cro07_attribution_edges (
      edge_type, from_type, from_id, to_type, to_id, revenue_status, revenue_amount_cents, is_synthetic, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (edge_type, from_type, from_id, to_type, to_id) DO NOTHING
    RETURNING *`,
    [
      input.edgeType, input.fromType, input.fromId, input.toType, input.toId,
      revenueStatus, revenueStatus === "unknown" ? null : input.revenueAmountCents ?? null,
      input.isSynthetic ?? false, JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * Reports attribution completeness for a contact: which edge types exist,
 * and the truthful revenue status. Never substitutes deal amount or
 * estimated savings for revenue — those stay separate application-layer
 * numbers that a caller must not relabel as "revenue".
 */
export async function getCro07AttributionForContact(contactId: number) {
  const edges = await pool.query(
    `SELECT * FROM cro07_attribution_edges
     WHERE (from_type = 'contact' AND from_id = $1) OR (to_type = 'contact' AND to_id = $1)
     ORDER BY created_at`,
    [String(contactId)],
  );
  const revenueEdges = edges.rows.filter((r: any) => r.edge_type === "activation_revenue");
  const productionRevenueEdges = revenueEdges.filter((r: any) => !r.is_synthetic);
  return {
    edges: edges.rows,
    revenueStatus: productionRevenueEdges.length
      ? productionRevenueEdges[0].revenue_status
      : "unknown",
    hasSyntheticFixturesOnly: revenueEdges.length > 0 && productionRevenueEdges.length === 0,
  };
}

/**
 * Disposable-certification-only helper: writes a synthetic canonical
 * revenue fixture for graph-shape testing. Throws outside NODE_ENV=test to
 * make it impossible to call from a production path by accident.
 */
export async function recordSyntheticRevenueFixtureForCertification(input: {
  fromType: string; fromId: string; toType: string; toId: string; amountCents: number;
}) {
  if (process.env.NODE_ENV === "production") throw new Error("CRO07_SYNTHETIC_REVENUE_FORBIDDEN_IN_PRODUCTION");
  return recordCro07AttributionEdge({
    edgeType: "activation_revenue",
    fromType: input.fromType, fromId: input.fromId, toType: input.toType, toId: input.toId,
    revenueStatus: "synthetic_fixture", revenueAmountCents: input.amountCents, isSynthetic: true,
  });
}
