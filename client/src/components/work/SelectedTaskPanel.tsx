import { Link } from "wouter";
import { ArrowRight, Pencil, X } from "lucide-react";
import type { Task } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isOverdueTask } from "@/lib/crm-destination-state";
import { taskActionVerb, taskRelatedLinks } from "@/lib/task-presentation";
import { formatBusinessDateTime } from "@shared/business-time";

export type SelectedTaskRead = {
  id: number | null;
  invalid: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: Task;
  refetch: () => unknown;
};

/**
 * The exact task named by `taskId`, read through the actor-scoped single-task
 * authority. It is independent of the list filters, and an unavailable id shows
 * an honest state rather than the nearest or first task.
 */
export function SelectedTaskPanel({ selection, statusLabel, priorityLabel, onClear, onEdit, onAdvance, busy }: {
  selection: SelectedTaskRead;
  statusLabel: (status: string | null) => string;
  priorityLabel: (priority: string | null) => string;
  onClear: () => void;
  onEdit: (task: Task) => void;
  onAdvance: (task: Task) => void;
  busy: boolean;
}) {
  if (!selection.invalid && selection.id === null) return null;

  const clear = (
    <Button size="sm" variant="ghost" className="gap-1 min-h-11 lg:min-h-0" onClick={onClear} data-testid="button-clear-selected-task">
      <X className="w-3 h-3" /> Clear selection
    </Button>
  );

  if (selection.invalid) {
    return (
      <section role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30" data-testid="selected-task-invalid">
        <p className="font-medium">This task link is not valid, so no task is selected.</p>
        <div className="mt-2">{clear}</div>
      </section>
    );
  }

  if (selection.isLoading) {
    return <div role="status" className="rounded-md border p-4 text-sm text-muted-foreground" data-testid="selected-task-loading">Loading task #{selection.id}…</div>;
  }

  if (selection.isError || !selection.data) {
    const message = selection.error instanceof Error ? selection.error.message : "";
    const unavailable = /^(403|404):/.test(message);
    return (
      <section role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30" data-testid="selected-task-unavailable">
        <p className="font-medium">
          {unavailable
            ? `Task #${selection.id} is missing or outside your access.`
            : `Task #${selection.id} could not be loaded.`}
        </p>
        <p className="mt-1 text-muted-foreground">No other task is shown in its place.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!unavailable && <Button size="sm" variant="outline" className="min-h-11 lg:min-h-0" onClick={() => selection.refetch()} data-testid="button-retry-selected-task">Retry</Button>}
          {clear}
        </div>
      </section>
    );
  }

  const task = selection.data;
  const action = taskActionVerb(task.status);
  const overdue = isOverdueTask(task, new Date());
  const links = taskRelatedLinks(task);
  return (
    <section aria-label={`Selected task ${task.id}`} className="rounded-md border border-blue-300 bg-blue-50/40 p-4 space-y-3 dark:bg-blue-950/20" data-testid="selected-task-panel" data-task-id={task.id}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected task #{task.id}</p>
          <h3 className="text-base font-semibold break-words" data-testid="selected-task-title">{task.title || "Untitled task"}</h3>
        </div>
        {clear}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" data-testid="selected-task-status">{statusLabel(task.status)}</Badge>
        <Badge variant="secondary">{priorityLabel(task.priority)}</Badge>
        {overdue && <Badge variant="destructive" data-testid="selected-task-overdue">Overdue</Badge>}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">Due: </dt><dd className="inline" data-testid="selected-task-due">{task.dueDate ? formatBusinessDateTime(task.dueDate, { invalid: "Invalid due date" }) : "No due time"}</dd></div>
        <div><dt className="inline text-muted-foreground">Owner: </dt><dd className="inline" data-testid="selected-task-owner">{task.assignedTo || "Unassigned"}</dd></div>
      </dl>
      {task.description && <p className="text-sm whitespace-pre-wrap break-words" data-testid="selected-task-description">{task.description}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="selected-task-links">
        {links.length === 0 && <span className="text-muted-foreground">No linked records</span>}
        {links.map(link => (
          <Link key={link.kind} href={link.href} className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" data-testid={`selected-task-link-${link.kind}`}>
            Open {link.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {action && (
          <Button size="sm" variant="outline" className="gap-1 min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAdvance(task)} data-testid="button-selected-task-advance">
            <ArrowRight className="w-3 h-3" /> {action.verb}
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1 min-h-11 lg:min-h-0" onClick={() => onEdit(task)} data-testid="button-selected-task-edit">
          <Pencil className="w-3 h-3" /> Edit task
        </Button>
      </div>
    </section>
  );
}
