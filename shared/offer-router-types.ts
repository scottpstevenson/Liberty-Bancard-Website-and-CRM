import { z } from "zod";

export const OFFER_ROUTES = [
  "beat_square",
  "beat_stripe",
  "beat_clover",
  "beat_toast",
  "beat_paypal",
  "free_statement_analysis",
  "free_smart_terminal",
  "compliant_cash_discount_review",
  "compliant_surcharge_review",
  "dual_pricing_review",
  "industry_specific_rate_review",
  "merchant_application",
  "partner_referral",
] as const;

export type OfferRoute = (typeof OFFER_ROUTES)[number];

export const RECOMMENDED_NEXT_ACTIONS = [
  "call_now",
  "book_appointment",
  "upload_statement",
  "request_free_analysis",
  "check_terminal_eligibility",
  "explore_fee_offset_review",
  "start_application",
  "send_proposal",
  "manual_review",
] as const;

export type RecommendedNextAction = (typeof RECOMMENDED_NEXT_ACTIONS)[number];

export interface OfferRoutingResult {
  offerRoute: OfferRoute;
  offerConfidence: number | null;
  recommendedNextAction: RecommendedNextAction;
  offerReasoning: string;
  routingSource: string;
  matchedSignals: string[];
  processorDetected?: string | null;
  shouldUpdateContact: boolean;
}

export const offerRouteSchema = z.enum(OFFER_ROUTES);
export const recommendedNextActionSchema = z.enum(RECOMMENDED_NEXT_ACTIONS);

export const offerRoutingResultSchema = z.object({
  offerRoute: offerRouteSchema,
  offerConfidence: z.number().int().min(0).max(100),
  recommendedNextAction: recommendedNextActionSchema,
  offerReasoning: z.string(),
  routingSource: z.string(),
  matchedSignals: z.array(z.string()),
  processorDetected: z.string().nullable().optional(),
  shouldUpdateContact: z.boolean(),
});

export const manualOverrideBodySchema = z.object({
  offerRoute: offerRouteSchema,
  recommendedNextAction: recommendedNextActionSchema.optional(),
  reason: z.string().min(1, "Reason is required"),
});

export const routeOfferBodySchema = z.object({
  dryRun: z.boolean().optional(),
  forceAi: z.boolean().optional(),
  updateContact: z.boolean().optional(),
});
