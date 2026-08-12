/**
 * LogCallSheet — slide-in sheet for reps to log a call recap.
 * Saves to /api/call-logs and optionally creates a Task for the next step.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Phone, CheckCircle, PhoneMissed, Voicemail, CalendarClock, Loader2 } from "lucide-react";

const OUTCOMES = [
  { value: "Connected", label: "Connected", icon: <CheckCircle className="h-3.5 w-3.5 text-green-500" /> },
  { value: "No Answer", label: "No Answer", icon: <PhoneMissed className="h-3.5 w-3.5 text-yellow-500" /> },
  { value: "Left VM", label: "Left Voicemail", icon: <Voicemail className="h-3.5 w-3.5 text-blue-500" /> },
  { value: "Callback Scheduled", label: "Callback Scheduled", icon: <CalendarClock className="h-3.5 w-3.5 text-purple-500" /> },
  { value: "Connected - Interested", label: "Connected – Interested", icon: <CheckCircle className="h-3.5 w-3.5 text-green-500" /> },
  { value: "Connected - Not a Fit", label: "Connected – Not a Fit", icon: <CheckCircle className="h-3.5 w-3.5 text-red-400" /> },
  { value: "Connected - Send Review Summary", label: "Connected – Send Review Summary", icon: <CheckCircle className="h-3.5 w-3.5 text-teal-500" /> },
  { value: "Connected - Needs Proposal", label: "Connected – Needs Proposal", icon: <CheckCircle className="h-3.5 w-3.5 text-indigo-500" /> },
  { value: "No Show", label: "No Show", icon: <PhoneMissed className="h-3.5 w-3.5 text-red-400" /> },
  { value: "Not Now (Nurture)", label: "Not Now (Nurture)", icon: <CalendarClock className="h-3.5 w-3.5 text-gray-400" /> },
];

const NEXT_ACTION_TYPES = ["Call", "Email", "Text", "Meeting", "None"];

interface LogCallSheetProps {
  open: boolean;
  onClose: () => void;
  contactId: number;
  dealId?: number | null;
}

export function LogCallSheet({ open, onClose, contactId, dealId }: LogCallSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [outcome, setOutcome] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [createTask, setCreateTask] = useState(false);
  const [taskType, setTaskType] = useState("Call");
  const [taskDue, setTaskDue] = useState("");
  const [taskNote, setTaskNote] = useState("");

  function reset() {
    setOutcome("");
    setDuration("");
    setNotes("");
    setNextSteps("");
    setCreateTask(false);
    setTaskType("Call");
    setTaskDue("");
    setTaskNote("");
  }

  const logMutation = useMutation({
    mutationFn: async () => {
      // 1. Create call log
      const callRes = await apiRequest("POST", "/api/call-logs", {
        contactId,
        dealId: dealId ?? undefined,
        direction: "outbound",
        outcome,
        duration: duration ? Number(duration) * 60 : undefined, // convert minutes to seconds
        summary: notes || undefined,
        nextSteps: nextSteps || undefined,
      });
      if (!callRes.ok) {
        const body = await callRes.json().catch(() => ({}));
        throw new Error(body.message || "Failed to log call");
      }

      // 2. Optionally create a task for the next step
      if (createTask && taskType !== "None" && (taskNote || nextSteps)) {
        const taskRes = await apiRequest("POST", "/api/tasks", {
          contactId,
          dealId: dealId ?? undefined,
          title: `${taskType}: ${(taskNote || nextSteps).slice(0, 100)}`,
          description: taskNote || nextSteps || undefined,
          dueDate: taskDue ? new Date(taskDue).toISOString() : undefined,
          status: "pending",
          priority: "normal",
        });
        if (!taskRes.ok) {
          console.warn("[LogCallSheet] Task creation failed");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Call logged", description: outcome ? `Outcome: ${outcome}` : undefined });
      reset();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" /> Log Call
          </SheetTitle>
          <SheetDescription>Record what happened on this call</SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Outcome */}
          <div className="space-y-1.5">
            <Label htmlFor="call-outcome">Outcome <span className="text-red-500">*</span></Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger id="call-outcome" data-testid="select-call-outcome">
                <SelectValue placeholder="Select outcome…" />
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-2">
                      {o.icon}
                      {o.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label htmlFor="call-duration">Duration (minutes)</Label>
            <Input
              id="call-duration"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              data-testid="input-call-duration"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="call-notes">Summary / Notes</Label>
            <Textarea
              id="call-notes"
              placeholder="What was discussed?"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="textarea-call-notes"
            />
          </div>

          {/* Next Steps */}
          <div className="space-y-1.5">
            <Label htmlFor="call-next-steps">Next Steps</Label>
            <Textarea
              id="call-next-steps"
              placeholder="What needs to happen next?"
              rows={2}
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              data-testid="textarea-call-next-steps"
            />
          </div>

          {/* Create task toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              id="create-task-toggle"
              type="checkbox"
              checked={createTask}
              onChange={(e) => setCreateTask(e.target.checked)}
              className="h-4 w-4 rounded border-border"
              data-testid="checkbox-create-task"
            />
            <Label htmlFor="create-task-toggle" className="font-normal cursor-pointer">
              Create a follow-up task
            </Label>
          </div>

          {createTask && (
            <div className="pl-6 space-y-3 border-l-2 border-border">
              <div className="space-y-1.5">
                <Label htmlFor="task-type">Action Type</Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger id="task-type" data-testid="select-task-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEXT_ACTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due Date</Label>
                <Input
                  id="task-due"
                  type="datetime-local"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  data-testid="input-task-due"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-note">Reminder Note</Label>
                <Input
                  id="task-note"
                  placeholder="Short reminder…"
                  value={taskNote}
                  onChange={(e) => setTaskNote(e.target.value)}
                  data-testid="input-task-note"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1"
              disabled={!outcome || logMutation.isPending}
              onClick={() => logMutation.mutate()}
              data-testid="button-save-call-log"
            >
              {logMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : (
                "Save Call Log"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => { reset(); onClose(); }}
              data-testid="button-cancel-call-log"
            >
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
