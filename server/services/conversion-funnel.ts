/** One bounded, versioned, read-only cohort contract for chart, table, drilldown and full CSV. */
import { pool } from "../db";
import {
  FUNNEL_STAGES,
  FUNNEL_LABELS,
  METRIC_DEFINITION_VERSION,
  FUNNEL_TIMEZONE,
  easternDayStart,
  nextDate,
  type FunnelQuery,
  csvCell,
} from "../../shared/conversion-funnel";
const stages = FUNNEL_STAGES;
const pivots = stages
  .map(
    (s) =>
      `min(v.occurred_at) FILTER(WHERE v.stage='${s}') AS ${s}_observed_at`,
  )
  .join(",");
const orderedJoins = stages
  .slice(1)
  .map(
    (stage, index) =>
      `LEFT JOIN LATERAL(SELECT min(v.occurred_at) AS at FROM observations v WHERE v.journey_key=e.journey_key AND v.business_id=e.business_id AND v.record_class='production' AND v.stage='${stage}' AND v.occurred_at >= ${index === 0 ? "e.entry_at" : `s${index}.at`} AND v.occurred_at<$8) s${index + 1} ON true`,
  )
  .join("\n");
const progress = `CASE ${[...stages.keys()]
  .reverse()
  .map((i) => `WHEN ${stages[i]} IS NOT NULL THEN ${i + 1}`)
  .join(" ")} ELSE 0 END`;
