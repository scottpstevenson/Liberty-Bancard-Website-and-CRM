import { useState, useEffect, useRef, Fragment, type ReactNode } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { taskCohortState, buildTaskCohortHref, buildTaskSelectionHref, isOverdueTask, taskStateFilters } from "@/lib/crm-destination-state";
import { taskActionVerb, taskEmptyState, taskRelatedLinks } from "@/lib/task-presentation";
import { isUnassignedWork, canClaimUnassignedWork, summarizeUnassigned, unassignedBlocker, claimConflictMessage } from "@/lib/unassigned-work";
import { UnassignedQueueBanner } from "@/components/work/UnassignedQueueBanner";
import { SelectedTaskPanel } from "@/components/work/SelectedTaskPanel";
import { useAuthorizedSelectedRecord } from "@/hooks/use-authorized-selected-record";
import { formatBusinessDateTime, businessZoneNote, businessZoneAbbreviation, businessInputToInstant, instantToBusinessInput } from "@shared/business-time";
import { useWorkCommands, invalidateWorkFacts } from "@/hooks/use-work-commands";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { useAuth } from "@/hooks/use-auth";
import { useToolCapability } from "@/hooks/use-tool-capabilities";
import { apiRequest, queryClient, protectedScope } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, ArrowRight, Sparkles, Loader2, ChevronDown, UserPlus, CheckCircle, Trash2, MessageSquare, Pencil } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOwnedToast as useToast } from "@/hooks/use-owned-toast";
import Comments from "@/components/Comments";
import SavedFilterBar from "@/components/SavedFilterBar";
import DashboardErrorState from "@/components/DashboardErrorState";
import { DataState } from "@/components/ui/data-state";
import { PageHeader } from "@/components/crm/CrmPresentation";
import { toastError } from "@/lib/toast-helpers";
import type { Task } from "@shared/schema";
import { isSlaGeneratedTask } from "@/lib/task-source";

const STATUS_OPTIONS = ["pending", "in_progress", "completed", "cancelled"] as const;
const PRIORITY_OPTIONS = ["normal", "high", "urgent"] as const;

function TasksHeader({ embedded, title, subtitle, actions, testId }: {
  embedded: boolean; title: string; subtitle?: string; actions?: ReactNode; testId?: string;
}) {
  if (!embedded) return <PageHeader title={title} subtitle={subtitle} actions={actions} testId={testId} />;
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" data-testid={testId}>
    <div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

function formatDueDate(dueDate: Task["dueDate"]): string {
  if (!dueDate) return "No due date";
  const parsed = new Date(dueDate);
  return isValidDate(parsed) ? formatBusinessDateTime(parsed) : "Invalid due date";
}

function humanizeUnknownLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) || "Unknown";
}

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "pending": return "Pending";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    default: return status ? humanizeUnknownLabel(status) : "Unknown";
  }
}

function getPriorityLabel(priority: string | null): string {
  switch (priority) {
    case "urgent": return "Urgent";
    case "high": return "High";
    case "normal": return "Normal";
    default: return priority ? humanizeUnknownLabel(priority) : "Normal";
  }
}

function getStatusVariant(status: string | null): "default" | "secondary" | "outline" {
  switch (status) {
    case "completed": return "secondary";
    case "in_progress": return "default";
    default: return "outline";
  }
}

function getPriorityVariant(priority: string | null): "destructive" | "default" | "secondary" {
  switch (priority) {
    case "urgent": return "destructive";
    case "high": return "default";
    default: return "secondary";
  }
}

function getNextStatus(status: string | null): string | null {
  switch (status) {
    case "pending": return "in_progress";
    case "in_progress": return "completed";
    default: return null;
  }
}

