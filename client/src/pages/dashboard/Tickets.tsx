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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, AlertTriangle, Sparkles, Loader2, Download, Send, Lock, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/export-csv";
import SavedFilterBar from "@/components/SavedFilterBar";
import type { Ticket, Contact, TicketComment } from "@shared/schema";
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

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatTimestamp(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TicketConversation({ ticket }: { ticket: Ticket }) {
  const { toast } = useToast();
  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const { data: comments, isLoading: commentsLoading } = useQuery<TicketComment[]>({
    queryKey: ["/api/tickets", ticket.id, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticket.id}/comments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (data: { content: string; isInternal: boolean }) => {
      const res = await apiRequest("POST", `/api/tickets/${ticket.id}/comments`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticket.id, "comments"] });
      setReplyContent("");
      toast({ title: "Reply added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add reply", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmitReply = () => {
    if (!replyContent.trim()) return;
    addCommentMutation.mutate({ content: replyContent.trim(), isInternal });
  };

  return (
    <div className="space-y-4" data-testid="ticket-conversation">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">Conversation</h4>
        <Badge variant="secondary" className="text-xs no-default-hover-elevate" data-testid="badge-comment-count">
          {comments?.length ?? 0}
        </Badge>
      </div>

      <div className="space-y-3 max-h-64 overflow-y-auto pr-1" data-testid="conversation-thread">
        {commentsLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading conversation...
          </div>
        ) : !comments || comments.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-no-comments">
            No replies yet. Start the conversation below.
          </div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className={`flex gap-3 ${comment.isInternal ? "opacity-80" : ""}`}
              data-testid={`comment-${comment.id}`}
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs" data-testid={`avatar-comment-${comment.id}`}>
                  {getInitials(comment.authorName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" data-testid={`text-comment-author-${comment.id}`}>
                    {comment.authorName || "Unknown"}
                  </span>
                  <span className="text-xs text-muted-foreground" data-testid={`text-comment-time-${comment.id}`}>
                    {formatTimestamp(comment.createdAt)}
                  </span>
                  {comment.isInternal ? (
                    <Badge variant="outline" className="text-xs gap-1 no-default-hover-elevate" data-testid={`badge-internal-${comment.id}`}>
                      <Lock className="w-3 h-3" />
                      Internal
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs gap-1 no-default-hover-elevate" data-testid={`badge-external-${comment.id}`}>
                      <Globe className="w-3 h-3" />
                      External
                    </Badge>
                  )}
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap" data-testid={`text-comment-content-${comment.id}`}>
                  {comment.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <Separator />

      <div className="space-y-3" data-testid="reply-form">
        <Textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          placeholder={isInternal ? "Add an internal note..." : "Type your reply..."}
          className="resize-none"
          data-testid="input-reply-content"
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch
              checked={isInternal}
              onCheckedChange={setIsInternal}
              data-testid="switch-internal-note"
            />
            <Label className="text-sm cursor-pointer" data-testid="label-internal-note">
              {isInternal ? "Internal note" : "External reply"}
            </Label>
            {isInternal && (
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
          <Button
            onClick={handleSubmitReply}
            disabled={!replyContent.trim() || addCommentMutation.isPending}
            className="gap-2"
            data-testid="button-submit-reply"
          >
            {addCommentMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isInternal ? "Add Note" : "Send Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
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
  const [aiResult, setAiResult] = useState<{category: string; priority: string; suggestedResponse: string; tags: string[]; estimatedResolutionHours: number} | null>(null);

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
      toast({ title: "Ticket updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update ticket", description: err.message, variant: "destructive" });
    },
  });

  const classifyMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      const res = await apiRequest("POST", "/api/ai/classify-ticket", { ticketId });
      return res.json();
    },
    onSuccess: (data) => {
      setAiResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket classified by AI", description: `Category: ${data.category}, Priority: ${data.priority}` });
    },
    onError: (err: Error) => {
      toast({ title: "AI classification failed", description: err.message, variant: "destructive" });
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
    if (editStatus === "Resolved" && selectedTicket.status !== "Resolved") {
      updates.resolvedAt = new Date().toISOString();
    }
    if (Object.keys(updates).length === 0) {
      return;
    }
    updateTicketMutation.mutate({ id: selectedTicket.id, ...updates });
  };

  const openTicketDetail = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status || "New Ticket");
    setEditAssignedTo(ticket.assignedTo || "");
    setAiResult(null);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6" data-testid="tickets-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold" data-testid="text-tickets-title">Support Tickets</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const exportData = (tickets || []).map(t => ({
                subject: t.subject,
                status: t.status || "",
                priority: t.priority || "",
                category: t.category || "",
                assignedTo: t.assignedTo || "",
                createdAt: t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "",
              }));
              exportToCSV(exportData, "tickets", [
                { key: "subject", label: "Subject" },
                { key: "status", label: "Status" },
                { key: "priority", label: "Priority" },
                { key: "category", label: "Category" },
                { key: "assignedTo", label: "Assigned To" },
                { key: "createdAt", label: "Created At" },
              ]);
            }}
            data-testid="button-export-tickets"
          >
            <Download className="w-4 h-4 mr-1" /> Export Tickets
          </Button>
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
      </div>

      <SavedFilterBar
        entityType="ticket"
        currentFilters={{}}
        onApplyFilter={() => {}}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table data-testid="table-tickets" className="min-w-[700px]">
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-ticket-detail">
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

              <div className="border-t pt-3 space-y-3">
                <Button
                  variant="outline"
                  className="gap-2 w-full"
                  onClick={() => classifyMutation.mutate(selectedTicket.id)}
                  disabled={classifyMutation.isPending}
                  data-testid="button-ai-classify-ticket"
                >
                  {classifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  AI Classify & Suggest Response
                </Button>
                {aiResult && (
                  <Card>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium">AI Analysis</span>
                        <Badge variant="outline" className="text-xs no-default-hover-elevate">{aiResult.estimatedResolutionHours}h est.</Badge>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {aiResult.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs no-default-hover-elevate">{tag}</Badge>
                        ))}
                      </div>
                      <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                        <div className="font-medium text-xs mb-1">Suggested Response:</div>
                        {aiResult.suggestedResponse}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
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
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDetailOpen(false)} data-testid="button-cancel-ticket-edit">
                  Cancel
                </Button>
                <Button onClick={handleUpdateTicket} disabled={updateTicketMutation.isPending} data-testid="button-save-ticket">
                  {updateTicketMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>

              <Separator />

              <TicketConversation ticket={selectedTicket} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}