import { z } from "zod";
import { db } from "../../db";
import { sdrLeadEvents, sdrMerchants, sdrLeadState, contacts, emailLogs } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq, and, sql, isNull, desc } from "drizzle-orm";
import { upsertContact, addTag, isSdrGhlConfigured, ensureGhlBootstrapped, updateCustomFields, sendChatReply, sendSmsReply, sendEmailReply } from "./ghl-client";
import { onStageChange } from "./ghl-sync-rules";
import { routeBotContext, analyzeForHandoff, executeHandoff, classifyMessageIntent, generateSmartReply } from "./conversation-ai";
import { getAllowedTransitions } from "./stage-rules";
import { scoreLeadFull } from "./scoring";
import { getCanonicalLeadVertical } from "./vertical-resolver";

async function markSequenceEmailReplied(ghlContactId: string, channel: "email" | "sms"): Promise<void> {
  try {
    const [contact] = await db.select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.ghlContactId, ghlContactId))
      .limit(1);

    if (!contact) return;

    const outboundLogs = await db.select()
      .from(emailLogs)
      .where(
        and(
          eq(emailLogs.contactId, contact.id),
          eq(emailLogs.direction, "outbound"),
          isNull(emailLogs.repliedAt)
        )
      )
      .orderBy(desc(emailLogs.createdAt))
      .limit(20);

    const sequenceLogs = outboundLogs.filter(l => {
      const meta = l.metadata as Record<string, any> | null;
      if (!meta?.abVariant) return false;
      if (channel === "sms") return meta?.type === "sms";
      return meta?.type !== "sms";
    });

    if (sequenceLogs.length === 0) return;

    const toMark = sequenceLogs[0];
    await db.update(emailLogs)
      .set({ repliedAt: new Date(), status: "replied" })
      .where(eq(emailLogs.id, toMark.id));
  } catch (err) {
    console.warn("[Chat Handler] Failed to mark sequence email reply:", err);
  }
}

const conversationCreatedSchema = z.object({
  contactId: z.string().optional(),
  id: z.string().optional(),
  conversationId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  pageUrl: z.string().optional(),
  source: z.string().optional(),
}).passthrough();

const chatMessageSchema = z.object({
  contactId: z.string(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  body: z.string().optional(),
  direction: z.string().optional(),
  type: z.string().optional(),
  pageUrl: z.string().optional(),
}).passthrough();

const chatBookingSchema = z.object({
  contactId: z.string(),
  conversationId: z.string().optional(),
  appointmentId: z.string().optional(),
  calendarId: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

async function findMerchantByGhlId(ghlContactId: string): Promise<SdrMerchant | null> {
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
  return merchant || null;
}

async function logInvalidPayload(eventType: string, rawPayload: unknown, validationError: string): Promise<void> {
  try {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: `${eventType}_validation_failed`,
      channel: "chat",
      actorType: "ghl_webhook",
      payloadJson: { rawPayload, validationError },
      ghlRefId: null,
    });
  } catch (logErr) {
    console.error("[Chat Handler] Failed to log invalid payload:", logErr);
  }
}

async function scoreNewChatLead(merchantId: number): Promise<void> {
  try {
    const [leadState] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));
    if (!leadState) return;

    const scores = scoreLeadFull(leadState);
    await db.update(sdrLeadState).set({
      fitScore: scores.fitScore,
      revenueScore: scores.revenueScore,
      reachabilityScore: scores.reachabilityScore,
      priorityScore: scores.priorityScore,
      priorityBucket: scores.priorityBucket,
      scoreBreakdown: scores.breakdown,
      lastScoredAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchantId));

    console.log(`[Chat Handler] Scored chat lead merchant ${merchantId}: priority=${scores.priorityScore}, bucket=${scores.priorityBucket}`);
  } catch (err) {
    console.error(`[Chat Handler] Enrichment/scoring error for merchant ${merchantId}:`, err);
  }
}

async function pushBotContextToGhl(ghlContactId: string, botContext: { contextId: string; name: string }): Promise<void> {
  if (!isSdrGhlConfigured()) return;
  try {
    await updateCustomFields(ghlContactId, {
      lb_last_ai_outcome: `bot_context:${botContext.contextId}`,
    });
  } catch (err) {
    console.error(`[Chat Handler] Failed to push bot context to GHL:`, err);
  }
}