export default function Tasks({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const {user}=useAuth();
  const aiCapability=useToolCapability("ai");
  const [createOpen, setCreateOpen] = useState(false);
  // The status and due cohort live in the URL (registered selectors parsed here), so direct entry, reload and Back/Forward
  // restore the same list the Today action counted.
  const cohortSearch = useSearch();
  const [, navigateCohort] = useLocation();
  const cohort = taskCohortState(cohortSearch);
  // Exact selected task (`taskId`): read through the actor-scoped single-task authority, independent of the list filters.
  const selectedTask = useAuthorizedSelectedRecord<Task>("/api/tasks", cohortSearch, "taskId");
  const clearSelectedTask = () => navigateCohort(buildTaskSelectionHref(window.location.href, null), { replace: true });
  const filterStatus: string = cohort.status;
  const filterDue = cohort.due;
  const filterOwner = cohort.owner;
  const setCohort = (status: string, due: "all" | "overdue", owner: "all" | "unassigned" = filterOwner) => {
    const safeStatus = (taskStateFilters as readonly string[]).includes(status) ? status as typeof taskStateFilters[number] : "all";
    navigateCohort(buildTaskCohortHref(window.location.href, { status: safeStatus, due, owner, requestTasks: cohort.requestTasks }));
  };
  const clearRequestCohort = () => navigateCohort(buildTaskCohortHref(window.location.href, { status: filterStatus as typeof taskStateFilters[number], due: filterDue, owner: filterOwner, requestTasks: "all" }));
  const setFilterStatus = (status: string) => setCohort(status, filterDue);
  const [filterSource, setFilterSource] = useState<string>("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignTo, setBulkAssignTo] = useState("");
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [editTaskFence, setEditTaskFence] = useState(0);
  const [editTaskFields, setEditTaskFields] = useState({
    title: "",
    description: "",
    assignedTo: "",
    dueDate: "",
    priority: "normal",
  });

  const handleSourceFilterChange = (value: string) => {
    setFilterSource(value);
    setSelectedTaskIds(new Set());
    setSelectAll(false);
    setBulkAssignOpen(false);
    setBulkDeleteConfirmOpen(false);
  };

  const handleStatusFilterChange = (value: string) => {
    setFilterStatus(value);
    setSelectedTaskIds(new Set());
    setSelectAll(false);
    setBulkAssignOpen(false);
    setBulkDeleteConfirmOpen(false);
  };

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    assignedTo: "",
    dueDate: "",
    priority: "normal",
    dealId: "",
    contactId: "",
    ticketId: "",
  });
  const actorContext=JSON.stringify(protectedScope(user));
  const commandContext=JSON.stringify([actorContext,filterSource,filterStatus,filterDue,filterOwner,cohort.requestTasks,createOpen,editTaskId,[...selectedTaskIds].sort()]);
  const currentContext=useRef(commandContext);currentContext.current=commandContext;
  const mutationBoundary={onMutate:()=>commandContext};
  const accepts=(submitted:string|undefined)=>submitted===currentContext.current;
  useEffect(()=>{
    setSelectedTaskIds(new Set());setSelectAll(false);setCreateOpen(false);setEditTaskId(null);
    setBulkAssignOpen(false);setBulkDeleteConfirmOpen(false);setExpandedTaskId(null);setBulkAssignTo("");
    setNewTask({title:"",description:"",assignedTo:"",dueDate:"",priority:"normal",dealId:"",contactId:"",ticketId:""});
    setEditTaskFields({title:"",description:"",assignedTo:"",dueDate:"",priority:"normal"});
  },[actorContext]);

  const { data: tasks, isLoading, isError, refetch } = useQuery<Task[]>({
    queryKey: ["/api/tasks", filterSource],
    queryFn: async ({signal}) => {
      const params = new URLSearchParams();
      if (filterSource === "sla" || filterSource === "manual") {
        params.set("source", filterSource);
      }
      const url = params.toString() ? `/api/tasks?${params.toString()}` : "/api/tasks";
      const data=await (await apiRequest("GET",url,undefined,undefined,signal)).json();
      if(!Array.isArray(data)||!data.every(task=>Number.isSafeInteger(task.id)&&Number.isInteger(task.authorityFence)
        &&typeof task.title==="string"&&typeof task.status==="string"))throw new Error("Invalid authorized task collection");
      return data;
    },
  });

  // Request-linked work groups (Website requests counts on Today/Overview). The server returns the ids its own count used, so
  // this list selects exactly those tasks; a failed or forbidden read says so and never falls back to the unfiltered list.
  const requestCohortAllowed = user?.role === "admin" || user?.role === "manager";
  const requestCohortRead = useQuery<{ cohort: string; asOf: string; taskIds: number[] }>({
    queryKey: ["/api/lead-ops/inbound-requests/task-cohort", cohort.requestTasks],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/lead-ops/inbound-requests/task-cohort?cohort=${encodeURIComponent(cohort.requestTasks)}`, undefined, undefined, signal)).json(),
    enabled: cohort.requestTasks !== "all" && requestCohortAllowed,
    staleTime: 0, gcTime: 0, retry: false,
  });
  const requestCohortIds = cohort.requestTasks !== "all" && requestCohortAllowed && requestCohortRead.data && !requestCohortRead.isError
    ? new Set(requestCohortRead.data.taskIds) : null;
  const requestCohortLabel = cohort.requestTasks === "due_today" ? "Request tasks due today (Eastern time)" : "Request tasks overdue (due before today, Eastern time)";

  const workCommands = useWorkCommands("task", selectedTaskIds, tasks);
  const createTaskMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/tasks", workCommands.create(data));
      return res.json();
    },
    onSuccess: (_data,_variables,submitted) => {
      workCommands.finishCreate(_variables);
      invalidateWorkFacts();if(!accepts(submitted))return;
      setCreateOpen(false);
      setNewTask({ title: "", description: "", assignedTo: "", dueDate: "", priority: "normal", dealId: "", contactId: "", ticketId: "" });
      toast({ title: "Task created successfully" });
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      toastError(err, { title: "Failed to create task" });
    },
  });

  const updateTaskMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/tasks/${id}`, data);
      return res.json();
    },
    onSuccess: (_data,_variables,submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      toast({ title: "Task updated" });
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      toastError(err, { title: "Failed to update task" });
    },
  });

  // Single-record claim through the same fenced edit command as Edit: it carries the task's current version, so a task that
  // changed or was claimed elsewhere is refused (409) rather than overwritten. The server decides eligibility.
  const claimTaskMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async (task: Task) => {
      if (!user?.email) throw new Error("Your account email is unavailable, so the claim cannot be recorded. Reload and try again.");
      const res = await apiRequest("PUT", `/api/tasks/${task.id}`, workCommands.edit(task, { assignedTo: user.email }));
      return res.json();
    },
    onSuccess: (_data, task, submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      toast({ title: "Task claimed", description: `Task #${task.id} is now assigned to you.` });
    },
    onError: (err: Error, task, submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      toast({ title: `Task #${task.id} was not claimed`, description: claimConflictMessage(err), variant: "destructive" });
    },
  });

  const generateTasksMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async () => {
      if(aiCapability.blocked)throw new Error(aiCapability.reason);
      const res = await apiRequest("POST", "/api/ai/generate-tasks");
      return res.json();
    },
    onSuccess: (data: { generated: number },_variables,submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      toast({ title: `AI generated ${data.generated} new tasks`, description: "Tasks created based on stalling deals, SLA breaches, and cold leads." });
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      toastError(err, { title: "AI task generation failed" });
    },
  });

  const bulkAssignMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async ({ taskIds, assignedTo }: { taskIds: number[]; assignedTo: string }) => {
      const res = await apiRequest("POST", "/api/tasks/bulk-assign", workCommands.bulk(taskIds, { assignedTo }));
      return res.json();
    },
    onSuccess: (data,_variables,submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      setSelectedTaskIds(new Set());
      setBulkAssignOpen(false);
      setBulkAssignTo("");
      toast({ title: data.replayed ? "Assignment already saved" : `${data.count} tasks reassigned` });
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      toastError(err, { title: "Failed to assign tasks" });
    },
  });

  const bulkCompleteMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async (taskIds: number[]) => {
      const res = await apiRequest("POST", "/api/tasks/bulk-complete", workCommands.bulk(taskIds));
      return res.json();
    },
    onSuccess: (data,_variables,submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      setSelectedTaskIds(new Set());
      toast({ title: data.replayed ? "Completion already saved" : `${data.changed} tasks completed` });
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      toastError(err, { title: "Failed to complete tasks" });
    },
  });

  const bulkDeleteMutation = useMutation({
    ...mutationBoundary,
    mutationFn: async (taskIds: number[]): Promise<{ deleted: number; requested: number; replayed:boolean }> => {
      const res = await apiRequest("POST", "/api/tasks/bulk-delete", workCommands.bulk(taskIds));
      const data = await res.json();
      return { deleted: data.deleted, requested: taskIds.length,replayed:data.replayed };
    },
    onSuccess: ({ deleted, requested,replayed },_variables,submitted) => {
      invalidateWorkFacts();if(!accepts(submitted))return;
      setSelectedTaskIds(new Set());
      setBulkDeleteConfirmOpen(false);
      if (replayed) {
        toast({title:"Deletion already saved",description:`The original command retired ${deleted} tasks. No new deletion was executed.`});
      } else if (deleted < requested) {
        toast({ title: `${deleted} of ${requested} tasks deleted`, description: "Some tasks may have already been deleted.", variant: "default" });
      } else {
        toast({ title: `${deleted} task${deleted !== 1 ? "s" : ""} deleted` });
      }
    },
    onError: (err: Error,_variables,submitted) => {
      if(!accepts(submitted))return;
      setBulkDeleteConfirmOpen(false);
      toastError(err, { title: "Failed to delete tasks" });
    },
  });

  const toggleTaskSelection = (taskId: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleCreateTask = () => {
    if (!newTask.title) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      title: newTask.title,
      description: newTask.description || undefined,
      assignedTo: newTask.assignedTo || undefined,
      priority: newTask.priority,
    };
    if (newTask.dueDate) {
      const due = businessInputToInstant(newTask.dueDate);
      if (!due) { toast({ title: "Choose a valid due date and time", variant: "destructive" }); return; }
      payload.dueDate = due.toISOString();
    }
    if (newTask.dealId) payload.dealId = Number(newTask.dealId);
    if (newTask.contactId) payload.contactId = Number(newTask.contactId);
    if (newTask.ticketId) payload.ticketId = Number(newTask.ticketId);
    createTaskMutation.mutate(payload);
  };

  const openEditTask = (task: Task) => {
    // The edit field shows business-zone wall time, the same zone every due time is displayed in.
    const dueDateLocal = instantToBusinessInput(task.dueDate);
    setEditTaskFields({
      title: task.title || "",
      description: task.description || "",
      assignedTo: task.assignedTo || "",
      dueDate: dueDateLocal,
      priority: task.priority || "normal",
    });
    setEditTaskId(task.id);
    setEditTaskFence(task.authorityFence);
  };

  const handleSaveEditTask = () => {
    if (!editTaskId) return;
    if (!editTaskFields.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const editedDue = editTaskFields.dueDate ? businessInputToInstant(editTaskFields.dueDate) : null;
    if (editTaskFields.dueDate && !editedDue) {
      toast({ title: "Choose a valid due date and time", variant: "destructive" });
      return;
    }
    // Explicitly send null for cleared optional fields so the server can persist the clear.
    const payload: Record<string, unknown> = {
      title: editTaskFields.title.trim(),
      description: editTaskFields.description.trim() || null,
      assignedTo: editTaskFields.assignedTo.trim() || null,
      priority: editTaskFields.priority,
      // Send null when dueDate is cleared so the server actually removes the deadline.
      dueDate: editedDue ? editedDue.toISOString() : null,
    };
    updateTaskMutation.mutate(
      { id: editTaskId, ...workCommands.edit({ id: editTaskId, authorityFence: editTaskFence }, payload) },
      {
        onSuccess: (_data,_variables,submitted) => {if(accepts(submitted))setEditTaskId(null);},
      }
    );
  };

  const handleAdvanceStatus = (task: Task) => {
    const next = getNextStatus(task.status);
    if (!next) return;
    const updates: Record<string, unknown> = { status: next };
    updateTaskMutation.mutate({ id: task.id, ...workCommands.edit(task, updates) });
  };

  const filteredTasks = tasks?.filter((t) => {
    if (filterStatus === "open" ? (t.status !== "pending" && t.status !== "in_progress") : (filterStatus !== "all" && t.status !== filterStatus)) return false;
    if (filterDue === "overdue" && !isOverdueTask(t, new Date())) return false;
    if (filterOwner === "unassigned" && !isUnassignedWork(t)) return false;
    if (cohort.requestTasks !== "all" && !(requestCohortIds?.has(t.id))) return false;
    return true;
  }) || [];
  const requestCohortMissing = requestCohortIds ? [...requestCohortIds].filter((id) => !tasks?.some((t) => t.id === id)).length : 0;
  const unassignedSummary = summarizeUnassigned(tasks ?? [], t => isOverdueTask(t, new Date()));
  const canClaim = canClaimUnassignedWork(user?.role);

  const empty = taskEmptyState(tasks?.length ?? 0, filteredTasks.length);
  const clearAllFilters = () => {
    navigateCohort(buildTaskCohortHref(window.location.href, { status: "all", due: "all", owner: "all" }));
    handleSourceFilterChange("all");
  };

  const toggleAllTasks = () => {
    if (selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedTaskIds(new Set());
      setSelectAll(false);
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map((t) => t.id)));
      setSelectAll(true);
    }
  };

  const tasksLoadingFallback = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="border rounded-md overflow-x-auto">
        <table className="w-full">
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="p-3"><Skeleton className="h-4 w-4" /></td>
                <td className="p-3"><Skeleton className="h-4 w-48" /></td>
                <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                <td className="p-3"><Skeleton className="h-4 w-20" /></td>
                <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                <td className="p-3"><Skeleton className="h-4 w-20" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (isLoading || isError) {
    return (
      <DataState
        query={{ isLoading, isError, error: undefined, refetch }}
        loadingFallback={tasksLoadingFallback}
        errorTitle="Failed to load tasks"
        testId="tasks"
      >
        {null}
      </DataState>
    );
  }

  return (
    <div className="space-y-6" data-testid="tasks-page">
      <TasksHeader
        embedded={embedded}
        title="Tasks"
        testId="text-tasks-title"
        actions={
          <>
            <Select value={filterSource} onValueChange={handleSourceFilterChange}>
              <SelectTrigger aria-label="Filter tasks by source" className="w-[180px]" data-testid="select-filter-source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="sla">SLA-generated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={handleStatusFilterChange}>
              <SelectTrigger aria-label="Filter tasks by effective status" className="w-[160px]" data-testid="select-filter-status">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open (pending or in progress)</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{getStatusLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterDue} onValueChange={(v) => { setCohort(filterStatus, v === "overdue" ? "overdue" : "all"); setSelectedTaskIds(new Set()); setSelectAll(false); }}>
              <SelectTrigger aria-label="Filter tasks by due date" className="w-[160px]" data-testid="select-filter-due">
                <SelectValue placeholder="Due" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any due date</SelectItem>
                <SelectItem value="overdue">Overdue only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterOwner} onValueChange={(v) => { setCohort(filterStatus, filterDue, v === "unassigned" ? "unassigned" : "all"); setSelectedTaskIds(new Set()); setSelectAll(false); }}>
              <SelectTrigger aria-label="Filter tasks by owner" className="w-[160px]" data-testid="select-filter-owner">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any owner</SelectItem>
                <SelectItem value="unassigned">Unassigned only</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-ai-generate-tasks"
              className="gap-2"
              onClick={() => generateTasksMutation.mutate()}
              disabled={generateTasksMutation.isPending || aiCapability.blocked}
            >
              {generateTasksMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI Generate Tasks
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-task" className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Task
                </Button>
              </DialogTrigger>
            <DialogContent data-testid="dialog-create-task">
              <DialogHeader>
                <DialogTitle>Create New Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title"
                    data-testid="input-task-title"
                    aria-label="Task title"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="Task description..."
                    data-testid="input-task-description"
                    aria-label="Task description"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assigned To</Label>
                    <Input
                      value={newTask.assignedTo}
                      onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
                      placeholder="Existing owner email or user ID"
                      data-testid="input-task-assigned"
                      aria-label="Task owner email or user ID"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date ({businessZoneAbbreviation()} business time)</Label>
                    <Input
                      type="datetime-local"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                      data-testid="input-task-duedate"
                      aria-label="Task due date and time in Eastern business time"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v })}>
                    <SelectTrigger data-testid="select-task-priority">
                      <span className="sr-only">Task priority</span>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p}>{getPriorityLabel(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Deal ID</Label>
                    <Input
                      value={newTask.dealId}
                      onChange={(e) => setNewTask({ ...newTask, dealId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-deal-id"
                      aria-label="Linked deal ID"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contact ID</Label>
                    <Input
                      value={newTask.contactId}
                      onChange={(e) => setNewTask({ ...newTask, contactId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-contact-id"
                      aria-label="Linked contact ID"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ticket ID</Label>
                    <Input
                      value={newTask.ticketId}
                      onChange={(e) => setNewTask({ ...newTask, ticketId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-ticket-id"
                      aria-label="Linked ticket ID"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-task">
                    Cancel
                  </Button>
                  <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending} data-testid="button-submit-task">
                    {createTaskMutation.isPending ? "Creating..." : "Create Task"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {selectedTaskIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap" data-testid="tasks-bulk-bar">
          <span className="text-sm text-muted-foreground" data-testid="text-tasks-selected-count">
            {selectedTaskIds.size} of {filteredTasks.length} shown selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-task-bulk-actions">
                Bulk Actions
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                data-testid="button-bulk-assign"
                onClick={() => setBulkAssignOpen(true)}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Assign To
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-bulk-complete"
                onClick={() => bulkCompleteMutation.mutate(Array.from(selectedTaskIds))}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Mark Complete
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-bulk-delete"
                className="text-destructive"
                onClick={() => setBulkDeleteConfirmOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected ({selectedTaskIds.size})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedTaskIds(new Set())}
            data-testid="button-clear-task-selection"
          >
            Clear Selection
          </Button>
        </div>
      )}

      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent data-testid="dialog-bulk-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete {selectedTaskIds.size} Task{selectedTaskIds.size !== 1 ? "s" : ""}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              This will remove {selectedTaskIds.size} task{selectedTaskIds.size !== 1 ? "s" : ""} from active task views. Confirm the reviewed selection before continuing.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setBulkDeleteConfirmOpen(false)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-cancel-bulk-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => bulkDeleteMutation.mutate(Array.from(selectedTaskIds))}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-confirm-bulk-delete"
              >
                {bulkDeleteMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</> : `Delete ${selectedTaskIds.size} Task${selectedTaskIds.size !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent data-testid="dialog-bulk-assign">
          <DialogHeader>
            <DialogTitle>Assign {selectedTaskIds.size} Task{selectedTaskIds.size > 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Assign To</Label>
              <Input
                value={bulkAssignTo}
                onChange={(e) => setBulkAssignTo(e.target.value)}
                placeholder="Enter name"
                data-testid="input-bulk-assign-to"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setBulkAssignOpen(false)} data-testid="button-cancel-bulk-assign">
                Cancel
              </Button>
              <Button
                onClick={() => bulkAssignMutation.mutate({ taskIds: Array.from(selectedTaskIds), assignedTo: bulkAssignTo })}
                disabled={!bulkAssignTo || bulkAssignMutation.isPending}
                data-testid="button-submit-bulk-assign"
              >
                {bulkAssignMutation.isPending ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Inline Task Edit Dialog ───────────────────────────────── */}
      <Dialog open={editTaskId !== null} onOpenChange={(open) => { if (!open) setEditTaskId(null); }}>
        <DialogContent data-testid="dialog-edit-task">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                value={editTaskFields.title}
                onChange={(e) => setEditTaskFields((p) => ({ ...p, title: e.target.value }))}
                placeholder="Task title"
                data-testid="input-edit-task-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editTaskFields.description}
                onChange={(e) => setEditTaskFields((p) => ({ ...p, description: e.target.value }))}
                placeholder="Task description..."
                data-testid="input-edit-task-description"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assigned To</Label>
                <Input
                  value={editTaskFields.assignedTo}
                  onChange={(e) => setEditTaskFields((p) => ({ ...p, assignedTo: e.target.value }))}
                  placeholder="Name or email"
                  data-testid="input-edit-task-assigned"
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date ({businessZoneAbbreviation()} business time)</Label>
                <Input
                  type="datetime-local"
                  aria-label="Task due date and time in Eastern business time"
                  value={editTaskFields.dueDate}
                  onChange={(e) => setEditTaskFields((p) => ({ ...p, dueDate: e.target.value }))}
                  data-testid="input-edit-task-duedate"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={editTaskFields.priority}
                onValueChange={(v) => setEditTaskFields((p) => ({ ...p, priority: v }))}
              >
                <SelectTrigger data-testid="select-edit-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{getPriorityLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditTaskId(null)} data-testid="button-cancel-edit-task">
                Cancel
              </Button>
              <Button
                onClick={handleSaveEditTask}
                disabled={updateTaskMutation.isPending}
                data-testid="button-save-edit-task"
              >
                {updateTaskMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SelectedTaskPanel
        selection={selectedTask}
        statusLabel={getStatusLabel}
        priorityLabel={getPriorityLabel}
        onClear={clearSelectedTask}
        onEdit={openEditTask}
        onAdvance={handleAdvanceStatus}
        busy={updateTaskMutation.isPending}
      />

      <SavedFilterBar
        entityType="task"
        currentFilters={{ filterStatus, filterSource, filterDue, filterOwner }}
        onApplyFilter={(filters) => {
          setCohort(String(filters.filterStatus || "all"), filters.filterDue === "overdue" ? "overdue" : "all", filters.filterOwner === "unassigned" ? "unassigned" : "all");
          setFilterSource(String(filters.filterSource || "all"));
          setSelectedTaskIds(new Set());
          setSelectAll(false);
          setBulkAssignOpen(false);
          setBulkDeleteConfirmOpen(false);
        }}
      />

      <UnassignedQueueBanner
        kind="task" summary={unassignedSummary} active={filterOwner === "unassigned"} canClaim={canClaim}
        overdueLabel="overdue"
        onShowUnassigned={() => { setCohort("all", "all", "unassigned"); setSelectedTaskIds(new Set()); setSelectAll(false); }}
        onShowAll={() => { setCohort(filterStatus, filterDue, "all"); setSelectedTaskIds(new Set()); setSelectAll(false); }}
      />
      <p role="status" data-testid="work-ai-capability-reason">{aiCapability.reason}</p>
      {cohort.requestTasks !== "all" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="work-request-cohort">
          <Badge variant="secondary" data-testid="work-request-cohort-label">{requestCohortLabel}</Badge>
          {!requestCohortAllowed ? (
            <span role="alert" data-testid="work-request-cohort-forbidden">Request task groups are available to admins and managers. Nothing is shown for this group.</span>
          ) : requestCohortRead.isError ? (
            <span role="alert" data-testid="work-request-cohort-unavailable">
              This group could not be read, so the list below is empty on purpose and is not an all-clear.{" "}
              <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void requestCohortRead.refetch()} data-testid="work-request-cohort-retry">Retry</Button>
            </span>
          ) : requestCohortRead.isLoading ? (
            <span role="status" data-testid="work-request-cohort-loading">Reading the request tasks counted on Today…</span>
          ) : (
            <span role="status" data-testid="work-request-cohort-count">
              {requestCohortRead.data?.taskIds.length ?? 0} counted on Today
              {requestCohortMissing > 0 ? `; ${requestCohortMissing} not in the task list you can see` : ""}.
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={clearRequestCohort} data-testid="work-request-cohort-clear">Show all tasks</Button>
        </div>
      )}
      <p className="text-xs" data-testid="work-reader-coverage">
        {tasks?.length ?? 0} tasks returned by the authorized array reader; {filteredTasks.length} match these loaded filters{filterDue === "overdue" ? " (overdue: pending or in progress, due before now)" : ""}.{cohort.issues.length > 0 ? ` ${cohort.issues[0].reason}` : ""}
        No server paging or whole-population selection is claimed. {businessZoneNote()}
      </p>
      <div className="crm-dense-worklist overflow-x-auto border rounded-md" data-testid="tasks-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                    aria-label="Select all tasks in this filtered collection"
                  checked={filteredTasks.length > 0 && selectedTaskIds.size === filteredTasks.length}
                  onCheckedChange={toggleAllTasks}
                  data-testid="checkbox-select-all-tasks"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="hidden md:table-cell">Assigned To</TableHead>
              <TableHead className="hidden sm:table-cell">Due Date</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Related</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty && (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex flex-col items-center justify-center py-14 text-center gap-3" data-testid="empty-tasks" data-empty-kind={empty.kind}>
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground" data-testid="text-empty-tasks">{empty.title}</p>
                    <p className="text-xs text-muted-foreground max-w-sm">{empty.detail}</p>
                    {empty.kind === "no_match" ? (
                      <Button size="sm" variant="outline" className="gap-1 mt-1" onClick={clearAllFilters} data-testid="button-clear-task-filters">
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" className="gap-1 mt-1" onClick={() => setCreateOpen(true)} data-testid="button-empty-create-task">
                        <Plus className="w-3.5 h-3.5" /> Create Task
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filteredTasks.map((task) => {
              const overdue = isOverdueTask(task, new Date());
              const nextStatus = getNextStatus(task.status);
              return (
                <Fragment key={task.id}>
                <TableRow data-testid={`row-task-${task.id}`} data-selected={selectedTask.id === task.id ? "true" : undefined}
                  className={selectedTask.id === task.id ? "bg-blue-50/60 dark:bg-blue-950/20" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select task ${task.id}: ${task.title}`}
                      checked={selectedTaskIds.has(task.id)}
                      onCheckedChange={() => toggleTaskSelection(task.id)}
                      data-testid={`checkbox-task-${task.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={buildTaskSelectionHref(window.location.href, task.id)} className="font-medium hover:underline" data-testid={`text-task-title-${task.id}`} aria-label={`Open task ${task.id}: ${task.title || "Untitled task"}`}>{task.title || "Untitled task"}</Link>
                        {isSlaGeneratedTask(task) && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-sla-${task.id}`}>
                            SLA
                          </Badge>
                        )}
                      </div>
                      {task.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1" data-testid={`text-task-desc-${task.id}`}>{task.description}</div>
                      )}
                      {isUnassignedWork(task) && (
                        <p className="text-xs text-amber-800 dark:text-amber-300" data-testid={`text-unassigned-blocker-${task.id}`}>
                          Unassigned. {unassignedBlocker("task", task)}
                        </p>
                      )}
                      {/* The owner, due and related columns hide at narrow widths; this line keeps each one visible exactly where its column is hidden. */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground lg:hidden" data-testid={`task-compact-meta-${task.id}`}>
                        <span className="md:hidden">Owner: {task.assignedTo || "Unassigned"}</span>
                        <span className="sm:hidden">Due: {task.dueDate ? formatDueDate(task.dueDate) : "No due time"}{overdue ? " (overdue)" : ""}</span>
                        {taskRelatedLinks(task).map(link => (
                          <Link key={link.kind} href={link.href} className="lg:hidden text-blue-600 hover:underline" data-testid={`link-task-${task.id}-compact-${link.kind}`}>{link.label}</Link>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell" data-testid={`text-task-assigned-${task.id}`}>
                    {task.assignedTo || "Unassigned"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" data-testid={`text-task-due-${task.id}`}>
                    <div className="flex items-center gap-2">
                      {formatDueDate(task.dueDate)}
                      {overdue && (
                        <Badge variant="destructive" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-overdue-${task.id}`}>
                          Overdue
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getPriorityVariant(task.priority)} className="no-default-hover-elevate no-default-active-elevate" data-testid={`badge-priority-${task.id}`}>
                      {getPriorityLabel(task.priority)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(task.status)} className="no-default-hover-elevate no-default-active-elevate" data-testid={`badge-status-${task.id}`}>
                      {getStatusLabel(task.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" data-testid={`text-task-related-${task.id}`}>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {taskRelatedLinks(task).map(link => (
                        <div key={link.kind}><Link href={link.href} className="text-blue-600 hover:underline" data-testid={`link-task-${task.id}-${link.kind}`}>{link.label}</Link></div>
                      ))}
                      {taskRelatedLinks(task).length === 0 && <span>--</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      {canClaim && isUnassignedWork(task) && getNextStatus(task.status) !== null && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => claimTaskMutation.mutate(task)}
                          disabled={claimTaskMutation.isPending}
                          data-testid={`button-claim-task-${task.id}`}
                          aria-label={`Assign to me: ${task.title || `task ${task.id}`}`}
                        >
                          <UserPlus className="w-3 h-3" />
                          Assign to me
                        </Button>
                      )}
                      {nextStatus && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => handleAdvanceStatus(task)}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-advance-${task.id}`}
                          aria-label={`${taskActionVerb(task.status)?.verb ?? "Update"}: ${task.title || `task ${task.id}`}`}
                        >
                          <ArrowRight className="w-3 h-3" />
                          {taskActionVerb(task.status)?.verb ?? getStatusLabel(nextStatus)}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        title="Edit task"
                        onClick={() => openEditTask(task)}
                        data-testid={`button-edit-task-${task.id}`}
                        aria-label={`Edit task #${task.id}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                        data-testid={`button-comments-${task.id}`}
                        aria-label={`Comments for task #${task.id}`}
                      >
                        <MessageSquare className="w-3 h-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedTaskId === task.id && (
                  <TableRow data-testid={`row-task-comments-${task.id}`}>
                    <TableCell colSpan={7} className="p-4">
                      <Comments entityType="task" entityId={task.id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
