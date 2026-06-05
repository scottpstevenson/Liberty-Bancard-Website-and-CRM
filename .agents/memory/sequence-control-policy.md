---
name: Sequence Control Policy
description: All sequences default to paused; enrollment is blocked at storage layer unless sequence is active.
---

## Rule
No sequence may enroll contacts unless its `status = 'active'`. This is enforced at two layers:

1. **Storage layer** (`server/storage/automation.ts` → `createSequenceEnrollment`): throws if the target sequence is not `active`. Covers all internal callers (smart-router, voice-orchestrator, workflow-executor, merchant-welcome, prospects, deals, activity routes).
2. **API layer** (`server/routes/campaigns.ts` → `POST /api/sequence-enrollments`): returns HTTP 409 with a human-readable message before calling storage.

**Schema default**: `shared/schema.ts` `followUpSequences.status` defaults to `"paused"` (was `"active"`). Any newly created sequence starts paused.

**Sequence worker** (`server/services/sequence-worker.ts` line 25): already skips processing enrollments where `sequence.status !== "active"` — so even if a contact somehow got enrolled, the worker won't advance them.

**Why:** Sequences were firing automatically on new contacts. Policy: all sequences must be explicitly activated before they can send anything.

**How to apply:** To enable a sequence, use `PUT /api/sequences/:id` with `{ status: "active" }`. Never change the DB default back to `"active"`.

## State as of enforcement
- 52 sequences in DB, all `paused` (49 pre-existing + 3 Construction sequences from Task #390 merge).
- SDR sequences 45/46/47 (Auto, Med Spa, Dental cold outbound) require GHL voice workflow IDs before enabling.
