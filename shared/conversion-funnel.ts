import { z } from "zod";
export const FUNNEL_STAGES = [
  "lead",
  "engaged",
  "statement_requested",
  "statement_received",
  "proposal_sent",
  "application",
  "closed_won",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  lead: "Lead",
  engaged: "Engaged",
  statement_requested: "Statement Requested",
  statement_received: "Statement Received",
  proposal_sent: "Proposal Sent",
  application: "Application",
  closed_won: "Closed Won",
};
export const METRIC_DEFINITION_VERSION = "business-sales-journey-v1";
export const FUNNEL_TIMEZONE = "America/New_York";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v + "T00:00:00Z")) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
  );
export const funnelQuerySchema = z
  .object({
    start: day,
    end: day,
    asOf: z.string().datetime().optional(),
    vertical: z.string().min(1).max(120).optional(),
    rep: z.string().min(1).max(120).optional(),
    source: z.string().min(1).max(120).optional(),
    campaign: z.string().min(1).max(120).optional(),
    breakdown: z
      .enum(["vertical", "rep", "source", "campaign"])
      .default("vertical"),
    stage: z.enum(FUNNEL_STAGES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^deal:\d+$/)
      .max(40)
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const n = (Date.parse(v.end) - Date.parse(v.start)) / 86400000;
    if (n < 0 || n > 365)
      c.addIssue({
        code: "custom",
        message: "Choose a date range of at most 366 days",
      });
  });
export type FunnelQuery = z.infer<typeof funnelQuerySchema>;
/** ET midnight converted through the IANA zone; never fixed -05:00 or an assumed 24-hour day. */
export function easternDayStart(value: string): Date {
  day.parse(value);
  const [y, m, d] = value.split("-").map(Number),
    target = Date.UTC(y, m - 1, d);
  let candidate = target;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: FUNNEL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(candidate)).map((x) => [x.type, x.value]),
    );
    const observed = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    candidate += target - observed;
  }
  return new Date(candidate);
}
export function nextDate(value: string) {
  return new Date(Date.parse(value + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function easternDate(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FUNNEL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function defaultFunnelDates(now = new Date()) {
  const end = easternDate(now);
  return {
    end,
    start: new Date(Date.parse(end + "T00:00:00Z") - 29 * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const funnelResponseSchema = z.object({
  metricDefinitionVersion: z.literal(METRIC_DEFINITION_VERSION),
  entered: z.number().int().nonnegative(),
  meta: z
    .object({
      asOf: z.string().datetime(),
      timezone: z.literal(FUNNEL_TIMEZONE),
      completeness: z.enum(["partial", "complete"]),
      unit: z.string(),
      dimensionMode: z.string(),
      coverage: z.object({
        observations: z.number().int().nonnegative(),
        unlinked: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
        excluded_test: z.number().int().nonnegative(),
      }),
      sources: z.array(
        z.object({
          source_type: z.string(),
          status: z.string(),
          reason: z.string(),
          observed_at: z.string().nullable(),
        }),
      ),
      limitations: z.array(z.string()),
    })
    .passthrough(),
  stages: z
    .array(
      z.object({
        key: z.enum(FUNNEL_STAGES),
        label: z.string(),
        count: z.number().int().nonnegative(),
        observedJourneys: z.number().int().nonnegative(),
        missingOrOutOfOrder: z.number().int().nonnegative(),
        adjacentDenominator: z.number().int().nonnegative(),
        adjacentRate: z.number().min(0).max(1).nullable(),
        entryRate: z.number().min(0).max(1).nullable(),
      }),
    )
    .length(7),
  breakdown: z.object({
    by: z.enum(["vertical", "rep", "source", "campaign"]),
    complete: z.boolean(),
    items: z.array(
      z
        .object({
          dimension: z.string(),
          entered: z.number().int().nonnegative(),
        })
        .catchall(z.union([z.string(), z.number()])),
    ),
  }),
  drilldown: z.object({
    stage: z.enum(FUNNEL_STAGES),
    items: z.array(
      z
        .object({
          journey_key: z.string(),
          business_id: z.number().int(),
          entry_at: z.string(),
          progress: z.number().int(),
          dimensions: z.record(z.string()),
        })
        .passthrough(),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  }),
});
export type FunnelResponse = z.infer<typeof funnelResponseSchema>;
