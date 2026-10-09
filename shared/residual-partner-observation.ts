import { z } from "zod";

const count = z.number().int().nonnegative();
const amount = z.number().finite().nullable();
export const residualPartnerObservationsSchema = z.object({
  rows: z.array(z.object({
    orgId: z.number().int().positive(),
    orgName: z.string().min(1),
    orgSlug: z.string(),
    observationCount: z.number().int().positive(),
    registeredMidCount: count,
    totalGrossResidual: amount,
    totalNetResidual: amount,
    totalPartnerCommission: amount,
  })),
  confirmedObservationCount: count,
  unconfirmedOrUnlinkedImportCount: count,
  unattributedObservationCount: count,
  unavailableRelationshipCount: count,
}).superRefine((read, ctx) => {
  const ids = new Set<number>();
  for (const row of read.rows) {
    if (ids.has(row.orgId) || row.registeredMidCount > row.observationCount)
      ctx.addIssue({ code: "custom", message: "Partner identity/count observation inconsistent" });
    ids.add(row.orgId);
  }
  if (read.rows.reduce((n,r)=>n+r.observationCount,0) +
    read.unattributedObservationCount + read.unavailableRelationshipCount !== read.confirmedObservationCount)
    ctx.addIssue({ code: "custom", message: "Confirmed observation accounting inconsistent" });
});
export type ResidualPartnerObservations = z.infer<typeof residualPartnerObservationsSchema>;
