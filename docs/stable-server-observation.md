# Stable Server Observation — Operator Guide

## Purpose

Use this procedure when you need to observe background scheduler cycles
(BullMQ jobs, GHL sync loop, SLA worker, sequence runner, etc.) for 30 or
more minutes without interruption.

The normal "Start application" workflow runs via `npm run dev`, which includes
Vite's file watcher. Any file save during development restarts the server,
resetting the scheduler clock mid-observation.

Running `node --import tsx server/index.ts` directly bypasses Vite's file
watcher entirely. The process is stable against file saves — only an explicit
`Ctrl+C` or a process crash will stop it.

**Verified:** PID and process start time were confirmed unchanged after editing
both a server source file (`server/index.ts`) and a client source file
(`client/src/App.tsx`) during a live stability test.

---

## Pre-launch checklist

Before running the observation command, confirm there is no existing server
process active.

```bash
# 1. Check for any process already holding port 5000
lsof -i :5000

# 2. Check for any server/index.ts process
ps aux | grep "server/index.ts" | grep -v grep
```

Both commands must return empty output before proceeding.
If port 5000 is in use, stop the "Start application" workflow from the
Replit workflow panel and wait a few seconds before checking again.

---

## Procedure

**Step 1 — Stop the normal development server**

In the Replit workflow panel, stop "Start application".
Wait until the panel shows it as stopped (not running).

**Step 2 — Confirm the port is free**

Open a Replit Shell and run:

```bash
lsof -i :5000
ps aux | grep "server/index.ts" | grep -v grep
```

Both must return empty. Do not proceed until they do.

**Step 3 — Start the stable observation process**

In the same Shell, run:

```bash
node --import tsx server/index.ts
```

Wait for this line to appear in the output before considering it ready:

```
[QueueManager] All queues and workers initialized
```

**Step 4 — Record the process PID**

In a second Shell tab, run:

```bash
ps -eo pid,lstart,cmd | grep "node --import tsx server" | grep -v grep
```

Note the PID and start time. You can re-run this at any point to confirm the
process has not restarted.

**Step 5 — Observe**

Watch the Shell output. Background job activity will appear inline:
- GHL sync ticks (every ~45 seconds)
- SLA checks (every ~5 minutes)
- Sequence worker ticks (every ~30 seconds)
- `scheduled_ai_ops` entries (every ~30 minutes)
- Discovery, digest, and MID ingestion jobs per their schedules

**Step 6 — Stop observation**

Press `Ctrl+C` in the Shell running the observation process.
Confirm it has stopped:

```bash
lsof -i :5000
```

Must return empty before the next step.

**Step 7 — Restore normal development**

Restart "Start application" from the Replit workflow panel.

---

## Why not a Replit workflow?

Replit's `configureWorkflow` tool unconditionally adds every new workflow to
the "Project" parallel group, which is triggered by the Run button. A second
`server/index.ts`-class process in that group can initialize BullMQ workers,
Redis connections, and cron jobs before failing to bind port 5000 — creating
duplicate background execution even though only one HTTP server survives.

The Shell-based approach is the safe alternative: the process runs entirely
outside the Replit workflow supervisor, is never triggered by the Run button,
and is fully controlled by the operator.
