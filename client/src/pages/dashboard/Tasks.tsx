import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";

const STATUS_OPTIONS = ["pending", "in_progress", "completed"] as const;
const PRIORITY_OPTIONS = ["normal", "high", "urgent"] as const;

function isOverdue(task: Task): boolean {
  if (!task.dueDate) return false;
  if (task.status === "completed") return false;
  return new Date() > new Date(task.dueDate);
}

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "pending": return "Pending";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    default: return status || "Pending";
  }
}

function getPriorityLabel(priority: string | null): string {
  switch (priority) {
    case "urgent": return "Urgent";
    case "high": return "High";
    case "normal": return "Normal";
    default: return priority || "Normal";
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

export default function Tasks() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

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

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/tasks", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setCreateOpen(false);
      setNewTask({ title: "", description: "", assignedTo: "", dueDate: "", priority: "normal", dealId: "", contactId: "", ticketId: "" });
      toast({ title: "Task created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create task", description: err.message, variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/tasks/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update task", description: err.message, variant: "destructive" });
    },
  });

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/generate-tasks");
      return res.json();
    },
    onSuccess: (data: { generated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: `AI generated ${data.generated} new tasks`, description: "Tasks created based on stalling deals, SLA breaches, and cold leads." });
    },
    onError: (err: Error) => {
      toast({ title: "AI task generation failed", description: err.message, variant: "destructive" });
    },
  });

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
    if (newTask.dueDate) payload.dueDate = new Date(newTask.dueDate).toISOString();
    if (newTask.dealId) payload.dealId = Number(newTask.dealId);
    if (newTask.contactId) payload.contactId = Number(newTask.contactId);
    if (newTask.ticketId) payload.ticketId = Number(newTask.ticketId);
    createTaskMutation.mutate(payload);
  };

  const handleAdvanceStatus = (task: Task) => {
    const next = getNextStatus(task.status);
    if (!next) return;
    const updates: Record<string, unknown> = { status: next };
    if (next === "completed") updates.completedAt = new Date().toISOString();
    updateTaskMutation.mutate({ id: task.id, ...updates });
  };

  const filteredTasks = tasks?.filter((t) => {
    if (filterStatus === "all") return true;
    return t.status === filterStatus;
  }) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="tasks-loading">
        <div className="text-muted-foreground">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="tasks-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold" data-testid="text-tasks-title">Tasks</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{getStatusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-ai-generate-tasks"
            className="gap-2"
            onClick={() => generateTasksMutation.mutate()}
            disabled={generateTasksMutation.isPending}
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
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="Task description..."
                    data-testid="input-task-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Assigned To</Label>
                    <Input
                      value={newTask.assignedTo}
                      onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
                      placeholder="Name"
                      data-testid="input-task-assigned"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input
                      type="datetime-local"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                      data-testid="input-task-duedate"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v })}>
                    <SelectTrigger data-testid="select-task-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p}>{getPriorityLabel(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Deal ID</Label>
                    <Input
                      value={newTask.dealId}
                      onChange={(e) => setNewTask({ ...newTask, dealId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-deal-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contact ID</Label>
                    <Input
                      value={newTask.contactId}
                      onChange={(e) => setNewTask({ ...newTask, contactId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-contact-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ticket ID</Label>
                    <Input
                      value={newTask.ticketId}
                      onChange={(e) => setNewTask({ ...newTask, ticketId: e.target.value })}
                      placeholder="Optional"
                      data-testid="input-task-ticket-id"
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
        </div>
      </div>

      <div className="border rounded-md" data-testid="tasks-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Related</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No tasks found
                </TableCell>
              </TableRow>
            )}
            {filteredTasks.map((task) => {
              const overdue = isOverdue(task);
              const nextStatus = getNextStatus(task.status);
              return (
                <TableRow key={task.id} data-testid={`row-task-${task.id}`}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium" data-testid={`text-task-title-${task.id}`}>{task.title}</div>
                      {task.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1" data-testid={`text-task-desc-${task.id}`}>{task.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-testid={`text-task-assigned-${task.id}`}>
                    {task.assignedTo || "Unassigned"}
                  </TableCell>
                  <TableCell data-testid={`text-task-due-${task.id}`}>
                    <div className="flex items-center gap-2">
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No date"}
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
                  <TableCell data-testid={`text-task-related-${task.id}`}>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {task.dealId && <div>Deal #{task.dealId}</div>}
                      {task.contactId && <div>Contact #{task.contactId}</div>}
                      {task.ticketId && <div>Ticket #{task.ticketId}</div>}
                      {!task.dealId && !task.contactId && !task.ticketId && <span>--</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {nextStatus && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => handleAdvanceStatus(task)}
                        disabled={updateTaskMutation.isPending}
                        data-testid={`button-advance-${task.id}`}
                      >
                        <ArrowRight className="w-3 h-3" />
                        {getStatusLabel(nextStatus)}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
