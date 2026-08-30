---
name: Inbound request authority
description: Durable boundaries for classifying and orchestrating real inbound occurrences without inventing consent or releasing external effects.
---

Every real inbound occurrence must be claimed before business mutation through the canonical request authority. Its frozen source manifest decides which assignment, CR-05 work, SLA, fulfillment, moderation, lifecycle, or marketing-readiness effects are permitted. Import, discovery, and ordinary provider-sync evidence do not imply inbound intent.

**Why:** Route-local intake behavior previously mixed sales, support, fulfillment, content, and promotional effects; retries could duplicate work, public acknowledgements leaked internal IDs, and intent was sometimes reported as delivery.

**How to apply:** Reuse the caller/provider occurrence key across retries, return only the opaque receipt and persisted lifecycle, derive work/effect identities from the request, keep external effects held until their owning authority releases them, and complete internal effects only from durable linked evidence. Statement bytes use protected-object references, never checkout-local paths.