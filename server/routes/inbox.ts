/**
 * AI Inbox Routes — /api/inbox/*
 *
 * Unified inbound message feed with AI classification, reply drafting,
 * and gated action dispatch.
 */
import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { auditLogs, contacts, ghlActivityLog } from "@shared/schema";
import { desc, eq, and, gte, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { classifyIntent, mapIntentToAction } from "../services/sdr/reply-intelligence";
import { resolvePolicy } from "../services/sender-policy";
import { serverError, safeMessage } from "../utils/server-error";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function getGhlConfig() {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId, calendarId: process.env.GHL_CALENDAR_ID };
}

async function ghlFetch(path: string, options: RequestInit = {}): Promise<any> {
  const config = getGhlConfig();
  if (!config) throw new Error("GHL not configured");
  const url = `${GHL_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
        ...(options.headers as Record<string, string> || {}),
      },
    });
    clearTimeout(timer);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GHL ${response.status}: ${body}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export interface InboxItem {
  id: string;
  contactId: number | null;
  contactName: string;
  companyName: string;
  channel: "email" | "sms" | "ghl_chat";
  direction: "inbound";
  body: string;
  receivedAt: string;
  intentLabel: string | null;
  confidence: number | null;
  isRead: boolean;
  phone?: string;
  ghlConversationId?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function intentToDepartment(intent: string): string {
  switch (intent) {
    case "meeting_intent":
    case "interested":
    case "call_me":
    case "booked":
      return "sales";
    case "send_info":
    case "pricing_question":
    case "already_have_provider":
    case "wrong_person":
    case "sent_statement":
      return "accounts";
    case "stop":
    case "angry":
      return "support";
    case "unclear":
    case "later":
    case "not_interested":
    default:
      return "sales";
  }
}

function intentToMessageCategory(intent: string) {
  const dept = intentToDepartment(intent);
  if (dept === "support") return "support" as const;
  if (dept === "accounts") return "accounts" as const;
  return "cold_outreach" as const;
}

function buildDraftReply(intent: string, contactName: string, calendarId?: string): string {
  const bookingUrl = calendarId
    ? `https://api.leadconnectorhq.com/widget/booking/${calendarId}`
    : process.env.GHL_CALENDAR_BOOKING_URL || "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr";
  const firstName = contactName.split(" ")[0] || "there";

  switch (intent) {
    case "meeting_intent":
    case "call_me":
      return `Hi ${firstName},\n\nThank you for reaching out! I'd love to connect. You can book a time directly here: ${bookingUrl}\n\nLooking forward to speaking with you!\n\nBest,\nLiberty Bancard`;
    case "interested":
      return `Hi ${firstName},\n\nThat's great to hear! I'd love to show you how we can help with your payment processing.\n\nYou can book a quick 10-minute savings analysis here: ${bookingUrl}\n\nBest,\nLiberty Bancard`;
    case "send_info":
    case "pricing_question":
      return `Hi ${firstName},\n\nThank you for your interest! I'd be happy to share more details. The best way for us to give you accurate numbers is through a free statement review — we'll do a side-by-side comparison with your current rates.\n\nYou can upload your most recent processing statement here: https://libertybancard.com/upload-statement\n\nOr book a quick call to go over everything: ${bookingUrl}\n\nBest,\nLiberty Bancard`;
    case "sent_statement":
      return `Hi ${firstName},\n\nThank you for sending your statement! Our team will review it and put together a personalized savings analysis within 24–48 hours.\n\nIf you'd like to discuss sooner, you can book a call here: ${bookingUrl}\n\nBest,\nLiberty Bancard`;
    case "already_have_provider":
      return `Hi ${firstName},\n\nI completely understand — it's always smart to evaluate your options before making any changes.\n\nWould you be open to a no-obligation side-by-side comparison? Most merchants we review are surprised to find they're paying 20–40% more than they need to. It takes about 10 minutes and there's no commitment.\n\nBook a quick call here: ${bookingUrl}\n\nBest,\nLiberty Bancard`;
    case "wrong_person":
      return `Hi ${firstName},\n\nApologies for the mix-up! Could you point me to the right person who handles payment processing decisions at your company? We'll follow up with them directly.\n\nThank you,\nLiberty Bancard`;
    case "booked":
      return `Hi ${firstName},\n\nWonderful — looking forward to our meeting! Here's what to expect:\n\n• We'll review your current processing statement\n• Identify specific savings opportunities\n• Answer any questions you have\n\nIf you need to reschedule: ${bookingUrl}\n\nSee you soon!\nLiberty Bancard`;
    case "later":
      return `Hi ${firstName},\n\nPerfectly understood — no rush at all! I'll check back in a few weeks. If anything changes before then, feel free to book a time here: ${bookingUrl}\n\nBest,\nLiberty Bancard`;
    case "not_interested":
      return `Hi ${firstName},\n\nNo problem at all — I appreciate you letting me know. If your situation changes in the future, we're always here to help.\n\nBest,\nLiberty Bancard`;
    case "stop":
    case "angry":
      return ""; // No draft — contact must be suppressed
    case "unclear":
      return `Hi ${firstName},\n\nThank you for reaching out! Could you tell me a little more about what you're looking for? I want to make sure I get you the right information.\n\nBest,\nLiberty Bancard`;
    default:
      return `Hi ${firstName},\n\nThank you for your message! A member of our team will follow up with you shortly.\n\nBest,\nLiberty Bancard`;
  }
}

