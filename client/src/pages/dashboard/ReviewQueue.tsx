import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  ChevronRight,
  FileQuestion,
  BarChart2,
  CheckCheck,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ReviewQueueItem } from "@shared/schema";

interface ChecklistItem {
  key: string;
  label: string;
}

interface ReviewQueueMeta {
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  businessName?: string;
  source?: string;
  industry?: string;
  vertical?: string;
  monthlyVolume?: string;
  currentProcessor?: string;
  painPoints?: string | string[];
  recommendedProgram?: string;
  estimatedSavings?: string | number;
  utmSource?: string;
  utmCampaign?: string;
  subject?: string;
  category?: string;
  priority?: string;
  description?: string;
  offerPath?: string;
  goal?: string;
  promoCode?: string;
  contactId?: number;
  dealId?: number;
  ghlContactId?: string;
}

interface GhlWorkflow {
  id: string;
  name: string;
  isSet: boolean;
}

type StatusTab = "pending" | "approved" | "all";

function typeBadge(sourceType: string) {
  if (sourceType === "rfi") {
    return (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs" data-testid="badge-type-rfi">
        <FileQuestion className="w-3 h-3 mr-1" />
        RFI
      </Badge>
    );
  }
  return (
    <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs" data-testid="badge-type-quiz">
      <BarChart2 className="w-3 h-3 mr-1" />
      Quiz
    </Badge>
  );
}

function statusBadge(status: string) {
  if (status === "approved") {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Approved
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
      <Clock className="w-3 h-3 mr-1" />
      Pending
    </Badge>
  );
}

function getMetadata(item: ReviewQueueItem): ReviewQueueMeta {
  if (!item.metadata || typeof item.metadata !== "object" || Array.isArray(item.metadata)) return {};
  return item.metadata as ReviewQueueMeta;
}

function getChecklistState(item: ReviewQueueItem): Record<string, boolean> {
  if (!item.checklistState || typeof item.checklistState !== "object" || Array.isArray(item.checklistState)) return {};
  return item.checklistState as Record<string, boolean>;
}

function getContactName(meta: ReviewQueueMeta): string {
  if (meta.contactName) return meta.contactName;
  const first = meta.firstName ?? "";
  const last = meta.lastName ?? "";
  return `${first} ${last}`.trim() || "—";
}

function getCheckedCount(state: Record<string, boolean>, checklist: ChecklistItem[]): number {
  return checklist.filter((ci) => state[ci.key] === true).length;
}

