import { useState, useMemo, useRef } from "react";
import { getCsrfToken } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/export-csv";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  Search,
  BarChart3,
  Percent,
  Download,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Trash2,
  ChevronRight,
  AlertCircle,
  Activity,
  RefreshCw,
  Banknote,
} from "lucide-react";

interface ResidualReport {
  id: number;
  month: string;
  year: number;
  totalRevenue: number;
  totalCost: number;
  netRevenue: number;
  activeMerchants: number;
  attritionRate: number;
  createdAt: string;
}

interface MerchantResidual {
  id: number;
  merchantName: string;
  mid: string;
  volume: number;
  volumeChange: number;
  revenue: number;
  revenueChange: number;
  cost: number;
  netRevenue: number;
  agent: string;
  agentCommission: string;
  flags: string[];
}

interface Agent {
  id: number;
  name: string;
  totalDeals: number;
  revenueManaged: number;
  commissionEarned: number;
}

interface ResidualImport {
  id: number;
  month: string;
  fileName: string;
  status: string;
  importedBy: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  flaggedRows: number;
  totalGrossResidual: string;
  totalNetResidual: string;
  totalVariance: string;
  varianceThresholdPct: number;
  varianceThresholdAmt: number;
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  rows?: ResidualImportRow[];
}

interface ResidualImportRow {
  id: number;
  importId: number;
  mid: string;
  merchantName: string | null;
  volume: string;
  grossResidual: string;
  netResidual: string;
  expectedResidual: string;
  variance: string;
  variancePct: string;
  varianceStatus: string;
  isMatched: boolean;
  matchedDealId: number | null;
  agentId: number | null;
  agentName: string | null;
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(isNaN(num) ? 0 : num);
}

function formatCurrencyDetailed(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isNaN(num) ? 0 : num);
}

