/**
 * NextStepsWidget — sticky bottom bar on desktop / bottom-sheet trigger on mobile.
 * Lets reps quickly set the next action type, scheduled datetime, and a reminder note.
 * Saves directly to the Tasks table via POST /api/tasks.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ChevronUp, Loader2, CalendarClock, CheckCircle2, X } from "lucide-react";

const ACTION_TYPES = ["Call", "Email", "Text", "Meeting"];

interface NextStepsWidgetProps {
  contactId: number;
  dealId?: number | null;
  /** The current next follow-up date from the deal (ISO string) */
  nextFollowUp?: string | null;
  /** Whether to show the widget */
  visible?: boolean;
}

interface WidgetFormProps {
  contactId: number;
  dealId?: number | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function WidgetForm({ contactId, dealId, onSuccess, onCancel }: WidgetFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState("Call");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!dueDate) throw new Error("Please set a date/time");
      const res = await apiRequest("POST", "/api/tasks", {
        contactId,
        dealId: dealId ?? undefined,
        title: `${actionType}${note ? `: ${note.slice(0, 80)}` : ""}`,
        description: note || undefined,
        dueDate: new Date(dueDate).toISOString(),
        status: "pending",
        priority: "normal",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to create task");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      toast({ title: "Next step scheduled", description: `${actionType} scheduled` });
      setActionType("Call");
      setDueDate("");
      setNote("");
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to schedule", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {/* Action type */}
        <div className="flex-1 min-w-[120px] space-y-1">
          <Label className="text-xs">Action</Label>
          <Select value={actionType} onValueChange={setActionType}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-next-action-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* DateTime */}
        <div className="flex-1 min-w-[160px] space-y-1">
          <Label className="text-xs">When</Label>
          <Input
            type="datetime-local"
            className="h-8 text-sm"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            data-testid="input-next-step-datetime"
          />
        </div>

        {/* Note */}
        <div className="flex-[2] min-w-[160px] space-y-1">
          <Label className="text-xs">Note (optional)</Label>
          <Input
            placeholder="Short reminder…"
            className="h-8 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="input-next-step-note"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!dueDate || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="flex-1"
          data-testid="button-save-next-step"
        >
          {createMutation.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</>
          ) : (
            <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Set Next Step</>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-cancel-next-step">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function NextStepsWidget({ contactId, dealId, nextFollowUp, visible = true }: NextStepsWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!visible) return null;

  return (
    <>
      {/* Desktop: sticky bottom bar */}
      <div
        className="hidden sm:block fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border shadow-md"
        data-testid="next-steps-widget"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-2">
          {nextFollowUp && !expanded && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CalendarClock className="h-3.5 w-3.5 text-green-500" />
              Next follow-up:{" "}
              <span className="font-medium text-foreground">
                {new Date(nextFollowUp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}

          {expanded ? (
            <WidgetForm
              contactId={contactId}
              dealId={dealId}
              onSuccess={() => setExpanded(false)}
              onCancel={() => setExpanded(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(true)}
              className="w-full sm:w-auto"
              data-testid="button-open-next-steps"
            >
              <ChevronUp className="h-3.5 w-3.5 mr-1.5" />
              Set Next Step
            </Button>
          )}
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <div className="sm:hidden fixed bottom-16 right-4 z-30" data-testid="next-steps-widget-mobile">
        <Button
          size="sm"
          onClick={() => setSheetOpen(true)}
          className="rounded-full shadow-lg"
          data-testid="button-open-next-steps-mobile"
        >
          <CalendarClock className="h-4 w-4 mr-1.5" />
          Next Step
        </Button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="pb-safe">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Set Next Step
            </SheetTitle>
          </SheetHeader>
          <WidgetForm
            contactId={contactId}
            dealId={dealId}
            onSuccess={() => setSheetOpen(false)}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
