/**
 * AI Inbox Routes — /api/inbox/*
 *
 * Unified inbound message feed with AI classification, reply drafting,
 * and gated action dispatch.
 */
import crypto from "crypto";
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
import { authorizeContactAccess, authorizeInboxItemAccess } from "../services/crm-object-access";
import { rememberInboxSourceItem } from "../storage/inbox";
import { applyConsentCommand } from "../services/consent-authority";

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
      // Never copy provider bodies into exceptions: callers log stable codes.
      throw new Error(`GHL_HTTP_${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

const INBOX_CURSOR_VERSION = 1;
const MAX_INBOX_CURSOR_BYTES = 48 * 1024;
const MAX_INBOX_CURSOR_REMAINDER = 10;
type SourceCursor = { offset?: number; afterId?: string; highWater?: string; exhausted?: boolean };
type InboxCursorPayload = {
  v: number;
  query: string;
  actor: string;
  sort: "receivedAt:desc,source:asc,id:asc";
  merge?: { timestamp: string; source: string; id: string };
  sources: Record<string, SourceCursor>;
  remainder?: InboxItem[];
};
function inboxCursorSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!secret) throw new Error("INBOX_CURSOR_SECRET_UNAVAILABLE");
  return secret;
}
function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}
function encodeInboxCursor(payload: InboxCursorPayload): string {
  if ((payload.remainder?.length || 0) > MAX_INBOX_CURSOR_REMAINDER) throw new Error("INBOX_CURSOR_REMAINDER_TOO_LARGE");
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > MAX_INBOX_CURSOR_BYTES) throw new Error("INBOX_CURSOR_TOO_LARGE");
  const encoded = Buffer.from(serialized).toString("base64url");
  const signature = crypto.createHmac("sha256", inboxCursorSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
function decodeInboxCursor(raw: string): InboxCursorPayload | null {
  try {
    if (raw.length > Math.ceil(MAX_INBOX_CURSOR_BYTES * 4 / 3) + 128) return null;
    const [encoded, signature] = raw.split(".");
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac("sha256", inboxCursorSecret()).update(encoded).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return parsed?.v === INBOX_CURSOR_VERSION
      && parsed?.sources
      && (!parsed.remainder || (Array.isArray(parsed.remainder) && parsed.remainder.length <= MAX_INBOX_CURSOR_REMAINDER))
      && parsed?.sort === "receivedAt:desc,source:asc,id:asc"
      ? parsed as InboxCursorPayload : null;
  } catch {
    return null;
  }
}

export interface InboxItem {
  id: string;
  contactId: number | null;
  contactName: string;
  companyName: string;
  channel: "email" | "sms" | "ghl_chat" | "voicemail" | "site";
  direction: "inbound";
  body: string;
  subject?: string;
  preview?: string;
  receivedAt: string;
  intentLabel: string | null;
  confidence: number | null;
  isRead: boolean;
  assignedTo?: string | null;
  aiIntent?: string | null;
  phone?: string;
  ghlConversationId?: string;
  // voicemail-specific
  voicemailDuration?: number | null;
  voicemailUrl?: string | null;
  transcript?: string | null;
  // site/live-chat-specific
  liveChatSessionId?: string | null;
  liveChatStatus?: string | null;
  pageUrl?: string | null;
}

/** Stable, gap-free merge. Provider continuations may advance through the
 * fetched batches because every non-emitted winner is carried in remainder. */
export function mergeInboxPage(
  remainder: InboxItem[],
  fetched: InboxItem[],
  limit: number,
): { page: InboxItem[]; remainder: InboxItem[] } {
  const byId = new Map<string, InboxItem>();
  for (const item of [...remainder, ...fetched]) if (!byId.has(item.id)) byId.set(item.id, item);
  const ordered = [...byId.values()].sort((a, b) =>
    new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    || a.id.split("::")[0].localeCompare(b.id.split("::")[0])
    || a.id.localeCompare(b.id));
  return { page: ordered.slice(0, limit), remainder: ordered.slice(limit) };
}
function cursorSafeInboxItem(item: InboxItem): InboxItem {
  return {
    ...item,
    contactName: item.contactName.slice(0, 256),
    companyName: item.companyName.slice(0, 256),
    body: item.body.slice(0, 2000),
    subject: item.subject?.slice(0, 512),
    preview: item.preview?.slice(0, 512),
    phone: item.phone?.slice(0, 64),
    voicemailUrl: item.voicemailUrl?.slice(0, 2048),
    transcript: item.transcript?.slice(0, 4000),
    pageUrl: item.pageUrl?.slice(0, 2048),
  };
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
      const rawLimit = req.query.limit ?? "50";
      if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) {
        return res.status(400).json({ code: "INVALID_INBOX_QUERY", reason: "limit" });
      }
      const limit = Number(rawLimit);
      const channel = (req.query.channel as string) || "all";
      const filter = (req.query.filter as string) || "all"; // "all" | "unread" | "needs_reply"
      if (!["all", "email", "sms", "ghl_chat", "voicemail", "site"].includes(channel)) {
        return res.status(400).json({ code: "INVALID_INBOX_QUERY", reason: "channel" });
      }
      if (!["all", "unread", "needs_reply"].includes(filter)) {
        return res.status(400).json({ code: "INVALID_INBOX_QUERY", reason: "filter" });
      }
      const cursor = req.query.cursor as string | undefined;
      const queryFingerprint = fingerprint(JSON.stringify({ channel, filter, limit }));
      const actorFingerprint = fingerprint(JSON.stringify({
        id: (req.user as any)?.id || null,
        role: (req.user as any)?.role || null,
        email: (req.user as any)?.email || null,
      }));
      let cursorPayload: InboxCursorPayload | null = null;
      if (cursor) {
        cursorPayload = decodeInboxCursor(cursor);
        if (!cursorPayload || cursorPayload.query !== queryFingerprint || cursorPayload.actor !== actorFingerprint) {
          // Do not reveal whether a cursor belonged to a different actor/query.
          return res.status(400).json({ code: "INVALID_INBOX_QUERY", reason: "cursor" });
        }
      }
      const requestedSources = channel === "all"
        ? ["email_audit", "ghl_sms", "ghl_chat", "ghl_voicemail", "live_chat"]
        : [channel === "email" ? "email_audit" : channel === "sms" ? "ghl_sms" : channel === "ghl_chat" ? "ghl_chat" : channel === "voicemail" ? "ghl_voicemail" : "live_chat"];
      // At most one overfetch item per source is needed for a stable merge, so
      // the signed remainder stays small even at the maximum API limit.
      const bufferedCount = cursorPayload?.remainder?.length || 0;
      const drainRemainderOnly = bufferedCount >= limit;
      const fetchBudget = Math.max(1, limit - bufferedCount);
      const perSourceLimit = Math.max(1, Math.ceil(fetchBudget / requestedSources.length));
      const items: InboxItem[] = [...(cursorPayload?.remainder || [])];
      const sources: Array<{ source: string; status: "ok" | "failed" | "not_configured"; fetched: number; truncated: boolean; errorCode?: string }> = [];
      const sourceContinuations: Record<string, SourceCursor> = { ...(cursorPayload?.sources || {}) };

      // 1. Inbound email events from audit_logs
      if (!drainRemainderOnly && (channel === "all" || channel === "email"))
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
           LIMIT ${perSourceLimit}
           OFFSET ${sourceContinuations.email_audit?.offset || 0}
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
            id: `audit:local::email:${row.id}`,
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
         const emailFetched = emailRows.rows.length;
         const emailExhausted = emailFetched < perSourceLimit;
         sourceContinuations.email_audit = {
           offset: (sourceContinuations.email_audit?.offset || 0) + emailFetched,
           highWater: emailRows.rows[0] ? String((emailRows.rows[0] as any).created_at) : sourceContinuations.email_audit?.highWater,
           exhausted: emailExhausted,
         };
          sources.push({ source: "email_audit", status: "ok", fetched: items.filter(i => i.channel === "email").length, truncated: !emailExhausted });
       } catch (emailErr: any) {
         console.warn("[Inbox] source_failed code=EMAIL_QUERY_FAILED");
         sources.push({ source: "email_audit", status: "failed", fetched: 0, truncated: true, errorCode: "QUERY_FAILED" });
      }

      // 2. Inbound SMS/GHL conversation messages
      const config = getGhlConfig();
      if (config && !drainRemainderOnly) {
        if (channel === "all" || channel === "sms")
        try {
          const result = await ghlFetch(
            `/conversations/search?locationId=${config.locationId}&limit=${perSourceLimit}&type=TYPE_PHONE${sourceContinuations.ghl_sms?.afterId ? `&startAfterId=${encodeURIComponent(sourceContinuations.ghl_sms.afterId)}` : ""}`
          );
          const conversations = result?.conversations || result?.data || [];

          for (const c of conversations) {
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
                id: `ghl:${config.locationId}::sms:${c.id}`,
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
          const smsLastId = result?.lastId || conversations[conversations.length - 1]?.id;
          const smsExhausted = conversations.length < perSourceLimit && !result?.nextPage;
          sourceContinuations.ghl_sms = { afterId: smsLastId, highWater: conversations[0]?.lastMessageDate, exhausted: smsExhausted };
          sources.push({ source: "ghl_sms", status: "ok", fetched: items.filter(i => i.channel === "sms").length, truncated: !smsExhausted });
        } catch (smsErr: any) {
          console.warn("[Inbox] source_failed code=GHL_SMS_PROVIDER_FAILED");
          sources.push({ source: "ghl_sms", status: "failed", fetched: 0, truncated: true, errorCode: "PROVIDER_FAILED" });
        }

        // 3. GHL chat/email conversation messages
        if (channel === "all" || channel === "ghl_chat") {
          try {
            const result = await ghlFetch(
              `/conversations/search?locationId=${config.locationId}&limit=${perSourceLimit}&type=TYPE_EMAIL${sourceContinuations.ghl_chat?.afterId ? `&startAfterId=${encodeURIComponent(sourceContinuations.ghl_chat.afterId)}` : ""}`
            );
            const conversations = result?.conversations || result?.data || [];
            for (const c of conversations) {
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
                id: `ghl:${config.locationId}::chat:${c.id}`,
                contactId,
                contactName,
                companyName: "",
                channel: "ghl_chat",
                direction: "inbound",
                body: String(lastMsg).slice(0, 2000),
                preview: String(lastMsg).slice(0, 120),
                receivedAt: c.lastMessageDate || c.dateUpdated || new Date().toISOString(),
                intentLabel: null,
                confidence: null,
                isRead: c.unreadCount === 0,
                ghlConversationId: c.id,
              });
            }
            const chatPageLimit = perSourceLimit;
            const chatLastId = result?.lastId || conversations[conversations.length - 1]?.id;
            const chatExhausted = conversations.length < chatPageLimit && !result?.nextPage;
            sourceContinuations.ghl_chat = { afterId: chatLastId, highWater: conversations[0]?.lastMessageDate, exhausted: chatExhausted };
            sources.push({ source: "ghl_chat", status: "ok", fetched: items.filter(i => i.channel === "ghl_chat").length, truncated: !chatExhausted });
          } catch (chatErr: any) {
            console.warn("[Inbox] source_failed code=GHL_CHAT_PROVIDER_FAILED");
            sources.push({ source: "ghl_chat", status: "failed", fetched: 0, truncated: true, errorCode: "PROVIDER_FAILED" });
          }
        }

        // 4. Voicemail items from GHL (TYPE_VOICE conversations)
        if ((channel === "all" || channel === "voicemail") && process.env.VOICEMAIL_SYNC_ENABLED !== "false") {
          try {
            const result = await ghlFetch(
              `/conversations/search?locationId=${config.locationId}&limit=${perSourceLimit}&type=TYPE_VOICE${sourceContinuations.ghl_voicemail?.afterId ? `&startAfterId=${encodeURIComponent(sourceContinuations.ghl_voicemail.afterId)}` : ""}`
            );
            const conversations = result?.conversations || result?.data || [];
            for (const c of conversations) {
              const lastMsg = c.lastMessage || c.lastMessageBody || c.transcriptText || "";
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
                id: `ghl:${config.locationId}::voicemail:${c.id}`,
                contactId,
                contactName,
                companyName: "",
                channel: "voicemail",
                direction: "inbound",
                body: lastMsg || "Voicemail received",
                preview: lastMsg ? String(lastMsg).slice(0, 120) : "Voicemail received",
                receivedAt: c.lastMessageDate || c.dateUpdated || new Date().toISOString(),
                intentLabel: null,
                confidence: null,
                isRead: c.unreadCount === 0,
                phone: c.phone || "",
                ghlConversationId: c.id,
                voicemailDuration: c.duration || c.lastMessageDuration || null,
                voicemailUrl: c.mediaUrl || c.recordingUrl || c.lastMessageMedia?.url || null,
                transcript: c.transcriptText || null,
              });
            }
            const vmLastId = result?.lastId || conversations[conversations.length - 1]?.id;
            const vmExhausted = conversations.length < perSourceLimit && !result?.nextPage;
            sourceContinuations.ghl_voicemail = { afterId: vmLastId, highWater: conversations[0]?.lastMessageDate, exhausted: vmExhausted };
            sources.push({ source: "ghl_voicemail", status: "ok", fetched: items.filter(i => i.channel === "voicemail").length, truncated: !vmExhausted });
          } catch (vmErr: any) {
            console.warn("[Inbox] source_failed code=GHL_VOICEMAIL_PROVIDER_FAILED");
            sources.push({ source: "ghl_voicemail", status: "failed", fetched: 0, truncated: true, errorCode: "PROVIDER_FAILED" });
          }
        }
        if ((channel === "all" || channel === "voicemail") && process.env.VOICEMAIL_SYNC_ENABLED === "false") {
          sourceContinuations.ghl_voicemail = { ...sourceContinuations.ghl_voicemail, exhausted: false };
          sources.push({ source: "ghl_voicemail", status: "not_configured", fetched: 0, truncated: true });
        }
      }

      // 5. Live-chat sessions as "site" channel items
      if (!drainRemainderOnly && (channel === "all" || channel === "site")) {
        try {
          const liveChatLimit = perSourceLimit;
          const liveChats = await storage.getAllLiveChats({ limit: liveChatLimit, offset: sourceContinuations.live_chat?.offset || 0 });
          for (const chat of liveChats) {
            const contactName = chat.visitorName || chat.visitorEmail || "Site Visitor";
            const preview = `${chat.status === "active" ? "Active" : "Closed"} chat${chat.pageUrl ? ` from ${chat.pageUrl}` : ""}`;
            items.push({
              id: `live_chat:local::session:${chat.id}`,
              contactId: chat.contactId || null,
              contactName,
              companyName: "",
              channel: "site",
              direction: "inbound",
              body: preview,
              preview,
              receivedAt: chat.lastMessageAt instanceof Date ? chat.lastMessageAt.toISOString() : String(chat.lastMessageAt),
              intentLabel: null,
              confidence: null,
              isRead: chat.status !== "active",
              pageUrl: chat.pageUrl || null,
              liveChatSessionId: chat.sessionId,
              liveChatStatus: chat.status,
            });
          }
          const liveChatExhausted = liveChats.length < liveChatLimit;
          sourceContinuations.live_chat = {
            offset: (sourceContinuations.live_chat?.offset || 0) + liveChats.length,
            highWater: liveChats[0] ? String(liveChats[0].lastMessageAt) : sourceContinuations.live_chat?.highWater,
            exhausted: liveChatExhausted,
          };
          sources.push({ source: "live_chat", status: "ok", fetched: items.filter(i => i.channel === "site").length, truncated: !liveChatExhausted });
        } catch (lcErr: any) {
          console.warn("[Inbox] source_failed code=LIVE_CHAT_QUERY_FAILED");
          sources.push({ source: "live_chat", status: "failed", fetched: 0, truncated: true, errorCode: "QUERY_FAILED" });
        }
      }
      if (!config) {
        const unavailableProviderSources = [
          ...(channel === "all" || channel === "sms" ? ["ghl_sms"] : []),
          ...(channel === "all" || channel === "ghl_chat" ? ["ghl_chat"] : []),
          ...(channel === "all" || channel === "voicemail" ? ["ghl_voicemail"] : []),
        ];
        for (const providerSource of unavailableProviderSources) {
          sourceContinuations[providerSource] = { ...sourceContinuations[providerSource], exhausted: false };
          sources.push({ source: providerSource, status: "not_configured", fetched: 0, truncated: true });
        }
      }
      for (const source of sources) {
        if (source.status !== "ok") sourceContinuations[source.source] = { ...sourceContinuations[source.source], exhausted: false };
      }
      if (drainRemainderOnly && sources.length === 0) {
        for (const source of requestedSources) {
          sources.push({
            source,
            status: "ok",
            fetched: 0,
            truncated: sourceContinuations[source]?.exhausted !== true,
          });
        }
      }
      // Persist a source-scoped, immutable server observation before exposing it.
      // No mutation can rely on a browser-provided contact, channel, or body.
      await Promise.all(items
        .filter((item) => item.contactId !== null)
        .map((item) => rememberInboxSourceItem({
          sourceItemId: item.id,
          sourceItemType: item.channel,
          sourceNamespace: item.id.split("::")[0],
          providerConversationId: item.ghlConversationId ?? item.liveChatSessionId ?? null,
          sourceBody: item.body,
          sourceReceivedAt: new Date(item.receivedAt),
          contactId: item.contactId!,
        })));

      // Agents only see records with a locally mapped owned/unassigned contact.
      // Unmapped provider conversations intentionally remain invisible.
      if ((req.user as any)?.role === "agent") {
        const agentEmail = (req.user as any)?.email;
        const visibility = await Promise.all(items.map(async (item) => {
          if (!item.contactId) return false;
          const contact = await storage.getContact(item.contactId);
          return !!contact && (!contact.assignedTo || contact.assignedTo === agentEmail);
        }));
        for (let i = items.length - 1; i >= 0; i--) if (!visibility[i]) items.splice(i, 1);
      }

      // Apply smart filters
      let filtered = items;
      if (filter === "unread") {
        filtered = items.filter(i => !i.isRead);
      } else if (filter === "needs_reply") {
        // Items that are unread and have an intent that warrants a reply
        filtered = items.filter(i => !i.isRead && i.intentLabel !== "stop" && i.intentLabel !== "not_interested");
      }

      const merged = mergeInboxPage([], filtered, limit);
      const page = merged.page;
      if (merged.remainder.length > MAX_INBOX_CURSOR_REMAINDER) {
        throw new Error("INBOX_CURSOR_REMAINDER_TOO_LARGE");
      }
      const hasMoreKnown = merged.remainder.length > 0;
      const sourcesComplete = requestedSources.every(source => sourceContinuations[source]?.exhausted === true);
      const complete = sourcesComplete && !hasMoreKnown;
      const nextCursor = (hasMoreKnown || !sourcesComplete)
        ? encodeInboxCursor({
            v: INBOX_CURSOR_VERSION,
            query: queryFingerprint,
            actor: actorFingerprint,
            sort: "receivedAt:desc,source:asc,id:asc",
            merge: page.length ? {
              timestamp: page[page.length - 1].receivedAt,
              source: page[page.length - 1].id.split("::")[0],
              id: page[page.length - 1].id.split("::")[1] || page[page.length - 1].id,
            } : cursorPayload?.merge,
            sources: sourceContinuations,
            remainder: merged.remainder.map(cursorSafeInboxItem),
          })
        : null;

      res.json({
        items: page,
        knownFilteredCount: filtered.length,
        totalIsExact: complete,
        resultScope: complete ? "all_sources_exhausted" : "partial_source_pages",
        complete,
        partial: !complete,
        incompleteSources: sources.filter(source => source.status !== "ok" || source.truncated).map(source => source.source),
        hasMoreKnown,
        sourceStatus: sources,
        nextCursor,
        ghlConfigured: !!config,
      });
    } catch (err: any) {
      console.error("[Inbox] request_failed code=INBOX_ITEMS_FAILED");
      serverError(res, err);
    }
  });

  // ─── POST /api/inbox/items/:id/classify ───────────────────────────────────
  app.post("/api/inbox/items/:id/classify", isDashboardUser, async (req, res) => {
    try {
      const resolved = await authorizeInboxItemAccess(req, res, String(req.params.id));
      if (!resolved) return;
      if (!resolved.body) return res.status(409).json({ message: "Inbox item has no immutable server-observed content" });

      // Build context
      let merchantName: string | undefined;
      let merchantVertical: string | undefined;
      if (resolved.contact) {
        try {
          const contact = resolved.contact;
          if (contact) {
            merchantName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || undefined;
            merchantVertical = contact.vertical || undefined;
          }
        } catch { /* ignore */ }
      }

      const classification = await classifyIntent(resolved.body, {
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

      const channelStr = resolved.channel || "email";
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
      let {
        action,
        contactId,
        channel,
        intent,
        confidence,
        replyText,
        senderIdentity,
      } = req.body as {
        action: string;
        contactId?: number;
        channel?: string;
        intent?: string;
        confidence?: number;
        replyText?: string;
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
      const resolved = await authorizeInboxItemAccess(req, res, String(req.params.id), { exactAssignment: true });
      if (!resolved) return;
      // Client body identifiers are presentation data, never authorization input.
      contactId = resolved.contact.id;
      channel = resolved.channel || channel;

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
        if (resolved.providerConversationId) ghlPayload.conversationId = resolved.providerConversationId;
        if (channelStr === "email" && contactId) {
          const contact = await storage.getContact(contactId);
          if (contact?.email) {
            ghlPayload.to = [contact.email];
            ghlPayload.from = senderIdentity?.from || "accounts@libertybancard.com";
          }
        }

        // ── Pause authority gate (transport boundary) ─────────────────────────
        // Required ordering (prevents pause-activation race):
        //   1. authorize()         — check current state
        //   2. registerInflight()  — hold the token so the activation barrier
        //                            counts us; drain waits for us before pausing
        //   3. recheckEpoch()      — verify epoch unchanged after we hold the token
        //   4. ghlFetch()          — network I/O (the actual send)
        //   5. deregisterInflight() — release in finally
        //
        // Placing recheckEpoch() AFTER registerInflight() closes the race window
        // where a pause could commit between check and hold with no token visible.
        let ghlMessageId: string | null = null;
        try {
          const { authorize, recheckEpoch } = await import("../services/outbound-pause-authority");
          const { registerInflight, deregisterInflight } = await import("../services/outbound-control-service");

          // Step 1: authorize
          const pauseDecision = await authorize({});
          if (!pauseDecision.allowed) {
            return res.status(503).json({ message: `Outbound paused: ${pauseDecision.reasonCode}` });
          }

          // Step 2: register in-flight BEFORE epoch recheck
          const inflightToken = crypto.randomUUID();
          await registerInflight(inflightToken, pauseDecision.epoch);
          let sendResult: any;
          try {
            // Step 3: epoch recheck after registration (drain sees our token now)
            const epochOk = await recheckEpoch(pauseDecision.epoch);
            if (!epochOk) {
              return res.status(503).json({ message: "Outbound paused: epoch changed before send" });
            }

            // Step 4: network I/O
            sendResult = await ghlFetch("/conversations/messages", {
              method: "POST",
              body: JSON.stringify(ghlPayload),
            });
          } finally {
            // Step 5: always deregister, even on error or early return
            deregisterInflight(inflightToken);
          }
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
          await storage.createAuthorityTask({
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
        await storage.createAuthorityTask({
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
        await storage.createAuthorityTask({
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
        await storage.createAuthorityTask({
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
          const withdrawalChannel = channelStr === "sms" || channelStr === "email"
            ? channelStr
            : null;
          await applyConsentCommand({
            subject: { type: "contact", id: contactId },
            kind: withdrawalChannel ? "opt_out" : "global_dnc",
            ...(withdrawalChannel ? { channel: withdrawalChannel } : {}),
            purpose: "outreach",
            eventNamespace: "inbox_action",
            eventKey: `${req.params.id}:mark_unsubscribed:${withdrawalChannel ?? "global"}`,
            source: "inbox_stop_or_angry",
            actorId: userId,
            evidence: { inboxItemId: req.params.id, intent, inboundChannel: channelStr },
            details: { inboxItemId: req.params.id, intent, channel: channelStr },
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
        await storage.createAuthorityTask({
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

  // ─── GET /api/inbox/contacts/:contactId/thread — cross-channel timeline ───
  app.get("/api/inbox/contacts/:contactId/thread", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      if (!contactId || isNaN(contactId)) {
        return res.status(400).json({ message: "Invalid contactId" });
      }
      if (!await authorizeContactAccess(req, res, contactId)) return;

      const { getContactCommunicationEvents } = await import("../services/communication-events");
      const events = await getContactCommunicationEvents(contactId, 100);

      // Also pull live-chat messages if any sessions are linked to this contact
      const chatRows = await db.execute(sql`
        SELECT lc.id, lc.session_id, lc.status, lc.created_at, lc.last_message_at,
               lcm.id AS msg_id, lcm.sender_type, lcm.sender_name, lcm.content, lcm.created_at AS msg_at
        FROM live_chats lc
        LEFT JOIN live_chat_messages lcm ON lcm.chat_id = lc.id
        WHERE lc.contact_id = ${contactId}
        ORDER BY lcm.created_at DESC
        LIMIT 50
      `).catch(() => ({ rows: [] }));

      const chatEvents = (chatRows.rows as any[])
        .filter(r => r.msg_id)
        .map(r => ({
          id: `chat-msg-${r.msg_id}`,
          direction: r.sender_type === "agent" ? "outbound" : "inbound",
          channel: "chat",
          provider: "internal",
          body: r.content,
          subject: null,
          status: "received",
          createdAt: r.msg_at,
          metadata: { sessionId: r.session_id, chatStatus: r.status, senderName: r.sender_name },
        }));

      // Normalize comm events
      const normalized = events.map(e => ({
        id: `comm-${e.id}`,
        direction: e.direction,
        channel: e.channel,
        provider: e.provider,
        body: e.body,
        subject: e.subject,
        status: e.status,
        intent: e.intentClassification,
        confidence: e.intentConfidence ? parseFloat(String(e.intentConfidence)) : null,
        createdAt: e.createdAt,
        metadata: e.metadata,
      }));

      // Merge and sort by time
      const timeline = [...normalized, ...chatEvents]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100);

      res.json({ contactId, timeline, total: timeline.length });
    } catch (err: any) {
      console.error("[Inbox] thread error:", err.message);
      serverError(res, err);
    }
  });

  // ─── POST /api/inbox/reply — email reply via SMTP ─────────────────────────
  app.post("/api/inbox/reply", requireRole("admin", "manager", "agent"), async (req, res) => {
    try {
      const { sourceItemId, subject, body: replyBody } = req.body as {
        sourceItemId?: string;
        subject?: string;
        body?: string;
      };

      if (!replyBody?.trim()) {
        return res.status(400).json({ message: "body is required" });
      }
      if (!sourceItemId || typeof sourceItemId !== "string") {
        return res.status(400).json({ message: "sourceItemId is required" });
      }
      const resolved = await authorizeInboxItemAccess(req, res, sourceItemId, { exactAssignment: true });
      if (!resolved) return;
      if (resolved.channel !== "email" && resolved.channel !== "ghl_chat") {
        return res.status(409).json({ message: "Inbox item is not an email reply target" });
      }
      const contactId = resolved.contact.id;
      const contact = resolved.contact;
      if (!contact.email) {
        return res.status(400).json({ message: "Contact has no email address" });
      }

      const user = req.user as any;
      const userId = String(user?.id || "");

      // ── Gate: global pause ────────────────────────────────────────────────
      const globalPausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
      const globalPaused = globalPausedRaw === true || globalPausedRaw === "true";
      if (globalPaused) {
        await storage.createAuditLog({
          action: "inbox_reply_blocked_global_pause",
          entityType: "contact", entityId: contactId, actorType: "user", actorId: userId,
          details: { contactId, to: contact.email, timestamp: new Date().toISOString() },
        });
        return res.status(409).json({ message: "Outbound paused — send blocked." });
      }

      // ── Gate: email channel pause ─────────────────────────────────────────
      const emailPausedRaw = await storage.getSystemSetting("emailChannelPaused");
      const emailPaused = emailPausedRaw !== "false" && emailPausedRaw !== false && emailPausedRaw != null;
      if (emailPaused) {
        return res.status(409).json({ message: "Email channel paused — send blocked." });
      }

      // ── Gate: no-prospect-send guard ──────────────────────────────────────
      const guardRaw = await storage.getSystemSetting("deliveryNoProspectSendEmail");
      const guardActive = guardRaw === true || guardRaw === "true";
      if (guardActive) {
        const allowlistRaw = await storage.getSystemSetting("deliveryTestEmailAllowlist");
        const allowlist: string[] = typeof allowlistRaw === "string"
          ? allowlistRaw.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
          : [];
        const recipientEmail = contact.email.trim().toLowerCase();
        const isInternal = recipientEmail.endsWith("@libertybancard.com");
        if (!isInternal && !allowlist.includes(recipientEmail)) {
          await storage.createAuditLog({
            action: "inbox_reply_blocked_no_prospect_guard",
            entityType: "contact", entityId: contactId, actorType: "user", actorId: userId,
            details: { contactId, to: contact.email, allowlistSize: allowlist.length, timestamp: new Date().toISOString() },
          });
          return res.status(409).json({
            message: `No-prospect-send guard active — ${recipientEmail} is not on the test allowlist.`,
            blocked: true,
          });
        }
      }

      // ── C-12 (#1626): canonical contactability gate before dispatch ────────
      const { evaluateContactability } = await import("../services/contactability");
      const contactability = await evaluateContactability({
        contactId,
        channel: "email",
        campaignType: "manual_reply",
        mode: "enforcement",
      });
      if (!contactability.allowed) {
        console.warn(`[Inbox] reply denied by contactability: ${contactability.reason} (contactId=${contactId})`);
        return res.status(409).json({
          message: "Send blocked by contactability policy",
          reason: contactability.reason,
        });
      }

      const { sendSmtpEmail } = await import("../services/smtp-email");

      let deliveryOutcome: "sent" | "blocked" | "failed" | "not_configured" = "sent";
      let deliveryError: string | null = null;

      // C-11 (#1626): capture the SMTP result — sendSmtpEmail returns
      // { success: false } (does not throw) when pause-blocked or unconfigured.
      let smtpResult: { success: boolean; error?: string };
      try {
        smtpResult = await sendSmtpEmail({
          to: contact.email,
          subject: subject || `Re: Your inquiry`,
          html: replyBody.replace(/\n/g, "<br>"),
          category: "support",
          contactId,
        });
      } catch (smtpErr: any) {
        smtpResult = { success: false, error: smtpErr.message || "SMTP delivery failed" };
      }

      if (!smtpResult.success) {
        deliveryError = smtpResult.error || "SMTP delivery failed";
        const lowered = deliveryError.toLowerCase();
        if (lowered.includes("paused") || lowered.includes("blocked")) {
          deliveryOutcome = "blocked";
        } else if (lowered.includes("not configured") || lowered.includes("not_configured") || lowered.includes("missing smtp")) {
          deliveryOutcome = "not_configured";
        } else {
          deliveryOutcome = "failed";
        }
        console.error(`[Inbox] SMTP reply not sent (outcome=${deliveryOutcome}, contactId=${contactId})`);

        // Truthful state: record the real outcome, never "sent"
        const { recordOutboundSend } = await import("../services/communication-events");
        await recordOutboundSend({
          contactId,
          channel: "email",
          provider: "smtp",
          subject: subject || null,
          body: replyBody,
          // recordOutboundSend status enum has no "not_configured" — map to "skipped"
          status: deliveryOutcome === "blocked" ? "blocked" : deliveryOutcome === "not_configured" ? "skipped" : "failed",
          metadata: { repliedBy: userId, deliveryOutcome, error: deliveryError },
        }).catch(() => {});
        await storage.createAuditLog({
          action: "inbox_email_reply_failed",
          entityType: "contact", entityId: contactId, actorType: "user", actorId: userId,
          details: { contactId, deliveryOutcome, error: deliveryError, timestamp: new Date().toISOString() },
        });
        const statusCode = deliveryOutcome === "blocked" ? 409 : deliveryOutcome === "not_configured" ? 503 : 502;
        return res.status(statusCode).json({ ok: false, message: safeMessage(deliveryError, "Email delivery failed"), deliveryOutcome });
      }

      // Record as outbound communication event
      const { recordOutboundSend } = await import("../services/communication-events");
      await recordOutboundSend({
        contactId,
        channel: "email",
        provider: "smtp",
        subject: subject || null,
        body: replyBody,
        status: "sent",
        metadata: { repliedBy: userId },
      });

      await storage.createAuditLog({
        action: "inbox_email_reply_sent",
        entityType: "contact",
        entityId: contactId,
        actorType: "user",
        actorId: userId,
        details: { contactId, subject: subject || null, to: contact.email, deliveryOutcome, timestamp: new Date().toISOString() },
      });

      res.json({ ok: true, to: contact.email, deliveryOutcome });
    } catch (err: any) {
      console.error("[Inbox] reply error:", err.message);
      serverError(res, err);
    }
  });
}
