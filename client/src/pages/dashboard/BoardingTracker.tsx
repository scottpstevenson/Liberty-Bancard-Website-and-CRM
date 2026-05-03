import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, RefreshCw, Loader2, Inbox, ExternalLink, Building2,
} from "lucide-react";

type BoardingStatus =
  | "submitted"
  | "under_review"
  | "more_info_needed"
  | "approved"
  | "declined";

interface Submission {
  dealId: number;
  contactId: number | null;
  merchantName: string;
  processorApplicationId: string | null;
  boardingStatus: BoardingStatus | string;
  boardingSubmittedAt: string | null;
  boardingApprovedAt: string | null;
  daysPending: number | null;
  latestLogMessage: string | null;
  latestLogTimestamp: string | null;
  mid: string | null;
  owner: string | null;
  pipeline: string | null;
  stage: string | null;
}

interface SubmissionsResponse {
  submissions: Submission[];
  counts: Record<string, number>;
  total: number;
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "more_info_needed", label: "More Info Needed" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
];

function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
    case "declined":
      return "destructive";
    case "more_info_needed":
      return "outline";
    case "under_review":
      return "secondary";
    case "submitted":
      return "secondary";
    default:
      return "secondary";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "more_info_needed":
      return "More Info Needed";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    default:
      return status;
  }
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const IN_FLIGHT_STATUSES: BoardingStatus[] = [
  "submitted",
  "under_review",
  "more_info_needed",
];

export default function BoardingTracker() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<SubmissionsResponse>({
    queryKey: ["/api/boarding/submissions", statusFilter],
    queryFn: async () => {
      const url =
        statusFilter === "all"
          ? "/api/boarding/submissions"
          : `/api/boarding/submissions?status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load boarding submissions");
      return res.json();
    },
  });

  const submissions = data?.submissions || [];
  const counts = data?.counts || {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return submissions;
    return submissions.filter((s) => {
      return (
        s.merchantName.toLowerCase().includes(q) ||
        (s.processorApplicationId?.toLowerCase().includes(q) ?? false) ||
        (s.mid?.toLowerCase().includes(q) ?? false) ||
        String(s.dealId).includes(q)
      );
    });
  }, [submissions, search]);

  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      const inFlight = submissions.filter((s) =>
        IN_FLIGHT_STATUSES.includes(s.boardingStatus as BoardingStatus)
      );
      const results = await Promise.allSettled(
        inFlight.map((s) =>
          apiRequest("POST", `/api/deals/${s.dealId}/refresh-boarding-status`, {})
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;
      return { total: results.length, succeeded, failed };
    },
    onSuccess: (result) => {
      toast({
        title: "Statuses refreshed",
        description: `${result.succeeded} of ${result.total} updated${
          result.failed > 0 ? ` · ${result.failed} failed` : ""
        }.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/boarding/submissions"] });
    },
    onError: (err: any) => {
      toast({
        title: "Refresh failed",
        description: err.message || "Could not refresh statuses.",
        variant: "destructive",
      });
    },
  });

  const inFlightCount = submissions.filter((s) =>
    IN_FLIGHT_STATUSES.includes(s.boardingStatus as BoardingStatus)
  ).length;

  return (
    <div className="space-y-4" data-testid="page-boarding-tracker">
      <Helmet>
        <title>Boarding Submissions | Liberty Bancard</title>
      </Helmet>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Boarding Submissions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Underwriting tracker for all deals submitted to the processor.
          </p>
        </div>
        <Button
          onClick={() => refreshAllMutation.mutate()}
          disabled={refreshAllMutation.isPending || inFlightCount === 0}
          data-testid="button-refresh-all"
        >
          {refreshAllMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh All Statuses{inFlightCount > 0 ? ` (${inFlightCount})` : ""}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(
          [
            "submitted",
            "under_review",
            "more_info_needed",
            "approved",
            "declined",
          ] as BoardingStatus[]
        ).map((s) => (
          <Card key={s} data-testid={`kpi-${s}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{getStatusLabel(s)}</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {counts[s] ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by merchant, application ID, MID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-boarding"
          />
        </div>
      </div>

      <Tabs
        value={statusFilter}
        onValueChange={setStatusFilter}
        data-testid="tabs-boarding-status"
      >
        <TabsList className="flex-wrap h-auto gap-1">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-testid={`tab-boarding-${tab.value}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3" data-testid="boarding-loading">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground"
              data-testid="empty-boarding"
            >
              <Inbox className="w-10 h-10" />
              <p className="text-sm font-medium">
                No boarding submissions found
              </p>
              <p className="text-xs">
                {search || statusFilter !== "all"
                  ? "Try adjusting your filters."
                  : "Deals submitted to the processor will appear here."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Application ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Days Pending</TableHead>
                  <TableHead>Latest Log</TableHead>
                  <TableHead>MID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow
                    key={s.dealId}
                    data-testid={`row-boarding-${s.dealId}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p
                            className="font-medium text-foreground truncate"
                            data-testid={`text-merchant-${s.dealId}`}
                          >
                            {s.merchantName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Deal #{s.dealId}
                            {s.owner ? ` · ${s.owner}` : ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-mono text-xs"
                        data-testid={`text-app-id-${s.dealId}`}
                      >
                        {s.processorApplicationId || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={getStatusVariant(s.boardingStatus)}
                        data-testid={`badge-status-${s.dealId}`}
                      >
                        {getStatusLabel(s.boardingStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className="text-sm text-muted-foreground"
                        data-testid={`text-submitted-${s.dealId}`}
                      >
                        {formatDate(s.boardingSubmittedAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="text-sm font-medium"
                        data-testid={`text-days-${s.dealId}`}
                      >
                        {s.daysPending !== null ? `${s.daysPending}d` : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p
                        className="text-xs text-muted-foreground truncate"
                        title={s.latestLogMessage || ""}
                        data-testid={`text-log-${s.dealId}`}
                      >
                        {s.latestLogMessage || "—"}
                      </p>
                      {s.latestLogTimestamp && (
                        <p className="text-[10px] text-muted-foreground/70">
                          {formatDate(s.latestLogTimestamp)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-mono text-xs"
                        data-testid={`text-mid-${s.dealId}`}
                      >
                        {s.mid || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.contactId ? (
                        <Link href={`/dashboard/contacts/${s.contactId}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-open-${s.dealId}`}
                          >
                            <ExternalLink className="w-4 h-4 mr-1" />
                            Open
                          </Button>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
