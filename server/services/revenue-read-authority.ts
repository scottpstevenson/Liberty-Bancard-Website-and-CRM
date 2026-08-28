import { pool } from "../db";
import { OPEN_SALES_LEAD_STAGES } from "@shared/schema";
import { authorizeCommercialUseBatch } from "./commercial-resolution";

export type RevenueUser = { role?: string; email?: string | null };
export type RevenueFilters = {
  limit: number; offset: number; search?: string; status?: string; emailHealth?: string;
  assignedTo?: string; archived?: boolean; recordClass?: string; sort?: string;
  churnRisk?: string; noOutreach?: string; blocked?: boolean; vertical?: string; tag?: string;
  contactedToday?: boolean; hasAssignee?: boolean; leadSource?: string; lifecycle?: string;
  stale?: boolean; recentlyUpdated?: boolean; neverContacted?: boolean; notContactedIn30?: boolean;
  noDeal?: boolean; createdThisWeek?: boolean; pipeline?: string;
};

const privileged = (user: RevenueUser) => user.role === "admin" || user.role === "manager";
const observeRevenueSubjects = async (
  user: RevenueUser,
  subjects: Array<{ subjectType: "contact" | "deal"; subjectId: number }>,
) => {
  await authorizeCommercialUseBatch({
    subjects, effect: "commercial_reporting",
    observationScope: privileged(user) ? "all" : "owned_or_unassigned",
    maxSubjects: Math.max(1, subjects.length),
  }).catch((error) => {
    console.error("[CRO02_REVENUE_OBSERVATION_FAILED]", {
      count: subjects.length,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  });
};

/** SQL ownership is deliberately expressed at every canonical read boundary. */
function contactScope(user: RevenueUser, alias = "c", values: unknown[] = []): string {
  if (privileged(user)) return "TRUE";
  // Unassigned records remain in an agent's work queue; assigned records and
  // records with a deal owned by the agent are visible only to that agent.
  values.push(user.email ?? "");
  const p = `$${values.length}`;
  return `(${alias}.assigned_to IS NULL OR ${alias}.assigned_to = ${p} OR EXISTS (
    SELECT 1 FROM deals ownership_deal WHERE ownership_deal.contact_id = ${alias}.id
      AND ownership_deal.archived_at IS NULL AND ownership_deal.owner = ${p}
  ))`;
}

function addContactFilters(filters: RevenueFilters, values: unknown[], alias = "c"): string[] {
  const where = [`${alias}.archived_at IS ${filters.archived ? "NOT " : ""}NULL`];
  if (filters.search) {
    values.push(`%${filters.search.trim()}%`);
    const p = `$${values.length}`;
    where.push(`(coalesce(${alias}.first_name,'') || ' ' || coalesce(${alias}.last_name,'') ILIKE ${p}
      OR coalesce(${alias}.email,'') ILIKE ${p} OR coalesce(${alias}.company_name,'') ILIKE ${p})`);
  }
  if (filters.status) { values.push(filters.status); where.push(`${alias}.status = $${values.length}`); }
  if (filters.emailHealth) { values.push(filters.emailHealth); where.push(`${alias}.email_status = $${values.length}`); }
  if (filters.assignedTo) { values.push(filters.assignedTo); where.push(`${alias}.assigned_to = $${values.length}`); }
  if (filters.recordClass) { values.push(filters.recordClass); where.push(`${alias}.record_class = $${values.length}`); }
  if (filters.churnRisk === "high") where.push(`${alias}.churn_risk_tier IN ('High', 'Critical')`);
  if (filters.noOutreach === "24h") where.push(`${alias}.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AND ${alias}.last_contacted_at IS NULL`);
  if (filters.blocked) where.push(`(${alias}.do_not_contact = TRUE OR ${alias}.email_status IN ('bounced','invalid','opted_out','unsafe'))`);
  if (filters.vertical) { values.push(filters.vertical); where.push(`${alias}.vertical = $${values.length}`); }
  if (filters.tag) { values.push(filters.tag); where.push(`$${values.length} = ANY(COALESCE(${alias}.tags, ARRAY[]::text[]))`); }
  if (filters.contactedToday) where.push(`${alias}.last_contacted_at >= CURRENT_DATE AND ${alias}.last_contacted_at < CURRENT_DATE + INTERVAL '1 day'`);
  if (filters.hasAssignee) where.push(`${alias}.assigned_to IS NOT NULL`);
  if (filters.leadSource) { values.push(filters.leadSource); where.push(`${alias}.lead_source = $${values.length}`); }
  if (filters.lifecycle) { values.push(filters.lifecycle); where.push(`${alias}.lifecycle_state = $${values.length}`); }
  if (filters.stale) where.push(`COALESCE(${alias}.last_contacted_at, ${alias}.updated_at, ${alias}.created_at, to_timestamp(0)) < CURRENT_TIMESTAMP - INTERVAL '30 days'`);
  if (filters.recentlyUpdated) where.push(`${alias}.updated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`);
  if (filters.neverContacted) where.push(`${alias}.last_contacted_at IS NULL`);
  if (filters.notContactedIn30) where.push(`(${alias}.last_contacted_at IS NULL OR ${alias}.last_contacted_at < CURRENT_TIMESTAMP - INTERVAL '30 days')`);
  if (filters.noDeal) where.push(`NOT EXISTS (SELECT 1 FROM deals no_deal WHERE no_deal.contact_id = ${alias}.id AND no_deal.archived_at IS NULL)`);
  if (filters.createdThisWeek) where.push(`${alias}.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`);
  return where;
}

function orderForPeople(sort?: string): string {
  switch (sort) {
    case "name":
    case "alpha": return "last_name ASC NULLS LAST, first_name ASC NULLS LAST, id ASC";
    case "createdAtAsc": return "created_at ASC NULLS LAST, id ASC";
    case "updatedAt": return "updated_at DESC NULLS LAST, id DESC";
    case "leadScore":
    case "score_desc": return "lead_score DESC NULLS LAST, id DESC";
    case "activity_desc": return "last_contacted_at DESC NULLS LAST, id DESC";
    case "activity_asc": return "last_contacted_at ASC NULLS LAST, id ASC";
    default: return "created_at DESC NULLS LAST, id DESC";
  }
}

function camelize(value: unknown): any {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    camelize(item),
  ]));
}

