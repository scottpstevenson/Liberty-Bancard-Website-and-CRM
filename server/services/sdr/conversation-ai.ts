import { db } from "../../db";
import { sdrMerchants, sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isSdrGhlConfigured, addTag, updateCustomFields, disableConversationAi } from "./ghl-client";
import { onHumanHandoff } from "./ghl-sync-rules";

export interface BotContext {
  contextId: string;
  name: string;
  systemPrompt: string;
  verticalKey?: string;
}

const HOMEPAGE_BOT: BotContext = {
  contextId: "homepage_general",
  name: "Homepage Qualification Bot",
  systemPrompt: `You are a friendly AI assistant for Liberty Bancard, a leading payment processing company.
Your goal is to qualify website visitors and capture their contact information for a free savings review.

Key behaviors:
- Greet warmly, ask what brings them to Liberty Bancard
- Identify their business type (restaurant, retail, medical, etc.)
- Ask about their current payment processing situation
- NEVER quote specific rates or pricing — say "we tailor pricing to each business"
- Offer a free savings analysis / statement review
- Capture: business name, contact name, email, phone
- If they're interested, offer to book a call with a specialist
- Include compliance disclaimer: "By providing your information, you consent to being contacted by Liberty Bancard regarding payment processing services."

Value propositions to mention naturally:
- Save up to 40% on processing fees
- No long-term contracts
- Next-day funding available
- Free terminal / POS equipment
- 24/7 US-based support
- Transparent pricing with no hidden fees`,
};

const VERTICAL_BOTS: Record<string, BotContext> = {
  restaurant: {
    contextId: "vertical_restaurant",
    name: "Restaurant Industry Bot",
    verticalKey: "Restaurant",
    systemPrompt: `You are a payment processing specialist for restaurants at Liberty Bancard.
You understand the unique needs of food service businesses.

Key talking points:
- Integration with popular POS systems (Toast, Square, Clover)
- Tip adjustment and tip pooling features
- Online ordering and delivery integration
- Menu-based checkout and tableside payments
- Lower rates than typical restaurant processors
- Fast settlement for cash flow management

Qualification questions:
- How many locations do you have?
- What POS system do you currently use?
- What's your approximate monthly card volume?
- Do you offer online ordering or delivery?

NEVER quote specific rates. Always offer a free savings analysis.
Capture: business name, contact name, email, phone, number of locations.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
  },
  medspa: {
    contextId: "vertical_medspa",
    name: "MedSpa / Aesthetics Bot",
    verticalKey: "Salon/Spa",
    systemPrompt: `You are a payment processing specialist for medical spas and aesthetics practices at Liberty Bancard.

Key talking points:
- HIPAA-aware payment solutions
- Recurring billing for membership programs
- High-ticket transaction support (average tickets $300-$2000+)
- Integrated payment links for deposits and pre-payments
- Contactless and mobile payment options
- Chargeback protection for service businesses

Qualification questions:
- What services do you primarily offer?
- Do you have a membership or package program?
- What's your approximate average ticket size?
- Do you take deposits or pre-payments?

NEVER quote specific rates. Always offer a free savings analysis.
Capture: business name, contact name, email, phone.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
  },
  dental: {
    contextId: "vertical_dental",
    name: "Dental Practice Bot",
    verticalKey: "Healthcare",
    systemPrompt: `You are a payment processing specialist for dental practices at Liberty Bancard.

Key talking points:
- Integration with dental practice management software
- Patient financing and payment plan support
- Insurance co-pay processing
- Recurring payment for orthodontic plans
- Contactless and mobile check-in payments
- EOB-friendly reporting

Qualification questions:
- How many providers are in your practice?
- Do you currently offer patient financing?
- What practice management software do you use?
- What's your approximate monthly card volume?

NEVER quote specific rates. Always offer a free savings analysis.
Capture: business name, contact name, email, phone, number of providers.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
  },
  auto: {
    contextId: "vertical_auto",
    name: "Auto Services Bot",
    verticalKey: "Auto",
    systemPrompt: `You are a payment processing specialist for auto repair and service businesses at Liberty Bancard.

Key talking points:
- High-ticket transaction support for repairs
- Integrated invoicing and payment links
- Fleet and commercial account billing
- Mobile payment for roadside/towing services
- Parts and labor split reporting
- Quick settlement for cash flow

Qualification questions:
- What type of auto services do you provide?
- Do you handle fleet or commercial accounts?
- What's your average repair ticket?
- Do you offer financing for larger repairs?

NEVER quote specific rates. Always offer a free savings analysis.
Capture: business name, contact name, email, phone.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
  },
};

