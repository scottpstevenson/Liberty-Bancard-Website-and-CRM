import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Calendar, Sparkles, Loader2, Download, ChevronDown, Archive, Settings, ArrowUp, ArrowDown, Pencil, Trash2, RotateCcw, MoreVertical, TrendingUp, TrendingDown, UserRound, AlertTriangle, Activity, ArrowUpDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { exportToCSV } from "@/lib/export-csv";
import type { Deal, Contact, PipelineStage, Agent, AgentMerchant } from "@shared/schema";
import { SALES_STAGES, OFFER_PATHS } from "@shared/schema";
import Comments from "@/components/Comments";
import SavedFilterBar from "@/components/SavedFilterBar";
import DashboardErrorState from "@/components/DashboardErrorState";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STAGE_COLORS: Record<string, string> = {
  "New Lead": "bg-blue-500",
  "Statement Received": "bg-indigo-500",
  "Review In Progress": "bg-violet-500",
  "Call Booked": "bg-cyan-500",
  "Proposal Sent": "bg-amber-500",
  "Negotiation / Follow-Up": "bg-orange-500",
  "Nurture / Not Now": "bg-slate-500",
  "Closed Won": "bg-green-600",
  "Closed Lost": "bg-red-500",
};

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b",
  "#f97316", "#64748b", "#16a34a", "#ef4444", "#ec4899",
  "#14b8a6", "#84cc16",
];

interface MidSummary {
  dealId: number;
  mid: string;
  totalVolume: number;
  txCount: number;
  chargebackCount: number;
  trendPct: number;
  sparkline: number[];
  latestDate: string | null;
  fetchedAt: string | null;
}

function fmtCompactCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
}

