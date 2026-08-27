/**
 * ghl-voicemail-sync.ts
 *
 * BullMQ job processor: polls the GHL Conversations API for inbound voicemail
 * messages and stores them as communication_events (channel: "voicemail").
 *
 * Gated by VOICEMAIL_SYNC_ENABLED=true env var.
 * Deduplication: skips rows where external_message_id already exists.
 */
import { db } from "../db";
import { communicationEvents, contacts as contactsTable } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { recordInboundEvent } from "./communication-events";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function getGhlConfig() {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId };
}

async function ghlFetch(path: string): Promise<any> {
  const config = getGhlConfig();
  if (!config) throw new Error("GHL not configured");
  const url = `${GHL_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`GHL ${resp.status}: ${body}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Returns true when this external_message_id is already stored. */
async function isDuplicate(ghlMessageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: communicationEvents.id })
    .from(communicationEvents)
    .where(eq(communicationEvents.externalMessageId, ghlMessageId))
    .limit(1);
  return rows.length > 0;
}

/** Resolve local contact ID from GHL contact ID. Returns null when not found. */
async function resolveContactId(ghlContactId: string): Promise<number | null> {
  const rows = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(eq(contactsTable.ghlContactId, ghlContactId))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function runVoicemailSyncTick(): Promise<void> {
  if (process.env.VOICEMAIL_SYNC_ENABLED !== "true") {
    return;
  }

  const config = getGhlConfig();
  if (!config) {
    console.warn("[VoicemailSync] GHL not configured — skipping");
    return;
  }

  console.log("[VoicemailSync] Starting voicemail sync tick…");
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Fetch recent conversations of type VOICE (voicemail)
    // GHL API: GET /conversations/search?locationId=…&type=TYPE_VOICE_MAIL&limit=50
    // Also try TYPE_VOICE as some GHL versions differ
    const result = await ghlFetch(
      `/conversations/search?locationId=${config.locationId}&limit=50&type=TYPE_VOICE_MAIL`
    );
    const conversations: any[] = result?.conversations || result?.data || [];

    for (const convo of conversations.slice(0, 50)) {
      try {
        // Fetch individual messages for this conversation
        const msgResult = await ghlFetch(
          `/conversations/${convo.id}/messages?limit=20`
        );
        const messages: any[] = msgResult?.messages || msgResult?.data || [];

        for (const msg of messages) {
          // Filter for voicemail-type messages
          const msgType: string = (msg.type || msg.messageType || "").toUpperCase();
          const isVoicemail =
            msgType === "TYPE_VOICE_MAIL" ||
            msgType === "VOICEMAIL" ||
            msgType === "TYPE_VOICE" ||
            (msg.attachments?.some((a: any) => a.type?.includes("audio")));

          if (!isVoicemail) continue;

          // Only import inbound voicemails — GHL direction field values: "inbound" / "outbound"
          // messageType may also encode direction numerically (1 = inbound in some GHL versions).
          // Reject any message where direction is explicitly outbound.
          const msgDirection: string = (msg.direction || "").toLowerCase();
          if (msgDirection === "outbound") continue;

          const ghlMsgId: string = msg.id || msg.messageId;
          if (!ghlMsgId) continue;

          // Deduplicate
          if (await isDuplicate(ghlMsgId)) {
            skipped++;
            continue;
          }

          // Resolve contact
          const ghlContactId: string = convo.contactId || msg.contactId;
          const localContactId = ghlContactId ? await resolveContactId(ghlContactId) : null;
          if (!localContactId) {
            skipped++;
            continue;
          }

          // Extract metadata
          const receivedAt = msg.dateAdded
            ? new Date(msg.dateAdded)
            : msg.createdAt
            ? new Date(msg.createdAt)
            : new Date();

          const mediaUrl: string | null =
            msg.attachments?.[0]?.url ||
            msg.mediaUrl ||
            msg.voicemailUrl ||
            null;

          const transcript: string | null =
            msg.transcript ||
            msg.body ||
            msg.text ||
            null;

          const duration: number | null =
            msg.duration ||
            msg.callDuration ||
            null;

          const callerName: string =
            convo.fullName ||
            convo.contactName ||
            `${convo.firstName || ""} ${convo.lastName || ""}`.trim() ||
            "Unknown";

          await recordInboundEvent({
            contactId: localContactId,
            channel: "voicemail",
            provider: "ghl",
            status: "received",
            externalMessageId: ghlMsgId,
            ghlMessageId: ghlMsgId,
            body: transcript?.slice(0, 4000) ?? null,
            metadata: {
              callerName,
              mediaUrl,
              duration,
              ghlConversationId: convo.id,
              ghlContactId,
              transcript,
              receivedAt: receivedAt.toISOString(),
            },
            occurredAt: receivedAt,
          });

          imported++;
        }
      } catch (convErr: any) {
        console.warn(`[VoicemailSync] Error processing conversation ${convo.id}:`, convErr.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[VoicemailSync] Sync tick failed:", err.message);
    throw err;
  }

  console.log(`[VoicemailSync] Done — imported=${imported} skipped=${skipped} errors=${errors}`);
}
