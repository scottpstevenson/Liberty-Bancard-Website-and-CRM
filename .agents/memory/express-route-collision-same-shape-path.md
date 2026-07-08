---
name: Express route collision on identically-shaped paths across route files
description: Two different route files can register GET handlers with the same path shape (e.g. /api/sequences/:x/steps); Express matches by registration order, not by which param name "means", so an earlier generic route can silently shadow a later specific one.
---

## The problem
`registerIntegrationsRoutes(app)` and `registerCampaignsRoutes(app)` are both called from `server/routes.ts`, in that order. Both files defined a GET route matching the shape `/api/sequences/:X/steps` — one keyed by sequence **name** (for a cadence visualizer), one keyed by sequence **numeric ID** (for the step content editor). Express doesn't care that the param names differ or that one "obviously" expects an ID — it matches whichever route was `app.get()`-registered first for that path shape. The integrations.ts (name-based) route always won, so every numeric-ID request 404'd with `{"message":"Sequence not found"}` (the by-name route's own error, since `"4"` never matches a sequence *name*).

## Why this was hard to notice
The frontend's `fetch(...).then(res => res.ok ? res.json() : [])` swallowed the 404 into a silently-empty array — the step editor just opened with zero steps, no visible error, no crash. It looked like "the editor works but this sequence has no steps yet," not like a routing bug.

## How to apply
- Before assuming a "verify this feature still works" task is a no-op, actually round-trip the API with curl (or equivalent) rather than only reading the code — a route can be dead code without any type error or lint warning.
- When two features legitimately need to look up the same resource by different keys (ID vs. name) at what looks like the same URL shape, give them visibly distinct path segments (e.g. `/api/sequences/:id/steps` vs `/api/sequences/by-name/:name/steps`) rather than relying on registration order or param semantics to disambiguate.
- Grep for the exact path shape (not just the literal route file) across the whole `server/routes/*.ts` directory when adding or debugging a route — collisions are easy to miss when routes for the same base resource are split across multiple files.
