import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import type { Task as TaskType } from "@shared/schema";
import { formatDate } from "./shared";

export function TasksTab({ tasks }: { tasks: TaskType[] }) {
  if (tasks.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No tasks yet</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => (
        <Card key={task.id} data-testid={`card-task-${task.id}`}>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <span className="font-medium" data-testid={`text-task-title-${task.id}`}>
                  {task.title}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={task.status === "completed" ? "default" : "secondary"} data-testid={`badge-task-status-${task.id}`}>
                    {task.status}
                  </Badge>
                  {task.dueDate && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Due {formatDate(task.dueDate)}
                    </span>
                  )}
                </div>
              </div>
              {task.assignedTo && (
                <span className="text-sm text-muted-foreground" data-testid={`text-task-assignee-${task.id}`}>
                  {task.assignedTo}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
