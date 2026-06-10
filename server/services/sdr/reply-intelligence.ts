import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrMerchants, sdrComplianceState } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq } from "drizzle-orm";
import { onStageChange, onOptOut } from "./ghl-sync-rules";
import { logAiCall } from "../ai-audit-logger";

export const INTENT_LABELS = [
  "interested",
  "meeting_intent",
  "send_info",
  "pricing_question",
  "call_me",
  "later",
  "not_interested",
  "already_have_provider",
  "wrong_person",
  "stop",
  "angry",
  "booked",
  "sent_statement",
] as const;

export type IntentLabel = typeof INTENT_LABELS[number];

export interface IntentClassification {
  intent: IntentLabel;
  confidence: number;
  reasoning: string;
}

export interface IntentContext {
  merchantVertical?: string;
  currentStage?: string;
  conversationHistory?: string[];
  merchantName?: string;
}

const INTENT_SYSTEM_PROMPT = `You are a reply classifier for a merchant services sales team. Classify the merchant's reply into exactly one of these intents:

- interested: Merchant expresses interest in learning more, getting a quote, or moving forward
- meeting_intent: Merchant wants to schedule a meeting, asks about availability, or expresses intent to meet/discuss in person
- send_info: Merchant asks for more details, brochures, or information to be sent
- pricing_question: Merchant asks about rates, fees, or pricing specifics
- call_me: Merchant requests a phone call or callback
- later: Merchant says not now but maybe later, or asks to follow up in the future
- not_interested: Merchant politely declines or says they're not interested
- already_have_provider: Merchant says they already have a processor/provider they're happy with
- wrong_person: Merchant says they're not the right contact or don't handle payments
- stop: Merchant explicitly asks to stop messages, unsubscribe, or be removed
- angry: Merchant is hostile, threatens legal action, or is aggressive
- booked: Merchant confirms they've booked or will attend a meeting
- sent_statement: Merchant says they've sent or will send their processing statement

Respond with JSON only: {"intent": "<label>", "confidence": <0.0-1.0>, "reasoning": "<brief explanation>"}`;

export async function classifyIntent(
  messageText: string,
  context: IntentContext = {}
): Promise<IntentClassification> {
  const userPrompt = buildClassificationPrompt(messageText, context);
  const classifyMessages = [
    { role: "system" as const, content: INTENT_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  try {
    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.warn("[Reply Intelligence] No OPENAI_API_KEY set, using rule-based fallback");
      return ruleBasedClassify(messageText);
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: openaiApiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const { completion, flagged } = await logAiCall(
      {
        triggerType: "reply-classify",
        actorType: "system",
        rawPrompt: JSON.stringify(classifyMessages),
      },
      () => openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: classifyMessages,
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: "json_object" },
      })
    );

    if (flagged) {
      console.warn("[Reply Intelligence] Low-confidence classification flagged for review");
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return ruleBasedClassify(messageText);
    }

    const parsed = JSON.parse(content) as { intent?: string; confidence?: number; reasoning?: string };
    const intent = parsed.intent as IntentLabel;
    if (!INTENT_LABELS.includes(intent)) {
      console.warn(`[Reply Intelligence] Unknown intent "${parsed.intent}", falling back`);
      return ruleBasedClassify(messageText);
    }

    return {
      intent,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      reasoning: parsed.reasoning || "",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Reply Intelligence] Classification error:", errMsg);
    return ruleBasedClassify(messageText);
  }
}

function buildClassificationPrompt(messageText: string, context: IntentContext): string {
  let prompt = `Classify this merchant reply:\n\n"${messageText}"`;
  if (context.merchantVertical) prompt += `\n\nMerchant vertical: ${context.merchantVertical}`;
  if (context.currentStage) prompt += `\nCurrent pipeline stage: ${context.currentStage}`;
  if (context.merchantName) prompt += `\nMerchant name: ${context.merchantName}`;
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    prompt += `\n\nRecent conversation:\n${context.conversationHistory.slice(-5).join("\n")}`;
  }
  return prompt;
}