function MetaDisplay({ meta }: { meta: ReviewQueueMeta }) {
  const rows: Array<[string, string]> = (
    [
      ["Contact Name", getContactName(meta)],
      ["Email", meta.email],
      ["Phone", meta.phone],
      ["Company", meta.companyName ?? meta.businessName],
      ["Source", meta.source],
      ["Industry / Vertical", meta.industry ?? meta.vertical],
      ["Monthly Volume", meta.monthlyVolume],
      ["Current Processor", meta.currentProcessor],
      ["Pain Points", Array.isArray(meta.painPoints) ? meta.painPoints.join(", ") : meta.painPoints],
      ["Recommended Program", meta.recommendedProgram],
      ["Est. Annual Savings", meta.estimatedSavings != null ? `$${Number(meta.estimatedSavings).toLocaleString()}` : undefined],
      ["UTM Source", meta.utmSource],
      ["UTM Campaign", meta.utmCampaign],
      ["RFI Subject", meta.subject],
      ["RFI Category", meta.category],
      ["RFI Priority", meta.priority],
      ["RFI Description", meta.description],
      ["Goal / Offer Path", meta.offerPath ?? meta.goal],
      ["Promo Code", meta.promoCode],
    ] as Array<[string, string | undefined]>
  ).filter((row): row is [string, string] => !!row[1] && row[1] !== "—");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No details available.</p>;
  }

  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="w-40 shrink-0 font-medium text-muted-foreground">{label}</dt>
          <dd className="flex-1 text-foreground break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ReviewQueue() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<StatusTab>("pending");
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedGhlWorkflow, setSelectedGhlWorkflow] = useState<string>("_none");

  const { data: checklistItems = [], isLoading: checklistLoading } = useQuery<ChecklistItem[]>({
    queryKey: ["/api/review-queue/checklist-items"],
    staleTime: Infinity,
  });

  const { data: aggregates } = useQuery<{ count: number; pending: number; approved: number; total: number }>({
    queryKey: ["/api/review-queue/pending-count"],
    refetchInterval: 60000,
  });

  const { data: items = [], isLoading } = useQuery<ReviewQueueItem[]>({
    queryKey: ["/api/review-queue", activeTab],
    queryFn: async () => {
      const url = activeTab === "all" ? "/api/review-queue" : `/api/review-queue?status=${activeTab}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: ghlWorkflows = [] } = useQuery<GhlWorkflow[]>({
    queryKey: ["/api/integrations/ghl-workflow-registry"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/ghl-workflow-registry", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: selectedItemFresh } = useQuery<ReviewQueueItem>({
    queryKey: ["/api/review-queue", selectedItem?.id],
    queryFn: async () => {
      const res = await fetch(`/api/review-queue/${selectedItem!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load item");
      return res.json();
    },
    enabled: !!selectedItem,
    refetchInterval: false,
  });

  const displayItem = selectedItemFresh ?? selectedItem;
  const checklistState = displayItem ? getChecklistState(displayItem) : {};
  const totalCount = checklistItems.length;
  const checkedCount = getCheckedCount(checklistState, checklistItems);
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  const checklistMutation = useMutation({
    mutationFn: async ({ id, state }: { id: number; state: Record<string, boolean> }) => {
      const res = await apiRequest("PATCH", `/api/review-queue/${id}/checklist`, { checklistState: state });
      return res.json() as Promise<ReviewQueueItem>;
    },
    onSuccess: (data) => {
      setSelectedItem(data);
      queryClient.invalidateQueries({ queryKey: ["/api/review-queue", selectedItem?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/review-queue", activeTab] });
      queryClient.invalidateQueries({ queryKey: ["/api/review-queue/pending-count"] });
    },
    onError: () => toast({ title: "Failed to save checklist", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, ghlWorkflowId }: { id: number; ghlWorkflowId?: string }) => {
      const res = await apiRequest("POST", `/api/review-queue/${id}/approve`, {
        ghlWorkflowId: ghlWorkflowId || undefined,
      });
      return res.json() as Promise<ReviewQueueItem>;
    },
    onSuccess: () => {
      toast({ title: "Item approved successfully" });
      setApproveDialogOpen(false);
      setSelectedItem(null);
      queryClient.invalidateQueries({ queryKey: ["/api/review-queue", activeTab] });
      queryClient.invalidateQueries({ queryKey: ["/api/review-queue/pending-count"] });
    },
    onError: (err: Error) => toast({ title: err?.message || "Approval failed", variant: "destructive" }),
  });

  function handleChecklistToggle(key: string, checked: boolean) {
    if (!displayItem) return;
    const newState = { ...checklistState, [key]: checked };
    checklistMutation.mutate({ id: displayItem.id, state: newState });
  }

  function handleApprove() {
    if (!displayItem) return;
    approveMutation.mutate({
      id: displayItem.id,
      ghlWorkflowId: selectedGhlWorkflow !== "_none" ? selectedGhlWorkflow : undefined,
    });
  }

  const displayLoading = isLoading || checklistLoading;

  return (
    <div className="space-y-6" data-testid="page-review-queue">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-review-queue-title">Review Queue</h2>
          <p className="text-sm text-muted-foreground">Review RFI and quiz submissions before approval</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-pending-count">
                {aggregates == null ? "—" : aggregates.pending}
              </div>
              <div className="text-xs text-muted-foreground">Pending (all time)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-approved-count">
                {aggregates == null ? "—" : aggregates.approved}
              </div>
              <div className="text-xs text-muted-foreground">Approved (all time)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-count">
                {aggregates == null ? "—" : aggregates.total}
              </div>
              <div className="text-xs text-muted-foreground">Total (all time)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StatusTab)}>
          <TabsList data-testid="tabs-status-filter">
            <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {displayLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCheck className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2">No Items</h3>
            <p className="text-sm text-muted-foreground">
              {activeTab === "pending"
                ? "No pending items in the queue. All caught up!"
                : activeTab === "approved"
                ? "No approved items yet."
                : "No items in the queue yet. RFI and quiz submissions will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ScrollArea className="max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const meta = getMetadata(item);
                  const state = getChecklistState(item);
                  const checked = getCheckedCount(state, checklistItems);
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedItem(item)}
                      data-testid={`row-queue-item-${item.id}`}
                    >
                      <TableCell>{typeBadge(item.sourceType)}</TableCell>
                      <TableCell className="font-medium" data-testid={`text-contact-name-${item.id}`}>
                        {getContactName(meta)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{meta.email ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground capitalize">{meta.source ?? item.sourceType}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <Progress value={totalCount > 0 ? (checked / totalCount) * 100 : 0} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-progress-${item.id}`}>
                            {checked}/{totalCount}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(item.status)}</TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {selectedItem && displayItem && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/40"
            onClick={() => setSelectedItem(null)}
            data-testid="overlay-detail-panel"
          />
          <div className="w-full max-w-xl bg-background border-l shadow-xl flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                {typeBadge(displayItem.sourceType)}
                <h3 className="font-semibold text-base" data-testid="text-panel-title">
                  {displayItem.sourceType === "rfi"
                    ? (getMetadata(displayItem).subject ?? "RFI Review")
                    : `Quiz Lead — ${getContactName(getMetadata(displayItem))}`}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                aria-label="Close detail panel"
                data-testid="button-close-panel"
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-6 py-4 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold">Submission Details</h4>
                    {statusBadge(displayItem.status)}
                  </div>
                  <MetaDisplay meta={getMetadata(displayItem)} />
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">Review Checklist</h4>
                    <span className="text-xs text-muted-foreground" data-testid="text-checklist-progress">
                      {checkedCount}/{totalCount} completed
                    </span>
                  </div>
                  <Progress
                    value={totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}
                    className="h-2 mb-4"
                    data-testid="progress-checklist"
                  />
                  <div className="space-y-3">
                    {checklistItems.map((ci) => {
                      const isChecked = checklistState[ci.key] === true;
                      const isApproved = displayItem.status === "approved";
                      return (
                        <div key={ci.key} className="flex items-center gap-3">
                          <Checkbox
                            id={`check-${ci.key}`}
                            checked={isChecked}
                            disabled={isApproved || checklistMutation.isPending}
                            onCheckedChange={(val) => handleChecklistToggle(ci.key, val === true)}
                            data-testid={`checkbox-${ci.key}`}
                          />
                          <Label
                            htmlFor={`check-${ci.key}`}
                            className={`text-sm cursor-pointer ${isChecked ? "line-through text-muted-foreground" : ""}`}
                          >
                            {ci.label}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {displayItem.status === "approved" && (
                  <div className="rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3 text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Approved{displayItem.approvedAt ? ` on ${new Date(displayItem.approvedAt).toLocaleDateString()}` : ""}
                      {displayItem.ghlWorkflowId ? " — GHL workflow triggered" : ""}
                    </span>
                  </div>
                )}
              </div>
            </ScrollArea>

            {displayItem.status !== "approved" && (
              <div className="px-6 py-4 border-t">
                <Button
                  className="w-full"
                  disabled={!allChecked || approveMutation.isPending}
                  onClick={() => setApproveDialogOpen(true)}
                  data-testid="button-approve"
                >
                  {!allChecked
                    ? `Complete checklist (${checkedCount}/${totalCount}) to approve`
                    : "Approve Item"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              All checklist items are complete. Optionally trigger a GHL workflow before approving.
            </p>
            <div className="space-y-2">
              <Label>GHL Workflow (optional)</Label>
              <Select value={selectedGhlWorkflow} onValueChange={setSelectedGhlWorkflow}>
                <SelectTrigger data-testid="select-ghl-workflow">
                  <SelectValue placeholder="Skip — no workflow" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Skip — no workflow</SelectItem>
                  {ghlWorkflows.filter((w) => w.isSet).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ghlWorkflows.filter((w) => w.isSet).length === 0 && (
                <p className="text-xs text-muted-foreground">No GHL workflows configured. Configure them in GHL Workflow IDs.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)} data-testid="button-cancel-approve">
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              data-testid="button-confirm-approve"
            >
              {approveMutation.isPending ? "Approving..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