const EXISTING_LEAD_BOT: BotContext = {
  contextId: "existing_lead",
  name: "Existing Lead Follow-up Bot",
  systemPrompt: `You are a helpful AI assistant continuing a conversation with someone who has already expressed interest in Liberty Bancard's payment processing services.

Key behaviors:
- Reference their previous interaction if context is available
- Answer follow-up questions about the process
- Help them understand next steps (statement review, proposal, etc.)
- If they haven't booked yet, gently encourage scheduling a call
- Address common objections:
  * "I'm locked into a contract" → We can often help with early termination analysis
  * "I don't have time" → The review only takes 10 minutes
  * "I'm happy with my current processor" → Most merchants save 20-40% — worth a quick look
- If they have questions about specific rates or complex pricing, offer to connect them with a specialist

NEVER quote specific rates. Guide them toward booking a consultation.
Compliance: "By providing your information, you consent to being contacted by Liberty Bancard."`,
};

export interface ContextRouterInput {
  pageUrl?: string;
  ghlContactId?: string;
  existingMerchantId?: number;
  verticalHint?: string;
}

export function routeBotContext(input: ContextRouterInput): BotContext {
  if (input.existingMerchantId) {
    return EXISTING_LEAD_BOT;
  }

  const url = (input.pageUrl || "").toLowerCase();

  if (url.includes("/industry/restaurant") || url.includes("/restaurant")) {
    return VERTICAL_BOTS.restaurant;
  }
  if (url.includes("/industry/medspa") || url.includes("/medspa") || url.includes("/medical-spa") || url.includes("/aesthetics")) {
    return VERTICAL_BOTS.medspa;
  }
  if (url.includes("/industry/dental") || url.includes("/dental") || url.includes("/dentist")) {
    return VERTICAL_BOTS.dental;
  }
  if (url.includes("/industry/auto") || url.includes("/auto-repair") || url.includes("/automotive")) {
    return VERTICAL_BOTS.auto;
  }

  if (input.verticalHint) {
    const hint = input.verticalHint.toLowerCase();
    for (const [key, bot] of Object.entries(VERTICAL_BOTS)) {
      if (hint.includes(key) || (bot.verticalKey && hint.includes(bot.verticalKey.toLowerCase()))) {
        return bot;
      }
    }
  }

  return HOMEPAGE_BOT;
}

export function getAllBotContexts(): BotContext[] {
  return [
    HOMEPAGE_BOT,
    ...Object.values(VERTICAL_BOTS),
    EXISTING_LEAD_BOT,
  ];
}

export function getBotContext(contextId: string): BotContext | null {
  const all = getAllBotContexts();
  return all.find(b => b.contextId === contextId) || null;
}

export interface HandoffAnalysis {
  shouldHandoff: boolean;
  reason: string;
  confidence: number;
  handoffType: "explicit_request" | "low_confidence" | "complex_pricing" | "angry_intent" | "none";
}

