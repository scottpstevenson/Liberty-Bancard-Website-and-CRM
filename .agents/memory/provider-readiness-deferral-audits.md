---
name: Provider-readiness deferral audits
description: Truthful audit requirements when durable provider readiness runs before legacy validation-budget checks.
---

When durable provider-readiness evaluation defers an outbound enrollment before legacy provider-budget logic, write an audit event for the readiness deferral itself. Tests should accept only the action matching the branch that actually changed durable state.

**Why:** A sequence test proved the enrollment was safely deferred and retryable, but expected an unreachable ZeroBounce-budget audit. The active readiness branch updated the enrollment without any audit, leaving truthful durable state incomplete.

**How to apply:** When adding or reordering pre-send gates, pair each branch that changes enrollment timing/status with a reason-coded audit and assert that branch-specific action alongside zero provider I/O.