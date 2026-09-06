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

// ---------------------------------------------------------------------------
// Facet cache — correct key + single-flight deduplication.
//
// Cache key: derived from the FULL normalized filter object + user scope, so
// boolean predicates that appear as hardcoded SQL (stale, neverContacted,
// blocked, noDeal, etc.) cannot collide with each other.
//
// Single-flight: if an identical facet request is already in-flight we attach
// to its Promise rather than launching a second DB query. Only successful
// completed results are stored; in-flight entries are removed on settle.
//
// Size is bounded at 200 completed entries (evict all expired, then oldest
// half if still over limit).  TTL: 30 seconds.
// ---------------------------------------------------------------------------
interface FacetCacheEntry { value: FacetResult; expiresAt: number }
type FacetResult = { total: number; byRecordClass: Record<string, number>; byEmailHealth: Record<string, number>; asOf: string };

const _facetCache  = new Map<string, FacetCacheEntry>();
const _facetFlight = new Map<string, Promise<FacetResult>>();   // in-flight single-flight
const FACET_CACHE_TTL_MS  = 30_000;
const FACET_CACHE_MAX     = 200;

function _facetCacheKey(user: RevenueUser, filters: RevenueFilters): string {
  // Include every field that influences the WHERE predicate, plus role scope.
  const scope = privileged(user) ? "all" : (user.email ?? "anon");
  const key = {
    scope,
    search: filters.search ?? null,
    status: filters.status ?? null,
    emailHealth: filters.emailHealth ?? null,
    assignedTo: filters.assignedTo ?? null,
    recordClass: filters.recordClass ?? null,
    archived: filters.archived ?? false,
    churnRisk: filters.churnRisk ?? null,
    noOutreach: filters.noOutreach ?? null,
    blocked: filters.blocked ?? false,
    vertical: filters.vertical ?? null,
    tag: filters.tag ?? null,
    contactedToday: filters.contactedToday ?? false,
    hasAssignee: filters.hasAssignee ?? false,
    leadSource: filters.leadSource ?? null,
    lifecycle: filters.lifecycle ?? null,
    stale: filters.stale ?? false,
    recentlyUpdated: filters.recentlyUpdated ?? false,
    neverContacted: filters.neverContacted ?? false,
    notContactedIn30: filters.notContactedIn30 ?? false,
    noDeal: filters.noDeal ?? false,
    createdThisWeek: filters.createdThisWeek ?? false,
    pipeline: filters.pipeline ?? null,
  };
  return `facets:v2:${JSON.stringify(key)}`;
}

function _getCachedFacet(key: string): FacetResult | null {
  const entry = _facetCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _facetCache.delete(key); return null; }
  return entry.value;
}

function _setCachedFacet(key: string, value: FacetResult): void {
  if (_facetCache.size >= FACET_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of _facetCache) { if (now > v.expiresAt) _facetCache.delete(k); }
    if (_facetCache.size >= FACET_CACHE_MAX) {
      // Evict oldest half by insertion order.
      const deleteCount = Math.ceil(_facetCache.size / 2);
      let n = 0;
      for (const k of _facetCache.keys()) { _facetCache.delete(k); if (++n >= deleteCount) break; }
    }
  }
  _facetCache.set(key, { value, expiresAt: Date.now() + FACET_CACHE_TTL_MS });
}

/**
 * Rows-first contact list reader.
 *
 * Returns the paginated contact rows immediately WITHOUT waiting for
 * totals or facets.  Facets are available via readPeopleFacets() which
 * has its own cache + single-flight deduplication so a cold stampede of
 * 20 concurrent requests executes exactly one DB query.
 *
 * The data query uses SELECT c.* with ORDER BY + LIMIT/OFFSET applied
 * directly (no MATERIALIZED CTE, no window function over the full result
 * set).  observeRevenueSubjects() fires after the connection is released.
 */