function VolumeSparkline({ values }: { values: number[] }) {
  if (!values || values.length < 2) return null;
  const w = 80;
  const h = 20;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary" data-testid="svg-deal-sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function DealMidBadge({ summary }: { summary: MidSummary | undefined }) {
  if (!summary) return null;
  const hasData = summary.sparkline.length > 0 && summary.totalVolume > 0;
  if (!hasData) {
    return (
      <Badge
        variant="outline"
        className="text-xs no-default-hover-elevate no-default-active-elevate"
        data-testid={`badge-no-volume-${summary.dealId}`}
        title={`MID ${summary.mid} — no recent processing activity`}
      >
        <Activity className="w-3 h-3 mr-1 opacity-60" /> No activity
      </Badge>
    );
  }
  const trendUp = summary.trendPct >= 0;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5" data-testid={`mid-summary-${summary.dealId}`}>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold tabular-nums" data-testid={`text-deal-volume-${summary.dealId}`}>
            30d: {fmtCompactCurrency(summary.totalVolume)}
          </span>
          {summary.chargebackCount > 0 && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] border-red-300 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate"
              data-testid={`badge-chargebacks-${summary.dealId}`}
              title={`${summary.chargebackCount} chargeback${summary.chargebackCount === 1 ? "" : "s"} in last 30 days`}
            >
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
              {summary.chargebackCount} CB
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5 text-[10px]">
          {trendUp ? (
            <TrendingUp className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
          ) : (
            <TrendingDown className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
          )}
          <span
            className={trendUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
            data-testid={`text-deal-trend-${summary.dealId}`}
          >
            {trendUp ? "+" : ""}{summary.trendPct.toFixed(0)}%
          </span>
        </div>
      </div>
      <VolumeSparkline values={summary.sparkline} />
    </div>
  );
}

function SortableDealCard({
  deal,
  isDealArchived,
  selectedDealIds,
  toggleDealSelection,
  openDealDetail,
  archiveDealMutation,
  restoreDealMutation,
  getContactName,
  getCompanyName,
  midSummary,
}: {
  deal: Deal;
  isDealArchived: boolean;
  selectedDealIds: Set<number>;
  toggleDealSelection: (id: number) => void;
  openDealDetail: (deal: Deal) => void;
  archiveDealMutation: any;
  restoreDealMutation: any;
  getContactName: (id: number | null) => string;
  getCompanyName: (id: number | null) => string;
  midSummary?: MidSummary;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stage: deal.stage },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card
        className={`cursor-pointer hover-elevate ${isDealArchived ? "opacity-50" : ""}`}
        onClick={() => openDealDetail(deal)}
        data-testid={`card-deal-${deal.id}`}
      >
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Checkbox
              checked={selectedDealIds.has(deal.id)}
              onCheckedChange={() => toggleDealSelection(deal.id)}
              onClick={(e) => e.stopPropagation()}
              data-testid={`checkbox-deal-${deal.id}`}
            />
            <div
              {...listeners}
              className="flex-1 cursor-grab active:cursor-grabbing touch-none"
              onClick={(e) => e.stopPropagation()}
              title="Drag to move"
            >
              <div className={`font-medium text-sm ${isDealArchived ? "line-through" : ""}`} data-testid={`text-deal-contact-${deal.id}`}>
                {getContactName(deal.contactId)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="Deal actions" onClick={(e) => e.stopPropagation()} data-testid={`button-deal-actions-${deal.id}`}>
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isDealArchived ? (
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); restoreDealMutation.mutate(deal.id); }}
                    data-testid={`menu-restore-deal-${deal.id}`}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" /> Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); archiveDealMutation.mutate(deal.id); }}
                    data-testid={`menu-archive-deal-${deal.id}`}
                  >
                    <Archive className="w-4 h-4 mr-2" /> Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isDealArchived && (
            <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-archived-deal-${deal.id}`}>
              <Archive className="w-3 h-3 mr-1" /> Archived
            </Badge>
          )}
          {getCompanyName(deal.contactId) && (
            <div className="text-xs text-muted-foreground" data-testid={`text-deal-company-${deal.id}`}>
              {getCompanyName(deal.contactId)}
            </div>
          )}
          {deal.offerPath && (
            <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-offer-${deal.id}`}>
              {deal.offerPath}
            </Badge>
          )}
          {deal.mid && <DealMidBadge summary={midSummary} />}
          <div className="text-xs text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
            <Calendar className="w-3 h-3 inline-block mr-1" />
            {deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : "N/A"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DroppableColumn({
  stage,
  colorClass,
  stageDeals,
  selectedDealIds,
  toggleDealSelection,
  openDealDetail,
  archiveDealMutation,
  restoreDealMutation,
  getContactName,
  getCompanyName,
  setCreateOpen,
  midSummaries,
}: {
  stage: string;
  colorClass: string;
  stageDeals: Deal[];
  selectedDealIds: Set<number>;
  toggleDealSelection: (id: number) => void;
  openDealDetail: (deal: Deal) => void;
  archiveDealMutation: any;
  restoreDealMutation: any;
  getContactName: (id: number | null) => string;
  getCompanyName: (id: number | null) => string;
  setCreateOpen: (open: boolean) => void;
  midSummaries: Record<string, MidSummary>;
}) {
  return (
    <div className="w-[270px] flex-shrink-0" data-testid={`stage-column-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className={`${colorClass} text-white px-3 py-2 rounded-md mb-3 flex items-center justify-between gap-2`}>
        <span className="text-sm font-semibold truncate">{stage}</span>
        <Badge variant="secondary" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-count-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
          {stageDeals.length}
        </Badge>
      </div>
      <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3 min-h-[200px]" data-droppable-stage={stage}>
          {stageDeals.map((deal) => {
            const isDealArchived = !!(deal as any).archivedAt;
            return (
              <SortableDealCard
                key={deal.id}
                deal={deal}
                isDealArchived={isDealArchived}
                selectedDealIds={selectedDealIds}
                toggleDealSelection={toggleDealSelection}
                openDealDetail={openDealDetail}
                archiveDealMutation={archiveDealMutation}
                restoreDealMutation={restoreDealMutation}
                getContactName={getContactName}
                getCompanyName={getCompanyName}
                midSummary={midSummaries[String(deal.id)]}
              />
            );
          })}
          {stageDeals.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-8 gap-2" data-testid={`empty-state-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
              <TrendingUp className="w-6 h-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No deals in this stage</p>
              <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setCreateOpen(true)} data-testid={`button-add-deal-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
                <Plus className="w-3 h-3 mr-1" />
                Add Deal
              </Button>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function Pipeline() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManagerOrAdmin = user?.role === "admin" || user?.role === "manager";
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const search = useSearch();
  const dealIdParam = (() => {
    const v = new URLSearchParams(search).get("id");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  })();
  const [configOpen, setConfigOpen] = useState(false);
  const [configPipeline, setConfigPipeline] = useState("sales");
  const [addStageName, setAddStageName] = useState("");
  const [addStageColor, setAddStageColor] = useState("#6366f1");
  const [editingStage, setEditingStage] = useState<PipelineStage | null>(null);
  const [editStageName, setEditStageName] = useState("");
  const [editStageColor, setEditStageColor] = useState("");
  const [deleteConfirmStage, setDeleteConfirmStage] = useState<PipelineStage | null>(null);

  const [newDeal, setNewDeal] = useState({
    contactId: "",
    pipeline: "sales",
    stage: "New Lead",
    offerPath: "",
    notes: "",
  });

  const [selectedDealIds, setSelectedDealIds] = useState<Set<number>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [sortMode, setSortMode] = useState<"default" | "volume_desc" | "trending_down" | "no_activity">("default");

  const [editStage, setEditStage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFollowUp, setEditFollowUp] = useState("");
  const [editAgentId, setEditAgentId] = useState<string>("none");
  const [editMid, setEditMid] = useState("");

  const { data: dealsResult, isLoading: dealsLoading, isError: dealsError, refetch: refetchDeals } = useQuery<{ data: Deal[]; total: number }>({
    queryKey: ["/api/deals", { pipeline: "sales" }],
    queryFn: async () => {
      const res = await fetch("/api/deals?pipeline=sales&limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
  });
  const deals = dealsResult?.data;

  const { data: contactsResult } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts?limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });
  const contacts = contactsResult?.data;

  const { data: midSummaryData } = useQuery<{ summaries: Record<string, MidSummary>; days: number }>({
    queryKey: ["/api/mid-stats/pipeline-summary"],
    queryFn: async () => {
      const res = await fetch("/api/mid-stats/pipeline-summary?days=30", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch MID summaries");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const midSummaries = midSummaryData?.summaries || {};

  const { data: pipelineStages } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline-stages", configPipeline],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-stages?pipeline=${configPipeline}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch pipeline stages");
      return res.json();
    },
  });

  const { data: agentsList } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isManagerOrAdmin,
  });

  const { data: dealAssignment, refetch: refetchDealAssignment } = useQuery<AgentMerchant | null>({
    queryKey: ["/api/agent-merchants/deal", selectedDeal?.id],
    queryFn: async () => {
      if (!selectedDeal) return null;
      const res = await fetch(`/api/agent-merchants/deal/${selectedDeal.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isManagerOrAdmin && !!selectedDeal,
  });

  const assignAgentMutation = useMutation({
    mutationFn: async ({ dealId, agentId }: { dealId: number; agentId: number | null }) => {
      const res = await apiRequest("PUT", `/api/agent-merchants/deal/${dealId}/assign`, { agentId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-merchants/deal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      toast({ title: "Agent assignment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update agent assignment", description: err.message, variant: "destructive" });
    },
  });

  const createStageMutation = useMutation({
    mutationFn: async (data: { pipeline: string; stageName: string; color: string; sortOrder: number }) => {
      const res = await apiRequest("POST", "/api/pipeline-stages", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline-stages"] });
      setAddStageName("");
      setAddStageColor("#6366f1");
      toast({ title: "Stage created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create stage", description: err.message, variant: "destructive" });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; stageName?: string; color?: string }) => {
      const res = await apiRequest("PUT", `/api/pipeline-stages/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline-stages"] });
      setEditingStage(null);
      toast({ title: "Stage updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update stage", description: err.message, variant: "destructive" });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/pipeline-stages/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline-stages"] });
      setDeleteConfirmStage(null);
      toast({ title: "Stage deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete stage", description: err.message, variant: "destructive" });
    },
  });

  const reorderStagesMutation = useMutation({
    mutationFn: async (stages: { id: number; sortOrder: number }[]) => {
      const res = await apiRequest("POST", "/api/pipeline-stages/reorder", { stages });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline-stages"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reorder stages", description: err.message, variant: "destructive" });
    },
  });

  const archiveDealMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/deals/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Deal archived" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to archive deal", description: err.message, variant: "destructive" });
    },
  });

  const restoreDealMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/deals/${id}/restore`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Deal restored" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to restore deal", description: err.message, variant: "destructive" });
    },
  });

  const sortedStages = (pipelineStages || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  const handleDragStart = (event: DragStartEvent) => {
    const deal = deals?.find((d) => d.id === event.active.id);
    setActiveDeal(deal || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;

    const activeDealId = active.id as number;
    const overStage = (over.data.current as any)?.stage || (over.data.current as any)?.sortable?.containerId;

    let newStage: string | null = null;

    if (typeof over.id === "string" && SALES_STAGES.includes(over.id)) {
      newStage = over.id;
    } else {
      const overDeal = deals?.find((d) => d.id === over.id);
      if (overDeal) {
        newStage = overDeal.stage;
      } else if (overStage && SALES_STAGES.includes(overStage)) {
        newStage = overStage;
      }
    }

    if (!newStage) return;

    const activeDealObj = deals?.find((d) => d.id === activeDealId);
    if (!activeDealObj || activeDealObj.stage === newStage) return;

    queryClient.setQueryData(["/api/deals", { pipeline: "sales" }], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((d: Deal) =>
          d.id === activeDealId ? { ...d, stage: newStage } : d
        ),
      };
    });

    updateDealMutation.mutate({ id: activeDealId, stage: newStage });
  };

  const getDealsInStage = (stageName: string) => {
    return (deals || []).filter((d) => d.stage === stageName).length;
  };

  const handleAddStage = () => {
    if (!addStageName.trim()) return;
    const maxOrder = sortedStages.length > 0 ? Math.max(...sortedStages.map((s) => s.sortOrder)) : -1;
    createStageMutation.mutate({
      pipeline: configPipeline,
      stageName: addStageName.trim(),
      color: addStageColor,
      sortOrder: maxOrder + 1,
    });
  };

  const handleMoveStage = (stage: PipelineStage, direction: "up" | "down") => {
    const idx = sortedStages.findIndex((s) => s.id === stage.id);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= sortedStages.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const reordered = sortedStages.map((s, i) => {
      if (i === idx) return { id: s.id, sortOrder: swapIdx };
      if (i === swapIdx) return { id: s.id, sortOrder: idx };
      return { id: s.id, sortOrder: i };
    });
    reorderStagesMutation.mutate(reordered);
  };

  const handleSaveEditStage = () => {
    if (!editingStage || !editStageName.trim()) return;
    updateStageMutation.mutate({
      id: editingStage.id,
      stageName: editStageName.trim(),
      color: editStageColor,
    });
  };

  const createDealMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/deals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setCreateOpen(false);
      setNewDeal({ contactId: "", pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });
      toast({ title: "Deal created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create deal", description: err.message, variant: "destructive" });
    },
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setDetailOpen(false);
      setSelectedDeal(null);
      toast({ title: "Deal updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update deal", description: err.message, variant: "destructive" });
    },
  });

  const autoProgressMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/auto-progress-deals");
      return res.json();
    },
    onSuccess: (data: { progressed: number; progressions: Array<{ dealId: number; from: string; to: string; reason: string }> }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      if (data.progressed === 0) {
        toast({ title: "No deals to advance", description: "All deals are at the correct stage based on their data." });
      } else {
        toast({ title: `AI advanced ${data.progressed} deal${data.progressed > 1 ? "s" : ""}`, description: data.progressions.map(p => `Deal #${p.dealId}: ${p.from} → ${p.to}`).join(", ") });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Auto-progression failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkStageMutation = useMutation({
    mutationFn: async ({ dealIds, stage }: { dealIds: number[]; stage: string }) => {
      const res = await apiRequest("POST", "/api/deals/bulk-stage", { dealIds, stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedDealIds(new Set());
      toast({ title: "Deals moved successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to move deals", description: err.message, variant: "destructive" });
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (dealIds: number[]) => {
      const results = await Promise.all(
        dealIds.map((id) => apiRequest("POST", `/api/deals/${id}/archive`))
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedDealIds(new Set());
      toast({ title: "Deals archived successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to archive deals", description: err.message, variant: "destructive" });
    },
  });

  const toggleDealSelection = (dealId: number) => {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  };

  const toggleAllDeals = () => {
    if (!deals) return;
    if (selectedDealIds.size === deals.length) {
      setSelectedDealIds(new Set());
    } else {
      setSelectedDealIds(new Set(deals.map((d) => d.id)));
    }
  };

  const contactsMap = new Map<number, Contact>();
  contacts?.forEach((c) => contactsMap.set(c.id, c));

  const getContactName = (contactId: number | null) => {
    if (!contactId) return "No contact";
    const contact = contactsMap.get(contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : `Contact #${contactId}`;
  };

  const getCompanyName = (contactId: number | null) => {
    if (!contactId) return "";
    const contact = contactsMap.get(contactId);
    return contact?.companyName || "";
  };

  const handleCreateDeal = () => {
    const payload: Record<string, unknown> = {
      pipeline: newDeal.pipeline,
      stage: newDeal.stage,
      notes: newDeal.notes || undefined,
      offerPath: newDeal.offerPath || undefined,
    };
    if (newDeal.contactId) {
      payload.contactId = Number(newDeal.contactId);
    }
    createDealMutation.mutate(payload);
  };

  const handleUpdateDeal = () => {
    if (!selectedDeal) return;
    const updates: Record<string, unknown> = {};
    if (editStage && editStage !== selectedDeal.stage) updates.stage = editStage;
    if (editNotes !== (selectedDeal.notes || "")) updates.notes = editNotes;
    if (editFollowUp) updates.nextFollowUp = new Date(editFollowUp).toISOString();
    if (editMid !== (selectedDeal.mid || "")) updates.mid = editMid.trim() || null;
    if (Object.keys(updates).length === 0) {
      setDetailOpen(false);
      return;
    }
    updateDealMutation.mutate({ id: selectedDeal.id, ...updates });
  };

  const openDealDetail = (deal: Deal) => {
    setSelectedDeal(deal);
    setEditStage(deal.stage);
    setEditNotes(deal.notes || "");
    setEditFollowUp(deal.nextFollowUp ? new Date(deal.nextFollowUp).toISOString().slice(0, 16) : "");
    setEditAgentId("none");
    setEditMid(deal.mid || "");
    setDetailOpen(true);
  };

  useEffect(() => {
    if (dealIdParam == null || !deals) return;
    const deal = deals.find((d) => d.id === dealIdParam);
    if (deal && (!detailOpen || selectedDeal?.id !== dealIdParam)) {
      openDealDetail(deal);
    }
  }, [dealIdParam, deals]);

  const getDealsByStage = (stage: string) => {
    const filtered = (deals || []).filter((d) => {
      if (d.stage !== stage) return false;
      const isArchived = !!(d as any).archivedAt;
      if (!showArchived && isArchived) return false;
      if (sortMode === "trending_down") {
        const s = midSummaries[String(d.id)];
        if (!s || s.totalVolume <= 0 || s.trendPct >= 0) return false;
      } else if (sortMode === "no_activity") {
        if (!d.mid) return false;
        const s = midSummaries[String(d.id)];
        if (s && s.totalVolume > 0) return false;
      }
      return true;
    });

    if (sortMode === "volume_desc") {
      filtered.sort((a, b) => {
        const av = midSummaries[String(a.id)]?.totalVolume || 0;
        const bv = midSummaries[String(b.id)]?.totalVolume || 0;
        return bv - av;
      });
    } else if (sortMode === "trending_down") {
      filtered.sort((a, b) => {
        const at = midSummaries[String(a.id)]?.trendPct ?? 0;
        const bt = midSummaries[String(b.id)]?.trendPct ?? 0;
        return at - bt;
      });
    }
    return filtered;
  };

  if (dealsLoading) {
    return (
      <div className="space-y-6" data-testid="pipeline-loading">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, colIdx) => (
            <div key={colIdx} className="flex-shrink-0 w-72 space-y-3">
              <Skeleton className="h-6 w-32" />
              {Array.from({ length: 3 }).map((_, cardIdx) => (
                <div key={cardIdx} className="border rounded-md p-3 space-y-2 bg-muted/20">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (dealsError) {
    return <DashboardErrorState title="Failed to load pipeline" onRetry={() => refetchDeals()} />;
  }

  return (
    <div className="space-y-6" data-testid="pipeline-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold" data-testid="text-pipeline-title">Sales Pipeline</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2" data-testid="toggle-show-archived-deals">
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              data-testid="switch-show-archived-deals"
            />
            <Label className="text-sm cursor-pointer" onClick={() => setShowArchived(!showArchived)}>
              Show Archived
            </Label>
          </div>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as any)}>
            <SelectTrigger className="h-9 w-[180px]" data-testid="select-pipeline-sort">
              <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              <SelectValue placeholder="Sort / Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" data-testid="sort-default">Default order</SelectItem>
              <SelectItem value="volume_desc" data-testid="sort-volume-desc">Highest 30d volume</SelectItem>
              <SelectItem value="trending_down" data-testid="sort-trending-down">Trending down only</SelectItem>
              <SelectItem value="no_activity" data-testid="sort-no-activity">No activity (MID idle)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const exportData = (deals || []).map(d => ({
                contact: getContactName(d.contactId),
                company: getCompanyName(d.contactId),
                pipeline: d.pipeline,
                stage: d.stage,
                priorityScore: d.priorityScore,
                estVolume: d.totalVolume || "",
                estProfit: d.estimatedGrossProfitMonthly || "",
                followUp: d.nextFollowUp ? new Date(d.nextFollowUp).toLocaleDateString() : "",
                createdAt: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "",
              }));
              exportToCSV(exportData, "deals", [
                { key: "contact", label: "Contact" },
                { key: "company", label: "Company" },
                { key: "pipeline", label: "Pipeline" },
                { key: "stage", label: "Stage" },
                { key: "priorityScore", label: "Priority Score" },
                { key: "estVolume", label: "Est. Volume" },
                { key: "estProfit", label: "Est. Profit" },
                { key: "followUp", label: "Follow-up" },
                { key: "createdAt", label: "Created At" },
              ]);
            }}
            data-testid="button-export-deals"
          >
            <Download className="w-4 h-4 mr-1" /> Export Deals
          </Button>
          <Button
            variant="outline"
            data-testid="button-ai-auto-progress"
            className="gap-2"
            onClick={() => autoProgressMutation.mutate()}
            disabled={autoProgressMutation.isPending}
          >
            {autoProgressMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Auto-Progress
          </Button>
          <Button
            variant="outline"
            data-testid="button-configure-stages"
            className="gap-2"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="w-4 h-4" />
            Configure Stages
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-deal" className="gap-2">
                <Plus className="w-4 h-4" />
                New Deal
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-deal">
            <DialogHeader>
              <DialogTitle>Create New Deal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select value={newDeal.contactId} onValueChange={(v) => setNewDeal({ ...newDeal, contactId: v })}>
                  <SelectTrigger data-testid="select-contact">
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`select-contact-${c.id}`}>
                        {c.firstName} {c.lastName} {c.companyName ? `- ${c.companyName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Input value={newDeal.pipeline} disabled data-testid="input-pipeline" />
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={newDeal.stage} onValueChange={(v) => setNewDeal({ ...newDeal, stage: v })}>
                  <SelectTrigger data-testid="select-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALES_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Offer Path</Label>
                <Select value={newDeal.offerPath} onValueChange={(v) => setNewDeal({ ...newDeal, offerPath: v })}>
                  <SelectTrigger data-testid="select-offer-path">
                    <SelectValue placeholder="Select offer path" />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFER_PATHS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={newDeal.notes}
                  onChange={(e) => setNewDeal({ ...newDeal, notes: e.target.value })}
                  placeholder="Deal notes..."
                  data-testid="input-notes"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
                  Cancel
                </Button>
                <Button onClick={handleCreateDeal} disabled={createDealMutation.isPending} data-testid="button-submit-deal">
                  {createDealMutation.isPending ? "Creating..." : "Create Deal"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {selectedDealIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap" data-testid="pipeline-bulk-bar">
          <span className="text-sm text-muted-foreground" data-testid="text-selected-count">
            {selectedDealIds.size} deal{selectedDealIds.size > 1 ? "s" : ""} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-bulk-actions">
                Bulk Actions
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="button-bulk-move-stage">
                  Move to Stage
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {SALES_STAGES.map((stage) => (
                    <DropdownMenuItem
                      key={stage}
                      data-testid={`button-bulk-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}
                      onClick={() => bulkStageMutation.mutate({ dealIds: Array.from(selectedDealIds), stage })}
                    >
                      {stage}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                data-testid="button-bulk-archive"
                onClick={() => bulkArchiveMutation.mutate(Array.from(selectedDealIds))}
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive Selected
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDealIds(new Set())}
            data-testid="button-clear-selection"
          >
            Clear Selection
          </Button>
        </div>
      )}

      <SavedFilterBar
        entityType="deal"
        currentFilters={{ showArchived: String(showArchived) }}
        onApplyFilter={(filters) => {
          setShowArchived(filters.showArchived === "true");
        }}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="w-full" data-testid="pipeline-board">
          <div className="flex gap-4 pb-4" style={{ minWidth: `${SALES_STAGES.length * 280}px` }}>
            {SALES_STAGES.map((stage) => {
              const stageDeals = getDealsByStage(stage);
              const colorClass = STAGE_COLORS[stage] || "bg-gray-500";
              return (
                <DroppableColumn
                  key={stage}
                  stage={stage}
                  colorClass={colorClass}
                  stageDeals={stageDeals}
                  selectedDealIds={selectedDealIds}
                  toggleDealSelection={toggleDealSelection}
                  openDealDetail={openDealDetail}
                  archiveDealMutation={archiveDealMutation}
                  restoreDealMutation={restoreDealMutation}
                  getContactName={getContactName}
                  getCompanyName={getCompanyName}
                  setCreateOpen={setCreateOpen}
                  midSummaries={midSummaries}
                />
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <DragOverlay>
          {activeDeal && (
            <div className="w-[270px] opacity-90 shadow-xl">
              <Card className="cursor-grabbing">
                <CardContent className="p-3">
                  <div className="font-medium text-sm">{getContactName(activeDeal.contactId)}</div>
                  {getCompanyName(activeDeal.contactId) && (
                    <div className="text-xs text-muted-foreground">{getCompanyName(activeDeal.contactId)}</div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-deal-detail">
          <DialogHeader>
            <DialogTitle>Deal Details</DialogTitle>
          </DialogHeader>
          {selectedDeal && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Contact</span>
                  <div className="font-medium" data-testid="text-detail-contact">{getContactName(selectedDeal.contactId)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Company</span>
                  <div className="font-medium" data-testid="text-detail-company">{getCompanyName(selectedDeal.contactId) || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Pipeline</span>
                  <div className="font-medium" data-testid="text-detail-pipeline">{selectedDeal.pipeline}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Offer Path</span>
                  <div className="font-medium" data-testid="text-detail-offer">{selectedDeal.offerPath || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <div className="font-medium" data-testid="text-detail-created">
                    {selectedDeal.createdAt ? new Date(selectedDeal.createdAt).toLocaleDateString() : "N/A"}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Owner</span>
                  <div className="font-medium" data-testid="text-detail-owner">{selectedDeal.owner || "Unassigned"}</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={editStage} onValueChange={setEditStage}>
                  <SelectTrigger data-testid="select-edit-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALES_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                  data-testid="input-edit-notes"
                />
              </div>

              <div className="space-y-2">
                <Label>Next Follow-Up</Label>
                <Input
                  type="datetime-local"
                  value={editFollowUp}
                  onChange={(e) => setEditFollowUp(e.target.value)}
                  data-testid="input-edit-followup"
                />
              </div>

              <div className="space-y-2">
                <Label>Merchant ID (MID)</Label>
                <Input
                  value={editMid}
                  onChange={(e) => setEditMid(e.target.value)}
                  placeholder="e.g. 5491234567890"
                  className="font-mono"
                  data-testid="input-edit-mid"
                />
                <p className="text-xs text-muted-foreground">
                  Used to match incoming residual reports back to this deal.
                </p>
              </div>

              {isManagerOrAdmin && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <UserRound className="w-3.5 h-3.5" />
                    Assigned Agent
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={editAgentId !== "none" ? editAgentId : (dealAssignment ? String(dealAssignment.agentId) : "none")}
                      onValueChange={(val) => {
                        setEditAgentId(val);
                        if (!selectedDeal) return;
                        assignAgentMutation.mutate({
                          dealId: selectedDeal.id,
                          agentId: val === "none" ? null : Number(val),
                        });
                      }}
                    >
                      <SelectTrigger data-testid="select-assign-agent" className="flex-1">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {(agentsList || []).filter(a => a.status === "active").map((agent) => (
                          <SelectItem key={agent.id} value={String(agent.id)}>
                            {agent.firstName} {agent.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignAgentMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              )}

              {(selectedDeal as any).archivedAt && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted">
                  <Archive className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground flex-1">This deal is archived</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { restoreDealMutation.mutate(selectedDeal.id); setDetailOpen(false); }}
                    data-testid="button-restore-deal-detail"
                  >
                    <RotateCcw className="w-4 h-4 mr-1" /> Restore
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                {!(selectedDeal as any).archivedAt && (
                  <Button
                    variant="outline"
                    onClick={() => { archiveDealMutation.mutate(selectedDeal.id); setDetailOpen(false); }}
                    data-testid="button-archive-deal-detail"
                  >
                    <Archive className="w-4 h-4 mr-1" /> Archive
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDetailOpen(false)} data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button onClick={handleUpdateDeal} disabled={updateDealMutation.isPending} data-testid="button-save-deal">
                  {updateDealMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>

              <div className="border-t pt-4">
                <Comments entityType="deal" entityId={selectedDeal.id} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-configure-stages">
          <DialogHeader>
            <DialogTitle>Configure Pipeline Stages</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={configPipeline} onValueChange={setConfigPipeline}>
                <SelectTrigger data-testid="select-config-pipeline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Current Stages</Label>
              {sortedStages.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-stages">
                  No custom stages configured for this pipeline.
                </div>
              ) : (
                <div className="space-y-2" data-testid="stage-list">
                  {sortedStages.map((stage, idx) => {
                    const dealCount = getDealsInStage(stage.stageName);
                    return (
                      <div
                        key={stage.id}
                        className="flex items-center gap-2 p-2 border rounded-md"
                        data-testid={`stage-config-item-${stage.id}`}
                      >
                        <div
                          className="w-4 h-4 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: stage.color || "#6366f1" }}
                          data-testid={`stage-color-${stage.id}`}
                        />
                        {editingStage?.id === stage.id ? (
                          <div className="flex-1 flex items-center gap-2 flex-wrap">
                            <Input
                              value={editStageName}
                              onChange={(e) => setEditStageName(e.target.value)}
                              className="flex-1"
                              data-testid="input-edit-stage-name"
                            />
                            <div className="flex items-center gap-1 flex-wrap">
                              {PRESET_COLORS.map((c) => (
                                <button
                                  key={c}
                                  className={`w-5 h-5 rounded-sm border-2 ${editStageColor === c ? "border-foreground" : "border-transparent"}`}
                                  style={{ backgroundColor: c }}
                                  onClick={() => setEditStageColor(c)}
                                  data-testid={`color-edit-${c.replace("#", "")}`}
                                />
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <Button size="sm" onClick={handleSaveEditStage} disabled={updateStageMutation.isPending} data-testid="button-save-stage-edit">
                                Save
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingStage(null)} data-testid="button-cancel-stage-edit">
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="flex-1 text-sm font-medium" data-testid={`text-stage-name-${stage.id}`}>
                              {stage.stageName}
                            </span>
                            {dealCount > 0 && (
                              <Badge variant="secondary" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-stage-deals-${stage.id}`}>
                                {dealCount} deal{dealCount !== 1 ? "s" : ""}
                              </Badge>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Move stage up"
                              onClick={() => handleMoveStage(stage, "up")}
                              disabled={idx === 0 || reorderStagesMutation.isPending}
                              data-testid={`button-move-up-${stage.id}`}
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Move stage down"
                              onClick={() => handleMoveStage(stage, "down")}
                              disabled={idx === sortedStages.length - 1 || reorderStagesMutation.isPending}
                              data-testid={`button-move-down-${stage.id}`}
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Edit stage"
                              onClick={() => {
                                setEditingStage(stage);
                                setEditStageName(stage.stageName);
                                setEditStageColor(stage.color || "#6366f1");
                              }}
                              data-testid={`button-edit-stage-${stage.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Delete stage"
                              onClick={() => setDeleteConfirmStage(stage)}
                              data-testid={`button-delete-stage-${stage.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label>Add New Stage</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={addStageName}
                  onChange={(e) => setAddStageName(e.target.value)}
                  placeholder="Stage name"
                  className="flex-1"
                  data-testid="input-add-stage-name"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddStage(); }}
                />
                <Button
                  onClick={handleAddStage}
                  disabled={!addStageName.trim() || createStageMutation.isPending}
                  data-testid="button-add-stage"
                  className="gap-1"
                >
                  {createStageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </Button>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`w-5 h-5 rounded-sm border-2 ${addStageColor === c ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setAddStageColor(c)}
                    data-testid={`color-add-${c.replace("#", "")}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmStage} onOpenChange={(open) => { if (!open) setDeleteConfirmStage(null); }}>
        <AlertDialogContent data-testid="dialog-delete-stage-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stage</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmStage && getDealsInStage(deleteConfirmStage.stageName) > 0
                ? `Warning: There are ${getDealsInStage(deleteConfirmStage.stageName)} deal(s) currently in the "${deleteConfirmStage.stageName}" stage. Deleting this stage will not move those deals automatically. Are you sure you want to delete it?`
                : `Are you sure you want to delete the "${deleteConfirmStage?.stageName}" stage? This action cannot be undone.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-stage">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirmStage) deleteStageMutation.mutate(deleteConfirmStage.id); }}
              data-testid="button-confirm-delete-stage"
            >
              {deleteStageMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}