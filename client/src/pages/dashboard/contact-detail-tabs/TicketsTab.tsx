import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Ticket as TicketType } from "@shared/schema";
import { formatDate, priorityVariant } from "./shared";

export function TicketsTab({ tickets }: { tickets: TicketType[] }) {
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
              <span className="text-sm text-muted-foreground">
                {formatDate(ticket.createdAt)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
