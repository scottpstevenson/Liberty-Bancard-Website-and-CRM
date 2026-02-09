import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Ticket, Contact } from "@shared/schema";
import { TICKET_CATEGORIES, SUPPORT_STAGES } from "@shared/schema";

function getPriorityVariant(priority: string | null): "destructive" | "secondary" {
  return priority === "Urgent" ? "destructive" : "secondary";
}

function getStatusClasses(status: string | null): string {
  switch (status) {
    case "In Progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "Waiting on Merchant": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "Resolved": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "Closed": return "bg-muted text-muted-foreground";
    default: return "";
  }
}

function isSlaBreached(ticket: Ticket): boolean {
  if (!ticket.slaDeadline) return false;
  if (ticket.status === "Resolved" || ticket.status === "Closed") return false;
  return new Date() > new Date(ticket.slaDeadline);
}

export default function Tickets() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [newTicket, setNewTicket] = useState({
    contactId: "",
    subject: "",
    description: "",
    category: "Other",
    priority: "Normal",
  });

  const [editStatus, setEditStatus] = useState("");
  const [editAssignedTo, setEditAssignedTo] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const { data: tickets, isLoading } = useQuery<Ticket[]>({
    queryKey: ["/api/tickets"],
    queryFn: async () => {
      const res = await fetch("/api/tickets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/tickets", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCreateOpen(false);
      setNewTicket({ contactId: "", subject: "", description: "", category: "Other", priority: "Normal" });
      toast({ title: "Ticket created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create ticket", description: err.message, variant: "destructive" });
    },
  });

  const updateTicketMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/tickets/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setDetailOpen(false);
      setSelectedTicket(null);
      toast({ title: "Ticket updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update ticket", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateTicket = () => {
    if (!newTicket.subject || !newTicket.description) {
      toast({ title: "Subject and description are required", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      subject: newTicket.subject,
      description: newTicket.description,
      category: newTicket.category,
      priority: newTicket.priority,
    };
    if (newTicket.contactId) {
      payload.contactId = Number(newTicket.contactId);
    }
    createTicketMutation.mutate(payload);
  };

  const handleUpdateTicket = () => {
    if (!selectedTicket) return;
    const updates: Record<string, unknown> = {};
    if (editStatus && editStatus !== selectedTicket.status) updates.status = editStatus;
    if (editAssignedTo !== (selectedTicket.assignedTo || "")) updates.assignedTo = editAssignedTo || null;
    if (editNotes) updates.description = `${selectedTicket.description}\n\n---\nUpdate: ${editNotes}`;
    if (editStatus === "Resolved" && selectedTicket.status !== "Resolved") {
      updates.resolvedAt = new Date().toISOString();
    }
    if (Object.keys(updates).length === 0) {
      setDetailOpen(false);
      return;
    }
    updateTicketMutation.mutate({ id: selectedTicket.id, ...updates });
  };

  const openTicketDetail = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status || "New Ticket");
    setEditAssignedTo(ticket.assignedTo || "");
    setEditNotes("");
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6" data-testid="tickets-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold" data-testid="text-tickets-title">Support Tickets</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-ticket" className="gap-2">
              <Plus className="w-4 h-4" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-create-ticket">
            <DialogHeader>
              <DialogTitle>Create Support Ticket</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select value={newTicket.contactId} onValueChange={(v) => setNewTicket({ ...newTicket, contactId: v })}>
                  <SelectTrigger data-testid="select-ticket-contact">
                    <SelectValue placeholder="Select a contact (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.firstName} {c.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  placeholder="Ticket subject"
                  data-testid="input-ticket-subject"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  placeholder="Describe the issue..."
                  data-testid="input-ticket-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={newTicket.category} onValueChange={(v) => setNewTicket({ ...newTicket, category: v })}>
                    <SelectTrigger data-testid="select-ticket-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TICKET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={newTicket.priority} onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}>
                    <SelectTrigger data-testid="select-ticket-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Normal">Normal</SelectItem>
                      <SelectItem value="Urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-ticket">
                  Cancel
                </Button>
                <Button onClick={handleCreateTicket} disabled={createTicketMutation.isPending} data-testid="button-submit-ticket">
                  {createTicketMutation.isPending ? "Creating..." : "Create Ticket"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table data-testid="table-tickets">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SLA Deadline</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">Loading tickets...</TableCell>
                </TableRow>
              ) : !tickets || tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">No tickets found</TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer"
                    onClick={() => openTicketDetail(ticket)}
                    data-testid={`row-ticket-${ticket.id}`}
                  >
                    <TableCell className="font-medium" data-testid={`text-ticket-id-${ticket.id}`}>#{ticket.id}</TableCell>
                    <TableCell data-testid={`text-ticket-subject-${ticket.id}`}>{ticket.subject}</TableCell>
                    <TableCell data-testid={`text-ticket-category-${ticket.id}`}>{ticket.category}</TableCell>
                    <TableCell>
                      <Badge variant={getPriorityVariant(ticket.priority)} data-testid={`badge-priority-${ticket.id}`}>
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getStatusClasses(ticket.status)}`} data-testid={`badge-status-${ticket.id}`}>
                        {ticket.status}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-ticket-sla-${ticket.id}`}>
                      <div className="flex items-center gap-2">
                        {ticket.slaDeadline ? new Date(ticket.slaDeadline).toLocaleString() : "N/A"}
                        {isSlaBreached(ticket) && (
                          <Badge variant="destructive" className="text-xs gap-1" data-testid={`badge-sla-breached-${ticket.id}`}>
                            <AlertTriangle className="w-3 h-3" />
                            SLA Breached
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-ticket-created-${ticket.id}`}>
                      {ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : "N/A"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-ticket-detail">
          <DialogHeader>
            <DialogTitle>Ticket #{selectedTicket?.id}</DialogTitle>
          </DialogHeader>
          {selectedTicket && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Subject</div>
                <div className="font-medium" data-testid="text-detail-subject">{selectedTicket.subject}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Description</div>
                <div className="text-sm whitespace-pre-wrap" data-testid="text-detail-description">{selectedTicket.description}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <div className="font-medium" data-testid="text-detail-category">{selectedTicket.category}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <div>
                    <Badge variant={getPriorityVariant(selectedTicket.priority)} data-testid="badge-detail-priority">
                      {selectedTicket.priority}
                    </Badge>
                  </div>
                </div>
              </div>

              {isSlaBreached(selectedTicket) && (
                <Badge variant="destructive" className="gap-1" data-testid="badge-detail-sla-breached">
                  <AlertTriangle className="w-3 h-3" />
                  SLA Breached
                </Badge>
              )}

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Assigned To</Label>
                <Input
                  value={editAssignedTo}
                  onChange={(e) => setEditAssignedTo(e.target.value)}
                  placeholder="Assign to..."
                  data-testid="input-edit-assigned-to"
                />
              </div>

              <div className="space-y-2">
                <Label>Add Note</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add a note..."
                  data-testid="input-edit-ticket-notes"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDetailOpen(false)} data-testid="button-cancel-ticket-edit">
                  Cancel
                </Button>
                <Button onClick={handleUpdateTicket} disabled={updateTicketMutation.isPending} data-testid="button-save-ticket">
                  {updateTicketMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}