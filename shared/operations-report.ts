import { z } from "zod";

const count = z.number().int().nonnegative().finite();
const ratio = z.number().nonnegative().finite().nullable();
const timestamp = z.string().datetime({ offset: true });
const incident = z.object({
  code: z.string(), category: z.string(), occurredAt: timestamp,
}).nullable();

/** User-supplied USD modelling input, never a stored expense observation. */
export function parseOperationsSpend(raw: unknown): number {
  const value = typeof raw === "string" ? raw.trim() : raw === undefined ? "0" : "";
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) {
    throw new Error("Enter a non-negative USD estimate with at most two decimal places.");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error("The USD estimate is too large.");
  }
  return amount;
}

export const operationsReportSchema = z.object({
  days: z.number().int().positive().max(365),
  adSpend: z.number().nonnegative().finite(),
  cplBySource: z.array(z.object({
    source: z.string(), leads: count, bookedCalls: count, signedMerchants: count,
    cpl: ratio, cpb: ratio, cps: ratio, costEstimate: z.literal(true),
  })),
  closeRateByVertical: z.array(z.object({
    vertical: z.string(), leads: count, booked: count, signed: count,
    leadToBooked: ratio, bookedToSigned: ratio, leadToSigned: ratio,
  })),
  sequenceReplyRates: z.array(z.object({
    id: z.string(), name: z.string(), status: z.string(), enrolled: count,
    replies: z.null(), replyRate: z.null(),
  })),
  funnel: z.array(z.object({ stage: z.string(), count, pct: ratio })),
  overdueTasks: z.array(z.object({
    id: z.number().int().positive(), title: z.string(), assignedTo: z.string().nullable(),
    dueDate: timestamp, daysOverdue: count,
  })),
  incidentSummary: z.object({
    queueFailures7d: count, ghlSyncFailures7d: count,
    mostRecentQueueIncident: incident, mostRecentGhlIncident: incident,
  }),
  meta: z.object({
    exact: z.literal(true), asOf: timestamp, scope: z.string(),
    snapshotConsistency: z.literal("unavailable"),
    sourceCapture: z.record(z.object({
      requestedAt: timestamp, completedBy: timestamp, consistency: z.string(),
    })),
    period: z.object({
      startInclusive: timestamp, endExclusive: timestamp, timezone: z.literal("UTC"),
      basis: z.string(),
    }),
    operationalPeriods: z.object({
      incidentsStartInclusive: timestamp, incidentsEndExclusive: timestamp,
      tasksAsOf: timestamp,
    }),
    units: z.record(z.string()),
    completeness: z.object({ sequenceReplies: z.string() }),
    spendAllocation: z.object({
      kind: z.literal("estimate"), assumption: z.string(),
      authoritativeSpendSource: z.literal(false), currency: z.literal("USD"),
    }),
  }),
});
export type OperationsReportData = z.infer<typeof operationsReportSchema>;
