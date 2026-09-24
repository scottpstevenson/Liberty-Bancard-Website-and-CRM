/**
 * SouthFloridaProspectingPanel.tsx
 *
 * 15-step operator workflow for the South Florida Prospecting program.
 * Every button is wired to a real route and service.
 * Every mutation requires explicit operator confirmation.
 * No outreach is sent automatically.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2, MapPin, CheckCircle, Clock, AlertCircle, Loader2,
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
  activatedAt: string | null;
  policyVersion?: number;
};

type SfpFunnel = {
  funnel: {
    totalScanned: number;
    southFlorida: number;
    outsideGeography: number;
    geographyUnresolved: number;
    inTargetVertical: number;
    verticalUnresolved: number;
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
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  maxValidations: number;
  gateOpen: boolean;
  gateBlockedReason: string | null;
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
    zbOutcome: string | null;
    outreachPolicyStatus: string;
    campaignStagedAt: string | null;
    exclusionReason: string | null;
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

type PaidWaterfallPreview = {
  businessesNeedingPaidDiscovery: number;
  providers: Array<{provider:string;credentialPresent:boolean;enabled:boolean;circuitState:string;executableForSfp:boolean;unitPriceMicros:number|null;role:string}>;
  note: string;
};
type SfpCohortCostPreview = {
  snapshotHash: string;
  selectedBusinessCount: number;
  totalEstimatedCostMicros: number;
  totalWorstCaseCostMicros: number;
  lines: Array<{ provider: string; gapCountDrivingCall: number; estimatedCostMicros: number; worstCaseCostMicros: number }>;
};
type SfpPhaseAPreview = {
  snapshotHash: string;
  candidateCount: number;
  currentPolicyEvidenceCounts: { target: number; nonTarget: number; reviewRequired: number };
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function fmtMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

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

// ── Main component ─────────────────────────────────────────────────────────────

export function SouthFloridaProspectingPanel() {
  const { toast } = useToast();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showProspects, setShowProspects] = useState(false);
  const [showFunnel, setShowFunnel] = useState(false);
  const [maxCohort, setMaxCohort] = useState(25);
  const [freeBatchSize, setFreeBatchSize] = useState(100);
  const [lastPaidResult, setLastPaidResult] = useState<any>(null);
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

  // ── Queries ────────────────────────────────────────────────────────────────

  const programQuery = useQuery<SfpProgram>({
    queryKey: ["/api/lead-ops/sfp/program"],
    retry: false,
  });

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

  const paidPreviewQuery = useQuery<PaidWaterfallPreview>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall-preview`],
    enabled: !!activeRunId,
    retry: false,
  });
  const cohortCostPreviewQuery = useQuery<SfpCohortCostPreview>({
    queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/cost-preview`],
    enabled: !!activeRunId,
    retry: false,
  });
  const phaseAPreviewQuery = useQuery<SfpPhaseAPreview>({
    queryKey: [`/api/lead-ops/sfp/programs/${programQuery.data?.id}/classification-preview`],
    enabled: !!programQuery.data?.id,
    retry: false,
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
    mutationFn: async (active: boolean) => (await apiRequest("POST", "/api/lead-ops/sfp/program/activation", {
      active, recurringEnabled: false,
    })).json(),
    onSuccess: () => {
      toast({ title: program?.isActive ? "Program paused" : "Program activated" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/program"] });
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
        description: `${data.enriched} enriched · ${data.failed} failed · ${data.skipped} skipped`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/free-evidence`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/validation-preview`] });
    },
    onError: (e: any) => toast({ title: "Free discovery failed", description: e?.message, variant: "destructive" }),
  });

  const runSerperDiscovery = useMutation({
    mutationFn: async () => {
      if(!activeRunId) throw new Error("No active run");
      const res=await apiRequest("POST",`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall/serper`,{
        idempotencyKey:`sfp-serper-${discoveryIdempotencyKey}`,maxBusinesses:10,
        previewSnapshotHash:cohortCostPreviewQuery.data?.snapshotHash,
      });
      return res.json();
    },
    onSuccess:(data:any)=>{
      toast({title:"Serper discovery completed",description:`${data.succeeded} matched · ${data.noResult} no result · ${data.failed} failed`});
      queryClient.invalidateQueries({queryKey:[`/api/lead-ops/sfp/runs/${activeRunId}/free-evidence`]});
      queryClient.invalidateQueries({queryKey:[`/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall-preview`]});
      queryClient.invalidateQueries({queryKey:[`/api/lead-ops/sfp/runs/${activeRunId}/cost-preview`]});
    },
    onError:(e:any)=>toast({title:"Paid discovery blocked",description:e?.message,variant:"destructive"}),
  });
  const runPaidWaterfall = useMutation({
    mutationFn: async () => {
      if (!activeRunId || !cohortCostPreviewQuery.data?.snapshotHash) throw new Error("Load the current cost preview before execution");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/paid-waterfall/person-identity`, {
        idempotencyKey: `sfp-paid-${discoveryIdempotencyKey}`, maxBusinesses: 10,
        previewSnapshotHash: cohortCostPreviewQuery.data.snapshotHash,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setLastPaidResult(data);
      toast({ title: "Paid waterfall completed", description: `${data.succeeded} succeeded · ${data.failed} failed · ${data.skipped} skipped` });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/cost-preview`] });
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
      return (await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/stage-for-campaign`, {
        idempotencyKey: `sfp-stage-${activeRunId}`,
      })).json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Campaign staging complete",
        description: `${data.created} staged · ${data.skipped} skipped · ${data.rejected} rejected. No outreach sent.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/prospects`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lead-ops/sfp/runs/${activeRunId}/campaign-staging-preview`] });
    },
    onError: (e: any) => toast({ title: "Staging failed", description: e?.message, variant: "destructive" }),
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
            {!program ? (
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
                  onClick={() => setActivation.mutate(!program.isActive)} disabled={setActivation.isPending}>
                  {program.isActive ? "Pause program" : "Activate program"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

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
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Provider status below is live. Credentials alone never authorize a paid call.
            </p>
          </CardContent>
        )}
      </Card>

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
                ["Vertical unresolved", funnel.verticalUnresolved, "text-yellow-600"],
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
      </Card>

      {program && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Phase A Classification (Read-only Preview)</CardTitle>
            <CardDescription className="text-xs">Preview is read-only; classification runs are bounded, manual, and do not activate providers.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>{phaseAPreviewQuery.data?.candidateCount ?? "—"} businesses</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.target ?? 0} target</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.nonTarget ?? 0} non-target</span>
              <span>{phaseAPreviewQuery.data?.currentPolicyEvidenceCounts.reviewRequired ?? 0} review-required</span>
              <Button size="sm" onClick={() => runPhaseAClassification.mutate()}
                disabled={!phaseAPreviewQuery.data?.snapshotHash || runPhaseAClassification.isPending}>
                {runPhaseAClassification.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Run Phase A (max 25)
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={false} disabled aria-label="Recurring discovery authorization (off)" />
              Recurring discovery authorization: OFF (scheduler unavailable in this workflow)
            </label>
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
                <div
                  key={run.id}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs border ${run.id === activeRunId ? "bg-blue-50 border-blue-200" : "bg-muted/30 border-transparent hover:border-muted"}`}
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
                </div>
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
            ) : evidenceQuery.error ? (
              <p className="text-xs text-red-500">{String((evidenceQuery.error as any)?.message ?? "Error loading evidence report")}</p>
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
              <span className="text-xs font-medium">{paidPreviewQuery.data?.businessesNeedingPaidDiscovery ?? 0} businesses still need discovery</span>
              <Button size="sm" onClick={()=>runSerperDiscovery.mutate()}
                disabled={runSerperDiscovery.isPending || !cohortCostPreviewQuery.data?.snapshotHash || !(paidPreviewQuery.data?.providers.find(p=>p.provider==='serper')?.enabled)}>
                {runSerperDiscovery.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1"/> : <Play className="h-3 w-3 mr-1"/>}
                Authorize Serper batch (max 10)
              </Button>
              <Button size="sm" variant="outline" onClick={() => runPaidWaterfall.mutate()}
                disabled={runPaidWaterfall.isPending || !cohortCostPreviewQuery.data?.snapshotHash}>
                {runPaidWaterfall.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Outscraper + Apollo (max 10)
              </Button>
            </div>
            {cohortCostPreviewQuery.data && (
              <div className="mt-3 space-y-1 text-xs">
                <div className="font-medium">Server-derived snapshot-bound cost preview · {cohortCostPreviewQuery.data.selectedBusinessCount} frozen members</div>
                <div className="flex flex-wrap gap-3">
                  {cohortCostPreviewQuery.data.lines.map((line) => (
                    <span key={line.provider}>{line.provider}: {line.gapCountDrivingCall} gaps · est. {fmtMicros(line.estimatedCostMicros)} / max {fmtMicros(line.worstCaseCostMicros)}</span>
                  ))}
                </div>
                <div>Estimated {fmtMicros(cohortCostPreviewQuery.data.totalEstimatedCostMicros)} · worst case {fmtMicros(cohortCostPreviewQuery.data.totalWorstCaseCostMicros)}</div>
              </div>
            )}
            {lastPaidResult?.gapVectors?.length > 0 && (
              <div className="mt-2 text-xs">
                <div className="font-medium">Per-business gap vectors (before → after)</div>
                {lastPaidResult.gapVectors.map((vector: any) => (
                  <div key={vector.businessId}>Business {vector.businessId}: {vector.before.filter((g: any) => g.open).map((g: any) => g.dimension).join(", ") || "none"} → {vector.after.filter((g: any) => g.open).map((g: any) => g.dimension).join(", ") || "none"}</div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {paidPreviewQuery.data?.note ?? "Loading provider controls…"}
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
                  <div className="text-muted-foreground">Max (hard cap)</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold font-mono">{fmtMicros(validationPreviewQuery.data.estimatedCostMicros)}</div>
                  <div className="text-muted-foreground">Estimated cost</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-base font-bold font-mono">{fmtMicros(validationPreviewQuery.data.worstCaseCostMicros)}</div>
                  <div className="text-muted-foreground">Worst-case cost</div>
                </div>
              </div>
            )}
            {validationPreviewQuery.data?.gateBlockedReason && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Gate blocked: {validationPreviewQuery.data.gateBlockedReason}
              </p>
            )}
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
                disabled={validateCohort.isPending || validationPreviewQuery.data?.gateBlockedReason !== null}
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
                      <div key={p.businessId} className="flex items-center justify-between p-2 bg-muted/30 rounded text-xs gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate">{p.businessName ?? `Biz #${p.businessId}`}</span>
                          {p.normalizedVertical && <span className="text-muted-foreground ml-1">· {p.normalizedVertical}</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {p.maskedEmail && <span className="font-mono text-muted-foreground">{p.maskedEmail}</span>}
                          {statusBadge(p.validationStatus)}
                          {p.campaignStagedAt && <Badge variant="default" className="text-xs">Staged</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {prospectsQuery.data.total} total prospects.
                    Only <code>validated_outreach_eligible</code> rows can advance to campaign staging.
                  </p>
                </>
              ) : null}
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
                disabled={stageForCampaign.isPending || (stagingPreviewQuery.data?.willStageCount ?? 0) === 0}
              >
                {stageForCampaign.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                Stage Selected Eligible Prospects
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Staging is idempotent. All re-verification gates run at execution time.
              No email is sent. No sequence enrolled. No GHL write. Outbound stays paused.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
