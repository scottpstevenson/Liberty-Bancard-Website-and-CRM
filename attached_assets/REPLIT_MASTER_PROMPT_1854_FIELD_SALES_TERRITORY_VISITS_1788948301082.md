# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK #1854 — Door-to-Door Territory, Stops & Field Visit Operations

## MODE

PREFLIGHT + BUILD against current `origin/main`. This task depends on the canonical rep identity/assignment and manager-metrics authority from #1853. If dependencies are absent, do not invent parallel owners.

Audited reference: SHA `bae053a655e05ccb69a8b9dc07f84d1a5e020028`; migration head `0234`; only a free-text `agents.territory` field and generic business/contact latitude/longitude-like data were found, with no dedicated territory, stop, visit, check-in, or route-planning subsystem. Re-baseline before build and choose the next free migration.

Do not buy/configure a maps provider, geocode production records, track reps continuously, create canonical businesses/contacts from raw leads, auto-contact merchants, or permit overlapping assignments silently.

## WHAT & WHY

Add the missing human door-to-door workflow around canonical businesses/locations and assigned contacts: manager-defined territories, bounded daily stop lists, mobile visit dispositions, revisit tasks, collision prevention, and manager visibility. Start provider-neutral and privacy-minimal. The system plans work and records explicit rep actions; it does not perform surveillance or outbound communication.

## SOURCE-OF-TRUTH MAP

| Concern | Canonical owner |
|---|---|
| Rep identity | #1853 canonical user-agent binding |
| Person/phone/email | canonical `contacts` |
| Organization/location | canonical `businesses` plus verified address/coordinates |
| Call/contact eligibility | CR-04; field eligibility gets its own explicit policy because DNC rules and in-person outreach are not interchangeable |
| Tasks/follow-ups | existing tasks authority |
| Sales activity metrics | #1853 projection extended with field visit events |
| Maps | external deep link initially; no new paid provider authority |

## DONE LOOKS LIKE

1. Managers define named active territories with explicit geometry or bounded postal/city criteria, version, owner, effective dates, and overlap warnings.
2. Territory assignment is to canonical bound reps, is time-bounded, and has one current primary owner per business/location unless an explicit shared assignment is approved.
3. Eligible stop candidates come only from canonical businesses with usable location data and at least one authorized canonical contact or an explicitly permitted business-only visit policy. Raw Sunbiz/prospect/master-lead rows never appear.
4. A manager previews and freezes a bounded daily route/stop list before assignment. Execute rechecks ownership, record class, archive state, current visit lock, and field-eligibility policy.
5. Mobile reps see today’s stops, address, business/contact summary, last visit, next action, and an “open in maps” link. No paid routing/geocoding dependency is required for v1.
6. Reps record a single append-only visit with controlled dispositions: `visited_owner_spoke`, `visited_staff_only`, `owner_unavailable`, `closed`, `not_found`, `not_interested`, `follow_up_requested`, `statement_requested`, `do_not_visit`.
7. A visit may create a bounded follow-up task or invoke the existing statement-request command only through an explicit second confirmation. It never sends email/SMS or creates a deal automatically.
8. Two reps cannot simultaneously claim the same stop. Claim/lease, completion, release, expiry, and manager reassignment are durable and idempotent.
9. Optional check-in stores only explicit event time and coarse/consented verification needed for the visit; no background tracking, route history, or precise location retention by default.
10. Manager metrics show stops assigned, attempted, meaningful conversations, follow-ups, statement requests, do-not-visit, and outcome conversion with drill-down and rep/date/territory filters.
11. Feature flags default off and production activation requires a small manually approved pilot.

## REQUIRED IMPLEMENTATION

### 1. Preflight/VFC

Audit current business/contact address and coordinate fields, record classification, contact/business access, rep binding, tasks, statements, activity/audit, mobile navigation, feature flags, and manager analytics. Census null/invalid/duplicate addresses and coordinate provenance. Verify whether a geo extension is available before choosing geometry types; do not assume PostGIS.

### 2. Add the next migration

Use provider-neutral additive tables:

- `sales_territories`: ID, canonical key/name, status, definition type, criteria/geometry JSON with validation, timezone, version, effective dates, created/updated actor/time.
- `sales_territory_assignments`: territory, agent/user, role, effective dates, version, unique active assignment constraints.
- `field_routes`: date, territory, rep, state (`draft/frozen/in_progress/completed/cancelled`), policy version, source fingerprint, version, timestamps/actors.
- `field_route_stops`: route, business, optional contact, order, address snapshot/provenance, coordinates if already verified, state, claim token/owner/lease, expected fingerprint, timestamps, uniqueness preventing active duplicate assignment.
- `field_visits`: append-only stop/business/contact/rep, controlled disposition, bounded redacted note, occurred time, explicit check-in verification class, follow-up/statement command references, idempotency key.
- optional append-only route/stop event table if needed for lifecycle audit.

Use varchar canonical user IDs, proper FKs, partial unique indexes, bounded JSON checks, indexes for day/rep/territory/state, and append-only triggers. Do not copy phone/email into field tables.

### 3. Field-eligibility policy

