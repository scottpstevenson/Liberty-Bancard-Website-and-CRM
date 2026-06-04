import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Users, Clock, DollarSign, RefreshCw, ExternalLink, CheckSquare, AlertCircle,
} from "lucide-react";

interface ColdLead {
  id: number;
  firstName: string;
  lastName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  leadSource?: string;
  utmSource?: string;
  referralSource?: string;
  assignedTo?: string;
  daysDormant: number;
  lastActivityDate: string;
  tags?: string[];
}

interface ColdLeadsResult {
  data: ColdLead[];
  total: number;
  avgDaysDormant: number;
  estimatedValue: number;
  page: number;
  pageSize: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getLeadSourceLabel(lead: ColdLead) {
  return lead.leadSource || lead.utmSource || lead.referralSource || "—";
}

export default function ColdLeads() {
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data, isLoading, refetch } = useQuery<ColdLeadsResult>({
    queryKey: ["/api/contacts/cold-leads", page],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/cold-leads?page=${page}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load cold leads");
      return res.json();
    },
  });

  const leads = data?.data ?? [];
  const total = data?.total ?? 0;
  const avgDaysDormant = data?.avgDaysDormant ?? 0;
  const estimatedValue = data?.estimatedValue ?? 0;
  const totalPages = Math.ceil(total / (data?.pageSize ?? 100));

  const reEngageMutation = useMutation({
    mutationFn: async (contactId: number) => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/re-engage`, {});
      return res.json();
    },
    onSuccess: (result, contactId) => {
      setEnrollingId(null);
      if (result.enrolled) {
        toast({ title: "Re-engagement queued", description: "Contact enrolled in GHL re-engagement sequence." });
      } else {
        toast({
          title: "Queued for direct outreach",
          description: result.reason || "Contact tagged and will be reached via direct sequence.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/cold-leads"] });
    },
    onError: (err: any) => {
      setEnrollingId(null);
      toast({ title: "Re-engage failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkReEngageMutation = useMutation({
    mutationFn: async (contactIds: number[]) => {
      const res = await apiRequest("POST", "/api/contacts/bulk-re-engage", { contactIds });
      return res.json();
    },
    onSuccess: (result) => {
      setSelectedIds(new Set());
      toast({
        title: "Bulk re-engagement complete",
        description: `Enrolled: ${result.enrolled}, Skipped: ${result.skipped}, Errors: ${result.errors}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/cold-leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Bulk re-engage failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const handleReEngage = (contactId: number) => {
    setEnrollingId(contactId);
    reEngageMutation.mutate(contactId);
  };

  const handleBulkReEngage = () => {
    if (selectedIds.size === 0) return;
    bulkReEngageMutation.mutate(Array.from(selectedIds));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cold Lead Re-engagement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contacts who submitted a form but went dormant with no active deal — your warmest untapped pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              onClick={handleBulkReEngage}
              disabled={bulkReEngageMutation.isPending}
              data-testid="button-bulk-re-engage"
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {bulkReEngageMutation.isPending
                ? "Re-engaging..."
                : `Re-engage ${selectedIds.size} Selected`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-cold-leads">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cold Leads</p>
              <p className="text-2xl font-bold" data-testid="text-cold-leads-total">
                {isLoading ? <Skeleton className="h-7 w-12" /> : total}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg Days Dormant</p>
              <p className="text-2xl font-bold" data-testid="text-avg-days-dormant">
                {isLoading ? <Skeleton className="h-7 w-12" /> : avgDaysDormant}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Est. Re-engage Value</p>
              <p className="text-2xl font-bold" data-testid="text-estimated-value">
                {isLoading ? <Skeleton className="h-7 w-24" /> : formatCurrency(estimatedValue)}
              </p>
              <p className="text-xs text-muted-foreground">at $15k avg deal × 10–20% conversion</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md flex-wrap" data-testid="bulk-re-engage-toolbar">
          <CheckSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium" data-testid="text-selected-count">
            {selectedIds.size} contact{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <Button size="sm" onClick={handleBulkReEngage} disabled={bulkReEngageMutation.isPending} data-testid="button-toolbar-bulk-re-engage">
            <RefreshCw className="w-4 h-4 mr-1" />
            {bulkReEngageMutation.isPending ? "Re-engaging..." : "Re-engage Selected"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
            Clear
          </Button>
        </div>
      )}

      <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm" data-testid="re-engage-info-banner">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <span className="text-amber-700 dark:text-amber-300">
          <strong>Manual review required.</strong> All re-engagement is human-initiated. Clicking "Re-engage" tags the contact as{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/40 px-1 rounded">COLD-NO-DEAL</code> and enrolls them in the{" "}
          <em>Reactivation — Cold Lead Revival</em> sequence in GHL.
        </span>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={leads.length > 0 && selectedIds.size === leads.length}
                    onCheckedChange={toggleSelectAll}
                    data-testid="checkbox-select-all-cold"
                  />
                </TableHead>
                <TableHead>Name / Business</TableHead>
                <TableHead>Lead Source</TableHead>
                <TableHead>Days Dormant</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="flex flex-col items-center justify-center py-14 text-center gap-3" data-testid="empty-cold-leads">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Users className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">No cold leads found</p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        Contacts with a form submission signal, no active deal, and 45+ days of inactivity will appear here.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                leads.map(lead => {
                  const alreadyTagged = (lead.tags || []).includes("COLD-NO-DEAL");
                  return (
                    <TableRow key={lead.id} data-testid={`cold-lead-row-${lead.id}`}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={() => toggleSelect(lead.id)}
                          data-testid={`checkbox-cold-lead-${lead.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm" data-testid={`text-cold-lead-name-${lead.id}`}>
                            {lead.firstName} {lead.lastName}
                          </p>
                          {lead.companyName && (
                            <p className="text-xs text-muted-foreground" data-testid={`text-cold-lead-company-${lead.id}`}>
                              {lead.companyName}
                            </p>
                          )}
                          {alreadyTagged && (
                            <Badge variant="secondary" className="text-xs mt-0.5" data-testid={`badge-cold-no-deal-${lead.id}`}>
                              COLD-NO-DEAL
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground" data-testid={`text-lead-source-${lead.id}`}>
                          {getLeadSourceLabel(lead)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-sm font-medium ${lead.daysDormant >= 120 ? "text-red-600 dark:text-red-400" : lead.daysDormant >= 90 ? "text-orange-600 dark:text-orange-400" : "text-yellow-600 dark:text-yellow-400"}`}
                          data-testid={`text-days-dormant-${lead.id}`}
                        >
                          {lead.daysDormant}d
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground" data-testid={`text-last-activity-${lead.id}`}>
                          {formatDate(lead.lastActivityDate)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground truncate max-w-[160px] block" data-testid={`text-email-${lead.id}`}>
                          {lead.email || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground" data-testid={`text-phone-${lead.id}`}>
                          {lead.phone || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground" data-testid={`text-assigned-rep-${lead.id}`}>
                          {lead.assignedTo || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => setLocation(`/dashboard/contacts/${lead.id}`)}
                            aria-label="View contact"
                            data-testid={`button-view-cold-lead-${lead.id}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleReEngage(lead.id)}
                            disabled={enrollingId === lead.id || reEngageMutation.isPending}
                            data-testid={`button-re-engage-${lead.id}`}
                          >
                            <RefreshCw className={`w-3 h-3 ${enrollingId === lead.id ? "animate-spin" : ""}`} />
                            {enrollingId === lead.id ? "..." : "Re-engage"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t" data-testid="cold-leads-pagination">
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages} — {total} total cold leads
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-cold-leads-prev">
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-cold-leads-next">
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
