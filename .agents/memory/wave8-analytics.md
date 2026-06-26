---
name: Wave 8 Analytics Attribution
description: Design decisions and constraints for the Wave 8 conversion analytics + attribution system
---

## Key Files
- `shared/analytics-events.ts` — canonical event name constants + AnalyticsEventPayload type
- `server/services/analytics-events.ts` — recordAnalyticsEvent() single write path with PII strip + idempotency
- `migrations/0040_analytics_events.sql` — DB table; auto-applied on server startup
- `client/src/lib/utm.ts` — UTM capture + gclid/fbclid/msclkid + buildAttributedBookingUrl
- `client/src/hooks/use-form-abandonment.ts` — fires form_abandoned via GA4/fbq + sendBeacon only (no server write)

## Rules

**ALL_CANONICAL_EVENTS set** — recordAnalyticsEvent() validates eventName against this set and returns early with a warn on unknown events. Every new event must be added to `shared/analytics-events.ts`.

**Why:** Prevents silent insertion of ad-hoc event strings that break funnel queries.

**How to apply:** Add the constant to `shared/analytics-events.ts`, add to the Set, then use in server services.

---

**Dynamic import pattern for server services** — All server services (proposal-engine, statement-upload-chain, etc.) use `import("./analytics-events")` to fire events asynchronously with `.catch(() => {})`. Never use top-level import inside circular-dependency-prone services.

**Why:** Prevents circular deps and ensures events never break the primary service call.

---

**PII strip keys** — metadata fields named email, phone, firstName, lastName, fullName, name, address, fileName, statementFileName, statementText, rawPayload, notes, messageBody, body, content, replyContent are redacted to "[redacted]" before DB write.

---

**eventId idempotency** — Pass eventId to avoid duplicate rows on retries. Uses `onConflictDoNothing` on the unique index.

---

**buildAttributedBookingUrl** — Generates a booking URL with btk (bookingTrackingId) + UTM params appended. Never includes PII (no phone/email/contactId). booking-confirmed bridge at GET /api/public/booking-confirmed records the server-side appointment_booked event and redirects to /thanks-call.

---

**Form abandonment** — useFormAbandonment hook fires client-side only (GA4/fbq/sendBeacon). No server DB write. POST /api/analytics/noop returns 204 to absorb the beacon.