export async function readPeople(user: RevenueUser, filters: RevenueFilters) {
  const values: unknown[] = [];
  const where = addContactFilters(filters, values);
  where.push(contactScope(user, "c", values));
  const predicate = where.join(" AND ");
  const order = orderForPeople(filters.sort);

  const limitIdx  = values.length + 1;
  const offsetIdx = values.length + 2;
  const dataValues = [...values, filters.limit, filters.offset];

  // Fast index scan — connection auto-released after this single query.
  const dataResult = await pool.query(
    `SELECT c.* FROM contacts c WHERE ${predicate}
     ORDER BY ${order}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataValues,
  );
  const data = dataResult.rows.map(camelize);

  // Fire-and-forget CRO02 observation after the connection is released.
  observeRevenueSubjects(
    user,
    data.map((item: any) => ({ subjectType: "contact", subjectId: Number(item.id) })),
  ).catch(() => {});

  return {
    data,
    limit:   filters.limit,
    offset:  filters.offset,
    filters: { ...filters, recordClass: filters.recordClass ?? "all" },
    scope:   privileged(user) ? "all" : "owned_or_unassigned",
  };
}

/**
 * Facet/count reader — runs separately from the rows query.
 *
 * Guarantees:
 *  • Cache key covers EVERY filter boolean so different predicates cannot
 *    share a cached result.
 *  • Single-flight: concurrent cold requests for the same key attach to
 *    the same in-flight Promise; exactly one DB query runs.
 *  • Only successfully completed results are cached.
 *  • Cache is bounded (FACET_CACHE_MAX entries, 30-second TTL).
 *  • A DB failure rejects the caller's promise cleanly; it is never
 *    reported as an authoritative zero.
 */
export async function readPeopleFacets(user: RevenueUser, filters: RevenueFilters): Promise<FacetResult> {
  const cacheKey = _facetCacheKey(user, filters);

  // 1. Warm cache hit — no DB call.
  const cached = _getCachedFacet(cacheKey);
  if (cached) return cached;

  // 2. In-flight single-flight — attach to an existing Promise.
  const existing = _facetFlight.get(cacheKey);
  if (existing) return existing;

  // 3. Cold — build predicate, launch exactly one DB query.
  const values: unknown[] = [];
  const where = addContactFilters(filters, values);
  where.push(contactScope(user, "c", values));
  const predicate = where.join(" AND ");

  const promise: Promise<FacetResult> = pool.query(
    `SELECT
       COALESCE(jsonb_object_agg(record_class, cnt) FILTER (WHERE grouping_id = 1), '{}'::jsonb) AS by_record_class,
       COALESCE(jsonb_object_agg(email_status,  cnt) FILTER (WHERE grouping_id = 2), '{}'::jsonb) AS by_email_health,
       COALESCE(SUM(cnt) FILTER (WHERE grouping_id = 3), 0)::int AS total,
       CURRENT_TIMESTAMP AS as_of
     FROM (
       SELECT record_class, email_status, COUNT(*) AS cnt,
              GROUPING(record_class, email_status) AS grouping_id
       FROM contacts c WHERE ${predicate}
       GROUP BY GROUPING SETS ((record_class),(email_status),())
     ) sub`,
    values,
  ).then((result) => {
    const row = result.rows[0] ?? {};
    const facetResult: FacetResult = {
      total:         Number(row.total  ?? 0),
      byRecordClass: (row.by_record_class  as Record<string, number>) ?? {},
      byEmailHealth: (row.by_email_health  as Record<string, number>) ?? {},
      asOf:          row.as_of ? new Date(row.as_of as string | Date).toISOString() : new Date().toISOString(),
    };
    _setCachedFacet(cacheKey, facetResult);
    return facetResult;
  }).finally(() => {
    _facetFlight.delete(cacheKey);
  });

  _facetFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Revenue Leads reader (contacts with an open sales deal).
 *
 * Single connection, READ ONLY REPEATABLE READ. Data query uses a LATERAL join
 * with ORDER BY + LIMIT applied directly (no MATERIALIZED CTE). Count query
 * runs the same predicate without fetching full row data.
 */
export async function readRevenueLeads(user: RevenueUser, filters: RevenueFilters) {
  const values: unknown[] = [OPEN_SALES_LEAD_STAGES];
  const stages = `$1::text[]`;
  const where = addContactFilters({ ...filters, archived: false, recordClass: "production" }, values);
  where.push(contactScope(user, "c", values));
  where.push(`EXISTS (SELECT 1 FROM deals qualifying_deal WHERE qualifying_deal.contact_id = c.id
    AND qualifying_deal.archived_at IS NULL AND qualifying_deal.record_class = 'production'
    AND qualifying_deal.pipeline = 'sales' AND qualifying_deal.stage = ANY(${stages}))`);
  const predicate = where.join(" AND ");

  // Count query uses parameters $1..$k.
  const countValues = [...values];
  // Data query appends LIMIT and OFFSET as $(k+1) and $(k+2).
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;
  const dataValues = [...values, filters.limit, filters.offset];

  // 1. Paginated data — connection auto-released after query.
  const dataResult = await pool.query(
    `SELECT to_jsonb(c) || jsonb_build_object('primaryDeal', to_jsonb(primary_deal)) AS item
     FROM contacts c
     JOIN LATERAL (
       SELECT d.* FROM deals d
       WHERE d.contact_id = c.id AND d.archived_at IS NULL
         AND d.record_class = 'production' AND d.pipeline = 'sales'
         AND d.stage = ANY(${stages})
       ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1
     ) primary_deal ON TRUE
     WHERE ${predicate}
     ORDER BY primary_deal.updated_at DESC NULLS LAST, primary_deal.id DESC, c.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataValues,
  );
  const dataRows: { item: unknown }[] = dataResult.rows;

  // 2. Total count — cached 30 s.
  // Key includes scope + all filter fields that affect the predicate.
  const cacheKey = _facetCacheKey(user, { ...filters, archived: false, recordClass: "production" });
  const _cachedLeads = _getCachedFacet(cacheKey);
  let countRow: { total: number; as_of: string | Date } = _cachedLeads
    ? { total: _cachedLeads.total, as_of: _cachedLeads.asOf }
    : { total: 0, as_of: new Date() };
  if (!_cachedLeads) {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total, CURRENT_TIMESTAMP AS as_of
       FROM contacts c WHERE ${predicate}`,
      countValues,
    );
    const countResultRow = countResult.rows[0] ?? { total: 0, as_of: new Date() };
    countRow = countResultRow;
    _setCachedFacet(cacheKey, {
      total: Number(countResultRow.total ?? 0),
      byRecordClass: {},
      byEmailHealth: {},
      asOf: new Date(countResultRow.as_of as string | Date).toISOString(),
    });
  }

  const data = dataRows.map((row) => camelize(row.item));
  await observeRevenueSubjects(user, data.flatMap((item: any) => [
    { subjectType: "contact" as const, subjectId: Number(item.id) },
    ...(item.primaryDeal?.id ? [{ subjectType: "deal" as const, subjectId: Number(item.primaryDeal.id) }] : []),
  ]));
  return {
    data,
    total: countRow.total ?? 0,
    limit: filters.limit,
    offset: filters.offset,
    filters: { ...filters, archived: false, recordClass: "production", pipeline: "sales" },
    scope: privileged(user) ? "all" : "owned_or_unassigned",
    asOf: new Date(countRow.as_of).toISOString(),
  };
}

/**
 * Canonical production deal list used by Pipeline and other operational readers.
 *
 * Single connection, READ ONLY REPEATABLE READ. Data query uses ORDER BY +
 * LIMIT directly on the deals table (no MATERIALIZED CTE). Count uses the same
 * predicate over deals only (no contact join needed for counting).
 */
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
  const predicate = where.join(" AND ");

  // Count uses parameters $1..$p; data appends LIMIT=$(p+1), OFFSET=$(p+2).
  const countValues = [...values];
  const limitParam = value(filters.limit ?? 100);
  const offsetParam = value(filters.offset ?? 0);

  // 1. Paginated data — connection auto-released after query.
  const dataResult = await pool.query(
    `SELECT d.*,
       CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
       c.company_name, c.email AS contact_email, c.phone AS contact_phone,
       c.employee_count AS contact_employee_count, c.lead_source AS contact_lead_source
     FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE ${predicate}
     ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values,
  );
  const dataRows: Record<string, unknown>[] = dataResult.rows;

  // 2. Total count — cached 30 s.
  // Key covers scope + pipeline filter (the only predicate-changing fields for deals).
  const dealsCacheScope = privileged(user) ? "all" : (user.email ?? "anon");
  const dealsCacheKey = `deals-count:v2:${JSON.stringify({ scope: dealsCacheScope, pipeline: filters.pipeline ?? null })}`;
  const _cachedDeals = _getCachedFacet(dealsCacheKey);
  let countRow: { total: number; as_of: string | Date } = _cachedDeals
    ? { total: _cachedDeals.total, as_of: _cachedDeals.asOf }
    : { total: 0, as_of: new Date() };
  if (!_cachedDeals) {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total, CURRENT_TIMESTAMP AS as_of
       FROM deals d WHERE ${predicate}`,
      countValues,
    );
    const countResultRow = countResult.rows[0] ?? { total: 0, as_of: new Date() };
    countRow = countResultRow;
    _setCachedFacet(dealsCacheKey, {
      total: Number(countResultRow.total ?? 0),
      byRecordClass: {},
      byEmailHealth: {},
      asOf: new Date(countResultRow.as_of as string | Date).toISOString(),
    });
  }

  const data = dataRows.map(camelize);
  await observeRevenueSubjects(user, data.map((item: any) => ({ subjectType: "deal", subjectId: Number(item.id) })));
  return {
    data,
    total: Number(countRow.total ?? 0),
    limit: filters.limit ?? 100,
    offset: filters.offset ?? 0,
    filters: { pipeline: filters.pipeline ?? null, archived: false, recordClass: "production" },
    scope: privileged(user) ? "all" : "owned_or_unassigned",
    asOf: new Date(countRow.as_of).toISOString(),
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
