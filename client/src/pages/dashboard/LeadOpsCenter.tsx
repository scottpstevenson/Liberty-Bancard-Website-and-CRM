import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, parseApiRequestError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles, RefreshCw, Trash2, Search, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle, Clock, Zap, Users, Mail, Phone,
  TrendingUp, Brain, Target, ArrowRight, Download, Activity,
  X, ShieldAlert, Cpu, RotateCcw, ListTodo, XCircle, RotateCw,
  Building2, GitBranch, BarChart3, Layers, HeartPulse, MapPin,
  ArrowRightLeft, Loader2, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SouthFloridaQualificationPanel } from "@/components/lead-ops/SouthFloridaQualificationPanel";
import { SouthFloridaProspectingPanel } from "@/components/lead-ops/SouthFloridaProspectingPanel";
import { SourceRegistryPanel } from "@/pages/dashboard/SourceRegistryPanel";
import { ProgramHealthPanel } from "@/pages/dashboard/LeadOps/ProgramHealthPanel";
import { BusinessDetailPanel } from "@/pages/dashboard/LeadOps/BusinessDetailPanel";
import { MobileBusinessCard, type BusinessListItem } from "@/pages/dashboard/LeadOps/MobileBusinessCard";
import { BudgetPreviewModal, useBudgetPreview } from "@/pages/dashboard/LeadOps/BudgetPreviewModal";
import MasterLeadDatabase, { PipelineReviewTab } from "@/pages/dashboard/MasterLeadDatabase";
import Prospects from "@/pages/dashboard/Prospects";
import LeadImports from "@/pages/dashboard/LeadImports";
import LeadIntelligence from "@/pages/dashboard/LeadIntelligence";
import DataQuality from "@/pages/dashboard/DataQuality";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeadOpsStats {
  total: number;
  processing_completed: number;
  pending_processing: number;
  processing: number;
  failed: number;
  hot: number; warm: number; cold: number;
  current_email_inventory: number;
  current_phone_inventory: number;
  contactable: number;
  has_owner_name: number;
  verticals: Array<{ vertical: string; count: number; hot_count: number }>;
}

interface LeadOpsHealth {
  enrichedToday: HealthMetric;
  emailsToday: HealthMetric;
  phonesToday: HealthMetric;
  queueDepth: HealthMetric;
  totalEnriched: HealthMetric;
  totalFailed: HealthMetric;
  successRate: HealthMetric;
  lastEnrichedAt: string | null;
  minutesSinceLastJob: number | null;
  workerActive: boolean;
  // Worker-authority truth fields (MI-01)
  intakeAuthority: "scheduled-sunbiz-pipeline" | "legacy-outreach-cycle" | "both" | "none";
  enrichmentProgressStatus: "idle" | "running" | "interrupted" | "failed";
  sunbizEnrichmentEnabled: boolean;
  freeEnrichmentPendingJobs: number;
  lastScheduledEnrichmentAt: string | null;
  legacyRouteAttemptsSinceStartup: number;
  canonicalFreeEnrichmentQueueDepth?: number;
  sourceRegistryCounts?: {
    canonicalBusinesses: HealthMetric;
    sourceLinks: HealthMetric;
    adapters: HealthMetric;
  };
}

interface HealthMetric {
  value: number | string | null;
  available: boolean;
  stale?: boolean;
  error?: string;
}

interface LeadOpsConfig {
  serperConfigured: boolean;
  openaiConfigured: boolean;
}

interface LeadEntity {
  id: number; entity_name: string; principal_city: string; principal_state: string;
  vertical: string | null; score: string | null; enrichment_status: string;
  enriched_at: string | null; owner_name: string | null;
  owner_email: string | null; owner_phone: string | null;
  email: string | null; phone: string | null; website: string | null;
  prospect_id: number | null; ai_summary: string | null; tags: string[] | null;
}

interface AiSegment {
  name: string; vertical: string; score: string; estimatedCount: number;
  channel: string; angle: string; priority: number;
}

interface AiAnalysis {
  summary: string;
  segments: AiSegment[];
  recommendations: string[];
  outreachPriority: Array<{ vertical: string; estimatedCloseRate: string; whyNow: string }>;
  quickWins: string[];
  pool: any;
  verticals: any[];
}

interface InboundRequest {
  requestReceipt: string;
  sourceClass: string;
  sourceCategory: string;
  sourceType: string;
  lifecycleState: string;
  effects: Array<{
    effectKey: string;
    effectType: string;
    state: string;
    required: boolean;
    externalSideEffect: boolean;
    terminalReason: string | null;
  }>;
  assignmentStatus: string;
  assignmentReason?: string | null;
  assignedTo: string | null;
  slaDueAt: string | null;
  contactId: number | null;
  dealId: number | null;
  ticketId: number | null;
  createdAt: string;
  terminalReason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreBadge(score: string | null) {
  if (score === "hot")  return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (score === "warm") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300";
  if (score === "cold") return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300";
}

function statusBadge(status: string) {
  if (status === "enriched")   return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "pending")    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (status === "processing") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "failed")     return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function inboundStatusBadge(status: string | null | undefined) {
  if (status === "accepted" || status === "completed" || status === "sent" || status === "assigned") return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "failed" || status === "cancelled" || status === "suppressed" || status === "unassigned_policy_missing") return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (status === "review_required" || status === "pending" || status === "held") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
}

function formatInboundDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

// ─── MI-04: Canonical Business Free Enrichment Panel ─────────────────────────

interface CanonicalBusiness {
  id: number;
  canonical_name: string | null;
  website_domain: string | null;
  city: string | null;
  state: string | null;
  vertical: string | null;
  free_enrichment_status: string | null;
  free_enrichment_attempt_count: number;
  free_enrichment_last_attempt_at: string | null;
  free_enrichment_completed_at: string | null;
  free_enrichment_evidence: Record<string, unknown> | null;
  // MI-06: email discovery pipeline
  email_discovery_status: string | null;
  email_validation_updated_at: string | null;
  email_selected_candidate_hash: string | null;
  email_outreach_catch_all_approved_at: string | null;
  email_outreach_approved_by: string | null;
  main_email: string | null;
}

interface WinnerSelection {
  id: string;
  source: string;
  subject_type: string;
  confidence: number;
  state: string;
  normalized_value_hash: string;
  masked_value: string | null;
}

interface BusinessPendingIntent {
  id: string;
  state: string;
  approval_required: boolean;
  apollo_match_confidence: string | null;
  disposition: string | null;
  attempt_count: number;
  created_at: string;
}

type BusinessQueryResponse = {
  business: CanonicalBusiness;
  processorSignals: ProcessorSignal[];
  emailDiscoveryStatus: string | null;
  emailValidationUpdatedAt: string | null;
  isStale: boolean;
  winnerSelection: WinnerSelection | null;
  pendingIntent: BusinessPendingIntent | null;
};

interface ProcessorSignal {
  id: number;
  signal_type: string;
  vendor_name: string;
  detection_method: string;
  confidence_score: number;
  evidence: string | null;
  detected_at: string | null;
}

function freeEnrichStatusBadge(status: string | null) {
  if (!status) return "bg-gray-100 text-gray-600 border-gray-200";
  if (status === "enriched")   return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "processing") return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === "failed")     return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (status === "skipped")    return "bg-gray-100 text-gray-600 border-gray-200";
  return "bg-yellow-100 text-yellow-800 border-yellow-200"; // queued / null
}

