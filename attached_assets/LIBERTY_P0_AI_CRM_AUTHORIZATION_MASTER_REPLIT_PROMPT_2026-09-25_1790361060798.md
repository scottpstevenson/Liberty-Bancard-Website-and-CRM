# Liberty Bancard — Master Replit Build Prompt: P0 AI / CRM Authorization Closure

Paste the entire prompt below into one Replit Build Mode task.

---

## 1. Mission and priority

Close the P0 internal AI / CRM authorization regression identified in the fresh go-live audit. Implement and verify the actual corrections in the repository, including contact, deal, ticket, statement, and proposal scope, with negative role and other-owner tests. Treat this as **one complete security and rep-workflow task**. Do the build and the verification; do not finish with a plan or a list of future implementation tasks.

The repository audit for this prompt examined live `main` at commit `6de79bb65254efd47fac6149ad9abd4522b14ee5` on 2026-09-25. The locally inspected AI and CRM files came from commit `9403d6725e77b068238ac3d0b174aed557dcf44b`; comparison to live `main` showed no intervening changes to those inspected files. **At execution time, fetch current `main`, record the exact new HEAD, recheck every affected route, and adapt the implementation if the code has moved.** These line numbers are navigational evidence, not immutable specifications.

## 2. Audited facts to reproduce before changing code

In `server/routes/ai.ts`, these internal routes currently use `isAuthenticated` and need stronger, route-specific authorization:

| Route | Audited behavior / gap |
| --- | --- |
| `POST /api/ai/insights` | Reads up to 500 deals, 500 tickets, 500 contacts, all tasks, and 500 prospects; builds company-wide metrics and sends them to the AI provider. |
| `POST /api/ai/compose-email` | Accepts arbitrary body `contactId` or `prospectId`; reads names, email and commercial attributes before sending prompt to AI. |
| `POST /api/ai/generate-tasks` | Reads company-wide CRM objects and creates authority tasks, up to 10 per call. |
| `POST /api/ai/classify-ticket` | Accepts body `ticketId`, sends the ticket description to AI, and updates ticket category and priority. |
| `POST /api/ai/analyze-statement` | Accepts optional `contactId` and `dealId`, reads linked CRM data, sends statement content to AI and may update a deal. |
| `POST /api/ai/generate-proposal` | Accepts body `dealId`, reads deal and linked contact, calls AI, updates deal proposal, creates audit and notification. |
| `GET /api/deals/:id/proposal` | Returns the savings proposal for an arbitrary deal ID. |
| `GET /api/ai/onboarding-status` | Reads all onboarding deals, tasks and linked contacts, then returns their milestone state. |
| `PUT /api/deals/:id/edit-proposal`, `POST /api/deals/:id/send-proposal` | Handlers check `admin`, `manager`, `sales`; the active rep role is `agent`. They also need deal ownership checks. Sending triggers an actual email. |
| `GET/PUT /api/settings/proposal-auto-send` | GET uses only `isAuthenticated`; PUT checks admin/manager inside the handler. Both need an explicit staff/admin policy. |

Additional same-boundary findings from the repo audit:

