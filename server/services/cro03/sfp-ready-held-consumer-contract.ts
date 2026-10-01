/**
 * Database-free orchestration contract for the ready-held SFP consumer.
 * Keeping this seam pure lets the drain/error behavior be certified without
 * loading server/db or touching the shared development database.
 */
export type ReadyHeldConsumerDisposition =
  | { state: "completed"; outcomeCode: string; result: Record<string, unknown> }
  | { state: "held"; outcomeCode: string; result: Record<string, unknown> }
  | { state: "retry" | "dead_letter"; outcomeCode: string; result: Record<string, unknown> };

export type ReadyHeldClaim = {
  id: string;
  stagingIntentId: string;
  claimToken: string;
  attemptCount: number;
  runtimeOwnerEpoch: number;
  runtimeOwnerToken: string;
  runtimeDeploymentIdentity: string;
  runtimeEnvironmentIdentity: string;
  runtimeArtifactSha: string;
  runtimeProcessIdentity: string;
  runtimeQueueTopologyHash: string;
};

export function classifyReadyHeldBridgeOutcome(result: {
  status: "created" | "already_bridged" | "left_held";
  heldReason?: string;
}): ReadyHeldConsumerDisposition {
  if (result.status === "left_held") {
    return {
      state: "held",
      outcomeCode: String(result.heldReason ?? "BRIDGE_LEFT_HELD").slice(0, 200),
      result: { status: result.status },
    };
  }
  return {
    state: "completed",
    outcomeCode: result.status,
    result: { status: result.status },
  };
}

export function classifyReadyHeldBridgeError(error: unknown, attemptCount: number): ReadyHeldConsumerDisposition {
  const message = String((error as any)?.message ?? error ?? "bridge_failed");
  const hold = /NOT_FOUND|NOT_READY_HELD|CONFLICT|BLOCKED|NOT_PAUSED|PINNED_|AMBIGUOUS|SUPPRESSED|STALE|ELIGIBILITY|POLICY|RECEIPT|PACKAGE|ACTIVE_ENROLLMENT|PROMOTION/i.test(message);
  if (hold) {
    return { state: "held", outcomeCode: message.slice(0, 200), result: { error: message.slice(0, 500) } };
  }
  if (attemptCount >= 5) {
    return { state: "dead_letter", outcomeCode: message.slice(0, 200), result: { error: message.slice(0, 500) } };
  }
  return { state: "retry", outcomeCode: message.slice(0, 200), result: { error: message.slice(0, 500) } };
}

/**
 * One per-item bridge error is persisted and cannot stop later work in the
 * batch. A lost/failing ledger write leaves the claim leased for recovery.
 */
export async function drainClaimedReadyHeldIntents(
  claims: ReadyHeldClaim[],
  deps: {
    bridge: (intentId: string, actorId: string, claim: ReadyHeldClaim) => Promise<{
      status: "created" | "already_bridged" | "left_held";
      heldReason?: string;
      contactId?: number | null;
      sequenceEnrollmentId?: number | null;
    }>;
    persist: (claim: ReadyHeldClaim, disposition: ReadyHeldConsumerDisposition) => Promise<void>;
    actorId: string;
  },
) {
  const summary = { attempted: 0, completed: 0, held: 0, retrying: 0, deadLettered: 0, persistenceFailures: 0 };
  for (const claim of claims) {
    summary.attempted++;
    let disposition: ReadyHeldConsumerDisposition;
    try {
      const result = await deps.bridge(claim.stagingIntentId, deps.actorId, claim);
      disposition = classifyReadyHeldBridgeOutcome(result);
      disposition.result = {
        ...disposition.result,
        contactId: result.contactId ?? null,
        sequenceEnrollmentId: result.sequenceEnrollmentId ?? null,
      };
    } catch (error) {
      disposition = classifyReadyHeldBridgeError(error, claim.attemptCount);
    }
    try {
      await deps.persist(claim, disposition);
      if (disposition.state === "completed") summary.completed++;
      else if (disposition.state === "held") summary.held++;
      else if (disposition.state === "retry") summary.retrying++;
      else summary.deadLettered++;
    } catch {
      summary.persistenceFailures++;
    }
  }
  return summary;
}