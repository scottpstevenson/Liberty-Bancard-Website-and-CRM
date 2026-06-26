/**
 * Wave 8 — Analytics Events Service
 *
 * recordAnalyticsEvent() is the single write path for server-side CRM milestones.
 * It:
 *   - Validates event names against canonical constants (warns on unknown)
 *   - Strips PII recursively from all metadata fields
 *   - Supports idempotency via eventId (upsert-or-skip on conflict)
 *   - Wraps all DB writes in try/catch — never re-throws to calling code
 */

import { db } from "../db";
import { analyticsEvents } from "@shared/schema";
import { ALL_CANONICAL_EVENTS, type AnalyticsEventPayload } from "@shared/analytics-events";
import { sql } from "drizzle-orm";

const PII_KEYS = new Set([
  "email",
  "phone",
  "firstName",
  "lastName",
  "fullName",
  "name",
  "address",
  "fileName",
  "statementFileName",
  "statementText",
  "rawPayload",
  "notes",
  "messageBody",
  "body",
  "content",
  "replyContent",
]);

function stripPii(obj: unknown, depth = 0): unknown {
  if (depth > 10) return "[depth limit]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripPii(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.has(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = stripPii(value, depth + 1);
    }
  }
  return result;
}

export async function recordAnalyticsEvent(payload: AnalyticsEventPayload): Promise<void> {
  try {
    if (!ALL_CANONICAL_EVENTS.has(payload.eventName)) {
      console.warn(`[AnalyticsEvents] Unknown event name "${payload.eventName}" — skipping`);
      return;
    }

    const safeMetadata = payload.metadata
      ? (stripPii(payload.metadata) as Record<string, unknown>)
      : null;

    const values: Record<string, unknown> = {
      eventName: payload.eventName,
      occurredAt: payload.occurredAt ?? new Date(),
      sessionId: payload.sessionId ?? null,
      visitorId: payload.visitorId ?? null,
      bookingTrackingId: payload.bookingTrackingId ?? null,
      contactId: payload.contactId ?? null,
      dealId: payload.dealId ?? null,
      sequenceId: payload.sequenceId ?? null,
      pagePath: payload.pagePath ?? null,
      landingPage: payload.landingPage ?? null,
      utmSource: payload.utmSource ?? null,
      utmMedium: payload.utmMedium ?? null,
      utmCampaign: payload.utmCampaign ?? null,
      utmContent: payload.utmContent ?? null,
      utmTerm: payload.utmTerm ?? null,
      gclidPresent: payload.gclidPresent ?? null,
      fbclidPresent: payload.fbclidPresent ?? null,
      msclkidPresent: payload.msclkidPresent ?? null,
      offerRoute: payload.offerRoute ?? null,
      vertical: payload.vertical ?? null,
      consentTier: payload.consentTier ?? null,
      lifecycleStage: payload.lifecycleStage ?? null,
      sourceCategory: payload.sourceCategory ?? null,
      formId: payload.formId ?? null,
      channel: payload.channel ?? null,
      blockReason: payload.blockReason ?? null,
      dealStage: payload.dealStage ?? null,
      metadata: safeMetadata,
    };

    if (payload.eventId) {
      await db
        .insert(analyticsEvents)
        .values({ ...values, eventId: payload.eventId } as any)
        .onConflictDoNothing({ target: analyticsEvents.eventId });
    } else {
      await db.insert(analyticsEvents).values(values as any);
    }
  } catch (err) {
    console.error("[AnalyticsEvents] Failed to record event:", payload.eventName, err instanceof Error ? err.message : String(err));
  }
}

/** Alias for callers that prefer CRM-style naming */
export const recordCrmEvent = recordAnalyticsEvent;
