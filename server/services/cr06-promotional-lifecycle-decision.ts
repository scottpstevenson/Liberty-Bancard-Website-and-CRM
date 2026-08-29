/**
 * CR-06's single execution boundary.  This is deliberately separate from the
 * CR-06 package builder: preparing a governed package must never authorize it.
 *
 * Every caller must classify its communication explicitly.  Unknown is treated
 * as promotional so an omitted classification cannot become an authorization.
 */
export type Cr06CommunicationPurpose =
  | "promotional"
  | "transactional"
  | "human_response";

export type Cr06PromotionalBoundary =
  | "promotional_enrollment"
  | "campaign_queue"
  | "campaign_claim"
  | "campaign_transport"
  | "sequence_enrollment"
  | "sequence_claim"
  | "sequence_transport"
  | "bulk_enrollment"
  | "new_lead_enrollment"
  | "workflow_enrollment"
  | "queue_runner"
  | "legacy_release";

export interface Cr06LifecycleDecision {
  allowed: boolean;
  purpose: Cr06CommunicationPurpose;
  reasonCode: "CR06_PROMOTIONAL_EXECUTION_DISABLED" | "CR06_NON_PROMOTIONAL_PURPOSE";
  boundary: Cr06PromotionalBoundary;
}

/**
 * Fail closed for promotional execution.  CR06_DISPATCH_AVAILABLE remains
 * false; this authority is intentionally the only place that can change when
 * promotional lifecycle execution is admitted. Transactional and direct
 * human-response communications are explicitly outside promotional lifecycle.
 */
export function decideCr06PromotionalLifecycle(input: {
  boundary: Cr06PromotionalBoundary;
  purpose?: Cr06CommunicationPurpose;
}): Cr06LifecycleDecision {
  const purpose = input.purpose ?? "promotional";
  if (purpose === "transactional" || purpose === "human_response") {
    return {
      allowed: true,
      purpose,
      boundary: input.boundary,
      reasonCode: "CR06_NON_PROMOTIONAL_PURPOSE",
    };
  }
  return {
    allowed: false,
    purpose,
    boundary: input.boundary,
    reasonCode: "CR06_PROMOTIONAL_EXECUTION_DISABLED",
  };
}

/** A sequence is promotional unless its persisted config explicitly says otherwise. */
export function classifyCr06SequencePurpose(sequence: { triggerConfig?: unknown; metadata?: unknown }): Cr06CommunicationPurpose {
  const config = (sequence.triggerConfig && typeof sequence.triggerConfig === "object"
    ? sequence.triggerConfig
    : sequence.metadata && typeof sequence.metadata === "object"
      ? sequence.metadata
      : {}) as Record<string, unknown>;
  const purpose = config.communicationPurpose;
  return purpose === "transactional" || purpose === "human_response" || purpose === "promotional"
    ? purpose
    : "promotional";
}

/** Classify the persisted sequence and apply CR-06 at an enrollment/release boundary. */
export function decideCr06SequenceLifecycle(
  sequence: { triggerConfig?: unknown; metadata?: unknown },
  boundary: Cr06PromotionalBoundary = "sequence_enrollment",
): Cr06LifecycleDecision {
  return decideCr06PromotionalLifecycle({
    boundary,
    purpose: classifyCr06SequencePurpose(sequence),
  });
}