Create one versioned evaluator for field visits. It must consider production record class, archive/deletion, `do_not_contact`, `do_not_auto_contact`, suppression reason, `do_not_visit`, existing owner/territory, address sufficiency/provenance, recent visit cooldown, open stop/lease, and manager override policy.

Do not blindly reuse telemarketing consent as in-person authority and do not infer that DNC means permission to visit. Define conservative reason-coded policy with compliance review configuration. A `do_not_visit` disposition blocks future routes immediately.

### 4. Preview/freeze/assign route commands

- Manager/admin only.
- Preview bounded candidate set and overlap/conflict reasons.
- Freeze exact business/contact IDs, policy version, record fingerprints, and planned order.
- Execute under locks and recheck all authority.
- Never auto-create business/contact rows or silently reassign another rep.
- Stable operation/idempotency key; replay returns the original result.
- Route ordering v1 may use manager order or deterministic nearest-neighbor only when verified coordinates exist. No claim of optimized routing without a provider/algorithm certification.

### 5. Durable stop claim and visit command

- Rep may claim only a stop on their current route.
- Atomic compare-and-set claim with random token and finite lease; renewal/release are owner+token bound.
- Completion transaction validates token/lease, inserts one visit, advances stop state, and optionally creates a task/statement request through existing commands.
- Crash/retry cannot duplicate visits or downstream commands.
- Manager reassignment is explicit, versioned, and audited.

### 6. Desktop/mobile UI

- Manager territory editor/list, overlap warnings, candidate preview, frozen routes, conflicts, rep progress, and drill-down.
- Mobile “Field Day” list with large touch targets, offline/error-safe refresh, claim indicator, open-in-maps deep link, business/contact context, disposition sheet, note, follow-up date, and explicit statement-request confirmation.
- Never show raw lead source tables or sensitive merchant data.
- No background geolocation. If explicit check-in is included, request permission at action time and provide a no-location disposition path.

### 7. Integrate existing tasks/statements/metrics

- Follow-up creates an existing contact/business-bound task assigned to the canonical rep email/user mapping.
- Statement request calls the existing authorized request command and records its returned ID; it does not reimplement token/upload logic.
- Extend #1853’s canonical projection with append-only field visits and exact denominators.
- Keep deals opt-in/manual; no automatic deal creation.

### 8. Feature flags and pilot

Add `FIELD_SALES_ENABLED` and, separately if implemented, `FIELD_CHECKIN_ENABLED` to every canonical flag registry/override/readiness surface. Both default false. Add an admin pilot readiness view: bound reps, territory, eligible businesses, location quality, conflicts, feature status, and last certification SHA. Activation remains a post-merge manual step.

### 9. Certification

Use a disposable database with two reps, overlapping territories, canonical businesses/contacts, invalid/test/DNC/do-not-visit records, duplicate locations, existing stop, and lease races. Prove preview/execute parity, overlap warnings, no raw-lead leakage, atomic claim winner, lease expiry, idempotent completion, cross-rep denial, task/statement single effect, no automatic deals/outbound, no background location collection, and manager metric parity.

## AUTHORIZATION MATRIX

| Action | Agent | Manager | Admin |
|---|---:|---:|---:|
| View territory/route | Own | Team | All |
| Create/edit territory | No | Yes | Yes |
| Preview/freeze/assign route | No | Yes | Yes |
| Claim/complete stop | Own route only | No, except explicit reassignment | Override with audit |
| View field metrics | Own | Team | All |
| Enable feature | No | Existing flag policy | Existing flag policy |

## OUT OF SCOPE

- Contact/lead enrichment, crosswalk, dedupe, or business materialization.
- Paid map/geocoding provider integration or credentials.
- Background location tracking, mileage/payroll tracking, or surveillance.
- Automated email/SMS/calls/sequences/GHL mutations.
- Automatic deal creation or pipeline stage changes.
- Production route assignment or field pilot activation.

## KILL LINES

- STOP if a raw Sunbiz/prospect/master-lead row can enter a rep route.
- STOP if two reps can hold active claims on the same stop.
- STOP if route execution does not recheck the frozen authority fingerprint.
- STOP if an agent can access another rep’s route/stop/visit.
- STOP if precise location is captured without explicit action/consent or retained as background history.
- STOP if a field disposition triggers outbound or creates a deal automatically.
- STOP if tests call map/GHL/communications providers or touch shared/production state.
- STOP if a second task, statement, contact, business, or metrics authority is created.

## REQUIRED GATES / FINAL RESPONSE

Run migration clean replay/upgrade; territory overlap and field-policy tests; route concurrency/lease/idempotency tests; contact/business access and role matrix; task/statement integration tests with spies; mobile/desktop route smoke tests; feature-flag tests; typecheck; production build; pre-deploy/compliance; and `git diff --check` using pinned engines.

Return exact SHA/migration baseline, dependency proof, VFC, policy/reason-code table, implementation evidence, test/gate results, concurrency proof, post-build grep, diff review, kill-line proof, pilot checklist, and merge verdict. Separately state code, merge, deployment, schema, provider credentials, feature activation, pilot data, live route assignment, and outbound states.
