---
name: System Audit Engine
description: Architecture and key design decisions for the weekly AI system audit engine.
---

# System Audit Engine

## Architecture
- **BullMQ queue**: `SYSTEM_AUDIT` ("system-audit") in `server/services/queue-manager.ts`.
  Uses `cronPattern: process.env.SYSTEM_AUDIT_CRON ?? "0 8 * * 1"` (Monday 8 AM UTC).
  QueueConfig has optional `cronPattern?: string`; setupRepeatableJobs uses `{ pattern }` when set.
- **18 probe files** in `server/services/system-audit/probes/`:
  database, ghl-sync, queues, sequences, enrichment, inbox-health, ai-ops (original 7)
  + ghl-auth, ghl-fields, compliance-engine, sdr-pipeline, contactability,
    onboarding-pipeline, mid-ingestion, role-guards, ai-advisor,
    ghl-workflow-registry, anomaly-detection
- **Separate modules**: `synthesize.ts` (GPT-4o narrative), `slack-notifier.ts` (Block Kit delivery + sendCriticalAlert)
- **Runner** (`runner.ts`): Promise.allSettled for resilience, anti-concurrency lock
  (check ran_at > now()-10m before starting), calcOverallScore(), writes all columns
- **DB table**: `system_audit_runs` — migration 0073 (journal idx=77, when=1786600000000)
  Columns: id, ran_at, overall_score (int), probe_results (jsonb), claude_narrative,
  slack_status (sent/failed/skipped), triggered_by (schedule/manual/critical), created_at

## Key Decisions
- Narrative uses `max_completion_tokens: 600` (NOT max_tokens — see openai-max-tokens-param memory).
- Slack delivery via `sendAuditReport()` includes overall score % in header block.
- `sendCriticalAlert()` fires immediately (no weekly wait) from circuit breaker, etc.
- GHL circuit breaker hook in `ghl-sync.ts`: `maybeSendCircuitAlert()` with 1h cooldown guard
  to prevent alert flooding when the circuit trips multiple phases in one tick.
- Migration 0073 applied directly (DROP + CREATE) since table was newly created in 0072.
  The hash `a1b2c3d4...` was inserted into drizzle.__drizzle_migrations manually.
- API routes: GET routes use `isDashboardUser` (admin/manager/agent can view audit data);
  POST /run-now uses `requireRole("admin","manager")`.
- OperatorDashboard nav: "system-audit" item in System Health group renders a link panel
  (not an inline tab) since SystemAuditPage is a standalone route.

**Why:**
- Promise.allSettled instead of Promise.all: a single probe crash must not abort the entire audit.
- Anti-concurrency lock prevents startup job + manual trigger from overlapping.
- 18 probes covers every documented failure point from the task spec.
- cronPattern field on QueueConfig is optional so all other queues are unaffected.
