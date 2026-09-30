---
name: Inbound request authority
description: Durable boundaries for classifying and orchestrating real inbound occurrences without inventing consent or releasing external effects.
---

Every real inbound occurrence must be claimed before business mutation through the canonical request authority. Its frozen source manifest decides which assignment, CR-05 work, SLA, fulfillment, moderation, lifecycle, or marketing-readiness effects are permitted. Import, discovery, and ordinary provider-sync evidence do not imply inbound intent.

**Why:** Route-local intake behavior previously mixed sales, support, fulfillment, content, and promotional effects; retries could duplicate work, public acknowledgements leaked internal IDs, and intent was sometimes reported as delivery.

**How to apply:** Reuse the caller/provider occurrence key across retries, return only the opaque receipt and persisted lifecycle, derive work/effect identities from the request, keep external effects held until their owning authority releases them, and complete internal effects only from durable linked evidence. Statement bytes use protected-object references, never checkout-local paths.

For a sales-intent callback with multiple matching contacts, do not call the normal sales orchestrator without a contact, and do not pick a candidate to satisfy its contact requirement. Preserve the claimed request as review-required and create request-keyed, contactless review work while leaving sales assignment, work, SLA, and external effects held.

**Why:** The normal sales path requires a definite contact to issue linked task/SLA work; passing an empty reference fails the request, while selecting a candidate would incorrectly merge identity and certify work.

**How to apply:** Use a durable, request-linked review notification that carries the candidate IDs privately and exposes only the opaque receipt publicly. After manual identity resolution, the owning authority can complete the original sales handoff; do not invent a default rep or treat a notification alone as completed sales work.