function buildNextActionRecommendation(intent: string): string {
  switch (intent) {
    case "meeting_intent":
    case "call_me":
    case "interested":
      return "book_appointment";
    case "send_info":
    case "pricing_question":
      return "send_upload_instructions";
    case "sent_statement":
      return "send_upload_instructions";
    case "already_have_provider":
      return "send_reply";
    case "wrong_person":
      return "assign_to_sales";
    case "booked":
      return "assign_to_support";
    case "stop":
    case "angry":
      return "mark_unsubscribed";
    case "unclear":
    case "later":
      return "create_task";
    default:
      return "escalate_to_scott";
  }
}

export function registerInboxRoutes(app: Express) {
  // ─── GET /api/inbox/items — unified inbound feed ───────────────────────────
  app.get("/api/inbox/items", isDashboardUser, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const items: InboxItem[] = [];

      // 1. Inbound email events from audit_logs
      try {
        const emailRows = await db.execute(sql`
          SELECT
            al.id,
            al.entity_id AS contact_id,
            al.details,
            al.created_at
          FROM audit_logs al
          WHERE al.action IN ('inbound_message_processed', 'inbound_email_received', 'email_inbound')
          ORDER BY al.created_at DESC
          LIMIT ${limit}
        `);

        for (const row of emailRows.rows as any[]) {
          const details = row.details || {};
          const body = details.body || details.message || details.text || details.snippet || "";
          if (!body) continue;

          let contactName = "Unknown";
          let companyName = "";
          if (row.contact_id) {
            try {
              const c = await storage.getContact(Number(row.contact_id));
              if (c) {
                contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
                companyName = c.companyName || "";
              }
            } catch { /* ignore */ }
          }

          items.push({
            id: `email-${row.id}`,
            contactId: row.contact_id ? Number(row.contact_id) : null,
            contactName,
            companyName,
            channel: "email",
            direction: "inbound",
            body: String(body).slice(0, 2000),
            receivedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
            intentLabel: details.intent || null,
            confidence: details.confidence || null,
            isRead: !!details.isRead,
          });
        }
      } catch (emailErr: any) {
        console.warn("[Inbox] Email audit_logs query failed:", emailErr.message);
      }

      // 2. Inbound SMS/GHL conversation messages
      const config = getGhlConfig();
      if (config) {
        try {
          const result = await ghlFetch(
            `/conversations/search?locationId=${config.locationId}&limit=${limit}&type=TYPE_PHONE`
          );
          const conversations = result?.conversations || result?.data || [];

          for (const c of conversations.slice(0, 40)) {
            const lastMsg = c.lastMessage || c.lastMessageBody || "";
            if (!lastMsg) continue;
            // Only show inbound
            if (c.lastMessageType === "TYPE_PHONE" || c.lastMessageDirection === "inbound" || c.unreadCount > 0) {
              let contactName = c.fullName || c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown";
              let contactId: number | null = null;

              if (c.contactId) {
                try {
                  const localContacts = await db.execute(sql`
                    SELECT id, first_name, last_name, company_name FROM contacts
                    WHERE ghl_contact_id = ${c.contactId} LIMIT 1
                  `);
                  if (localContacts.rows.length > 0) {
                    const lc = localContacts.rows[0] as any;
                    contactId = Number(lc.id);
                    const name = [lc.first_name, lc.last_name].filter(Boolean).join(" ");
                    if (name) contactName = name;
                  }
                } catch { /* ignore */ }
              }

              items.push({
                id: `sms-${c.id}`,
                contactId,
                contactName,
                companyName: "",
                channel: "sms",
                direction: "inbound",
                body: String(lastMsg).slice(0, 2000),
                receivedAt: c.lastMessageDate || c.dateUpdated || new Date().toISOString(),
                intentLabel: null,
                confidence: null,
                isRead: c.unreadCount === 0,
                phone: c.phone || "",
                ghlConversationId: c.id,
              });
            }
          }
        } catch (smsErr: any) {
          console.warn("[Inbox] GHL SMS fetch failed:", smsErr.message);
        }

        // 3. GHL chat/email conversation messages
        try {
          const result = await ghlFetch(
            `/conversations/search?locationId=${config.locationId}&limit=${Math.min(limit, 30)}&type=TYPE_EMAIL`
          );
          const conversations = result?.conversations || result?.data || [];
          for (const c of conversations.slice(0, 20)) {
            const lastMsg = c.lastMessage || c.lastMessageBody || "";
            if (!lastMsg) continue;

            let contactName = c.fullName || c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown";
            let contactId: number | null = null;

            if (c.contactId) {
              try {
                const localContacts = await db.execute(sql`
                  SELECT id, first_name, last_name FROM contacts
                  WHERE ghl_contact_id = ${c.contactId} LIMIT 1
                `);
                if (localContacts.rows.length > 0) {
                  const lc = localContacts.rows[0] as any;
                  contactId = Number(lc.id);
                  const name = [lc.first_name, lc.last_name].filter(Boolean).join(" ");
                  if (name) contactName = name;
                }
              } catch { /* ignore */ }
            }

            items.push({
              id: `ghl-${c.id}`,
              contactId,
              contactName,
              companyName: "",
              channel: "ghl_chat",
              direction: "inbound",
              body: String(lastMsg).slice(0, 2000),
              receivedAt: c.lastMessageDate || c.dateUpdated || new Date().toISOString(),
              intentLabel: null,
              confidence: null,
              isRead: c.unreadCount === 0,
              ghlConversationId: c.id,
            });
          }
        } catch (chatErr: any) {
          console.warn("[Inbox] GHL chat fetch failed:", chatErr.message);
        }
      }

      // Sort by recency
      items.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

      res.json({
        items: items.slice(0, limit),
        total: items.length,
        ghlConfigured: !!config,
      });
    } catch (err: any) {
      console.error("[Inbox] items error:", err.message);
      serverError(res, err);
    }
  });

  // ─── POST /api/inbox/items/:id/classify ───────────────────────────────────
  app.post("/api/inbox/items/:id/classify", isDashboardUser, async (req, res) => {
    try {
      const { body: messageBody, contactId, channel } = req.body as {
        body: string;
        contactId?: number;
        channel?: string;
      };

      if (!messageBody) {
        return res.status(400).json({ message: "body is required" });
      }

      // Build context
      let merchantName: string | undefined;
      let merchantVertical: string | undefined;
      if (contactId) {
        try {
          const contact = await storage.getContact(contactId);
          if (contact) {
            merchantName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || undefined;
            merchantVertical = contact.vertical || undefined;
          }
        } catch { /* ignore */ }
      }

      const classification = await classifyIntent(messageBody, {
        merchantName,
        merchantVertical,
      });

      const action = mapIntentToAction(classification.intent);
      const calendarId = process.env.GHL_CALENDAR_ID;
      const contactName = merchantName || "there";
      const suggestedReply = buildDraftReply(classification.intent, contactName, calendarId);
      const nextAction = buildNextActionRecommendation(classification.intent);

      // Resolve sender policy
      const msgCategory = intentToMessageCategory(classification.intent);
      const policy = resolvePolicy(msgCategory);

      // Check pause state
      const globalPausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
      const globalPaused = globalPausedRaw === true || globalPausedRaw === "true";

      const channelStr = channel || "email";
      let channelPaused = false;
      if (channelStr === "email") {
        const emailPausedRaw = await storage.getSystemSetting("emailChannelPaused");
        channelPaused = emailPausedRaw !== "false" && emailPausedRaw !== false && emailPausedRaw != null;
      } else if (channelStr === "sms") {
        const smsPausedRaw = await storage.getSystemSetting("smsChannelPaused");
        channelPaused = smsPausedRaw !== "false" && smsPausedRaw !== false && smsPausedRaw != null;
      }

      const sendBlocked = globalPaused || channelPaused;
      const sendBlockReason = globalPaused
        ? "Outbound paused — review only"
        : channelPaused
        ? `${channelStr.toUpperCase()} channel paused — review only`
        : null;

      // Appointment booking: if no calendar, create task flag
      const hasCalendar = !!calendarId;

      res.json({
        itemId: req.params.id,
        classification,
        suggestedReply,
        nextAction,
        senderIdentity: {
          from: policy.from,
          replyTo: policy.replyTo,
          displayName: policy.displayName,
          signatureType: policy.signatureType,
          department: policy.category,
        },
        channel: channelStr,
        sendBlocked,
        sendBlockReason,
        hasCalendar,
        bookingUrl: calendarId
          ? `https://api.leadconnectorhq.com/widget/booking/${calendarId}`
          : process.env.GHL_CALENDAR_BOOKING_URL || null,
      });
    } catch (err: any) {
      console.error("[Inbox] classify error:", err.message);
      serverError(res, err);
    }
  });

  // ─── POST /api/inbox/items/:id/action ─────────────────────────────────────
  // Mutation endpoint — requires dashboard role (admin/manager/agent).
  // Partner, affiliate, and other authenticated-but-non-CRM roles are excluded.
  app.post("/api/inbox/items/:id/action", requireRole("admin", "manager", "agent"), async (req, res) => {
    try {
      const {
        action,
        contactId,
        channel,
        intent,
        confidence,
        replyText,
        ghlConversationId,
        senderIdentity,
      } = req.body as {
        action: string;
        contactId?: number;
        channel?: string;
        intent?: string;
        confidence?: number;
        replyText?: string;
        ghlConversationId?: string;
        senderIdentity?: { from?: string; displayName?: string };
      };

      const ALLOWED_ACTIONS = [
        "send_reply",
        "book_appointment",
        "send_upload_instructions",
        "create_task",
        "assign_to_sales",
        "assign_to_support",
        "mark_unsubscribed",
        "escalate_to_scott",
      ];
      if (!ALLOWED_ACTIONS.includes(action)) {
        return res.status(400).json({ message: `Unknown action: ${action}` });
      }

      const userId = (req.user as any)?.id?.toString() ?? null;
      const channelRaw = channel || "email";
      // Normalize effective transport channel: ghl_chat sends via GHL Email API,
      // so treat it identically to "email" for all pause and policy checks.
      const effectiveChannel = channelRaw === "sms" ? "sms" : "email";
      const channelStr = effectiveChannel;

      // ── Gate: send_reply must check pause state ───────────────────────────
      if (action === "send_reply") {
        const globalPausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
        const globalPaused = globalPausedRaw === true || globalPausedRaw === "true";

        if (globalPaused) {
          await storage.createAuditLog({
            action: "inbox_send_blocked_global_pause",
            entityType: "contact",
            entityId: contactId || 0,
            actorType: "user",
            actorId: userId,
            details: { inboxItemId: req.params.id, channel: channelStr, rawChannel: channelRaw, intent, reason: "outboundGlobalPaused" },
          });
          return res.status(409).json({ message: "Outbound paused — send blocked. Review mode only." });
        }

        if (channelStr === "email") {
          // Covers both "email" and "ghl_chat" (normalized above)
          const emailPausedRaw = await storage.getSystemSetting("emailChannelPaused");
          const emailPaused = emailPausedRaw !== "false" && emailPausedRaw !== false && emailPausedRaw != null;
          if (emailPaused) {
            return res.status(409).json({ message: "Email channel paused — send blocked." });
          }
        } else if (channelStr === "sms") {
          const smsPausedRaw = await storage.getSystemSetting("smsChannelPaused");
          const smsPaused = smsPausedRaw !== "false" && smsPausedRaw !== false && smsPausedRaw != null;
          if (smsPaused) {
            return res.status(409).json({ message: "SMS channel paused — send blocked." });
          }
          // Check A2P registration
          const a2pId = process.env.A2P_REGISTRATION_ID;
          const phoneNumberId = process.env.GHL_PHONE_NUMBER_ID;
          if (!a2pId || !phoneNumberId) {
            return res.status(409).json({
              message: "SMS unavailable — A2P registration not complete. Use email channel.",
            });
          }
        }

        // ── No-prospect-send guard ────────────────────────────────────────
        // If the guard is active, block any send where the recipient email
        // is not on the allowlist. Fail-closed: missing identity = blocked.
        {
          const guardKey = channelStr === "sms" ? "deliveryNoProspectSendSms" : "deliveryNoProspectSendEmail";
          const guardRaw = await storage.getSystemSetting(guardKey);
          const guardActive = guardRaw === true || guardRaw === "true";
          if (guardActive) {
            const allowlistRaw = await storage.getSystemSetting("deliveryTestEmailAllowlist");
            const allowlist: string[] = typeof allowlistRaw === "string"
              ? allowlistRaw.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
              : [];
            // Resolve recipient identity from contact record (fail-closed when absent)
            let recipientEmail: string | null = null;
            if (contactId) {
              const guardContact = await storage.getContact(contactId);
              recipientEmail = guardContact?.email?.trim().toLowerCase() ?? null;
            }
            // Internal domain (@libertybancard.com) is always allowed — matches
            // the same exception used in sequence-worker no-prospect guards.
            const isInternalDomain = recipientEmail !== null && recipientEmail.endsWith("@libertybancard.com");
            const allowed = isInternalDomain || (recipientEmail !== null && allowlist.includes(recipientEmail));
            if (!allowed) {
              await storage.createAuditLog({
                action: "inbox_send_blocked_no_prospect_guard",
                entityType: "contact",
                entityId: contactId || 0,
                actorType: "user",
                actorId: userId,
                details: {
                  inboxItemId: req.params.id,
                  channel: channelStr,
                  recipientEmail,
                  allowlistSize: allowlist.length,
                  reason: recipientEmail
                    ? "recipient not on test allowlist"
                    : "contact has no email — cannot verify identity (fail-closed)",
                  guardKey,
                  timestamp: new Date().toISOString(),
                },
              });
              return res.status(409).json({
                message: `No-prospect-send guard active — ${recipientEmail ? `${recipientEmail} is not on the test allowlist` : "contact has no verified email identity"}. Disable the guard in Deliverability Settings or add this address to the allowlist.`,
                blocked: true,
                guardKey,
              });
            }
          }
        }

        // ── Fail-fast GHL send ────────────────────────────────────────────
        if (!replyText?.trim()) {
          return res.status(400).json({ message: "replyText is required for send_reply" });
        }

        const sendConfig = getGhlConfig();
        if (!sendConfig) {
          // GHL not configured — record as draft-only, no error
          await storage.createAuditLog({
            action: "inbox_send_reply_draft_only",
            entityType: "contact",
            entityId: contactId || 0,
            actorType: "user",
            actorId: userId,
            details: {
              inboxItemId: req.params.id,
              channel: channelStr,
              intent,
              deliveryOutcome: "ghl_not_configured",
              timestamp: new Date().toISOString(),
            },
          });
          return res.json({ ok: true, delivered: false, deliveryNote: "GHL not configured — message not sent." });
        }

        // Build GHL message payload
        const msgType = channelStr === "sms" ? "SMS" : "Email";
        const ghlPayload: any = { type: msgType, message: replyText };
        if (ghlConversationId) ghlPayload.conversationId = ghlConversationId;
        if (channelStr === "email" && contactId) {
          const contact = await storage.getContact(contactId);
          if (contact?.email) {
            ghlPayload.to = [contact.email];
            ghlPayload.from = senderIdentity?.from || "accounts@libertybancard.com";
          }
        }

        let ghlMessageId: string | null = null;
        try {
          const sendResult = await ghlFetch("/conversations/messages", {
            method: "POST",
            body: JSON.stringify(ghlPayload),
          });
          ghlMessageId = sendResult?.messageId || sendResult?.id || null;
        } catch (sendErr: any) {
          // Delivery failed — write failure audit and return error (fail-fast)
          console.error("[Inbox] GHL send failed:", sendErr.message);
          await storage.createAuditLog({
            action: "inbox_send_reply_failed",
            entityType: "contact",
            entityId: contactId || 0,
            actorType: "user",
            actorId: userId,
            details: {
              inboxItemId: req.params.id,
              channel: channelStr,
              intent,
              deliveryOutcome: "failed",
              error: sendErr.message,
              timestamp: new Date().toISOString(),
            },
          });
          return res.status(502).json({
            ok: false,
            message: safeMessage(sendErr.message, "Reply delivery failed"),
            deliveryOutcome: "failed",
          });
        }

        // Delivery succeeded — write success audit and fall through to common audit below
        await storage.createAuditLog({
          action: "inbox_send_reply_sent",
          entityType: "contact",
          entityId: contactId || 0,
          actorType: "user",
          actorId: userId,
          details: {
            inboxItemId: req.params.id,
            channel: channelStr,
            intent,
            confidence,
            deliveryOutcome: "sent",
            ghlMessageId,
            senderIdentity: senderIdentity?.from || null,
            timestamp: new Date().toISOString(),
          },
        });
        return res.json({ ok: true, delivered: true, ghlMessageId, action: "send_reply" });
      }

      // ── book_appointment ──────────────────────────────────────────────────
      if (action === "book_appointment") {
        const calendarId = process.env.GHL_CALENDAR_ID;
        if (!calendarId && contactId) {
          // Create a manual task
          await storage.createTask({
            title: `Book appointment manually`,
            description: `AI Inbox: book_appointment action — intent: ${intent || "meeting_intent"}. Contact ID: ${contactId}. No GHL calendar configured.`,
            contactId,
            status: "pending",
            priority: "high",
            source: "ai_inbox",
            automationKey: `ai_inbox_book_${req.params.id}`,
          });
        }
        // If calendar is configured, the booking URL is returned in classify — no server action needed
      }

      // ── send_upload_instructions ──────────────────────────────────────────
      if (action === "send_upload_instructions") {
        // This action is informational — inserts upload copy into reply draft on the frontend
        // Server-side we log it; actual send goes through send_reply
      }

      // ── create_task ───────────────────────────────────────────────────────
      if (action === "create_task" && contactId) {
        await storage.createTask({
          title: `Follow up with contact — ${intent || "unclear"} intent`,
          description: `AI Inbox classified inbound message as "${intent}" (confidence: ${confidence ? Math.round(confidence * 100) : "?"}%). Manual follow-up required.`,
          contactId,
          status: "pending",
          priority: "normal",
          source: "ai_inbox",
          automationKey: `ai_inbox_task_${req.params.id}`,
        });
      }

      // ── assign_to_sales ───────────────────────────────────────────────────
      if (action === "assign_to_sales" && contactId) {
        await storage.createTask({
          title: "Route to Sales — AI Inbox",
          description: `Inbound message classified as "${intent}" — route to sales team. Review original message in inbox.`,
          contactId,
          status: "pending",
          priority: "normal",
          source: "ai_inbox",
          automationKey: `ai_inbox_sales_${req.params.id}`,
        });
      }

      // ── assign_to_support ─────────────────────────────────────────────────
      if (action === "assign_to_support" && contactId) {
        await storage.createTask({
          title: "Route to Support — AI Inbox",
          description: `Inbound message classified as "${intent}" — route to support/onboarding team.`,
          contactId,
          status: "pending",
          priority: "normal",
          source: "ai_inbox",
          automationKey: `ai_inbox_support_${req.params.id}`,
        });
      }

      // ── mark_unsubscribed ─────────────────────────────────────────────────
      if (action === "mark_unsubscribed" && contactId) {
        // Fail-fast: if suppression write fails, surface the error — don't claim success
        let suppressionOutcome: "suppressed" | "failed" = "suppressed";
        let suppressionError: string | null = null;
        try {
          await (storage as any).updateContact(contactId, {
            emailStatus: "unsubscribed",
            doNotContact: true,
          });
        } catch (suppErr: any) {
          suppressionOutcome = "failed";
          suppressionError = suppErr.message;
          await storage.createAuditLog({
            action: "contact_unsubscribed_inbox_failed",
            entityType: "contact",
            entityId: contactId,
            actorType: "user",
            actorId: userId,
            details: { inboxItemId: req.params.id, intent, channel: channelStr, error: suppErr.message },
          });
          return res.status(500).json({
            ok: false,
            message: safeMessage(suppErr.message, "Failed to suppress contact"),
            deliveryOutcome: "failed",
          });
        }
        await storage.createAuditLog({
          action: "contact_unsubscribed_inbox",
          entityType: "contact",
          entityId: contactId,
          actorType: "user",
          actorId: userId,
          details: {
            inboxItemId: req.params.id,
            intent,
            channel: channelStr,
            reason: "stop_or_angry_intent",
            suppressionOutcome,
          },
        });
      }

      // ── escalate_to_scott ─────────────────────────────────────────────────
      if (action === "escalate_to_scott" && contactId) {
        await storage.createTask({
          title: "Escalate to Scott — AI Inbox",
          description: `AI Inbox: message classified as "${intent}" and flagged for Scott's review. High priority.`,
          contactId,
          status: "pending",
          priority: "high",
          source: "ai_inbox",
          automationKey: `ai_inbox_escalate_${req.params.id}`,
        });
        storage.createNotification({
          channel: "internal",
          title: "Inbox Escalation — Review Required",
          message: `Contact #${contactId} requires Scott's attention. Intent: ${intent || "unknown"}.`,
          type: "alert",
          metadata: { contactId, intent, inboxItemId: req.params.id },
        } as any).catch(() => {});
      }

      // ── Audit log for every action ────────────────────────────────────────
      await storage.createAuditLog({
        action: `inbox_action_${action}`,
        entityType: "contact",
        entityId: contactId || 0,
        actorType: "user",
        actorId: userId,
        details: {
          inboxItemId: req.params.id,
          action,
          channel: channelStr,
          intent: intent || null,
          confidence: confidence || null,
          senderIdentity: senderIdentity?.from || null,
          timestamp: new Date().toISOString(),
        },
      });

      res.json({ ok: true, action, message: `Action "${action}" executed successfully.` });
    } catch (err: any) {
      console.error("[Inbox] action error:", err.message);
      serverError(res, err);
    }
  });
}
