import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import {
  Phone, CheckSquare, Calendar, ChevronRight, Plus, Zap,
  TrendingUp, Clock, AlertTriangle, User, FileText, Loader2,
} from "lucide-react";
import MobileQuickLog from "./MobileQuickLog";
import type { Task } from "@shared/schema";

function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "completed") return false;
  return new Date() > new Date(task.dueDate);
}

export default function MobileHome() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [quickLogOpen, setQuickLogOpen] = useState(false);

  const { data: tasksData, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: appointmentsData } = useQuery<{ appointments: any[]; configured: boolean }>({
    queryKey: ["/api/appointments"],
    retry: false,
  });

  const { data: contactsData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/contacts"],
    retry: false,
  });

  const { data: dealsData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/deals"],
    retry: false,
  });

  const tasks = tasksData || [];
  const todayTasks = tasks.filter(t => t.status !== "completed" && (isToday(t.dueDate as any) || isOverdue(t)));
  const overdueTasks = todayTasks.filter(isOverdue);
  const appointments = (appointmentsData?.appointments || []).slice(0, 3);
  const activeDeals = (dealsData?.data || []).filter((d: any) => d.stage !== "Closed Won" && d.stage !== "Closed Lost");

  const { executeOrQueue } = useOfflineQueue();
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());

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

  const firstName = user?.firstName || "Rep";

  return (
    <div className="pb-4">
      <div className="bg-blue-600 px-4 pt-12 pb-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}>
        <p className="text-blue-200 text-sm">Good {getGreeting()},</p>
        <h1 className="text-white text-2xl font-bold" data-testid="text-greeting">{firstName}</h1>
        <div className="flex gap-3 mt-4">
          <div className="bg-blue-500/50 rounded-xl p-3 flex-1 text-center">
            <div className="text-white text-xl font-bold" data-testid="text-today-tasks">{todayTasks.length}</div>
            <div className="text-blue-200 text-xs">Tasks Today</div>
          </div>
          <div className="bg-blue-500/50 rounded-xl p-3 flex-1 text-center">
            <div className="text-white text-xl font-bold" data-testid="text-active-deals">{activeDeals.length}</div>
            <div className="text-blue-200 text-xs">Active Deals</div>
          </div>
          <div className="bg-blue-500/50 rounded-xl p-3 flex-1 text-center">
            <div className="text-white text-xl font-bold" data-testid="text-total-contacts">{(contactsData?.total || 0)}</div>
            <div className="text-blue-200 text-xs">Contacts</div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-3">
        <button
          data-testid="button-quick-log"
          onClick={() => setQuickLogOpen(true)}
          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex items-center gap-3 shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="text-left flex-1">
            <div className="font-semibold text-gray-900 dark:text-white text-sm">Quick Log</div>
            <div className="text-gray-500 dark:text-gray-400 text-xs">Log a call, send SMS, create task</div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {overdueTasks.length > 0 && (
        <div className="px-4 mt-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4" data-testid="card-overdue-tasks">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="font-semibold text-red-700 dark:text-red-400 text-sm">{overdueTasks.length} Overdue Task{overdueTasks.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-2">
              {overdueTasks.slice(0, 3).map(task => (
                <div key={task.id} className="flex items-center gap-2">
                  <button
                    onClick={() => completeTask(task.id)}
                    disabled={completingIds.has(task.id)}
                    className="w-5 h-5 rounded-full border-2 border-red-400 flex-shrink-0 active:bg-red-100 disabled:opacity-50"
                  />
                  <span className="text-sm text-red-800 dark:text-red-300 line-clamp-1">{task.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Today's Tasks</h2>
          <button onClick={() => setLocation("/mobile/tasks")} className="text-blue-600 text-xs font-medium">See all</button>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden" data-testid="card-today-tasks">
          {tasksLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : todayTasks.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">
              <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              All caught up!
            </div>
          ) : (
            todayTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  data-testid={`button-complete-task-${task.id}`}
                  onClick={() => completeTask(task.id)}
                  disabled={completingIds.has(task.id)}
                  className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex-shrink-0 active:bg-blue-100 dark:active:bg-blue-900"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">{task.title}</div>
                  {task.dueDate && (
                    <div className={`text-xs ${isOverdue(task) ? "text-red-500" : "text-gray-400"}`}>
                      {formatTime(task.dueDate as any)}
                    </div>
                  )}
                </div>
                {task.priority === "urgent" && (
                  <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full">Urgent</span>
                )}
                {task.priority === "high" && (
                  <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded-full">High</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {appointments.length > 0 && (
        <div className="px-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Upcoming Appointments</h2>
          </div>
          <div className="space-y-2" data-testid="card-appointments">
            {appointments.map((appt: any) => (
              <div key={appt.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 dark:text-white line-clamp-1">{appt.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{appt.contactName}</div>
                  <div className="text-xs text-blue-600 dark:text-blue-400">{formatTime(appt.startTime)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            data-testid="button-view-contacts"
            onClick={() => setLocation("/mobile/contacts")}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <User className="w-6 h-6 text-blue-600" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Contacts</span>
          </button>
          <button
            data-testid="button-view-pipeline"
            onClick={() => setLocation("/mobile/pipeline")}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <TrendingUp className="w-6 h-6 text-purple-600" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Pipeline</span>
          </button>
          <button
            data-testid="button-view-tasks"
            onClick={() => setLocation("/mobile/tasks")}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <CheckSquare className="w-6 h-6 text-green-600" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Tasks</span>
          </button>
          <button
            data-testid="button-open-quick-log-2"
            onClick={() => setQuickLogOpen(true)}
            className="bg-blue-600 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <Phone className="w-6 h-6 text-white" />
            <span className="text-xs font-medium text-white">Log Call</span>
          </button>
        </div>
      </div>

      {/* Switch to desktop */}
      <div className="px-4 mt-6 mb-2 text-center">
        <button
          onClick={() => {
            localStorage.setItem("prefer_desktop", "true");
            window.location.href = "/dashboard";
          }}
          className="text-xs text-gray-400 dark:text-gray-500 underline underline-offset-2 active:opacity-70"
          data-testid="button-switch-to-desktop"
        >
          Switch to desktop view
        </button>
      </div>

      <MobileQuickLog open={quickLogOpen} onClose={() => setQuickLogOpen(false)} />
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