- `server/routes/search.ts` uses `isAuthenticated` on `/api/search` and `/api/search/advanced`, reads across contacts/deals/tickets/tasks, and can return records outside an agent's scope. Its `/api/ai/route-prospect` and `/api/ai/route-prospects-bulk` take arbitrary prospect IDs and update their status, although ordinary `/api/prospects/:id` is admin/manager only. Inventory and fix these as part of closing the **same internal CRM/AI authorization boundary**.
- `server/routes/ai.ts` has `POST/PATCH /api/ai/chargeback-copilot/:id` guarded by `isDashboardUser`, but the audited handlers read/update a chargeback and its linked deal/contact without an explicit agent object check. Audit and close those object paths if confirmed at current HEAD.
- `GET /api/operator/ai-audit` is dashboard-only but fetches company-wide AI audit rows/totals. Review actual returned fields and scope to the actor or restrict to admin/manager if the rows contain other users' prompts or CRM data. Inspect the other aggregate AI operator endpoints for the same exposure; record the outcome.
- `server/routes/ai-memory.ts` has `POST /api/ai-memory/decisions` and `POST /api/ai-memory/corrections` with only `isAuthenticated` and writes caller-supplied content. Inspect their payloads and access requirements and close any internal-memory write boundary. Keep this addition tied to the same role regression.
- `server/routes.ts` registers a partner deny middleware and `crmObjectAccessGuard` before the AI routes. The CRM guard covers agent `/api/contacts/:id` and `/api/deals/:id` path IDs. It **does not** authorize body IDs like `contactId`, `dealId`, `ticketId`, `prospectId`, and it does not by itself deny authenticated merchants. Do not treat a matching URL prefix as proof that a body-sourced or cross-role path is safe.
- `server/services/crm-object-access.ts` already provides `authorizeContactAccess`, `authorizeDealAccess`, `denyCrmObject`, `agentOwnershipEmail`. Contacts use `assignedTo` and deals use `owner`, both matching agent email. These helpers allow agents to read some unassigned records by default; the `exactAssignment` option tightens this. The ticket route's `authorizeTicketScope` in `server/routes/tickets-tasks.ts` is currently local; linked contact determines scope, and unlinked tickets are denied to agents. Reuse or extract these rules coherently.
- `server/routes/prospects.ts` protects `/api/prospects` and `/api/prospects/:id` with admin/manager; prospect `ownerEmail` is the business's owner field, **not evidence of the assigned CRM agent**. Never authorize agents by comparing that field to `req.user.email`.
- `POST /api/ai/chat` is a separately classified multi-audience route (`staff`, `merchant`, `public`) and the public `/upload-statement` page calls `/api/ai/analyze-statement` in standalone mode. Protect internal AI workflows without breaking intentionally available merchant/public journeys. Inspect `server/routes/chat-assistant.ts` and `server/services/chat-assistant.ts` where relevant to audience/session isolation.
- Public `GET /api/public/proposal/:token` and `POST /api/public/proposal/:token/accept` log the **raw proposal bearer token** in `audit_logs` as `details.token`. No route-level rate limit was evident in these handlers. Keep public token-based access functional, replace raw log tokens with a nonreversible fingerprint, and apply bounded rate limiting to lookup and acceptance.

## 3. Scope and stopping boundary

The deliverable is a code change and evidence for this authorization closure, including the closely connected proposal role/token issues and the specific same-boundary routes above. Do not turn this into a general launch audit, a CRM redesign, a new permission system, or a production activation. Do not enable automatic outbound email, recurring jobs, or production sends while testing. Fix a newly found equivalent route in this route family when necessary to prevent the same regression; document the reason and test it.

## 4. Establish the current security model

Read the actual definitions of `isAuthenticated`, `isDashboardUser`, and `requireRole`; identify how auth sessions, CSRF, partner and affiliate roles work. Map response codes for anonymous versus authenticated nonstaff. Locate staff role values used by current UI and tests (`admin`, `manager`, `agent`). Confirm the position of auth middleware and the CRM path guard in `server/routes.ts`. Create a short route/role/object matrix in your build report before coding.

## 5. Required role and object policy

For internal CRM/AI endpoints, anonymous callers fail authentication; authenticated `merchant`, `partner`, `affiliate` and any other nonstaff role fail the staff boundary; `admin` and `manager` may act globally where the existing product policy permits; `agent` must see and change only authorized records. Apply `isDashboardUser` or a stronger explicit admin/manager policy at the route boundary. Check the requested object **before** reading sensitive linked data, calling the AI provider, recording AI prompts, writing audit/notification records, creating tasks, changing a deal/ticket, or sending a proposal.

For hidden or unowned objects use the repo's `denyCrmObject` response convention (generic 404) and strict positive integer IDs. Do not leak whether another owner's object exists. A forged ID in a request body, URL, nested object or alternate parameter must never bypass these checks. If a request names more than one object, authorize **every** one and verify their relationship; do not trust `contactId` supplied next to an authorized `dealId` without confirming they refer to the same contact. Decide explicitly whether each mutation requires exact assignment; be at least as restrictive as its corresponding canonical CRM route and explain any difference.

## 6. Contact and prospect email composition