export async function readPeople(user: RevenueUser, filters: RevenueFilters) {
  const values: unknown[] = [];
  const where = addContactFilters(filters, values);
  where.push(contactScope(user, "c", values));
  const predicate = where.join(" AND ");
  values.push(filters.limit, filters.offset);
  const result = await pool.query(`
    WITH base AS MATERIALIZED (
      SELECT c.* FROM contacts c WHERE ${predicate}
    ), ordered AS (
      SELECT base.*, row_number() OVER (ORDER BY ${orderForPeople(filters.sort)}) AS __row_order
      FROM base
    ), page AS (
      SELECT * FROM ordered ORDER BY __row_order
      LIMIT $${values.length - 1} OFFSET $${values.length}
    )
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(page) - '__row_order' ORDER BY __row_order) FROM page), '[]'::jsonb) AS data,
      (SELECT COUNT(*)::int FROM base) AS total,
      COALESCE((SELECT jsonb_object_agg(record_class, facet_count)
        FROM (SELECT record_class, COUNT(*)::int AS facet_count FROM base GROUP BY record_class) class_counts), '{}'::jsonb) AS by_record_class,
      COALESCE((SELECT jsonb_object_agg(email_status, facet_count)
        FROM (SELECT email_status, COUNT(*)::int AS facet_count FROM base GROUP BY email_status) health_counts), '{}'::jsonb) AS by_email_health,
      CURRENT_TIMESTAMP AS as_of
  `, values);
  const row = result.rows[0] ?? {};
  const data = camelize(row.data ?? []);
  await observeRevenueSubjects(user, data.map((item: any) => ({ subjectType: "contact", subjectId: Number(item.id) })));
  return {
    data, total: row.total ?? 0, limit: filters.limit, offset: filters.offset,
    filters: { ...filters, recordClass: filters.recordClass ?? "all" },
    facets: camelize({ byRecordClass: row.by_record_class ?? {}, byEmailHealth: row.by_email_health ?? {} }),
    scope: privileged(user) ? "all" : "owned_or_unassigned",
    asOf: new Date(row.as_of).toISOString(),
  };
}

