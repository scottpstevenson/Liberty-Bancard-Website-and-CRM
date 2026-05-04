import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Chargeback } from "@shared/schema";
import { CHARGEBACK_STATUSES, CHARGEBACK_CARD_BRANDS, CHARGEBACK_DEADLINE_DAYS } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, Plus, DollarSign, Clock, CheckCircle, XCircle, TrendingDown,
  ShieldAlert, FileText, ChevronRight, X, Loader2, ArrowUpRight,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  New: { label: "New", variant: "secondary" },
  "Under Review": { label: "Under Review", variant: "outline" },
  Responded: { label: "Responded", variant: "default" },
  Won: { label: "Won", variant: "default", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  Lost: { label: "Lost", variant: "destructive" },
};

const REASON_CODE_OPTIONS = [
  "13.1 – Merchandise/Services Not Received",
  "13.2 – Canceled Recurring",
  "13.3 – Not as Described",
  "13.4 – Counterfeit / Fraud",
  "13.5 – Misrepresentation",
  "13.6 – Credit Not Processed",
  "13.7 – Canceled Merchandise / Services",
  "4853 – Cardholder Dispute",
  "4855 – Non-Receipt of Merchandise",
  "4831 – Transaction Amount Differs",
  "4834 – Duplicate Processing",
  "4863 – Cardholder Does Not Recognize",
  "4849 – Questionable Merchant Activity",
  "C08 – Goods / Services Not Received",
  "C14 – Paid by Other Means",
  "C28 – Canceled Recurring",
  "C31 – Goods / Services Not as Described",
  "Other",
];

function isOverdue(cb: Chargeback): boolean {
  if (!cb.responseDeadline) return false;
  if (cb.status === "Won" || cb.status === "Lost") return false;
  return new Date(cb.responseDeadline) < new Date();
}

