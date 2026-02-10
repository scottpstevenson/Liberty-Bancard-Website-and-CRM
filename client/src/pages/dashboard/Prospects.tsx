import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Search, Sparkles, Loader2, UserPlus, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Prospect, ProspectList } from "@shared/schema";

function getScoreBadgeClass(score: string | null | undefined) {
  switch (score) {
    case "hot":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "warm":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "cold":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "enriched":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "contacted":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "qualified":
      return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800";
    case "do_not_contact":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "--";
  return new Date(date).toLocaleDateString();
}

export default function Prospects() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("all");
  const { toast } = useToast();

  const prospectsUrl = selectedListId !== "all"
    ? `/api/prospects?listId=${selectedListId}`
    : "/api/prospects";

  const { data: prospects, isLoading: prospectsLoading } = useQuery<Prospect[]>({
    queryKey: ["/api/prospects", selectedListId],
    queryFn: async () => {
      const res = await fetch(prospectsUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const { data: prospectLists } = useQuery<ProspectList[]>({
    queryKey: ["/api/prospect-lists"],
  });

  const enrichMutation = useMutation({
    mutationFn: async (prospectId: number) => {
      await apiRequest("POST", "/api/enrichment-jobs", {
        jobType: "full_enrich",
        prospectId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      toast({ title: "Enrichment started", description: "The prospect is being enriched." });
    },
    onError: (error: Error) => {
      toast({ title: "Enrichment failed", description: error.message, variant: "destructive" });
    },
  });

  const routeProspectsMutation = useMutation({
    mutationFn: async () => {
      const enrichedIds = prospects?.filter(p => p.score && p.status !== "campaign_assigned" && p.status !== "converted" && p.status !== "do_not_contact").map(p => p.id) || [];
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
      const hotIds = prospects?.filter(p => (p.score === "hot" || p.qualificationScore === "A") && p.status !== "converted" && !p.contactId).map(p => p.id) || [];
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

  const filteredProspects = prospects?.filter((p) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.companyName?.toLowerCase().includes(term) ||
      p.email?.toLowerCase().includes(term) ||
      p.ownerFirstName?.toLowerCase().includes(term) ||
      p.ownerLastName?.toLowerCase().includes(term) ||
      `${p.ownerFirstName || ""} ${p.ownerLastName || ""}`.toLowerCase().includes(term)
    );
  });

  const totalCount = filteredProspects?.length || 0;
  const enrichedCount = filteredProspects?.filter((p) => p.status === "enriched").length || 0;
  const hotCount = filteredProspects?.filter((p) => p.score === "hot").length || 0;
  const warmCount = filteredProspects?.filter((p) => p.score === "warm").length || 0;
  const coldCount = filteredProspects?.filter((p) => p.score === "cold").length || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground" data-testid="label-total-prospects">Total</div>
            <div className="text-2xl font-bold" data-testid="count-total-prospects">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground" data-testid="label-enriched-count">Enriched</div>
            <div className="text-2xl font-bold" data-testid="count-enriched">{enrichedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground" data-testid="label-hot-count">Hot</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="count-hot">{hotCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground" data-testid="label-warm-count">Warm</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="count-warm">{warmCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground" data-testid="label-cold-count">Cold</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="count-cold">{coldCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-end">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by company, email, or owner..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-prospects"
          />
        </div>

        <Select value={selectedListId} onValueChange={setSelectedListId}>
          <SelectTrigger className="w-full sm:w-64" data-testid="select-prospect-list">
            <SelectValue placeholder="All Lists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-all-lists">All Lists</SelectItem>
            {prospectLists?.map((list) => (
              <SelectItem
                key={list.id}
                value={String(list.id)}
                data-testid={`select-item-list-${list.id}`}
              >
                {list.name}
              </SelectItem>
            ))}
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company Name</TableHead>
                <TableHead>Owner Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Contacted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prospectsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} data-testid={`skeleton-row-${i}`}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredProspects?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center h-24 text-muted-foreground" data-testid="text-no-prospects">
                    No prospects found
                  </TableCell>
                </TableRow>
              ) : (
                filteredProspects?.map((prospect) => (
                  <TableRow key={prospect.id} data-testid={`row-prospect-${prospect.id}`}>
                    <TableCell className="font-medium" data-testid={`text-company-${prospect.id}`}>
                      {prospect.companyName || "--"}
                    </TableCell>
                    <TableCell data-testid={`text-owner-${prospect.id}`}>
                      {[prospect.ownerFirstName, prospect.ownerLastName].filter(Boolean).join(" ") || "--"}
                    </TableCell>
                    <TableCell data-testid={`text-email-${prospect.id}`}>
                      {prospect.email || "--"}
                    </TableCell>
                    <TableCell data-testid={`text-phone-${prospect.id}`}>
                      {prospect.phone || "--"}
                    </TableCell>
                    <TableCell data-testid={`text-vertical-${prospect.id}`}>
                      {prospect.vertical || "--"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`no-default-hover-elevate no-default-active-elevate ${getScoreBadgeClass(prospect.score)}`}
                        data-testid={`badge-score-${prospect.id}`}
                      >
                        {prospect.score || "unqualified"}
                      </Badge>
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
                          variant="ghost"
                          size="icon"
                          onClick={() => enrichMutation.mutate(prospect.id)}
                          disabled={enrichMutation.isPending}
                          title="Enrich prospect"
                          data-testid={`button-enrich-${prospect.id}`}
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                        {prospect.status !== "converted" && !prospect.contactId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => convertMutation.mutate(prospect.id)}
                            disabled={convertMutation.isPending}
                            title="Convert to contact"
                            data-testid={`button-convert-${prospect.id}`}
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