export async function readRevenueLeads(user: RevenueUser, filters: RevenueFilters) {
  const values: unknown[] = [OPEN_SALES_LEAD_STAGES];
  const stages = `$1::text[]`;
  const where = addContactFilters({ ...filters, archived: false, recordClass: "production" }, values);
  where.push(contactScope(user, "c", values));
  where.push(`EXISTS (SELECT 1 FROM deals qualifying_deal WHERE qualifying_deal.contact_id = c.id
    AND qualifying_deal.archived_at IS NULL AND qualifying_deal.record_class = 'production'
    AND qualifying_deal.pipeline = 'sales' AND qualifying_deal.stage = ANY(${stages}))`);
  const predicate = where.join(" AND ");
  values.push(filters.limit, filters.offset);
  const result = await pool.query(`
    WITH base AS MATERIALIZED (
      SELECT to_jsonb(c) || jsonb_build_object('primaryDeal', to_jsonb(primary_deal)) AS item,
        primary_deal.updated_at AS primary_updated_at, primary_deal.id AS primary_id, c.id AS contact_id
      FROM contacts c
      JOIN LATERAL (
        SELECT d.* FROM deals d WHERE d.contact_id = c.id AND d.archived_at IS NULL
          AND d.record_class = 'production' AND d.pipeline = 'sales' AND d.stage = ANY(${stages})
        ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1
      ) primary_deal ON TRUE
      WHERE ${predicate}
    ), ordered AS (
      SELECT base.*, row_number() OVER (
        ORDER BY primary_updated_at DESC NULLS LAST, primary_id DESC, contact_id DESC
      ) AS __row_order FROM base
    ), page AS (
      SELECT * FROM ordered ORDER BY __row_order
      LIMIT $${values.length - 1} OFFSET $${values.length}
    )
    SELECT
      COALESCE((SELECT jsonb_agg(item ORDER BY __row_order) FROM page), '[]'::jsonb) AS data,
      (SELECT COUNT(*)::int FROM base) AS total,
      CURRENT_TIMESTAMP AS as_of
  `, values);
  const row = result.rows[0] ?? {};
  const data = camelize(row.data ?? []);
  await observeRevenueSubjects(user, data.flatMap((item: any) => [
    { subjectType: "contact" as const, subjectId: Number(item.id) },
    ...(item.primaryDeal?.id ? [{ subjectType: "deal" as const, subjectId: Number(item.primaryDeal.id) }] : []),
  ]));
  return {
    data, total: row.total ?? 0, limit: filters.limit, offset: filters.offset,
    filters: { ...filters, archived: false, recordClass: "production", pipeline: "sales" },
    scope: privileged(user) ? "all" : "owned_or_unassigned",
    asOf: new Date(row.as_of).toISOString(),
  };
}

/** Canonical production deal list used by Pipeline and other operational readers. */
export async function readRevenueDeals(user: RevenueUser, filters: RevenueFilters) {
  const values: unknown[] = [];
  const value = (input: unknown) => { values.push(input); return `$${values.length}`; };
  const where = [
    "d.archived_at IS NULL",
    "d.record_class = 'production'",
  ];
  if (filters.pipeline) where.push(`d.pipeline = ${value(filters.pipeline)}`);
  const ownerEmail = privileged(user) ? null : (user.email ?? "");
  if (ownerEmail) where.push(`(LOWER(d.owner) = LOWER(${value(ownerEmail)}) OR d.owner IS NULL)`);
  const limitParam = value(filters.limit ?? 100);
  const offsetParam = value(filters.offset ?? 0);
  const result = await pool.query(`
    WITH base AS MATERIALIZED (
      SELECT d.*,
        CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
        c.company_name, c.email AS contact_email, c.phone AS contact_phone,
        c.employee_count AS contact_employee_count, c.lead_source AS contact_lead_source
      FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id
      WHERE ${where.join(" AND ")}
    ), page AS (
      SELECT * FROM base ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY updated_at DESC NULLS LAST, id DESC), '[]'::jsonb) AS data,
      (SELECT COUNT(*)::int FROM base) AS total,
      CURRENT_TIMESTAMP AS as_of
    FROM page`, values);
  const row = result.rows[0] ?? {};
  const data = camelize(row.data ?? []);
  await observeRevenueSubjects(user, data.map((item: any) => ({ subjectType: "deal", subjectId: Number(item.id) })));
  return {
    data,
    total: Number(row.total ?? 0),
    limit: filters.limit ?? 100,
    offset: filters.offset ?? 0,
    filters: { pipeline: filters.pipeline ?? null, archived: false, recordClass: "production" },
    scope: privileged(user) ? "all" : "owned_or_unassigned",
    asOf: new Date(row.as_of).toISOString(),
  };
}