// MI-06: email_discovery_status color coding
function emailDiscoveryBadge(status: string | null): string {
  if (!status) return "bg-gray-100 text-gray-600 border-gray-200";
  if (status === "provider_valid")    return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "provider_invalid")  return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (status === "provider_catch_all") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300";
  if (status === "discovered")        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === "no_valid_candidate") return "bg-gray-100 text-gray-600 border-gray-200";
  if (status === "stale")             return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "provider_unknown" || status === "provider_spamtrap") {
    return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300";
  }
  if (status === "dns_indeterminate" || status === "no_mx") {
    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  }
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function CanonicalBusinessPanel({ healthQueueDepth }: { healthQueueDepth: number | null }) {
  const { toast } = useToast();
  const [lookupId, setLookupId] = useState("");
  const [businessId, setBusinessId] = useState<number | null>(null);
  // BudgetPreviewModal: gates billable ZeroBounce intent approval
  const budget = useBudgetPreview();

  const businessQuery = useQuery<BusinessQueryResponse>({
    queryKey: [`/api/lead-ops/businesses/${businessId}`],
    queryFn: async () => {
      const res = await fetch(`/api/lead-ops/businesses/${businessId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: businessId !== null,
  });

  const enrichMutation = useMutation({
    mutationFn: async (id: number) => {
      // Use apiRequest so the CSRF token is attached — raw fetch would return 403
      const res = await apiRequest("POST", `/api/lead-ops/businesses/${id}/enrich-free`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Enrichment queued", description: "Free enrichment job enqueued for this business." });
      businessQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const approveCatchAllMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/lead-ops/businesses/${id}/approve-catch-all`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Catch-all approved", description: "Business approved for outreach. email_discovery_status unchanged." });
      businessQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const approveMediumConfidenceMutation = useMutation({
    mutationFn: async ({ id, intentId }: { id: number; intentId: string }) => {
      const res = await apiRequest("POST", `/api/lead-ops/businesses/${id}/approve-medium-confidence-validation`, { intentId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Medium-confidence approved", description: "Intent enabled for ZeroBounce validation." });
      businessQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const biz = businessQuery.data?.business;
  const signals = businessQuery.data?.processorSignals ?? [];
  const winnerSelection = businessQuery.data?.winnerSelection ?? null;
  const pendingIntent = businessQuery.data?.pendingIntent ?? null;
  const isStale = businessQuery.data?.isStale ?? false;

  const signalTypeLabel = (t: string) => {
    if (t === "processor") return "💳";
    if (t === "pos") return "🖥️";
    if (t === "booking_platform") return "📅";
    if (t === "ecommerce_platform") return "🛒";
    return "📦";
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <CardTitle className="text-base">Canonical Business Enrichment</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Free enrichment pipeline (MI-04) — HTML signals, RDAP, JSON-LD, contact pages.
              {healthQueueDepth !== null && (
                <span className="ml-2 font-medium text-foreground">
                  {healthQueueDepth.toLocaleString()} pending in queue.
                </span>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter business ID…"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            className="h-8 text-sm w-40"
            onKeyDown={(e) => { if (e.key === "Enter") setBusinessId(Number(lookupId) || null); }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setBusinessId(Number(lookupId) || null)}
            disabled={!lookupId || isNaN(Number(lookupId))}
          >
            Look up
          </Button>
        </div>

        {businessQuery.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        )}

        {businessQuery.isError && (
          <p className="text-sm text-destructive">
            {businessQuery.error instanceof Error ? businessQuery.error.message : "Failed to load business"}
          </p>
        )}

        {biz && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/10 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium text-sm">{biz.canonical_name ?? `Business #${biz.id}`}</div>
                  {biz.website_domain && (
                    <a
                      href={`https://${biz.website_domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      {biz.website_domain}
                    </a>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[biz.city, biz.state].filter(Boolean).join(", ")}
                    {biz.vertical && <> · {biz.vertical}</>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 h-5 ${freeEnrichStatusBadge(biz.free_enrichment_status)}`}
                  >
                    {biz.free_enrichment_status ?? "unprocessed"}
                  </Badge>
                  {biz.free_enrichment_completed_at && (
                    <div className="text-[10px] text-muted-foreground">
                      Enriched {new Date(biz.free_enrichment_completed_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Processor/POS/booking/ecommerce signals as tags */}
              {signals.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Detected signals</div>
                  <div className="flex flex-wrap gap-1">
                    {signals.map((s) => (
                      <Badge
                        key={s.id}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-5"
                        title={`${s.detection_method} · confidence ${Math.round(s.confidence_score * 100)}%`}
                      >
                        {signalTypeLabel(s.signal_type)} {s.vendor_name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Email count evidence (not raw emails) */}
              {biz.free_enrichment_evidence && (
                <div className="text-[10px] text-muted-foreground">
                  {typeof (biz.free_enrichment_evidence as any).jsonldEmailCount === "number" && (
                    <span className="mr-3">JSON-LD emails: {(biz.free_enrichment_evidence as any).jsonldEmailCount}</span>
                  )}
                  {typeof (biz.free_enrichment_evidence as any).contactPageEmailCount === "number" && (
                    <span>Contact-page emails: {(biz.free_enrichment_evidence as any).contactPageEmailCount}</span>
                  )}
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 mt-1"
                onClick={() => enrichMutation.mutate(biz.id)}
                disabled={enrichMutation.isPending}
              >
                <RefreshCw className={`h-3 w-3 ${enrichMutation.isPending ? "animate-spin" : ""}`} />
                Enrich now
              </Button>
            </div>

            {/* ── MI-06: Email Discovery Status ──────────────────────────── */}
            <div className="rounded-lg border bg-muted/10 p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email Discovery (MI-06)</div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 h-5 ${emailDiscoveryBadge(biz.email_discovery_status)}`}
                >
                  {biz.email_discovery_status ?? "not started"}
                </Badge>
                {isStale && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-amber-100 text-amber-800 border-amber-200">
                    stale (90d+)
                  </Badge>
                )}
                {biz.email_validation_updated_at && (
                  <span className="text-[10px] text-muted-foreground">
                    Validated {new Date(biz.email_validation_updated_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Winner candidate (masked — no raw email displayed) */}
              {winnerSelection && (
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <div>Winner: <span className="font-mono">{winnerSelection.masked_value ?? "***"}</span></div>
                  <div>Source: {winnerSelection.source} · Type: {winnerSelection.subject_type}</div>
                </div>
              )}

              {/* Credit cost preview from price schedule — never hardcoded */}
              <div className="text-[10px] text-muted-foreground">
                Pricing: loaded from active price schedule (not hardcoded)
              </div>

              {/* Catch-all approval banner */}
              {biz.email_discovery_status === "provider_catch_all" && !biz.email_outreach_catch_all_approved_at && (
                <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2 space-y-1.5">
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    ⚠ Catch-all mail server — individual delivery unverifiable. Approve for outreach?
                  </div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-400">
                    This will not change the validation result. Outreach eligibility only.
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => {
                      if (confirm("Approve this catch-all address for outreach? This will not change the validation result.")) {
                        approveCatchAllMutation.mutate(biz.id);
                      }
                    }}
                    disabled={approveCatchAllMutation.isPending}
                  >
                    Approve for outreach
                  </Button>
                </div>
              )}

              {/* Catch-all already approved */}
              {biz.email_discovery_status === "provider_catch_all" && biz.email_outreach_catch_all_approved_at && (
                <div className="text-[10px] text-green-700 dark:text-green-400">
                  ✓ Catch-all approved for outreach by {biz.email_outreach_approved_by ?? "admin"} on{" "}
                  {new Date(biz.email_outreach_catch_all_approved_at).toLocaleDateString()}
                </div>
              )}

              {/* Medium-confidence approval banner — ZeroBounce is billable,
                  so the budget preview modal is shown before the action fires */}
              {pendingIntent && pendingIntent.approval_required && (
                <div className="rounded border border-blue-200 bg-blue-50 dark:bg-blue-900/20 p-2 space-y-1.5">
                  <div className="text-xs font-medium text-blue-800 dark:text-blue-300">
                    🔵 Apollo returned medium-confidence match. Approve to attempt ZeroBounce validation?
                  </div>
                  <div className="text-[10px] text-blue-700 dark:text-blue-400">
                    This does NOT approve for outreach — ZeroBounce must confirm validity first.{" "}
                    ZeroBounce validation is a <strong>billable action</strong>; a cost preview will appear before proceeding.
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => {
                      // Show budget preview modal before the billable ZeroBounce action.
                      // The actual approval is executed only after the operator confirms.
                      budget.requireBudgetConfirmation({
                        businessId: biz.id,
                        businessName: biz.canonical_name ?? undefined,
                        actionType: "zerobounce_validation",
                        action: () => approveMediumConfidenceMutation.mutate({ id: biz.id, intentId: pendingIntent.id }),
                      });
                    }}
                    disabled={approveMediumConfidenceMutation.isPending || budget.state.open}
                  >
                    Approve for validation…
                  </Button>
                  {/* Budget preview modal — non-dismissible, blocks action until confirmed or cancelled */}
                  <BudgetPreviewModal
                    open={budget.state.open}
                    businessId={budget.state.businessId}
                    businessName={budget.state.businessName}
                    actionType={budget.state.actionType}
                    onConfirm={budget.handleConfirm}
                    onCancel={budget.handleCancel}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Enrichment Queue Panel ───────────────────────────────────────────────────
interface EnrichmentJob {
  id: number;
  prospectId: number | null;
  listId: number | null;
  jobType: string;
  status: string | null;
  totalCount: number | null;
  processedCount: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

function jobStatusBadge(status: string | null) {
  if (status === "completed") return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
  if (status === "processing") return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === "failed")     return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
  if (status === "cancelled")  return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400";
  return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300"; // pending
}

// TASK-1830: enrichment job controls are governed (503) until Gen-2 authorization.
// The panel renders job status read-only; retry/cancel buttons are hidden and replaced
// with a static notice until the governed state machine is promoted.
const ENRICHMENT_CONTROLS_GOVERNED = true;

function EnrichmentQueuePanel() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: jobs = [], isLoading, refetch } = useQuery<EnrichmentJob[]>({
    queryKey: ["/api/enrichment-jobs"],
    queryFn: async () => {
      const r = await fetch("/api/enrichment-jobs", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30000,
  });

  // patchJobMutation retained for future use when ENRICHMENT_CONTROLS_GOVERNED is lifted.
  const patchJobMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "pending" | "cancelled" }) => {
      const res = await apiRequest("PATCH", `/api/enrichment-jobs/${id}`, { status });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: vars.status === "cancelled" ? "Job cancelled" : "Job reset to pending",
        description: vars.status === "cancelled" ? "The job has been cancelled." : "The job will be retried on the next worker tick.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment-jobs"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const filtered = statusFilter === "all" ? jobs : jobs.filter(j => j.status === statusFilter);
  const counts = {
    total: jobs.length,
    pending: jobs.filter(j => j.status === "pending").length,
    processing: jobs.filter(j => j.status === "processing").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed: jobs.filter(j => j.status === "failed").length,
    cancelled: jobs.filter(j => j.status === "cancelled").length,
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Enrichment Queue</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {ENRICHMENT_CONTROLS_GOVERNED
                  ? "Read-only view — job controls require activation authorization."
                  : "View, retry, or cancel individual enrichment jobs. Auto-refreshes every 30s."}
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 pt-1">
          {[
            { label: "All", value: "all", count: counts.total },
            { label: "Pending", value: "pending", count: counts.pending },
            { label: "Processing", value: "processing", count: counts.processing },
            { label: "Completed", value: "completed", count: counts.completed },
            { label: "Failed", value: "failed", count: counts.failed },
            { label: "Cancelled", value: "cancelled", count: counts.cancelled },
          ].map(({ label, value, count }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {label}
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                statusFilter === value ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{count}</span>
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">Loading enrichment jobs…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground text-center">
            {statusFilter === "all" ? "No enrichment jobs found." : `No ${statusFilter} jobs.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Prospect / List</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{job.id}</TableCell>
                    <TableCell className="text-xs">{job.jobType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.prospectId ? `Prospect #${job.prospectId}` : job.listId ? `List #${job.listId}` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${jobStatusBadge(job.status)}`}>
                        {job.status ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(job.totalCount ?? 0) > 0
                        ? `${job.processedCount ?? 0} / ${job.totalCount}`
                        : "—"}
                      {job.error && (
                        <span className="ml-1 text-red-500" title={job.error}>⚠</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.createdAt ? new Date(job.createdAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.completedAt ? new Date(job.completedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {ENRICHMENT_CONTROLS_GOVERNED ? (
                        <span className="text-[10px] text-muted-foreground" title="Job controls require activation authorization — available in a future release">
                          Governed
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {(job.status === "failed" || job.status === "cancelled") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Retry (reset to pending)"
                              disabled={patchJobMutation.isPending}
                              onClick={() => patchJobMutation.mutate({ id: job.id, status: "pending" })}
                            >
                              <RotateCw className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
                          )}
                          {(job.status === "pending" || job.status === "processing") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Cancel job"
                              disabled={patchJobMutation.isPending}
                              onClick={() => patchJobMutation.mutate({ id: job.id, status: "cancelled" })}
                            >
                              <XCircle className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// ─── MI-08: Businesses Tab ────────────────────────────────────────────────────
function BusinessesTab({ userRole }: { userRole: string }) {
  const [search, setSearch] = useState("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [emailStatusFilter, setEmailStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessListItem | null>(null);
  const [, navigateTo] = useLocation();
  const [bootstrapConfirmation, setBootstrapConfirmation] = useState("");
  const [bootstrapLimit, setBootstrapLimit] = useState("10");
  const [recordClassRepairConfirmation, setRecordClassRepairConfirmation] = useState("");
  const LIMIT = 50;
  // Source vertical options from canonical businesses table, not legacy sunbiz_entities.
  const verticalsQuery = useQuery<{ verticals: Array<{ vertical: string; count: number }> }>({
    queryKey: ["/api/lead-ops/business-verticals"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/business-verticals", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60_000,
  });
  const verticals = verticalsQuery.data?.verticals ?? [];

  const bootstrapPreviewQuery = useQuery<any>({
    queryKey: ["/api/lead-ops/sunbiz-bootstrap/preview", bootstrapLimit],
    queryFn: async () => {
      const r = await fetch(`/api/lead-ops/sunbiz-bootstrap/preview?limit=${encodeURIComponent(bootstrapLimit)}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: userRole === "admin",
    staleTime: 10_000,
  });
  const bootstrapStatusQuery = useQuery<any>({
    queryKey: ["/api/lead-ops/sunbiz-bootstrap/status"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/sunbiz-bootstrap/status", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: userRole === "admin",
    refetchInterval: 15_000,
  });

  // One-time correction: businesses the Sunbiz bootstrap created before the
  // create.recordClass fix was published landed with record_class='unknown'
  // instead of 'canonical', making them invisible to this page, the
  // free-enrichment cohort, and MI-09 eligibility. Preview is read-only;
  // execution is guarded by a typed confirmation phrase bound to a
  // short-lived, single-use preview token, mirroring the bootstrap pattern
  // above. Safe to leave running indefinitely — once the cohort is empty,
  // preview always reports 0 and there is nothing left to run.
  const recordClassRepairPreviewQuery = useQuery<any>({
    queryKey: ["/api/lead-ops/sunbiz-bootstrap/record-class-repair/preview"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/sunbiz-bootstrap/record-class-repair/preview", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: userRole === "admin",
    staleTime: 10_000,
  });
  const recordClassRepairRunMutation = useMutation({
    mutationFn: async () => {
      const previewToken = recordClassRepairPreviewQuery.data?.previewToken;
      if (!previewToken) {
        const err: Error & { code?: string } = new Error("No active preview token — re-checking preview before you can run.");
        err.code = "no_active_preview_token";
        throw err;
      }
      try {
        const r = await apiRequest("POST", "/api/lead-ops/sunbiz-bootstrap/record-class-repair/run", {
          confirmation: recordClassRepairConfirmation,
          previewToken,
        });
        return await r.json();
      } catch (e) {
        const { code, reason } = parseApiRequestError(e instanceof Error ? e.message : String(e));
        const err: Error & { code?: string } = new Error(reason || (e instanceof Error ? e.message : String(e)));
        err.code = code;
        throw err;
      }
    },
    onSuccess: () => {
      setRecordClassRepairConfirmation("");
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sunbiz-bootstrap/record-class-repair/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/businesses"] });
    },
    onError: (err: Error & { code?: string }) => {
      // Same rationale as the bootstrap mutation above: only force a fresh
      // preview/token when this one is actually dead, never on a typed
      // confirmation typo (which leaves the server-side token untouched).
      if (err?.code && err.code !== "typed_confirmation_required") {
        queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sunbiz-bootstrap/record-class-repair/preview"] });
      }
    },
  });
  const bootstrapRunMutation = useMutation({
    mutationFn: async () => {
      // previewToken binds this run to the exact preview response the admin
      // is looking at (candidateCount + confirmationPhrase). It's single-use
      // and short-lived — if it's missing (preview hasn't loaded, or a prior
      // attempt already consumed it), re-fetch preview instead of running.
      const previewToken = bootstrapPreviewQuery.data?.previewToken;
      if (!previewToken) {
        const err: Error & { code?: string } = new Error("No active preview token — re-checking preview before you can run.");
        err.code = "no_active_preview_token";
        throw err;
      }
      try {
        const r = await apiRequest("POST", "/api/lead-ops/sunbiz-bootstrap/run", {
          limit: Number(bootstrapLimit),
          confirmation: bootstrapConfirmation,
          previewToken,
        });
        return await r.json();
      } catch (e) {
        // apiRequest() itself throws `Error(\`${status}: ${text}\`)` on any
        // non-OK response — it never returns the Response for us to inspect,
        // so the server's structured error code has to be recovered from the
        // thrown message via parseApiRequestError. The server only DELETES
        // the previewToken once limit+confirmation both validate (see
        // peekSunbizBootstrapPreviewToken in sunbiz-bootstrap.ts), so a
        // typed_confirmation_required rejection means the token is still
        // alive and reusable — onError uses this code to tell that apart
        // from a rejection that means the token is actually dead.
        const { code, reason } = parseApiRequestError(e instanceof Error ? e.message : String(e));
        const err: Error & { code?: string } = new Error(reason || (e instanceof Error ? e.message : String(e)));
        err.code = code;
        throw err;
      }
    },
    onSuccess: () => {
      setBootstrapConfirmation("");
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sunbiz-bootstrap/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sunbiz-bootstrap/status"] });
    },
    onError: (err: Error & { code?: string }) => {
      // Only force a fresh preview/token when THIS token is actually dead
      // (missing, expired, already consumed/reused, or minted for a
      // different limit) — never on typed_confirmation_required. A
      // confirmation typo leaves the server-side token untouched, so
      // refetching here would throw away a still-valid token and risk
      // showing the operator a changed candidate count just for correcting
      // a typo.
      if (err?.code && err.code !== "typed_confirmation_required") {
        queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/sunbiz-bootstrap/preview"] });
      }
    },
  });

  const params = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    ...(search ? { search } : {}),
    ...(verticalFilter ? { vertical: verticalFilter } : {}),
    ...(emailStatusFilter ? { emailStatus: emailStatusFilter } : {}),
  });

  const { data, isLoading, isError, error } = useQuery<{ businesses: BusinessListItem[]; total: number }>({
    queryKey: ["/api/lead-ops/businesses", search, verticalFilter, emailStatusFilter, offset],
    queryFn: async () => {
      const r = await fetch(`/api/lead-ops/businesses?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const businesses = data?.businesses ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const page = Math.floor(offset / LIMIT);

  // Mobile detection
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  return (
    <div className="space-y-4">
      {userRole === "admin" && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sunbiz Bootstrap — bounded admin run</CardTitle>
            <CardDescription className="text-xs">
              Manual only. Preview is read-only; execution is capped at 25 and idempotent by filing number.
              This action is not scheduled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">Batch size
                <Input className="h-8 w-20 mt-1" type="number" min={1} max={25} value={bootstrapLimit}
                  onChange={(e) => setBootstrapLimit(String(Math.min(25, Math.max(1, Math.floor(Number(e.target.value) || 1)))))} />
              </label>
              <div className="text-xs text-muted-foreground">
                Would pull <strong>{bootstrapPreviewQuery.data?.candidateCount ?? "—"}</strong>;
                create {bootstrapPreviewQuery.data?.wouldCreate ?? "—"}, match {bootstrapPreviewQuery.data?.wouldMatchExisting ?? "—"},
                defer {bootstrapPreviewQuery.data?.wouldDefer ?? "—"}.
              </div>
            </div>
            {bootstrapPreviewQuery.data?.candidates?.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Sample: {bootstrapPreviewQuery.data.candidates.slice(0, 5).map((c: any) => `${c.entityName} (${c.outcome})`).join(" · ")}
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-xs flex-1 min-w-[240px]">Type confirmation
                <Input className="h-8 mt-1 font-mono" placeholder={`RUN SUNBIZ BOOTSTRAP ${bootstrapPreviewQuery.data?.candidateCount ?? "N"}`}
                  value={bootstrapConfirmation} onChange={(e) => setBootstrapConfirmation(e.target.value)} />
              </label>
              <Button size="sm" variant="outline"
                disabled={bootstrapRunMutation.isPending || !bootstrapPreviewQuery.data?.candidateCount || !bootstrapPreviewQuery.data?.previewToken}
                onClick={() => bootstrapRunMutation.mutate()}>
                {bootstrapRunMutation.isPending ? "Running…" : "Run bounded batch"}
              </Button>
            </div>
            {bootstrapRunMutation.error && <p className="text-xs text-red-600">{(bootstrapRunMutation.error as Error).message}</p>}
            {bootstrapStatusQuery.data && (
              <>
                <div className="text-[11px] text-muted-foreground">
                  Cursor entity #{bootstrapStatusQuery.data.cursor ?? "—"} · claimed {bootstrapStatusQuery.data.claimed ?? 0} ·
                  created {bootstrapStatusQuery.data.created ?? 0} · failed {bootstrapStatusQuery.data.failed ?? 0} ·
                  last completed {bootstrapStatusQuery.data.last_completed_at ? new Date(bootstrapStatusQuery.data.last_completed_at).toLocaleString() : "—"}.
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Recovery: failed claims are eligible for a later bounded rerun; successful claims are never duplicated.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      {userRole === "admin" && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sunbiz Record-Class Repair — one-time correction</CardTitle>
            <CardDescription className="text-xs">
              Fixes businesses created by the Sunbiz bootstrap before a defect was patched: they were left as
              "unknown" instead of "canonical", hiding them from Lead Ops, free enrichment, and MI-09. Preview
              is read-only. Safe to rerun — once the cohort is empty, this always reports 0 and there's nothing
              left to fix.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="text-xs text-muted-foreground">
              Affected businesses found: <strong>{recordClassRepairPreviewQuery.data?.cohortCount ?? "—"}</strong>
              {recordClassRepairPreviewQuery.isFetching && " (checking…)"}
            </div>
            {recordClassRepairPreviewQuery.data?.rows?.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Sample: {recordClassRepairPreviewQuery.data.rows.slice(0, 5).map((r: any) => r.canonicalName).join(" · ")}
              </div>
            )}
            {recordClassRepairPreviewQuery.data?.cohortCount === 0 && (
              <div className="text-[11px] text-muted-foreground">Nothing to repair right now.</div>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-xs flex-1 min-w-[240px]">Type confirmation
                <Input
                  className="h-8 mt-1 font-mono"
                  placeholder={recordClassRepairPreviewQuery.data?.confirmationPhrase ?? "REPAIR SUNBIZ RECORD CLASS N"}
                  value={recordClassRepairConfirmation}
                  onChange={(e) => setRecordClassRepairConfirmation(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  recordClassRepairRunMutation.isPending ||
                  !recordClassRepairPreviewQuery.data?.cohortCount ||
                  !recordClassRepairPreviewQuery.data?.previewToken
                }
                onClick={() => recordClassRepairRunMutation.mutate()}
              >
                {recordClassRepairRunMutation.isPending ? "Running…" : "Run repair"}
              </Button>
            </div>
            {recordClassRepairRunMutation.error && (
              <p className="text-xs text-red-600">{(recordClassRepairRunMutation.error as Error).message}</p>
            )}
            {recordClassRepairRunMutation.data && (
              <div className="text-[11px] text-muted-foreground">
                Repaired {recordClassRepairRunMutation.data.repairedCount} of{" "}
                {recordClassRepairRunMutation.data.attemptedCount} attempted.
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Detail panel removed — clicking a row navigates to /dashboard/lead-ops/business/:id */}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Search company or domain…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            aria-label="Search businesses"
          />
        </div>
        <Select value={verticalFilter || "all"} onValueChange={(v) => { setVerticalFilter(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="w-44 h-9" aria-label="Filter by vertical">
            <SelectValue placeholder="All verticals" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verticals</SelectItem>
            {verticals.map((v) => (
              <SelectItem key={v.vertical} value={v.vertical}>{v.vertical} ({v.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={emailStatusFilter} onValueChange={(v) => { setEmailStatusFilter(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="w-48 h-9" aria-label="Filter by email status">
            <SelectValue placeholder="All email statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All email statuses</SelectItem>
            <SelectItem value="provider_valid">Valid</SelectItem>
            <SelectItem value="provider_catch_all">Catch-all</SelectItem>
            <SelectItem value="provider_invalid">Invalid</SelectItem>
            <SelectItem value="discovered">Discovered</SelectItem>
            <SelectItem value="no_valid_candidate">No candidate</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-auto">
          {total.toLocaleString()} canonical businesses
        </div>
      </div>

      {/* Error */}
      {isError && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <XCircle className="h-4 w-4" />
          {error instanceof Error ? error.message : "Failed to load businesses"}
        </div>
      )}

      {/* Mobile card list (≤768px) */}
      <div className="md:hidden space-y-3">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)
          : businesses.length === 0
            ? <p className="text-sm text-muted-foreground py-8 text-center">No businesses match your filters.</p>
            : businesses.map((b) => (
                <MobileBusinessCard key={b.id} business={b} onTap={(biz) => navigateTo(`/dashboard/lead-ops/business/${biz.id}`)} />
              ))
        }
      </div>

      {/* Desktop table (>768px) */}
      <Card className="hidden md:block shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Email Status</TableHead>
                  <TableHead>Enrichment</TableHead>
                  <TableHead>Fit Tier</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : businesses.length === 0
                    ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                          No businesses match your current filters.
                        </TableCell>
                      </TableRow>
                    )
                    : businesses.map((b) => (
                        <TableRow key={b.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigateTo(`/dashboard/lead-ops/business/${b.id}`)}>
                          <TableCell className="font-medium max-w-[200px]">
                            <div className="truncate">{b.canonical_name}</div>
                            {b.website_domain && (
                              <a
                                href={b.website_domain.startsWith("http") ? b.website_domain : `https://${b.website_domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 truncate"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Open ${b.website_domain}`}
                              >
                                {b.website_domain}
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {[b.city, b.state].filter(Boolean).join(", ") || "—"}
                          </TableCell>
                          <TableCell>
                            {b.vertical
                              ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">{b.vertical}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </TableCell>
                          <TableCell>
                            {b.email_discovery_status ? (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-5 ${
                                  b.email_discovery_status === "provider_valid" ? "bg-green-100 text-green-800" :
                                  b.email_discovery_status === "provider_catch_all" ? "bg-amber-100 text-amber-800" :
                                  b.email_discovery_status === "provider_invalid" ? "bg-red-100 text-red-800" :
                                  b.email_discovery_status === "discovered" ? "bg-blue-100 text-blue-800" :
                                  "bg-gray-100 text-gray-600"
                                }`}
                                aria-label={`Email: ${b.email_discovery_status.replace(/_/g, " ")}`}
                              >
                                {b.email_discovery_status.replace(/_/g, " ")}
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {b.free_enrichment_status ? (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-5 ${
                                  b.free_enrichment_status === "enriched" ? "bg-green-100 text-green-800" :
                                  b.free_enrichment_status === "processing" ? "bg-blue-100 text-blue-800" :
                                  b.free_enrichment_status === "failed" ? "bg-red-100 text-red-800" :
                                  "bg-gray-100 text-gray-600"
                                }`}
                                aria-label={`Enrichment: ${b.free_enrichment_status}`}
                              >
                                {b.free_enrichment_status}
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {b.fit_tier ? (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-5 font-bold ${
                                  b.fit_tier === "A" ? "bg-emerald-100 text-emerald-800" :
                                  b.fit_tier === "B" ? "bg-blue-100 text-blue-800" :
                                  "bg-amber-100 text-amber-700"
                                }`}
                                aria-label={`Fit tier ${b.fit_tier}`}
                              >
                                {b.fit_tier}
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {b.field_claim_status === "claimed" ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-amber-50 text-amber-700" aria-label="Field claim active">
                                claimed
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs"
                              onClick={(e) => { e.stopPropagation(); navigateTo(`/dashboard/lead-ops/business/${b.id}`); }}
                              aria-label={`View details for ${b.canonical_name}`}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function LeadOpsCenter() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Tab state (MI-08 + #1957 consolidation) ─────────────────────────────────
  const urlSearch = useSearch();
  const [, navigate] = useLocation();
  const VALID_TABS = ["businesses", "prospects", "imports", "staging", "sources", "census", "intelligence", "quality", "pipeline", "pilot", "health"] as const;
  const STAGING_SUBTABS = ["master-leads", "promotion-review"] as const;
  const tabFromUrl = (() => {
    const t = new URLSearchParams(urlSearch).get("tab");
    return t && (VALID_TABS as readonly string[]).includes(t) ? t : "businesses";
  })();
  const [activeTab, setActiveTabState] = useState(tabFromUrl);
  const stagingTabFromUrl = (() => {
    const t = new URLSearchParams(urlSearch).get("stagingTab");
    return t && (STAGING_SUBTABS as readonly string[]).includes(t) ? t : "master-leads";
  })();
  const [stagingTab, setStagingTab] = useState(stagingTabFromUrl);

  useEffect(() => {
    setActiveTabState(tabFromUrl);
    setStagingTab(stagingTabFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  const setActiveTab = (value: string) => {
    setActiveTabState(value);
    const params = new URLSearchParams(urlSearch);
    params.set("tab", value);
    if (value !== "staging") params.delete("stagingTab");
    navigate(`/dashboard/lead-ops?${params.toString()}`, { replace: true });
  };

  const handleStagingTabChange = (value: string) => {
    setStagingTab(value);
    const params = new URLSearchParams(urlSearch);
    params.set("tab", "staging");
    params.set("stagingTab", value);
    navigate(`/dashboard/lead-ops?${params.toString()}`, { replace: true });
  };

  // ── Filter / pagination state ──────────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterStatus,    setFilterStatus]    = useState("all");
  const [filterScore,     setFilterScore]     = useState("all");
  const [filterVertical,  setFilterVertical]  = useState("all");
  const [filterContactable, setFilterContactable] = useState(false);
  const [filterNoContact,   setFilterNoContact]   = useState(false);
  const [filterTag,         setFilterTag]         = useState("all");
  const LIMIT = 100;
  const [inboundPage, setInboundPage] = useState(0);
  const [inboundSourceClass, setInboundSourceClass] = useState("all");
  const [inboundLifecycle, setInboundLifecycle] = useState("all");
  const INBOUND_LIMIT = 25;

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── AI analysis ───────────────────────────────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [showAI, setShowAI] = useState(false);

  // ── SERPER banner dismiss (session-only) ───────────────────────────────────
  const [serperBannerDismissed, setSerperBannerDismissed] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const statsQuery = useQuery<LeadOpsStats>({
    queryKey: ["/api/lead-ops/stats"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/stats", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30000,
  });

  const healthQuery = useQuery<LeadOpsHealth>({
    queryKey: ["/api/lead-ops/health"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/health", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 120000,
  });

  const freeLaneHealthQuery = useQuery<any>({
    queryKey: ["/api/lead-ops/enrichment-program-health"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/enrichment-program-health", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const configQuery = useQuery<LeadOpsConfig>({
    queryKey: ["/api/lead-ops/config"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/config", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const entitiesParams = new URLSearchParams({
    page: String(page), limit: String(LIMIT),
    ...(filterStatus   !== "all" ? { status:  filterStatus   } : {}),
    ...(filterScore    !== "all" ? { score:   filterScore    } : {}),
    ...(filterVertical !== "all" ? { vertical: filterVertical } : {}),
    ...(filterContactable ? { contactable: "true" } : {}),
    ...(filterNoContact   ? { noContact:   "true" } : {}),
    ...(filterTag !== "all" ? { tag: filterTag } : {}),
    ...(search ? { search } : {}),
  });

  const entitiesQuery = useQuery<{ data: LeadEntity[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/lead-ops/entities", page, filterStatus, filterScore, filterVertical, filterContactable, filterNoContact, filterTag, search],
    queryFn: async () => {
      const r = await fetch(`/api/lead-ops/entities?${entitiesParams}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const entities = entitiesQuery.data?.data || [];
  const total    = entitiesQuery.data?.total || 0;
  const totalPages = Math.ceil(total / LIMIT);

  const inboundParams = new URLSearchParams({
    limit: String(INBOUND_LIMIT),
    offset: String(inboundPage * INBOUND_LIMIT),
    ...(inboundSourceClass !== "all" ? { sourceClass: inboundSourceClass } : {}),
    ...(inboundLifecycle !== "all" ? { lifecycleState: inboundLifecycle } : {}),
  });
  const inboundRequestsQuery = useQuery<InboundRequest[]>({
    queryKey: ["/api/lead-ops/inbound-requests", inboundPage, inboundSourceClass, inboundLifecycle],
    queryFn: async () => {
      const response = await fetch(`/api/lead-ops/inbound-requests?${inboundParams}`, { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    placeholderData: (previous) => previous,
  });
  const inboundRequests = inboundRequestsQuery.data || [];

  const stagingCountsQuery = useQuery<Record<string, number>>({
    queryKey: ["/api/lead-ops/staging-counts"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/staging-counts", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  // NOTE: legacy bulk/single-row enrichment mutation removed — CRO-03 provider
  // transport is disabled, so it always threw. Both entry points (the bulk
  // "Enrich Selected" action and the per-row re-enrich button) are now
  // unconditionally disabled instead (#1957).

  const aiSegmentMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/lead-ops/ai-segment", { sampleSize: 150 });
      return r.json();
    },
    onSuccess: (data: AiAnalysis) => {
      setAiAnalysis(data);
      setShowAI(true);
    },
    onError: (e: Error) => toast({ title: "AI analysis failed", description: e.message, variant: "destructive" }),
  });

  const writebackMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/lead-ops/run-writeback", { limit: 2000 });
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Owner data synced", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/stats"] });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const clearSlaMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/lead-ops/clear-sla-tasks", {});
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "SLA tasks cleared", description: data.message });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resetJobsMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/lead-ops/reset-stuck-jobs", {});
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Queue reset", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/health"] });
    },
    onError: (e: Error) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const convertToProspectsMutation = useMutation({
    mutationFn: async (entityIds: number[]) => {
      const r = await apiRequest("POST", "/api/sunbiz/convert-batch", { entityIds });
      return r.json();
    },
    onSuccess: (data: { converted: number }) => {
      toast({ title: "Converted", description: `${data.converted} entities pushed to Source Prospects.` });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/entities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      setSelectedIds(new Set());
    },
    onError: (e: Error) => toast({ title: "Conversion failed", description: e.message, variant: "destructive" }),
  });

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allPageSelected = entities.length > 0 && entities.every(e => selectedIds.has(e.id));
  const someSelected    = selectedIds.size > 0;

  const toggleAll = useCallback(() => {
    if (allPageSelected) {
      setSelectedIds(prev => { const next = new Set(prev); entities.forEach(e => next.delete(e.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); entities.forEach(e => next.add(e.id)); return next; });
    }
  }, [entities, allPageSelected]);

  const toggleOne = useCallback((id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const stats = statsQuery.data;

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const statCards = [
    { label: "Total Leads",        value: stats?.total?.toLocaleString()                     || "—", icon: Users,       color: "text-gray-700 dark:text-gray-300" },
    { label: "Processing Done",    value: stats?.processing_completed?.toLocaleString()      || "—", icon: CheckCircle,  color: "text-green-600 dark:text-green-400" },
    { label: "Awaiting Processing",value: stats?.pending_processing?.toLocaleString()        || "—", icon: Clock,        color: "text-yellow-600 dark:text-yellow-400" },
    { label: "Email Inventory",    value: stats?.current_email_inventory?.toLocaleString()   || "—", icon: Mail,         color: "text-blue-600 dark:text-blue-400" },
    { label: "Phone Inventory",    value: stats?.current_phone_inventory?.toLocaleString()   || "—", icon: Phone,        color: "text-indigo-600 dark:text-indigo-400" },
    { label: "Hot Leads",          value: stats?.hot?.toLocaleString()                       || "—", icon: TrendingUp,   color: "text-red-600 dark:text-red-400" },
  ];

  const health = healthQuery.data;
  const config = configQuery.data;
  const showSerperBanner = !serperBannerDismissed && config !== undefined && !config.serperConfigured;

  return (
    <div className="space-y-6 pb-12">

      {/* ── SERPER key warning banner ─────────────────────────────────────── */}
      {showSerperBanner && (
        <div className="relative flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Google search steps are disabled — email discovery rate is near 0
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Add <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded font-mono">SERPER_API_KEY</code> in{" "}
              <a
                href="https://docs.replit.com/replit-workspace/workspace-features/secrets"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Replit Secrets
              </a>{" "}
              to unlock 13 enrichment steps and dramatically improve email discovery.
            </p>
          </div>
          <button
            onClick={() => setSerperBannerDismissed(true)}
            className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Operations Center</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Enrich, segment, and route your entire lead pool — no code required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => writebackMutation.mutate()}
            disabled={writebackMutation.isPending}
            className="gap-1.5"
          >
            {writebackMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Owner Data
          </Button>

          {user?.role === "admin" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear SLA Flood
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear stuck SLA tasks?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will resolve all pending "SLA Alert" tasks for leads that have no email and no phone — contacts that can't be reached yet. They'll be re-created automatically once enrichment adds contact data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => clearSlaMutation.mutate()}
                  >
                    Clear Tasks
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── MI-08: Unified Lead Ops Workspace Tabs ───────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1" aria-label="Lead Ops workspace tabs">
          <TabsTrigger value="businesses" className="gap-1.5 min-h-[44px] text-sm">
            <Building2 className="h-4 w-4" aria-hidden /> Businesses
          </TabsTrigger>
          <TabsTrigger value="prospects" className="gap-1.5 min-h-[44px] text-sm">
            <Layers className="h-4 w-4" aria-hidden /> Source Prospects
          </TabsTrigger>
          <TabsTrigger value="imports" className="gap-1.5 min-h-[44px] text-sm">
            <GitBranch className="h-4 w-4" aria-hidden /> Imports
          </TabsTrigger>
          <TabsTrigger value="staging" className="gap-1.5 min-h-[44px] text-sm">
            <GitBranch className="h-4 w-4" aria-hidden /> Staging &amp; Promotion
          </TabsTrigger>
          <TabsTrigger value="sources" className="gap-1.5 min-h-[44px] text-sm">
            <Layers className="h-4 w-4" aria-hidden /> Sources
          </TabsTrigger>
          <TabsTrigger value="census" className="gap-1.5 min-h-[44px] text-sm">
            <BarChart3 className="h-4 w-4" aria-hidden /> Census
          </TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-1.5 min-h-[44px] text-sm">
            <BarChart3 className="h-4 w-4" aria-hidden /> Intelligence
          </TabsTrigger>
          <TabsTrigger value="quality" className="gap-1.5 min-h-[44px] text-sm">
            <HeartPulse className="h-4 w-4" aria-hidden /> Data Quality
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5 min-h-[44px] text-sm">
            <TrendingUp className="h-4 w-4" aria-hidden /> Inbound Operations
          </TabsTrigger>
          <TabsTrigger value="sfp" className="gap-1.5 min-h-[44px] text-sm">
            <MapPin className="h-4 w-4" aria-hidden /> South Florida Prospecting
          </TabsTrigger>
          <TabsTrigger value="pilot" className="gap-1.5 min-h-[44px] text-sm">
            🧪 Paid Pilot (Legacy)
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5 min-h-[44px] text-sm">
            <HeartPulse className="h-4 w-4" aria-hidden /> Enrichment Program Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prospects" className="space-y-4">
          <Prospects />
        </TabsContent>

        <TabsContent value="imports" className="space-y-4">
          <LeadImports />
        </TabsContent>

        {/* ── Businesses tab ─────────────────────────────────────────────── */}
        <TabsContent value="businesses" className="space-y-4">
          <BusinessesTab userRole={user?.role ?? "agent"} />
        </TabsContent>

        {/* ── Staging & Promotion tab: Master Leads (all-origin inventory) vs
             Promotion Review (MI-07 controlled-cohort pipeline), split per #1957 ── */}
        <TabsContent value="staging" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pipeline staging inventory</CardTitle>
              <CardDescription className="text-xs">
                Server-derived counts. Promotion remains a separate, explicit admin action.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  ["Pending", "pending"],
                  ["Staged", "staged"],
                  ["Duplicate", "duplicate"],
                  ["Suppressed", "suppressed"],
                  ["Failed", "failed"],
                  ["Promoted", "promoted"],
                ].map(([label, key]) => (
                  <div key={key} className="rounded border px-3 py-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold">{stagingCountsQuery.data?.[key] ?? "—"}</div>
                  </div>
                ))}
              </div>
              {stagingCountsQuery.isError && (
                <div className="text-xs text-red-600 mt-2">Unable to load staging counts: {(stagingCountsQuery.error as Error).message}</div>
              )}
            </CardContent>
          </Card>
          <Tabs
            value={user?.role === "admin" ? stagingTab : "promotion-review"}
            onValueChange={handleStagingTabChange}
          >
            <TabsList>
              {/* Master Leads (the raw master_leads inventory, including CSV export and
                  Backfill Existing Contacts) was admin-only at its old standalone route
                  (/dashboard/master-lead-database). Lead Ops itself is reachable by
                  managers too, so this subtab stays admin-only here to avoid handing
                  managers a client UI for admin-gated server routes (#1957). */}
              {user?.role === "admin" && (
                <TabsTrigger value="master-leads" data-testid="tab-master-leads">Master Leads</TabsTrigger>
              )}
              <TabsTrigger value="promotion-review" data-testid="tab-promotion-review">Promotion Review</TabsTrigger>
            </TabsList>
            {user?.role === "admin" && (
              <TabsContent value="master-leads" className="space-y-4 mt-4">
                <MasterLeadDatabase />
              </TabsContent>
            )}
            <TabsContent value="promotion-review" className="space-y-4 mt-4">
              <PipelineReviewTab />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── Sources tab ────────────────────────────────────────────────── */}
        <TabsContent value="sources" className="space-y-4">
          {user?.role === "admin" ? (
            /* Admin: full import controls + registry panel */
            <SourceRegistryPanel />
          ) : (
            /* Manager: read-only counts. SourceRegistryPanel hits /api/admin/source-registry
               which is admin-only and returns 403 for managers. Show a safe summary instead. */
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-600" aria-hidden />
                  <CardTitle className="text-sm">Source Registry (read-only)</CardTitle>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">Manager view</Badge>
                </div>
                <CardDescription className="text-xs">
                  Import controls are restricted to admins. You can view pipeline counts in the Health tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  {[
                    ["Canonical businesses", health?.sourceRegistryCounts?.canonicalBusinesses],
                    ["Source links", health?.sourceRegistryCounts?.sourceLinks],
                    ["Adapters", health?.sourceRegistryCounts?.adapters],
                  ].map(([label, metric]) => (
                    <div key={label as string} className="rounded-md border bg-muted/10 px-3 py-2">
                      <div className="text-xs text-muted-foreground">{label as string}</div>
                      <div className="text-lg font-semibold">
                        {(metric as HealthMetric | undefined)?.available
                          ? Number((metric as HealthMetric).value ?? 0).toLocaleString()
                          : "unknown"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                  Contact an admin to import or configure data sources.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Census tab ─────────────────────────────────────────────────── */}
        <TabsContent value="census" className="space-y-4">
          <SouthFloridaQualificationPanel />
        </TabsContent>

        {/* ── Intelligence tab ──────────────────────────────────────────── */}
        <TabsContent value="intelligence" className="space-y-4">
          <LeadIntelligence />
        </TabsContent>

        {/* ── Data Quality tab ──────────────────────────────────────────── */}
        <TabsContent value="quality" className="space-y-4">
          <DataQuality />
        </TabsContent>

        {/* ── Pipeline tab (enrichment queue + AI + entity table) ─────────── */}
        <TabsContent value="pipeline" className="space-y-6">
          {/* Inbound request operations */}
          {/* ── Inbound request operations ─────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Inbound Request Operations</CardTitle>
              <CardDescription className="text-xs mt-1">
                Bounded operational view of governed inbound receipts and their canonical work links.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/inbound-requests"] })}
              disabled={inboundRequestsQuery.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${inboundRequestsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Select value={inboundSourceClass} onValueChange={(value) => { setInboundSourceClass(value); setInboundPage(0); }}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All source classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All source classes</SelectItem>
                <SelectItem value="sales_request">Sales request</SelectItem>
                <SelectItem value="support_request">Support request</SelectItem>
                <SelectItem value="fulfillment_request">Fulfillment request</SelectItem>
                <SelectItem value="content_reputation">Content &amp; reputation</SelectItem>
                <SelectItem value="marketing_opt_in">Marketing opt-in</SelectItem>
                <SelectItem value="imported_provider_event">Imported provider event</SelectItem>
              </SelectContent>
            </Select>
            <Select value={inboundLifecycle} onValueChange={(value) => { setInboundLifecycle(value); setInboundPage(0); }}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All lifecycle states" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lifecycle states</SelectItem>
                <SelectItem value="claimed">Claimed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="review_required">Review required</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {inboundRequestsQuery.isError ? (
            <div className="px-6 py-8 text-sm text-destructive">
              Unable to load inbound requests. {inboundRequestsQuery.error instanceof Error ? inboundRequestsQuery.error.message : ""}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1300px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Source / received</TableHead>
                    <TableHead>Opaque receipt</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead>SLA due</TableHead>
                    <TableHead>Lifecycle / effect truth</TableHead>
                    <TableHead>Terminal reason (redacted)</TableHead>
                    <TableHead>Canonical links</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inboundRequestsQuery.isLoading
                    ? Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: 7 }).map((__, cell) => <TableCell key={cell}><Skeleton className="h-4 w-full" /></TableCell>)}
                      </TableRow>
                    ))
                    : inboundRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                          No inbound requests match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : inboundRequests.map((request) => (
                      <TableRow key={request.requestReceipt}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{request.sourceClass}</div>
                          <div className="text-muted-foreground">{request.sourceCategory} / {request.sourceType}</div>
                          <div className="text-muted-foreground mt-1">{formatInboundDate(request.createdAt)}</div>
                        </TableCell>
                        <TableCell className="max-w-[190px] font-mono text-[11px] break-all">{request.requestReceipt}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${inboundStatusBadge(request.assignmentStatus)}`}>
                            {request.assignmentStatus}
                          </Badge>
                          {(request.assignedTo || request.assignmentReason) && (
                            <div className="text-muted-foreground mt-1 max-w-[180px] break-words">
                              {request.assignedTo || request.assignmentReason}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatInboundDate(request.slaDueAt)}</TableCell>
                        <TableCell className="text-xs space-y-1">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${inboundStatusBadge(request.lifecycleState)}`}>
                            {request.lifecycleState}
                          </Badge>
                          <div className="space-y-1 pt-0.5">
                            {request.effects.length === 0 ? (
                              <div className="text-muted-foreground">No effects reported</div>
                            ) : request.effects.map((effect) => (
                              <div key={effect.effectKey} className="flex flex-wrap items-center gap-1 text-[10px]">
                                <span className="text-muted-foreground">{effect.effectKey}</span>
                                <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${inboundStatusBadge(effect.state)}`}>
                                  {effect.state}
                                </Badge>
                                {effect.externalSideEffect && <span className="text-muted-foreground">(external effect)</span>}
                                {effect.terminalReason && <span className="text-muted-foreground">{effect.terminalReason}</span>}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px] text-xs text-muted-foreground break-words">
                          {request.terminalReason || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col items-start gap-1">
                            {request.contactId && <a className="text-blue-600 hover:underline" href={`/dashboard/contacts/${request.contactId}`}>Contact #{request.contactId}</a>}
                            {request.dealId && <a className="text-blue-600 hover:underline" href="/dashboard/pipeline">Deal #{request.dealId}</a>}
                            {request.ticketId && <a className="text-blue-600 hover:underline" href="/dashboard/tickets">Ticket #{request.ticketId}</a>}
                            {!request.contactId && !request.dealId && !request.ticketId && <span className="text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <div className="flex items-center justify-between border-t px-6 py-3">
          <span className="text-xs text-muted-foreground">
            {inboundRequestsQuery.isLoading ? "Loading receipts…" : `Page ${inboundPage + 1} · up to ${INBOUND_LIMIT} receipts`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={inboundPage === 0 || inboundRequestsQuery.isFetching} onClick={() => setInboundPage((page) => page - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={inboundRequests.length < INBOUND_LIMIT || inboundRequestsQuery.isFetching} onClick={() => setInboundPage((page) => page + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <Card key={s.label} className="border shadow-sm">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              {statsQuery.isLoading
                ? <Skeleton className="h-7 w-16" />
                : <div className="text-xl font-bold">{s.value}</div>
              }
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Pipeline Health widget ───────────────────────────────────────── */}
      <Card id="pipeline-health-card" className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-sm">Pipeline Health</CardTitle>
              {healthQuery.isLoading
                ? <Skeleton className="h-4 w-20" />
                : health
                  ? health.workerActive
                    ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </span>
                    )
                    : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        {health.minutesSinceLastJob !== null
                          ? `Idle ${health.minutesSinceLastJob}m`
                          : "No activity yet"}
                      </span>
                    )
                  : null
              }
            </div>
            <span className="text-[10px] text-muted-foreground">
              Auto-refreshes every 2m
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {healthQuery.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : health ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Enriched Today",    metric: health.enrichedToday,    icon: CheckCircle, color: "text-green-600 dark:text-green-400" },
                { label: "Emails Found Today", metric: health.emailsToday,     icon: Mail,        color: "text-blue-600 dark:text-blue-400" },
                { label: "Phones Found Today", metric: health.phonesToday,     icon: Phone,       color: "text-indigo-600 dark:text-indigo-400" },
                { label: "Queue Depth",        metric: health.queueDepth,      icon: Clock,       color: "text-yellow-600 dark:text-yellow-400" },
                { label: "Success Rate",       metric: health.successRate,      icon: TrendingUp,  color: "text-emerald-600 dark:text-emerald-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
                    <span className="text-[11px] text-muted-foreground">{s.label}</span>
                  </div>
                  <div className="text-lg font-bold">
                    {s.metric.available && s.metric.value !== null
                      ? `${s.metric.value}${s.label === "Success Rate" ? "%" : ""}`
                      : "unknown"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load health data.</p>
          )}
          {/* ── Worker-authority truth fields (MI-01) ───────────────────── */}
          {health && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Intake Authority</div>
                <div className={`font-medium truncate ${
                  health.intakeAuthority === "none"
                    ? "text-muted-foreground"
                    : health.intakeAuthority === "both"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-green-700 dark:text-green-400"
                }`}>
                  {health.intakeAuthority === "scheduled-sunbiz-pipeline" ? "Scheduled pipeline"
                   : health.intakeAuthority === "legacy-outreach-cycle" ? "Legacy outreach cycle"
                   : health.intakeAuthority === "both" ? "Both (scheduled + legacy)"
                   : "None"}
                </div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Enrichment State</div>
                <div className={`font-medium truncate ${
                  health.enrichmentProgressStatus === "interrupted" || health.enrichmentProgressStatus === "failed"
                    ? "text-amber-600 dark:text-amber-400"
                    : health.enrichmentProgressStatus === "running"
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-green-700 dark:text-green-400"
                }`}>
                  {health.enrichmentProgressStatus}
                </div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Sunbiz Gate</div>
                <div className={`font-medium ${health.sunbizEnrichmentEnabled ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
                  {health.sunbizEnrichmentEnabled ? "Enabled" : "Disabled"}
                </div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Free Enrich Pending</div>
                <div className="font-medium">{health.freeEnrichmentPendingJobs.toLocaleString()}</div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Last Scheduled Run</div>
                <div className="font-medium truncate">
                  {health.lastScheduledEnrichmentAt
                    ? new Date(health.lastScheduledEnrichmentAt).toLocaleTimeString()
                    : "Never"}
                </div>
              </div>
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <div className="text-muted-foreground mb-0.5">Legacy Trigger Hits</div>
                <div className={`font-medium ${health.legacyRouteAttemptsSinceStartup > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {health.legacyRouteAttemptsSinceStartup} since restart
                </div>
              </div>
              {/* MI-04: Canonical free enrichment queue depth */}
              {typeof health.canonicalFreeEnrichmentQueueDepth === "number" && (
                <div className="rounded-md border bg-muted/10 px-3 py-2">
                  <div className="text-muted-foreground mb-0.5">Canonical Free Enrich Queue</div>
                  <div className="font-medium">
                    {health.canonicalFreeEnrichmentQueueDepth.toLocaleString()} pending
                  </div>
                </div>
              )}
            </div>
          )}
          {freeLaneHealthQuery.data && (
            <div className="mt-3 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Free-only enrichment lane</span>
                <Badge variant="outline" className="text-[10px]">{freeLaneHealthQuery.data.status}</Badge>
              </div>
              <div className="text-muted-foreground mt-1">
                Capability: {freeLaneHealthQuery.data.capabilityGroup} · configured: {String(freeLaneHealthQuery.data.configured)} ·
                running: {String(freeLaneHealthQuery.data.running)} · examined: {freeLaneHealthQuery.data.examined} ·
                enriched: {freeLaneHealthQuery.data.enriched} · skipped: {freeLaneHealthQuery.data.skipped} ·
                failed: {freeLaneHealthQuery.data.failed} · pending: {freeLaneHealthQuery.data.pending}
              </div>
              <div className="text-muted-foreground">Last run: {freeLaneHealthQuery.data.lastRunAt ? new Date(freeLaneHealthQuery.data.lastRunAt).toLocaleString() : "—"} · next run: manual/pilot only</div>
            </div>
          )}
          {health && !health.workerActive && health.minutesSinceLastJob !== null && health.minutesSinceLastJob >= 15 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No enrichment jobs have completed in the last {health.minutesSinceLastJob} minutes.
                The worker may be stalled — use "Reset Stuck Queue Jobs" below if this persists.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Admin Controls card ───────────────────────────────────────────── */}
      {user?.role === "admin" && (
        <Card className="border border-dashed border-muted-foreground/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm text-muted-foreground">Admin Controls</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Pipeline maintenance operations — use with care.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-3">

            {/* Reset stuck queue jobs */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={resetJobsMutation.isPending}
                >
                  {resetJobsMutation.isPending
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />
                  }
                  Reset Stuck Queue Jobs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset stuck enrichment jobs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This resets any sunbiz entities that have been stuck in "processing" state
                    for more than 30 minutes back to "pending", so the enrichment worker can
                    pick them up again on its next tick. Use this if enrichment appears stalled
                    after a worker crash or restart. No other queue jobs are affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetJobsMutation.mutate()}>
                    Reset Jobs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Download enrichment report */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const a = document.createElement("a");
                a.href = "/api/lead-ops/export-enriched";
                a.download = `enriched-leads-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                toast({ title: "Download started", description: "Your enrichment report CSV is being prepared." });
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download Enrichment Report
            </Button>

          </CardContent>
        </Card>
      )}

      {/* ── MI-04: Canonical Business Free Enrichment ────────────────────── */}
      <CanonicalBusinessPanel healthQueueDepth={typeof health?.canonicalFreeEnrichmentQueueDepth === "number" ? health.canonicalFreeEnrichmentQueueDepth : null} />

      {/* ── Enrichment Queue Management ──────────────────────────────────── */}
      <EnrichmentQueuePanel />

      {/* ── AI Intelligence Panel ─────────────────────────────────────────── */}
      <Card className="border-2 border-dashed border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <div>
                <CardTitle className="text-base">AI Lead Intelligence</CardTitle>
                <CardDescription className="text-xs">
                  GPT-powered analysis of your lead pool — segments, outreach strategy, and quick wins.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                onClick={() => aiSegmentMutation.mutate()}
                disabled={aiSegmentMutation.isPending}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                title="Returns a narrative over a random sample. Does not enrich, qualify, or write any records."
              >
                {aiSegmentMutation.isPending
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />
                }
                {aiAnalysis ? "Re-analyze" : "Analyze My Lead Pool"}
              </Button>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-400">
                Diagnostic only
              </Badge>
            </div>
          </div>
        </CardHeader>

        {showAI && aiAnalysis && (
          <CardContent className="pt-0 space-y-5">
            {/* Executive summary */}
            <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
              <p className="text-sm leading-relaxed">{aiAnalysis.summary}</p>
            </div>

            {/* Segments + recommendations grid */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Priority segments */}
              {aiAnalysis.segments.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Target className="h-4 w-4 text-purple-600" />
                    Priority Segments
                  </h3>
                  <div className="space-y-2">
                    {aiAnalysis.segments.slice(0, 5).map((seg, i) => (
                      <div key={i} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex items-start gap-2.5">
                        <div className="text-xs font-bold text-muted-foreground mt-0.5 w-4 shrink-0">#{i + 1}</div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate">{seg.name}</span>
                            {seg.score && <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${scoreBadge(seg.score)}`}>{seg.score}</Badge>}
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {seg.channel}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{seg.angle}</p>
                          {seg.estimatedCount > 0 && (
                            <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                              ~{seg.estimatedCount.toLocaleString()} leads
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              <div className="space-y-4">
                {aiAnalysis.recommendations.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Do This Today
                    </h3>
                    <div className="space-y-1.5">
                      {aiAnalysis.recommendations.map((rec, i) => (
                        <div key={i} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex items-start gap-2">
                          <ArrowRight className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                          <p className="text-xs leading-relaxed">{rec}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiAnalysis.quickWins.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">⚡ Quick Wins (&lt;30 min)</h3>
                    <div className="space-y-1.5">
                      {aiAnalysis.quickWins.map((win, i) => (
                        <div key={i} className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 rounded px-3 py-2 border border-amber-200 dark:border-amber-800">
                          {win}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Outreach priority */}
            {aiAnalysis.outreachPriority.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Outreach Priority by Vertical</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {aiAnalysis.outreachPriority.map((op, i) => (
                    <div key={i} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                      <div className="font-medium text-sm">{op.vertical}</div>
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">{op.estimatedCloseRate}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{op.whyNow}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Filters + bulk actions toolbar ───────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, owner, email…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterScore} onValueChange={(v) => { setFilterScore(v); setPage(0); }}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue placeholder="All scores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scores</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterVertical} onValueChange={(v) => { setFilterVertical(v); setPage(0); }}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="All verticals" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verticals</SelectItem>
            {(stats?.verticals || []).slice(0, 20).map((v: any) => (
              <SelectItem key={v.vertical} value={v.vertical}>{v.vertical} ({v.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={filterContactable ? "default" : "outline"}
          size="sm" className="h-9"
          onClick={() => { setFilterContactable(!filterContactable); setFilterNoContact(false); setPage(0); }}
        >
          Has Contact Info
        </Button>

        <Button
          variant={filterNoContact ? "default" : "outline"}
          size="sm" className="h-9"
          onClick={() => { setFilterNoContact(!filterNoContact); setFilterContactable(false); setPage(0); }}
        >
          <AlertTriangle className="h-3.5 w-3.5 mr-1 text-amber-500" />
          No Contact Info
        </Button>

        <Select value={filterTag} onValueChange={(v) => { setFilterTag(v); setPage(0); }}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="All leads" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leads</SelectItem>
            <SelectItem value="quiz_lead">Quiz Leads</SelectItem>
          </SelectContent>
        </Select>

        {/* Bulk action buttons */}
        {someSelected && (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l">
            <span className="text-sm font-medium text-muted-foreground">
              {selectedIds.size} selected
            </span>
            {/* Legacy bulk enrichment always throws (CRO-03 provider transport disabled);
                disabled here instead of left clickable-but-broken. */}
            <Button
              size="sm" className="h-9 gap-1.5"
              disabled
              title="Legacy bulk enrichment is retired — CRO-03 provider transport is disabled."
            >
              <Sparkles className="h-3.5 w-3.5" />
              Enrich Selected (retired)
            </Button>
            <Button
              size="sm" variant="outline" className="h-9 gap-1.5"
              onClick={() => convertToProspectsMutation.mutate(Array.from(selectedIds))}
              disabled={convertToProspectsMutation.isPending}
            >
              {convertToProspectsMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
              Convert to Prospects
            </Button>
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        )}

        <div className="ml-auto flex gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              This trigger is deprecated. Enrichment runs automatically via the{" "}
              <button
                className="underline font-medium hover:no-underline"
                onClick={() => document.getElementById("pipeline-health-card")?.scrollIntoView({ behavior: "smooth" })}
              >
                scheduled pipeline
              </button>
              .
            </span>
          </div>
        </div>
      </div>

      {/* ── Results count ─────────────────────────────────────────────────── */}
      <div className="text-sm text-muted-foreground">
        {entitiesQuery.isLoading
          ? "Loading…"
          : `${total.toLocaleString()} leads matching current filters · Page ${page + 1} of ${Math.max(1, totalPages)}`
        }
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entitiesQuery.isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : entities.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                        No leads match your current filters.
                      </TableCell>
                    </TableRow>
                  )
                  : entities.map((entity) => {
                      const email = entity.owner_email || entity.email;
                      const phone = entity.owner_phone || entity.phone;
                      const ownerName = entity.owner_name;
                      return (
                        <TableRow
                          key={entity.id}
                          className={selectedIds.has(entity.id) ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(entity.id)}
                              onCheckedChange={() => toggleOne(entity.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px]">
                            <div className="truncate" title={entity.entity_name}>{entity.entity_name}</div>
                            {entity.website && (
                              <a href={entity.website.startsWith("http") ? entity.website : `https://${entity.website}`}
                                 target="_blank" rel="noopener noreferrer"
                                 className="text-[10px] text-blue-500 hover:underline truncate block">
                                {entity.website}
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {entity.principal_city || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ownerName || <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {email
                              ? <a href={`mailto:${email}`} className="text-blue-600 hover:underline text-xs">{email}</a>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </TableCell>
                          <TableCell className="text-sm text-nowrap">
                            {phone
                              ? <a href={`tel:${phone}`} className="text-blue-600 hover:underline text-xs">{phone}</a>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </TableCell>
                          <TableCell>
                            {entity.vertical
                              ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">{entity.vertical}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </TableCell>
                          <TableCell>
                            {entity.score
                              ? <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${scoreBadge(entity.score)}`}>{entity.score}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>
                            }
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusBadge(entity.enrichment_status)}`}>
                              {entity.enrichment_status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              title="Re-enrich this lead (retired — CRO-03 provider transport disabled)"
                              disabled
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline" size="sm" disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline" size="sm" disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="gap-1.5"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
        </TabsContent>

        {/* ── South Florida Prospecting tab ──────────────────────────────── */}
        <TabsContent value="sfp" className="space-y-4">
          <SouthFloridaProspectingPanel />
        </TabsContent>

        {/* ── MI-09: Pilot Status tab (legacy) ────────────────────────── */}
        <TabsContent value="pilot" className="space-y-4">
          <PilotStatusPanel />
        </TabsContent>

        {/* ── Health tab ─────────────────────────────────────────────────── */}
        <TabsContent value="health" className="space-y-4">
          <ProgramHealthPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── MI-09: Pilot Status Panel — guided production operator workflow ────────
//
// This panel is a thin, ordered UI over the existing MI-09 pilot lifecycle
// service (server/services/mi09-pilot-authority.ts) and its routes
// (server/routes/lead-ops.ts). It never fabricates state on the client: every
// number shown (release SHA, migration head, pause epoch, spend) is read
// straight from the server. All mutating actions are gated by the run's
// actual state so an operator cannot skip a step the server would reject
// anyway — the server-side checks remain the real authority.
const PAID_BUDGET_CONFIRMATION = "AUTHORIZE $50 PAID PILOT";

function usdFromMicros(micros: number | undefined | null): string {
  return `$${((Number(micros ?? 0)) / 1_000_000).toFixed(2)}`;
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === "completed" ? "bg-green-100 text-green-800" :
    state === "running"   ? "bg-blue-100 text-blue-800" :
    state === "stopped"   ? "bg-red-100 text-red-800" :
    state === "paused"    ? "bg-yellow-100 text-yellow-800" :
    "bg-gray-100 text-gray-800";
  return <span className={`px-1.5 py-0.5 rounded-full font-medium text-xs ${cls}`}>{state}</span>;
}

function PilotStatusPanel() {
  const { toast } = useToast();
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [reconciliationReport, setReconciliationReport] = useState<any>(null);
  const [budgetConfirmText, setBudgetConfirmText] = useState("");
  const [newDefLevel, setNewDefLevel] = useState<"1" | "2" | "3">("1");
  const [newDefCounties, setNewDefCounties] = useState("");
  const [newDefVerticals, setNewDefVerticals] = useState("");
  const [newDefSourceAdapters, setNewDefSourceAdapters] = useState("");
  const [newDefMaxCohort, setNewDefMaxCohort] = useState("25");
  const [newDefProviders, setNewDefProviders] = useState<Record<string, boolean>>({
    serper: false, outscraper: false, openai: false, apollo: false, zerobounce: false,
  });
  const [newRunDefId, setNewRunDefId] = useState<string>("");

  const preflightQuery = useQuery<{ passed: boolean; checks: Record<string, { passed: boolean; detail?: string }> }>({
    queryKey: ["/api/lead-ops/pilot/preflight"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/preflight", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const runsQuery = useQuery<any[]>({
    queryKey: ["/api/lead-ops/pilot/runs"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/runs", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 15_000,
  });

  const defsQuery = useQuery<any[]>({
    queryKey: ["/api/lead-ops/pilot/definitions"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/definitions", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const budgetQuery = useQuery<{ summary: any; authorization: any }>({
    queryKey: ["/api/lead-ops/pilot/budget-summary"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/budget-summary", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const scheduleDefsQuery = useQuery<any[]>({
    queryKey: ["/api/admin/cro08a/schedule-definitions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/cro08a/schedule-definitions", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const poolAuthorityQuery = useQuery<{ decision: { pool: string; decidedBy: string; decidedAt: string; revision: number } | null }>({
    queryKey: ["/api/lead-ops/pilot/pool-authority"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/pool-authority", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const statusOverviewQuery = useQuery<any>({
    queryKey: ["/api/lead-ops/pilot/status-overview"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/status-overview", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const activationReadinessQuery = useQuery<{ readiness: { ready: boolean; gates: { key: string; passed: boolean; detail: string }[] }; authorization: any; scope: string; pilotScope: string; recurrenceScope: string }>({
    queryKey: ["/api/lead-ops/pilot/activation-readiness"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/activation-readiness", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 20_000,
  });
  const [activationConfirmText, setActivationConfirmText] = useState("");

  const pricingScheduleQuery = useQuery<{
    source: string; snapshotId: string; currentVersion: number; capturedBy: string; capturedAt: string; expiresAt: string;
    compositeHash: string;
    priceSchedules: Record<string, { version: number; unitType: string; currency: string; amountMicros: number; billingSemantics: string }>;
  }>({
    queryKey: ["/api/lead-ops/pilot/pricing-schedule"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/pilot/pricing-schedule", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const invalidatePilot = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/preflight"] });
    queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/runs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/definitions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/budget-summary"] });
  };

  const errToast = (err: unknown) => {
    toast({ title: "Action failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
  };

  const setPoolAuthorityMutation = useMutation({
    mutationFn: async (pool: "master_leads" | "prospects") => {
      const res = await apiRequest("PUT", "/api/lead-ops/pilot/pool-authority", { pool });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pool authority updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/pool-authority"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/preflight"] });
    },
    onError: errToast,
  });

  const authorizeActivationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/lead-ops/pilot/activation-readiness", { typedConfirmation: activationConfirmText });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Selective activation authorized (record only — BACKGROUND_JOB_PROFILE unchanged)" });
      setActivationConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/activation-readiness"] });
    },
    onError: errToast,
  });

  const createDefMutation = useMutation({
    mutationFn: async () => {
      const county = newDefCounties.split(",").map((s) => s.trim()).filter(Boolean);
      const vertical = newDefVerticals.split(",").map((s) => s.trim()).filter(Boolean);
      const sourceAdapters = newDefSourceAdapters.split(",").map((s) => s.trim()).filter(Boolean);
      const level = Number(newDefLevel);
      const res = await apiRequest("POST", "/api/lead-ops/pilot/definitions", {
        level,
        countyScope: county,
        verticalScope: vertical,
        sourceAdapterFilter: sourceAdapters,
        maxCohortSize: Number(newDefMaxCohort),
        enrichmentRecipeVersion: 1,
        // Selecting a provider here is only a proposal — the server
        // independently rejects any provider missing its secret or pricing
        // artifact, or (for level 1) any paid provider at all.
        paidProvidersAllowed: level === 1
          ? {}
          : Object.fromEntries(Object.entries(newDefProviders).filter(([, v]) => v)),
        stopConditionThresholds: {
          conflictPct: 5,
          apolloYieldPct: 0,
          zbUnknownPct: 20,
          spendCapMicros: level === 1 ? 0 : 50_000_000,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Pilot definition created" }); invalidatePilot(); },
    onError: errToast,
  });

  const createRunMutation = useMutation({
    mutationFn: async () => {
      if (!newRunDefId) throw new Error("Select a pilot definition first");
      const def = (defsQuery.data ?? []).find((d: any) => String(d.id) === newRunDefId);
      const preflight = preflightQuery.data as any;
      if (!preflight?.releaseSha || preflight.releaseSha === "unknown") {
        throw new Error("Cannot create a run: server did not report a release SHA (RELEASE_SHA env var missing)");
      }
      const res = await apiRequest("POST", "/api/lead-ops/pilot/runs", {
        pilotDefinitionId: newRunDefId,
        releaseSha: preflight.releaseSha,
        cro03cSelectionPolicyVersion: 1,
        cro03cRoutingPolicyVersion: 1,
        cro03cRecipeVersion: def?.enrichment_recipe_version ?? 1,
        outboundPauseEpoch: preflight.outboundPauseEpoch,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Pilot run created (draft)" }); invalidatePilot(); },
    onError: errToast,
  });

  const selectCohortMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/lead-ops/pilot/runs/${runId}/select-cohort`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.frozen ? "Cohort frozen" : "Cohort already frozen", description: `Selected ${data.selectedCount || ""} businesses from ${data.eligiblePoolSize ?? "?"} in scope.` });
      invalidatePilot();
    },
    onError: errToast,
  });

  const selectRoiCohortMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/lead-ops/pilot/runs/${runId}/select-roi-cohort`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.frozen ? "ROI cohort frozen" : "ROI cohort already frozen",
        description: `Selected ${data.selectedCount || 0} of ${data.eligiblePoolSize ?? "?"} eligible businesses — top ROI-ranked from South Florida / five verticals. master_leads = 0 is OK.`,
      });
      invalidatePilot();
    },
    onError: errToast,
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ runId, toState, stopReason }: { runId: string; toState: string; stopReason?: string }) => {
      const res = await apiRequest("POST", `/api/lead-ops/pilot/runs/${runId}/transition`, { toState, stopReason });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { invalidatePilot(); },
    onError: errToast,
  });

  const advanceMutation = useMutation({
    mutationFn: async ({ runId, fromLevel, toLevel }: { runId: string; fromLevel: number; toLevel: number }) => {
      const res = await apiRequest("POST", `/api/lead-ops/pilot/runs/${runId}/advance`, {
        fromLevel, toLevel, idempotencyKey: crypto.randomUUID(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Advancement receipt issued" }); invalidatePilot(); },
    onError: errToast,
  });

  const reconciliationMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", "/api/lead-ops/pilot/reconciliation-reports", { pilotRunId: runId });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setReconciliationReport(data);
      toast({ title: "Reconciliation report generated and saved" });
    },
    onError: errToast,
  });

  const authorizeBudgetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lead-ops/pilot/authorize-paid-budget", { typedConfirmation: budgetConfirmText });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Paid budget authorized ($50 aggregate cap)" }); setBudgetConfirmText(""); queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/budget-summary"] }); },
    onError: errToast,
  });

  const emergencyStopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lead-ops/pilot/emergency-stop-paid", { reason: "operator_emergency_stop" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "All paid providers stopped",
        description: `Disabled ${data.providersDisabled ?? 0} provider control(s); ${data.inFlightCount ?? 0} in-flight operation(s) require reconciliation.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/budget-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/status-overview"] });
    },
    onError: errToast,
  });

  const activateScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/cro08a/schedule-definitions/${id}/activate`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Schedule activated" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/cro08a/schedule-definitions"] }); },
    onError: errToast,
  });

  const deactivateScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/cro08a/schedule-definitions/${id}/deactivate`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Schedule deactivated" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/cro08a/schedule-definitions"] }); },
    onError: errToast,
  });

  // Repeated execute-phase calls until the phase reports complete:true.
  const runExecuteLoop = useCallback(async (runId: string) => {
    setExecutingRunId(runId);
    try {
      let complete = false;
      let totalProcessed = 0;
      let guard = 0;
      while (!complete && guard < 500) {
        guard++;
        const res = await apiRequest("POST", `/api/lead-ops/pilot/runs/${runId}/execute-phase`, { phase: "enrichment", batchSize: 50 }, { "Idempotency-Key": crypto.randomUUID() });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        totalProcessed += data.processed ?? 0;
        complete = !!data.complete;
      }
      toast({ title: "Enrichment phase complete", description: `Processed ${totalProcessed} cohort member(s).` });
    } catch (err) {
      errToast(err);
    } finally {
      setExecutingRunId(null);
      invalidatePilot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preflight = preflightQuery.data;
  const runs = runsQuery.data ?? [];
  const defs = defsQuery.data ?? [];
  const budget = budgetQuery.data?.summary;
  const budgetAuth = budgetQuery.data?.authorization;
  const budgetAuthorized = !!budgetAuth && !budgetAuth.revokedAt;

  const checkEntries = preflight ? Object.entries(preflight.checks) : [];
  const passedCount = checkEntries.filter(([, c]) => c.passed).length;

  return (
    <div className="space-y-4">
      {/* Production verification — server-resolved, never user-entered */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Production Verification</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {checkEntries.filter(([k]) => ["releaseSha", "migrationHead", "outboundPaused", "poolAuthorityDecided"].includes(k)).map(([key, check]) => (
            <div key={key} className="rounded border p-2">
              <div className="text-muted-foreground font-mono">{key}</div>
              <div className={check.passed ? "text-green-600" : "text-red-500"}>{check.detail ?? (check.passed ? "OK" : "missing")}</div>
            </div>
          ))}
          <div className="rounded border p-2">
            <div className="text-muted-foreground font-mono">aggregatePaidBudget</div>
            <div className={budget?.overCap ? "text-red-500" : "text-green-600"}>
              {budget ? `${usdFromMicros(budget.settledMicros + budget.reservedMicros)} / ${usdFromMicros(budget.capMicros)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Pool authority — owner-only decision of which pool MI-09 treats as authoritative */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Pool Authority</h3>
        <p className="text-xs text-muted-foreground">
          Determines whether MI-09 pilots and free enrichment treat <code>master_leads</code> or <code>prospects</code> as the
          authoritative pool for downstream sales handoff. Owner-only; every change is written to the audit log.
        </p>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">Current:</span>
          <span className="font-mono px-2 py-0.5 rounded bg-muted">
            {poolAuthorityQuery.data?.decision?.pool ?? "not yet decided"}
          </span>
          {poolAuthorityQuery.data?.decision && (
            <span className="text-muted-foreground">
              (rev {poolAuthorityQuery.data.decision.revision}, by {poolAuthorityQuery.data.decision.decidedBy}, {new Date(poolAuthorityQuery.data.decision.decidedAt).toLocaleString()})
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={poolAuthorityQuery.data?.decision?.pool === "master_leads" ? "default" : "outline"}
            onClick={() => setPoolAuthorityMutation.mutate("master_leads")}
            disabled={setPoolAuthorityMutation.isPending}
            data-testid="button-pool-authority-master-leads"
          >
            Set master_leads authoritative
          </Button>
          <Button
            size="sm"
            variant={poolAuthorityQuery.data?.decision?.pool === "prospects" ? "default" : "outline"}
            onClick={() => setPoolAuthorityMutation.mutate("prospects")}
            disabled={setPoolAuthorityMutation.isPending}
            data-testid="button-pool-authority-prospects"
          >
            Set prospects authoritative
          </Button>
        </div>
      </div>

      {/* Full telemetry snapshot */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">System Telemetry</h3>
        {statusOverviewQuery.isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
        {statusOverviewQuery.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">RELEASE_SHA</div>
              <div className="font-mono truncate">{statusOverviewQuery.data.releaseSha}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Background job profile</div>
              <div className={statusOverviewQuery.data.backgroundJobProfile === "off" ? "text-green-600" : "text-amber-600"}>
                {statusOverviewQuery.data.backgroundJobProfile}
              </div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Canonical businesses</div>
              <div>{statusOverviewQuery.data.eligibleCounts?.canonical_businesses ?? "—"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Canonical, non-DBPR</div>
              <div>{statusOverviewQuery.data.eligibleCounts?.canonical_non_dbpr_businesses ?? "—"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Excluded businesses</div>
              <div>{statusOverviewQuery.data.eligibleCounts?.excluded_businesses ?? "—"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Free enrichment complete</div>
              <div>{statusOverviewQuery.data.eligibleCounts?.free_enrichment_complete ?? "—"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">master_leads rows</div>
              <div>{statusOverviewQuery.data.eligibleCounts?.master_leads_count ?? "—"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Aggregate spend</div>
              <div>{usdFromMicros((statusOverviewQuery.data.aggregateBudget?.settledMicros ?? 0) + (statusOverviewQuery.data.aggregateBudget?.reservedMicros ?? 0))} / {usdFromMicros(statusOverviewQuery.data.aggregateBudget?.capMicros ?? 0)}</div>
            </div>
          </div>
        )}
        {statusOverviewQuery.data?.zbOutcomes?.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">ZeroBounce outcomes (contacts.email_status)</div>
            <div className="flex flex-wrap gap-1">
              {statusOverviewQuery.data.zbOutcomes.map((o: any) => (
                <span key={o.email_status} className="text-xs px-2 py-0.5 rounded bg-muted font-mono">{o.email_status}: {o.cnt}</span>
              ))}
            </div>
          </div>
        )}
        {statusOverviewQuery.data?.spendByProvider?.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Spend by provider</div>
            <div className="flex flex-wrap gap-1">
              {statusOverviewQuery.data.spendByProvider.map((p: any) => (
                <span key={p.provider} className="text-xs px-2 py-0.5 rounded bg-muted font-mono">
                  {p.provider}: {usdFromMicros(p.settledMicros + p.reservedMicros)} ({p.operationCount} ops)
                </span>
              ))}
            </div>
          </div>
        )}
        {statusOverviewQuery.data?.providerControls?.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">Paid Provider Controls</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {statusOverviewQuery.data.providerControls.map((p: any) => (
                <div key={p.provider} className={`rounded border p-2 text-xs ${p.circuitState !== "closed" || !p.enabled ? "border-red-200 bg-red-50/50" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between font-semibold">
                    <span className="capitalize">{p.provider}</span>
                    <span className={p.enabled && p.circuitState === "closed" ? "text-green-700" : "text-red-700"}>
                      {p.enabled ? "enabled" : "disabled"} · {p.circuitState}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 mt-1 font-mono text-[11px]">
                    <span>credential: {String(p.credentialPresent)}</span>
                    <span>cap: {p.budgetCapUnits ?? "—"}</span>
                    <span>reserved: {p.reservedUnits ?? 0}</span>
                    <span>consumed: {p.consumedUnits ?? 0}</span>
                    <span className="col-span-2 truncate">price: {p.currentPriceArtifactReference ?? "unavailable"}</span>
                    <span className="col-span-2">last: {p.lastCallAt ? `${p.lastOutcome ?? "unknown"} @ ${new Date(p.lastCallAt).toLocaleString()}` : "none"}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    purposes: {(p.authorizedPurposes ?? []).join(", ") || "none"}
                  </div>
                  <div className="truncate text-muted-foreground" title={(p.authorizedCallers ?? []).join(", ")}>
                    callers: {(p.authorizedCallers ?? []).join(", ") || "none"}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Credentials are presence booleans only. In-flight operations requiring reconciliation:{" "}
              <span className="font-semibold">{statusOverviewQuery.data.paidInFlightCount ?? 0}</span>
            </div>
          </div>
        )}
        {statusOverviewQuery.data?.zeroBounceSafety && (
          <div className="rounded border p-2 text-xs">
            <div className="font-semibold">ZeroBounce automatic lane</div>
            <div className="font-mono mt-1">
              {statusOverviewQuery.data.zeroBounceSafety.autoRunEnabled ? "enabled" : "disabled"} · next run{" "}
              {new Date(statusOverviewQuery.data.zeroBounceSafety.nextAutomaticRunAt).toLocaleString()}
            </div>
          </div>
        )}
        <Button
          size="sm"
          variant="destructive"
          disabled={emergencyStopMutation.isPending}
          onClick={() => emergencyStopMutation.mutate()}
          data-testid="button-paid-provider-emergency-stop"
        >
          <ShieldAlert className="h-3.5 w-3.5 mr-1" />
          Emergency stop all paid providers
        </Button>
      </div>

      {/* Final operator-gated activation step (corrective item 10) */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Selective Activation Readiness</h3>
        <p className="text-xs text-muted-foreground">
          Pilot scope (use this to authorize the bounded pilot run — no recurring enrichment):{" "}
          <code className="font-mono">{activationReadinessQuery.data?.pilotScope ?? "selective:enrichment,free-enrichment-lane,provider-live,email-validation"}</code>.
          Authorizing here only records your decision — it does not change <code>BACKGROUND_JOB_PROFILE</code> or start any worker.
          To actually go live for the pilot, set that secret to the pilot scope above yourself after Publish, then restart.
        </p>
        <p className="text-xs text-muted-foreground border-t pt-2">
          Recurrence scope (separate decision — adds <code className="font-mono">continuous-enrichment</code>; do not use this for a pilot):{" "}
          <code className="font-mono">{activationReadinessQuery.data?.recurrenceScope ?? "selective:enrichment,free-enrichment-lane,provider-live,email-validation,continuous-enrichment"}</code>.
          Only apply this profile if you are deliberately turning on ongoing recurring enrichment on top of a completed, reviewed pilot — never as part of authorizing the pilot itself.
        </p>
        {activationReadinessQuery.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {activationReadinessQuery.data.readiness.gates.map((g) => (
              <div key={g.key} className="rounded border p-2">
                <div className="text-muted-foreground font-mono">{g.key}</div>
                <div className={g.passed ? "text-green-600" : "text-red-500"}>{g.detail}</div>
              </div>
            ))}
          </div>
        )}
        {activationReadinessQuery.data?.authorization ? (
          <div className="text-xs text-green-700 dark:text-green-400">
            Authorized by {activationReadinessQuery.data.authorization.authorizedBy} at{" "}
            {new Date(activationReadinessQuery.data.authorization.authorizedAt).toLocaleString()}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={activationConfirmText}
              onChange={(e) => setActivationConfirmText(e.target.value)}
              placeholder="Type: AUTHORIZE SELECTIVE ACTIVATION"
              className="text-xs h-8 max-w-xs"
              data-testid="input-activation-confirm"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={!activationReadinessQuery.data?.readiness.ready || authorizeActivationMutation.isPending || activationConfirmText !== "AUTHORIZE SELECTIVE ACTIVATION"}
              onClick={() => authorizeActivationMutation.mutate()}
              data-testid="button-authorize-activation"
            >
              Record activation authorization
            </Button>
          </div>
        )}
      </div>

      {/* Preflight checklist */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Pre-Pilot Checklist</h3>
          {preflight && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${preflight.passed ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}>
              {passedCount}/{checkEntries.length} passed
            </span>
          )}
        </div>
        {preflightQuery.isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
        {preflightQuery.isError && <p className="text-xs text-red-500">Failed to load preflight checklist</p>}
        {checkEntries.length > 0 && (
          <div className="grid gap-1">
            {checkEntries.map(([key, check]) => (
              <div key={key} className="flex items-start gap-2 text-xs">
                <span className={check.passed ? "text-green-600" : "text-red-500"}>
                  {check.passed ? "✓" : "✗"}
                </span>
                <span className="font-mono">{key}</span>
                {check.detail && <span className="text-muted-foreground">{check.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Aggregate paid budget & emergency stop */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Aggregate Paid Budget (Level 2–3, all providers combined)</h3>
        {budget && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border p-2"><div className="text-muted-foreground">Settled</div><div className="font-mono">{usdFromMicros(budget.settledMicros)}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Reserved (in-flight)</div><div className="font-mono">{usdFromMicros(budget.reservedMicros)}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Remaining</div><div className="font-mono">{usdFromMicros(budget.remainingMicros)}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Cap</div><div className="font-mono">{usdFromMicros(budget.capMicros)}</div></div>
            {budget.byProvider?.map((p: any) => (
              <div key={p.provider} className="rounded border p-2 col-span-2">
                <div className="text-muted-foreground">{p.provider}</div>
                <div className="font-mono">settled {usdFromMicros(p.settledMicros)} · reserved {usdFromMicros(p.reservedMicros)} · {p.operationCount} ops</div>
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Status: {budgetAuthorized ? <span className="text-green-600 font-medium">Authorized by {budgetAuth.authorizedBy} at {new Date(budgetAuth.authorizedAt).toLocaleString()}</span> : <span className="text-red-500 font-medium">Not authorized — paid Level 2/3 phases are blocked</span>}
        </div>
        {!budgetAuthorized && (
          <div className="flex items-center gap-2">
            <Input
              value={budgetConfirmText}
              onChange={(e) => setBudgetConfirmText(e.target.value)}
              placeholder={PAID_BUDGET_CONFIRMATION}
              className="text-xs h-8 max-w-xs font-mono"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={budgetConfirmText !== PAID_BUDGET_CONFIRMATION || authorizeBudgetMutation.isPending}
              onClick={() => authorizeBudgetMutation.mutate()}
            >
              Authorize $50 Paid Pilot
            </Button>
          </div>
        )}
        {budgetAuthorized && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive"><ShieldAlert className="h-3.5 w-3.5 mr-1" /> Emergency Stop All Paid Providers</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop all paid pilot enrichment?</AlertDialogTitle>
                <AlertDialogDescription>
                  This disables Serper, Outscraper, OpenAI, Apollo, and ZeroBounce, turns off automatic ZeroBounce,
                  deactivates recurring CRO-08A schedules, and leaves in-flight operations visible for reconciliation.
                  It does not change the global outbound-pause state.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => emergencyStopMutation.mutate()}>Stop paid enrichment</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Pilot definitions */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Pilot Definitions ({defs.length})</h3>
        {defs.map((d: any) => (
          <div key={d.id} className="rounded border p-2 text-xs font-mono space-y-0.5">
            <div className="font-semibold">Level {d.level} — {d.pilot_definition_hash?.slice(0, 12)}…</div>
            <div className="text-muted-foreground">Counties: {JSON.stringify(d.county_scope)}</div>
            <div className="text-muted-foreground">Verticals: {JSON.stringify(d.vertical_scope)}</div>
            <div className="text-muted-foreground">Source adapters: {JSON.stringify(d.source_adapter_filter)}</div>
            <div className="text-muted-foreground">Max cohort: {d.max_cohort_size}</div>
            <div className="text-muted-foreground">Paid providers: {JSON.stringify(d.paid_providers_allowed)}</div>
          </div>
        ))}
        <div className="rounded border border-dashed p-3 space-y-2">
          <div className="text-xs font-semibold">Create pilot definition</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select value={newDefLevel} onValueChange={(v) => setNewDefLevel(v as any)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Level 1 (free only)</SelectItem>
                <SelectItem value="2">Level 2 (paid)</SelectItem>
                <SelectItem value="3">Level 3 (paid)</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-8 text-xs" placeholder="Counties (FIPS, comma-sep)" value={newDefCounties} onChange={(e) => setNewDefCounties(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="Verticals (comma-sep)" value={newDefVerticals} onChange={(e) => setNewDefVerticals(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="Source adapters (comma-sep)" value={newDefSourceAdapters} onChange={(e) => setNewDefSourceAdapters(e.target.value)} />
            <Input className="h-8 text-xs" type="number" placeholder="Max cohort size" value={newDefMaxCohort} onChange={(e) => setNewDefMaxCohort(e.target.value)} />
          </div>
          {newDefLevel !== "1" && (
            <div className="space-y-1">
              <div className="rounded border bg-muted/20 p-2 text-xs">
                <div className="font-semibold">Pricing authority</div>
                {pricingScheduleQuery.data ? (
                  <div className="text-muted-foreground">
                    DB snapshot v{pricingScheduleQuery.data.currentVersion ?? "—"} ·
                    captured by {pricingScheduleQuery.data.capturedBy} ·
                    {new Date(pricingScheduleQuery.data.capturedAt).toLocaleString()} ·
                    source: {pricingScheduleQuery.data.source} · expires {new Date(pricingScheduleQuery.data.expiresAt).toLocaleString()}
                  </div>
                ) : pricingScheduleQuery.isLoading ? (
                  <div className="text-muted-foreground">Loading reviewed pricing schedule…</div>
                ) : (
                  <div className="text-destructive">Pricing unavailable — provider selection is blocked.</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Paid providers to allow (selecting a provider here only proposes it — the server independently rejects any provider missing its API secret or a recorded pricing artifact):
              </div>
              <div className="flex flex-wrap gap-3">
                {(["serper", "outscraper", "openai", "apollo", "zerobounce"] as const).map((p) => {
                  const price = pricingScheduleQuery.data?.priceSchedules?.[p];
                  return (
                    <label key={p} className="flex items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={!!newDefProviders[p]}
                        onCheckedChange={(checked) => setNewDefProviders((prev) => ({ ...prev, [p]: !!checked }))}
                      />
                      {p}
                      {price ? (
                        <span className="text-muted-foreground">
                          (${(price.amountMicros / 1_000_000).toFixed(4)}/{price.unitType})
                        </span>
                      ) : pricingScheduleQuery.isError ? (
                        <span className="text-destructive">(pricing unavailable)</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <Button size="sm" disabled={createDefMutation.isPending || !newDefSourceAdapters.trim()} onClick={() => createDefMutation.mutate()}>Create Definition</Button>
        </div>
      </div>

      {/* Active pilot runs */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Pilot Runs ({runs.length})</h3>
        {runs.length === 0 && <p className="text-xs text-muted-foreground">No pilot runs yet. Complete the preflight checklist first.</p>}
        {runs.map((r: any) => (
          <div key={r.id} className="rounded border p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold font-mono">Level {r.level} — {r.id?.slice(0, 8)}…</span>
              <StateBadge state={r.state} />
            </div>
            <div className="text-muted-foreground">Started: {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</div>
            <div className="text-muted-foreground">Release SHA: {r.release_sha?.slice(0, 12)}…</div>
            {r.cohort_frozen_hash && <div className="text-muted-foreground">Cohort frozen: ✓ {String(r.cohort_frozen_hash).slice(0, 12)}…</div>}
            {r.stop_reason && <div className="text-red-600">Stop reason: {r.stop_reason}</div>}
            <div className="flex flex-wrap gap-2 pt-1">
              {r.state === "draft" && !r.cohort_frozen_hash && r.level === 1 && (
                <Button size="sm" variant="outline" disabled={selectRoiCohortMutation.isPending} onClick={() => selectRoiCohortMutation.mutate(r.id)}>
                  Select ROI Cohort (Level 1)
                </Button>
              )}
              {r.state === "draft" && !r.cohort_frozen_hash && r.level !== 1 && (
                <Button size="sm" variant="outline" disabled={selectCohortMutation.isPending} onClick={() => selectCohortMutation.mutate(r.id)}>Select &amp; Freeze Cohort</Button>
              )}
              {r.state === "draft" && r.cohort_frozen_hash && (
                <Button size="sm" onClick={() => transitionMutation.mutate({ runId: r.id, toState: "running" })}>Start Run</Button>
              )}
              {r.state === "running" && (
                <Button size="sm" disabled={executingRunId === r.id} onClick={() => runExecuteLoop(r.id)}>
                  {executingRunId === r.id ? "Executing…" : "Run Enrichment Phase"}
                </Button>
              )}
              {r.state === "running" && (
                <Button size="sm" variant="outline" onClick={() => transitionMutation.mutate({ runId: r.id, toState: "paused" })}>Pause</Button>
              )}
              {r.state === "paused" && (
                <Button size="sm" onClick={() => transitionMutation.mutate({ runId: r.id, toState: "running" })}>Resume</Button>
              )}
              {["running", "paused"].includes(r.state) && (
                <Button size="sm" variant="outline" onClick={() => transitionMutation.mutate({ runId: r.id, toState: "completed" })}>Mark Completed</Button>
              )}
              {["draft", "running", "paused"].includes(r.state) && (
                <Button size="sm" variant="destructive" onClick={() => transitionMutation.mutate({ runId: r.id, toState: "stopped", stopReason: "operator_stop" })}>Stop</Button>
              )}
              {r.level < 3 && ["running", "paused", "completed"].includes(r.state) && (
                <Button size="sm" variant="outline" onClick={() => advanceMutation.mutate({ runId: r.id, fromLevel: r.level, toLevel: r.level + 1 })}>
                  Advance to Level {r.level + 1}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => reconciliationMutation.mutate(r.id)}>Save Reconciliation Report</Button>
            </div>
          </div>
        ))}
        <div className="rounded border border-dashed p-3 space-y-2">
          <div className="text-xs font-semibold">Create pilot run</div>
          <div className="flex gap-2">
            <Select value={newRunDefId} onValueChange={setNewRunDefId}>
              <SelectTrigger className="h-8 text-xs w-64"><SelectValue placeholder="Choose definition" /></SelectTrigger>
              <SelectContent>
                {defs.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>Level {d.level} — {String(d.pilot_definition_hash).slice(0, 10)}…</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!newRunDefId || createRunMutation.isPending} onClick={() => createRunMutation.mutate()}>Create Run</Button>
          </div>
        </div>
      </div>

      {reconciliationReport?.reportData && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Reconciliation report</h3>
            <span className="text-xs text-muted-foreground font-mono">
              {reconciliationReport.reportData.pilotRun?.id} · {new Date(reconciliationReport.reportData.generatedAt).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="rounded border p-2"><div className="text-muted-foreground">Cohort</div><div className="font-semibold">{reconciliationReport.reportData.cohortComposition?.total ?? 0}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Commands</div><div className="font-semibold">{reconciliationReport.reportData.issuedCommands?.length ?? 0}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Operations</div><div className="font-semibold">{reconciliationReport.reportData.resultingOperations?.length ?? 0}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Receipts</div><div className="font-semibold">{reconciliationReport.reportData.receipts?.length ?? 0}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground">Settled spend</div><div className="font-semibold">{usdFromMicros(reconciliationReport.reportData.spend?.totalSettledMicros)}</div></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div><div className="font-medium mb-1">Outcomes</div>{(reconciliationReport.reportData.outcomes ?? []).map((row: any) => <div key={row.outcome} className="flex justify-between border-b py-1"><span>{row.outcome}</span><span>{row.count}</span></div>)}</div>
            <div><div className="font-medium mb-1">Staging results</div>{(reconciliationReport.reportData.stagingResults ?? []).map((row: any) => <div key={row.disposition} className="flex justify-between border-b py-1"><span>{row.disposition}</span><span>{row.count}</span></div>)}</div>
            <div><div className="font-medium mb-1">Forbidden-effect check</div><div className={reconciliationReport.reportData.forbiddenEffectChecks?.passed ? "text-green-600" : "text-red-600"}>{reconciliationReport.reportData.forbiddenEffectChecks?.passed ? "Passed" : "Failed"}</div><div className="text-muted-foreground mt-1">{reconciliationReport.reportData.forbiddenEffectChecks?.note}</div></div>
          </div>
        </div>
      )}

      {/* CRO-08A schedules */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">CRO-08A Schedules</h3>
        <div className="text-xs text-muted-foreground">
          Activation requires the MI-09 pilot ladder (Levels 1-3) to be complete, plus the existing $50 aggregate spend cap enforced per command. The certification-receipt ceremony was removed on 2026-09-13.
        </div>
        {(scheduleDefsQuery.data ?? []).map((s: any) => (
          <div key={s.id} className="rounded border p-2 text-xs flex items-center justify-between">
            <div>
              <div className="font-mono font-semibold">{s.logical_key} v{s.definition_version}</div>
              <div className="text-muted-foreground">{s.purpose}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${s.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{s.active ? "active" : "inactive"}</span>
              {!s.active && <Button size="sm" variant="outline" onClick={() => activateScheduleMutation.mutate(s.id)}>Activate</Button>}
              {s.active && <Button size="sm" variant="destructive" onClick={() => deactivateScheduleMutation.mutate(s.id)}>Deactivate</Button>}
            </div>
          </div>
        ))}
        {(scheduleDefsQuery.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No CRO-08A schedule definitions yet.</p>}
      </div>

      <p className="text-xs text-muted-foreground">
        Pilot lifecycle is controlled through the MI-09 authority service. See{" "}
        <code className="font-mono">docs/cro03d-ceremony-runbook.md</code> for the full ceremony workflow.
        No secrets, credentials, or raw PII are displayed anywhere in this panel.
      </p>
    </div>
  );
}
