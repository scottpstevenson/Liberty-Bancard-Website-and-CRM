---
name: Executive KPI Layer
description: Architecture and key gotchas for the executive dashboard, AI briefings, and Monday snapshot job.
---

# Executive KPI Layer

## Tables
- `executive_weekly_snapshots` — one row per week (UNIQUE on `week_start` DATE), upserted via ON CONFLICT
- `executive_goals` — key/value store, 8 default goals seeded by migration 0105

## Key column name gotcha
Deals table uses `owner` (text) for the rep field, NOT `assigned_to`. Raw SQL in executive-kpi.ts must select `owner`.

## Margin storage convention
Goals stored as **percentage values** (e.g. `0.5` = 0.5%, not 0.005). Gross margin pct computed as `(grossProfitMonthly / closedWonVolume) * 100`.

## AI graceful degradation
- GPT-4o briefing: requires `AI_INTEGRATIONS_OPENAI_API_KEY` (falls back to null)
- Claude coaching: requires `ANTHROPIC_API_KEY` (falls back to null); uses `claude-opus-4-5`
- If either key is absent, the dashboard shows a "not yet generated" placeholder — no crash

## BullMQ job
Queue name: `executive-snapshot`. Cron: `0 12 * * 1` (Monday 12 PM UTC = 7 AM ET). Override with `EXEC_SNAPSHOT_CRON` env var. Registered alongside other weekly jobs in `queue-manager.ts`.

## Routes
- `GET /api/executive/snapshot` — current week (stored if exists, else live compute)
- `GET /api/executive/snapshots?limit=12` — history
- `POST /api/executive/refresh` — admin-only, recomputes + regenerates AI
- `GET /api/executive/goals` — all goals
- `PUT /api/executive/goals` — bulk upsert (admin only)

## Auth middleware path
Uses `server/replit_integrations/auth` NOT `server/middleware/auth`.

## Missing item (Task #1230)
No sidebar nav entry yet — page accessible at `/dashboard/executive` but not in sidebar.

**Why:** Sidebar nav file location unknown at build time; deferred as follow-up.