export async function readRevenueReconciliation(user: RevenueUser) {
  if (!privileged(user)) throw new Error("REVENUE_RECONCILIATION_FORBIDDEN");
  const result = await pool.query(`
    WITH contact_buckets AS (
      SELECT
      COUNT(*) FILTER (WHERE c.archived_at IS NOT NULL)::int AS archived,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL)::int AS non_archived_contacts,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND c.record_class = 'production')::int AS production_contacts,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND c.record_class <> 'production')::int AS non_production,
      COALESCE(jsonb_object_agg(c.record_class, class_count) FILTER (WHERE c.record_class <> 'production'), '{}'::jsonb) AS non_production_by_class,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND c.record_class='production' AND EXISTS (
        SELECT 1 FROM deals d WHERE d.contact_id=c.id AND d.archived_at IS NULL AND d.record_class='production'
          AND d.pipeline='sales' AND d.stage = ANY($1::text[])))::int AS canonical_lead_contacts,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND (
        SELECT COUNT(*) FROM deals d WHERE d.contact_id=c.id AND d.archived_at IS NULL
          AND d.record_class='production' AND d.pipeline='sales' AND d.stage = ANY($1::text[])
      ) > 1)::int AS multiple_qualifying_deals,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND EXISTS (
        SELECT 1 FROM deals d WHERE d.contact_id=c.id AND d.archived_at IS NULL AND d.record_class='production'
          AND d.pipeline='sales' AND (d.stage IS NULL OR NOT (d.stage = ANY($1::text[])))))::int AS invalid_unknown_sales_stage,
      COUNT(*) FILTER (WHERE c.archived_at IS NULL AND EXISTS (
        SELECT 1 FROM merchant_mids mm WHERE mm.contact_id=c.id AND mm.status='active' AND mm.activated_at IS NOT NULL))::int AS activated_mid_contacts
      FROM (
        SELECT contacts.*, COUNT(*) OVER (PARTITION BY record_class) AS class_count FROM contacts
      ) c
    ), orphan_buckets AS (
      SELECT
        (SELECT COUNT(*)::int FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.contact_id IS NOT NULL AND c.id IS NULL) AS missing_contact,
        (SELECT COUNT(*)::int FROM merchant_mids mm LEFT JOIN contacts c ON c.id=mm.contact_id
          WHERE mm.status='active' AND mm.activated_at IS NOT NULL
            AND (c.id IS NULL OR c.archived_at IS NOT NULL OR c.record_class <> 'production')) AS active_mid_without_eligible_contact,
        (SELECT COUNT(DISTINCT c.id)::int FROM contacts c
          WHERE c.archived_at IS NULL AND c.record_class='production'
            AND NOT EXISTS (SELECT 1 FROM merchant_mids mm WHERE mm.contact_id=c.id AND mm.status='active' AND mm.activated_at IS NOT NULL)
            AND (c.assigned_to IS NOT NULL OR EXISTS (SELECT 1 FROM deals d WHERE d.contact_id=c.id AND d.archived_at IS NULL))) AS legacy_portfolio_membership
    )
    SELECT contact_buckets.*, orphan_buckets.*, CURRENT_TIMESTAMP AS as_of
    FROM contact_buckets CROSS JOIN orphan_buckets`, [OPEN_SALES_LEAD_STAGES]);
  const { as_of, non_production_by_class, non_archived_contacts, production_contacts, ...buckets } = result.rows[0] ?? {};
  return {
    bucketSemantics: "overlapping",
    warning: "Diagnostic buckets overlap and must not be summed.",
    baseTotals: { nonArchivedContacts: non_archived_contacts ?? 0, productionContacts: production_contacts ?? 0 },
    buckets: camelize({ ...buckets, nonProductionByClass: non_production_by_class ?? {} }),
    filters: { scope: "all" },
    scope: "all",
    asOf: new Date(as_of).toISOString(),
  };
}

export type PipelineAnalytics = {
  sales: {
    total: number; active: number; closedWon: number; closedLost: number; winRate: number;
    stageDistribution: Record<string, number>; newLast30Days: number; wonLast30Days: number; stallingDeals: number;
  };
  onboarding: { total: number; active: number; completed: number };
};

/**
 * Canonical, uncapped pipeline report. The single statement gives every metric
 * (and its database-sourced as-of value) one PostgreSQL statement snapshot.
 */