const LOW_CONFIDENCE_INDICATORS = [
  /i don't understand/i,
  /what do you mean/i,
  /that doesn't (make sense|answer|help)/i,
  /you('re| are) not (helping|answering|listening)/i,
  /can you (explain|clarify|be more specific)/i,
  /already (asked|said|told you) that/i,
  /repeat(ing)? (myself|the question)/i,
  /going in circles/i,
  /this is (confusing|unhelpful)/i,
];

const EXPLICIT_HANDOFF_PATTERNS = [
  /talk to (a |an )?(real |actual |human |live )?person/i,
  /speak (to|with) (a |an )?(real |actual |human |live )?(person|agent|rep|representative|someone|human)/i,
  /get me (a |an )?(real |actual |human |live )?(person|agent|rep|representative|someone|human)/i,
  /connect me (to|with)/i,
  /transfer me/i,
  /human (please|now|agent)/i,
  /real person/i,
  /stop (the )?bot/i,
  /not (a )?bot/i,
  /want (to talk|to speak|a human|a person|a rep)/i,
  /need (to talk|to speak|a human|a person|a rep)/i,
];

const ANGRY_INTENT_PATTERNS = [
  /this is (ridiculous|absurd|unacceptable|terrible|awful|horrible|garbage|trash|waste)/i,
  /you('re| are) (useless|worthless|terrible|awful|horrible|stupid|incompetent)/i,
  /f+u+c+k/i,
  /scam/i,
  /rip( |-)?off/i,
  /sue you|lawsuit|attorney general|bbb|better business bureau/i,
  /cancel everything|done with (you|this)/i,
  /worst (company|service|experience)/i,
];

const COMPLEX_PRICING_PATTERNS = [
  /interchange\s*(plus|rate|\+)/i,
  /basis points/i,
  /bps\b/i,
  /tiered pricing/i,
  /flat rate vs/i,
  /assessment fees/i,
  /per(-| )?transaction fee/i,
  /batch fee/i,
  /pci (compliance|fee|non.?compliance)/i,
  /chargeback fee/i,
  /early termination/i,
  /cancellation fee/i,
  /what('s| is| are) (your |the )?(exact |specific |actual )?(rate|price|cost|fee)/i,
  /how much (do you|will it|does it) (charge|cost)/i,
  /compare.*(pricing|rates|fees|cost)/i,
];

export function analyzeForHandoff(messageText: string, conversationHistory?: string[]): HandoffAnalysis {
  for (const pattern of EXPLICIT_HANDOFF_PATTERNS) {
    if (pattern.test(messageText)) {
      return {
        shouldHandoff: true,
        reason: "Visitor explicitly requested to speak with a human",
        confidence: 1.0,
        handoffType: "explicit_request",
      };
    }
  }

  let angryCount = 0;
  for (const pattern of ANGRY_INTENT_PATTERNS) {
    if (pattern.test(messageText)) angryCount++;
  }
  if (angryCount >= 1) {
    const priorAnger = conversationHistory
      ? conversationHistory.filter(msg => ANGRY_INTENT_PATTERNS.some(p => p.test(msg))).length
      : 0;
    if (angryCount >= 2 || priorAnger >= 1) {
      return {
        shouldHandoff: true,
        reason: "Visitor is expressing frustration or anger",
        confidence: 0.85 + (angryCount * 0.05),
        handoffType: "angry_intent",
      };
    }
  }

  let pricingHits = 0;
  for (const pattern of COMPLEX_PRICING_PATTERNS) {
    if (pattern.test(messageText)) pricingHits++;
  }
  if (pricingHits >= 2) {
    return {
      shouldHandoff: true,
      reason: "Visitor is asking detailed pricing questions that require human expertise",
      confidence: 0.8,
      handoffType: "complex_pricing",
    };
  }

  let lowConfidenceCount = 0;
  for (const pattern of LOW_CONFIDENCE_INDICATORS) {
    if (pattern.test(messageText)) lowConfidenceCount++;
  }
  const priorLowConfidence = conversationHistory
    ? conversationHistory.filter(msg => LOW_CONFIDENCE_INDICATORS.some(p => p.test(msg))).length
    : 0;
  if (lowConfidenceCount >= 1 && priorLowConfidence >= 1) {
    return {
      shouldHandoff: true,
      reason: "Visitor appears unsatisfied with AI responses — repeated signals of confusion or frustration",
      confidence: 0.75,
      handoffType: "low_confidence",
    };
  }

  return {
    shouldHandoff: false,
    reason: "",
    confidence: 0,
    handoffType: "none",
  };
}

export async function executeHandoff(merchantId: number, analysis: HandoffAnalysis, sourceChannel: "chat" | "sms" | "email" = "chat"): Promise<void> {
  await db.update(sdrLeadState)
    .set({ ownerType: "human", updatedAt: new Date() })
    .where(eq(sdrLeadState.merchantId, merchantId));

  await onHumanHandoff(merchantId);

  const eventType = `${sourceChannel}_handoff` as const;
  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType,
    channel: sourceChannel,
    actorType: "system",
    payloadJson: {
      handoffType: analysis.handoffType,
      reason: analysis.reason,
      confidence: analysis.confidence,
    },
  });

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));

  try {
    const { storage } = await import("../../storage");
    const channelLabel = sourceChannel.toUpperCase();
    await storage.createNotification({
      channel: "internal",
      title: `${channelLabel} Handoff Required`,
      message: `${channelLabel} lead "${merchant?.businessName || `Merchant #${merchantId}`}" requires human attention. Reason: ${analysis.reason} (${analysis.handoffType}, confidence: ${Math.round(analysis.confidence * 100)}%)`,
      type: "alert",
      metadata: { merchantId, handoffType: analysis.handoffType, eventType, sourceChannel },
    });
  } catch (notifErr) {
    console.error(`[Chat AI] Failed to create handoff notification:`, notifErr);
  }

  if (merchant?.ghlContactId && isSdrGhlConfigured()) {
    try {
      await addTag({ contactId: merchant.ghlContactId, tags: ["LB-CHAT-HANDOFF"] });
      await updateCustomFields(merchant.ghlContactId, {
        lb_last_ai_outcome: `chat_handoff:${analysis.handoffType}`,
        lb_owner_type: "human",
      });
      await disableConversationAi(merchant.ghlContactId);
      console.log(`[Chat AI] Disabled GHL Conversation AI for contact ${merchant.ghlContactId}`);
    } catch (err) {
      console.error(`[Chat AI] Failed to update GHL for handoff merchant ${merchantId}:`, err);
    }
  }

  console.log(`[Chat AI] Handoff executed for merchant ${merchantId}: ${analysis.handoffType} — ${analysis.reason}`);
}

