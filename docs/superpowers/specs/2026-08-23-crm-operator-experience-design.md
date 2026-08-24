# BT-11 CRM Navigation & Operator Experience

## Goal

Harden the active CRM operator surfaces without redesigning the product. Dashboard
agents must see and act only on permitted contact/deal records, aggregate reads
must be scoped and truthful, and operational health views must distinguish empty
from unavailable or incomplete data.

## Design

### Server-side CRM object policy

Add a small reusable authorization owner that resolves the target object before
deciding access. Contact reads and non-provider mutations are allowed for agents
when `assignedTo` matches the authenticated user's email or is null. Deal reads
and non-provider mutations use the equivalent `owner` predicate. Managers and
admins retain existing unrestricted dashboard behavior.

The policy returns a non-leaking denial for missing and unauthorized objects.
Indirect records (notes, contact-company associations, rate reviews, Inbox
items/conversations, and other Contact Detail IDs) resolve to their owning
contact/deal before the mutation or read occurs. Existing document-level scope
checks remain additive. Provider-affecting Inbox actions and Ready-for-Outreach
start/skip retain exact-assignment requirements.

### Scoped and truthful data

Contact and deal list rows and totals use the same server-authoritative owner
predicate. Agent-supplied ownership query parameters are ignored or rejected.
Changed routes use local strict pagination validation with a documented maximum
and `INVALID_PAGINATION` errors.

Contact aggregate queries load deals, tickets, and tasks by contact at the
database layer. A shared Ready-for-Outreach membership/count authority is reused
by list, count, briefing, and reason-code responses; contactability remains a
separate channel status.

Inbox responses describe only the fetched window: deterministic composite cursors,
known-window totals, completeness, has-more knowledge, and per-source health.
Queue metrics/history use readiness-only access and never start workers from an
HTTP read. DLQ results are redacted DTOs with explicit sampling/truncation and
source-failure metadata.

### Client routing and states

`App.tsx` remains the client route authority. `DashboardLayout` does not make a
second authorization decision. Existing deep-link `tab` and `view` parameters
continue to work. System Health is role-aware: admins retain queue/DLQ controls;
managers see only panels backed by endpoints they can already access.

Briefing uses email-backed ownership columns, labels outreach-ready counts
accurately, and renders section degradation rather than false zeroes. Inbox,
DLQ, and health UI distinguish loading, failed, partial, unavailable, empty,
and healthy states.

### Regression coverage

Add `scripts/test-crm-operator-experience.ts` and register it in the CI suite
manifest and pre-deploy runner. Fixtures use two distinct agent/contact emails,
provider fail-fast fakes, and exact-ID cleanup in `finally`. Coverage includes
ownership, indirect-ID IDOR, list/count parity, pagination, aggregate scoping,
briefing and queue agreement, Inbox/provider isolation, DLQ/health truthfulness,
outreach replay safety, routing, and Virtual Terminal decommissioning.

No migration, payment action, provider credential change, queue-history
persistence, or unrelated campaign/partner/savings/relationship/chargeback
route audit is included.