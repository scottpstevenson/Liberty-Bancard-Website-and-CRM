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
// randomUUID not needed — using Date.now() for idempotency keys

// ── Types ──────────────────────────────────────────────────────────────────────

type SfpProgram = {
  id: string;
  name: string;
  countyFips: string[];
  verticalIds: string[];
  maxCohortSize: number;
  isActive: boolean;
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
  cohortSize: number;
  cohortHash: string | null;
  frozenAt: string | null;
  actorId: string;
  createdAt: string;
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

  // ── Mutations ──────────────────────────────────────────────────────────────

  const ensureProgram = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-ops/sfp/program/ensure"),
    onSuccess: () => {
      toast({ title: "South Florida Prospecting program initialized" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/program"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const freezeCohort = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-ops/sfp/runs/freeze", {
      idempotencyKey: `sfp-freeze-${Date.now()}`,
      maxCohortSize: maxCohort,
    }),
    onSuccess: (data: any) => {
      toast({ title: "Cohort frozen", description: `${data?.run?.cohortSize ?? 0} businesses selected` });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sfp/runs"] });
      if (data?.run?.id) setActiveRunId(data.run.id);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Unknown error";
      toast({ title: "Cohort freeze failed", description: msg, variant: "destructive" });
    },
  });

  const validateCohort = useMutation<SfpValidationResult>({
    mutationFn: async () => {
      if (!activeRunId) throw new Error("No active run");
      const res = await apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/validate`, {
        idempotencyKey: `sfp-validate-${activeRunId}`,
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

  const stageForCampaign = useMutation({
    mutationFn: () => {
      if (!activeRunId) throw new Error("No active run");
      return apiRequest("POST", `/api/lead-ops/sfp/runs/${activeRunId}/stage-for-campaign`, {
        idempotencyKey: `sfp-stage-${activeRunId}`,
      });
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
              <Badge variant="outline" className="text-xs">
                {program.verticalIds.length} verticals · {program.countyFips.length} counties
              </Badge>
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
              All paid providers are OFF. Operator must explicitly activate each provider after publish.
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
              type="number" min={1} max={500} value={maxCohort}
              onChange={(e) => setMaxCohort(Math.max(1, Math.min(500, Number(e.target.value))))}
              className="border rounded px-2 py-1 text-xs w-20"
            />
          </div>
          <Button
            size="sm"
            onClick={() => freezeCohort.mutate()}
            disabled={!program || freezeCohort.isPending}
          >
            {freezeCohort.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Target className="h-3 w-3 mr-1" />}
            Freeze Deterministic Cohort (top {maxCohort} by ROI score)
          </Button>
          <p className="text-xs text-muted-foreground">
            Idempotent — re-running with the same key returns the existing frozen cohort.
            ROI scores all eligible businesses globally before selecting the top {maxCohort}.
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
                    {statusBadge(run.status)}
                    <span className="font-mono text-muted-foreground">{run.id.slice(0, 8)}…</span>
                    <span>{run.cohortSize} businesses</span>
                    {run.frozenAt && <span className="text-muted-foreground">{new Date(run.frozenAt).toLocaleDateString()}</span>}
                  </div>
                  {run.id === activeRunId && <Badge variant="outline">Active</Badge>}
                </div>
              ))}
            </div>
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
                  Run the free enrichment worker (no cost) to discover more.
                </p>
              </div>
            ) : evidenceQuery.error ? (
              <p className="text-xs text-red-500">{String((evidenceQuery.error as any)?.message ?? "Error loading evidence report")}</p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Steps 7-8: Paid escalation placeholder */}
      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">7–8</span>
              Paid Provider Escalation
              <Badge variant="secondary" className="text-xs">Providers OFF</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Serper → Outscraper → Apollo → OpenAI waterfall.
              All paid providers are disabled by default.
              Activate each in Provider Controls after publish, then authorize a bounded run.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                { name: "Serper", desc: "Domain / email discovery" },
                { name: "Outscraper", desc: "Business identity / location" },
                { name: "Apollo", desc: "Named decision-maker" },
                { name: "OpenAI", desc: "Classification / scoring" },
              ].map((p) => (
                <div key={p.name} className="border rounded p-2 opacity-60">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-muted-foreground">{p.desc}</div>
                  <Badge variant="outline" className="text-xs mt-1">Off</Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Provider admission, pricing, budget reservation, circuit breaker, and audit telemetry
              are all enforced via the canonical provider-control system before any paid call.
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