export interface ReplyIntelligenceResult {
  suggestedReply: string;
  intent: "interested" | "objection" | "question" | "scheduling" | "not_interested" | "unknown";
  shouldEscalate: boolean;
  escalationReason?: string;
}

export function classifyMessageIntent(message: string): ReplyIntelligenceResult["intent"] {
  const text = message.toLowerCase();

  if (/not interested|no thanks|don't want|don't need|stop|unsubscribe|remove me/i.test(text)) {
    return "not_interested";
  }

  if (/book|schedule|appointment|call me|when.*available|what time|calendar|meeting/i.test(text)) {
    return "scheduling";
  }

  if (/interested|tell me more|sounds good|let's do it|sign me up|how do i start|want to learn|sounds great/i.test(text)) {
    return "interested";
  }

  if (/but|however|concern|worry|locked|contract|happy with|already have|can't switch|too busy|not sure/i.test(text)) {
    return "objection";
  }

  if (/\?|how|what|when|where|why|who|can you|do you|is there|are there/i.test(text)) {
    return "question";
  }

  return "unknown";
}

export function generateSmartReply(intent: ReplyIntelligenceResult["intent"], vertical?: string): string {
  const verticalLabel = vertical || "your business";

  switch (intent) {
    case "interested":
      return `That's great to hear! I'd love to set up a quick 10-minute savings analysis for ${verticalLabel}. We typically save merchants 20-40% on their processing fees. Would you prefer a call or would you like to send over a recent processing statement for review?`;

    case "scheduling":
      return `Absolutely! I can help you find a time. Our specialists are available Monday through Friday, 9am to 6pm ET. Would you like me to send you a link to book directly, or is there a specific time that works best for you?`;

    case "objection":
      return `I completely understand your concern. Many of our current merchants felt the same way before switching. The good news is our analysis is completely free, takes about 10 minutes, and there's absolutely no obligation. Even if you decide to stay with your current processor, you'll have a clear picture of what you're paying. Would that be worth a quick look?`;

    case "not_interested":
      return `No problem at all! If anything changes in the future, we're always here to help. You can reach out anytime for a free analysis. Have a great day!`;

    case "question":
      return `Great question! I'd be happy to help. Could you give me a bit more detail about what you'd like to know? If it's about specific rates or a detailed comparison, I can connect you with one of our specialists who can provide personalized information based on your business.`;

    default:
      return `Thanks for reaching out! I'm here to help with any questions about payment processing for ${verticalLabel}. We help businesses save on processing fees with transparent pricing and no hidden costs. What can I help you with today?`;
  }
}
