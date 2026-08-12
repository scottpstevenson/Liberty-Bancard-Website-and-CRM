import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import {
  Sparkles, RefreshCw, Trash2, Search, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle, Clock, Zap, Users, Mail, Phone,
  TrendingUp, Brain, Target, ArrowRight, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeadOpsStats {
  total: number; enriched: number; pending: number; processing: number; failed: number;
  hot: number; warm: number; cold: number;
  has_email: number; has_phone: number; contactable: number; has_owner_name: number;
  verticals: Array<{ vertical: string; count: number; hot_count: number }>;
}

interface LeadEntity {
  id: number; entity_name: string; principal_city: string; principal_state: string;
  vertical: string | null; score: string | null; enrichment_status: string;
  enriched_at: string | null; owner_name: string | null;
  owner_email: string | null; owner_phone: string | null;
  email: string | null; phone: string | null; website: string | null;
  prospect_id: number | null; ai_summary: string | null;
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function LeadOpsCenter() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Filter / pagination state ──────────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterStatus,    setFilterStatus]    = useState("all");
  const [filterScore,     setFilterScore]     = useState("all");
  const [filterVertical,  setFilterVertical]  = useState("all");
  const [filterContactable, setFilterContactable] = useState(false);
  const [filterNoContact,   setFilterNoContact]   = useState(false);
  const LIMIT = 100;

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── AI analysis ───────────────────────────────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [showAI, setShowAI] = useState(false);

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

  const entitiesParams = new URLSearchParams({
    page: String(page), limit: String(LIMIT),
    ...(filterStatus   !== "all" ? { status:  filterStatus   } : {}),
    ...(filterScore    !== "all" ? { score:   filterScore    } : {}),
    ...(filterVertical !== "all" ? { vertical: filterVertical } : {}),
    ...(filterContactable ? { contactable: "true" } : {}),
    ...(filterNoContact   ? { noContact:   "true" } : {}),
    ...(search ? { search } : {}),
  });

  const entitiesQuery = useQuery<{ data: LeadEntity[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/lead-ops/entities", page, filterStatus, filterScore, filterVertical, filterContactable, filterNoContact, search],
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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const bulkEnrichMutation = useMutation({
    mutationFn: async (ids: number[] | "all") => {
      const body = ids === "all"
        ? { all: true, filter: { status: filterStatus !== "all" ? filterStatus : undefined, score: filterScore !== "all" ? filterScore : undefined } }
        : { entityIds: ids };
      const r = await apiRequest("POST", "/api/lead-ops/bulk-enrich", body);
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Enrichment queued", description: data.message });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/entities"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

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
    { label: "Total Leads",   value: stats?.total?.toLocaleString()       || "—", icon: Users,       color: "text-gray-700 dark:text-gray-300" },
    { label: "Enriched",      value: stats?.enriched?.toLocaleString()    || "—", icon: CheckCircle,  color: "text-green-600 dark:text-green-400" },
    { label: "Pending",       value: stats?.pending?.toLocaleString()     || "—", icon: Clock,        color: "text-yellow-600 dark:text-yellow-400" },
    { label: "Have Email",    value: stats?.has_email?.toLocaleString()   || "—", icon: Mail,         color: "text-blue-600 dark:text-blue-400" },
    { label: "Have Phone",    value: stats?.has_phone?.toLocaleString()   || "—", icon: Phone,        color: "text-indigo-600 dark:text-indigo-400" },
    { label: "Hot Leads",     value: stats?.hot?.toLocaleString()         || "—", icon: TrendingUp,   color: "text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="space-y-6 pb-12">

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
            <Button
              size="sm"
              onClick={() => aiSegmentMutation.mutate()}
              disabled={aiSegmentMutation.isPending}
              className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
            >
              {aiSegmentMutation.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />
              }
              {aiAnalysis ? "Re-analyze" : "Analyze My Lead Pool"}
            </Button>
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

        {/* Bulk action buttons */}
        {someSelected && (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l">
            <span className="text-sm font-medium text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm" className="h-9 gap-1.5"
              onClick={() => bulkEnrichMutation.mutate([...selectedIds])}
              disabled={bulkEnrichMutation.isPending}
            >
              {bulkEnrichMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Enrich Selected
            </Button>
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        )}

        <div className="ml-auto flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Enrich All Pending
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Enrich all pending leads?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will queue {stats?.pending?.toLocaleString() || "all pending"} leads for enrichment. The pipeline runs every 10 minutes. This may take several hours for large pools.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => bulkEnrichMutation.mutate("all")}>
                  Queue All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
                              title="Re-enrich this lead"
                              onClick={() => bulkEnrichMutation.mutate([entity.id])}
                              disabled={bulkEnrichMutation.isPending || entity.enrichment_status === "processing"}
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
    </div>
  );
}
