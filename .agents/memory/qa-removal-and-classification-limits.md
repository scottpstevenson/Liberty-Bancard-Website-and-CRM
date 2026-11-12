---
name: QA record removal and classification limits
description: Why QA/test CRM records can only be archived (not erased), how deal-to-production classification works now, and how the GHL pause blocks archiving GHL-linked deals.
---

Permanent contact erasure is disabled in product code (retention contract unverified): the hard-delete preview/execute routes always return a blocker. The supported removal is archive (contacts via the versioned bulk-archive command, deals via the deal archive route, tasks via the task bulk soft-delete). Retained inbound requests cannot be removed and stay in the review queue.

**Why:** retained consent/intake/provenance evidence and child authority cannot yet be certified safe to erase; the old purge route is intentionally 410.

**Classification:** the three-actor preview/approve/execute path (requester, approver, executor all distinct) still governs contacts and other subjects, and its deal evidence cannot be satisfied (production has zero deal classification events). By owner decision, deals alone have a direct admin route (`POST /api/admin/deals/:id/classify-production`, commandId + short reason) that needs only the deal's contact/company to already be production and writes an immutable event with the real actor and no approver. Do not extend this to contacts without the owner saying so.

**Archive side effects:** deal archive calls the GHL delete first when the deal has a GHL opportunity id; while the outbound global pause is on it refuses (503, nothing changed locally). Deals without an opportunity id archive locally (audit row ghl_delete_skipped). Contact archive never calls GHL (GHL contacts stay in GHL; deal archive deletes only the GHL opportunity). Only lift the pause when the owner explicitly asks; keep the window to seconds and always re-pause in a finally block.

**Unpause side effect:** the global unpause sweeps every paused enrollment carrying a `_globalPauseBlockReason` marker back to `active` (918 in production on 2026-11-12) and that is not undone by re-pausing. Email/SMS/cold-email channel pauses are independent and stayed on, and the global pause gates sends at the transport, so nothing sent in the window. Warn the owner before any future lift.

**How to apply:** when asked to "delete" QA/test records, archive and say so plainly; do not claim erasure. The five July GHL-linked QA deals were archived in one owner-approved lift-archive-repause run.
