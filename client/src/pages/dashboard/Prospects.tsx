import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Sparkles, Loader2, UserPlus, Users, MoreVertical, RefreshCw, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DashboardErrorState from "@/components/DashboardErrorState";
import type { Prospect, ProspectList } from "@shared/schema";

function getScoreBadgeClass(score: string | null | undefined) {
  switch (score) {
    case "hot":  return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "warm": return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "cold": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    default:     return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "enriched":    return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "contacted":   return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "qualified":   return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800";
    case "do_not_contact": return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    default:            return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "--";
  return new Date(date).toLocaleDateString();
}

export default function Prospects() {
  const [searchTerm, setSearchTerm]       = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("all");
  const [scoreSort, setScoreSort]         = useState<"none" | "asc" | "desc">("none");
  const [filterVertical, setFilterVertical] = useState<string>("all");
  const [filterScore, setFilterScore]     = useState<string>("all");

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { toast } = useToast();

  const prospectsUrl = selectedListId !== "all"
    ? `/api/prospects?listId=${selectedListId}`
    : "/api/prospects";

  const { data: prospectsResult, isLoading: prospectsLoading, isError: prospectsError, refetch: refetchProspects } =
    useQuery<{ data: Prospect[]; total: number }>({
      queryKey: ["/api/prospects", selectedListId],
      queryFn: async () => {
        const res = await fetch(`${prospectsUrl}${prospectsUrl.includes("?") ? "&" : "?"}limit=500`, { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        return res.json();
      },
    });
  const prospects = prospectsResult?.data;

  const { data: prospectLists } = useQuery<ProspectList[]>({ queryKey: ["/api/prospect-lists"] });

  // Collect unique verticals for filter dropdown
  const verticals = [...new Set((prospects || []).map(p => p.vertical).filter(Boolean))].sort() as string[];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const enrichMutation = useMutation({
    mutationFn: async (prospectId: number) => {
      await apiRequest("POST", "/api/enrichment-jobs", { jobType: "full_enrich", prospectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      toast({ title: "Enrichment started", description: "The prospect is being enriched." });
    },
    onError: (error: Error) => {
      toast({ title: "Enrichment failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkEnrichMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      // Enrich each selected prospect in sequence (uses existing endpoint)
      const results = await Promise.allSettled(
        ids.map(id => apiRequest("POST", "/api/enrichment-jobs", { jobType: "full_enrich", prospectId: id }))
      );
      const failed = results.filter(r => r.status === "rejected").length;
      return { queued: ids.length - failed, failed };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      setSelectedIds(new Set());
      toast({
        title: `${data.queued} prospects queued for enrichment`,
        description: data.failed > 0 ? `${data.failed} failed to queue.` : "Results will appear shortly.",
      });
    },
    onError: (err: Error) => toast({ title: "Bulk enrich failed", description: err.message, variant: "destructive" }),
  });

  const routeProspectsMutation = useMutation({
    mutationFn: async () => {
      const enrichedIds = prospects
        ?.filter(p => p.score && p.status !== "campaign_assigned" && p.status !== "converted" && p.status !== "do_not_contact")
        .map(p => p.id) || [];
      if (enrichedIds.length === 0) throw new Error("No eligible prospects to route");
      const res = await apiRequest("POST", "/api/ai/route-prospects-bulk", { prospectIds: enrichedIds });
      return res.json();
    },
    onSuccess: (data: { routed: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      toast({ title: `AI routed ${data.routed} prospects`, description: "Prospects matched to campaigns by vertical and score." });
    },
    onError: (err: Error) => {
      toast({ title: "AI routing failed", description: err.message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (prospectId: number) => {
      const res = await apiRequest("POST", `/api/prospects/${prospectId}/convert`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Prospect converted to contact", description: "Contact, deal, scoring, and routing all triggered." });
    },
    onError: (err: Error) => {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    },
  });

  const batchConvertMutation = useMutation({
    mutationFn: async () => {
      const hotIds = prospects
        ?.filter(p => (p.score === "hot" || p.qualificationScore === "A") && p.status !== "converted" && !p.contactId)
        .map(p => p.id) || [];
      if (hotIds.length === 0) throw new Error("No hot/A-scored prospects to convert");
      const res = await apiRequest("POST", "/api/prospects/convert-batch", { prospectIds: hotIds });
      return res.json();
    },
    onSuccess: (data: { converted: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: `${data.converted} prospects converted`, description: "All converted to contacts with deals, scoring, and sequence enrollment." });
    },
    onError: (err: Error) => {
      toast({ title: "Batch conversion failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Filtering / sorting ────────────────────────────────────────────────────
  const scoreOrder: Record<string, number> = { hot: 3, warm: 2, cold: 1 };
  const filteredProspects = prospects
    ?.filter((p) => {
      if (filterVertical !== "all" && p.vertical !== filterVertical) return false;
      if (filterScore !== "all" && p.score !== filterScore) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        p.companyName?.toLowerCase().includes(term) ||
        p.email?.toLowerCase().includes(term) ||
        p.ownerFirstName?.toLowerCase().includes(term) ||
        p.ownerLastName?.toLowerCase().includes(term) ||
        `${p.ownerFirstName || ""} ${p.ownerLastName || ""}`.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      if (scoreSort === "none") return 0;
      const aScore = scoreOrder[a.score ?? ""] ?? 0;
      const bScore = scoreOrder[b.score ?? ""] ?? 0;
      return scoreSort === "desc" ? bScore - aScore : aScore - bScore;
    });

  const totalCount   = filteredProspects?.length || 0;
  const enrichedCount = filteredProspects?.filter((p) => p.status === "enriched").length || 0;
  const hotCount     = filteredProspects?.filter((p) => p.score === "hot").length || 0;
  const warmCount    = filteredProspects?.filter((p) => p.score === "warm").length || 0;
  const coldCount    = filteredProspects?.filter((p) => p.score === "cold").length || 0;

  // ── Bulk selection helpers ─────────────────────────────────────────────────
  const allPageSelected = (filteredProspects?.length || 0) > 0 && (filteredProspects || []).every(p => selectedIds.has(p.id));
  const someSelected    = selectedIds.size > 0;

  const toggleAll = useCallback(() => {
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        (filteredProspects || []).forEach(p => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        (filteredProspects || []).forEach(p => next.add(p.id));
        return next;
      });
    }
  }, [filteredProspects, allPageSelected]);

  const toggleOne = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  if (prospectsError) {
    return <DashboardErrorState title="Failed to load prospects" onRetry={() => refetchProspects()} />;
  }

  return (
    <div className="space-y-6">
      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground" data-testid="label-total-prospects">Total</div>
          <div className="text-2xl font-bold" data-testid="count-total-prospects">{totalCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground" data-testid="label-enriched-count">Enriched</div>
          <div className="text-2xl font-bold" data-testid="count-enriched">{enrichedCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground" data-testid="label-hot-count">Hot</div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="count-hot">{hotCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground" data-testid="label-warm-count">Warm</div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="count-warm">{warmCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground" data-testid="label-cold-count">Cold</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="count-cold">{coldCount}</div>
        </CardContent></Card>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-end">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by company, email, or owner…"
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-prospects"
          />
        </div>

        <Select value={selectedListId} onValueChange={setSelectedListId}>
          <SelectTrigger className="w-full sm:w-56" data-testid="select-prospect-list">
            <SelectValue placeholder="All Lists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-all-lists">All Lists</SelectItem>
            {prospectLists?.map((list) => (
              <SelectItem key={list.id} value={String(list.id)} data-testid={`select-item-list-${list.id}`}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterVertical} onValueChange={setFilterVertical}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All verticals" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verticals</SelectItem>
            {verticals.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterScore} onValueChange={setFilterScore}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="All scores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scores</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>

        <Select value={scoreSort} onValueChange={(v) => setScoreSort(v as "none" | "asc" | "desc")} data-testid="select-score-sort">
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Sort by score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Default order</SelectItem>
            <SelectItem value="desc">Score: High → Low</SelectItem>
            <SelectItem value="asc">Score: Low → High</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          data-testid="button-ai-route-prospects"
          className="gap-2 shrink-0"
          onClick={() => routeProspectsMutation.mutate()}
          disabled={routeProspectsMutation.isPending}
        >
          {routeProspectsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          AI Route
        </Button>

        <Button
          data-testid="button-batch-convert"
          className="gap-2 shrink-0"
          onClick={() => batchConvertMutation.mutate()}
          disabled={batchConvertMutation.isPending}
        >
          {batchConvertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Convert Hot Leads
        </Button>
      </div>

      {/* ── Bulk action bar (shown when something is selected) ────────────── */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
          <Checkbox
            checked={allPageSelected}
            onCheckedChange={toggleAll}
            className="shrink-0"
          />
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {selectedIds.size} prospect{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 h-8"
            onClick={() => bulkEnrichMutation.mutate([...selectedIds])}
            disabled={bulkEnrichMutation.isPending}
          >
            {bulkEnrichMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Enrich Selected ({selectedIds.size})
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 text-muted-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                    data-testid="checkbox-select-all-prospects"
                  />
                </TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Owner Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Contacted</TableHead>
                <TableHead className="text-right w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prospectsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} data-testid={`skeleton-row-${i}`}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredProspects?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center h-24 text-muted-foreground" data-testid="text-no-prospects">
                    No prospects found
                  </TableCell>
                </TableRow>
              ) : (
                filteredProspects?.map((prospect) => (
                  <TableRow
                    key={prospect.id}
                    data-testid={`row-prospect-${prospect.id}`}
                    className={selectedIds.has(prospect.id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(prospect.id)}
                        onCheckedChange={() => toggleOne(prospect.id)}
                        aria-label={`Select ${prospect.companyName}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-company-${prospect.id}`}>
                      <div className="flex items-center gap-1.5">
                        {prospect.companyName || "--"}
                        {(prospect as any).linkedinEnrichedAt && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300" data-testid={`badge-li-${prospect.id}`} title="LinkedIn enriched">Li</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-owner-${prospect.id}`}>
                      {[prospect.ownerFirstName, prospect.ownerLastName].filter(Boolean).join(" ") || <span className="text-muted-foreground text-xs">--</span>}
                    </TableCell>
                    <TableCell data-testid={`text-email-${prospect.id}`}>
                      {prospect.email
                        ? <a href={`mailto:${prospect.email}`} className="text-blue-600 hover:underline text-sm">{prospect.email}</a>
                        : <span className="text-muted-foreground text-xs">--</span>
                      }
                    </TableCell>
                    <TableCell data-testid={`text-phone-${prospect.id}`}>
                      {prospect.phone
                        ? <a href={`tel:${prospect.phone}`} className="text-blue-600 hover:underline text-sm">{prospect.phone}</a>
                        : <span className="text-muted-foreground text-xs">--</span>
                      }
                    </TableCell>
                    <TableCell data-testid={`text-vertical-${prospect.id}`}>
                      {prospect.vertical
                        ? <Badge variant="outline" className="text-[10px] px-1.5">{prospect.vertical}</Badge>
                        : <span className="text-muted-foreground text-xs">--</span>
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant="outline"
                          className={`no-default-hover-elevate no-default-active-elevate ${getScoreBadgeClass(prospect.score)}`}
                          data-testid={`badge-score-${prospect.id}`}
                        >
                          {prospect.score || "unqualified"}
                        </Badge>
                        {(prospect.score === "hot" || prospect.score === "warm") &&
                          !prospect.phone &&
                          (!prospect.email || prospect.email.includes("placeholder.com")) && (
                          <Badge
                            variant="outline"
                            className="no-default-hover-elevate no-default-active-elevate text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700 text-[10px]"
                            data-testid={`badge-not-contactable-${prospect.id}`}
                          >
                            Not contactable yet
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClass(prospect.status)}`}
                        data-testid={`badge-status-${prospect.id}`}
                      >
                        {prospect.status || "raw"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-last-contacted-${prospect.id}`}>
                      {formatDate(prospect.lastContactedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => enrichMutation.mutate(prospect.id)}
                          disabled={enrichMutation.isPending}
                          aria-label="Enrich prospect"
                          data-testid={`button-enrich-${prospect.id}`}
                          title="Re-enrich"
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                        {prospect.status !== "converted" && !prospect.contactId && (
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => convertMutation.mutate(prospect.id)}
                            disabled={convertMutation.isPending}
                            aria-label="Convert to contact"
                            data-testid={`button-convert-${prospect.id}`}
                            title="Convert to contact"
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
