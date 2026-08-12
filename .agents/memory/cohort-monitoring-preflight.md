---
name: Cohort monitoring and outbound preflight
description: Live send metrics endpoint and monitoring panel on OutboundPreflight page
---

# Cohort Monitoring (#1396 — monitoring gap)

## What was built

**Metrics endpoint** (`server/routes/admin.ts`):
- `GET /api/admin/outbound/cohort-metrics` — role-gated (admin/manager)
- Queries `communication_events` table for: sends_24h, sends_7d, bounces_7d (status='bounced'), replies_7d (direction='inbound'), optouts_7d (status='unsubscribed' or metadata.eventType IN opt_out/STOP/unsubscribe)
- Returns: sendsPerHour, sends24h, sends7d, bounceRate7d (%), replyRate7d (%), optOutRate7d (%)

**UI panel** (`client/src/pages/dashboard/OutboundPreflight.tsx`):
- Added `CohortMetrics` interface and `useQuery` for `/api/admin/outbound/cohort-metrics` (refetch every 5 min)
- Live monitoring card shows 4 tiles: Sends/hr, Bounce Rate, Reply Rate, Opt-Out Rate
- Bounce >5% highlights red; opt-out >1% highlights amber
- Inserted between launch-result card and explainer card

## NOT yet built
- Automated alert when thresholds crossed (task proposed as follow-up)
- Admin-configurable thresholds for the alert

**Why:** communication_events uses direction='inbound'/'outbound' + status='bounced'/'unsubscribed' for the metrics queries. Opt-outs also captured via metadata.eventType for GHL webhook events that write inbound rows.
