# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK #1853 — Rep Identity, Canonical Queue & Cold-Call Operations Readiness

## MODE

PREFLIGHT + BUILD. Re-fetch and audit current `origin/main`, correct stale assumptions, then implement the safe build-ready scope. Do not return only a plan.

Audited reference: SHA `bae053a655e05ccb69a8b9dc07f84d1a5e020028`; migration head `0234_contact_remediation_operations`; Tasks #1834–#1836 present. Re-baseline and choose the next unused migration. Preserve unrelated work. Never use `db push`, mass-assign production contacts, create live users, send invitations, enable outbound, or run destructive production cleanup.

## VERIFIED STARTING REALITY — RECHECK

- `agents`, `agent_quotas`, Agent Management, My Day, Ready for Outreach, Contacts, call logging, tasks, Pipeline, statement request, mobile CRM, training, and leaderboard already exist.
- `POST /api/agents` creates an agent profile only. The UI does not require/select a canonical user, so `agents.user_id` can remain null.
- `PATCH /api/contacts/:id/assign` correctly requires admin/manager and validates a real dashboard-user email.
- `contacts.assigned_to` is the canonical owner for pre-deal contacts and CR-04 scopes the outreach queue by rep.
- My Day calculates assigned-contact totals from `contacts.assigned_to` but populates contact cards from contacts attached to `agent_merchants` deals.
- My Day activity logging authorizes through deal assignment rather than exact canonical contact assignment.
- The empty-state text says to add deals, which is wrong for cold-call reps working assigned canonical contacts.
- Task assignees are free-form text across legacy workflows; do not attempt a repository-wide task schema rewrite here.
- Production configuration previously showed zero agents/quotas/tasks/deals. That is runtime state, not proof the code is absent.

## WHAT & WHY

Make the existing CRM operational for two human cold-call reps by repairing the binding between authenticated users and agent profiles, making canonical contact assignment drive My Day and rep actions before a deal exists, and adding preview-first management tools and certification. This is not an enrichment task and must not move raw prospects/Sunbiz rows into rep queues.

## SOURCE-OF-TRUTH MAP

| Concern | Canonical owner |
|---|---|
| Login and role | `users.id`, `users.email`, existing auth/admin role routes |
| Rep profile | `agents.user_id` bound one-to-one to a dashboard user |
| Pre-deal ownership | `contacts.assigned_to`, stored as canonical normalized user email |
| Contact object access | `crm-object-access.ts` |
| Call eligibility | CR-04 manual-call qualification |
| Post-deal ownership | existing deal owner/agent-merchant relationship; do not replace it |
| Tasks | existing tasks table/routes; new sales writes use canonical rep email |
| Audit | existing audit log/change helpers |

## DONE LOOKS LIKE

1. Every active sales agent is either bound one-to-one to an active `users` row with role `agent` or is visibly `unbound`; duplicate bindings/emails are rejected.
2. Managers can bind an existing user to an agent profile through a previewed, audited action. This task does not create accounts or send invites automatically.
3. A readiness endpoint/UI reports missing user binding, wrong role, inactive user/profile, missing quota, missing territory label, assignment count, manual-call-eligible count, overdue tasks, and last activity.
4. My Day shows exactly assigned canonical contacts even when no deal exists, ordered by actionable work and current CR-04 manual-call eligibility.
5. My Day call/activity logging uses exact canonical contact access, produces the existing call-log/audit effects once, and does not require a deal.
6. A manager can preview and then bulk assign a bounded set of existing canonical contacts using explicit IDs and current-version fingerprints. No raw `prospects`, `master_leads`, or `sunbiz_entities` can be assigned.
7. Assignment refuses archived/test/demo/system contacts, DNC/suppressed contacts, and contacts outside the selected channel-ready projection. It rechecks under lock at commit time.
8. Rep Contacts, Ready for Outreach, My Day, Contact Detail, call log, task creation, statement request, and mobile contact access are certified with an actual agent-role fixture.
9. Existing admin/manager views retain their access. Cross-agent object enumeration returns 404-style denials.
10. No outbound action is enabled or performed.
11. Local appointments are owner-scoped: agents see and mutate only their own events tied to contacts they can access; managers/admins retain team/all access.
12. A manager operations projection reports calls, conversations, follow-ups, statements, appointments, opportunities, and explicit denominators without turning query/provider failures into zero.
13. Leaderboard call attribution uses canonical actor identity where available, and any existing mislabeled “response rate” is renamed or correctly implemented.

## REQUIRED IMPLEMENTATION

### 1. Preflight/VFC

Capture exact SHA/branch/status, migration head, current user/agent/contact schema, auth role policy, object guard, My Day queries/actions, outreach projection, assignment endpoints, tasks/calls/statement request/mobile routes, and test owners. Produce claim verdicts and exact `file:line` evidence.

### 2. Repair rep identity binding

- Add a unique partial index on normalized agent email and a unique constraint/index on non-null `agents.user_id`, after a collision census.
- Add status/readiness fields only if existing columns cannot express the state; avoid a second identity table.
- Add admin/manager bind/unbind endpoints that accept an existing user ID, lock both rows, verify normalized email compatibility or require an explicit audited correction, require allowed user role/status, and use optimistic version/updated-at checks.
- Role changes remain admin-only through the existing route. A manager may bind only a user already carrying the agent role.
- Do not generate passwords, sessions, invites, or emails.

### 3. Rep readiness surface

