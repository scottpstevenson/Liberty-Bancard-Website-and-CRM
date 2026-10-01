/**
 * SouthFloridaProspectingPanel.tsx
 *
 * 15-step operator workflow for the South Florida Prospecting program.
 * Every button is wired to a real route and service.
 * Every mutation requires explicit operator confirmation.
 * No outreach is sent automatically.
 */

import React, { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2, MapPin, CheckCircle, Clock, Loader2,
  ShieldCheck, Eye, Play, RefreshCw, Mail, Users, Target,
  TrendingUp, BarChart3, ChevronDown, ChevronRight, Lock,
} from "lucide-react";
// Freeze idempotency keys use crypto.randomUUID(), generated once per
// logical freeze attempt and retained across retry/reload so a retried
// request replays the same stored result instead of minting a fresh run.

// ── Types ──────────────────────────────────────────────────────────────────────

type SfpProgram = {
  id: string;
  name: string;
  countyFips: string[];
  verticalIds: string[];
  maxCohortSize: number;
  isActive: boolean;
  recurringEnabled: boolean;
  campaignStagingBatchSize: number;
  activatedAt: string | null;
  policyVersion?: number;
  taxonomyVersion: 1 | 2;
};

type SfpFunnel = {
  funnel: {
    totalScanned: number;
    southFlorida: number;
    outsideGeography: number;
    geographyUnresolved: number;
    inTargetVertical: number;
    /** Sum of noVerticalEvidence + explicitNonTarget + reviewRequired + verticalConflict below — never render this alone as "needs review". */
    verticalUnresolved: number;
    noVerticalEvidence: number;
    explicitNonTarget: number;
    reviewRequired: number;
    verticalConflict: number;
    staleEvidence: number;
    dbprExcluded: number;
    existingCustomer: number;
    testDemoInternal: number;
    suppressed: number;
    bouncedInvalidOnly: number;
    inactiveEntity: number;
    eligibleAfterExclusions: number;
  };
  topCandidates: Array<{
    businessId: number;
    roiScore: number;
    geographyClass: string;
    geographySource: string;
    eligible: boolean;
    dispositionReason: string;
  }>;
  verticalIds: string[];
  countyFips: string[];
  capturedAt: string;
};

type SfpCohortRun = {
  id: string;
  status: string;
  cohortState: "freezing" | "frozen" | "failed" | "voided" | "superseded";
  cohortSize: number;
  cohortHash: string | null;
  frozenAt: string | null;
  actorId: string;
  createdAt: string;
  requestHash: string | null;
  configHash: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  supersededAt: string | null;
  supersededByRunId: string | null;
};

type SfpEvidenceReport = {
  cohortRunId: string;
  cohortSize: number;
  businessesWithCandidates: number;
  businessesWithoutCandidates: number;
  totalCandidates: number;
  perBusiness: Array<{
    businessId: number;
    candidateCount: number;
    bestCandidateMasked: string | null;
    bestCandidateConfidence: number | null;
    disposition: string;
  }>;
  capturedAt: string;
};

type SfpValidationPreview = {
  cohortRunId: string;
  cohortSize: number;
  addressesForValidation: number;
  maxValidations: number;
  gateOpen: boolean;
  selectedCandidates: Array<{
    businessId: number;
    candidateId: string;
    maskedValue: string;
    confidence: number;
  }>;
};

type SfpValidationResult = {
  addressesValidated: number;
  validCount: number;
  catchAllCount: number;
  invalidCount: number;
  failedCount: number;
  eligibilityRowsCreated: number;
  zeroOutreachConfirmed: true;
  completedAt: string;
};

type SfpProspects = {
  prospects: Array<{
    eligibilityId: string | null;
    businessId: number;
    businessName: string | null;
    normalizedVertical: string | null;
    county: string | null;
    roiScore: number;
    maskedEmail: string | null;
    namedContact: boolean;
    roleInbox: boolean;
    validationStatus: string;
    validationAt: string | null;
    validationAgeDays: number | null;
    zbOutcome: string | null;
    outreachPolicyStatus: string;
    campaignStagedAt: string | null;
    exclusionReason: string | null;
    policyVersion: number;
    sourceKind: string | null;
    consentTier: string | null;
    reasonCodes: string[];
  }>;
  total: number;
  byCohort: Record<string, number>;
};

type CampaignStagingPreview = {
  eligibleCount: number;
  alreadyStagedCount: number;
  willStageCount: number;
  ineligibleCount: number;
  ineligibleReasons: Record<string, number>;
};

type SfpCampaignStagingTelemetry = {
  capability: { profile: string; selectiveGroups: string[]; active: boolean };
  program: { name: string; isActive: boolean; recurringEnabled: boolean; campaignStagingBatchSize: number } | null;
  effectiveEnablement: boolean;
  outbound: { globalState: string; globalPaused: boolean; pauseEpoch: string; stateSource: string };
  packageControls: { ok: boolean; issues: string[] };
  lastRun: { id: string; state: string; selected: number; processed: number; succeeded: number; failed: number; terminalReason: string | null; createdAt: string; startedAt: string | null; completedAt: string | null } | null;
  lastCompletedRun: { id: string; state: string; completedAt: string | null } | null;
  currentlyRunning: { id: string; leaseExpiresAt: string | null; lastHeartbeatAt: string | null } | null;
  cancellableRun: { id: string; state: string; leaseExpiresAt: string | null } | null;
  backlog: { eligibleAwaitingStaging: number; freshAwaitingStaging: number; meaning: string; configuredBatchSize: number };
  readyHeldConsumer: {
    unqueuedReadyHeld: number; pending: number; claimed: number; staleClaims: number; retrying: number; held: number;
    completed: number; deadLettered: number; completedLast24h: number; lastProgressAt: string | null;
    batchLimit: number; scheduleActive: boolean;
    heldSample: Array<{
      id: string; stagingIntentId: string; businessId: number; packageKey: string | null;
      state: string; attemptCount: number; reason: string | null; updatedAt: string;
    }>;
  };
  throughput: { completedLast24h: number; deadLetteredLast24h: number };
  retries: { currentlyRetrying: number; staleLeases: number };
  deadLetters: { total: number; sample: Array<{ id: string; businessId: number; outcomeCode: string | null; attemptCount: number; completedAt: string | null }> };
  cost: { reportedCostMicros: number; note: string };
  workerHealth: { queueManagerReady: boolean; repeatableJobRegistered: boolean; nextRunEstimateAt: string | null; intervalMs: number | null };
  capturedAt: string;
};

type SfpRuntimeReleaseSelectionStatus = {
  selectedRelease: {
    artifactSha: string; deploymentIdentity: string; environmentIdentity: string; queueTopologyHash: string;
    selectedBy: string; selectedAt: string; selectionVersion: number; selectionEventId: string;
    publisherVerifiedArtifactSha: string;
    publisherVerifiedDeploymentIdentity: string; verificationReference: string;
  } | null;
  currentRelease: {
    artifactSha: string; deploymentIdentity: string; environmentIdentity: string; queueTopologyHash: string;
  } | null;
  currentReleaseSelected: boolean;
  ownerLeaseExpiresAt: string | null;
  ownerLive: boolean;
  ready: boolean;
  reason: string | null;
};

type PaidWaterfallPreview = {
  businessesNeedingPaidDiscovery: number;
  serperEligibleNow: number;
  providers: Array<{provider:string;credentialPresent:boolean;enabled:boolean;circuitState:string;executableForSfp:boolean;unitPriceMicros:number|null;role:string}>;
  note: string;
};
type SfpPaidGapVector = {
  businessId: number;
  before: Array<{ dimension: string; open: boolean }>;
  after: Array<{ dimension: string; open: boolean }>;
};
type SfpPhaseAPreview = {
  snapshotHash: string;
  candidateCount: number;
  currentPolicyEvidenceCounts: { target: number; nonTarget: number; reviewRequired: number };
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "secondary",
    freezing: "default",
    frozen: "default",
    enriching: "default",
    validating: "default",
    staged: "success",
    error: "destructive",
    validated_outreach_eligible: "success",
    validated_review_required: "warning",
    validated_suppressed: "destructive",
    catch_all_review: "warning",
    invalid: "destructive",
    discovery_required: "secondary",
    validation_pending: "secondary",
  };
  const variant = (map[status] ?? "secondary") as any;
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