function daysUntilDeadline(cb: Chargeback): number | null {
  if (!cb.responseDeadline) return null;
  const diff = new Date(cb.responseDeadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

interface ChargebackFormState {
  contactId: string;
  dealId: string;
  transactionDate: string;
  amount: string;
  cardBrand: string;
  reasonCode: string;
  reasonDescription: string;
  notes: string;
}

const DEFAULT_FORM: ChargebackFormState = {
  contactId: "",
  dealId: "",
  transactionDate: "",
  amount: "",
  cardBrand: "Visa",
  reasonCode: "",
  reasonDescription: "",
  notes: "",
};

interface DetailPanelProps {
  chargeback: Chargeback;
  onClose: () => void;
  onUpdated: () => void;
}

function ChargebackDetailPanel({ chargeback: cb, onClose, onUpdated }: DetailPanelProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(cb.notes || "");
  const [editingStatus, setEditingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState(cb.status);
  const [outcome, setOutcome] = useState(cb.outcome || "");
  const [evidenceName, setEvidenceName] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/chargebacks/${cb.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks/stats"] });
      toast({ title: "Chargeback updated" });
      onUpdated();
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const evidenceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/chargebacks/${cb.id}/evidence`, { name: evidenceName, url: evidenceUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks"] });
      toast({ title: "Evidence file attached" });
      setEvidenceName("");
      setEvidenceUrl("");
      onUpdated();
    },
    onError: () => toast({ title: "Failed to attach evidence", variant: "destructive" }),
  });

  const overdue = isOverdue(cb);
  const days = daysUntilDeadline(cb);
  const statusConfig = STATUS_CONFIG[cb.status] || STATUS_CONFIG["New"];
  const evidenceFiles = (cb.evidenceFiles as any[]) || [];

  return (
    <div className="flex flex-col gap-6" data-testid="chargeback-detail-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={statusConfig.className} variant={statusConfig.variant} data-testid="badge-detail-status">
              {statusConfig.label}
            </Badge>
            {overdue && (
              <Badge variant="destructive" data-testid="badge-detail-overdue">
                <AlertTriangle className="w-3 h-3 mr-1" /> OVERDUE
              </Badge>
            )}
            <Badge variant="outline" data-testid="badge-detail-brand">{cb.cardBrand}</Badge>
          </div>
          <p className="text-2xl font-bold mt-2" data-testid="text-detail-amount">{formatCurrency(cb.amount)}</p>
          <p className="text-sm text-muted-foreground" data-testid="text-detail-reason-code">{cb.reasonCode}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close detail" onClick={onClose} data-testid="button-close-detail">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground block">Transaction Date</span>
          <span className="font-medium" data-testid="text-detail-tx-date">{formatDate(cb.transactionDate)}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Response Deadline</span>
          <span className={`font-medium ${overdue ? "text-red-600 dark:text-red-400" : days !== null && days <= 7 ? "text-amber-600 dark:text-amber-400" : ""}`} data-testid="text-detail-deadline">
            {cb.responseDeadline ? (
              <>
                {formatDate(cb.responseDeadline)}
                {days !== null && !["Won", "Lost"].includes(cb.status) && (
                  <span className="ml-1 text-xs">({overdue ? `${Math.abs(days)}d overdue` : `${days}d left`})</span>
                )}
              </>
            ) : "—"}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block">Card Brand</span>
          <span className="font-medium" data-testid="text-detail-card-brand">{cb.cardBrand}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Created</span>
          <span className="font-medium" data-testid="text-detail-created">{formatDate(cb.createdAt)}</span>
        </div>
        {cb.respondedAt && (
          <div>
            <span className="text-muted-foreground block">Responded At</span>
            <span className="font-medium" data-testid="text-detail-responded">{formatDate(cb.respondedAt)}</span>
          </div>
        )}
        {cb.outcome && (
          <div>
            <span className="text-muted-foreground block">Outcome</span>
            <span className="font-medium" data-testid="text-detail-outcome">{cb.outcome}</span>
          </div>
        )}
      </div>

      {cb.reasonDescription && (
        <div>
          <p className="text-sm text-muted-foreground mb-1">Reason Description</p>
          <p className="text-sm" data-testid="text-detail-reason-desc">{cb.reasonDescription}</p>
        </div>
      )}

      <div className="border-t pt-4">
        <p className="text-sm font-medium mb-2">Update Status</p>
        <div className="flex flex-wrap gap-2">
          {CHARGEBACK_STATUSES.map(s => (
            <Button
              key={s}
              size="sm"
              variant={cb.status === s ? "default" : "outline"}
              onClick={() => {
                const body: Record<string, any> = { status: s };
                if (s === "Won" || s === "Lost") body.outcome = s;
                if (s === "Responded") body.respondedAt = new Date().toISOString();
                updateMutation.mutate(body);
              }}
              disabled={updateMutation.isPending}
              data-testid={`button-status-${s.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm font-medium mb-2">Notes</p>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add notes about this chargeback..."
          rows={3}
          data-testid="textarea-notes"
        />
        <Button
          size="sm"
          className="mt-2"
          onClick={() => updateMutation.mutate({ notes })}
          disabled={updateMutation.isPending}
          data-testid="button-save-notes"
        >
          Save Notes
        </Button>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm font-medium mb-2">Evidence Files ({evidenceFiles.length})</p>
        {evidenceFiles.length > 0 && (
          <div className="space-y-2 mb-3">
            {evidenceFiles.map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm" data-testid={`evidence-file-${i}`}>
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                  {f.name}
                </a>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatDate(f.uploadedAt)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <Input
            placeholder="File name (e.g. Receipt.pdf)"
            value={evidenceName}
            onChange={e => setEvidenceName(e.target.value)}
            data-testid="input-evidence-name"
          />
          <Input
            placeholder="File URL or path"
            value={evidenceUrl}
            onChange={e => setEvidenceUrl(e.target.value)}
            data-testid="input-evidence-url"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => evidenceMutation.mutate()}
            disabled={!evidenceName || !evidenceUrl || evidenceMutation.isPending}
            data-testid="button-attach-evidence"
          >
            <Plus className="w-3 h-3 mr-1" /> Attach Evidence
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Chargebacks() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCb, setSelectedCb] = useState<Chargeback | null>(null);
  const [form, setForm] = useState<ChargebackFormState>(DEFAULT_FORM);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (brandFilter !== "all") queryParams.set("cardBrand", brandFilter);
  if (overdueFilter) queryParams.set("overdueOnly", "true");

  const { data: chargebackList = [], isLoading } = useQuery<Chargeback[]>({
    queryKey: ["/api/chargebacks", statusFilter, brandFilter, overdueFilter],
    queryFn: async () => {
      const res = await fetch(`/api/chargebacks?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: stats } = useQuery<{
    total: number; open: number; overdue: number; won: number; lost: number; thisMonthWinRate: number; totalAtRiskAmount: number;
  }>({
    queryKey: ["/api/chargebacks/stats"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/chargebacks", {
        contactId: form.contactId ? Number(form.contactId) : undefined,
        dealId: form.dealId ? Number(form.dealId) : undefined,
        transactionDate: form.transactionDate,
        amount: parseFloat(form.amount),
        cardBrand: form.cardBrand,
        reasonCode: form.reasonCode,
        reasonDescription: form.reasonDescription || undefined,
        notes: form.notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks/stats"] });
      toast({ title: "Chargeback logged successfully" });
      setShowCreate(false);
      setForm(DEFAULT_FORM);
    },
    onError: (err: any) => {
      toast({ title: "Failed to log chargeback", description: err.message, variant: "destructive" });
    },
  });

  const deadlineDays = CHARGEBACK_DEADLINE_DAYS[form.cardBrand] ?? 30;

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="chargebacks-loading">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-chargebacks">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Chargebacks</h1>
          <p className="text-muted-foreground mt-1">Track disputes, manage deadlines, and win more chargebacks</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-log-chargeback">
          <Plus className="w-4 h-4 mr-2" /> Log Chargeback
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-stat-open">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Disputes</CardTitle>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-open">{stats?.open ?? 0}</div>
            <p className="text-xs text-muted-foreground">Requiring action</p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-overdue">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-stat-overdue">{stats?.overdue ?? 0}</div>
            <p className="text-xs text-muted-foreground">Past deadline</p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-winrate">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">This Month Win Rate</CardTitle>
            <CheckCircle className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-stat-winrate">{stats?.thisMonthWinRate ?? 0}%</div>
            <p className="text-xs text-muted-foreground">{stats?.won ?? 0} won / {stats?.lost ?? 0} lost</p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-at-risk">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total At-Risk</CardTitle>
            <DollarSign className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-at-risk">{formatCurrency(stats?.totalAtRiskAmount ?? 0)}</div>
            <p className="text-xs text-muted-foreground">Open dispute value</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {CHARGEBACK_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-40" data-testid="select-brand-filter">
            <SelectValue placeholder="All Card Brands" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Card Brands</SelectItem>
            {CHARGEBACK_CARD_BRANDS.map(b => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={overdueFilter ? "default" : "outline"}
          size="sm"
          onClick={() => setOverdueFilter(v => !v)}
          data-testid="button-filter-overdue"
        >
          <Clock className="w-4 h-4 mr-1" /> Overdue Only
        </Button>

        {(statusFilter !== "all" || brandFilter !== "all" || overdueFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStatusFilter("all"); setBrandFilter("all"); setOverdueFilter(false); }}
            data-testid="button-clear-filters"
          >
            <X className="w-3 h-3 mr-1" /> Clear Filters
          </Button>
        )}
      </div>

      <Card data-testid="card-chargeback-list">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Chargeback Log
            <Badge variant="secondary">{chargebackList.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chargebackList.length === 0 ? (
            <div className="text-center py-12" data-testid="text-no-chargebacks">
              <ShieldAlert className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No chargebacks found</p>
              <p className="text-sm text-muted-foreground mt-1">Log your first chargeback using the button above</p>
            </div>
          ) : (
            <div className="space-y-2">
              {chargebackList.map(cb => {
                const overdue = isOverdue(cb);
                const days = daysUntilDeadline(cb);
                const statusConf = STATUS_CONFIG[cb.status] || STATUS_CONFIG["New"];
                return (
                  <div
                    key={cb.id}
                    className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors ${overdue ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20" : ""}`}
                    onClick={() => setSelectedCb(cb)}
                    data-testid={`row-chargeback-${cb.id}`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`mt-0.5 shrink-0 ${overdue ? "text-red-500" : "text-muted-foreground"}`}>
                        {overdue ? <AlertTriangle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" data-testid={`text-cb-amount-${cb.id}`}>
                            {formatCurrency(cb.amount)}
                          </span>
                          <Badge variant="outline" data-testid={`badge-cb-brand-${cb.id}`}>{cb.cardBrand}</Badge>
                          <Badge className={statusConf.className} variant={statusConf.variant} data-testid={`badge-cb-status-${cb.id}`}>
                            {statusConf.label}
                          </Badge>
                          {overdue && (
                            <Badge variant="destructive" data-testid={`badge-cb-overdue-${cb.id}`}>OVERDUE</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground" data-testid={`text-cb-reason-${cb.id}`}>{cb.reasonCode}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Tx: {formatDate(cb.transactionDate)}</span>
                          {cb.responseDeadline && (
                            <span className={overdue ? "text-red-500 font-medium" : days !== null && days <= 7 ? "text-amber-500 font-medium" : ""}>
                              Deadline: {formatDate(cb.responseDeadline)}
                              {!["Won", "Lost"].includes(cb.status) && days !== null && (
                                <span className="ml-1">({overdue ? `${Math.abs(days)}d overdue` : `${days}d left`})</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-create-chargeback">
          <DialogHeader>
            <DialogTitle>Log New Chargeback</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Contact ID (optional)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 42"
                  value={form.contactId}
                  onChange={e => setForm(p => ({ ...p, contactId: e.target.value }))}
                  data-testid="input-contact-id"
                />
              </div>
              <div className="space-y-1">
                <Label>Deal ID (optional)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 7"
                  value={form.dealId}
                  onChange={e => setForm(p => ({ ...p, dealId: e.target.value }))}
                  data-testid="input-deal-id"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Transaction Date *</Label>
                <Input
                  type="date"
                  value={form.transactionDate}
                  onChange={e => setForm(p => ({ ...p, transactionDate: e.target.value }))}
                  data-testid="input-transaction-date"
                />
              </div>
              <div className="space-y-1">
                <Label>Amount ($) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                  data-testid="input-amount"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Card Brand *</Label>
              <Select value={form.cardBrand} onValueChange={v => setForm(p => ({ ...p, cardBrand: v }))}>
                <SelectTrigger data-testid="select-card-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARGEBACK_CARD_BRANDS.map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Response deadline auto-set to <strong>{deadlineDays} days</strong> from transaction date ({form.cardBrand} standard)
              </p>
            </div>

            <div className="space-y-1">
              <Label>Reason Code *</Label>
              <Select value={form.reasonCode} onValueChange={v => setForm(p => ({ ...p, reasonCode: v }))}>
                <SelectTrigger data-testid="select-reason-code">
                  <SelectValue placeholder="Select reason code..." />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CODE_OPTIONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Reason Description (optional)</Label>
              <Input
                placeholder="Brief description of the dispute"
                value={form.reasonDescription}
                onChange={e => setForm(p => ({ ...p, reasonDescription: e.target.value }))}
                data-testid="input-reason-description"
              />
            </div>

            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Additional notes..."
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-form-notes"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => { setShowCreate(false); setForm(DEFAULT_FORM); }} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !form.transactionDate || !form.amount || !form.reasonCode}
                data-testid="button-submit-create"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Log Chargeback
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedCb} onOpenChange={open => !open && setSelectedCb(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="dialog-chargeback-detail">
          {selectedCb && (
            <ChargebackDetailPanel
              chargeback={selectedCb}
              onClose={() => setSelectedCb(null)}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/chargebacks"] });
                setSelectedCb(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