For `/api/ai/compose-email`, check `contactId` with `authorizeContactAccess` before reading the contact or creating a prompt. If `prospectId` is supplied, use the established admin/manager prospect policy unless you can demonstrate and test an existing server-authoritative agent assignment model. Validate numeric IDs and mutual exclusivity/precedence of `contactId` and `prospectId`; reject ambiguous or invalid requests. A freeform draft with no CRM ID can remain available to dashboard users if it neither retrieves CRM data nor reads hidden records. Prove an agent cannot fetch another owner's contact or prospect data through the AI response, logs or provider call.

## 7. Ticket classification

For `/api/ai/classify-ticket`, load the ticket by strict ID, apply the same linked-contact/unlinked-ticket access model as `server/routes/tickets-tasks.ts`, and only then build the prompt, call AI or update category/priority. Extract a shared ticket authorizer if useful; do not maintain two inconsistent definitions. Denied, nonexistent or unlinked tickets produce no provider call, update, notification or success audit. Test valid admin/manager, own-contact agent, other-owner agent, unlinked agent and nonstaff callers.

## 8. Statement analysis: distinguish standalone from CRM-linked work

For `/api/ai/analyze-statement`, classify two explicit modes:

1. **CRM-linked**: request includes `dealId`, `contactId`, or another server-resolved CRM reference. Require staff membership, authorize all referenced records, verify contact/deal linkage, and check scope before any vertical/contact/deal read, AI request, deal update or linked audit. Only an authorized deal may be updated. A merchant cannot smuggle a deal ID into a standalone analysis.
2. **Standalone analysis**: the caller supplies only their own statement content and an allowed vertical, with no linked CRM read or mutation. Preserve the intended authenticated upload-page flow only after confirming actual product policy; validate and bound request size, apply AI cost/rate protections consistent with the app, and ensure no CRM linkage or false entity ID in the audit. If policy says this mode is staff-only, update the public page behavior so it does not offer a broken feature; record the decision.

An AI governance flag must continue to prevent an automatic deal update. Both modes must uphold the existing compliance language.

## 9. Proposal generation and internal proposal access

For `/api/ai/generate-proposal`, authorize the deal before loading linked contact, pricing prompt context, AI invocation, token handling, update, audit or notification. Only use the contact attached to the authorized deal. For `GET /api/deals/:id/proposal`, require staff role and authorized deal scope before returning proposal JSON; preserve generic 404 for foreign or archived deals. Verify whether the existing path guard already handles agent URL IDs, then retain an explicit documented defense for these handlers and prove cross-role denial.

## 10. Proposal editing and sending for reps

Replace the stale `sales` role check on edit/send with current canonical role policy (`admin`, `manager`, `agent`). An agent may edit/send only a deal they own under the repo's authorization rules; a manager/admin may do so according to current business policy. Do not let a client supplied email, role, contact ID or deal owner decide access. Scope check must occur **before** mutating the proposal or invoking `sendProposalEmail` / `notifyRepWithBriefing`. Validate edits to the proposal structure against the allowed fields rather than copying arbitrary properties from request body. Preserve send idempotency/approval rules already enforced by the proposal engine. Exercise the full agent-owned edit/send workflow with a stubbed mail transport so tests send no real email.

## 11. Company-wide AI operations

For `/api/ai/insights`, `/api/ai/onboarding-status` and `/api/ai/generate-tasks`, eliminate company-wide exposure and writes by an arbitrary authenticated user. `generate-tasks` currently creates unlinked authority tasks from global inputs: make that global action admin/manager only **unless** a fully scoped and correctly linked per-agent implementation can be proven. For `insights` and `onboarding-status`, either restrict to admin/manager or implement truly server-side agent-scoped queries for **every** included deals, contacts, tickets, tasks and prospects. Never perform a broad fetch, feed global counts or IDs to AI, and only filter the HTTP result afterward. If existing agent screens call these endpoints, either provide a correct agent-scoped response or hide/disable the feature with an explanatory UI state; do not silently break the page. Preserve admin/manager functionality.

## 12. Search and prospect routing escape paths

