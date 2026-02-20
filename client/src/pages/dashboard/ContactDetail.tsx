import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpdateContact } from "@/hooks/use-contacts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Deal, Ticket as TicketType, Task as TaskType, Note } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Edit2, Save, X, Plus, StickyNote, TrendingUp, CheckSquare,
  Ticket, Mail, Phone, Building2, UserPlus, MessageSquare, Zap,
  AlertTriangle, Sparkles, Activity, ArrowRight, Clock,
} from "lucide-react";

interface ActivityEvent {
  id: string;
  type: string;
  action: string;
  entityType: string;
  entityId: number;
  details: Record<string, string>;
  createdAt: string;
}

interface ContactDetailData {
  contact: Contact;
  deals: Deal[];
  tickets: TicketType[];
  tasks: TaskType[];
  notes: Note[];
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  if (diffWeek < 5) return `${diffWeek} week${diffWeek !== 1 ? "s" : ""} ago`;
  return `${diffMonth} month${diffMonth !== 1 ? "s" : ""} ago`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString();
}

function getActionMeta(event: ActivityEvent): { icon: typeof Activity; label: string } {
  if (event.type === "ghl") {
    if (event.action === "email") {
      const dir = event.details?.direction === "inbound" ? "Received" : "Sent";
      return { icon: Mail, label: `Email ${dir}` };
    }
    if (event.action === "sms") {
      const dir = event.details?.direction === "inbound" ? "Received" : "Sent";
      return { icon: MessageSquare, label: `SMS ${dir}` };
    }
  }
  switch (event.action) {
    case "contact_created": return { icon: UserPlus, label: "Contact Created" };
    case "deal_created": return { icon: TrendingUp, label: "Deal Created" };
    case "deal_updated":
    case "deal_auto_progressed": return { icon: ArrowRight, label: "Deal Updated" };
    case "ticket_created": return { icon: Ticket, label: "Ticket Created" };
    case "ticket_ai_classified": return { icon: Sparkles, label: "AI Classified" };
    case "sla_breach": return { icon: AlertTriangle, label: "SLA Breach" };
    case "workflow_triggered": return { icon: Zap, label: "Workflow Triggered" };
    default: return { icon: Activity, label: event.action };
  }
}

function getDetailText(event: ActivityEvent): string | null {
  if (!event.details) return null;
  if (event.details.subject) return event.details.subject;
  if (event.details.name) return event.details.name;
  if (event.details.stageName) return `Stage: ${event.details.stageName}`;
  if (event.details.category) return event.details.category;
  return null;
}

function statusColor(status: string | null | undefined): string {
  switch (status?.toLowerCase()) {
    case "new": return "default";
    case "active":
    case "qualified": return "default";
    case "won":
    case "closed": return "default";
    default: return "secondary";
  }
}

function priorityVariant(priority: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (priority?.toLowerCase()) {
    case "urgent": return "destructive";
    case "high": return "destructive";
    case "normal": return "default";
    case "low": return "secondary";
    default: return "outline";
  }
}

