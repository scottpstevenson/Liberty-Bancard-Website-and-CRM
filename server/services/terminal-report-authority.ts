import { pool } from "../db";
import { syntheticQaIdentitySql } from "@shared/synthetic-qa-identity";

/** Recommendation/cost snapshots are modelling inputs, not deployment or cash
 * receipts. Aggregate full scoped population; only details are page-bounded.
 */
export async function readTerminalRecommendationReport(page: number, thresholds: { greenThresholdMonths: number; yellowThresholdMonths: number }) {
  const asOf = new Date();
  const result = await pool.query(`
    WITH recommendations AS (
      SELECT d.id,d.stage,d.closed_at,d.terminal_recommendation,d.terminal_approval_status,
        COALESCE(NULLIF(c.company_name,''),NULLIF(concat_ws(' ',c.first_name,c.last_name),''),'Deal #'||d.id) AS merchant_name,
        COALESCE(d.terminal_cost_at_order,m.liberty_cost) AS forecast_cost,
        CASE WHEN regexp_replace(COALESCE(d.estimated_gross_profit_monthly,''),'[^0-9.-]','','g') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN regexp_replace(d.estimated_gross_profit_monthly,'[^0-9.-]','','g')::numeric ELSE NULL END AS forecast_gp
      FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id
      LEFT JOIN LATERAL (SELECT CASE WHEN count(*)=1 THEN min(liberty_cost) ELSE NULL END AS liberty_cost
        FROM equipment_models WHERE is_active=true AND lower(name)=lower(d.terminal_recommendation)) m ON TRUE
      WHERE d.record_class='production' AND d.archived_at IS NULL AND d.terminal_recommendation IS NOT NULL
        AND (d.contact_id IS NULL OR (c.id IS NOT NULL AND c.record_class='production'
          AND c.archived_at IS NULL AND NOT ${syntheticQaIdentitySql("c")}))
    ), forecasts AS (
      SELECT *,CASE WHEN forecast_gp>0 AND forecast_cost IS NOT NULL THEN ceil(forecast_cost/forecast_gp) ELSE NULL END AS months
      FROM recommendations
    ), summary AS (
      SELECT COUNT(*)::int AS total, SUM(forecast_cost)::float8 AS forecast_cost,
        COUNT(*) FILTER(WHERE forecast_cost IS NULL)::int AS missing_cost,
        COUNT(*) FILTER(WHERE months<=$2)::int AS green,
        COUNT(*) FILTER(WHERE months>$2 AND months<=$3)::int AS yellow,
        COUNT(*) FILTER(WHERE months>$3)::int AS red,
         COUNT(*) FILTER(WHERE closed_at>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC')
           AND closed_at<=($1::timestamptz AT TIME ZONE 'UTC'))::int AS month_count,
         COUNT(*) FILTER(WHERE closed_at>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC')
           AND closed_at<=($1::timestamptz AT TIME ZONE 'UTC') AND forecast_cost IS NULL)::int AS month_missing_cost,
         SUM(forecast_cost) FILTER(WHERE closed_at>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC')
           AND closed_at<=($1::timestamptz AT TIME ZONE 'UTC'))::float8 AS month_cost
      FROM forecasts
    ), details AS (SELECT * FROM forecasts ORDER BY id LIMIT 100 OFFSET $4)
    SELECT row_to_json(summary) AS summary,COALESCE((SELECT json_agg(details) FROM details),'[]'::json) AS details FROM summary
  `, [asOf, thresholds.greenThresholdMonths, thresholds.yellowThresholdMonths, page * 100]);
  const { summary, details } = result.rows[0];
  return {
    rows: details.map((r: any) => ({
      dealId: r.id, merchantName: r.merchant_name, terminalModel: r.terminal_recommendation,
      terminalCost: r.forecast_cost, monthlyGP: r.forecast_gp, monthlyVolume: null,
      paybackMonths: r.months === null ? null : Number(r.months), paybackStatus: "unknown",
      tier: r.months === null ? "unknown" : Number(r.months) <= thresholds.greenThresholdMonths ? "green"
        : Number(r.months) <= thresholds.yellowThresholdMonths ? "yellow" : "red",
      stage: r.stage, terminalApprovalStatus: r.terminal_approval_status, closedAt: r.closed_at,
      evidence: "recommendation_only", verifiedDeployment: null, actualCashRecovery: null,
    })),
    summary: {
      totalRecommendations: summary.total, totalDeployedTerminals: null,
      forecastCost: summary.missing_cost > 0 ? null : (summary.forecast_cost ?? 0), totalCost: null, missingForecastCostCount: summary.missing_cost,
       thisMonthCount: summary.month_count,
       thisMonthCost: summary.month_missing_cost > 0 ? null : (summary.month_cost ?? 0),
      atRiskCount: summary.red, paidOffCount: null,
      greenCount: summary.green, yellowCount: summary.yellow, redCount: summary.red,
      verifiedDeployment: null, actualCashRecovery: null,
    },
    meta: { version: 1, population: "non_archived_production_terminal_recommendations", actorScope: "management",
      asOf: asOf.toISOString(), timezone: "UTC", currency: "USD", unit: "recommendations",
      forecast: "cost snapshot or exact model price divided by estimated monthly gross profit; no actual cash ledger",
      actualEvidence: "unavailable", page, pageSize: 100, total: summary.total, snapshot: "single_statement" },
    generatedAt: asOf.toISOString(),
  };
}