Apply staff boundary and agent object filtering to `/api/search` and `/api/search/advanced` before constructing results, including all linked contacts, deals, tickets and tasks. User supplied `assignedTo` must only narrow access, never widen it. Prospects remain admin/manager data without a proven agent scope. Make `/api/ai/route-prospect` and `/api/ai/route-prospects-bulk` admin/manager only in line with `/api/prospects/:id`, including implicit auto-selection; ensure partner/merchant/affiliate cannot trigger status changes. Audit any adjacent AI memory write/chargeback routes identified in section 2 and fix confirmed violations of this same boundary; add each affected route to tests.

## 13. AI audit visibility and logging

Assess `/api/operator/ai-audit` list and totals for agent access to other actors' prompt or business data. Prefer admin/manager only if per-agent aggregation cannot be safely scoped end to end. Inspect AI logs from denied requests: no raw prompt, statement data, contact data or proposal token may be emitted because an unauthorized route got as far as logging or error handling. Preserve minimal safe security-denial telemetry if present, excluding PII and secrets. Ensure role denial is outside catch blocks that might transform it into an AI provider error or a 200 error payload.

## 14. Public proposal capability and token hygiene

Keep `/api/public/proposal/:token` and `/accept` accessible through the existing valid bearer token. Replace `details.token` in `proposal_viewed` and `proposal_accepted` audit writes with a one-way SHA-256 fingerprint (prefer a full digest or an explicitly adequate length) and `dealId`/contact reference as permitted. No raw token in logs, error text or new telemetry. Apply a bounded per-IP rate limit (and any appropriate token-related limiter) to **both** public endpoints using repo conventions; test 429 without exhausting live services. Do not invalidate existing proposal links or change stored token lookup semantics as an accidental side effect. Check existing audit rows for exposure and report a separately reviewable redaction/remediation plan if historical data needs cleanup; do not run irreversible historical deletion by default.

## 15. Proposal auto-send setting

Make GET explicitly staff/admin as appropriate for operator settings and PUT explicitly `admin`/`manager` at middleware level, preserving CSRF, existing setting semantics and current UI behavior. An agent may read only if the UI requires and the data is intentionally allowed; agent cannot change it. A merchant/partner/affiliate never sees or changes it. No test turns the setting on against production data.

## 16. Shared authorization code

Use or extend `server/services/crm-object-access.ts` for contact/deal scope; extract ticket scope to a shared function if needed. Keep a clear distinction between *view* and *mutate* permissions and assigned versus unassigned records. Use server-resolved ownership and archived status. Avoid copying fragile ownership checks into each AI handler. Do not introduce a global permission bypass for all `/api/ai` paths, since chat and public proposal access have different audiences.

## 17. Request validation and response handling

Use strict integer parsing for IDs, reject ambiguous object references, bound AI request bodies and arrays, and fail closed when ownership metadata is missing or inconsistent. Keep CSRF behavior for authenticated writes. Do not return provider credentials, raw prompt, contact email, other owner's record, raw token, or internal stack trace in a denial. Ensure errors are consistent with existing app conventions: unauthenticated 401; authenticated wrong role 403 at role boundary; foreign or missing object generic 404 after a valid staff role; bad input 400. In tests account for CSRF middleware ordering so a 403 from missing CSRF does not falsely count as a passed role test.

## 18. Permanent route census

Build a method-and-path inventory of **every** AI, proposal, AI memory, AI operator, advanced search and prospect routing route touched by this boundary. Classify each as staff global, staff object scoped, admin/manager only, merchant/standalone, or public bearer-token. Include the route's actual middleware, body/URL IDs, actor scope and required negative cases. Register all relevant routes in the permanent role-guard census in `scripts/smoke-role-guards.ts` or a complementary CI-enforced inventory. A static route guard check should fail if a newly added internal AI/CRM route is protected only by `isAuthenticated` without a documented, tested merchant/public exception. `scripts/check-api-coverage.ts` checks client route existence; it is **not** an authorization test.

## 19. Negative integration fixture matrix

Create deterministic test actors: anonymous; merchant; partner; affiliate; agent A; agent B; manager; admin. Create owned and foreign contacts/deals, linked/unlinked tickets, statements linked to owned/foreign deals, proposal-bearing deals, and a prospect. Include archived and unassigned records where relevant. Use real auth middleware, real route registration and CSRF tokens in HTTP-level tests; stub external AI and email APIs. Verify for each covered endpoint:

