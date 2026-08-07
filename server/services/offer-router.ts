import OpenAI from "openai";
import { checkAiGate, recordAiSpend } from "./ai-audit-logger";
import type { Contact } from "@shared/schema";
import {
  OFFER_ROUTES,
  RECOMMENDED_NEXT_ACTIONS,
  offerRoutingResultSchema,
  type OfferRoute,
  type RecommendedNextAction,
  type OfferRoutingResult,
} from "@shared/offer-router-types";

interface ProcessorMatch {
  processor: string;
  confidence: number;
  sourceField: string;
}

const PROCESSOR_PATTERNS: Record<string, { route: OfferRoute; patterns: RegExp[] }> = {
  Square: {
    route: "beat_square",
    patterns: [/\bsquare\b/i, /squareup/i, /square\s*pos/i],
  },
  Stripe: {
    route: "beat_stripe",
    patterns: [/\bstripe\b/i, /stripe\s*payments/i],
  },
  Clover: {
    route: "beat_clover",
    patterns: [/\bclover\b/i, /clover\s*pos/i],
  },
  Toast: {
    route: "beat_toast",
    patterns: [/\btoast\b/i, /toasttab/i, /toast\s*pos/i],
  },
  PayPal: {
    route: "beat_paypal",
    patterns: [/\bpaypal\b/i, /pay\s*pal/i],
  },
};

export function detectProcessorFromFields(contact: Contact): ProcessorMatch | null {
  for (const [processor, config] of Object.entries(PROCESSOR_PATTERNS)) {
    if (contact.currentProvider) {
      const normalized = contact.currentProvider.toLowerCase().trim();
      for (const pattern of config.patterns) {
        if (pattern.test(normalized)) {
          return {
            processor,
            confidence: 95,
            sourceField: "currentProvider",
          };
        }
      }
    }

    const notesText = contact.notes || "";
    if (notesText) {
      for (const pattern of config.patterns) {
        if (pattern.test(notesText)) {
          return {
            processor,
            confidence: 80,
            sourceField: "notes",
          };
        }
      }
    }

    const tagsText = (contact.tags || []).join(" ");
    if (tagsText) {
      for (const pattern of config.patterns) {
        if (pattern.test(tagsText)) {
          return {
            processor,
            confidence: 70,
            sourceField: "tags",
          };
        }
      }
    }
  }

  return null;
}

