import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { Ticket as TicketType } from "@shared/schema";
import { formatDate, priorityVariant } from "./shared";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function TicketsTab({ tickets, contactId }: { tickets: TicketType[]; contactId?: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [escalatingId, setEscalatingId] = useState<number | null>(null);

  // #401 — Escalate ticket to admin (set priority = "Urgent")
  const escalateMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      await apiRequest("PUT", `/api/tickets/${ticketId}`, { priority: "Urgent" });
    },
    onSuccess: () => {
      toast({ title: "Ticket escalated", description: "Priority set to Urgent." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setEscalatingId(null);
    },
    onError: () => {
      toast({ title: "Escalation failed", variant: "destructive" });
      setEscalatingId(null);
    },
  });

  if (tickets.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No tickets yet</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {tickets.map(ticket => (
        <Card key={ticket.id} data-testid={`card-ticket-${ticket.id}`}>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <span className="font-medium" data-testid={`text-ticket-subject-${ticket.id}`}>
                  {ticket.subject}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={priorityVariant(ticket.priority)} data-testid={`badge-ticket-priority-${ticket.id}`}>
                    {ticket.priority}
                  </Badge>
                  <Badge variant="outline" data-testid={`badge-ticket-status-${ticket.id}`}>
                    {ticket.status}
                  </Badge>
                  {ticket.category && (
                    <Badge variant="secondary" data-testid={`badge-ticket-category-${ticket.id}`}>
                      {ticket.category}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {formatDate(ticket.createdAt)}
                </span>
                {/* #401 — Escalate to Urgent */}
                {ticket.priority !== "Urgent" && ticket.status !== "Closed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
                    disabled={escalatingId === ticket.id || escalateMutation.isPending}
                    onClick={() => { setEscalatingId(ticket.id); escalateMutation.mutate(ticket.id); }}
                    data-testid={`button-escalate-ticket-${ticket.id}`}
                  >
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Escalate
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