export async function handleConversationCreated(rawPayload: unknown): Promise<void> {
  const parsed = conversationCreatedSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[Chat Handler] conversation-created: invalid payload", parsed.error.message);
    await logInvalidPayload("conversation_created", rawPayload, parsed.error.message);
    return;
  }

  const payload = parsed.data;
  const ghlContactId = payload.contactId || payload.id;
  if (!ghlContactId) {
    console.warn("[Chat Handler] conversation-created: no contactId");
    await logInvalidPayload("conversation_created", rawPayload, "Missing contactId");
    return;
  }

  let merchant = await findMerchantByGhlId(ghlContactId);
  let isNewLead = false;

  if (!merchant) {
    isNewLead = true;
    const businessName = payload.companyName || [payload.firstName, payload.lastName].filter(Boolean).join(" ") || "Chat Lead";

    const [newMerchant] = await db.insert(sdrMerchants).values({
      businessName,
      mainEmail: payload.email || null,
      mainPhone: payload.phone || null,
      ghlContactId,
      source: "chat",
      sourceRef: payload.conversationId || payload.pageUrl || null,
    }).returning();

    merchant = newMerchant;

    const botContext = routeBotContext({
      pageUrl: payload.pageUrl,
    });

    const verticalFromBot = botContext.verticalKey || null;
    if (verticalFromBot) {
      await db.update(sdrMerchants).set({ vertical: verticalFromBot }).where(eq(sdrMerchants.id, merchant.id));
    }

    await db.insert(sdrLeadState).values({
      merchantId: merchant.id,
      currentStage: "DISCOVERED",
      stage: "DISCOVERED",
      sourceType: "chat",
      sourceId: payload.conversationId || null,
      ghlContactId,
      companyName: businessName,
      email: payload.email || null,
      phone: payload.phone || null,
      vertical: verticalFromBot,
      consentEmail: !!payload.email,
      consentSms: false,
    });

    await onStageChange(merchant.id, "DISCOVERED");

    if (isSdrGhlConfigured()) {
      try {
        await ensureGhlBootstrapped();
        await addTag({ contactId: ghlContactId, tags: ["LB-AI-SDR", "LB-CHAT-LEAD"] });
        await pushBotContextToGhl(ghlContactId, botContext);
      } catch (err) {
        console.error("[Chat Handler] Failed to tag GHL contact:", err);
      }
    }

    scoreNewChatLead(merchant.id).catch(err =>
      console.error("[Chat Handler] Background scoring error:", err)
    );

    console.log(`[Chat Handler] New chat lead created: merchant ${merchant.id} from ${payload.pageUrl || "unknown page"}`);
  } else {
    const botContext = routeBotContext({
      pageUrl: payload.pageUrl,
      existingMerchantId: merchant.id,
      verticalHint: merchant.vertical || undefined,
    });
    if (isSdrGhlConfigured()) {
      await pushBotContextToGhl(ghlContactId, botContext);
    }
  }

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant.id,
    eventType: "chat_started",
    channel: "chat",
    actorType: "merchant",
    payloadJson: {
      conversationId: payload.conversationId,
      pageUrl: payload.pageUrl,
      source: payload.source,
      isNewLead,
      botContext: routeBotContext({
        pageUrl: payload.pageUrl,
        existingMerchantId: isNewLead ? undefined : merchant.id,
      }).contextId,
    },
    ghlRefId: payload.conversationId || ghlContactId,
  });

  console.log(`[Chat Handler] conversation-created processed for GHL contact ${ghlContactId}, merchant ${merchant.id}`);
}