Add a bounded admin/manager readiness endpoint and Agent Management panel. Report reason codes, not only booleans. Include a safe “copy checklist” for external account provisioning and feature activation, but never expose credentials.

### 4. Make My Day canonical-contact-first

- Select exact `contacts.assigned_to = authenticated email`, excluding archived/non-production rows.
- Join latest open deal as optional context rather than membership authority.
- Evaluate/manual-call-filter with the existing CR-04 authority. Do not duplicate DNC/quality logic in My Day.
- Rank deterministically using overdue follow-up/task, never-contacted, last-contacted age, lead score, then ID. Bound page size and provide pagination/continuation.
- Include explicit blocked reason summaries without exposing contacts the rep cannot access.
- Correct the empty state to explain assignments rather than deals.

### 5. Repair rep actions

- Change My Day activity authorization to `authorizeContactAccess(..., { exactAssignment: true })` for agents.
- Preserve a nullable authorized deal link when one exists; do not require one.
- Validate call outcome using the canonical call outcome vocabulary, not generic activity type if a stronger existing owner exists.
- Make duplicate submission idempotent using an idempotency key or durable command record. Replays must not increment attempts or duplicate logs.
- New tasks created from rep workflow must be bound to the contact/deal and canonical rep email.

### 6. Preview-first bounded assignment

Add a manager-only preview and execute command for explicit contact IDs or a frozen CR-04-qualified cohort. Requirements:

- maximum bounded cohort;
- exact IDs, source run/filter fingerprint, expected contact `updated_at`/authority fingerprint;
- no overwrite of another rep unless explicit `reassign=true` and per-contact conflict reporting;
- row locks and commit-time eligibility/object-state recheck;
- inserted/assigned/skipped/conflicted/blocked counts and audit rows;
- stable operation ID and idempotent replay;
- never materialize raw lead populations into contacts.

### 7. Certification

Use a disposable database and deterministic fixtures representing admin, manager, rep A, rep B, canonical production contacts, DNC/test contacts, dealless assigned contacts, and optional deals. Prove binding collisions, role boundaries, exact assignment, cross-agent denial, My Day inclusion without deals, CR-04 blocking, idempotent call log, bounded bulk assignment, and zero external calls.

### 8. Repair appointments and manager operations

- Census `calendar_events.owner_id` and current route/storage behavior. If canonical ownership is absent, add a staged varchar `owner_user_id`, version/updated-at, source, and source-event identity using the same migration or the next available task-owned migration.
- Scope local calendar reads and mutations by authenticated owner plus contact/deal object access. Agents never choose an arbitrary owner from the body; manager reassignment is explicit and audited.
- Keep the GHL appointments endpoint a read-only external projection with stable `not_configured`, `provider_unavailable`, and `healthy` reason codes. Do not configure credentials or write to GHL.
- Build one reusable server-derived manager projection for calls attempted, human conversations, voicemail/no-answer, due/completed follow-ups, statements requested/received, appointments scheduled/held/no-show, and open/closed opportunities. Define each numerator and denominator.
- Add a compact manager UI with rep/date filters and drill-down parity. Reuse the existing leaderboard; correct actor attribution, mislabeled rates, and silent query-error-to-zero behavior rather than creating a second scoreboard.
- Include local appointments and overdue follow-ups in My Day/mobile.

## AUTHORIZATION MATRIX

| Action | Agent | Manager | Admin |
|---|---:|---:|---:|
| View own My Day/readiness | Own only | Team | All |
| Bind existing user to agent | No | Only pre-authorized agent-role user | Yes |
| Change user role | No | No | Yes |
| Assign/reassign contacts | No | Yes | Yes |
| View/action contact | Exact assigned | Yes | Yes |
| Log call/create follow-up | Exact assigned | Authorized contact | Authorized contact |

Enforce all rows server-side.

## OUT OF SCOPE

- Contact/lead enrichment, crosswalk, dedupe, or canonical promotion.
- Account creation, password handling, or invite delivery.
- Automated outbound, sequence enrollment, GHL mutation, dialing, SMS, or email.
- Door-to-door maps/routes/visits.
- Broad replacement of legacy task/deal ownership fields.
- Production assignment or activation.

## KILL LINES

- STOP if an active agent can exist ambiguously bound to multiple users or vice versa.
- STOP if My Day requires a deal to show/action an assigned canonical contact.
- STOP if an agent can access an unassigned or another rep’s contact through these task routes.
- STOP if assignment consumes raw prospects/Sunbiz/master leads or bypasses CR-04 eligibility.
- STOP if bulk assignment is unbounded, non-previewed, non-idempotent, or overwrites ownership silently.
- STOP if tests touch production/shared data or real providers.
- STOP if the task creates a parallel user, assignment, access, call-log, or eligibility authority.
- STOP if local calendar routes expose or mutate another rep's events.
- STOP if manager metrics silently convert a query/provider failure into zero or use a mislabeled denominator.

## REQUIRED GATES / FINAL RESPONSE

Run targeted identity/My Day/assignment tests, CRM object-access tests, CR-04 tests, call/task/statement route tests, role guard matrix, migration clean replay/upgrade, typecheck, production build, pre-deploy/compliance, and `git diff --check` using pinned engines.

Return verdict, exact starting/ending SHA, migration head, VFC, collisions found, implementation evidence, gate table, post-build grep, diff review, kill-line proof, runtime setup checklist, and merge verdict. State separately: code complete, merged, deployed, migration applied, two real users provisioned, agent profiles bound, contacts assigned, feature enabled, and outbound enabled. Only code/test states can be completed by this task.
