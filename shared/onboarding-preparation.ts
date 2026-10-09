import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, "Use a real calendar date");
export const onboardingPreparationFields = z.object({
  contactId: z.number().int().positive().max(2147483647),
  expectedSourceVersion: z.string().min(1).max(80),
  expectedActorId: z.string().min(1).max(190),
  expectedAccountVersion: z.number().int().nonnegative(),
  terminalNeeded: z.enum(["yes","no","already_has"]),
  goLiveDate: dateOnly,
  fundingNotes: z.string().max(2000).default(""),
  underwritingDocs: z.array(z.enum(["Bank Statement","Processing Statement","Voided Check","Government ID"])).max(4).default([]),
}).strict();
export type OnboardingPreparationFields = z.infer<typeof onboardingPreparationFields>;
export type OnboardingPreparationStatus = {
  commandId: string; selectedDealId: number; sourceDealId: number; contactId: number;
  onboardingDealId: number; state: "partial"|"prepared";
  targetGoLiveDate:string;
  steps: Array<{key: string; accepted: boolean; taskId?: number; checklistIds?:number[]; unavailable?: boolean}>;
  nativeOutcome: "not_requested"; notificationOutcome: "not_requested";
};
