---
name: QA record removal and classification limits
description: Why QA/test CRM records can only be archived (not erased) and why deal classification cannot be done with one admin; what the archive path does and does not touch.
---

Permanent contact erasure is disabled in product code (retention contract unverified): the hard-delete preview/execute routes always return a blocker. The supported removal is archive (contacts via the versioned bulk-archive command, deals via the deal archive route, tasks via the task bulk soft-delete). Retained inbound requests cannot be removed and stay in the review queue.

**Why:** retained consent/intake/provenance evidence and child authority cannot yet be certified safe to erase; the old purge route is intentionally 410.

**Classification:** changing a deal/contact class goes through preview -> approve -> execute and needs three different actors (requester, approver, executor all distinct). Production has one active admin, so the path cannot complete; do not reactivate deactivated test admin accounts to satisfy it. A deal also cannot become production unless its contact already is.

**Archive side effects:** deal archive calls the GHL delete first when the deal has a GHL opportunity id (writes to GHL; refuses when paused). Deals without one are skipped locally (audit row ghl_delete_skipped). Contact archive never calls GHL. Check the opportunity id before archiving deals of GHL-synced test contacts.

**How to apply:** when asked to "delete" QA/test records, archive and say so plainly; do not claim erasure. Old July QA fixtures were already class test with tasks soft-deleted; their deals carry GHL ids, so they were left alone.