export function routeOfferDeterministic(contact: Contact): OfferRoutingResult | null {
  const signals: string[] = [];

  const processorMatch = detectProcessorFromFields(contact);
  if (processorMatch) {
    const config = PROCESSOR_PATTERNS[processorMatch.processor];
    if (config) {
      signals.push(`processor_detected:${processorMatch.processor.toLowerCase()}`);
      signals.push(`source_field:${processorMatch.sourceField}`);
      return {
        offerRoute: config.route,
        offerConfidence: processorMatch.confidence,
        recommendedNextAction: "call_now",
        offerReasoning: `Detected ${processorMatch.processor} as current processor via ${processorMatch.sourceField}. Beat ${processorMatch.processor} offer is the best fit.`,
        routingSource: "deterministic_processor",
        matchedSignals: signals,
        processorDetected: processorMatch.processor,
        shouldUpdateContact: true,
      };
    }
  }

  if (
    contact.needTerminal === true ||
    (contact.landingPage && /\/free-smart-terminal/i.test(contact.landingPage)) ||
    (contact.landingPage && /offer=free-terminal/i.test(contact.landingPage))
  ) {
    signals.push("need_terminal:true");
    if (contact.landingPage) signals.push(`landing_page:${contact.landingPage}`);
    return {
      offerRoute: "free_smart_terminal",
      offerConfidence: 85,
      recommendedNextAction: "check_terminal_eligibility",
      offerReasoning: "Contact indicated terminal need or landed on free smart terminal page.",
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  if (
    (contact.landingPage && /\/0-percent-processing/i.test(contact.landingPage)) ||
    contact.interestedIn0Percent === true
  ) {
    signals.push("interested_in_0_percent:true");
    if (contact.landingPage) signals.push(`landing_page:${contact.landingPage}`);
    return {
      offerRoute: "compliant_cash_discount_review",
      offerConfidence: 80,
      recommendedNextAction: "explore_fee_offset_review",
      offerReasoning: "Contact showed interest in 0% processing or cash discount program.",
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  if (
    contact.landingPage &&
    (/\/upload-statement/i.test(contact.landingPage) || /\/free-analysis/i.test(contact.landingPage))
  ) {
    signals.push(`landing_page:${contact.landingPage}`);
    const isUpload = /\/upload-statement/i.test(contact.landingPage);
    return {
      offerRoute: "free_statement_analysis",
      offerConfidence: 80,
      recommendedNextAction: isUpload ? "upload_statement" : "request_free_analysis",
      offerReasoning: `Contact arrived via ${contact.landingPage} — statement analysis is the primary intent.`,
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  if (
    contact.sourceCategory === "partner" ||
    contact.landingPage === "/partners"
  ) {
    signals.push(`source_category:${contact.sourceCategory || "partner_landing_page"}`);
    return {
      offerRoute: "partner_referral",
      offerConfidence: 85,
      recommendedNextAction: "manual_review",
      offerReasoning: "Contact is a partner or arrived via partner landing page.",
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  if (contact.landingPage === "/merchant-application") {
    signals.push("landing_page:/merchant-application");
    return {
      offerRoute: "merchant_application",
      offerConfidence: 80,
      recommendedNextAction: "start_application",
      offerReasoning: "Contact landed directly on merchant application page.",
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  if (contact.vertical) {
    signals.push(`vertical:${contact.vertical}`);
    return {
      offerRoute: "industry_specific_rate_review",
      offerConfidence: 60,
      recommendedNextAction: "book_appointment",
      offerReasoning: `Contact is in the ${contact.vertical} vertical with no stronger routing signal.`,
      routingSource: "deterministic_rules",
      matchedSignals: signals,
      processorDetected: null,
      shouldUpdateContact: true,
    };
  }

  return null;
}

export async function routeOfferWithAi(contact: Contact): Promise<OfferRoutingResult> {
  const safeDefault: OfferRoutingResult = {
    offerRoute: "free_statement_analysis",
    offerConfidence: 50,
    recommendedNextAction: "request_free_analysis",
    offerReasoning: "AI unavailable — safe default assigned.",
    routingSource: "ai_router",
    matchedSignals: [],
    processorDetected: null,
    shouldUpdateContact: true,
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        ...safeDefault,
        offerReasoning: "AI unavailable — safe default assigned.",
      };
    }

    const slot = await checkAiGate("gpt-4o-mini");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const contactSummary = {
      vertical: contact.vertical,
      monthlyVolume: contact.monthlyVolume,
      currentProvider: contact.currentProvider,
      needTerminal: contact.needTerminal,
      interestedIn0Percent: contact.interestedIn0Percent,
      landingPage: contact.landingPage,
      painPoints: contact.painPoints,
      tags: contact.tags,
      notes: contact.notes ? contact.notes.slice(0, 300) : null,
      sourceCategory: contact.sourceCategory,
      contractStatus: contact.contractStatus,
    };

    const prompt = `You are an offer routing AI for Liberty Bancard, a payment processing company. 
Analyze this lead and determine the best offer route.

LEAD DATA:
${JSON.stringify(contactSummary, null, 2)}

AVAILABLE OFFER ROUTES (use exactly these values):
${OFFER_ROUTES.join(", ")}

AVAILABLE NEXT ACTIONS (use exactly these values):
${RECOMMENDED_NEXT_ACTIONS.join(", ")}

RULES:
- Cash discount / surcharge / dual pricing offers MUST use the *_review naming (compliant_cash_discount_review, compliant_surcharge_review, dual_pricing_review)
- Free terminal offer = check_terminal_eligibility action only, never guarantee approval
- No unsupported savings claims or legal advice
- Confidence 0–100

Respond with valid JSON matching this exact shape:
{
  "offerRoute": "<one of the OFFER_ROUTES values>",
  "offerConfidence": <integer 0-100>,
  "recommendedNextAction": "<one of the NEXT_ACTIONS values>",
  "offerReasoning": "<1-2 sentence rep-readable rationale>",
  "routingSource": "ai_router",
  "matchedSignals": ["<signal1>", "<signal2>"],
  "processorDetected": "<processor name or null>",
  "shouldUpdateContact": true
}`;

    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 400,
      });
    } catch (providerErr) {
      slot.refund();
      throw providerErr;
    }

    slot.settle(recordAiSpend("gpt-4o-mini", response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "offer-routing"));
    const raw = response.choices[0]?.message?.content;
    if (!raw) return safeDefault;

    const parsed = JSON.parse(raw);
    const validated = offerRoutingResultSchema.safeParse(parsed);

    if (!validated.success) {
      console.warn("[OfferRouter] AI output failed Zod validation:", validated.error.issues);
      return {
        ...safeDefault,
        offerReasoning: "AI output validation failed — safe default assigned.",
      };
    }

    const result = validated.data;
    return {
      offerRoute: result.offerRoute,
      offerConfidence: Math.min(100, Math.max(0, result.offerConfidence)),
      recommendedNextAction: result.recommendedNextAction,
      offerReasoning: result.offerReasoning,
      routingSource: "ai_router",
      matchedSignals: result.matchedSignals ?? [],
      processorDetected: result.processorDetected ?? null,
      shouldUpdateContact: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[OfferRouter] AI routing failed:", msg);
    return {
      ...safeDefault,
      offerReasoning: `AI unavailable — safe default assigned. (${msg.slice(0, 80)})`,
    };
  }
}

export async function routeOffer(
  contact: Contact,
  options: { forceAi?: boolean; allowManualOverride?: boolean } = {}
): Promise<OfferRoutingResult> {
  const allowOverride = options.allowManualOverride !== false;
  if (
    allowOverride &&
    contact.offerRoutingSource === "manual_override" &&
    contact.primaryOfferPath
  ) {
    return {
      offerRoute: contact.primaryOfferPath as OfferRoute,
      offerConfidence: contact.offerConfidence ?? null,
      recommendedNextAction: (contact.recommendedNextAction as RecommendedNextAction) ?? "manual_review",
      offerReasoning: contact.offerReasoning ?? "Manual override — no automated reasoning.",
      routingSource: "manual_override",
      matchedSignals: (contact.offerMatchedSignals as string[]) ?? [],
      processorDetected: contact.processorDetected ?? null,
      shouldUpdateContact: false,
    };
  }

  const deterministic = routeOfferDeterministic(contact);
  if (deterministic && !options.forceAi) {
    return deterministic;
  }

  if (options.forceAi || !deterministic) {
    return routeOfferWithAi(contact);
  }

  const fallbackResult: OfferRoutingResult = {
    offerRoute: "free_statement_analysis",
    offerConfidence: 40,
    recommendedNextAction: "request_free_analysis",
    offerReasoning: "No routing signal found — safe default assigned.",
    routingSource: "safe_default",
    matchedSignals: [],
    processorDetected: null,
    shouldUpdateContact: true,
  };

  if (fallbackResult.shouldUpdateContact && contact.id) {
    import("./analytics-events").then(({ recordAnalyticsEvent }) => {
      recordAnalyticsEvent({
        eventName: "offer_route_assigned",
        contactId: contact.id,
        offerRoute: fallbackResult.offerRoute,
        metadata: {
          routingSource: fallbackResult.routingSource,
          offerConfidence: fallbackResult.offerConfidence,
          matchedSignals: fallbackResult.matchedSignals,
        },
      });
    }).catch(() => {});
  }

  return fallbackResult;
}
