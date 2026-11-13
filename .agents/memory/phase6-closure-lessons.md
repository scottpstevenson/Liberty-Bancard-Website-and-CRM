---
name: Phase 6 closure lessons
description: Traps found while closing the Phase 6 CRM acceptance rows (browser suites, baseline comparison, object-access gaps, evidence hygiene)
---

Detail reads that hang off a contact or deal (`/api/contacts/:id/zerobounce-history`, `/api/deals/:id/co-branded-proposals`) must call `authorizeContactAccess` / `authorizeDealAccess`; `isDashboardUser` alone let any agent read another owner's receipts and proposal viewer links.
**Why:** both were found open at HEAD only because a populated-journey test asked an agent for a foreign record.

Where the UI hides things by default: contact validation history is inside the closed "Validation, readiness & record diagnostics" disclosure; Pipeline loads co-branded proposals only when a deal is opened (no engagement badges on a fresh board); the Pipeline toolbar is `md:sticky` only (a sticky toolbar taller than a 320 px screen covers every card).
**How to apply:** click the disclosure / open the deal before asserting; a pointer "covered by another control" failure at 320 px is a real layout defect, not test flake.

Baseline comparison: extract a clean base with `git archive HEAD | tar -x` (cross-device `git clone --local` fails) and symlink node_modules. Assertion-style scripts stop at their first failing assertion, so "fails identically on base and candidate" hides every later assertion in that file; say so in the report. A contract test that follows an owner (e.g. the shell title slot) must be updated to the new owner, with the contract kept.

Evidence hygiene: running the C2 contact-header browser test overwrites tracked evidence under `docs/certification/stage3-c2/`; copy outputs aside and restore with `git show HEAD:path > path`. The candidate identity hash covers `scripts/`, so rebuild after any script edit. A background job started with `&` dies with its shell; use the background option. Never `pkill -f` a pattern that also appears in your own command line (it kills the shell).

Product facts: notifications `recipient_id` is the actor's user id; the sales pipeline value is lowercase `sales`; `businesses.record_class` defaults to `unknown`; Program Health shows `failed` over `stale` when both apply (the stale `sla-worker` heartbeat row is an owner hosting decision); the contact page's commercial-graph reads take advisory locks and need a second pool connection, which stalls under a small pool.

C2 contact-header browser test: on the clean HEAD base it already fails "mobile: navigation below fold" (the person/business/consent lines push the section navigation past the 844 px fold), and its post-login step breaks at native 200% zoom unless the desktop-layout choice is stored before signing in. Check the base first; a failing C2 is not automatically a regression from your edit.
**How to apply:** a base build in the exported tree needs a throwaway `git init` + empty commit there (the build script runs `git rev-parse HEAD`); never run git in the workspace for this.

Post-Publish identity proof: the live health sha is the commit before the "Published your App" commit (same tree). Re-run `captureCandidateSource` from `scripts/fixtures/candidate-build-identity.ts` (use a `.mts` file for top-level await) and diff per-file receipts against `dist/candidate-integrity.json`; compare the live `index.html` asset names and SHA-256 of the downloaded js/css with `dist/public/assets`. The bundled server file is not public, so server parity rests on the source hash plus the startup log. Signed-in live readback needs a session; unauthenticated GETs only prove routes refuse anonymous callers (401).