export const FUNNEL_COHORT_SQL = `WITH observations AS NOT MATERIALIZED (
 SELECT v.* FROM conversion_journey_evidence v WHERE v.ingested_at<=$3 AND NOT EXISTS(SELECT 1 FROM conversion_journey_evidence newer WHERE newer.source_type=v.source_type AND newer.source_id=v.source_id AND newer.stage=v.stage AND newer.source_version>v.source_version AND newer.ingested_at<=$3)
),entry_raw AS (
 SELECT journey_key,min(occurred_at) AS entry_at,count(DISTINCT business_id) AS business_count,min(business_id) AS business_id,
 (array_agg(dimensions ORDER BY occurred_at,id))[1] AS dimensions
 FROM observations WHERE stage='lead' AND record_class='production' AND journey_key IS NOT NULL AND business_id IS NOT NULL
 AND occurred_at >= $1 AND occurred_at < $2 GROUP BY journey_key
), entries AS (
 SELECT * FROM entry_raw WHERE business_count=1
 AND ($4::text IS NULL OR dimensions->>'vertical'=$4) AND ($5::text IS NULL OR dimensions->>'rep'=$5)
 AND ($6::text IS NULL OR dimensions->>'source'=$6) AND ($7::text IS NULL OR dimensions->>'campaign'=$7)
), stage_observations AS (
 SELECT e.journey_key,e.entry_at,e.business_id,e.dimensions,${pivots}
 FROM entries e JOIN observations v ON v.journey_key=e.journey_key AND v.business_id=e.business_id
 AND v.record_class='production' AND v.occurred_at<$8 GROUP BY e.journey_key,e.entry_at,e.business_id,e.dimensions
),milestones AS(SELECT e.*,e.entry_at AS lead,${stages
  .slice(1)
  .map((s, i) => `s${i + 1}.at AS ${s}`)
  .join(",")} FROM stage_observations e ${orderedJoins}),
 journeys AS (SELECT *,${progress} AS progress FROM milestones)
`;
const values = (q: FunnelQuery, asOf: string) => [
  easternDayStart(q.start),
  easternDayStart(nextDate(q.end)),
  asOf,
  q.vertical ?? null,
  q.rep ?? null,
  q.source ?? null,
  q.campaign ?? null,
  new Date(asOf),
];
function cutoff(q: FunnelQuery) {
  const now = new Date();
  const v = q.asOf ?? now.toISOString();
  if (Date.parse(v) > now.getTime() + 1000)
    throw new Error("FUNNEL_FUTURE_SNAPSHOT");
  return v;
}
export async function readConversionFunnel(q: FunnelQuery) {
  const asOf = cutoff(q),
    args = values(q, asOf),
    c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL statement_timeout='5000'");
    const counts = (
      await c.query(
        FUNNEL_COHORT_SQL +
          `SELECT count(*)::int AS entered,${stages.map((s, i) => `count(*) FILTER(WHERE progress>=${i + 1})::int AS ${s},count(${s}_observed_at)::int AS ${s}_observed`).join(",")} FROM journeys`,
        args,
      )
    ).rows[0];
    const breakdown = (
      await c.query(
        FUNNEL_COHORT_SQL +
          `SELECT COALESCE(dimensions->>$9,'unknown') AS dimension,count(*)::int AS entered,${stages.map((s, i) => `count(*) FILTER(WHERE progress>=${i + 1})::int AS ${s}`).join(",")} FROM journeys GROUP BY 1 ORDER BY entered DESC,dimension LIMIT 101`,
        [...args, q.breakdown],
      )
    ).rows;
    const selectedStage = q.stage ? stages.indexOf(q.stage) + 1 : 1;
    const items = (
      await c.query(
        FUNNEL_COHORT_SQL +
          `SELECT journey_key,business_id,entry_at,dimensions,progress,${stages.join(",")} FROM journeys WHERE progress >= $9 AND ($10::text IS NULL OR journey_key>$10) ORDER BY journey_key LIMIT $11`,
        [...args, selectedStage, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    const coverage = (
      await c.query(
        `SELECT count(*)::int AS observations,count(*) FILTER(WHERE journey_key IS NULL OR business_id IS NULL)::int AS unlinked,
   count(*) FILTER(WHERE record_class='unknown')::int AS unknown,count(*) FILTER(WHERE record_class='test')::int AS excluded_test
   FROM conversion_journey_evidence WHERE occurred_at >= $1 AND occurred_at<$2 AND ingested_at<=$3`,
        args.slice(0, 3),
      )
    ).rows[0];
    const sources = (
      await c.query(
        `SELECT source_type,status,reason,observed_at FROM conversion_evidence_checkpoints WHERE source_type NOT IN ('phase7_evaluator_cursor','phase7_sendgrid_cursor') ORDER BY source_type`,
      )
    ).rows;
    await c.query("COMMIT");
    const hasMore = items.length > q.limit;
    if (hasMore) items.pop();
    return {
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      meta: {
        asOf,
        timezone: FUNNEL_TIMEZONE,
        unit: "canonical_business_sales_journey",
        journeyRule:
          "One canonical business and sales deal per journey; repeat deals are separate journeys. Missing prior milestones are never inferred.",
        cohort: {
          start: q.start,
          end: q.end,
          startUtc: args[0],
          endUtcExclusive: args[1],
          observationEnd: asOf,
        },
        filters: {
          vertical: q.vertical,
          rep: q.rep,
          source: q.source,
          campaign: q.campaign,
        },
        actorScope: "authorized_admin_manager_company_reporting",
        snapshot:
          "repeatable_read_with_immutable_ingestion_cutoff_and_frozen_entry_dimensions",
        completeness:
          sources.every((s) => s.status === "complete") && sources.length >= 7
            ? "complete"
            : "partial",
        coverage,
        sources,
        dimensionMode: "at_acquisition",
        financialRevenue: "not_a_revenue_report",
        limitations: [
          "Historical evidence reconciliation has not been run.",
          "Unlinked facts remain visible in coverage and do not become guessed journeys.",
          "Qualified replies require verified human qualification.",
          "Stage rates use the same entered journeys and ordered milestone evidence.",
        ],
      },
      stages: stages.map((s, i) => ({
        key: s,
        label: FUNNEL_LABELS[s],
        count: counts[s],
        observedJourneys: counts[s + "_observed"],
        missingOrOutOfOrder: counts[s + "_observed"] - counts[s],
        adjacentDenominator: i ? counts[stages[i - 1]] : counts.entered,
        adjacentRate:
          (i ? counts[stages[i - 1]] : counts.entered) > 0
            ? counts[s] / (i ? counts[stages[i - 1]] : counts.entered)
            : null,
        entryRate: counts.entered > 0 ? counts[s] / counts.entered : null,
      })),
      breakdown: {
        by: q.breakdown,
        items: breakdown.slice(0, 100),
        complete: breakdown.length <= 100,
      },
      drilldown: {
        stage: q.stage ?? "lead",
        items,
        hasMore,
        nextCursor: hasMore ? items.at(-1)?.journey_key : null,
        total: counts[q.stage ?? "lead"],
      },
      entered: counts.entered,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
/** Server cursor covers every matching authorized journey, independent of the visible page size. */
export async function* exportConversionFunnel(q: FunnelQuery) {
  const asOf = cutoff(q),
    c = await pool.connect();
  const deadline = Date.now() + 60000;
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL statement_timeout='5000'");
    const selectedStage = q.stage ? stages.indexOf(q.stage) + 1 : 1;
    await c.query(
      `DECLARE phase7_export NO SCROLL CURSOR FOR ${FUNNEL_COHORT_SQL} SELECT journey_key,business_id,entry_at,dimensions,progress,${stages.join(",")} FROM journeys WHERE progress >= $9 ORDER BY journey_key`,
      [...values(q, asOf), selectedStage],
    );
    yield (
      [
        "journey",
        "business_id",
        "entry_at",
        "vertical",
        "rep",
        "source",
        "campaign",
        ...stages,
      ]
        .map(csvCell)
        .join(",") + "\r\n"
    );
    while (true) {
      if (Date.now() > deadline) throw new Error("FUNNEL_EXPORT_DEADLINE");
      const rows = (await c.query("FETCH FORWARD 1000 FROM phase7_export"))
        .rows;
      if (!rows.length) break;
      for (const r of rows)
        yield (
          [
            r.journey_key,
            r.business_id,
            new Date(r.entry_at).toISOString(),
            r.dimensions.vertical,
            r.dimensions.rep,
            r.dimensions.source,
            r.dimensions.campaign,
            ...stages.map((s) => (r[s] ? new Date(r[s]).toISOString() : "")),
          ]
            .map(csvCell)
            .join(",") + "\r\n"
        );
    }
    await c.query("CLOSE phase7_export");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
