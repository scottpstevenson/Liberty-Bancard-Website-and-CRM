import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, ExternalLink, Loader2 } from "lucide-react";

const PAGE_SIZE = 50;
const MID_STATUSES = ["all", "pending", "assigned", "scheduled", "live"] as const;
type MidStatusFilter = (typeof MID_STATUSES)[number];
const STATUS_LABEL: Record<string, string> = {
  all: "All", pending: "No MID yet", assigned: "MID assigned", scheduled: "Go-live scheduled", live: "Live",
};

interface RegistryRow {
  deal_id: number;
  primary_mid_id: number | null;
  mid_masked: string | null;
  has_mid: boolean;
  mid_record_status: string | null;
  mid_count: number;
  pipeline: string | null;
  stage: string | null;
  owner: string | null;
  contact_id: number | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  mid_status: "pending" | "assigned" | "scheduled" | "live";
  updated_at: string;
}

interface RegistryResponse {
  merchants: RegistryRow[];
  unit: "deals";
  total: number;
  scopeTotal: number;
  returned: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  byStatus: Record<string, number>;
  asOf: string;
  filter: string | null;
}

function merchantName(r: RegistryRow): string {
  return r.company_name?.trim() || [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || `Deal #${r.deal_id}`;
}

function statusVariant(s: string): "default" | "secondary" | "outline" {
  return s === "live" ? "default" : s === "pending" ? "outline" : "secondary";
}

export default function MidRegistryView({
  status, onStatusChange,
}: { status: MidStatusFilter; onStatusChange: (s: MidStatusFilter) => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [closing, setClosing] = useState<RegistryRow | null>(null);
  const canClose = user?.role === "admin" || user?.role === "manager";

  const query = useQuery<RegistryResponse>({
    queryKey: ["/api/boarding/mid-registry", status, offset],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (status !== "all") params.set("midStatus", status);
      const res = await fetch(`/api/boarding/mid-registry?${params}`, { credentials: "include", signal });
      if (res.status === 401 || res.status === 403) throw new Error(`${res.status}: You are not allowed to view the MID registry`);
      if (!res.ok) throw new Error(`${res.status}: MID registry unavailable`);
      const body = await res.json();
      if (!Array.isArray(body?.merchants) || !Number.isInteger(body?.total) || typeof body?.asOf !== "string" || body?.unit !== "deals" || !body?.byStatus) {
        throw new Error("MID registry response shape unavailable");
      }
      return body as RegistryResponse;
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (row: RegistryRow) => {
      if (!row.primary_mid_id) throw new Error("This deal has no canonical MID record to close.");
      const res = await apiRequest("PATCH", `/api/admin/mids/${row.primary_mid_id}`, { status: "closed" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Close failed" }));
        throw new Error(err.message || "Close failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "MID closed", description: "The MID stays in history and no longer counts as live." });
      setClosing(null);
      queryClient.invalidateQueries({ queryKey: ["/api/boarding/mid-registry"] });
    },
    onError: (err: Error) => {
      toast({ title: "MID not closed", description: err.message, variant: "destructive" });
      setClosing(null);
    },
  });

  const data = query.isLoading || query.isError ? undefined : query.data;
  const rows = data?.merchants ?? [];
  const from = data && data.returned > 0 ? data.offset + 1 : 0;
  const to = data ? data.offset + data.returned : 0;

  const closeButton = (r: RegistryRow) =>
    canClose && r.primary_mid_id ? (
      <Button variant="outline" size="sm" onClick={() => setClosing(r)} data-testid={`button-close-mid-${r.deal_id}`}
        aria-label={`Close MID for ${merchantName(r)}`}>
        Close MID
      </Button>
    ) : null;
  const openLink = (r: RegistryRow, full = false) =>
    r.contact_id ? (
      <Link href={`/dashboard/contacts/${r.contact_id}`}>
        <Button variant={full ? "outline" : "ghost"} size="sm" aria-label={`Open ${merchantName(r)}`} data-testid={`button-open-reg-${r.deal_id}`}>
          <ExternalLink className="w-4 h-4 mr-1" />Open
        </Button>
      </Link>
    ) : null;

  return (
    <div className="space-y-4" data-testid="view-mid-registry">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["pending", "assigned", "scheduled", "live"] as const).map((s) => (
          <Card key={s} data-testid={`kpi-mid-${s}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</p>
              <p className={`${query.isLoading || query.isError ? "text-sm" : "text-2xl"} font-bold mt-1`}>
                {query.isLoading ? "Loading" : query.isError ? "Unavailable" : data?.byStatus[s] ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by MID status" data-testid="filter-mid-status">
        {MID_STATUSES.map((s) => (
          <Button key={s} variant={status === s ? "default" : "outline"} size="sm" aria-pressed={status === s}
            onClick={() => { setOffset(0); onStatusChange(s); }} data-testid={`filter-mid-${s}`}>
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      {data && (
        <p className="text-xs text-muted-foreground" data-testid="text-mid-registry-scope">
          One row per deal; a deal with several MIDs shows its primary MID and the live MID count. MIDs are masked.
          {" "}Showing {from}–{to} of {data.total} deals{data.filter ? ` (${STATUS_LABEL[data.filter]})` : ""} · {data.scopeTotal} in scope · UTC as of {data.asOf}.
          {" "}Go-Live Scheduled is scheduled, not live.
        </p>
      )}

      <DataState
        query={{ isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch, data: rows }}
        emptyTitle="No deals match"
        emptyMessage={status === "all" ? "Merchant deals will appear here." : "No deals in this MID status."}
        errorTitle="MID registry unavailable"
        testId="mid-registry"
      >
        <Card>
          <CardContent className="p-0">
            <ResponsiveTable
              data={rows}
              keyExtractor={(r) => r.deal_id}
              testId="mid-registry"
              columns={[
                { header: "Merchant", cell: (r) => (
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate" data-testid={`text-reg-merchant-${r.deal_id}`}>{merchantName(r)}</p>
                      <p className="text-xs text-muted-foreground">Deal #{r.deal_id}{r.stage ? ` · ${r.stage}` : ""}</p>
                    </div>
                  </div>
                ) },
                { header: "Primary MID", cell: (r) => (
                  <span className="font-mono text-xs" data-testid={`text-reg-mid-${r.deal_id}`}>{r.mid_masked ?? "—"}</span>
                ) },
                { header: "Live MIDs", cell: (r) => <span className="text-sm" data-testid={`text-reg-count-${r.deal_id}`}>{r.mid_count}</span> },
                { header: "Status", cell: (r) => (
                  <Badge variant={statusVariant(r.mid_status)} data-testid={`badge-mid-status-${r.deal_id}`}>{STATUS_LABEL[r.mid_status]}</Badge>
                ) },
                { header: "Actions", className: "text-right", cell: (r) => (
                  <div className="flex justify-end gap-2">{openLink(r)}{closeButton(r)}</div>
                ) },
              ]}
              mobileCard={(r) => (
                <Card data-testid={`card-mid-${r.deal_id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{merchantName(r)}</p>
                        <p className="text-xs text-muted-foreground">Deal #{r.deal_id}{r.stage ? ` · ${r.stage}` : ""}</p>
                      </div>
                      <Badge variant={statusVariant(r.mid_status)}>{STATUS_LABEL[r.mid_status]}</Badge>
                    </div>
                    <p className="text-xs"><span className="text-muted-foreground">MID: </span><span className="font-mono">{r.mid_masked ?? "—"}</span>
                      {r.mid_count > 1 ? <span className="text-muted-foreground"> · {r.mid_count} live MIDs</span> : null}</p>
                    <div className="flex gap-2 flex-wrap">{openLink(r, true)}{closeButton(r)}</div>
                  </CardContent>
                </Card>
              )}
            />
          </CardContent>
        </Card>
        <div className="flex items-center justify-between gap-3 pt-3 pb-20 pr-16">
          <Button variant="outline" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-mid-prev">
            Previous
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="text-mid-page">
            {query.isFetching ? "Loading…" : `${from}–${to} of ${data?.total ?? 0}`}
          </span>
          <Button variant="outline" disabled={!data?.hasMore || query.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-mid-next">
            Next
          </Button>
        </div>
      </DataState>

      <AlertDialog open={!!closing} onOpenChange={(o) => { if (!o && !closeMutation.isPending) setClosing(null); }}>
        <AlertDialogContent data-testid="dialog-close-mid">
          <AlertDialogHeader>
            <AlertDialogTitle>Close this MID?</AlertDialogTitle>
            <AlertDialogDescription>
              {closing ? `${merchantName(closing)} · ${closing.mid_masked ?? ""}. ` : ""}
              A closed MID stays in history, is no longer counted as live, and cannot be reopened or reused. If the deal has another live MID, that one becomes primary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMutation.isPending} data-testid="button-close-mid-cancel">Keep MID</AlertDialogCancel>
            <AlertDialogAction
              disabled={closeMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (closing) closeMutation.mutate(closing); }}
              data-testid="button-close-mid-confirm"
            >
              {closeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Close MID
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { MID_STATUSES };
export type { MidStatusFilter };