export default function ContactDetail() {
  const params = useParams<{ id: string }>();
  const contactId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateContact = useUpdateContact();

  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Contact>>({});
  const [tagInput, setTagInput] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const [showDealDialog, setShowDealDialog] = useState(false);
  const [dealForm, setDealForm] = useState({ pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });

  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: "", description: "", priority: "Normal", category: "Other" });

  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", dueDate: "" });

  const { data, isLoading, error } = useQuery<ContactDetailData>({
    queryKey: ["/api/contacts", contactId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contact details");
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: activityEvents } = useQuery<ActivityEvent[]>({
    queryKey: ["/api/contacts", contactId, "activity"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/activity`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: notesList } = useQuery<Note[]>({
    queryKey: ["/api/notes", "contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/notes?entityType=contact&entityId=${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6" data-testid="contact-detail-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (error || !data?.contact) {
    return (
      <div className="p-4 md:p-6 space-y-4" data-testid="contact-detail-error">
        <Button variant="ghost" onClick={() => setLocation("/dashboard/contacts")} data-testid="button-back-error">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Contacts
        </Button>
        <p className="text-muted-foreground">Contact not found.</p>
      </div>
    );
  }

  const { contact, deals, tickets, tasks, notes: detailNotes } = data;
  const allNotes = notesList ?? detailNotes ?? [];
  const sortedNotes = [...allNotes].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

  const openTickets = tickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
  const pendingTasks = tasks.filter(t => t.status === "pending");

  const startEdit = () => {
    setEditFields({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      companyName: contact.companyName,
      vertical: contact.vertical,
      monthlyVolume: contact.monthlyVolume,
      currentProvider: contact.currentProvider,
      preferredChannel: contact.preferredChannel,
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    try {
      await updateContact.mutateAsync({ id: contactId, ...editFields });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setIsEditing(false);
      toast({ title: "Contact updated" });
    } catch {
      toast({ title: "Failed to update contact", variant: "destructive" });
    }
  };

  const addTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    const currentTags = contact.tags ?? [];
    if (currentTags.includes(tag)) { setTagInput(""); return; }
    try {
      await updateContact.mutateAsync({ id: contactId, tags: [...currentTags, tag] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setTagInput("");
    } catch {
      toast({ title: "Failed to add tag", variant: "destructive" });
    }
  };

  const removeTag = async (tag: string) => {
    const currentTags = contact.tags ?? [];
    try {
      await updateContact.mutateAsync({ id: contactId, tags: currentTags.filter(t => t !== tag) });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
    } catch {
      toast({ title: "Failed to remove tag", variant: "destructive" });
    }
  };

  const addNote = async () => {
    if (!noteContent.trim()) return;
    try {
      await apiRequest("POST", "/api/notes", {
        entityType: "contact",
        entityId: contactId,
        content: noteContent.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", "contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setNoteContent("");
      toast({ title: "Note added" });
    } catch {
      toast({ title: "Failed to add note", variant: "destructive" });
    }
  };

  const createDeal = async () => {
    try {
      await apiRequest("POST", "/api/deals", {
        contactId,
        pipeline: dealForm.pipeline,
        stage: dealForm.stage,
        offerPath: dealForm.offerPath || undefined,
        notes: dealForm.notes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setShowDealDialog(false);
      setDealForm({ pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });
      toast({ title: "Deal created" });
    } catch {
      toast({ title: "Failed to create deal", variant: "destructive" });
    }
  };

  const createTicket = async () => {
    if (!ticketForm.subject || !ticketForm.description) return;
    try {
      await apiRequest("POST", "/api/tickets", {
        contactId,
        subject: ticketForm.subject,
        description: ticketForm.description,
        priority: ticketForm.priority,
        category: ticketForm.category,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setShowTicketDialog(false);
      setTicketForm({ subject: "", description: "", priority: "Normal", category: "Other" });
      toast({ title: "Ticket created" });
    } catch {
      toast({ title: "Failed to create ticket", variant: "destructive" });
    }
  };

  const createTask = async () => {
    if (!taskForm.title) return;
    try {
      await apiRequest("POST", "/api/tasks", {
        contactId,
        title: taskForm.title,
        description: taskForm.description || undefined,
        dueDate: taskForm.dueDate ? new Date(taskForm.dueDate).toISOString() : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      setShowTaskDialog(false);
      setTaskForm({ title: "", description: "", dueDate: "" });
      toast({ title: "Task created" });
    } catch {
      toast({ title: "Failed to create task", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto" data-testid="contact-detail-page">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Button variant="ghost" className="self-start" onClick={() => setLocation("/dashboard/contacts")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Contacts
        </Button>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1">
            {isEditing ? (
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  value={editFields.firstName ?? ""}
                  onChange={e => setEditFields(p => ({ ...p, firstName: e.target.value }))}
                  className="w-36"
                  data-testid="input-edit-firstname"
                />
                <Input
                  value={editFields.lastName ?? ""}
                  onChange={e => setEditFields(p => ({ ...p, lastName: e.target.value }))}
                  className="w-36"
                  data-testid="input-edit-lastname"
                />
              </div>
            ) : (
              <h1 className="text-2xl font-bold" data-testid="text-contact-name">
                {contact.firstName} {contact.lastName}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {contact.companyName && (
                <span className="flex items-center gap-1" data-testid="text-company">
                  <Building2 className="h-3.5 w-3.5" /> {isEditing ? (
                    <Input
                      value={editFields.companyName ?? ""}
                      onChange={e => setEditFields(p => ({ ...p, companyName: e.target.value }))}
                      className="w-40"
                      data-testid="input-edit-company"
                    />
                  ) : contact.companyName}
                </span>
              )}
              {contact.email && (
                <span className="flex items-center gap-1" data-testid="text-email">
                  <Mail className="h-3.5 w-3.5" /> {isEditing ? (
                    <Input
                      value={editFields.email ?? ""}
                      onChange={e => setEditFields(p => ({ ...p, email: e.target.value }))}
                      className="w-48"
                      data-testid="input-edit-email"
                    />
                  ) : contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1" data-testid="text-phone">
                  <Phone className="h-3.5 w-3.5" /> {isEditing ? (
                    <Input
                      value={editFields.phone ?? ""}
                      onChange={e => setEditFields(p => ({ ...p, phone: e.target.value }))}
                      className="w-40"
                      data-testid="input-edit-phone"
                    />
                  ) : contact.phone}
                </span>
              )}
              <Badge variant={statusColor(contact.status) as any} data-testid="badge-status">
                {contact.status}
              </Badge>
            </div>
          </div>

          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button onClick={saveEdit} disabled={updateContact.isPending} data-testid="button-save-edit">
                  <Save className="h-4 w-4 mr-1" /> Save
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={startEdit} data-testid="button-edit">
                <Edit2 className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tags */}
      <Card data-testid="section-tags">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground mr-1">Tags:</span>
            {(contact.tags ?? []).map(tag => (
              <Badge key={tag} variant="secondary" className="gap-1" data-testid={`badge-tag-${tag}`}>
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="ml-0.5 hover:text-destructive"
                  data-testid={`button-remove-tag-${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <form
              className="flex gap-1"
              onSubmit={e => { e.preventDefault(); addTag(); }}
            >
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                placeholder="Add tag..."
                className="w-28"
                data-testid="input-add-tag"
              />
              <Button type="submit" size="sm" variant="outline" data-testid="button-add-tag">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2" data-testid="section-quick-actions">
        <Button variant="outline" onClick={() => { setActiveTab("notes"); }} data-testid="button-add-note">
          <StickyNote className="h-4 w-4 mr-1" /> Add Note
        </Button>
        <Button variant="outline" onClick={() => setShowDealDialog(true)} data-testid="button-create-deal">
          <TrendingUp className="h-4 w-4 mr-1" /> Create Deal
        </Button>
        <Button variant="outline" onClick={() => setShowTaskDialog(true)} data-testid="button-create-task">
          <CheckSquare className="h-4 w-4 mr-1" /> Create Task
        </Button>
        <Button variant="outline" onClick={() => setShowTicketDialog(true)} data-testid="button-create-ticket">
          <Ticket className="h-4 w-4 mr-1" /> Create Ticket
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="contact-tabs">
        <TabsList className="flex flex-wrap gap-1" data-testid="contact-tabs-list">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="deals" data-testid="tab-deals">Deals ({deals.length})</TabsTrigger>
          <TabsTrigger value="tickets" data-testid="tab-tickets">Tickets ({tickets.length})</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">Notes ({sortedNotes.length})</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" data-testid="tab-content-overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <DetailRow label="Vertical" value={contact.vertical} />
                <DetailRow label="Monthly Volume" value={contact.monthlyVolume} />
                <DetailRow label="Current Provider" value={contact.currentProvider} />
                <DetailRow label="Preferred Channel" value={contact.preferredChannel} />
                <DetailRow label="Primary Offer Path" value={contact.primaryOfferPath} />
                <DetailRow label="Interested in 0%" value={contact.interestedIn0Percent ? "Yes" : "No"} />
                <DetailRow label="Needs Terminal" value={contact.needTerminal ? "Yes" : "No"} />
                <DetailRow label="SMS Consent" value={contact.consentSms ? "Yes" : "No"} />
                <DetailRow label="Email Consent" value={contact.consentEmail ? "Yes" : "No"} />
                <DetailRow label="Do Not Contact" value={contact.doNotContact ? "Yes" : "No"} />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Deals</span>
                    <span className="font-medium" data-testid="text-deal-count">{deals.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open Tickets</span>
                    <span className="font-medium" data-testid="text-open-tickets">{openTickets.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pending Tasks</span>
                    <span className="font-medium" data-testid="text-pending-tasks">{pendingTasks.length}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">UTM &amp; Lead Source</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <DetailRow label="UTM Source" value={contact.utmSource} />
                  <DetailRow label="UTM Medium" value={contact.utmMedium} />
                  <DetailRow label="UTM Campaign" value={contact.utmCampaign} />
                  <DetailRow label="UTM Content" value={contact.utmContent} />
                  <DetailRow label="UTM Term" value={contact.utmTerm} />
                  <DetailRow label="Landing Page" value={contact.landingPage} />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Deals Tab */}
        <TabsContent value="deals" data-testid="tab-content-deals">
          {deals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No deals yet</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {deals.map(deal => (
                <Card
                  key={deal.id}
                  className="hover-elevate cursor-pointer"
                  onClick={() => setLocation("/dashboard/pipeline")}
                  data-testid={`card-deal-${deal.id}`}
                >
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium" data-testid={`text-deal-pipeline-${deal.id}`}>
                            {deal.pipeline}
                          </span>
                          <Badge variant="outline" data-testid={`badge-deal-stage-${deal.id}`}>
                            {deal.stage}
                          </Badge>
                        </div>
                        {deal.offerPath && (
                          <p className="text-sm text-muted-foreground" data-testid={`text-deal-offer-${deal.id}`}>
                            Offer: {deal.offerPath}
                          </p>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
                        Created {formatDate(deal.createdAt as any)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets" data-testid="tab-content-tickets">
          {tickets.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No tickets yet</CardContent></Card>
          ) : (
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
                        {formatDate(ticket.createdAt as any)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" data-testid="tab-content-tasks">
          {tasks.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No tasks yet</CardContent></Card>
          ) : (
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
                              <Clock className="h-3 w-3" /> Due {formatDate(task.dueDate as any)}
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
          )}
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" data-testid="tab-content-notes">
          <Card className="mb-4">
            <CardContent className="pt-4 pb-4">
              <div className="space-y-2">
                <Textarea
                  value={noteContent}
                  onChange={e => setNoteContent(e.target.value)}
                  placeholder="Write a note..."
                  rows={3}
                  data-testid="textarea-add-note"
                />
                <Button onClick={addNote} disabled={!noteContent.trim()} data-testid="button-submit-note">
                  <Plus className="h-4 w-4 mr-1" /> Add Note
                </Button>
              </div>
            </CardContent>
          </Card>

          {sortedNotes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No notes yet</p>
          ) : (
            <div className="space-y-3">
              {sortedNotes.map(note => (
                <Card key={note.id} data-testid={`card-note-${note.id}`}>
                  <CardContent className="py-4">
                    <p className="text-sm whitespace-pre-wrap" data-testid={`text-note-content-${note.id}`}>
                      {note.content}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                      {note.authorName && (
                        <span data-testid={`text-note-author-${note.id}`}>{note.authorName}</span>
                      )}
                      <span data-testid={`text-note-time-${note.id}`}>
                        {formatRelativeTime(note.createdAt as any)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" data-testid="tab-content-activity">
          <ActivityTimelineFull events={activityEvents ?? []} />
        </TabsContent>
      </Tabs>

      {/* Create Deal Dialog */}
      <Dialog open={showDealDialog} onOpenChange={setShowDealDialog}>
        <DialogContent data-testid="dialog-create-deal">
          <DialogHeader>
            <DialogTitle>Create Deal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Pipeline</label>
              <Select value={dealForm.pipeline} onValueChange={v => setDealForm(p => ({ ...p, pipeline: v }))}>
                <SelectTrigger data-testid="select-deal-pipeline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="retention">Retention</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Stage</label>
              <Input
                value={dealForm.stage}
                onChange={e => setDealForm(p => ({ ...p, stage: e.target.value }))}
                data-testid="input-deal-stage"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Offer Path</label>
              <Input
                value={dealForm.offerPath}
                onChange={e => setDealForm(p => ({ ...p, offerPath: e.target.value }))}
                placeholder="e.g., Cash Discount, Flat Rate"
                data-testid="input-deal-offerpath"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={dealForm.notes}
                onChange={e => setDealForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-deal-notes"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDealDialog(false)} data-testid="button-cancel-deal">
                Cancel
              </Button>
              <Button onClick={createDeal} data-testid="button-submit-deal">
                Create Deal
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Ticket Dialog */}
      <Dialog open={showTicketDialog} onOpenChange={setShowTicketDialog}>
        <DialogContent data-testid="dialog-create-ticket">
          <DialogHeader>
            <DialogTitle>Create Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject</label>
              <Input
                value={ticketForm.subject}
                onChange={e => setTicketForm(p => ({ ...p, subject: e.target.value }))}
                data-testid="input-ticket-subject"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={ticketForm.description}
                onChange={e => setTicketForm(p => ({ ...p, description: e.target.value }))}
                rows={3}
                data-testid="textarea-ticket-description"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <Select value={ticketForm.priority} onValueChange={v => setTicketForm(p => ({ ...p, priority: v }))}>
                <SelectTrigger data-testid="select-ticket-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowTicketDialog(false)} data-testid="button-cancel-ticket">
                Cancel
              </Button>
              <Button onClick={createTicket} disabled={!ticketForm.subject || !ticketForm.description} data-testid="button-submit-ticket">
                Create Ticket
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Task Dialog */}
      <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent data-testid="dialog-create-task">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={taskForm.title}
                onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))}
                data-testid="input-task-title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={taskForm.description}
                onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))}
                rows={3}
                data-testid="textarea-task-description"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="date"
                value={taskForm.dueDate}
                onChange={e => setTaskForm(p => ({ ...p, dueDate: e.target.value }))}
                data-testid="input-task-duedate"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowTaskDialog(false)} data-testid="button-cancel-task">
                Cancel
              </Button>
              <Button onClick={createTask} disabled={!taskForm.title} data-testid="button-submit-task">
                Create Task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

function ActivityTimelineFull({ events }: { events: ActivityEvent[] }) {
  const displayEvents = events.slice(0, 50);

  if (displayEvents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground" data-testid="activity-timeline-empty">
          No activity yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6" data-testid="activity-timeline">
        <div className="relative">
          {displayEvents.map((event, index) => {
            const { icon: Icon, label } = getActionMeta(event);
            const detail = getDetailText(event);
            const isLast = index === displayEvents.length - 1;

            return (
              <div
                key={event.id}
                className="relative flex gap-3 pb-4"
                data-testid={`activity-item-${event.id}`}
              >
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-medium" data-testid={`activity-label-${event.id}`}>
                    {label}
                  </p>
                  {detail && (
                    <p className="text-xs text-muted-foreground truncate" data-testid={`activity-detail-${event.id}`}>
                      {detail}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid={`activity-time-${event.id}`}>
                    {formatRelativeTime(event.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