function ruleBasedClassify(text: string): IntentClassification {
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|remove|opt.?out|do not (contact|text|call|email))\b/.test(lower)) {
    return { intent: "stop", confidence: 0.95, reasoning: "Explicit opt-out keyword detected" };
  }
  if (/\b(fuck|shit|sue|lawyer|attorney|legal action|report|harass|spam)\b/.test(lower)) {
    return { intent: "angry", confidence: 0.9, reasoning: "Hostile or threatening language detected" };
  }
  if (/\b(call me|give me a call|phone call|can you call|ring me|callback)\b/.test(lower)) {
    return { intent: "call_me", confidence: 0.85, reasoning: "Call request detected" };
  }
  if (/\b(booked|confirmed|i('ll| will) (be there|attend)|see you|appointment set)\b/.test(lower)) {
    return { intent: "booked", confidence: 0.85, reasoning: "Booking confirmation detected" };
  }
  if (/\b(sent|sending|emailed|uploaded|attached|here('s| is) (my|the) statement)\b/.test(lower)) {
    return { intent: "sent_statement", confidence: 0.85, reasoning: "Statement sent indicator" };
  }
  if (/\b(schedule|meeting|set up a time|when.*available|what time|calendar|book a time|meet with|sit down|come by)\b/.test(lower)) {
    return { intent: "meeting_intent", confidence: 0.85, reasoning: "Meeting scheduling intent detected" };
  }
  if (/\b(interested|tell me more|sounds good|let('s| us) (talk|discuss|set up)|sign me up|move forward)\b/.test(lower)) {
    return { intent: "interested", confidence: 0.8, reasoning: "Interest indicators detected" };
  }
  if (/\b(send (me |more )?info|brochure|details|learn more|more (information|details))\b/.test(lower)) {
    return { intent: "send_info", confidence: 0.8, reasoning: "Information request detected" };
  }
  if (/\b(price|pricing|rate|rates|how much|cost|fees|what do you charge)\b/.test(lower)) {
    return { intent: "pricing_question", confidence: 0.8, reasoning: "Pricing inquiry detected" };
  }
  if (/\b(not now|maybe later|check back|follow up (later|next)|in a (few|couple)|busy right now|not a good time)\b/.test(lower)) {
    return { intent: "later", confidence: 0.75, reasoning: "Deferral language detected" };
  }
  if (/\b(already have|happy with|use (square|stripe|clover|toast)|current (provider|processor)|no need|all set)\b/.test(lower)) {
    return { intent: "already_have_provider", confidence: 0.8, reasoning: "Existing provider mention" };
  }
  if (/\b(wrong (person|number|contact)|don('t| not) handle|not (my|the) (department|area)|not responsible)\b/.test(lower)) {
    return { intent: "wrong_person", confidence: 0.85, reasoning: "Wrong contact indicator" };
  }
  if (/\b(not interested|no thanks|no thank you|pass|decline|don('t| not) (need|want))\b/.test(lower)) {
    return { intent: "not_interested", confidence: 0.8, reasoning: "Decline language detected" };
  }

  return { intent: "interested", confidence: 0.3, reasoning: "No clear pattern matched, defaulting to interested with low confidence" };
}

export interface IntentAction {
  actionType: string;
  newStage?: string;
  suppressDays?: number;
  snoozeDays?: number;
  sendBookingLink?: boolean;
  sendResponse?: boolean;
  responseTemplate?: string;
  flagForHumanReview?: boolean;
  scheduleCall?: boolean;
}

export function mapIntentToAction(intent: IntentLabel, currentStage?: string): IntentAction {
  switch (intent) {
    case "interested":
      return {
        actionType: "advance",
        newStage: currentStage === "STATEMENT_REQUESTED" ? "STATEMENT_REQUESTED" : "ENGAGED",
        sendBookingLink: true,
        sendResponse: true,
        responseTemplate: "booking_cta",
      };
    case "meeting_intent":
      return {
        actionType: "advance",
        newStage: "ENGAGED",
        sendBookingLink: true,
        sendResponse: true,
        responseTemplate: "booking_cta",
      };
    case "send_info":
      return {
        actionType: "send_info",
        newStage: "ENGAGED",
        sendResponse: true,
        responseTemplate: "value_message_with_link",
      };
    case "pricing_question":
      return {
        actionType: "explain_process",
        newStage: "ENGAGED",
        sendResponse: true,
        responseTemplate: "pricing_review_explanation",
      };
    case "call_me":
      return {
        actionType: "schedule_call",
        newStage: "ENGAGED",
        sendBookingLink: false,
        scheduleCall: true,
        sendResponse: true,
        responseTemplate: "booking_link_or_call",
      };
    case "later":
      return {
        actionType: "snooze",
        newStage: "NURTURE",
        snoozeDays: 30,
        sendResponse: true,
        responseTemplate: "snooze_acknowledgment",
      };
    case "not_interested":
      return {
        actionType: "suppress",
        suppressDays: 90,
        sendResponse: true,
        responseTemplate: "thank_you_suppress",
      };
    case "already_have_provider":
      return {
        actionType: "suppress",
        suppressDays: 90,
        sendResponse: true,
        responseTemplate: "thank_you_suppress",
      };
    case "wrong_person":
      return {
        actionType: "suppress",
        suppressDays: 90,
        sendResponse: true,
        responseTemplate: "wrong_person_apology",
      };
    case "stop":
      return {
        actionType: "immediate_suppression",
        sendResponse: false,
      };
    case "angry":
      return {
        actionType: "immediate_suppression",
        flagForHumanReview: true,
        sendResponse: false,
      };
    case "booked":
      return {
        actionType: "advance",
        newStage: "MEETING_SET",
        sendResponse: true,
        responseTemplate: "booking_confirmation",
      };
    case "sent_statement":
      return {
        actionType: "advance",
        newStage: "STATEMENT_RECEIVED",
        sendResponse: true,
        responseTemplate: "statement_received_acknowledgment",
      };
    default:
      return {
        actionType: "no_action",
        sendResponse: false,
      };
  }
}

export async function executeIntentAction(
  merchantId: number,
  classification: IntentClassification,
  channel: string
): Promise<void> {
  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));
  const action = mapIntentToAction(classification.intent, state?.currentStage);

  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType: "intent_classified",
    channel,
    actorType: "ai",
    payloadJson: {
      intent: classification.intent,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      action: action.actionType,
    },
    decisionReason: `Intent: ${classification.intent} (${(classification.confidence * 100).toFixed(0)}%) → Action: ${action.actionType}`,
    modelVersion: "gpt-5-mini",
  });

  if (action.actionType === "immediate_suppression") {
    await onOptOut(merchantId, "all");

    if (action.flagForHumanReview) {
      await db.insert(sdrLeadEvents).values({
        merchantId,
        eventType: "human_review_flagged",
        channel,
        actorType: "system",
        payloadJson: {
          reason: `Angry reply detected — intent: ${classification.intent}`,
          originalIntent: classification.intent,
        },
        decisionReason: "Flagged for human review due to angry/hostile reply",
      });

      if (state) {
        await db.update(sdrLeadState).set({
          ownerType: "human",
          nextAction: "human_review_angry_reply",
          nextActionType: "human_review",
          updatedAt: new Date(),
        }).where(eq(sdrLeadState.merchantId, merchantId));
      }
    }
    return;
  }

  if (action.newStage && state) {
    const oldStage = state.currentStage;
    if (oldStage !== action.newStage) {
      await db.update(sdrLeadState).set({
        currentStage: action.newStage,
        lastReplyAt: new Date(),
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
      await onStageChange(merchantId, action.newStage, oldStage);
    }
  }

  if (action.snoozeDays && state) {
    const reactivationDate = new Date();
    reactivationDate.setDate(reactivationDate.getDate() + action.snoozeDays);
    await db.update(sdrLeadState).set({
      currentStage: "NURTURE",
      nextAction: "reactivation_check",
      nextActionType: "reactivation",
      nextActionAt: reactivationDate,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchantId));
    await onStageChange(merchantId, "NURTURE", state.currentStage);
  }

  if (action.suppressDays) {
    const coolingUntil = new Date();
    coolingUntil.setDate(coolingUntil.getDate() + action.suppressDays);

    const suppressFields = {
      smsAllowed: false,
      emailAllowed: false,
      callAllowed: false,
      notes: `Suppressed ${action.suppressDays} days until ${coolingUntil.toISOString()} — intent: ${classification.intent}`,
      updatedAt: new Date(),
    };

    const [existing] = await db.select().from(sdrComplianceState).where(eq(sdrComplianceState.merchantId, merchantId));
    if (existing) {
      await db.update(sdrComplianceState).set(suppressFields).where(eq(sdrComplianceState.merchantId, merchantId));
    } else {
      await db.insert(sdrComplianceState).values({
        merchantId,
        ...suppressFields,
      });
    }
  }

  if (action.sendBookingLink) {
    try {
      const { sendBookingLink } = await import("./scheduling");
      const bookingChannel = (channel === "sms" || channel === "email") ? channel : "sms" as const;
      const result = await sendBookingLink(merchantId, bookingChannel);
      console.log(`[Reply Intelligence] Booking link send for merchant ${merchantId}: ${result.sent ? "sent" : result.reason}`);
    } catch (err: unknown) {
      console.error(`[Reply Intelligence] Failed to send booking link for merchant ${merchantId}:`, err);
      await db.update(sdrLeadState).set({
        nextAction: "send_booking_link",
        nextActionType: "booking",
        nextActionAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
    }
  }

  if (action.scheduleCall) {
    try {
      const { triggerAiCall } = await import("./voice-orchestrator");
      const result = await triggerAiCall(merchantId, "intro_qualification");
      console.log(`[Reply Intelligence] AI call trigger for merchant ${merchantId}: ${result.success ? "triggered" : result.reason}`);
    } catch (err: unknown) {
      console.error(`[Reply Intelligence] Failed to trigger AI call for merchant ${merchantId}:`, err);
      await db.update(sdrLeadState).set({
        nextAction: "schedule_ai_call",
        nextActionType: "call",
        nextActionAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
    }
  }

  if (action.sendResponse && action.responseTemplate) {
    try {
      const { sendTemplateResponse } = await import("./ghl-client");
      await sendTemplateResponse(merchantId, action.responseTemplate, channel);
      console.log(`[Reply Intelligence] Sent template "${action.responseTemplate}" to merchant ${merchantId} via ${channel}`);
    } catch (err: unknown) {
      console.error(`[Reply Intelligence] Failed to send response template for merchant ${merchantId}:`, err);
    }
  }

  console.log(`[Reply Intelligence] Merchant ${merchantId}: intent=${classification.intent}, action=${action.actionType}`);
}
