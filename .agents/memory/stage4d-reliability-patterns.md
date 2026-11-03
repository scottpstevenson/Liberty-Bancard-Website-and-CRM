---
name: Stage 4D reliability and certification patterns
description: Durable lessons from booking recovery, signed-reply journeys, browser suites and fixture traps
---
- Booking create: server is the recovery authority (durable intent row before provider I/O; same-actor unresolved create blocks a replacement). Tests need distinct actors. Browser localStorage is convenience only.
- `ghl_booking_writer_enabled` is read via Drizzle jsonb, which JSON-parses a second time. Only a double-encoded jsonb string reads as "true"; plain jsonb "true" or boolean reads as boolean and stays DENIED. Fixtures use `to_jsonb('"true"'::text)`.
- Writer on is not enough to reach a provider: `authorizeGhlCrmOperation` also needs runtime selection, native review and an operation allowlist. A browser journey with the writer on correctly ends `refused: runtime_not_selected`; assert that, not a confirmed write.
- `server/routes/sdr.ts` must not use `require()` (undefined under ESM tsx tests; prod CJS bundle hid it). Specialized message-received STOP must withdraw consent with the generic path's event key so aliases converge.
- Editing anything under `scripts/` or `client/` changes the candidate build identity: run `npm run build` (foreground) before each browser suite rerun. Long suites go in a background script file.
- Disposable runner only accepts scripts registered in pre-deploy; check the exact path (certification/ subdir) before running.
- Matched perf baseline: `git archive <commit>` to a temp dir, copy `attached_assets` contents (not tracked fully), `npx vite build`, copy `dist/public`. Delete the 2 GB temp dir afterwards.
**Why:** each cost one or more failed reruns. **How to apply:** before writing browser/journey fixtures for booking or webhooks.
Related: see stage4c2-correction-lessons.md (one statement owner, masked audit key, halt-after-failed-send fixtures).