function QueryFailure({ label, error }: { label: string; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
      {label} unavailable: {message}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SouthFloridaProspectingPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showProspects, setShowProspects] = useState(false);
  const [stagingResult, setStagingResult] = useState<{ created: number; skipped: number; rejected: number; reasons: Record<string, number> } | null>(null);
  const [serperBatchSize, setSerperBatchSize] = useState(10);
  const [lastPaidResult, setLastPaidResult] = useState<{ gapVectors: SfpPaidGapVector[] } | null>(null);
  const [selectedEligibilityIds, setSelectedEligibilityIds] = useState<string[]>([]);
  const [showFunnel, setShowFunnel] = useState(false);
  const [maxCohort, setMaxCohort] = useState(25);
  const [freeBatchSize, setFreeBatchSize] = useState(100);
  // Generated once per logical freeze attempt and retained across
  // retry/reload via localStorage (VFC-06) — a plain useState initializer
  // resets on every page reload, which silently turned every post-reload
  // freeze click into a NEW idempotency key instead of a retry of the
  // pending one. Only an explicit "start new cohort" action rotates it.
  const SFP_IDEMPOTENCY_STORAGE_KEY = "sfp:freeze-idempotency-key";
  const [freezeIdempotencyKey, setFreezeIdempotencyKey] = useState<string>(() => {
    try {
      const stored = window.localStorage.getItem(SFP_IDEMPOTENCY_STORAGE_KEY);
      if (stored) return stored;
    } catch { /* localStorage unavailable — fall through to a fresh key */ }
    const fresh = crypto.randomUUID();
    try { window.localStorage.setItem(SFP_IDEMPOTENCY_STORAGE_KEY, fresh); } catch { /* best-effort */ }
    return fresh;
  });
  const SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY = "sfp:discovery-idempotency-key";
  const [discoveryIdempotencyKey, setDiscoveryIdempotencyKey] = useState<string>(() => {
    try {
      const stored = window.localStorage.getItem(SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY);
      if (stored) return stored;
    } catch { /* localStorage unavailable — fall through to a fresh key */ }
    const fresh = crypto.randomUUID();
    try { window.localStorage.setItem(SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY, fresh); } catch { /* best-effort */ }
    return fresh;
  });
  const [voidReason, setVoidReason] = useState("");
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [candidateIdOverride, setCandidateIdOverride] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [freeOnlySnapshotId, setFreeOnlySnapshotId] = useState<string | null>(null);
  const [freeOnlyFreezeResult, setFreeOnlyFreezeResult] = useState<{ businessIds: number[]; rejectedAtFreeze: Array<{ businessId: number; reason: string }> } | null>(null);
  const [freeOnlyRunResult, setFreeOnlyRunResult] = useState<{ processed: number; targetCount: number; nonTargetCount: number; reviewRequiredCount: number; costMicros: number } | null>(null);
  const [stagingBatchDraft, setStagingBatchDraft] = useState("25");
  const [publisherVerifiedArtifactSha, setPublisherVerifiedArtifactSha] = useState("");
  const [publisherVerifiedDeploymentIdentity, setPublisherVerifiedDeploymentIdentity] = useState("");
  const [runtimeVerificationReference, setRuntimeVerificationReference] = useState("");
  const [runtimePublisherEvidenceConfirmed, setRuntimePublisherEvidenceConfirmed] = useState(false);

  useEffect(() => {
    setSelectedEligibilityIds([]);
  }, [activeRunId]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const programQuery = useQuery<SfpProgram>({
    queryKey: ["/api/lead-ops/sfp/program"],
    retry: false,
  });
  useEffect(() => {
    if (programQuery.data) setStagingBatchDraft(String(programQuery.data.campaignStagingBatchSize || 25));
  }, [programQuery.data?.id, programQuery.data?.campaignStagingBatchSize]);

  const runsQuery = useQuery<{ runs: SfpCohortRun[] }>({
    queryKey: ["/api/lead-ops/sfp/runs"],
    retry: false,
  });

  const funnelQuery = useQuery<SfpFunnel>({
    queryKey: ["/api/lead-ops/sfp/funnel"],
    enabled: showFunnel,
    retry: false,
  });

  const evidenceQuery = useQuery<SfpEvidenceReport>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/free-evidence`],
    enabled: !!activeRunId,
    retry: false,
  });

  // Terminal decision-ledger reconciliation — kept structurally and visually
  // separate from downstream stage-progress metrics (validation/staging).
  const reconciliationQuery = useQuery<{
    byDisposition: Array<{ disposition: string; count: number }>;
    totalDecisions: number;
    totalScannedCanonical: number;
    reconciles: boolean;
  }>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/reconciliation`],
    enabled: !!activeRunId,
    retry: false,
  });

  const validationPreviewQuery = useQuery<SfpValidationPreview>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/validation-preview`],
    enabled: !!activeRunId,
    retry: false,
  });

  const prospectsQuery = useQuery<SfpProspects>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/prospects`],
    enabled: !!activeRunId && showProspects,
    retry: false,
  });

  const stagingPreviewQuery = useQuery<CampaignStagingPreview>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/campaign-staging-preview`],
    enabled: !!activeRunId,
    retry: false,
  });

  const packageVerificationQuery = useQuery<{ ok: boolean; issues: string[] }>({
    queryKey: ["/api/lead-ops/sfp/campaign-packages-v2/verify"],
    retry: false,
  });

  const stagingTelemetryQuery = useQuery<SfpCampaignStagingTelemetry>({
    queryKey: ["/api/lead-ops/sfp/campaign-staging/telemetry"],
    refetchInterval: 30_000,
    retry: false,
  });

  const runtimeReleaseSelectionQuery = useQuery<SfpRuntimeReleaseSelectionStatus>({
    queryKey: ["/api/lead-ops/sfp/runtime-release-selection"],
    enabled: user?.role === "admin",
    refetchInterval: 30_000,
    retry: false,
  });

  const selectRuntimeReleaseMutation = useMutation({
    mutationFn: async () => {
      const status = runtimeReleaseSelectionQuery.data;
      if (!status?.currentRelease) throw new Error("This worker has no verified runtime release identity to select.");
      return await (await apiRequest("POST", "/api/lead-ops/sfp/runtime-release-selection/select", {
        expectedPreviousSelectionVersion: status.selectedRelease?.selectionVersion ?? null,
        expectedPreviousArtifactSha: status.selectedRelease?.artifactSha ?? null,
        publisherVerifiedArtifactSha: publisherVerifiedArtifactSha.trim(),
        publisherVerifiedDeploymentIdentity: publisherVerifiedDeploymentIdentity.trim(),
        verificationReference: runtimeVerificationReference.trim(),
      })).json() as {
        selection: { action: "bootstrap" | "transfer"; eventId: string };
        status: SfpRuntimeReleaseSelectionStatus;
      };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/lead-ops/sfp/runtime-release-selection"], result.status);
      setRuntimePublisherEvidenceConfirmed(false);
      toast({
        title: result.selection.action === "bootstrap" ? "Published SFP runtime selected" : "SFP runtime release transferred",
        description: `Audited event ${result.selection.eventId}. Readiness: ${result.status.ready ? "ready" : result.status.reason ?? "held"}. No paid permission or outbound state changed.`,
      });
    },
    onError: (error: Error) => {
      runtimeReleaseSelectionQuery.refetch();
      toast({ title: "Runtime release selection failed", description: error.message, variant: "destructive" });
    },
  });

  const stagingScheduleMutation = useMutation({
    mutationFn: async ({ recurringEnabled, batchSize }: { recurringEnabled: boolean; batchSize: number }) =>
      (await apiRequest("POST", "/api/lead-ops/sfp/program/campaign-staging-schedule", { recurringEnabled, batchSize })).json(),
    onSuccess: (result: any) => {
      queryClient.setQueryData(["/api/lead-ops/sfp/program"], result.program);
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/campaign-staging/telemetry"] });
      toast({
        title: result.program.recurringEnabled ? "SFP recurrence enabled" : "SFP recurrence disabled",
        description: "Only bounded campaign preparation and paused bridge work are scheduled. Outbound remains paused.",
      });
    },
    onError: (error: Error) => toast({ title: "Schedule update failed", description: error.message, variant: "destructive" }),
  });

  const readyHeldConsumerMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/lead-ops/sfp/ready-held-consumer/run", { limit: 25 })).json(),
    onSuccess: (result: any) => {
      stagingTelemetryQuery.refetch();
      toast({
        title: "Paused enrollment batch finished",
        description: result.enabled === false
          ? `No work was claimed. Queue held: ${result.stopReason ?? "runtime readiness unavailable"}. No activation or sends.`
          : `Attempted ${result.attempted}; paused bridge receipts ${result.completed}; held ${result.held}; retrying ${result.retrying}. No activation or sends.`,
      });
    },
    onError: (error: Error) => toast({ title: "Paused enrollment batch failed", description: error.message, variant: "destructive" }),
  });
  const retryReadyHeldConsumerItem = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("POST", `/api/lead-ops/sfp/ready-held-consumer/items/${id}/retry`, {})).json(),
    onSuccess: () => {
      stagingTelemetryQuery.refetch();
      toast({ title: "Held item requeued", description: "It will be rechecked by the canonical paused bridge before any new local side effect." });
    },
    onError: (error: Error) => toast({ title: "Consumer item retry failed", description: error.message, variant: "destructive" }),
  });

  const paidPreviewQuery = useQuery<PaidWaterfallPreview>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall-preview`],
    enabled: !!activeRunId,
    retry: false,
  });
  const phaseAPreviewQuery = useQuery<SfpPhaseAPreview>({
    queryKey: [`/api/lead-ops/sfp/programs/${programQuery.data?.id}/classification-preview`],
    enabled: !!programQuery.data?.id,
    retry: false,
  });
  const continuationPath = `/api/lead-ops/sfp/programs/${programQuery.data?.id}/free-classification-continuation`;
  const continuationQuery = useQuery<{ continuation: {
    state: string; high_water_business_id: number; stop_business_id: number;
    scanned_count: string; processed_count: string; target_count: string;
    rejected_count: string; last_error: string | null; last_tick_at: string | null;
  } | null }>({
    queryKey: [continuationPath],
    enabled: !!programQuery.data?.id,
    refetchInterval: 30_000,
    retry: false,
  });
  const continuationControl = useMutation({
    mutationFn: async (action: "start" | "pause") =>
      (await apiRequest("POST", `${continuationPath}/${action}`, {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [continuationPath] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/funnel"] });
    },
    onError: (e: any) => toast({ title: "Free classification control failed", description: e?.message, variant: "destructive" }),
  });

  type SfpHighConfidenceCandidate = {
    businessId: number;
    canonicalName: string;
    countyFips: string | null;
    geographySource: string;
    proposedVerticalId: string;
    confidence: number;
    reasonCodes: string[];
    source: "structured_vertical_field" | "name_derived_signal";
    exclusionStatus: string | null;
  };

  const highConfidenceCandidatesQuery = useQuery<{ candidates: SfpHighConfidenceCandidate[] }>({
    queryKey: [
      `/api/lead-ops/sfp/programs/${programQuery.data?.id}/high-confidence-candidates`,
      candidateIdOverride.trim(),
    ],
    queryFn: async () => {
      const idFilter = candidateIdOverride.split(",").map((s) => s.trim()).filter(Boolean).join(",");
      const basePath = `/api/lead-ops/sfp/programs/${programQuery.data?.id}/high-confidence-candidates`;
      const query = idFilter ? `?businessIds=${encodeURIComponent(idFilter)}` : "";
      const res = await apiRequest("GET", basePath + query);
      return res.json();
    },
    enabled: false,
    retry: false,
  });

  // Selections must never survive a change to the underlying candidate set
  // (a fresh preview load or a new explicit ID override) — otherwise a
  // stale businessId, or one that a new preview reclassified as excluded,
  // could ride along into a freeze request unnoticed.
  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [highConfidenceCandidatesQuery.data, candidateIdOverride]);

  const freezeFreeOnlySnapshot = useMutation({
    mutationFn: async () => {
      const currentProgram = programQuery.data;
      if (!currentProgram?.id) throw new Error("No active program");
      const res = await apiRequest("POST", "/api/lead-ops/sfp/classification/snapshot/freeze", {
        programId: currentProgram.id,
        businessIds: selectedCandidateIds,
        targetIds: currentProgram.verticalIds,
        policyVersion: currentProgram.policyVersion ?? 1,
        taxonomyVersion: currentProgram.taxonomyVersion,
        freeOnly: true,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setFreeOnlySnapshotId(data?.snapshotId ?? null);
      setFreeOnlyFreezeResult({
        businessIds: Array.isArray(data?.businessIds) ? data.businessIds : [],
        rejectedAtFreeze: Array.isArray(data?.rejectedAtFreeze) ? data.rejectedAtFreeze : [],
      });
      setFreeOnlyRunResult(null);
      const frozenCount = Array.isArray(data?.businessIds) ? data.businessIds.length : 0;
      const rejectedCount = Array.isArray(data?.rejectedAtFreeze) ? data.rejectedAtFreeze.length : 0;
      toast({ title: "Free-only batch frozen", description: `${frozenCount} businesses pinned${rejectedCount ? `, ${rejectedCount} rejected at freeze` : ""} — provider calls disabled` });
    },
    onError: (e: any) => toast({ title: "Freeze failed", description: e?.message, variant: "destructive" }),
  });

  const runFreeOnlySnapshot = useMutation({
    mutationFn: async () => {
      if (!freeOnlySnapshotId) throw new Error("No frozen free-only snapshot");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/classification/snapshot/${freeOnlySnapshotId}/run`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setFreeOnlyRunResult(data);
      toast({ title: "Free-only batch complete", description: `${data.processed} processed, $0 spent` });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/funnel"] });
    },
    onError: (e: any) => toast({ title: "Free-only run failed", description: e?.message, variant: "destructive" }),
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const ensureProgram = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lead-ops/sfp/program/ensure")).json(),
    onSuccess: () => {
      toast({ title: "South Florida Prospecting program initialized" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/program"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const setActivation = useMutation({
    mutationFn: async (input: { active: boolean; recurringEnabled: boolean }) => (await apiRequest("POST", "/api/lead-ops/sfp/program/activation", {
      active: input.active, recurringEnabled: input.recurringEnabled,
    })).json(),
    onSuccess: () => {
      toast({ title: "South Florida enrichment program updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/program"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/campaign-staging/telemetry"] });
    },
    onError: (e: any) => toast({ title: "Activation failed", description: e?.message, variant: "destructive" }),
  });

  const freezeCohort = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/lead-ops/sfp/runs/freeze", {
      idempotencyKey: freezeIdempotencyKey,
      maxCohortSize: maxCohort,
    })).json(),
    onSuccess: (data: any) => {
      toast({ title: "Cohort frozen", description: `${data?.run?.cohortSize ?? 0} businesses selected — hash ${String(data?.run?.cohortHash ?? "").slice(0, 12)}` });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/runs"] });
      if (data?.run?.id) setActiveRunId(data.run.id);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Unknown error";
      toast({ title: "Cohort freeze failed", description: msg, variant: "destructive" });
    },
  });

  // Explicit "start new cohort" action — rotates the idempotency key so the
  // next freeze attempt is a genuinely new logical request rather than a
  // retry of the previous one. Must also persist the rotated key to
  // localStorage immediately (VFC-06) — updating only React state here
  // would leave the OLD key in storage, so a page reload right after
  // "start new cohort" (before any freeze click) would silently revert to
  // retrying the previous attempt instead of starting a new one.
  const startNewCohortAttempt = () => {
    const fresh = crypto.randomUUID();
    try { window.localStorage.setItem(SFP_IDEMPOTENCY_STORAGE_KEY, fresh); } catch { /* best-effort */ }
    setFreezeIdempotencyKey(fresh);
    try { window.localStorage.setItem(SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY, fresh); } catch { /* best-effort */ }
    setDiscoveryIdempotencyKey(fresh);
  };

  const voidRun = useMutation({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      return (await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/void`, { reason: voidReason })).json();
    },
    onSuccess: () => {
      toast({ title: "Cohort run voided" });
      setConfirmingVoid(false);
      setVoidReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/runs"] });
    },
    onError: (e: any) => toast({ title: "Void failed", description: e?.message, variant: "destructive" }),
  });

  const validateCohort = useMutation<SfpValidationResult>({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/validate`, {
        // A new operator click is a new bounded attempt. Provider operations
        // inside that attempt remain idempotent per candidate.
        idempotencyKey: `sfp-validate-${activeRunId}-${Date.now()}`,
        maxValidations: 25,
      });
      return res.json();
    },
    onSuccess: (data: SfpValidationResult) => {
      toast({
        title: "Validation complete",
        description: `${data.validCount} valid · ${data.catchAllCount} catch-all · ${data.invalidCount} invalid`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/prospects`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/campaign-staging-preview`] });
    },
    onError: (e: any) => toast({ title: "Validation failed", description: e?.message, variant: "destructive" }),
  });

  const runFreeDiscovery = useMutation({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/free-discovery`, {
        idempotencyKey: `sfp-free-${activeRunId}-${Date.now()}`,
        maxBusinesses: freeBatchSize,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Free discovery completed",
        description: data.selected === 0
          ? "0 selected: free crawling requires a known website domain. Use the bounded domain-discovery pilot."
          : `${data.selected} selected · ${data.enriched} enriched · ${data.failed} failed · ${data.skipped} skipped`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/free-evidence`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/validation-preview`] });
    },
    onError: (e: any) => toast({ title: "Free discovery failed", description: e?.message, variant: "destructive" }),
  });

  const armSerperPilot = useMutation({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No frozen cohort selected");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/serper/arm-pilot`, {
        maxBusinesses: serperBatchSize,
        reason: "Bounded SFP domain-discovery pilot for frozen cohort",
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Serper provider approved", description: "Provider control enabled. No provider call was made." });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall-preview`] });
    },
    onError: (e: any) => toast({ title: "Serper pilot blocked", description: e?.message, variant: "destructive" }),
  });

  const runSerperDiscovery = useMutation({
    mutationFn: async () => {
      if(!activeRunId) throw new Error("No active run");
      const res=await apiRequest("POST",`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall/serper`,{
        idempotencyKey:`sfp-serper-${discoveryIdempotencyKey}`,maxBusinesses:serperBatchSize,
      });
      return res.json();
    },
    onSuccess:(data:any)=>{
      toast({title:"Serper discovery completed",description:`${data.succeeded} matched · ${data.noResult} no result · ${data.failed} failed`});
      const nextKey = crypto.randomUUID();
      try { window.localStorage.setItem(SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY, nextKey); } catch { /* best-effort */ }
      setDiscoveryIdempotencyKey(nextKey);
      queryClient.invalidateQueries({queryKey:[`/api/lead-ops/sfp/runs/${activeRunId}/free-evidence`]});
      queryClient.invalidateQueries({queryKey:[`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall-preview`]});
    },
    onError:(e:any)=>toast({title:"Paid discovery blocked",description:e?.message,variant:"destructive"}),
  });
  const runPaidWaterfall = useMutation({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall/person-identity`, {
        idempotencyKey: `sfp-paid-${discoveryIdempotencyKey}`, maxBusinesses: 10,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setLastPaidResult(data);
      toast({ title: "Paid waterfall completed", description: `${data.succeeded} succeeded · ${data.failed} failed · ${data.skipped} skipped` });
      const nextKey = crypto.randomUUID();
      try { window.localStorage.setItem(SFP_DISCOVERY_IDEMPOTENCY_STORAGE_KEY, nextKey); } catch { /* best-effort */ }
      setDiscoveryIdempotencyKey(nextKey);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/candidates`] });
    },
    onError: (e: any) => toast({ title: "Paid waterfall blocked", description: e?.message, variant: "destructive" }),
  });
  const runPhaseAClassification = useMutation({
    mutationFn: async () => {
      const currentProgram = programQuery.data;
      if (!currentProgram?.id || !phaseAPreviewQuery.data?.snapshotHash) throw new Error("Load the Phase A preview first");
      const response = await apiRequest("POST", "/api/lead-ops/sfp/classification/run", {
        programId: currentProgram.id,
        idempotencyKey: `sfp-classification-${discoveryIdempotencyKey}`,
        maxBusinesses: 25,
        targetIds: currentProgram.verticalIds,
        policyVersion: currentProgram.policyVersion ?? 1,
        allowGovernedSerperDomainDiscovery: false,
        previewSnapshotHash: phaseAPreviewQuery.data.snapshotHash,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Phase A classification complete", description: `${data.targetCount} target · ${data.nonTargetCount} non-target · ${data.reviewRequiredCount} review` });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/programs/${programQuery.data?.id}/classification-preview`] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/funnel"] });
    },
    onError: (e: any) => toast({ title: "Phase A run blocked", description: e?.message, variant: "destructive" }),
  });

  const stageForCampaign = useMutation({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      if (selectedEligibilityIds.length === 0) throw new Error("Select at least one eligible prospect");
      const previewResponse = await apiRequest("POST", "/api/lead-ops/sfp/campaign-staging-v2/preview", {
        cohortRunId: activeRunId,
        eligibilityIds: selectedEligibilityIds,
      });
      const preview = await previewResponse.json();
      const packageCounts = preview.rows
        .filter((row: any) => row.disposition === "eligible")
        .reduce((counts: Record<string, number>, row: any) => {
          const key = row.packageKey ?? "unassigned";
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {});
      const distribution = Object.entries(packageCounts).map(([key, count]) => `${key}: ${count}`).join("\n") || "No eligible package assignments";
      // Corrective-patch: previewStagingV2() already returns row-level
      // packageVersionId/packageContentHash/policyId/policyVersion/
      // policyDocumentHash/validationExpiresAt/validationAgeSeconds per
      // row — this was previously computed into the dialog but only
      // surfaced as an aggregate count. An operator confirming a batch must
      // be able to see EXACTLY which business/masked-address/source/
      // package/validation-freshness each row is pinning, not just how
      // many rows fall into each package bucket.
      const rowDetailLines = preview.rows.map((row: any) => {
        const label = row.disposition === "eligible"
          ? `pkg=${row.packageKey ?? "?"} policy=v${row.policyVersion ?? "?"} validExp=${row.validationExpiresAt ? new Date(row.validationExpiresAt).toLocaleString() : "?"} (${row.validationAgeSeconds != null ? `${Math.round(row.validationAgeSeconds / 60)}m old` : "age unknown"})`
          : `BLOCKED: ${row.blockedReason ?? "unknown"}`;
        return `  • biz#${row.businessId} [${row.sourceKind}] ${row.maskedEmail ?? "no email on file"} — ${label}`;
      }).join("\n");
      // PM-12: surface the exact policy version/hash and package-content
      // hash this confirmation is pinning to, plus the READY_HELD boundary
      // label the server returned — an operator confirming this dialog is
      // confirming these specific pins, not just a row count.
      const confirmed = window.confirm(
        `Stage exactly ${selectedEligibilityIds.length} selected prospect${selectedEligibilityIds.length === 1 ? "" : "s"}?\n\n` +
        `Package distribution:\n${distribution}\n\n` +
        `Row-level detail:\n${rowDetailLines}\n\n` +
        `Policy v${preview.policyVersion} (${String(preview.policyDocumentHash).slice(0, 12)}…)\n` +
        `${preview.blockedCount} selection(s) are blocked and will not be staged.\n\n` +
        `Outcome: ${preview.outcomeLabel} — rows are held in a package-pinned, review-only state. No message will be sent.`
      );
      if (!confirmed) return { cancelled: true };
      const executeResponse = await apiRequest("POST", "/api/lead-ops/sfp/campaign-staging-v2/execute", {
        cohortRunId: activeRunId,
        eligibilityIds: selectedEligibilityIds,
        commandKey: preview.commandKey,
        snapshotHash: preview.snapshotHash,
        // The server requires this exact payloadHash back — it re-derives a
        // fresh preview and rejects (409) if it no longer matches, so the
        // confirmation above can never be replayed against changed content.
        confirmPayloadHash: preview.payloadHash,
      });
      return executeResponse.json();
    },
    onSuccess: (data: any) => {
      if (data?.cancelled) return;
      setStagingResult(data);
      toast({
        title: "Campaign staging complete",
        description: `${data.readyHeld} ready_held · ${data.rejected} rejected. No outreach sent.`,
      });
      setSelectedEligibilityIds([]);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/prospects`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/campaign-staging-preview`] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/campaign-packages-v2/verify"] });
    },
    onError: (e: any) => {
      const rawMessage = String(e?.message ?? "Unable to stage selected prospects");
      const jsonStart = rawMessage.indexOf("{");
      let detail = rawMessage;
      if (jsonStart >= 0) {
        try {
          const body = JSON.parse(rawMessage.slice(jsonStart));
          if (body?.message) detail = String(body.message);
        } catch { /* preserve the API error text */ }
      }
      toast({ title: "Staging failed", description: detail, variant: "destructive" });
    },
  });

  // PM-13 correction: operator UI controls for the governed retry/cancel
  // routes — these existed server-side (requireRole admin) but had no
  // Lead Ops UI surface.
  const retryStageItem = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiRequest("POST", `/api/lead-ops/sfp/campaign-staging/items/${itemId}/retry`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item requeued for retry" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/campaign-staging/telemetry"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e?.message, variant: "destructive" }),
  });
  const cancelStageRun = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/lead-ops/sfp/campaign-staging/runs/${runId}/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Run cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/campaign-staging/telemetry"] });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e?.message, variant: "destructive" }),
  });

  const program = programQuery.data;
  const runs = runsQuery.data?.runs ?? [];
  const activeRun = runs.find((r) => r.id === activeRunId);
  const funnel = funnelQuery.data?.funnel;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-blue-500" />
                South Florida Prospecting
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Independent program · Works when master_leads = 0 · No pilot handoff required
              </CardDescription>
            </div>
            {!program && programQuery.isLoading ? (
              <span className="text-xs text-muted-foreground" role="status">Loading program status…</span>
            ) : !program && programQuery.isError ? (
              <span className="text-xs text-amber-700">Program status unavailable</span>
            ) : !program ? (
              <Button size="sm" onClick={() => ensureProgram.mutate()} disabled={ensureProgram.isPending}>
                {ensureProgram.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Initialize Program
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Badge variant={program.isActive ? "default" : "secondary"} className="text-xs">
                  {program.isActive ? "Active" : "Inactive"}
                </Badge>
                <Button size="sm" variant={program.isActive ? "outline" : "default"}
                  onClick={() => setActivation.mutate({ active: !program.isActive, recurringEnabled: false })} disabled={setActivation.isPending}>
                  {program.isActive ? "Pause program" : "Activate program"}
                </Button>
                {program.isActive && (
                  <Button size="sm" variant={program.recurringEnabled ? "outline" : "default"}
                    onClick={() => setActivation.mutate({ active: true, recurringEnabled: !program.recurringEnabled })}
                    disabled={setActivation.isPending}>
                    {program.recurringEnabled ? "Pause recurring enrichment" : "Enable recurring enrichment"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        {programQuery.isError && (
          <CardContent className="pt-0">
            <QueryFailure label="SFP program" error={programQuery.error} />
          </CardContent>
        )}

        {program && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              <span className="font-medium">Verticals:</span>
              {program.verticalIds.map((v) => <Badge key={v} variant="secondary" className="text-xs">{v}</Badge>)}
            </div>
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground mt-1">
              <span className="font-medium">Counties (FIPS):</span>
              {program.countyFips.map((f) => (
                <Badge key={f} variant="outline" className="text-xs">
                  {f === "12011" ? "Broward" : f === "12086" ? "Miami-Dade" : f === "12099" ? "Palm Beach" : f}
                </Badge>
              ))}
            </div>
            <div className="text-xs mt-2">
              Recurring enrichment: <span className={program.recurringEnabled ? "text-green-700 font-medium" : "text-muted-foreground"}>{program.recurringEnabled ? "on" : "off"}</span>
              {program.recurringEnabled && ` · campaign staging drain enabled (per-call chunk ${program.campaignStagingBatchSize || 25}; the worker drains backlog)`}
            </div>
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Provider status below is live. Credentials alone never authorize a paid call.
            </p>
          </CardContent>
        )}
      </Card>

      {runsQuery.isError && <QueryFailure label="Cohort run list" error={runsQuery.error} />}

      {/* Step 1-2: Funnel preview */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">1–2</span>
              Funnel Preview
            </CardTitle>
            <Button
              size="sm" variant="outline"
              onClick={() => { setShowFunnel(!showFunnel); queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/funnel"] }); }}
              disabled={!program}
            >
              {funnelQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
              {showFunnel ? "Hide" : "View"} Funnel
            </Button>
          </div>
        </CardHeader>
        {showFunnel && funnel && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                ["Total scanned", funnel.totalScanned, ""],
                ["South Florida", funnel.southFlorida, "text-blue-600"],
                ["Outside geo", funnel.outsideGeography, "text-orange-500"],
                ["Geo unresolved", funnel.geographyUnresolved, "text-yellow-600"],
                ["In target vertical", funnel.inTargetVertical, "text-green-600"],
                ["No vertical evidence", funnel.noVerticalEvidence, "text-yellow-600"],
                ["Explicit non-target", funnel.explicitNonTarget, "text-gray-500"],
                ["Review required", funnel.reviewRequired, "text-yellow-600"],
                ["Vertical conflict", funnel.verticalConflict, "text-orange-500"],
                ["Stale evidence", funnel.staleEvidence, "text-yellow-600"],
                ["DBPR excluded", funnel.dbprExcluded, "text-red-500"],
                ["Existing customer", funnel.existingCustomer, "text-red-500"],
                ["Suppressed", funnel.suppressed, "text-red-500"],
                ["Bounced/invalid only", funnel.bouncedInvalidOnly, "text-red-500"],
                ["Inactive entity", funnel.inactiveEntity, "text-red-500"],
                ["Test/demo", funnel.testDemoInternal, "text-gray-500"],
                ["Eligible", funnel.eligibleAfterExclusions, "text-green-700 font-bold"],
              ].map(([label, count, cls]) => (
                <div key={String(label)} className="bg-muted/50 rounded p-2">
                  <div className={`text-base font-mono font-bold ${cls}`}>{count}</div>
                  <div className="text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
        {showFunnel && funnelQuery.isError && (
          <CardContent className="pt-0">
            <QueryFailure label="Funnel preview" error={funnelQuery.error} />
          </CardContent>
        )}
      </Card>

      {program && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Phase A Classification (Read-only Preview)</CardTitle>
            <CardDescription className="text-xs">Preview is read-only; classification runs are bounded, manual, and do not activate providers.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>{phaseAPreviewQuery.data?.candidateCount ?? (phaseAPreviewQuery.isError ? "unavailable" : "—")} businesses</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.target ?? (phaseAPreviewQuery.isError ? "unavailable" : 0)} target</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.nonTarget ?? (phaseAPreviewQuery.isError ? "unavailable" : 0)} non-target</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.reviewRequired ?? (phaseAPreviewQuery.isError ? "unavailable" : 0)} without evidence at current policy</span>
              <Button size="sm" onClick={() => runPhaseAClassification.mutate()}
                disabled={!phaseAPreviewQuery.data?.snapshotHash || runPhaseAClassification.isPending}>
                {runPhaseAClassification.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Run Phase A (max 25)
              </Button>
            </div>
            {phaseAPreviewQuery.isError && <QueryFailure label="Phase A preview" error={phaseAPreviewQuery.error} />}
            <div className="border rounded p-3 space-y-2 text-xs">
              <div className="font-semibold">
                Free-only backlog continuation: {continuationQuery.isError ? "unavailable" : continuationQuery.isLoading ? "loading" : continuationQuery.data?.continuation?.state ?? "idle"}
              </div>
              {continuationQuery.isError && <QueryFailure label="Continuation status" error={continuationQuery.error} />}
              <div className="text-muted-foreground">
                {continuationQuery.isError || continuationQuery.isLoading ? "Progress counters are unavailable; they are not zero." : <>
                  Cursor {continuationQuery.data?.continuation?.high_water_business_id ?? 0} / {continuationQuery.data?.continuation?.stop_business_id ?? 0}
                  {" · "}{continuationQuery.data?.continuation?.processed_count ?? 0} classified
                  {" · "}{continuationQuery.data?.continuation?.target_count ?? 0} target.
                </>}
                Scans at most 250 records and classifies at most 25 per tick; paid providers and outbound remain off.
              </div>
              {continuationQuery.data?.continuation?.state === "running" &&
                <div className="text-amber-700">
                  Last worker tick: {continuationQuery.data.continuation.last_tick_at
                    ? new Date(continuationQuery.data.continuation.last_tick_at).toLocaleString()
                    : "none yet — verify the sfp-free-classification worker is selected in the deployed profile"}
                </div>}
              {continuationQuery.data?.continuation?.last_error &&
                <div className="text-red-600">Last error: {continuationQuery.data.continuation.last_error}</div>}
              {continuationQuery.data?.continuation?.state === "running" ?
                <Button size="sm" variant="outline" onClick={() => continuationControl.mutate("pause")}
                  disabled={continuationControl.isPending || continuationQuery.isError}>Pause free classification</Button> :
                <Button size="sm" variant="outline" onClick={() => continuationControl.mutate("start")}
                  disabled={!program.isActive || program.taxonomyVersion !== 2 || continuationControl.isPending || continuationQuery.isError}>
                  {continuationQuery.data?.continuation?.state === "paused" ? "Resume" : "Start"} free-only backlog
                </Button>}
            </div>
          </CardContent>
        </Card>
      )}

      {program && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">High-Confidence Candidates &amp; Free-Only Batch</CardTitle>
            <CardDescription className="text-xs">
              Deterministic-signal businesses only (no OpenAI/Serper/Outscraper/Apollo/ZeroBounce calls). Freezing in
              free-only mode is a server-enforced setting on the frozen snapshot — it cannot be overridden at run time.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => highConfidenceCandidatesQuery.refetch()} disabled={highConfidenceCandidatesQuery.isFetching}>
                {highConfidenceCandidatesQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Load candidates
              </Button>
              <input
                type="text"
                placeholder="Override: explicit business ID(s), comma-separated"
                value={candidateIdOverride}
                onChange={(e) => setCandidateIdOverride(e.target.value)}
                className="flex-1 min-w-[220px] h-8 rounded border px-2 text-xs bg-background"
                aria-label="Explicit business ID override"
              />
            </div>
            {highConfidenceCandidatesQuery.data && (
              <div className="max-h-64 overflow-y-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-1 text-left w-8"></th>
                      <th className="p-1 text-left">ID</th>
                      <th className="p-1 text-left">Business</th>
                      <th className="p-1 text-left">Proposed group</th>
                      <th className="p-1 text-left">Evidence source</th>
                      <th className="p-1 text-left">Geography</th>
                      <th className="p-1 text-left">Confidence</th>
                      <th className="p-1 text-left">Exclusion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highConfidenceCandidatesQuery.data.candidates.map((c) => {
                      const excluded = c.exclusionStatus != null;
                      return (
                        <tr key={c.businessId} className={`border-t ${excluded ? "opacity-50" : ""}`}>
                          <td className="p-1">
                            <input
                              type="checkbox"
                              checked={selectedCandidateIds.includes(c.businessId)}
                              disabled={excluded}
                              onChange={(e) => setSelectedCandidateIds((prev) =>
                                e.target.checked ? [...prev, c.businessId] : prev.filter((id) => id !== c.businessId))}
                              aria-label={`Select business ${c.businessId}`}
                            />
                          </td>
                          <td className="p-1 font-mono">{c.businessId}</td>
                          <td className="p-1">
                            <a className="text-blue-700 hover:underline" href={`/dashboard/lead-ops/business/${c.businessId}`}>
                              {c.canonicalName}
                            </a>
                          </td>
                          <td className="p-1">{c.proposedVerticalId}</td>
                          <td className="p-1">{c.source === "structured_vertical_field" ? "Structured field" : "Name-derived"}</td>
                          <td className="p-1">{c.countyFips ?? "—"} ({c.geographySource})</td>
                          <td className="p-1">{Number(c.confidence).toFixed(2)}</td>
                          <td className="p-1">
                            {excluded ? <Badge variant="destructive" className="text-xs">{c.exclusionStatus}</Badge> : <span className="text-muted-foreground">none</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {highConfidenceCandidatesQuery.data.candidates.length === 0 && (
                      <tr><td colSpan={8} className="p-2 text-center text-muted-foreground">No candidates found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {highConfidenceCandidatesQuery.isError && (
              <QueryFailure label="Candidate preview" error={highConfidenceCandidatesQuery.error} />
            )}
            {highConfidenceCandidatesQuery.isFetching && !highConfidenceCandidatesQuery.data && (
              <div className="text-xs text-muted-foreground" role="status">Loading candidate preview…</div>
            )}
            <div className="flex items-center gap-3 text-xs">
              <span>{selectedCandidateIds.length} selected (max 25)</span>
              <Button
                size="sm"
                onClick={() => freezeFreeOnlySnapshot.mutate()}
                disabled={
                  freezeFreeOnlySnapshot.isPending ||
                  selectedCandidateIds.length === 0 ||
                  selectedCandidateIds.length > 25
                }
              >
                {freezeFreeOnlySnapshot.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
                Freeze free-only batch
              </Button>
              {freeOnlySnapshotId && (
                <Button size="sm" variant="outline" onClick={() => runFreeOnlySnapshot.mutate()} disabled={runFreeOnlySnapshot.isPending}>
                  {runFreeOnlySnapshot.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Run frozen free-only batch
                </Button>
              )}
            </div>
            {freeOnlyFreezeResult && (
              <div className="text-xs text-muted-foreground">
                Frozen IDs: {freeOnlyFreezeResult.businessIds.join(", ") || "none"}
                {freeOnlyFreezeResult.rejectedAtFreeze.length > 0 && (
                  <div className="text-amber-600 mt-1">
                    Rejected at freeze: {freeOnlyFreezeResult.rejectedAtFreeze.map((r) => `${r.businessId} (${r.reason})`).join(", ")}
                  </div>
                )}
              </div>
            )}
            {freeOnlyRunResult && (
              <div className="text-xs text-muted-foreground">
                Processed {freeOnlyRunResult.processed} · {freeOnlyRunResult.targetCount} target ·{" "}
                {freeOnlyRunResult.nonTargetCount} non-target · {freeOnlyRunResult.reviewRequiredCount} review-required ·
                cost ${(freeOnlyRunResult.costMicros / 1_000_000).toFixed(4)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3-4: Configure and freeze cohort */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">3–4</span>
            Configure &amp; Freeze Cohort
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs whitespace-nowrap">Max cohort size:</label>
            <input
              type="number" min={1} max={100} value={maxCohort}
              onChange={(e) => setMaxCohort(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="border rounded px-2 py-1 text-xs w-20"
            />
            <span className="text-xs text-muted-foreground">(program cap: 100)</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => freezeCohort.mutate()}
              disabled={!program?.isActive || freezeCohort.isPending}
            >
              {freezeCohort.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Target className="h-3 w-3 mr-1" />}
              Freeze Deterministic Cohort (top {maxCohort} by ROI score)
            </Button>
            <Button size="sm" variant="ghost" onClick={startNewCohortAttempt} title="Rotate the idempotency key to start a genuinely new freeze attempt">
              <RefreshCw className="h-3 w-3 mr-1" /> Start new cohort
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Idempotent — re-running with the same key ({freezeIdempotencyKey.slice(0, 8)}…) replays the existing
            frozen cohort; a payload change under the same key is rejected. Use "Start new cohort" for a genuinely
            new attempt. ROI scores all eligible businesses globally before selecting the top {maxCohort}.
          </p>
        </CardContent>
      </Card>

      {/* Existing runs */}
      {runs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cohort Runs</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1">
              {runs.slice(0, 10).map((run) => (
                <button
                  type="button"
                  key={run.id}
                  aria-label={`Select cohort run ${run.id}`}
                  className={`flex w-full items-center justify-between p-2 rounded cursor-pointer text-xs border text-left ${run.id === activeRunId ? "bg-blue-50 border-blue-200" : "bg-muted/30 border-transparent hover:border-muted"}`}
                  onClick={() => setActiveRunId(run.id)}
                >
                  <div className="flex items-center gap-2">
                    {statusBadge((run as any).cohortState ?? run.status)}
                    <span className="font-mono text-muted-foreground">{run.id.slice(0, 8)}…</span>
                    <span>{run.cohortSize} businesses</span>
                    {run.cohortHash && <span className="font-mono text-muted-foreground" title="Full-manifest cohort hash">#{run.cohortHash.slice(0, 10)}</span>}
                    {run.frozenAt && <span className="text-muted-foreground">{new Date(run.frozenAt).toLocaleDateString()}</span>}
                    {(run as any).voidedAt && <Badge variant="destructive">Voided</Badge>}
                    {(run as any).supersededAt && <Badge variant="secondary">Superseded</Badge>}
                  </div>
                  {run.id === activeRunId && <Badge variant="outline">Active</Badge>}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active run: request/config fingerprint + terminal reconciliation.
          Deliberately a separate card from any stage-progress metrics
          (validation/staging counts below) so the two are never conflated. */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Run Fingerprint &amp; Terminal Reconciliation</CardTitle>
            <CardDescription className="text-xs">
              Terminal decisions come from the freeze-time decision ledger and are independent of any
              later validation/staging stage progress shown below.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-1 font-mono">
              <span className="text-muted-foreground">Cohort hash</span>
              <span className="truncate" title={activeRun.cohortHash ?? ""}>{activeRun.cohortHash ?? "—"}</span>
              <span className="text-muted-foreground">Request hash</span>
              <span className="truncate" title={activeRun.requestHash ?? ""}>{activeRun.requestHash ?? "—"}</span>
              <span className="text-muted-foreground">Config hash</span>
              <span className="truncate" title={activeRun.configHash ?? ""}>{activeRun.configHash ?? "—"}</span>
            </div>
            {reconciliationQuery.data && (
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">Terminal decision reconciliation</span>
                  {reconciliationQuery.data.reconciles ? (
                    <Badge variant="outline" className="text-green-700 border-green-300">Reconciles</Badge>
                  ) : (
                    <Badge variant="destructive">Mismatch</Badge>
                  )}
                </div>
                <p className="text-muted-foreground mb-1">
                  {reconciliationQuery.data.totalDecisions} terminal decisions vs. {reconciliationQuery.data.totalScannedCanonical} total scanned canonical businesses
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {reconciliationQuery.data.byDisposition.map((d) => (
                    <span key={d.disposition} className="flex justify-between">
                      <span className="text-muted-foreground">{d.disposition}</span>
                      <span className="font-mono">{d.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active run: lifecycle controls (void/supersede) */}
      {activeRun && (activeRun as any).cohortState === "frozen" && !(activeRun as any).voidedAt && !(activeRun as any).supersededAt && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cohort Lifecycle</CardTitle>
            <CardDescription className="text-xs">
              A frozen cohort's membership and hash are immutable. Voiding blocks it from future
              use while preserving its full history — it never rewrites or deletes the manifest.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!confirmingVoid ? (
              <Button size="sm" variant="destructive" onClick={() => setConfirmingVoid(true)}>
                Void this cohort run
              </Button>
            ) : (
              <div className="space-y-2 border rounded p-2 bg-red-50">
                <p className="text-xs font-medium">Confirm void — this cannot be undone. Enter a reason:</p>
                <input
                  type="text" value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Reason for voiding this cohort run"
                  className="border rounded px-2 py-1 text-xs w-full"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={!voidReason.trim() || voidRun.isPending} onClick={() => voidRun.mutate()}>
                    {voidRun.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Confirm void
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setConfirmingVoid(false); setVoidReason(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Steps 5-6: Free discovery */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">5–6</span>
              Free Evidence Report
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {evidenceQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : evidenceQuery.data ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-muted/50 rounded p-2">
                    <div className="text-base font-bold">{evidenceQuery.data.cohortSize}</div>
                    <div className="text-muted-foreground">Cohort size</div>
                  </div>
                  <div className="bg-green-50 rounded p-2">
                    <div className="text-base font-bold text-green-700">{evidenceQuery.data.businessesWithCandidates}</div>
                    <div className="text-muted-foreground">With candidates</div>
                  </div>
                  <div className="bg-yellow-50 rounded p-2">
                    <div className="text-base font-bold text-yellow-700">{evidenceQuery.data.businessesWithoutCandidates}</div>
                    <div className="text-muted-foreground">Need discovery</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {evidenceQuery.data.totalCandidates} total staged candidates.
                  Use the bounded action below to run the real free-only crawler for this cohort.
                </p>
                <div className="rounded border">
                  <div className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium">
                    Candidate evidence (masked)
                  </div>
                  {evidenceQuery.data.perBusiness.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto divide-y">
                      {evidenceQuery.data.perBusiness.map((candidate) => (
                        <div key={candidate.businessId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5 text-xs">
                          <span className="font-mono">Business #{candidate.businessId}</span>
                          <span>{candidate.bestCandidateMasked ?? "No candidate address"}</span>
                          <span className="text-muted-foreground">
                            {candidate.bestCandidateConfidence == null
                              ? "Confidence unavailable"
                              : `Confidence ${Number(candidate.bestCandidateConfidence).toFixed(2)}`}
                            {" · "}{candidate.disposition}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No candidate evidence rows were returned.</p>
                  )}
                  <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
                    This API does not include per-candidate source, observation time, or validation receipt details.
                    Masked candidates are evidence only, not verified or send-authorized email.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="text-xs">Batch:</label>
                  <input type="number" min={1} max={500} value={freeBatchSize}
                    onChange={(e) => setFreeBatchSize(Math.max(1, Math.min(500, Number(e.target.value))))}
                    className="border rounded px-2 py-1 text-xs w-20" />
                  <Button size="sm" onClick={() => runFreeDiscovery.mutate()}
                    disabled={!program?.isActive || runFreeDiscovery.isPending}>
                    {runFreeDiscovery.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                    Run free discovery
                  </Button>
                </div>
              </div>
            ) : evidenceQuery.isError ? (
              <QueryFailure label="Free evidence report" error={evidenceQuery.error} />
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Steps 7-8: governed paid escalation */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">7–8</span>
              Paid Provider Escalation
              <Badge variant="secondary" className="text-xs">Explicit authorization required</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Ordered waterfall: Serper, canonical free recrawl, Outscraper business identity, then Apollo decision-maker discovery.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {paidPreviewQuery.isError && <QueryFailure label="Paid-provider readiness" error={paidPreviewQuery.error} />}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {(paidPreviewQuery.data?.providers ?? []).map((p) => (
                <div key={p.provider} className={`border rounded p-2 ${p.executableForSfp ? "" : "opacity-60"}`}>
                  <div className="font-medium capitalize">{p.provider}</div>
                  <div className="text-muted-foreground">{p.role}</div>
                  <Badge variant={p.enabled && p.credentialPresent && p.circuitState === "closed" ? "default" : "outline"} className="text-xs mt-1">
                    {!p.credentialPresent ? "credential missing" : !p.enabled ? "disabled" : p.circuitState}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs font-medium">
                {paidPreviewQuery.isError ? "unavailable" : paidPreviewQuery.data?.businessesNeedingPaidDiscovery ?? 0} businesses still need discovery · {paidPreviewQuery.isError ? "unavailable" : paidPreviewQuery.data?.serperEligibleNow ?? 0} eligible for Serper now
              </span>
              <label className="text-xs" htmlFor="sfp-serper-batch-size">Pilot businesses</label>
              <input id="sfp-serper-batch-size" type="number" min={1} max={10} value={serperBatchSize}
                onChange={(e) => setSerperBatchSize(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="border rounded px-2 py-1 text-xs w-16" />
              <Button size="sm" variant="outline" onClick={() => {
                if (confirm("Approve Serper for this frozen cohort? This enables the existing provider control, does not change its configured limit, and makes no provider call.")) {
                  armSerperPilot.mutate();
                }
              }}
                disabled={armSerperPilot.isPending || paidPreviewQuery.isError || !activeRunId || !paidPreviewQuery.data?.serperEligibleNow}>
                Approve Serper provider for this cohort
              </Button>
              <Button size="sm" onClick={()=>runSerperDiscovery.mutate()}
                disabled={runSerperDiscovery.isPending || paidPreviewQuery.isError || !paidPreviewQuery.data?.serperEligibleNow || !(paidPreviewQuery.data?.providers.find(p=>p.provider==='serper')?.enabled)}>
                {runSerperDiscovery.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1"/> : <Play className="h-3 w-3 mr-1"/>}
                Run Serper discovery ({serperBatchSize} business{serperBatchSize === 1 ? "" : "es"})
              </Button>
              {paidPreviewQuery.data?.serperEligibleNow === 0 && (paidPreviewQuery.data?.businessesNeedingPaidDiscovery ?? 0) > 0 && (
                <span className="text-muted-foreground">No paid retry is due in this frozen cohort. Recent no-results become retryable after the configured cooldown.</span>
              )}
              <Button size="sm" variant="outline" onClick={() => runPaidWaterfall.mutate()}
                disabled={runPaidWaterfall.isPending || paidPreviewQuery.isError}>
                {runPaidWaterfall.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Outscraper + Apollo (max 10)
              </Button>
            </div>
            {lastPaidResult !== null && lastPaidResult.gapVectors.length > 0 && (
              <div className="mt-2 text-xs">
                <div className="font-medium">Per-business gap vectors (before → after)</div>
                {lastPaidResult.gapVectors.map((vector: any) => (
                  <div key={vector.businessId}>Business {vector.businessId}: {vector.before.filter((g: any) => g.open).map((g: any) => g.dimension).join(", ") || "none"} → {vector.after.filter((g: any) => g.open).map((g: any) => g.dimension).join(", ") || "none"}</div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {paidPreviewQuery.data?.note ?? (paidPreviewQuery.isError ? "Provider readiness is unavailable; no provider request is authorized." : "Loading provider controls…")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Provider approval enables the existing control without changing its usage counters or circuit state.
              A completed or no-result business is skipped on later batches of this cohort.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Steps 9-11: ZeroBounce validation */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">9–11</span>
              ZeroBounce Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {validationPreviewQuery.data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold">{validationPreviewQuery.data.addressesForValidation}</div>
                  <div className="text-muted-foreground">Addresses to validate</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold">{validationPreviewQuery.data.maxValidations}</div>
                  <div className="text-muted-foreground">Maximum validations</div>
                </div>
              </div>
            )}
            {validationPreviewQuery.isError && <QueryFailure label="Validation preview" error={validationPreviewQuery.error} />}
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/validation-preview`] })}
              >
                <Eye className="h-3 w-3 mr-1" /> Preview
              </Button>
              <Button
                size="sm"
                onClick={() => validateCohort.mutate()}
                disabled={validateCohort.isPending || validationPreviewQuery.isError}
              >
                {validateCohort.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Authorize Bounded Validation (max 25)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Real email addresses are decrypted at the secure boundary immediately before validation.
              Masked values are never sent to ZeroBounce.
              Idempotent by run ID.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Steps 12-13: Validated prospects */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">12–13</span>
                Validated Outreach Prospects
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowProspects(!showProspects)}>
                <Users className="h-3 w-3 mr-1" />
                {showProspects ? "Hide" : "Show"} Prospects
              </Button>
            </div>
          </CardHeader>
          {showProspects && (
            <CardContent className="pt-0 space-y-2">
              {prospectsQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : prospectsQuery.data ? (
                <>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {Object.entries(prospectsQuery.data.byCohort).map(([status, cnt]) => (
                      <Badge key={status} variant="outline">{status.replace(/_/g, " ")}: {cnt}</Badge>
                    ))}
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {prospectsQuery.data.prospects.map((p) => (
                      <div key={p.businessId} className="flex flex-col gap-1 p-2 bg-muted/30 rounded text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            aria-label={`Select ${p.businessName ?? `business ${p.businessId}`} for campaign staging`}
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={Boolean(p.eligibilityId && selectedEligibilityIds.includes(p.eligibilityId))}
                            disabled={!p.eligibilityId || p.validationStatus !== "validated_outreach_eligible" || Boolean(p.campaignStagedAt) || (selectedEligibilityIds.length >= 25 && !selectedEligibilityIds.includes(p.eligibilityId ?? ""))}
                            onChange={(event) => {
                              if (!p.eligibilityId) return;
                              setSelectedEligibilityIds((current) => event.target.checked
                                ? [...new Set([...current, p.eligibilityId!])]
                                : current.filter((id) => id !== p.eligibilityId));
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <a
                              className="font-medium truncate text-blue-700 hover:underline"
                              href={`/dashboard/lead-ops/business/${p.businessId}`}
                            >
                              {p.businessName ?? `Biz #${p.businessId}`}
                            </a>
                            {p.normalizedVertical && <span className="text-muted-foreground ml-1">· {p.normalizedVertical}</span>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {p.maskedEmail && <span className="font-mono text-muted-foreground">{p.maskedEmail}</span>}
                            {statusBadge(p.validationStatus)}
                            {p.campaignStagedAt && <Badge variant="default" className="text-xs">Staged</Badge>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">policy v{p.policyVersion}</Badge>
                          {p.sourceKind && <Badge variant="outline" className="text-[10px]">source: {p.sourceKind}</Badge>}
                          {p.consentTier && <Badge variant="outline" className="text-[10px]">consent: {p.consentTier}</Badge>}
                          {p.validationAgeDays != null && (
                            <Badge variant="outline" className="text-[10px]">{Math.round(p.validationAgeDays)}d old</Badge>
                          )}
                          {p.sourceKind === "paid" && !p.campaignStagedAt && (
                            <Badge variant="secondary" className="text-[10px]">Task 2001 staging blocked (paid source)</Badge>
                          )}
                          {p.reasonCodes?.length > 0 && (
                            <span className="truncate max-w-[240px]" title={p.reasonCodes.join(", ")}>
                              {p.reasonCodes.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {prospectsQuery.data.total} total prospects.
                    Only <code>validated_outreach_eligible</code> rows can advance to campaign staging.
                  </p>
                </>
              ) : prospectsQuery.isError ? (
                <QueryFailure label="Prospect list" error={prospectsQuery.error} />
              ) : <p className="text-xs text-muted-foreground">Prospect list has not loaded.</p>}
            </CardContent>
          )}
        </Card>
      )}

      {/* Steps 14-15: Campaign staging */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">14–15</span>
              Campaign Staging
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {stagingPreviewQuery.isError && <QueryFailure label="Campaign staging preview" error={stagingPreviewQuery.error} />}
            {stagingPreviewQuery.data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-green-50 rounded p-2">
                  <div className="text-base font-bold text-green-700">{stagingPreviewQuery.data.eligibleCount}</div>
                  <div className="text-muted-foreground">Eligible</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold">{stagingPreviewQuery.data.alreadyStagedCount}</div>
                  <div className="text-muted-foreground">Already staged</div>
                </div>
                <div className="bg-blue-50 rounded p-2">
                  <div className="text-base font-bold text-blue-700">{stagingPreviewQuery.data.willStageCount}</div>
                  <div className="text-muted-foreground">Will stage</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold">{stagingPreviewQuery.data.ineligibleCount}</div>
                  <div className="text-muted-foreground">Ineligible</div>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/campaign-staging-preview`] })}
              >
                <Eye className="h-3 w-3 mr-1" /> Preview
              </Button>
              <Button
                size="sm"
                onClick={() => stageForCampaign.mutate()}
                disabled={stageForCampaign.isPending || selectedEligibilityIds.length === 0 || selectedEligibilityIds.length > 25}
              >
                {stageForCampaign.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                Stage Selected Eligible Prospects ({selectedEligibilityIds.length})
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEligibilityIds.length === 0
                ? "Select eligible prospects in the validated-prospects list to enable staging."
                : selectedEligibilityIds.length > 25
                  ? "A maximum of 25 eligibility rows can be staged per command."
                : `${selectedEligibilityIds.length} eligibility row${selectedEligibilityIds.length === 1 ? "" : "s"} selected (maximum 25 per command).`}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border p-2 text-xs">
                <div className="font-medium">Current package mapping</div>
                {packageVerificationQuery.isLoading ? (
                  <span className="text-muted-foreground">Checking package mappings…</span>
                ) : packageVerificationQuery.data?.ok ? (
                  <span className="text-green-700">Verified — all current campaigns are draft and sequences paused.</span>
                ) : packageVerificationQuery.data ? (
                  <div className="text-destructive">{packageVerificationQuery.data.issues.join("; ")}</div>
                ) : (
                  <span className="text-muted-foreground">Verification unavailable.</span>
                )}
              </div>
              <div className="rounded border p-2 text-xs space-y-1">
                <div className="font-medium">SFP staging worker telemetry</div>
                {user?.role === "admin" && (
                  <div className="rounded border border-amber-500/50 bg-amber-50/50 p-2 dark:bg-amber-950/20">
                    <div className="font-medium">Published runtime-release ownership</div>
                    {runtimeReleaseSelectionQuery.isLoading ? (
                      <div className="text-muted-foreground">Reading durable release selection…</div>
                    ) : runtimeReleaseSelectionQuery.data ? (
                      <>
                        <div className={runtimeReleaseSelectionQuery.data.ready ? "text-green-700" : "font-medium text-amber-800 dark:text-amber-200"}>
                          {runtimeReleaseSelectionQuery.data.ready
                            ? "Selected published release has a live runtime owner."
                            : `Queue work held · ${runtimeReleaseSelectionQuery.data.reason ?? "runtime readiness unavailable"}`}
                        </div>
                        {runtimeReleaseSelectionQuery.data.ownerLeaseExpiresAt && (
                          <div className="text-muted-foreground">
                            Owner lease expires {new Date(runtimeReleaseSelectionQuery.data.ownerLeaseExpiresAt).toLocaleString()} · live {runtimeReleaseSelectionQuery.data.ownerLive ? "yes" : "no"}
                          </div>
                        )}
                        {runtimeReleaseSelectionQuery.data.currentRelease ? (
                          <div className="break-all text-muted-foreground">
                            This worker: {runtimeReleaseSelectionQuery.data.currentRelease.artifactSha} · deployment {runtimeReleaseSelectionQuery.data.currentRelease.deploymentIdentity}
                            {runtimeReleaseSelectionQuery.data.currentReleaseSelected ? " (selected)" : " (not selected)"}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">This process has no verified runtime release identity.</div>
                        )}
                        {runtimeReleaseSelectionQuery.data.selectedRelease ? (
                          <div className="break-all text-muted-foreground">
                            Selected: {runtimeReleaseSelectionQuery.data.selectedRelease.artifactSha} · deployment {runtimeReleaseSelectionQuery.data.selectedRelease.deploymentIdentity}
                            {" · "}selection version {runtimeReleaseSelectionQuery.data.selectedRelease.selectionVersion}
                            {" · "}audited event {runtimeReleaseSelectionQuery.data.selectedRelease.selectionEventId}
                            {" · "}publisher evidence{" "}
                            {/^https:\/\//i.test(runtimeReleaseSelectionQuery.data.selectedRelease.verificationReference) ? (
                              <a
                                className="underline"
                                href={runtimeReleaseSelectionQuery.data.selectedRelease.verificationReference}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {runtimeReleaseSelectionQuery.data.selectedRelease.verificationReference}
                              </a>
                            ) : runtimeReleaseSelectionQuery.data.selectedRelease.verificationReference}
                            {" · "}selected by {runtimeReleaseSelectionQuery.data.selectedRelease.selectedBy}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">No published release selection is recorded; scheduled SFP work is held.</div>
                        )}
                        {runtimeReleaseSelectionQuery.data.currentRelease &&
                          !runtimeReleaseSelectionQuery.data.currentReleaseSelected && (
                            <div className="mt-2 space-y-2 border-t pt-2">
                              <div className="font-medium">
                                {runtimeReleaseSelectionQuery.data.selectedRelease
                                  ? `Transfer selection from version ${runtimeReleaseSelectionQuery.data.selectedRelease.selectionVersion} using compare-and-set.`
                                  : "Bootstrap the first published-release selection."}
                              </div>
                              <div className="text-muted-foreground">
                                Enter publisher-verified values from the live deployment record and its HTTPS evidence URL. The service checks the values against this worker’s release/deployment identity; do not use its displayed RELEASE_SHA alone as proof. The selection is audited and does not change paid-provider permissions, outreach, or global outbound state.
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="space-y-1">
                                  <span className="block font-medium">Publisher-verified artifact SHA</span>
                                  <input
                                    aria-label="Publisher-verified artifact SHA"
                                    autoComplete="off"
                                    maxLength={40}
                                    value={publisherVerifiedArtifactSha}
                                    onChange={(event) => setPublisherVerifiedArtifactSha(event.target.value)}
                                    className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs"
                                  />
                                </label>
                                <label className="space-y-1">
                                  <span className="block font-medium">Publisher-verified deployment identity</span>
                                  <input
                                    aria-label="Publisher-verified deployment identity"
                                    autoComplete="off"
                                    maxLength={240}
                                    value={publisherVerifiedDeploymentIdentity}
                                    onChange={(event) => setPublisherVerifiedDeploymentIdentity(event.target.value)}
                                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                                  />
                                </label>
                                <label className="space-y-1 sm:col-span-2">
                                  <span className="block font-medium">HTTPS publisher verification evidence URL</span>
                                  <input
                                    aria-label="HTTPS publisher verification evidence URL"
                                    type="url"
                                    autoComplete="url"
                                    maxLength={500}
                                    value={runtimeVerificationReference}
                                    onChange={(event) => setRuntimeVerificationReference(event.target.value)}
                                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                                  />
                                </label>
                              </div>
                              <label className="flex items-start gap-2 text-muted-foreground">
                                <input
                                  aria-label="Confirm independently verified published release evidence"
                                  type="checkbox"
                                  checked={runtimePublisherEvidenceConfirmed}
                                  onChange={(event) => setRuntimePublisherEvidenceConfirmed(event.target.checked)}
                                  className="mt-0.5"
                                />
                                <span>I independently verified these SHA/deployment values against the publisher evidence above.</span>
                              </label>
                              <Button
                                size="sm"
                                disabled={
                                  selectRuntimeReleaseMutation.isPending ||
                                  !/^[0-9a-f]{40}$/i.test(publisherVerifiedArtifactSha.trim()) ||
                                  !publisherVerifiedDeploymentIdentity.trim() ||
                                  !/^https:\/\/\S+$/i.test(runtimeVerificationReference.trim()) ||
                                  !runtimePublisherEvidenceConfirmed
                                }
                                onClick={() => selectRuntimeReleaseMutation.mutate()}
                              >
                                {selectRuntimeReleaseMutation.isPending
                                  ? "Recording audited selection…"
                                  : runtimeReleaseSelectionQuery.data.selectedRelease
                                    ? "Transfer selection to this published release"
                                    : "Bootstrap current published release selection"}
                              </Button>
                            </div>
                          )}
                        {runtimeReleaseSelectionQuery.data.currentReleaseSelected && (
                          <div className="text-muted-foreground">
                            This release is selected. Owner lease state is shown above; heartbeat/consumer acquisition is separate from release selection.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-destructive">
                        Runtime selection status unavailable; do not infer readiness.
                        {runtimeReleaseSelectionQuery.error instanceof Error ? ` ${runtimeReleaseSelectionQuery.error.message}` : ""}
                      </div>
                    )}
                  </div>
                )}
                {stagingTelemetryQuery.isLoading ? (
                  <span className="text-muted-foreground">Loading worker telemetry…</span>
                ) : stagingTelemetryQuery.data ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span className={stagingTelemetryQuery.data.effectiveEnablement ? "text-amber-700" : "text-muted-foreground"}>
                        {stagingTelemetryQuery.data.effectiveEnablement ? "Recurring worker enabled" : "Recurring worker disabled"}
                      </span>
                      <span className="text-muted-foreground">
                        (capability {stagingTelemetryQuery.data.capability.active ? "running" : "not running"}
                        {stagingTelemetryQuery.data.program ? `, batch=${stagingTelemetryQuery.data.program.campaignStagingBatchSize}` : ", no program"})
                      </span>
                    </div>
                    <div className={`text-xs font-medium ${stagingTelemetryQuery.data.outbound.globalPaused ? "text-green-700" : "text-destructive"}`}>
                      Global outbound: {stagingTelemetryQuery.data.outbound.globalState.toUpperCase()}
                      {" · "}epoch {stagingTelemetryQuery.data.outbound.pauseEpoch}
                      {" · "}source {stagingTelemetryQuery.data.outbound.stateSource}
                    </div>
                    <div className={`text-xs ${stagingTelemetryQuery.data.packageControls.ok ? "text-green-700" : "text-destructive"}`}>
                      Current v2 package controls: {stagingTelemetryQuery.data.packageControls.ok ? "draft campaigns + paused sequences verified" : "not ready"}
                    </div>
                    {!stagingTelemetryQuery.data.packageControls.ok && (
                      <ul className="list-disc pl-5 text-xs text-destructive">
                        {stagingTelemetryQuery.data.packageControls.issues.map((issue) => <li key={issue}>{issue}</li>)}
                      </ul>
                    )}
                    {user?.role === "admin" && (
                      <div className="flex flex-wrap items-end gap-2 rounded border p-2">
                        <label className="space-y-1 text-xs">
                          <span className="block font-medium">Campaign staging batch (1–25, configured capacity)</span>
                          <input
                            aria-label="Campaign staging batch size"
                            type="number"
                            min={1}
                            max={25}
                            step={1}
                            value={stagingBatchDraft}
                            onChange={(event) => setStagingBatchDraft(event.target.value)}
                            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
                          />
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={stagingScheduleMutation.isPending || !program?.isActive || !Number.isInteger(Number(stagingBatchDraft)) || Number(stagingBatchDraft) < 1 || Number(stagingBatchDraft) > 25}
                          onClick={() => stagingScheduleMutation.mutate({
                            recurringEnabled: program?.recurringEnabled === true,
                            batchSize: Number(stagingBatchDraft),
                          })}
                        >
                          {stagingScheduleMutation.isPending ? "Saving…" : "Save bounded schedule"}
                        </Button>
                        {program?.recurringEnabled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={stagingScheduleMutation.isPending}
                            onClick={() => stagingScheduleMutation.mutate({
                              recurringEnabled: false,
                              batchSize: Math.min(25, Math.max(1, Number(program.campaignStagingBatchSize) || Number(stagingBatchDraft) || 1)),
                            })}
                          >
                            Pause recurrence
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={
                              stagingScheduleMutation.isPending || !program?.isActive ||
                              !stagingTelemetryQuery.data.packageControls.ok ||
                              runtimeReleaseSelectionQuery.data?.ready !== true
                            }
                            onClick={() => stagingScheduleMutation.mutate({
                              recurringEnabled: true,
                              batchSize: Number(stagingBatchDraft),
                            })}
                          >
                            Enable recurrence
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                      <span>Backlog (fresh): {stagingTelemetryQuery.data.backlog.freshAwaitingStaging}</span>
                      <span>Backlog (total): {stagingTelemetryQuery.data.backlog.eligibleAwaitingStaging}</span>
                      <span>Configured stage batch: {stagingTelemetryQuery.data.backlog.configuredBatchSize}</span>
                      <span className="col-span-2">{stagingTelemetryQuery.data.backlog.meaning}</span>
                      <span>Completed (24h): {stagingTelemetryQuery.data.throughput.completedLast24h}</span>
                      <span>Retrying: {stagingTelemetryQuery.data.retries.currentlyRetrying}</span>
                      <span>Stale leases: {stagingTelemetryQuery.data.retries.staleLeases}</span>
                      <span className={stagingTelemetryQuery.data.deadLetters.total > 0 ? "text-destructive" : ""}>
                        Dead letters: {stagingTelemetryQuery.data.deadLetters.total}
                      </span>
                    </div>
                    <div className="rounded border p-2">
                      <div className="font-medium text-foreground">Ready-held → paused enrollment consumer</div>
                      <div className="grid grid-cols-2 gap-x-3 text-muted-foreground">
                        <span>Ready-held not yet queued: {stagingTelemetryQuery.data.readyHeldConsumer.unqueuedReadyHeld}</span>
                        <span>Pending / claimed: {stagingTelemetryQuery.data.readyHeldConsumer.pending} / {stagingTelemetryQuery.data.readyHeldConsumer.claimed}</span>
                        <span>Stale claims: {stagingTelemetryQuery.data.readyHeldConsumer.staleClaims}</span>
                        <span>Retrying / held: {stagingTelemetryQuery.data.readyHeldConsumer.retrying} / {stagingTelemetryQuery.data.readyHeldConsumer.held}</span>
                        <span>Completed / dead-letter: {stagingTelemetryQuery.data.readyHeldConsumer.completed} / {stagingTelemetryQuery.data.readyHeldConsumer.deadLettered}</span>
                        <span>Completed last 24h: {stagingTelemetryQuery.data.readyHeldConsumer.completedLast24h}</span>
                        <span>Last progress: {stagingTelemetryQuery.data.readyHeldConsumer.lastProgressAt ? new Date(stagingTelemetryQuery.data.readyHeldConsumer.lastProgressAt).toLocaleString() : "none recorded"}</span>
                      </div>
                      {user?.role === "admin" && (
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={
                            readyHeldConsumerMutation.isPending || !program?.isActive ||
                            !stagingTelemetryQuery.data.outbound.globalPaused ||
                            !stagingTelemetryQuery.data.packageControls.ok ||
                            runtimeReleaseSelectionQuery.data?.ready !== true
                          }
                          onClick={() => readyHeldConsumerMutation.mutate()}
                        >
                          {readyHeldConsumerMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                          Process up to 25 ready-held intents (paused only)
                        </Button>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Durable per-intent claims/leases/retries; blocked items stay held. No activation or sends.
                      </p>
                      {stagingTelemetryQuery.data.readyHeldConsumer.heldSample.length > 0 && (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          <div className="text-xs font-medium">Recent held consumer items</div>
                          {stagingTelemetryQuery.data.readyHeldConsumer.heldSample.map((item) => (
                            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate">
                                biz#{item.businessId} · {item.state} · {item.reason ?? "reason unavailable"} · {item.attemptCount} attempts
                                {item.packageKey ? ` · ${item.packageKey}` : ""}
                              </span>
                              {user?.role === "admin" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={retryReadyHeldConsumerItem.isPending}
                                  onClick={() => retryReadyHeldConsumerItem.mutate(item.id)}
                                >
                                  Retry after review
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {stagingTelemetryQuery.data.lastRun && (
                      <div className="text-muted-foreground">
                        Last run: {stagingTelemetryQuery.data.lastRun.state}
                        {" "}({stagingTelemetryQuery.data.lastRun.succeeded}/{stagingTelemetryQuery.data.lastRun.selected} succeeded)
                        {stagingTelemetryQuery.data.lastRun.completedAt ? ` at ${new Date(stagingTelemetryQuery.data.lastRun.completedAt).toLocaleString()}` : ""}
                      </div>
                    )}
                    {stagingTelemetryQuery.data.currentlyRunning && (
                      <div className="text-blue-700">
                        Currently running (lease expires {stagingTelemetryQuery.data.currentlyRunning.leaseExpiresAt ? new Date(stagingTelemetryQuery.data.currentlyRunning.leaseExpiresAt).toLocaleTimeString() : "—"})
                        {stagingTelemetryQuery.data.cancellableRun?.id !== stagingTelemetryQuery.data.currentlyRunning.id && " — actively leased, not cancellable"}
                      </div>
                    )}
                    {/* Corrective-patch: truthful worker/queue health — never
                        assume the recurring tick is scheduled just because
                        the program flags are on. */}
                    <div className={stagingTelemetryQuery.data.workerHealth?.queueManagerReady && stagingTelemetryQuery.data.workerHealth?.repeatableJobRegistered ? "text-muted-foreground" : "text-destructive"}>
                      Queue: {stagingTelemetryQuery.data.workerHealth?.queueManagerReady ? "manager ready" : "manager NOT ready"}
                      {", "}
                      {stagingTelemetryQuery.data.workerHealth?.repeatableJobRegistered ? "recurring tick registered" : "recurring tick NOT registered"}
                      {stagingTelemetryQuery.data.workerHealth?.nextRunEstimateAt
                        ? ` — next run ~${new Date(stagingTelemetryQuery.data.workerHealth.nextRunEstimateAt).toLocaleTimeString()}`
                        : ""}
                    </div>
                    {stagingTelemetryQuery.data.backlog.freshAwaitingStaging > 0 && stagingTelemetryQuery.data.program?.campaignStagingBatchSize && (
                      <div className="text-muted-foreground">
                        Backlog ETA: ~{Math.ceil(stagingTelemetryQuery.data.backlog.freshAwaitingStaging / stagingTelemetryQuery.data.program.campaignStagingBatchSize)} tick(s)
                      </div>
                    )}
                    <div className="text-muted-foreground">Cost: not applicable (staging only)</div>
                    {stagingTelemetryQuery.data.deadLetters.sample.length > 0 && (
                      <div className="space-y-1 pt-1 border-t">
                        <div className="font-medium text-destructive">Dead-lettered items</div>
                        {stagingTelemetryQuery.data.deadLetters.sample.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">biz#{item.businessId} — {item.outcomeCode ?? "unknown"} ({item.attemptCount} attempts)</span>
                            <Button
                              size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                              disabled={retryStageItem.isPending}
                              onClick={() => retryStageItem.mutate(item.id)}
                            >
                              Retry
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {stagingTelemetryQuery.data.cancellableRun && (
                      <div className="pt-1">
                        <Button
                          size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                          disabled={cancelStageRun.isPending}
                          onClick={() => cancelStageRun.mutate(stagingTelemetryQuery.data!.cancellableRun!.id)}
                        >
                          Cancel run ({stagingTelemetryQuery.data.cancellableRun.state})
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Worker telemetry unavailable.</span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Staging is idempotent. All re-verification gates run at execution time.
              No email is sent or GHL write occurs. The ready-held bridge may create only a paused local enrollment; campaigns remain draft and outbound stays paused.
            </p>
            {stagingResult && Object.keys(stagingResult.reasons ?? {}).length > 0 && (
              <div className="flex flex-wrap gap-1 text-xs">
                {Object.entries(stagingResult.reasons).map(([reason, cnt]) => (
                  <Badge
                    key={reason}
                    variant={reason === "paid_source_task2001_blocked" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {reason === "paid_source_task2001_blocked"
                      ? `Task 2001 staging blocked (paid source): ${cnt}`
                      : `${reason.replace(/_/g, " ")}: ${cnt}`}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