function ChangeIndicator({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground text-xs">--</span>;
  const isPositive = value > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${isPositive ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function VarianceBadge({ status }: { status: string }) {
  if (status === "in_range") return <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">In Range</Badge>;
  if (status === "under") return <Badge variant="destructive" className="text-xs">Under</Badge>;
  if (status === "over") return <Badge className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0">Over</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function ImportStatusBadge({ status }: { status: string }) {
  if (status === "confirmed") return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0"><CheckCircle className="w-3 h-3 mr-1" />Confirmed</Badge>;
  if (status === "pending") return <Badge variant="secondary" className="text-xs"><Clock className="w-3 h-3 mr-1" />Pending Review</Badge>;
  if (status === "rejected") return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function KPISkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-24 mb-1" />
        <Skeleton className="h-3 w-36" />
      </CardContent>
    </Card>
  );
}

function TableSkeleton({ rows = 5, cols = 9 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

interface PartnerResidualRow {
  orgId: number;
  orgName: string;
  orgSlug: string;
  totalGrossResidual: string;
  totalNetResidual: string;
  activeMerchants: number;
  totalPartnerCommission?: string;
}

function ByPartnerTab() {
  const { data: rows = [], isLoading } = useQuery<PartnerResidualRow[]>({
    queryKey: ["/api/residuals/by-partner"],
  });

  return (
    <TabsContent value="by-partner" className="space-y-4" data-testid="tab-content-by-partner">
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 flex gap-2 items-start text-xs text-amber-800 dark:text-amber-300">
        <span className="shrink-0 mt-0.5">⚠</span>
        <span>
          This view shows residuals from <strong>confirmed imports only</strong>, attributed to partner organizations via deal links.
          Individual affiliate partners appear in the <strong>Partner Portal</strong>.
          To confirm pending imports or mark rows as ready, use the <strong>Import &amp; Reconcile</strong> tab.
        </span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Residuals by Partner Organization
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Aggregated from confirmed residual imports. Only rows matched to deals with a linked partner organization are included.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-by-partner-empty">
                No partner-attributed residuals yet. Link deals to partner organizations and import residuals to see data here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-by-partner">
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner Organization</TableHead>
                    <TableHead className="text-right">Active Merchants</TableHead>
                    <TableHead className="text-right">Gross Residual</TableHead>
                    <TableHead className="text-right">Net Residual</TableHead>
                    <TableHead className="text-right">Partner Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.orgId} data-testid={`row-partner-${row.orgId}`}>
                      <TableCell className="font-medium text-foreground">
                        <div className="flex flex-col">
                          <span>{row.orgName}</span>
                          <span className="text-xs text-muted-foreground font-mono">{row.orgSlug}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.activeMerchants}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.totalGrossResidual)}</TableCell>
                      <TableCell className="text-right font-semibold text-foreground">{formatCurrency(row.totalNetResidual)}</TableCell>
                       <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrencyDetailed(row.totalPartnerCommission)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

interface AgentPayout {
  id: number;
  agentUserId: string;
  periodMonth: string;
  grossResidual: string;
  agentShare: string;
  partnerShare: string;
  status: string;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Import History Row — lazy fetches detail when expanded
// ---------------------------------------------------------------------------
function ImportHistoryRow({ imp, onReimport }: { imp: ResidualImport; onReimport: (month: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  // #1285/#1445 — Reconciliation: compare CSV row count vs actual DB row count
  const { data: recon } = useQuery<{
    importId: number;
    csvRowCount: number;
    dbRowCount: number;
    reconciled: boolean;
    difference: number;
  }>({
    queryKey: ["/api/residuals/imports", imp.id, "reconciliation"],
    queryFn: async () => {
      const res = await fetch(`/api/residuals/imports/${imp.id}/reconciliation`, { credentials: "include" });
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: imp.status === "confirmed",
    staleTime: 5 * 60 * 1000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<ResidualImport>({
    queryKey: ["/api/residuals/imports", imp.id],
    queryFn: async () => {
      const res = await fetch(`/api/residuals/imports/${imp.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load import detail");
      return res.json() as Promise<ResidualImport>;
    },
    enabled: expanded,
  });

  const matchedDetailRows = detail?.rows?.filter(r => r.isMatched) ?? [];
  const unmatchedDetailRows = detail?.rows?.filter(r => !r.isMatched) ?? [];

  const uploadedDate = imp.createdAt
    ? new Date(imp.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const uploadedTime = imp.createdAt
    ? new Date(imp.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(v => !v)}
        data-testid={`row-history-${imp.id}`}
      >
        <TableCell className="w-8 pr-0">
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          <div className="font-medium text-foreground">{uploadedDate}</div>
          <div className="text-xs">{uploadedTime}</div>
        </TableCell>
        <TableCell className="font-medium">{imp.month}</TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate" title={imp.fileName}>{imp.fileName}</TableCell>
        <TableCell className="text-right">{imp.totalRows}</TableCell>
        <TableCell className="text-right">{formatCurrencyDetailed(imp.totalGrossResidual)}</TableCell>
        <TableCell className="text-right font-medium">{formatCurrencyDetailed(imp.totalNetResidual)}</TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <ImportStatusBadge status={imp.status} />
            {recon && (
              <Badge
                variant="outline"
                className={`text-xs whitespace-nowrap ${recon.reconciled ? "border-green-400 text-green-700 dark:text-green-400" : "border-amber-400 text-amber-700 dark:text-amber-400"}`}
                data-testid={`badge-reconciliation-${imp.id}`}
              >
                {recon.reconciled
                  ? `✓ ${recon.dbRowCount} rows reconciled`
                  : `⚠ ${recon.dbRowCount}/${recon.csvRowCount} rows`}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{imp.importedBy || "—"}</TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={e => { e.stopPropagation(); onReimport(imp.month); }}
            data-testid={`button-reimport-${imp.id}`}
          >
            <RefreshCw className="w-3 h-3" /> Re-import
          </Button>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow data-testid={`row-history-detail-${imp.id}`}>
          <TableCell colSpan={10} className="p-0 border-b bg-muted/10">
            <div className="px-6 py-4 space-y-4">
              {detailLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : (
                <>
                  {/* Matched merchants */}
                  {matchedDetailRows.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-600" />
                        Matched Merchants ({matchedDetailRows.length})
                      </p>
                      <div className="rounded border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="text-xs h-8">Merchant</TableHead>
                              <TableHead className="text-xs h-8">MID</TableHead>
                              <TableHead className="text-xs h-8 text-right">Gross</TableHead>
                              <TableHead className="text-xs h-8 text-right">Net</TableHead>
                              <TableHead className="text-xs h-8">Agent</TableHead>
                              <TableHead className="text-xs h-8">Variance</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {matchedDetailRows.map(row => (
                              <TableRow key={row.id} className="h-8">
                                <TableCell className="text-xs py-1">{row.merchantName || "—"}</TableCell>
                                <TableCell className="text-xs py-1 font-mono">{row.mid}</TableCell>
                                <TableCell className="text-xs py-1 text-right">{formatCurrencyDetailed(row.grossResidual)}</TableCell>
                                <TableCell className="text-xs py-1 text-right">{formatCurrencyDetailed(row.netResidual)}</TableCell>
                                <TableCell className="text-xs py-1">{row.agentName || "—"}</TableCell>
                                <TableCell className="text-xs py-1"><VarianceBadge status={row.varianceStatus} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Unmatched / error rows */}
                  {unmatchedDetailRows.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Unmatched / Error Rows ({unmatchedDetailRows.length})
                      </p>
                      <div className="rounded border border-red-200 dark:border-red-800 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-red-50 dark:bg-red-950/30">
                              <TableHead className="text-xs h-8">MID</TableHead>
                              <TableHead className="text-xs h-8">Merchant Name in File</TableHead>
                              <TableHead className="text-xs h-8 text-right">Gross</TableHead>
                              <TableHead className="text-xs h-8 text-right">Net</TableHead>
                              <TableHead className="text-xs h-8">Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unmatchedDetailRows.map(row => (
                              <TableRow key={row.id} className="bg-red-50/50 dark:bg-red-950/10 h-8">
                                <TableCell className="text-xs py-1 font-mono text-red-700 dark:text-red-400">{row.mid}</TableCell>
                                <TableCell className="text-xs py-1">{row.merchantName || "—"}</TableCell>
                                <TableCell className="text-xs py-1 text-right">{formatCurrencyDetailed(row.grossResidual)}</TableCell>
                                <TableCell className="text-xs py-1 text-right">{formatCurrencyDetailed(row.netResidual)}</TableCell>
                                <TableCell className="text-xs py-1 text-red-600 dark:text-red-400">
                                  {row.agentId ? "Missing agent assignment" : "Unknown MID — not linked to any merchant"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {matchedDetailRows.length === 0 && unmatchedDetailRows.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">No row detail available for this import.</p>
                  )}
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ResidualRevenue() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilterParentId, setGroupFilterParentId] = useState<number | null>(null);
  const [uploadMonth, setUploadMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [thresholdPct, setThresholdPct] = useState("5");
  const [thresholdAmt, setThresholdAmt] = useState("50");
  const [selectedImportId, setSelectedImportId] = useState<number | null>(null);
  const [reviewTab, setReviewTab] = useState<"matched" | "unmatched">("matched");
  const [linkRow, setLinkRow] = useState<ResidualImportRow | null>(null);
  const [dealSearch, setDealSearch] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: contactsResult } = useQuery<{ data: Array<{ id: number; companyName: string | null; firstName: string; lastName: string; isParentAccount: boolean | null; parentContactId: number | null }> }>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts?limit=500", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    staleTime: 60000,
  });
  const allContacts = contactsResult?.data ?? [];
  const parentAccountsList = allContacts.filter(c => c.isParentAccount);

  const { data: allDealsResult } = useQuery<{ data: Array<{ id: number; contactId: number; mid: string | null }> }>({
    queryKey: ["/api/deals"],
    queryFn: async () => {
      const res = await fetch("/api/deals?limit=1000", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    staleTime: 60000,
    enabled: !!groupFilterParentId,
  });
  const allDeals = allDealsResult?.data ?? [];

  // Compute group MIDs when a parent filter is active
  const groupMidSet = useMemo<Set<string> | null>(() => {
    if (!groupFilterParentId) return null;
    const groupContactIds = new Set([
      groupFilterParentId,
      ...allContacts.filter(c => c.parentContactId === groupFilterParentId).map(c => c.id),
    ]);
    const mids = new Set<string>();
    for (const deal of allDeals) {
      if (groupContactIds.has(deal.contactId) && deal.mid) {
        mids.add(deal.mid);
      }
    }
    return mids;
  }, [groupFilterParentId, allContacts, allDeals]);

  const { data: reports, isLoading: reportsLoading, isError: reportsError } = useQuery<ResidualReport[]>({
    queryKey: ["/api/residual-reports"],
  });

  const { data: merchantResiduals, isLoading: residualsLoading } = useQuery<MerchantResidual[]>({
    queryKey: ["/api/merchant-residuals"],
  });

  const { data: midStats, isLoading: midStatsLoading } = useQuery<{
    stats: Array<{
      mid: string;
      midMasked?: string | null; // REV-05A: server returns masked value; prefer midMasked when present
      dealId: number | null;
      merchantName: string | null;
      latestDate: string | null;
      latestVolume: string | null;
      latestTxCount: number | null;
      latestAvgTicket: string | null;
      latestEffectiveRate: string | null;
      latestChargebackCount: number | null;
      fetchedAt: string | null;
    }>;
    latestFetch: string | null;
    totalMids: number;
    activeMids: number;
  }>({
    queryKey: ["/api/mid-stats/summary"],
    queryFn: async () => {
      const res = await fetch("/api/mid-stats/summary", { credentials: "include" });
      if (!res.ok) return { stats: [], latestFetch: null, totalMids: 0, activeMids: 0 };
      return res.json();
    },
  });

  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: imports, isLoading: importsLoading } = useQuery<ResidualImport[]>({
    queryKey: ["/api/residuals/imports"],
  });

  const { data: selectedImport, isLoading: selectedImportLoading } = useQuery<ResidualImport | null>({
    queryKey: ["/api/residuals/imports", selectedImportId],
    queryFn: async (): Promise<ResidualImport | null> => {
      if (!selectedImportId) return null;
      const res = await fetch(`/api/residuals/imports/${selectedImportId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load import");
      return res.json() as Promise<ResidualImport>;
    },
    enabled: !!selectedImportId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const residualHeaders: Record<string, string> = {};
      const csrfResidual = getCsrfToken();
      if (csrfResidual) residualHeaders["X-CSRF-Token"] = csrfResidual;
      const res = await fetch("/api/residuals/import", {
        method: "POST",
        headers: residualHeaders,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json() as Promise<ResidualImport>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports"] });
      setSelectedImportId(data.id);
      toast({ title: "File imported successfully", description: `${data.totalRows} rows parsed. ${data.matchedRows} matched, ${data.unmatchedRows} unmatched.` });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/residuals/imports/${id}/confirm`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports", selectedImportId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-residuals"] });
      toast({ title: "Reconciliation confirmed", description: "Residuals have been posted to agent ledgers." });
    },
    onError: (err: Error) => toast({ title: "Confirmation failed", description: err.message, variant: "destructive" }),
  });

  const { data: dealsResp } = useQuery<{ data: Array<{ id: number; companyId: number | null; mid: string | null; stage: string; estimatedNetProfitMonthly: string | null }> }>({
    queryKey: ["/api/deals", { limit: 500 }],
    queryFn: async () => {
      const res = await fetch("/api/deals?limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load deals");
      return res.json();
    },
    enabled: !!linkRow,
  });

  const { data: companies } = useQuery<Array<{ id: number; legalName: string; dba: string | null }>>({
    queryKey: ["/api/companies"],
    enabled: !!linkRow,
  });

  const linkMatchMutation = useMutation({
    mutationFn: async ({ rowId, dealId }: { rowId: number; dealId: number }) => {
      const res = await apiRequest("PATCH", `/api/residuals/imports/${selectedImportId}/rows/${rowId}/match`, { dealId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports", selectedImportId] });
      toast({ title: "MID linked", description: "Row moved to matched and variance recomputed." });
      setLinkRow(null);
      setSelectedDealId(null);
      setDealSearch("");
    },
    onError: (err: Error) => toast({ title: "Link failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/residuals/imports/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/residuals/imports"] });
      if (selectedImportId === id) setSelectedImportId(null);
      toast({ title: "Import deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const handleUpload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast({ title: "Please select a file", variant: "destructive" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("month", uploadMonth);
    fd.append("varianceThresholdPct", thresholdPct);
    fd.append("varianceThresholdAmt", thresholdAmt);
    uploadMutation.mutate(fd);
  };

  const currentMonth = reports && reports.length > 0 ? reports[0] : null;
  const last6Months = reports?.slice(0, 6).reverse() || [];
  const maxRevenue = last6Months.length > 0 ? Math.max(...last6Months.map((r) => r.totalRevenue)) : 0;

  const totalRevenue = currentMonth?.totalRevenue;
  const activeMerchants = currentMonth?.activeMerchants;
  const avgRevenuePerMerchant = totalRevenue != null && activeMerchants != null && activeMerchants > 0
    ? totalRevenue / activeMerchants
    : null;
  const attritionRate = currentMonth?.attritionRate;
  const hasData = !!reports && reports.length > 0;

  const filteredMerchants = useMemo(() => {
    if (!merchantResiduals) return [];
    const sorted = [...merchantResiduals].sort((a, b) => b.revenue - a.revenue);
    const afterGroup = groupMidSet ? sorted.filter(m => groupMidSet.has(m.mid)) : sorted;
    if (!searchQuery) return afterGroup;
    const q = searchQuery.toLowerCase();
    return afterGroup.filter(
      (m) =>
        m.merchantName.toLowerCase().includes(q) ||
        m.mid.toLowerCase().includes(q) ||
        m.agent.toLowerCase().includes(q)
    );
  }, [merchantResiduals, searchQuery, groupMidSet]);

  const agentSummary = useMemo(() => {
    if (agents && agents.length > 0) return agents;
    if (!merchantResiduals) return [];
    const agentMap = new Map<string, { totalDeals: number; revenueManaged: number; commissionEarned: number }>();
    merchantResiduals.forEach((m) => {
      const existing = agentMap.get(m.agent) || { totalDeals: 0, revenueManaged: 0, commissionEarned: 0 };
      existing.totalDeals += 1;
      existing.revenueManaged += m.revenue;
      existing.commissionEarned += parseFloat(m.agentCommission || "0");
      agentMap.set(m.agent, existing);
    });
    return Array.from(agentMap.entries()).map(([name, data], i) => ({
      id: i,
      name,
      ...data,
    }));
  }, [agents, merchantResiduals]);

  const matchedRows = selectedImport?.rows?.filter(r => r.isMatched) || [];
  const unmatchedRows = selectedImport?.rows?.filter(r => !r.isMatched) || [];
  const flaggedMatchedRows = matchedRows.filter(r => r.varianceStatus !== "in_range");

  const agentReconciliation = useMemo(() => {
    if (!matchedRows.length) return [];
    const map = new Map<string, { agentName: string; agentId: number | null; expectedTotal: number; actualTotal: number; variance: number; count: number }>();
    for (const row of matchedRows) {
      const key = row.agentName || "Unassigned";
      const existing = map.get(key) || { agentName: key, agentId: row.agentId, expectedTotal: 0, actualTotal: 0, variance: 0, count: 0 };
      existing.expectedTotal += parseFloat(row.expectedResidual || "0");
      existing.actualTotal += parseFloat(row.netResidual || "0");
      existing.variance += parseFloat(row.variance || "0");
      existing.count++;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }, [matchedRows]);

  return (
    <div className="space-y-6" data-testid="page-residual-revenue">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Residual Revenue</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Portfolio performance, reconciliation, and agent commissions
            </p>
          </div>
          <TabsList data-testid="tabs-residual" className="flex-wrap h-auto gap-1">
            <TabsTrigger value="dashboard" data-testid="tab-dashboard"><BarChart3 className="w-4 h-4 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="by-partner" data-testid="tab-by-partner"><Users className="w-4 h-4 mr-1" />By Partner</TabsTrigger>
            <TabsTrigger value="reconcile" data-testid="tab-reconcile"><Upload className="w-4 h-4 mr-1" />Import & Reconcile</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history"><FileText className="w-4 h-4 mr-1" />History</TabsTrigger>
            <TabsTrigger value="payouts" data-testid="tab-payouts"><Banknote className="w-4 h-4 mr-1" />Payouts</TabsTrigger>
          </TabsList>
        </div>

        {/* ── DASHBOARD TAB ─────────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-8">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportToCSV(filteredMerchants, "residual_revenue", [
                { key: "merchantName", label: "Merchant" },
                { key: "mid", label: "MID" },
                { key: "volume", label: "Volume" },
                { key: "revenue", label: "Revenue" },
                { key: "revenueChange", label: "Change %" },
              ])}
              data-testid="button-export-revenue"
            >
              <Download className="w-4 h-4 mr-1" /> Export Revenue Data
            </Button>
          </div>

          {reportsError ? (
            <Card className="border-destructive/50" data-testid="card-residuals-unavailable">
              <CardContent className="py-8 text-center text-destructive">Residual report data is unavailable. No portfolio totals are shown.</CardContent>
            </Card>
          ) : !hasData && !reportsLoading && (
            <Card className="bg-primary/5 dark:bg-primary/10" data-testid="card-no-data">
              <CardContent className="py-8 text-center">
                <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground" data-testid="text-no-data">
                  Import residual data to see revenue metrics
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="section-kpi-cards">
            {reportsLoading ? (
              <><KPISkeleton /><KPISkeleton /><KPISkeleton /><KPISkeleton /></>
            ) : (
              <>
                <Card data-testid="card-kpi-total-revenue">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total Portfolio Revenue</CardTitle>
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-revenue">{formatCurrency(totalRevenue)}</div>
                    <p className="text-xs text-muted-foreground mt-1">This month</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-kpi-active-merchants">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Active Merchants</CardTitle>
                    <Users className="w-4 h-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-active-merchants">{activeMerchants?.toLocaleString() ?? "—"}</div>
                    <p className="text-xs text-muted-foreground mt-1">Processing merchants</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-kpi-avg-revenue">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Avg Revenue Per Merchant</CardTitle>
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-avg-revenue">{formatCurrencyDetailed(avgRevenuePerMerchant)}</div>
                    <p className="text-xs text-muted-foreground mt-1">Per merchant average</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-kpi-attrition">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Attrition Rate</CardTitle>
                    <Percent className="w-4 h-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-attrition-rate">{attritionRate == null ? "—" : `${attritionRate.toFixed(1)}%`}</div>
                    <p className="text-xs text-muted-foreground mt-1">Monthly merchant churn</p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <Card data-testid="card-revenue-chart">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Revenue Trend (Last 6 Months)</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="flex items-end gap-3 h-48">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <Skeleton className="w-full" style={{ height: `${40 + Math.random() * 60}%` }} />
                      <Skeleton className="h-3 w-10" />
                    </div>
                  ))}
                </div>
              ) : last6Months.length > 0 ? (
                <div className="flex items-end gap-3 h-48" data-testid="chart-revenue-bars">
                  {last6Months.map((report) => {
                    const height = maxRevenue > 0 ? (report.totalRevenue / maxRevenue) * 100 : 0;
                    return (
                      <div key={`${report.month}-${report.year}`} className="flex-1 flex flex-col items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{formatCurrency(report.totalRevenue)}</span>
                        <div className="w-full bg-primary/80 dark:bg-primary/60 rounded-md transition-all" style={{ height: `${Math.max(height, 4)}%` }} />
                        <span className="text-xs text-muted-foreground">{report.month}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-foreground">No revenue data available</div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-merchant-residuals">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Merchant Residuals</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {parentAccountsList.length > 0 && (
                  <Select
                    value={groupFilterParentId ? String(groupFilterParentId) : "all"}
                    onValueChange={(v) => setGroupFilterParentId(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="h-9 w-[180px]" data-testid="select-residuals-group-filter">
                      <SelectValue placeholder="All groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" data-testid="residuals-group-all">All groups</SelectItem>
                      {parentAccountsList.map(c => (
                        <SelectItem key={c.id} value={String(c.id)} data-testid={`residuals-group-${c.id}`}>
                          {c.companyName || `${c.firstName} ${c.lastName}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search merchants..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-64"
                    data-testid="input-search-merchants"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table data-testid="table-merchant-residuals">
                <TableHeader>
                  <TableRow>
                    <TableHead>Merchant Name</TableHead>
                    <TableHead>MID</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Net Revenue</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {residualsLoading ? (
                    <TableSkeleton rows={5} cols={9} />
                  ) : filteredMerchants.length > 0 ? (
                    filteredMerchants.map((merchant) => (
                      <TableRow key={merchant.id} data-testid={`row-merchant-${merchant.id}`}>
                        <TableCell className="font-medium">{merchant.merchantName}</TableCell>
                        <TableCell className="text-muted-foreground">{merchant.mid}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{formatCurrency(merchant.volume)}</span>
                            <ChangeIndicator value={merchant.volumeChange} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{formatCurrencyDetailed(merchant.revenue)}</span>
                            <ChangeIndicator value={merchant.revenueChange} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrencyDetailed(merchant.cost)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrencyDetailed(merchant.netRevenue)}</TableCell>
                        <TableCell>{merchant.agent}</TableCell>
                        <TableCell className="text-right">{formatCurrencyDetailed(parseFloat(merchant.agentCommission || "0"))}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {merchant.flags.length > 0 ? (
                              merchant.flags.map((flag) => (
                                <Badge key={flag} variant={flag === "critical" ? "destructive" : "secondary"} className="text-xs">
                                  {flag === "critical" && <AlertTriangle className="w-3 h-3 mr-1" />}{flag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {searchQuery ? "No merchants match your search" : "No merchant residual data available"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── MID DATA FRESHNESS PANEL ──────────────────────────────── */}
          <Card data-testid="card-mid-stats-freshness">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Live MID Processing Data</CardTitle>
              </div>
              {midStats && midStats.latestFetch && (() => {
                const fetchDate = new Date(midStats.latestFetch);
                const hoursAgo = Math.round((Date.now() - fetchDate.getTime()) / 3600000);
                const isStale = hoursAgo > 26;
                return (
                  <Badge
                    variant={isStale ? "destructive" : "secondary"}
                    className="flex items-center gap-1 text-xs"
                    data-testid="badge-mid-data-freshness"
                  >
                    {isStale ? <AlertCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                    {isStale
                      ? `Data stale — last sync ${hoursAgo}h ago`
                      : `Synced ${hoursAgo < 1 ? "< 1h" : `${hoursAgo}h`} ago`}
                  </Badge>
                );
              })()}
              {midStats && !midStats.latestFetch && !midStatsLoading && (
                <Badge variant="outline" className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="badge-mid-data-never-synced">
                  <Clock className="w-3 h-3" /> Never synced
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {midStatsLoading ? (
                <div className="flex gap-6">
                  <Skeleton className="h-12 w-32 rounded" />
                  <Skeleton className="h-12 w-32 rounded" />
                  <Skeleton className="h-12 w-32 rounded" />
                </div>
              ) : midStats && midStats.totalMids > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-6 text-sm">
                    <div data-testid="stat-total-mids">
                      <p className="text-muted-foreground text-xs">Total MIDs</p>
                      <p className="text-2xl font-bold">{midStats.totalMids}</p>
                    </div>
                    <div data-testid="stat-active-mids">
                      <p className="text-muted-foreground text-xs">With Recent Data</p>
                      <p className="text-2xl font-bold text-green-600">{midStats.activeMids}</p>
                    </div>
                    <div data-testid="stat-pending-mids">
                      <p className="text-muted-foreground text-xs">Pending First Sync</p>
                      <p className="text-2xl font-bold text-orange-500">{midStats.totalMids - midStats.activeMids}</p>
                    </div>
                  </div>
                  <Table data-testid="table-mid-stats">
                    <TableHeader>
                      <TableRow>
                        <TableHead>MID</TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead className="text-right">Latest Volume</TableHead>
                        <TableHead className="text-right">Txn Count</TableHead>
                        <TableHead className="text-right">Avg Ticket</TableHead>
                        <TableHead className="text-right">Eff. Rate</TableHead>
                        <TableHead className="text-right">Chargebacks</TableHead>
                        <TableHead>Data Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {midStats.stats.map((s) => (
                        <TableRow key={s.midMasked ?? s.mid} data-testid={`row-mid-stat-${s.midMasked ?? s.mid}`}>
                          <TableCell className="font-mono text-xs">{s.midMasked ?? s.mid}</TableCell>
                          <TableCell className="text-muted-foreground">{s.merchantName ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {s.latestVolume != null
                              ? `$${parseFloat(s.latestVolume).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.latestTxCount != null ? s.latestTxCount.toLocaleString() : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.latestAvgTicket != null
                              ? `$${parseFloat(s.latestAvgTicket).toFixed(2)}`
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.latestEffectiveRate != null
                              ? `${parseFloat(s.latestEffectiveRate).toFixed(2)}%`
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.latestChargebackCount != null ? (
                              <span className={s.latestChargebackCount > 0 ? "text-red-600 font-medium" : ""}>
                                {s.latestChargebackCount}
                              </span>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {s.latestDate ? (
                              <Badge variant="outline" className="text-xs font-mono">
                                {s.latestDate}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" /> No data
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground" data-testid="text-no-mid-data">
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No MIDs assigned yet. Approve deals with a MID to see live processing data here.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-agent-commissions">
            <CardHeader>
              <CardTitle className="text-base">Agent Commission Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table data-testid="table-agent-commissions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent Name</TableHead>
                    <TableHead className="text-right">Total Deals</TableHead>
                    <TableHead className="text-right">Revenue Managed</TableHead>
                    <TableHead className="text-right">Commission Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentsLoading || residualsLoading ? (
                    <TableSkeleton rows={3} cols={4} />
                  ) : agentSummary.length > 0 ? (
                    agentSummary.map((agent) => (
                      <TableRow key={agent.id} data-testid={`row-agent-${agent.id}`}>
                        <TableCell className="font-medium">{agent.name}</TableCell>
                        <TableCell className="text-right">{agent.totalDeals}</TableCell>
                        <TableCell className="text-right">{formatCurrency(agent.revenueManaged)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrencyDetailed(agent.commissionEarned)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No agent commission data available</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY PARTNER TAB ──────────────────────────────────────────────── */}
        <ByPartnerTab />

        {/* ── PAYOUTS TAB ─────────────────────────────────────────────────── */}
        <PayoutsTab />

        {/* ── IMPORT & RECONCILE TAB ─────────────────────────────────────── */}

        <TabsContent value="reconcile" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload Panel */}
            <Card className="lg:col-span-1" data-testid="card-upload">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="w-4 h-4 text-primary" />
                  Upload Processor Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpload} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="upload-month">Report Month</Label>
                    <Input
                      id="upload-month"
                      type="month"
                      value={uploadMonth}
                      onChange={e => setUploadMonth(e.target.value)}
                      data-testid="input-upload-month"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="upload-file">CSV file</Label>
                    <Input
                      id="upload-file"
                      type="file"
                      ref={fileRef}
                      accept=".csv,text/csv"
                      data-testid="input-upload-file"
                    />
                    <p className="text-xs text-muted-foreground">Supported columns: MID, DBA/Merchant Name, Volume, Gross Residual, Net Residual</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="threshold-pct">Variance % Threshold</Label>
                      <Input
                        id="threshold-pct"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={thresholdPct}
                        onChange={e => setThresholdPct(e.target.value)}
                        data-testid="input-threshold-pct"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="threshold-amt">Variance $ Threshold</Label>
                      <Input
                        id="threshold-amt"
                        type="number"
                        min="0"
                        step="5"
                        value={thresholdAmt}
                        onChange={e => setThresholdAmt(e.target.value)}
                        data-testid="input-threshold-amt"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={uploadMutation.isPending}
                    data-testid="button-upload-submit"
                  >
                    {uploadMutation.isPending ? "Parsing & Matching…" : "Upload & Parse File"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Pending Imports List */}
            <Card className="lg:col-span-2" data-testid="card-pending-imports">
              <CardHeader>
                <CardTitle className="text-base">Pending Reconciliations</CardTitle>
              </CardHeader>
              <CardContent>
                {importsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : imports && imports.filter(i => i.status === "pending").length > 0 ? (
                  <div className="space-y-2" data-testid="list-pending-imports">
                    {imports.filter(i => i.status === "pending").map(imp => (
                      <div
                        key={imp.id}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${selectedImportId === imp.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                        onClick={() => setSelectedImportId(imp.id)}
                        data-testid={`card-import-${imp.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{imp.fileName}</div>
                            <div className="text-xs text-muted-foreground">{imp.month} · {imp.totalRows} rows · {imp.matchedRows} matched · {imp.flaggedRows} flagged</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <ImportStatusBadge status={imp.status} />
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground" data-testid="text-no-pending">
                    <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No pending reconciliations. Upload a file to get started.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Review Panel */}
          {selectedImportId && (
            <Card data-testid="card-review-panel">
              <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base">
                    {selectedImportLoading ? <Skeleton className="h-5 w-48" /> : `Review: ${selectedImport?.fileName}`}
                  </CardTitle>
                  {selectedImport && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedImport.month} · {selectedImport.matchedRows} matched · {selectedImport.unmatchedRows} unmatched · {selectedImport.flaggedRows} flagged
                    </p>
                  )}
                </div>
                {selectedImport && selectedImport.status === "pending" && (
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(selectedImport.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-reject-import"
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => confirmMutation.mutate(selectedImport.id)}
                      disabled={confirmMutation.isPending}
                      data-testid="button-confirm-import"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      {confirmMutation.isPending ? "Confirming…" : "Confirm & Post Residuals"}
                    </Button>
                  </div>
                )}
                {selectedImport?.status === "confirmed" && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
                    <CheckCircle className="w-3 h-3 mr-1" /> Confirmed {selectedImport.confirmedAt ? new Date(selectedImport.confirmedAt).toLocaleDateString() : ""}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary KPIs */}
                {selectedImport && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground mb-1">Total Net Residual</div>
                      <div className="font-bold text-lg">{formatCurrencyDetailed(selectedImport.totalNetResidual)}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground mb-1">Total Variance</div>
                      <div className={`font-bold text-lg ${parseFloat(selectedImport.totalVariance) < 0 ? "text-red-600" : parseFloat(selectedImport.totalVariance) > 0 ? "text-orange-500" : ""}`}>
                        {formatCurrencyDetailed(selectedImport.totalVariance)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground mb-1">Matched MIDs</div>
                      <div className="font-bold text-lg text-green-600">{selectedImport.matchedRows}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground mb-1">Flagged Variances</div>
                      <div className={`font-bold text-lg ${selectedImport.flaggedRows > 0 ? "text-orange-500" : "text-green-600"}`}>{selectedImport.flaggedRows}</div>
                    </div>
                  </div>
                )}

                {/* #residual-variance — Variance alert banner */}
                {flaggedMatchedRows.length > 0 && (
                  <div
                    className="flex items-start gap-3 p-3 rounded-md bg-orange-50 border border-orange-200 dark:bg-orange-900/20 dark:border-orange-800"
                    data-testid="banner-variance-alert"
                  >
                    <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                        {flaggedMatchedRows.length} MID{flaggedMatchedRows.length !== 1 ? "s" : ""} with out-of-range variance
                      </p>
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                        Review the flagged rows in the Matched MIDs tab below. Large negative variances may indicate billing errors or merchant risk.
                      </p>
                    </div>
                  </div>
                )}

                {/* Agent reconciliation summary */}
                {agentReconciliation.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Users className="w-4 h-4 text-primary" />Per-Agent Reconciliation</h3>
                    <div className="overflow-x-auto">
                    <Table data-testid="table-agent-reconciliation">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Agent</TableHead>
                          <TableHead className="text-right">MIDs</TableHead>
                          <TableHead className="text-right">Expected Total</TableHead>
                          <TableHead className="text-right">Actual Total</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentReconciliation.map(a => (
                          <TableRow key={a.agentName} data-testid={`row-agent-recon-${a.agentName}`}>
                            <TableCell className="font-medium">{a.agentName}</TableCell>
                            <TableCell className="text-right">{a.count}</TableCell>
                            <TableCell className="text-right">{formatCurrencyDetailed(a.expectedTotal)}</TableCell>
                            <TableCell className="text-right">{formatCurrencyDetailed(a.actualTotal)}</TableCell>
                            <TableCell className={`text-right font-medium ${a.variance < 0 ? "text-red-600" : a.variance > 0 ? "text-orange-500" : ""}`}>
                              {a.variance >= 0 ? "+" : ""}{formatCurrencyDetailed(a.variance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}

                {/* Row tabs */}
                <Tabs value={reviewTab} onValueChange={v => setReviewTab(v as any)}>
                  <TabsList>
                    <TabsTrigger value="matched" data-testid="tab-matched">
                      Matched MIDs <Badge variant="secondary" className="ml-1.5 text-xs">{matchedRows.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="unmatched" data-testid="tab-unmatched">
                      Unmatched MIDs <Badge variant="secondary" className="ml-1.5 text-xs">{unmatchedRows.length}</Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="matched">
                    {selectedImportLoading ? (
                      <Table><TableBody><TableSkeleton rows={4} cols={7} /></TableBody></Table>
                    ) : matchedRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <Table data-testid="table-matched-rows">
                          <TableHeader>
                            <TableRow>
                              <TableHead>MID</TableHead>
                              <TableHead>Merchant</TableHead>
                              <TableHead className="text-right">Volume</TableHead>
                              <TableHead className="text-right">Txns</TableHead>
                              <TableHead className="text-right">Proc. Cost</TableHead>
                              <TableHead className="text-right">Expected</TableHead>
                              <TableHead className="text-right">Actual</TableHead>
                              <TableHead className="text-right">Variance</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Agent</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {matchedRows.map(row => (
                              <TableRow
                                key={row.id}
                                className={row.varianceStatus !== "in_range" ? "bg-orange-50/50 dark:bg-orange-900/10" : ""}
                                data-testid={`row-matched-${row.id}`}
                              >
                                <TableCell className="font-mono text-xs">{row.mid}</TableCell>
                                <TableCell className="font-medium text-sm">{row.merchantName || "—"}</TableCell>
                                <TableCell className="text-right text-sm">{formatCurrencyDetailed(row.volume)}</TableCell>
                                {/* #1285 — transaction count and processing cost */}
                                <TableCell className="text-right text-sm" data-testid={`cell-transactions-${row.id}`}>
                                  {(row as any).transactions != null ? Number((row as any).transactions).toLocaleString() : "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm" data-testid={`cell-proc-cost-${row.id}`}>
                                  {(row as any).processingCost != null ? formatCurrencyDetailed((row as any).processingCost) : "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm">{formatCurrencyDetailed(row.expectedResidual)}</TableCell>
                                <TableCell className="text-right text-sm font-medium">{formatCurrencyDetailed(row.netResidual)}</TableCell>
                                <TableCell className={`text-right text-sm font-medium ${parseFloat(row.variance) < 0 ? "text-red-600" : parseFloat(row.variance) > 0 ? "text-orange-500" : ""}`}>
                                  {parseFloat(row.variance) >= 0 ? "+" : ""}{formatCurrencyDetailed(row.variance)}
                                  {row.variancePct !== "0.00" && <span className="text-xs text-muted-foreground ml-1">({parseFloat(row.variancePct).toFixed(1)}%)</span>}
                                </TableCell>
                                <TableCell><VarianceBadge status={row.varianceStatus} /></TableCell>
                                <TableCell className="text-sm">{row.agentName || "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">No matched MIDs</div>
                    )}
                  </TabsContent>

                  <TabsContent value="unmatched">
                    {selectedImportLoading ? (
                      <Table><TableBody><TableSkeleton rows={4} cols={4} /></TableBody></Table>
                    ) : unmatchedRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <Table data-testid="table-unmatched-rows">
                          <TableHeader>
                            <TableRow>
                              <TableHead>MID</TableHead>
                              <TableHead>Merchant Name</TableHead>
                              <TableHead className="text-right">Volume</TableHead>
                              <TableHead className="text-right">Net Residual</TableHead>
                              <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unmatchedRows.map(row => (
                              <TableRow key={row.id} data-testid={`row-unmatched-${row.id}`}>
                                <TableCell className="font-mono text-xs">{row.mid}</TableCell>
                                <TableCell className="text-sm">{row.merchantName || "—"}</TableCell>
                                <TableCell className="text-right text-sm">{formatCurrencyDetailed(row.volume)}</TableCell>
                                <TableCell className="text-right text-sm font-medium">{formatCurrencyDetailed(row.netResidual)}</TableCell>
                                <TableCell className="text-right">
                                  {selectedImport?.status === "pending" ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => { setLinkRow(row); setSelectedDealId(null); setDealSearch(row.merchantName || row.mid); }}
                                      data-testid={`button-link-${row.id}`}
                                    >
                                      <Link2 className="w-3 h-3 mr-1" /> Link to Merchant
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600" /> All MIDs matched successfully
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── HISTORY TAB ───────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <Card data-testid="card-history">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" /> Import History
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Full audit trail of every residual reconciliation run. Click any row to expand the per-merchant breakdown.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              {importsLoading ? (
                <Table><TableBody><TableSkeleton rows={5} cols={10} /></TableBody></Table>
              ) : imports && imports.length > 0 ? (
                <Table data-testid="table-history">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead className="text-right">Merchants</TableHead>
                      <TableHead className="text-right">Gross Residual</TableHead>
                      <TableHead className="text-right">Net Residual</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {imports.map(imp => (
                      <ImportHistoryRow
                        key={imp.id}
                        imp={imp}
                        onReimport={(month) => { setUploadMonth(month); setActiveTab("reconcile"); }}
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-history">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No imports yet.</p>
                  <button
                    className="text-sm mt-1 text-primary underline underline-offset-2 hover:opacity-80"
                    onClick={() => setActiveTab("reconcile")}
                    data-testid="link-go-to-reconcile"
                  >
                    Go to Import &amp; Reconcile →
                  </button>
                </div>
              )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!linkRow} onOpenChange={(open) => { if (!open) { setLinkRow(null); setSelectedDealId(null); setDealSearch(""); } }}>
        <DialogContent data-testid="dialog-link-merchant" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Link MID to Merchant</DialogTitle>
            <DialogDescription>
              Search for an existing deal or merchant to link MID <span className="font-mono text-foreground">{linkRow?.mid}</span> to.
              Once linked, this row will be reconciled and posted to the matching agent's ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="Search by merchant name, MID, or deal ID…"
              value={dealSearch}
              onChange={(e) => setDealSearch(e.target.value)}
              data-testid="input-deal-search"
            />
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {(() => {
                const allDeals = dealsResp?.data || [];
                const companyMap = new Map((companies || []).map(c => [c.id, c]));
                const q = dealSearch.trim().toLowerCase();
                const results = allDeals
                  .map(d => {
                    const co = d.companyId ? companyMap.get(d.companyId) : undefined;
                    const name = co?.dba || co?.legalName || `Deal #${d.id}`;
                    return { ...d, _name: name };
                  })
                  .filter(d => {
                    if (!q) return true;
                    return (
                      d._name.toLowerCase().includes(q) ||
                      String(d.id).includes(q) ||
                      (d.mid || "").toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 50);

                if (results.length === 0) {
                  return <div className="p-4 text-sm text-muted-foreground text-center" data-testid="text-no-deals">No deals match your search.</div>;
                }

                return (
                  <ul className="divide-y">
                    {results.map(d => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedDealId(d.id)}
                          className={`w-full text-left px-3 py-2 hover-elevate active-elevate-2 ${selectedDealId === d.id ? "bg-primary/10" : ""}`}
                          data-testid={`option-deal-${d.id}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{d._name}</div>
                              <div className="text-xs text-muted-foreground">
                                Deal #{d.id} · {d.stage}
                                {d.mid ? <> · MID <span className="font-mono">{d.mid}</span></> : ""}
                              </div>
                            </div>
                            {d.estimatedNetProfitMonthly && (
                              <div className="text-xs text-muted-foreground whitespace-nowrap">
                                Est. {formatCurrencyDetailed(d.estimatedNetProfitMonthly)}/mo
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkRow(null)} data-testid="button-cancel-link">Cancel</Button>
            <Button
              onClick={() => {
                if (linkRow && selectedDealId) {
                  linkMatchMutation.mutate({ rowId: linkRow.id, dealId: selectedDealId });
                }
              }}
              disabled={!selectedDealId || linkMatchMutation.isPending}
              data-testid="button-confirm-link"
            >
              {linkMatchMutation.isPending ? "Linking…" : "Link Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayoutsTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();

  const { data: payouts = [], isLoading, refetch } = useQuery<AgentPayout[]>({
    queryKey: ["/api/payouts", { month: selectedMonth, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMonth) params.set("month", selectedMonth);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/payouts?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payouts");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (month: string) => {
      const res = await apiRequest("POST", `/api/payouts/generate/${month}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Generation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Payouts generated", description: `${data.generated} agent payout row(s) created for ${selectedMonth}.` });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/payouts/${id}/approve`);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Payout approved" }); refetch(); },
    onError: (err: Error) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/payouts/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Payout marked as paid" }); refetch(); },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  // Group by period for totals
  const byPeriod = useMemo(() => {
    const map = new Map<string, { rows: AgentPayout[]; totalAgent: number; totalGross: number }>();
    for (const p of payouts) {
      const existing = map.get(p.periodMonth) ?? { rows: [], totalAgent: 0, totalGross: 0 };
      existing.rows.push(p);
      existing.totalAgent += parseFloat(p.agentShare || "0");
      existing.totalGross += parseFloat(p.grossResidual || "0");
      map.set(p.periodMonth, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [payouts]);

  return (
    <TabsContent value="payouts" className="space-y-6" data-testid="tab-content-payouts">
      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-3 flex gap-2 items-start text-xs text-blue-800 dark:text-blue-300">
        <span className="shrink-0 mt-0.5">💡</span>
        <span>
          Payouts are generated <strong>after confirming a residual import</strong>. Use <strong>Generate Payouts</strong> below to compute agent shares for a period.
          Approve them, then mark as paid once disbursed.
        </span>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="w-4 h-4 text-primary" />
            Payout Ledger
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Period</Label>
              <Input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-44"
                data-testid="input-payout-month"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9" data-testid="select-payout-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => generateMutation.mutate(selectedMonth)}
              disabled={generateMutation.isPending}
              size="sm"
              data-testid="button-generate-payouts"
            >
              {generateMutation.isPending ? "Generating…" : "Generate Payouts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payout table */}
      {isLoading ? (
        <Card><CardContent className="p-6 space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      ) : payouts.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Banknote className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-payouts">
            No payout records for this period / filter. Generate payouts after confirming an import.
          </p>
        </CardContent></Card>
      ) : (
        <div className="space-y-6">
          {byPeriod.map(([period, group]) => (
            <Card key={period} data-testid={`card-payout-period-${period}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold font-mono">{period}</CardTitle>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Gross: <strong className="text-foreground">{formatCurrencyDetailed(group.totalGross)}</strong></span>
                    <span>Total Agent Share: <strong className="text-green-600">{formatCurrencyDetailed(group.totalAgent)}</strong></span>
                    <span>{group.rows.length} agent(s)</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table data-testid={`table-payouts-${period}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent User ID</TableHead>
                        <TableHead className="text-right">Gross Residual</TableHead>
                        <TableHead className="text-right">Agent Share</TableHead>
                        <TableHead className="text-right">Partner Share</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Paid On</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((payout) => (
                        <TableRow key={payout.id} data-testid={`row-payout-${payout.id}`}>
                          <TableCell className="font-mono text-xs">{payout.agentUserId}</TableCell>
                          <TableCell className="text-right">{formatCurrencyDetailed(payout.grossResidual)}</TableCell>
                          <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">
                            {formatCurrencyDetailed(payout.agentShare)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {parseFloat(payout.partnerShare || "0") > 0
                              ? formatCurrencyDetailed(payout.partnerShare)
                              : <span className="text-xs">—</span>}
                          </TableCell>
                          <TableCell><PayoutStatusBadge status={payout.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {payout.paidAt
                              ? new Date(payout.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {payout.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => approveMutation.mutate(payout.id)}
                                  disabled={approveMutation.isPending}
                                  data-testid={`button-approve-${payout.id}`}
                                >
                                  Approve
                                </Button>
                              )}
                              {(payout.status === "approved") && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => markPaidMutation.mutate(payout.id)}
                                  disabled={markPaidMutation.isPending}
                                  data-testid={`button-mark-paid-${payout.id}`}
                                >
                                  Mark Paid
                                </Button>
                              )}
                              {payout.status === "paid" && (
                                <span className="text-xs text-muted-foreground">Disbursed</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </TabsContent>
  );
}

function PayoutStatusBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0"><Banknote className="w-3 h-3 mr-1" />Paid</Badge>;
  if (status === "approved") return <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
  return <Badge variant="secondary" className="text-xs"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
}
