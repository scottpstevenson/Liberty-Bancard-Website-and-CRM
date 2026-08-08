# Automation Inventory

> Last updated: 2025-07 (Task #1356 — Automation Consolidation & Registry)

All automations are registered in the `automation_registry` table and visible/kill-switchable from the Admin Hub → **Automations** tab.

| Key | Title | Trigger | System | Channel | Stop Condition | Global Pause Checked | Contactability Checked |
|-----|-------|---------|--------|---------|----------------|----------------------|------------------------|
| `ghl-sync` | GHL Sync | Every 45s (prod) / 5min (dev) | BullMQ | API (GHL) | Kill switch | No | No |
| `sla-checks` | SLA Checks | Every 5min (prod) / 15min (dev) | BullMQ | Internal | Kill switch | No | No |
| `sequences` | Sequence Worker | Every 10min — processes active follow-up sequence enrollments | BullMQ | Email / SMS (via GHL) | Kill switch; `LEGACY_OUTREACH_ENABLED` flag; acquireJobLock singleton | Yes (sequence-worker.ts) | Yes (contactability.ts) |
| `enrichment` | Enrichment Worker | Every 10min — contact enrichment, lead scoring | BullMQ | None | Kill switch | No | No |
| `discovery` | Lead Discovery | Daily — SDR lead discovery | BullMQ | None | Kill switch | No | No |
| `digests` | Digests | Hourly — team digest notifications | BullMQ | Internal | Kill switch | No | No |
| `mid-ingestion` | MID Ingestion | Daily — merchant residual MID ingestion | BullMQ | None | Kill switch | No | No |
| `onboarding-reminder` | Onboarding Reminder | Every 4h — doc reminders + abandoned application recovery | BullMQ | Email (GHL) / Internal | Kill switch | **Yes (fixed in Task #1356)** | Partial (eligibility check) |
| `abandoned-statement` | Abandoned Statement | Daily — follows up stale statement requests | BullMQ | Email | Kill switch | No | No |
| `system-audit` | System Audit | Weekly (Mon 11am UTC) | BullMQ | Internal | Kill switch | No | No |
| `db-backup` | Database Backup | Daily at 3am UTC | BullMQ | None | Kill switch | No | No |
| `enrollment-recovery` | Enrollment Recovery | Daily at 6am UTC | BullMQ | None | Kill switch | No | No |
| `ghl-enrollment-recovery` | GHL Enrollment Recovery | Every 30min | BullMQ | API (GHL) | Kill switch; MAX_RETRIES (3) | No | No |
| `health-monitor` | Health Monitor | Every 5min (prod) / 15min (dev) | BullMQ | Internal | Kill switch | No | No |
| `executive-snapshot` | Executive Snapshot | Weekly (Mon 12pm UTC) | BullMQ | Internal | Kill switch | No | No |
| `pipeline-silence-check` | Pipeline Silence Check | Daily at 9am UTC | BullMQ | Internal | Kill switch | No | No |
| `proposal-followup` | Proposal Follow-Up | Daily at 10am UTC — proposals not viewed in 3+ days (max 2 resends) | BullMQ | Email | Kill switch; resend cap (2); sequence collision guard | **Yes (fixed in Task #1356)** | Yes (contactability.ts) |
| `partner-monthly-digest` | Partner Monthly Digest | 1st of month at 9am UTC | BullMQ | Email | Kill switch | No | No |
| `sdr-orchestrator` | SDR Orchestrator | On-demand / cron via SDR routes | Custom (not BullMQ) | Email / Call (GHL) | Registry kill switch (pending) | No | Yes |

## Bug Fixes Applied (Task #1356)

### Bug 1 — Proposal Collision Fix (`proposal-followup-worker.ts`)
- Added a sequence-collision guard that queries `sequence_enrollments` for any `active` or `paused` enrollment where `contactId` matches AND the sequence name/family contains "proposal".
- If found, the worker skips sending and writes a `proposal_resend_skipped_sequence_collision` audit log entry.

### Bug 2 — Missing Global-Pause Checks
- **`proposal-followup-worker.ts`**: Added check for `outboundGlobalPaused` system setting at the top of `runProposalFollowUpCheck()`. Returns early with zero counts if paused.
- **`onboarding-reminder.ts`**: Added check for `outboundGlobalPaused` at the top of `runOnboardingReminderTick()`. Returns early if paused.

## Registry Architecture

- **Table**: `automation_registry` (see `shared/schema.ts`)
- **Kill switch cache**: 30-second in-process cache in `server/services/automation-kill-switch.ts`
- **Seed**: `seedAutomationRegistry()` called on every server startup (upsert — never overwrites `kill_switch_enabled`)
- **Admin UI**: Admin Hub → Automations tab (`/dashboard/admin-hub?tab=automations`)
- **API**: `GET /api/admin/automations`, `PATCH /api/admin/automations/:key`