- merchant/partner/affiliate cannot read internal metrics, records, proposal JSON or settings, mutate CRM, trigger cost-bearing AI calls or send email;
- agent A can use genuinely authorized objects, and agent B receives a generic denial for the same IDs;
- changing body `contactId`, `dealId`, `ticketId`, `prospectId`, nested references or URL ID does not widen access;
- manager/admin can perform intended operations; an agent may edit/send an owned proposal but cannot edit/send another agent's;
- standalone statement analysis remains in its deliberately approved audience without CRM reads or writes;
- public proposal valid/invalid/rate-limited flows work and never persist a raw token;
- denied attempts result in **zero** AI provider calls, mail sends, deal/ticket/task writes, notifications and sensitive audit content.

Use assertions against spies and persisted state, not merely status-code checks. Do not write tests that pass on any 403 without distinguishing CSRF from authorization. Do not use real merchant data, a live provider key or live outbound email in fixtures.

## 20. Prevent mock-based false confidence

Supplement focused unit tests with a small HTTP integration suite using production route registration, session restoration, CSRF and ownership fixtures. Add at least one test for each of: contact body ID, deal body ID, ticket body ID, URL deal proposal, statement dual-ID mismatch, global aggregate endpoint, public token, and rep edit/send. Assert agent A's positive workflow. If existing smoke tests depend on a running server or secrets, keep the stateful suite isolated and explain exactly which commands were runnable and which were blocked.

## 21. Client compatibility and UX

Review callers in `client/src/components/EmailComposer.tsx`, `client/src/pages/UploadStatement.tsx`, dashboard `Overview`, `Tasks`, `Onboarding`, `Tickets`, `StatementReview`, `Automation`, proposal editor/sender, global search and operator settings. Show meaningful 403/404 states; do not leave a button that repeatedly invokes a newly restricted endpoint. Preserve legitimate merchant-facing chat and public proposal access. The positive agent-owned proposal workflow must be demonstrated from the same path the dashboard uses.

## 22. Verification commands and gates

At minimum run the project's TypeScript check (`npm run check`), focused new HTTP/security tests, affected AI and proposal tests, `scripts/smoke-role-guards.ts`, `scripts/check-api-coverage.ts`, the project's CSRF suite, and production build. Follow the repository's `scripts/pre-deploy.ts` and execute the complete relevant release gate when available. Run tests against the **final exact commit/tree** after all edits; record command, exit code, passing count and any environment-dependent skip. Never claim an unavailable stateful check passed. Re-run focused tests after any fix made during verification.

## 23. Manual security review checklist

Inspect the final diff for lingering `isAuthenticated` internal routes in the audited families, body-ID access before authorization, search-result leaks, unscoped AI audit records, stale `sales` role checks, raw `details.token`, unsafe unbounded public proposal lookups, agent tasks created from global data, and real-send test paths. Confirm public proposal and multi-audience chat remain accessible to intended audiences. Record any residual risk with exact file and behavior; do not use a generic “looks safe” signoff.

## 24. Build Mode output and acceptance criteria

Deliver: (a) changed files and brief why; (b) a route-to-role/object matrix covering all affected endpoints; (c) exact tests and results on final HEAD; (d) proof that denied calls cause no AI/mail/mutation side effects; (e) positive agent-owned contact/deal/ticket/proposal flow; (f) explicit standalone statement mode decision; (g) token fingerprint and rate-limit evidence; (h) exact remaining blockers, if any. Include actual final SHA and git diff summary. Keep the result reviewable as one cohesive change. No production activation, manual send, bulk cleanup or historical audit-log deletion is authorized by this task. A failure in the negative role/other-owner matrix blocks completion; do not label the task complete if those tests fail or cannot run.

---

**Primary repository anchors:** `server/routes/ai.ts`, `server/routes/search.ts`, `server/routes/ai-memory.ts`, `server/routes.ts`, `server/services/crm-object-access.ts`, `server/routes/tickets-tasks.ts`, `server/routes/prospects.ts`, `server/services/proposal-engine.ts`, `scripts/smoke-role-guards.ts`, `scripts/test-ai-assistant-boundaries.ts`, `scripts/check-api-coverage.ts`, `scripts/pre-deploy.ts`.
