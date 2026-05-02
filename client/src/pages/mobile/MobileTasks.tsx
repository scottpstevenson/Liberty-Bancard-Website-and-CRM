import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { CheckSquare, Plus, Loader2, AlertTriangle, Clock, CheckCircle2, X } from "lucide-react";
import type { Task } from "@shared/schema";

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "completed") return false;
  return new Date() > new Date(task.dueDate);
}

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatDue(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

const PRIORITY_OPTIONS = ["normal", "high", "urgent"] as const;

export default function MobileTasks() {
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<"today" | "all" | "completed">("today");
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [newDueDate, setNewDueDate] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    staleTime: 1000 * 30,
  });

  const { executeOrQueue } = useOfflineQueue();
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);

  async function completeTask(id: number) {
    setCompletingIds(prev => new Set(prev).add(id));
    const { queued } = await executeOrQueue("PUT", `/api/tasks/${id}`, { status: "completed" }, () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    });
    if (queued) {
      queryClient.setQueryData<Task[]>(["/api/tasks"], old =>
        (old || []).map(t => t.id === id ? { ...t, status: "completed" } : t)
      );
    }
    setCompletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function createTask(data: { title: string; priority: string; dueDate?: string; description?: string }) {
    setCreating(true);
    const body = {
      title: data.title,
      priority: data.priority,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      description: data.description || undefined,
      status: "pending",
    };
    const { ok, queued } = await executeOrQueue("POST", "/api/tasks", body);
    if (ok || queued) {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setAddOpen(false);
      setNewTitle("");
      setNewPriority("normal");
      setNewDueDate("");
      setNewDesc("");
    }
    setCreating(false);
  }

  const allTasks = tasks || [];
  const todayTasks = allTasks.filter(t => t.status !== "completed" && (isToday(t.dueDate as any) || isOverdue(t)));
  const pendingTasks = allTasks.filter(t => t.status !== "completed");
  const completedTasks = allTasks.filter(t => t.status === "completed");

  const displayTasks = filter === "today" ? todayTasks : filter === "completed" ? completedTasks : pendingTasks;

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tasks</h1>
          <button
            data-testid="button-add-task"
            onClick={() => setAddOpen(true)}
            className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
          >
            <Plus className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex gap-2">
          {(["today", "all", "completed"] as const).map((f) => (
            <button
              key={f}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
              }`}
            >
              {f === "today" ? `Today (${todayTasks.length})` : f === "all" ? `Pending (${pendingTasks.length})` : `Done (${completedTasks.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="py-2">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : displayTasks.length === 0 ? (
          <div className="text-center py-12 px-4">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {filter === "today" ? "No tasks due today — great job!" : filter === "completed" ? "No completed tasks" : "No pending tasks"}
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
                  onClick={() => completeTask(task.id)}
                  disabled={task.status === "completed" || completingIds.has(task.id)}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    task.status === "completed"
                      ? "border-green-500 bg-green-500"
                      : isOverdue(task)
                      ? "border-red-400"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {task.status === "completed" && <CheckCircle2 className="w-4 h-4 text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm ${task.status === "completed" ? "line-through text-gray-400" : "text-gray-900 dark:text-white"}`}>
                    {task.title}
                  </div>
                  {task.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{task.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {task.dueDate && (
                      <span className={`text-xs flex items-center gap-1 ${isOverdue(task) ? "text-red-500" : "text-gray-400"}`}>
                        {isOverdue(task) ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {formatDue(task.dueDate as any)}
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
                      <span className="text-xs text-gray-400 dark:text-gray-500">{task.assignedTo}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setAddOpen(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-t-3xl w-full p-6 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Task</h2>
              <button onClick={() => setAddOpen(false)} className="text-gray-400 active:opacity-70">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title *</label>
                <input
                  data-testid="input-task-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map(p => (
                    <button
                      key={p}
                      data-testid={`button-priority-${p}`}
                      onClick={() => setNewPriority(p)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-semibold capitalize border transition-colors ${
                        newPriority === p
                          ? p === "urgent" ? "bg-red-600 border-red-600 text-white"
                            : p === "high" ? "bg-orange-500 border-orange-500 text-white"
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
                  type="datetime-local"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes</label>
                <textarea
                  data-testid="input-task-notes"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          </div>
        </div>
      )}
    </div>
  );
}
