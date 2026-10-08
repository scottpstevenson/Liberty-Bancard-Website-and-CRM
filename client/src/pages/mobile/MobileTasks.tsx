import { useState, useRef, useEffect } from "react";
import { protectedScope } from "@/lib/queryClient";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { useOfflineQueue, WORK_ACKNOWLEDGED_EVENT } from "@/hooks/use-offline-queue";
import { CheckSquare, Plus, Loader2, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import type { Task } from "@shared/schema";
import { useWorkCommands, invalidateWorkFacts } from "@/hooks/use-work-commands";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { decodeTaskRows, isPendingTask, taskPresentationState } from "@/lib/task-source";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

function isOverdue(task: Task): boolean {
  if (!task.dueDate || !isPendingTask(task)) return false;
  return new Date() > new Date(task.dueDate);
}

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatDue(dateStr: string | null | undefined, pending: boolean): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${pending && d < new Date() ? "Overdue" : "Due"} · ${d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}`;
}

const PRIORITY_OPTIONS = ["normal", "high", "urgent"] as const;

export default function MobileTasks() {
  const workCommands = useWorkCommands("task");
  const { user } = useAuth();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<"today" | "all" | "completed" | "cancelled">("today");
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [newDueDate, setNewDueDate] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const { data: tasks, isLoading, isError, refetch } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: async ({ signal }) => decodeTaskRows(await (await apiRequest("GET", "/api/tasks", undefined, undefined, signal)).json()),
    staleTime: 1000 * 30,
  });

  const { executeOrQueue } = useOfflineQueue();
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const taskCreateCommand = useRef<{ key: string; commandId: string } | null>(null);
  const actorContext=JSON.stringify(protectedScope(user));
  const actorRef=useRef(actorContext);actorRef.current=actorContext;
  useEffect(()=>{
    taskCreateCommand.current=null;setCompletingIds(new Set());setCreating(false);
    setAddOpen(false);setNewTitle("");setNewPriority("normal");setNewDueDate("");setNewDesc("");
  },[actorContext]);
  useEffect(()=>{
    const acknowledged=(event:Event)=>{
      const receipt=(event as CustomEvent).detail;
      if(receipt?.actorId===user?.id && receipt.commandId===taskCreateCommand.current?.commandId)taskCreateCommand.current=null;
    };
    window.addEventListener(WORK_ACKNOWLEDGED_EVENT,acknowledged);
    return ()=>window.removeEventListener(WORK_ACKNOWLEDGED_EVENT,acknowledged);
  },[user?.id]);

  async function completeTask(id: number) {
    const submittedActor=actorContext;
    const task = tasks?.find(t => t.id === id);
    if (!task || !Number.isInteger(task.authorityFence)) {
      return toast({ title: "Work version unavailable", description: "Reload before completing this task.", variant: "destructive" });
    }
    setCompletingIds(prev => new Set(prev).add(id));
    try {
      const result = await executeOrQueue("PUT", `/api/tasks/${id}`, workCommands.edit(task, { status: "completed" }), invalidateWorkFacts);
      if(actorRef.current!==submittedActor)return;
      toast({ title: result.ok ? "Task completed" : result.queued ? "Completion queued, not yet saved" : "Completion not saved",
        description: result.ok ? undefined : result.reason || "Keep the work open until its server confirmation is available.", variant: result.ok || result.queued ? "default" : "destructive" });
    } catch (error) {
      if(actorRef.current!==submittedActor)return;
      toast({ title: "Completion not saved", description: (error as Error).message, variant: "destructive" });
    } finally {
      if(actorRef.current===submittedActor)setCompletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function createTask(data: { title: string; priority: string; dueDate?: string; description?: string }) {
    const submittedActor=actorContext;
    if (!user?.id) {
      toast({ title: "Task not saved", description: "Your signed-in actor is unavailable. Reload before creating work.", variant: "destructive" });
      return;
    }
    const due=data.dueDate ? new Date(data.dueDate) : null;
    if(due && !Number.isFinite(due.getTime())) {
      toast({title:"Task not saved",description:"Choose a valid due date and time.",variant:"destructive"});
      return;
    }
    setCreating(true);
    const body = {
      title: data.title,
      priority: data.priority,
      dueDate: due?.toISOString(),
      description: data.description || undefined,
      status: "pending",
      expectedActorId: user.id,
      expectedAccountVersion:user.accountVersion,
      recordClass: "production",
    };
    const key = JSON.stringify([user.id, body]);
    if (taskCreateCommand.current?.key !== key) taskCreateCommand.current = { key, commandId: crypto.randomUUID() };
    const commandBody = { ...body, commandId: taskCreateCommand.current.commandId };
    try {
      const { ok, queued, reason } = await executeOrQueue("POST", "/api/tasks", commandBody);
      if(actorRef.current!==submittedActor)return;
      if (ok || queued) {
        if (ok) taskCreateCommand.current = null;
        void invalidateWorkFacts();
        setAddOpen(false);
        setNewTitle("");
        setNewPriority("normal");
        setNewDueDate("");
        setNewDesc("");
      }
      toast({ title: ok ? "Task created" : queued ? "Task queued for sync" : "Task not saved",
        description: ok ? undefined : reason || (queued ? "It is not confirmed on the server yet." : "Try again when connectivity is restored."),
        variant: ok || queued ? "default" : "destructive" });
    } catch (error) {
      if(actorRef.current!==submittedActor)return;
      toast({ title: "Task not saved", description: (error as Error).message, variant: "destructive" });
    } finally {
      if(actorRef.current===submittedActor)setCreating(false);
    }
  }

  const allTasks = tasks || [];
  const todayTasks = allTasks.filter(t => isPendingTask(t) && (isToday(t.dueDate as any) || isOverdue(t)));
  const pendingTasks = allTasks.filter(isPendingTask);
  const completedTasks = allTasks.filter(t => taskPresentationState(t) === "completed");
  const cancelledTasks = allTasks.filter(t => taskPresentationState(t) === "cancelled");

  const displayTasks = filter === "today" ? todayTasks : filter === "completed" ? completedTasks :
    filter === "cancelled" ? cancelledTasks : pendingTasks;

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between mb-3 pr-14">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tasks</h1>
          <button
            data-testid="button-add-task"
            ref={addButtonRef}
            aria-label="Create a task"
            onClick={() => setAddOpen(true)}
            className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
          >
            <Plus className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["today", "all", "completed", "cancelled"] as const).map((f) => (
            <button
              key={f}
              data-testid={`filter-${f}`}
              aria-pressed={filter===f}
              onClick={() => setFilter(f)}
              className={`min-h-11 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
              }`}
            >
              {f === "today" ? `Today (${todayTasks.length})` : f === "all" ? `Pending (${pendingTasks.length})` :
                f === "cancelled" ? `Cancelled (${cancelledTasks.length})` : `Done (${completedTasks.length})`}
            </button>
          ))}
        </div>
      </div>
      {!isError && !isLoading && <p className="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400">
        {allTasks.length} tasks returned by your authorized reader. Loaded counts, not a paged total.
        {" "}Due times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>}

      <div className="py-2">
        {isLoading ? (
          <div className="px-4 space-y-3 py-4" role="status" aria-label="Loading tasks">
            {[1, 2, 3].map(index => <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        ) : isError ? (
          <div className="mx-4 my-8 rounded-xl border p-4 text-center" role="alert">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
            <p className="text-sm">Tasks could not be loaded. No empty state is assumed.</p>
            <button type="button" className="min-h-11 mt-3 text-sm font-semibold underline" onClick={() => void refetch()}>Retry</button>
          </div>
        ) : displayTasks.length === 0 ? (
          <div className="text-center py-12 px-4">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {filter === "today" ? "No tasks due today" : filter === "completed" ? "No completed tasks" :
                filter === "cancelled" ? "No cancelled tasks" : "No pending tasks"}
            </p>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {displayTasks.map(task => (
              <div
                key={task.id}
                data-testid={`card-task-${task.id}`}
                className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 flex items-start gap-3 ${
                  isOverdue(task) ? "border-red-200 dark:border-red-800" : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <button
                  data-testid={`button-complete-${task.id}`}
                  aria-label={`Complete task: ${task.title}`}
                  onClick={() => completeTask(task.id)}
                  disabled={!isPendingTask(task) || completingIds.has(task.id)}
                  className={`mt-0.5 w-11 h-11 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    taskPresentationState(task) === "completed"
                      ? "border-green-600 bg-green-600"
                      : isOverdue(task)
                      ? "border-red-700 dark:border-red-400"
                      : "border-gray-500 dark:border-gray-400"
                  }`}
                >
                  {taskPresentationState(task) === "completed" && <CheckCircle2 className="w-4 h-4 text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm ${!isPendingTask(task) ? "line-through text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-white"}`}>
                    {task.title}
                  </div>
                  {task.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{task.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {task.dueDate && (
                      <span className={`text-xs flex items-center gap-1 ${isOverdue(task) ? "text-red-700 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
                        {isOverdue(task) ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {formatDue(task.dueDate as any,isPendingTask(task))}
                      </span>
                    )}
                    {task.priority !== "normal" && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        task.priority === "urgent"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                      }`}>
                        {task.priority}
                      </span>
                    )}
                    {task.assignedTo && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{task.assignedTo}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetContent side="bottom"
            aria-describedby={undefined}
            data-testid="mobile-task-editor"
            onCloseAutoFocus={event => { event.preventDefault(); addButtonRef.current?.focus(); }}
            className="bg-white dark:bg-gray-900 rounded-t-3xl w-full p-6 max-h-[85vh] overflow-y-auto [&>button]:min-h-11 [&>button]:min-w-11"
          >
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />
            <div className="flex items-center justify-between mb-4">
              <SheetTitle className="text-lg font-bold text-gray-900 dark:text-white">New Task</SheetTitle>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title *</label>
                <input
                  data-testid="input-task-title"
                  aria-label="Task title"
                  type="text"
                  maxLength={500}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map(p => (
                    <button
                      key={p}
                      data-testid={`button-priority-${p}`}
                      aria-pressed={newPriority===p}
                      onClick={() => setNewPriority(p)}
                      className={`min-h-11 flex-1 py-2.5 rounded-xl text-xs font-semibold capitalize border transition-colors ${
                        newPriority === p
                          ? p === "urgent" ? "bg-red-600 border-red-600 text-white"
                            : p === "high" ? "bg-orange-100 border-orange-700 text-orange-900 dark:bg-orange-950 dark:text-orange-100"
                            : "bg-blue-600 border-blue-600 text-white"
                          : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Due Date</label>
                <input
                  data-testid="input-task-due-date"
                  aria-label="Task due date and time"
                  type="datetime-local"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes</label>
                <textarea
                  data-testid="input-task-notes"
                  aria-label="Task notes"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-base resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                data-testid="button-create-task"
                disabled={!newTitle.trim() || creating}
                onClick={() => createTask({ title: newTitle.trim(), priority: newPriority, dueDate: newDueDate, description: newDesc })}
                className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Task
              </button>
            </div>
          </SheetContent>
      </Sheet>
    </div>
  );
}