export async function handleChatMessage(rawPayload: unknown): Promise<{ reply?: string; handoff?: boolean; sent?: boolean } | void> {
  const parsed = chatMessageSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[Chat Handler] chat-message: invalid payload", parsed.error.message);
    await logInvalidPayload("chat_message", rawPayload, parsed.error.message);
    return;
  }

  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const merchant = await findMerchantByGhlId(ghlContactId);
  const isInbound = payload.direction === "inbound";

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "chat_message",
    channel: "chat",
    actorType: isInbound ? "merchant" : "system",
    payloadJson: payload,
    ghlRefId: payload.messageId || payload.conversationId || ghlContactId,
  });

  if (!merchant || !isInbound || !payload.body) {
    return;
  }

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));

  if (state?.ownerType === "human") {
    console.log(`[Chat Handler] Skipping AI for merchant ${merchant.id} — human-owned`);
    return;
  }

  const recentEvents = await db
    .select({ payloadJson: sdrLeadEvents.payloadJson })
    .from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.merchantId, merchant.id),
      eq(sdrLeadEvents.channel, "chat"),
      eq(sdrLeadEvents.actorType, "merchant"),
    ))
    .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
    .limit(11);

  const conversationHistory = recentEvents
    .slice(1)
    .map(e => {
      const p = e.payloadJson as Record<string, unknown> | null;
      return p?.body as string || "";
    })
    .filter(Boolean);

  const handoffAnalysis = analyzeForHandoff(payload.body, conversationHistory);

  if (handoffAnalysis.shouldHandoff) {
    await executeHandoff(merchant.id, handoffAnalysis);
    return { handoff: true };
  }

  if (state) {
    await db.update(sdrLeadState).set({
      lastReplyAt: new Date(),
      lastTouchAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchant.id));

    const allowed = getAllowedTransitions(state.currentStage);
    if (allowed.includes("ENGAGED")) {
      await db.update(sdrLeadState).set({
        currentStage: "ENGAGED",
        stage: "ENGAGED",
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
      await onStageChange(merchant.id, "ENGAGED", state.currentStage);
    } else if (allowed.includes("OUTREACH_CHAT") && state.currentStage !== "OUTREACH_CHAT") {
      await db.update(sdrLeadState).set({
        currentStage: "OUTREACH_CHAT",
        stage: "OUTREACH_CHAT",
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
      await onStageChange(merchant.id, "OUTREACH_CHAT", state.currentStage);
    }
  }

  const intent = classifyMessageIntent(payload.body);
  const reply = generateSmartReply(intent, getCanonicalLeadVertical({
    subvertical: merchant.subvertical,
    vertical: merchant.vertical,
  }));

  let sent = false;
  if (isSdrGhlConfigured() && reply) {
    try {
      await sendChatReply({
        contactId: ghlContactId,
        message: reply,
        conversationId: payload.conversationId,
      });
      sent = true;

      await db.insert(sdrLeadEvents).values({
        merchantId: merchant.id,
        eventType: "chat_reply_sent",
        channel: "chat",
        actorType: "system",
        payloadJson: { reply, intent, conversationId: payload.conversationId },
        ghlRefId: payload.conversationId || ghlContactId,
      });
    } catch (err) {
      console.error(`[Chat Handler] Failed to send chat reply via GHL:`, err);
    }
  }

  return { reply, sent };
}

export async function handleSmsThread(rawPayload: unknown): Promise<{ reply?: string; sent?: boolean } | void> {
  const parsed = chatMessageSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const isInbound = payload.direction === "inbound";

  if (isInbound && payload.body) {
    markSequenceEmailReplied(ghlContactId, "sms").catch(() => {});
  }

  const merchant = await findMerchantByGhlId(ghlContactId);

  if (!merchant || !isInbound || !payload.body) return;

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant.id,
    eventType: "sms_inbound",
    channel: "sms",
    actorType: "merchant",
    payloadJson: { body: payload.body, ghlContactId },
    ghlRefId: ghlContactId,
  });

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
  if (!state || state.ownerType === "human") return;

  const recentEvents = await db
    .select({ payloadJson: sdrLeadEvents.payloadJson })
    .from(sdrLeadEvents)
    .where(and(
      eq(sdrLeadEvents.merchantId, merchant.id),
      eq(sdrLeadEvents.channel, "sms"),
      eq(sdrLeadEvents.actorType, "merchant"),
    ))
    .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
    .limit(6);

  const history = recentEvents
    .slice(1)
    .map(e => (e.payloadJson as Record<string, unknown> | null)?.body as string || "")
    .filter(Boolean);

  const handoffAnalysis = analyzeForHandoff(payload.body, history);
  if (handoffAnalysis.shouldHandoff) {
    await executeHandoff(merchant.id, handoffAnalysis, "sms");
    return;
  }

  const intent = classifyMessageIntent(payload.body);
  const reply = generateSmartReply(intent, getCanonicalLeadVertical({
    subvertical: merchant.subvertical,
    vertical: merchant.vertical,
  }));

  let sent = false;
  if (isSdrGhlConfigured() && reply) {
    try {
      await sendSmsReply({ contactId: ghlContactId, message: reply });
      sent = true;

      await db.insert(sdrLeadEvents).values({
        merchantId: merchant.id,
        eventType: "sms_ai_reply_sent",
        channel: "sms",
        actorType: "system",
        payloadJson: { reply, intent },
        ghlRefId: ghlContactId,
      });
    } catch (err) {
      console.error(`[Chat Handler] Failed to send SMS reply via GHL:`, err);
    }
  }

  return { reply, sent };
}

export async function handleEmailThread(rawPayload: unknown): Promise<{ reply?: string; sent?: boolean } | void> {
  const emailSchema = z.object({
    contactId: z.string(),
    messageId: z.string().optional(),
    body: z.string().optional(),
    subject: z.string().optional(),
    direction: z.string().optional(),
  }).passthrough();

  const parsed = emailSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const isInbound = payload.direction === "inbound";

  if (isInbound && payload.body) {
    markSequenceEmailReplied(ghlContactId, "email").catch(() => {});
  }

  const merchant = await findMerchantByGhlId(ghlContactId);

  if (!merchant || !isInbound || !payload.body) return;

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant.id,
    eventType: "email_inbound",
    channel: "email",
    actorType: "merchant",
    payloadJson: { body: payload.body, subject: payload.subject, ghlContactId },
    ghlRefId: payload.messageId || ghlContactId,
  });

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
  if (!state || state.ownerType === "human") return;

  const handoffAnalysis = analyzeForHandoff(payload.body);
  if (handoffAnalysis.shouldHandoff) {
    await executeHandoff(merchant.id, handoffAnalysis, "email");
    return;
  }

  const intent = classifyMessageIntent(payload.body);
  const reply = generateSmartReply(intent, getCanonicalLeadVertical({
    subvertical: merchant.subvertical,
    vertical: merchant.vertical,
  }));

  let sent = false;
  if (isSdrGhlConfigured() && reply) {
    try {
      const subject = payload.subject?.startsWith("Re:")
        ? payload.subject
        : `Re: ${payload.subject || "Your inquiry about payment processing"}`;
      await sendEmailReply({
        contactId: ghlContactId,
        subject,
        htmlBody: `<p>${reply.replace(/\n/g, "<br/>")}</p><br/><p style="font-size:12px;color:#888;">Liberty Bancard — Payment Processing Solutions</p>`,
      });
      sent = true;

      await db.insert(sdrLeadEvents).values({
        merchantId: merchant.id,
        eventType: "email_ai_reply_sent",
        channel: "email",
        actorType: "system",
        payloadJson: { reply, intent, subject },
        ghlRefId: payload.messageId || ghlContactId,
      });
    } catch (err) {
      console.error(`[Chat Handler] Failed to send email reply via GHL:`, err);
    }
  }

  return { reply, sent };
}

