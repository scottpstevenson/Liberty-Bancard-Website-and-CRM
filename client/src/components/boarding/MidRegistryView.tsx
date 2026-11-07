import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
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
import { Building2, ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react";

const PAGE_SIZE = 50;
const MID_STATUSES = ["all", "pending", "assigned", "scheduled", "live"] as const;
type MidStatusFilter = (typeof MID_STATUSES)[number];
const STATUS_LABEL: Record<string, string> = {
  all: "All", pending: "No MID yet", assigned: "MID assigned", scheduled: "Go-live scheduled (deal stage)", live: "Live (deal stage)",
};
const CLASS_LABEL: Record<string, string> = {
  unknown: "Unclassified", production: "Production", merchant: "Merchant", customer: "Customer",
};
const classLabel = (k: string) => CLASS_LABEL[k] ?? k.replace(/_/g, " ");

/** URL-owned list state: status, page and (optionally) the expanded deal live in the query string. */
export function registryUrl(search: string, patch: { midStatus?: MidStatusFilter; midPage?: number; midDeal?: number | null }): string {
  const p = new URLSearchParams(search);
  if (patch.midStatus !== undefined) { if (patch.midStatus === "all") p.delete("midStatus"); else p.set("midStatus", patch.midStatus); }
  if (patch.midPage !== undefined) { if (patch.midPage <= 1) p.delete("midPage"); else p.set("midPage", String(patch.midPage)); }
  if (patch.midDeal !== undefined) { if (patch.midDeal == null) p.delete("midDeal"); else p.set("midDeal", String(patch.midDeal)); }
  const q = p.toString();
  return `/dashboard/boarding${q ? `?${q}` : ""}`;
}
function readRegistryUrl(search: string): { status: MidStatusFilter | null; page: number; deal: number | null } {
  const p = new URLSearchParams(search);
  const st = p.get("midStatus");
  const status = st && (MID_STATUSES as readonly string[]).includes(st) ? (st as MidStatusFilter) : null;
  const pg = Number(p.get("midPage"));
  const dl = Number(p.get("midDeal"));
  return { status, page: Number.isInteger(pg) && pg >= 1 ? pg : 1, deal: Number.isInteger(dl) && dl > 0 ? dl : null };
}

interface MidHistoryRow {
  id: number; status: string; processorName: string; midMasked: string; isPrimaryAlias: boolean;
  assignedAt: string | null; activatedAt: string | null; suspendedAt: string | null; closedAt: string | null;
}

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
  byClass?: Record<string, number>;
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
  status: _statusProp, onStatusChange,
}: { status: MidStatusFilter; onStatusChange: (s: MidStatusFilter) => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();
  const fromUrl = readRegistryUrl(search);
  // The URL owns status, page and the expanded deal (no URL value means "all"), so reload and Back restore the exact list.
  const status: MidStatusFilter = fromUrl.status ?? "all";
  const offset = (fromUrl.page - 1) * PAGE_SIZE;
  const expandedDeal = fromUrl.deal;
  const setOffset = (o: number) => navigate(registryUrl(search, { midPage: Math.floor(o / PAGE_SIZE) + 1, midDeal: null }));
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
      toast({ title: "Local MID record closed", description: "The record stays in history. Nothing was changed at the processor." });
      setClosing(null);
      queryClient.invalidateQueries({ queryKey: ["/api/boarding/mid-registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boarding/mid-registry-history"] });
    },
    onError: (err: Error) => {
      toast({ title: "Local MID record not closed", description: err.message, variant: "destructive" });
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
        aria-label={`Close local MID record for ${merchantName(r)}`}>
        Close local MID record
      </Button>
    ) : null;
  const openLink = (r: RegistryRow, full = false) =>
    r.contact_id ? (
      <Button variant={full ? "outline" : "ghost"} size="sm" aria-label={`Open ${merchantName(r)}`} data-testid={`button-open-reg-${r.deal_id}`} asChild>
        <Link href={`/dashboard/contacts/${r.contact_id}?area=sales-work&section=deals&dealId=${r.deal_id}&from=${encodeURIComponent(registryUrl(search, {}))}`}>
          <ExternalLink className="w-4 h-4 mr-1" />Open
        </Link>
      </Button>
    ) : null;

  const historyToggle = (r: RegistryRow) => (
    <Button variant="ghost" size="sm" aria-expanded={expandedDeal === r.deal_id} aria-controls={`mid-history-${r.deal_id}`}
      onClick={() => navigate(registryUrl(search, { midDeal: expandedDeal === r.deal_id ? null : r.deal_id }))}
      aria-label={`MID history for ${merchantName(r)}`} data-testid={`button-mid-history-${r.deal_id}`}>
      {expandedDeal === r.deal_id ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}History
    </Button>
  );
  const historyRail = (r: RegistryRow) => expandedDeal === r.deal_id ? <MidHistoryRail dealId={r.deal_id} /> : null;

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
            onClick={() => { onStatusChange(s); navigate(registryUrl(search, { midStatus: s, midPage: 1, midDeal: null })); }} data-testid={`filter-mid-${s}`}>
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      {data && (
        <div className="text-xs text-muted-foreground space-y-1" data-testid="text-mid-registry-scope">
          <p>
            One row per deal; a deal with several MID records shows its primary MID and the count of nonclosed MID records. MIDs are masked.
            {" "}Showing {from}–{to} of {data.total} deals{data.filter ? ` (${STATUS_LABEL[data.filter]})` : ""} · {data.scopeTotal} in scope · UTC as of {data.asOf}.
          </p>
          <p data-testid="text-mid-registry-scope-rule">
            Scope: nonarchived, nonlost deals; excludes explicit test/demo/synthetic; includes unclassified. "Go-live scheduled" and "Live" are recorded deal stages, not processor activity or readback receipts.
          </p>
          {data.byClass && Object.keys(data.byClass).length > 0 && (
            <details data-testid="details-mid-registry-classes">
              <summary className="cursor-pointer min-h-11 inline-flex items-center">Record-class breakdown (reconciliation diagnostic)</summary>
              <ul className="list-disc pl-5" data-testid="list-mid-registry-classes">
                {Object.entries(data.byClass).sort((x, y) => y[1] - x[1]).map(([k, n]) => (
                  <li key={k}>{classLabel(k)}: {n} deals</li>
                ))}
              </ul>
              <p>Unclassified or test-labelled Live rows are candidates for reconciliation, not confirmed production merchants. Nothing is reclassified here.</p>
            </details>
          )}
        </div>
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
                { header: "Nonclosed MID records", cell: (r) => <span className="text-sm" data-testid={`text-reg-count-${r.deal_id}`}>{r.mid_count}</span> },
                { header: "Status", cell: (r) => (
                  <Badge variant={statusVariant(r.mid_status)} data-testid={`badge-mid-status-${r.deal_id}`}>{STATUS_LABEL[r.mid_status]}</Badge>
                ) },
                { header: "Actions", className: "text-right", cell: (r) => (
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex justify-end gap-2">{historyToggle(r)}{openLink(r)}{closeButton(r)}</div>
                    {historyRail(r)}
                  </div>
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
                      {r.mid_count > 1 ? <span className="text-muted-foreground"> · {r.mid_count} nonclosed MID records</span> : null}</p>
                    <div className="flex gap-2 flex-wrap">{historyToggle(r)}{openLink(r, true)}{closeButton(r)}</div>
                    {historyRail(r)}
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
            <AlertDialogTitle>Close this local MID record?</AlertDialogTitle>
            <AlertDialogDescription>
              {closing ? `${merchantName(closing)} · ${closing.mid_masked ?? ""}. ` : ""}
              Closing marks only this platform's MID record as closed. It does not close the merchant account at the processor. The record stays in history, is no longer counted, and cannot be reopened or reused. If the deal has another nonclosed MID record, that one becomes primary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMutation.isPending} data-testid="button-close-mid-cancel">Keep record</AlertDialogCancel>
            <AlertDialogAction
              disabled={closeMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (closing) closeMutation.mutate(closing); }}
              data-testid="button-close-mid-confirm"
            >
              {closeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Close local MID record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Masked, read-only history of every canonical MID record for one deal (closed included). */
function MidHistoryRail({ dealId }: { dealId: number }) {
  const q = useQuery<{ dealId: number; mids: MidHistoryRow[] }>({
    queryKey: ["/api/boarding/mid-registry-history", dealId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/boarding/mid-registry/${dealId}/mids`, { credentials: "include", signal });
      if (!res.ok) throw new Error(`MID history unavailable (${res.status})`);
      const body = await res.json();
      if (!Array.isArray(body?.mids)) throw new Error("MID history response shape unavailable");
      return body;
    },
  });
  const fmt = (t: string | null) => (t ? new Date(t).toLocaleDateString() : null);
  return (
    <div id={`mid-history-${dealId}`} className="w-full text-xs rounded border p-2 text-left space-y-1" role="region" aria-label={`MID history for deal ${dealId}`} data-testid={`rail-mid-history-${dealId}`}>
      {q.isLoading ? <p>Loading history…</p>
        : q.isError ? <p role="alert" className="text-[hsl(var(--crm-danger-text))]">{(q.error as Error).message}</p>
        : q.data!.mids.length === 0 ? <p>No MID records on this deal.</p>
        : (
          <ul className="space-y-1">
            {q.data!.mids.map((m) => (
              <li key={m.id} data-testid={`history-mid-${m.id}`}>
                <span className="font-mono">{m.midMasked}</span> · {m.status}{m.isPrimaryAlias ? " · primary" : ""} · {m.processorName}
                {fmt(m.closedAt) ? ` · closed ${fmt(m.closedAt)}` : fmt(m.suspendedAt) ? ` · suspended ${fmt(m.suspendedAt)}` : fmt(m.activatedAt) ? ` · activated ${fmt(m.activatedAt)}` : fmt(m.assignedAt) ? ` · assigned ${fmt(m.assignedAt)}` : ""}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export { MID_STATUSES };
export type { MidStatusFilter };
