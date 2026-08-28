# CRO-02 owner-only reconstruction and cutover

This document authorizes **no action**. CRO-02 ships with `shadow` as its only
permitted mode; `commercial_shadow_controls.rollback_marker=legacy-effective`
means all consumers continue to use BT-06 legacy results.

Before a separately approved production dry run, Data, Revenue, and Compliance
owners must each approve the exact release SHA, schema version, policy version,
purpose, bounded subject range, and discrepancy threshold. Confirm aggregate
coverage high-water is frozen, outbound/global pauses are active, no provider,
campaign, sequence, payout, or GHL operation can run, and the application
version is homogeneous.

The future owner procedure is no-write first: take an aggregate-only snapshot,
record its high-water mark, resolve bounded checkpoints in deterministic
dependency-vector lock order, and persist no names, addresses, emails, phones,
tokens, source payloads, or evidence payloads in exports. Each checkpoint is
idempotent by subject/vector fingerprint. Abort on lock/vector drift,
quarantine spike, mixed policy/schema/release SHA, or discrepancy above the
approved threshold. Resume only from a reviewed checkpoint/high-water pair.

After any future reconstruction, reconcile distinct-subject denominators and
zero-filled class/axis/reason buckets against the frozen high-water. Preserve
pre-cutover `legacy_class_snapshot_v1` events without inventing CRO-02
references; retain all snapshot/evidence references under the retention
workflow. A rollback writes the approved rollback marker and returns every
consumer to legacy behavior. Enforcement requires a new purpose-specific
approval and implementation task for each purpose; it must never be inferred
from this runbook or from shadow coverage.

## Residual successor inventory

* CRO-03 owns provider selection, budgets, canaries, and activation.
* CRO-04 owns consent, suppression, channel readiness, enrollment, and sends.
* CRO-05 owns record-level remediation/review UX.
* A future revenue/dashboard task owns non-safety-critical legacy reporting
  modernization. Safety-critical revenue, payout, provider, and outreach
  consumers may not be deferred from their respective cutover approvals.