export async function handleChatBooking(rawPayload: unknown): Promise<void> {
  const parsed = chatBookingSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[Chat Handler] chat-booking: invalid payload", parsed.error.message);
    await logInvalidPayload("chat_booking", rawPayload, parsed.error.message);
    return;
  }

  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const merchant = await findMerchantByGhlId(ghlContactId);

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "chat_booking",
    channel: "chat",
    actorType: "merchant",
    payloadJson: payload,
    ghlRefId: payload.appointmentId || payload.conversationId || ghlContactId,
  });

  if (merchant) {
    const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state) {
      await db.update(sdrLeadState).set({
        currentStage: "MEETING_SET",
        stage: "MEETING_SET",
        meetingId: payload.appointmentId || null,
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));

      await onStageChange(merchant.id, "MEETING_SET", state.currentStage);
    }
  }

  console.log(`[Chat Handler] chat-booking processed for GHL contact ${ghlContactId}`);
}

export interface ChatAnalytics {
  chatsInitiated: number;
  chatMessages: number;
  chatLeadsCaptured: number;
  chatBookings: number;
  chatHandoffs: number;
  handoffRate: number;
}

export async function getChatAnalytics(): Promise<ChatAnalytics> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const chatEvents = await db
      .select({
        eventType: sdrLeadEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(sdrLeadEvents)
      .where(and(
        eq(sdrLeadEvents.channel, "chat"),
        sql`${sdrLeadEvents.createdAt} >= ${today}`,
      ))
      .groupBy(sdrLeadEvents.eventType);

    const eventCounts: Record<string, number> = {};
    for (const row of chatEvents) {
      eventCounts[row.eventType] = row.count;
    }

    const chatsInitiated = eventCounts["chat_started"] || 0;
    const chatMessages = eventCounts["chat_message"] || 0;
    const chatHandoffs = eventCounts["chat_handoff"] || 0;

    const chatLeadsCaptured = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sdrMerchants)
      .where(and(
        eq(sdrMerchants.source, "chat"),
        sql`${sdrMerchants.createdAt} >= ${today}`,
      ))
      .then(rows => rows[0]?.count || 0);

    const chatBookings = eventCounts["chat_booking"] || 0;
    const handoffRate = chatsInitiated > 0 ? Math.round((chatHandoffs / chatsInitiated) * 100) : 0;

    return {
      chatsInitiated,
      chatMessages,
      chatLeadsCaptured,
      chatBookings,
      chatHandoffs,
      handoffRate,
    };
  } catch (err) {
    console.error("[Chat Analytics] Error:", err);
    return {
      chatsInitiated: 0,
      chatMessages: 0,
      chatLeadsCaptured: 0,
      chatBookings: 0,
      chatHandoffs: 0,
      handoffRate: 0,
    };
  }
}

export async function getBotContextForContact(ghlContactId: string, pageUrl?: string): Promise<{
  context: ReturnType<typeof routeBotContext>;
  merchantId?: number;
}> {
  const merchant = await findMerchantByGhlId(ghlContactId);

  const context = routeBotContext({
    pageUrl,
    existingMerchantId: merchant?.id,
    verticalHint: merchant?.vertical || undefined,
  });

  return {
    context,
    merchantId: merchant?.id,
  };
}