export async function readPipelineAnalytics(user: RevenueUser): Promise<{
  data: PipelineAnalytics;
  metadata: { scope: "all" | "owned_or_unassigned"; asOf: string };
}> {
  const values: unknown[] = [];
  const ownership = privileged(user)
    ? "TRUE"
    : (() => {
      values.push(user.email ?? "");
      return `(d.owner IS NULL OR LOWER(d.owner) = LOWER($${values.length}))`;
    })();
  const result = await pool.query<{
    sales_total: string; sales_active: string; sales_closed_won: string; sales_closed_lost: string;
    sales_stages: Record<string, number> | null; sales_new_last_30: string; sales_won_last_30: string;
    sales_stalling: string; onboarding_total: string; onboarding_active: string; onboarding_completed: string;
    observed_deal_ids: number[]; as_of: Date;
  }>(`
    WITH scoped_deals AS (
      SELECT d.* FROM deals d
      WHERE d.archived_at IS NULL AND d.record_class = 'production' AND ${ownership}
    ), metrics AS (
      SELECT
        COUNT(*) FILTER (WHERE pipeline = 'sales')::int::text AS sales_total,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND stage NOT IN ('Closed Won', 'Closed Lost'))::int::text AS sales_active,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND stage = 'Closed Won')::int::text AS sales_closed_won,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND stage = 'Closed Lost')::int::text AS sales_closed_lost,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND created_at > CURRENT_TIMESTAMP - INTERVAL '30 days')::int::text AS sales_new_last_30,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND stage = 'Closed Won' AND updated_at > CURRENT_TIMESTAMP - INTERVAL '30 days')::int::text AS sales_won_last_30,
        COUNT(*) FILTER (WHERE pipeline = 'sales' AND stage NOT IN ('Closed Won', 'Closed Lost') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '7 days')::int::text AS sales_stalling,
        COUNT(*) FILTER (WHERE pipeline = 'onboarding')::int::text AS onboarding_total,
        COUNT(*) FILTER (WHERE pipeline = 'onboarding' AND stage NOT IN ('Live (First Batch)', 'Active (7 Days)', 'Active (30 Days)', 'Cancelled'))::int::text AS onboarding_active,
        COUNT(*) FILTER (WHERE pipeline = 'onboarding' AND stage IN ('Live (First Batch)', 'Active (7 Days)', 'Active (30 Days)'))::int::text AS onboarding_completed,
        COALESCE((array_agg(id ORDER BY id) FILTER (WHERE id IS NOT NULL))[1:2000], ARRAY[]::integer[]) AS observed_deal_ids,
        CURRENT_TIMESTAMP AS as_of
      FROM scoped_deals
    ), stages AS (
      SELECT COALESCE(jsonb_object_agg(stage, stage_count), '{}'::jsonb) AS sales_stages
      FROM (SELECT stage, COUNT(*)::int AS stage_count FROM scoped_deals WHERE pipeline = 'sales' GROUP BY stage) grouped
    )
    SELECT metrics.*, stages.sales_stages FROM metrics CROSS JOIN stages
  `, values);
  const authoritative = result.rows[0];
  if (!authoritative) throw new Error("PIPELINE_ANALYTICS_EMPTY_AGGREGATE");
  const num = (value: string | undefined) => Number.parseInt(value ?? "0", 10);
  const closedWon = num(authoritative.sales_closed_won);
  const closedLost = num(authoritative.sales_closed_lost);
  await observeRevenueSubjects(user, (authoritative.observed_deal_ids ?? [])
    .map((id) => ({ subjectType: "deal", subjectId: Number(id) })));
  return {
    data: {
      sales: {
        total: num(authoritative.sales_total), active: num(authoritative.sales_active), closedWon, closedLost,
        winRate: closedWon + closedLost > 0 ? Math.round((closedWon / (closedWon + closedLost)) * 100) : 0,
        stageDistribution: authoritative.sales_stages ?? {},
        newLast30Days: num(authoritative.sales_new_last_30), wonLast30Days: num(authoritative.sales_won_last_30),
        stallingDeals: num(authoritative.sales_stalling),
      },
      onboarding: {
        total: num(authoritative.onboarding_total), active: num(authoritative.onboarding_active),
        completed: num(authoritative.onboarding_completed),
      },
    },
    metadata: { scope: privileged(user) ? "all" : "owned_or_unassigned", asOf: new Date(authoritative.as_of).toISOString() },
  };
}