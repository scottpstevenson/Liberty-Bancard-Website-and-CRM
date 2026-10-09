import { z } from "zod";

const count = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
export const npsStatsReadSchema = z.object({
  total: count, submitted: count, scored: count, invalidSubmitted: count,
  avgScore: z.number().finite().min(0).max(10).nullable(),
  promoters: count, detractors: count, passives: count,
  npsScore: z.number().int().min(-100).max(100).nullable(),
  metadata: z.object({
    source: z.literal("nps_responses"),
    scope: z.literal("nonarchived_production_contact_surveys"),
    period: z.literal("all_stored_observations_up_to_asOf"),
    timezone: z.literal("UTC"), asOf: timestamp,
    snapshotConsistency: z.literal("single_statement"),
    units: z.literal("survey_records_not_unique_merchants"),
  }),
}).superRefine((r, ctx) => {
  if (r.submitted > r.total || r.scored > r.submitted ||
      r.invalidSubmitted !== r.submitted - r.scored ||
      r.promoters + r.passives + r.detractors !== r.scored ||
      (r.scored === 0) !== (r.avgScore === null) ||
      (r.scored === 0) !== (r.npsScore === null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NPS sample is inconsistent" });
});
export type NpsStatsRead = z.infer<typeof npsStatsReadSchema>;

export const npsRecordReadSchema = z.object({
  id: z.number().int().positive(), score: z.number().int().nullable(),
  createdAt: timestamp.nullable(), submittedAt: timestamp.nullable(),
  dayTrigger: z.number().int(), comment: z.string().nullable(),
  reviewRequestQueued: z.boolean().nullable(), healthAlertCreated: z.boolean().nullable(),
});
export const npsRecordsReadSchema = z.array(npsRecordReadSchema);
export type NpsRecordRead = z.infer<typeof npsRecordReadSchema>;
export function isScoredNpsRecord(r: NpsRecordRead) {
  return r.submittedAt !== null && r.score !== null && r.score >= 0 && r.score <= 10;
}
