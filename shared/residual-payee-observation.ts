import { z } from "zod";

/** Stored agent attribution, not a commission entitlement or paid receipt. */
export const residualPayeeObservationSchema = z.object({
  agentId: z.number().int().positive().nullable(),
  agentLabel: z.string().min(1),
  observationCount: z.number().int().positive(),
  registeredMidCount: z.number().int().nonnegative(),
  revenue: z.number().finite().nullable(),
  agentCommission: z.number().finite().nullable(),
}).refine(row => row.registeredMidCount <= row.observationCount);
export const residualPayeeObservationsSchema = z.array(residualPayeeObservationSchema)
  .refine(rows => new Set(rows.map(row => row.agentId)).size === rows.length);
export type ResidualPayeeObservation = z.infer<typeof residualPayeeObservationSchema>;
