import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import type { Task as TaskType } from "@shared/schema";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWorkCommands, invalidateWorkFacts } from "@/hooks/use-work-commands";
import { useOwnedToast } from "@/hooks/use-owned-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function TaskActions({task}:{task:TaskType}) {
  const commands=useWorkCommands("task");
  const {toast}=useOwnedToast();
  const [editing,setEditing]=useState(false);
  const [title,setTitle]=useState(task.title);
  const [displayed,setDisplayed]=useState(task);
  const state=(task as TaskType&{effectiveState?:string}).effectiveState??task.status;
  const terminal=state==="completed"||state==="cancelled";
  const save=useMutation({
    mutationFn:async(intent:{record:TaskType;fields:Record<string,unknown>})=>{
      const result=await (await apiRequest("PUT",`/api/tasks/${task.id}`,commands.edit(intent.record,intent.fields))).json();
      if(result?.id!==task.id)throw new Error("Task save confirmation did not match this record");
      return result;
    },
    onSuccess:()=>{invalidateWorkFacts();setEditing(false);toast({title:"Task updated"});},
  });
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Dialog open={editing} onOpenChange={open=>{setEditing(open);if(open){setTitle(task.title);setDisplayed(task);save.reset();}}}>
        <DialogTrigger asChild><Button variant="outline" disabled={save.isPending} data-testid={`button-edit-record-task-${task.id}`}>Edit task</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit task #{task.id}</DialogTitle></DialogHeader>
          <Input aria-label="Task title" value={title} onChange={event=>setTitle(event.currentTarget.value)}
            data-testid={`input-record-task-title-${task.id}`} maxLength={500}/>
          {save.isError&&<p role="alert">{save.error.message} Save is not confirmed; reload or retry the unchanged intent.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" data-testid={`button-cancel-record-task-${task.id}`} onClick={()=>setEditing(false)}>Cancel</Button>
            <Button disabled={save.isPending||!title.trim()} onClick={()=>save.mutate({record:displayed,fields:{title:title.trim()}})}
              data-testid={`button-save-record-task-${task.id}`}>{save.isPending?"Saving…":"Save task"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {!terminal&&<Button disabled={save.isPending||!Number.isInteger(task.authorityFence)}
        data-testid={`button-complete-record-task-${task.id}`} onClick={()=>save.mutate({record:task,fields:{status:"completed"}})}>
        {save.isPending?"Saving…":"Complete task"}
      </Button>}
    </div>
    {!editing&&save.isError&&<p role="alert">{save.error.message} Reload to read the current version; no completion is assumed.</p>}
  </div>;
}

export function TasksTab({ tasks }: { tasks: TaskType[] }) {
  if (tasks.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No tasks yet</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => {
        const state = (task as TaskType & { effectiveState?: string }).effectiveState ?? task.status ?? "Unknown";
        return <Card key={task.id} data-testid={`card-task-${task.id}`}>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <span className="font-medium" data-testid={`text-task-title-${task.id}`}>
                  {task.title}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={state === "completed" ? "default" : "secondary"} data-testid={`badge-task-status-${task.id}`}>
                    {state}
                  </Badge>
                  <Badge variant="outline">Priority: {task.priority??"Unknown"}</Badge>
                  {task.dueDate && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Due {new Date(task.dueDate).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </span>
                  )}
                </div>
              </div>
              {task.assignedTo && (
                <span className="text-sm text-muted-foreground" data-testid={`text-task-assignee-${task.id}`}>
                  {task.assignedTo}
                </span>
              )}
              <TaskActions task={task}/>
            </div>
          </CardContent>
        </Card>
      })}
    </div>
  );
}
