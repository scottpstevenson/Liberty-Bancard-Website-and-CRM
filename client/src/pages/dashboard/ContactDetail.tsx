import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUpdateContact } from "@/hooks/use-contacts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, Ticket as TicketType, Task as TaskType, Note, Company, ContactCompany, Chargeback, Document, Agent, AgentMerchant } from "@shared/schema";
import { DOCUMENT_CATEGORIES } from "@shared/schema";
import BoardingPanel from "@/components/BoardingPanel";
import LiveProcessingTab from "@/components/LiveProcessingTab";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Edit2, Save, X, Plus, StickyNote, TrendingUp, CheckSquare,
  Ticket, Mail, Phone, Building2, UserPlus, MessageSquare, Zap,
  AlertTriangle, Sparkles, Activity, ArrowRight, Clock, Link2, Trash2, Star,
  RefreshCw, CheckCircle2, AlertCircle, ShieldAlert, Linkedin, FolderOpen, Upload,
  FileText, FileImage, File, Download, Calendar, User, UserRound, Loader2,
} from "lucide-react";
import Comments from "@/components/Comments";

function DealAgentAssignment({ dealId, agents }: { dealId: number; agents: Agent[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: assignment } = useQuery<AgentMerchant | null>({
    queryKey: ["/api/agent-merchants/deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-merchants/deal/${dealId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (agentId: number | null) => {
      const res = await apiRequest("PUT", `/api/agent-merchants/deal/${dealId}/assign`, { agentId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-merchants/deal", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      toast({ title: "Agent assignment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update agent assignment", description: err.message, variant: "destructive" });
    },
  });

  const currentValue = assignment ? String(assignment.agentId) : "none";

  return (
    <div className="flex items-center gap-2 pt-1">
      <UserRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <Select
        value={currentValue}
        onValueChange={(val) => assignMutation.mutate(val === "none" ? null : Number(val))}
      >
        <SelectTrigger
          className="h-7 text-xs flex-1 max-w-48"
          data-testid={`select-deal-agent-${dealId}`}
        >
          <SelectValue placeholder="Assign agent..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {agents.filter(a => a.status === "active").map((agent) => (
            <SelectItem key={agent.id} value={String(agent.id)}>
              {agent.firstName} {agent.lastName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {assignMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}

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

function formatRelativeTime(dateStr: string | Date): string {
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

function formatDate(dateStr: string | Date | null | undefined): string {
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

function statusColor(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
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
  const { user } = useAuth();
  const isManagerOrAdmin = user?.role === "admin" || user?.role === "manager";

  const { data: agentsList } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isManagerOrAdmin,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string | null | undefined>>({});
  const [tagInput, setTagInput] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const [showDealDialog, setShowDealDialog] = useState(false);
  const [dealForm, setDealForm] = useState({ pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });

  const enrichLinkedInMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/enrich-linkedin`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      if (data.fieldsUpdated && data.fieldsUpdated.length > 0) {
        toast({ title: "LinkedIn enrichment complete", description: `Updated: ${data.fieldsUpdated.join(", ")}` });
      } else {
        toast({ title: "LinkedIn enrichment complete", description: "No new fields to update — all fields already populated." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "LinkedIn enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: "", description: "", priority: "Normal", category: "Other" });

  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", dueDate: "" });

  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">("existing");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyRole, setCompanyRole] = useState("");
  const [companyIsPrimary, setCompanyIsPrimary] = useState(false);
  const [newCompanyForm, setNewCompanyForm] = useState({ legalName: "", dba: "", vertical: "", website: "" });
  const [companySearch, setCompanySearch] = useState("");

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

  const { data: contactCompanies = [] } = useQuery<ContactCompany[]>({
    queryKey: ["/api/contacts", contactId, "companies"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/companies`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: allCompanies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const addCompanyAssociation = useMutation({
    mutationFn: async (body: { companyId: number; role?: string; isPrimary?: boolean }) => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/companies`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "companies"] });
      setShowCompanyDialog(false);
      setSelectedCompanyId("");
      setCompanyRole("");
      setCompanyIsPrimary(false);
      setNewCompanyForm({ legalName: "", dba: "", vertical: "", website: "" });
      toast({ title: "Company linked" });
    },
    onError: () => {
      toast({ title: "Failed to link company", variant: "destructive" });
    },
  });

  const removeCompanyAssociation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/contact-companies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "companies"] });
      toast({ title: "Company unlinked" });
    },
    onError: () => {
      toast({ title: "Failed to unlink company", variant: "destructive" });
    },
  });

  const { data: ghlSyncStatus, refetch: refetchGhlStatus } = useQuery<{
    ghlContactId: string | null;
    isSynced: boolean;
    isRecent: boolean;
    lastSyncedAt: string | null;
    syncAgeMs: number | null;
  }>({
    queryKey: ["/api/ghl/sync-status/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/sync-status/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sync status");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: contactDocuments = [] } = useQuery<Document[]>({
    queryKey: ["/api/merchant-documents/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/merchant-documents/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 30000,
  });

  const resyncToGhlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ghl/sync-contact/${contactId}`);
      return res.json();
    },
    onSuccess: (data: { success: boolean; ghlContactId?: string; error?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] });
      refetchGhlStatus();
      if (data.success) {
        toast({ title: "Re-synced to GHL", description: `GHL Contact ID: ${data.ghlContactId}` });
      } else {
        toast({ title: "Sync failed", description: data.error || "GHL sync encountered an error", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "GHL sync failed", variant: "destructive" });
    },
  });

  const createAndLinkCompany = useMutation({
    mutationFn: async () => {
      const companyRes = await apiRequest("POST", "/api/companies", {
        legalName: newCompanyForm.legalName,
        dba: newCompanyForm.dba || undefined,
        vertical: newCompanyForm.vertical || undefined,
        website: newCompanyForm.website || undefined,
      });
      const company = await companyRes.json();
      const linkRes = await apiRequest("POST", `/api/contacts/${contactId}/companies`, {
        companyId: company.id,
        role: companyRole || undefined,
        isPrimary: companyIsPrimary,
      });
      return linkRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setShowCompanyDialog(false);
      setSelectedCompanyId("");
      setCompanyRole("");
      setCompanyIsPrimary(false);
      setNewCompanyForm({ legalName: "", dba: "", vertical: "", website: "" });
      toast({ title: "Company created and linked" });
    },
    onError: () => {
      toast({ title: "Failed to create company", variant: "destructive" });
    },
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
              <Badge variant={statusColor(contact.status)} data-testid="badge-status">
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

      {/* GHL Sync Status */}
      {(() => {
        const isSynced = ghlSyncStatus?.isSynced && ghlSyncStatus?.isRecent;
        const ghlId = ghlSyncStatus?.ghlContactId || contact.ghlContactId;
        const lastSyncedAt = ghlSyncStatus?.lastSyncedAt;
        return (
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid="section-ghl-sync-status">
            {isSynced ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <Badge
                variant={isSynced ? "default" : "secondary"}
                className={isSynced ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"}
                data-testid="badge-ghl-sync-status"
              >
                {isSynced ? "GHL Synced" : "Sync Pending"}
              </Badge>
              {ghlId && (
                <span className="ml-2 text-xs text-muted-foreground font-mono" data-testid="text-ghl-contact-id">
                  {ghlId}
                </span>
              )}
              {lastSyncedAt && (
                <span className="ml-2 text-xs text-muted-foreground" data-testid="text-ghl-last-synced">
                  Last synced: {new Date(lastSyncedAt).toLocaleString()}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resyncToGhlMutation.mutate()}
              disabled={resyncToGhlMutation.isPending}
              className="shrink-0"
              data-testid="button-resync-ghl"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resyncToGhlMutation.isPending ? "animate-spin" : ""}`} />
              Re-sync to GHL
            </Button>
          </div>
        );
      })()}

      {/* LinkedIn Enrichment */}
      {contact.linkedinUrl && (() => {
        const log = ((contact as any).linkedinEnrichmentLog ?? []) as Array<{
          enrichedAt: string;
          provider: string;
          fieldsUpdated: string[];
          connectionCount?: number;
          lastActivityDate?: string;
          title?: string;
          companyName?: string;
          activitySummary?: string | null;
        }>;
        const latest = log[0];
        return (
          <div className="rounded-lg border bg-card" data-testid="section-linkedin-enrichment">
            <div className="flex items-center gap-3 p-3">
              <Linkedin className="h-4 w-4 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {(contact as any).linkedinEnrichedAt ? (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-700" data-testid="badge-linkedin-enriched">
                      Enriched {new Date((contact as any).linkedinEnrichedAt).toLocaleDateString()}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground" data-testid="badge-linkedin-never-enriched">
                      Never enriched
                    </Badge>
                  )}
                  <a
                    href={contact.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate max-w-[200px]"
                    data-testid="link-linkedin-url"
                  >
                    {contact.linkedinUrl}
                  </a>
                </div>
                {latest && (
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {latest.connectionCount != null && (
                      <span className="text-xs text-muted-foreground" data-testid="text-linkedin-connections">
                        {latest.connectionCount.toLocaleString()} connections
                      </span>
                    )}
                    {latest.lastActivityDate && (
                      <span className="text-xs text-muted-foreground" data-testid="text-linkedin-last-active">
                        Last active: {latest.lastActivityDate}
                      </span>
                    )}
                    {latest.title && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]" data-testid="text-linkedin-title">
                        {latest.title}{latest.companyName ? ` · ${latest.companyName}` : ""}
                      </span>
                    )}
                    {latest.fieldsUpdated?.length > 0 && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="text-linkedin-fields-updated">
                        Updated: {latest.fieldsUpdated.join(", ")}
                      </span>
                    )}
                    {latest.activitySummary && (
                      <span className="text-xs text-muted-foreground italic w-full" data-testid="text-linkedin-activity-summary">
                        Recent activity: {latest.activitySummary.slice(0, 120)}{latest.activitySummary.length > 120 ? "…" : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => enrichLinkedInMutation.mutate()}
                disabled={enrichLinkedInMutation.isPending}
                className="shrink-0"
                data-testid="button-enrich-linkedin"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${enrichLinkedInMutation.isPending ? "animate-spin" : ""}`} />
                {enrichLinkedInMutation.isPending ? "Enriching..." : "Enrich from LinkedIn"}
              </Button>
            </div>
          </div>
        );
      })()}

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

      {/* Associated Companies */}
      <Card data-testid="section-associated-companies">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Associated Companies
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCompanyMode("existing");
              setShowCompanyDialog(true);
            }}
            data-testid="button-add-company"
          >
            <Link2 className="h-4 w-4 mr-1" /> Link Company
          </Button>
        </CardHeader>
        <CardContent>
          {contactCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-companies">No companies linked yet</p>
          ) : (
            <div className="space-y-2">
              {contactCompanies.map(cc => {
                const company = allCompanies.find(c => c.id === cc.companyId);
                return (
                  <div
                    key={cc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    data-testid={`company-association-${cc.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium" data-testid={`text-company-name-${cc.id}`}>
                        {company?.legalName || `Company #${cc.companyId}`}
                      </span>
                      {company?.dba && (
                        <span className="text-sm text-muted-foreground" data-testid={`text-company-dba-${cc.id}`}>
                          (DBA: {company.dba})
                        </span>
                      )}
                      {cc.role && (
                        <Badge variant="outline" data-testid={`badge-company-role-${cc.id}`}>
                          {cc.role}
                        </Badge>
                      )}
                      {cc.isPrimary && (
                        <Badge variant="default" data-testid={`badge-company-primary-${cc.id}`}>
                          <Star className="h-3 w-3 mr-1" /> Primary
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCompanyAssociation.mutate(cc.id)}
                      disabled={removeCompanyAssociation.isPending}
                      data-testid={`button-remove-company-${cc.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
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
          <TabsTrigger value="documents" data-testid="tab-documents">
            <FolderOpen className="h-3.5 w-3.5 mr-1" />
            Documents {contactDocuments.length > 0 && `(${contactDocuments.length})`}
          </TabsTrigger>
          <TabsTrigger value="live-processing" data-testid="tab-live-processing">
            <Activity className="h-3.5 w-3.5 mr-1" />
            Live Processing
          </TabsTrigger>
          <TabsTrigger value="chargebacks" data-testid="tab-chargebacks">Chargebacks</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="comments" data-testid="tab-comments">Comments</TabsTrigger>
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
                  className="hover-elevate"
                  data-testid={`card-deal-${deal.id}`}
                >
                  <CardContent className="py-4 space-y-3">
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                      onClick={() => setLocation("/dashboard/pipeline")}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium" data-testid={`text-deal-pipeline-${deal.id}`}>
                            {deal.pipeline}
                          </span>
                          <Badge variant="outline" data-testid={`badge-deal-stage-${deal.id}`}>
                            {deal.stage}
                          </Badge>
                          {deal.mid && (
                            <Badge variant="outline" className="font-mono text-xs text-green-700 dark:text-green-400 border-green-300" data-testid={`badge-deal-mid-${deal.id}`}>
                              MID: {deal.mid}
                            </Badge>
                          )}
                        </div>
                        {deal.offerPath && (
                          <p className="text-sm text-muted-foreground" data-testid={`text-deal-offer-${deal.id}`}>
                            Offer: {deal.offerPath}
                          </p>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
                        Created {formatDate(deal.createdAt)}
                      </div>
                    </div>
                    {isManagerOrAdmin && agentsList && (
                      <DealAgentAssignment dealId={deal.id} agents={agentsList} />
                    )}
                    <BoardingPanel
                      dealId={deal.id}
                      dealStage={deal.stage || ""}
                      dealPipeline={deal.pipeline || ""}
                      onStatusChange={() => queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "detail"] })}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Live Processing Tab */}
        <TabsContent value="live-processing" data-testid="tab-content-live-processing">
          {deals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No deals yet</CardContent></Card>
          ) : (
            <div className="space-y-6">
              {deals.filter(d => d.mid || d.pipeline === "onboarding" || d.stage?.toLowerCase().includes("approved")).map(deal => (
                <div key={deal.id}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" data-testid={`badge-live-deal-pipeline-${deal.id}`}>{deal.pipeline}</Badge>
                    <Badge variant="secondary" data-testid={`badge-live-deal-stage-${deal.id}`}>{deal.stage}</Badge>
                    {deal.mid && (
                      <span className="text-xs text-muted-foreground font-mono">#{deal.id}</span>
                    )}
                  </div>
                  <LiveProcessingTab dealId={deal.id} mid={deal.mid || null} />
                </div>
              ))}
              {deals.filter(d => d.mid || d.pipeline === "onboarding" || d.stage?.toLowerCase().includes("approved")).length === 0 && (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Activity className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium text-muted-foreground">No approved deals yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Processing data appears once a deal is approved and a MID is assigned.
                    </p>
                  </CardContent>
                </Card>
              )}
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
                        {formatDate(ticket.createdAt)}
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
                        {formatRelativeTime(note.createdAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" data-testid="tab-content-documents">
          <ContactDocumentsTab contactId={contactId} />
        </TabsContent>

        {/* Chargebacks Tab */}
        <TabsContent value="chargebacks" data-testid="tab-content-chargebacks">
          <ContactChargebacksTab contactId={contactId} />
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" data-testid="tab-content-activity">
          <ActivityTimelineFull events={activityEvents ?? []} />
        </TabsContent>

        <TabsContent value="comments" data-testid="tab-content-comments">
          <Card>
            <CardContent className="pt-4">
              <Comments entityType="contact" entityId={contactId} />
            </CardContent>
          </Card>
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

      {/* Link Company Dialog */}
      <Dialog open={showCompanyDialog} onOpenChange={setShowCompanyDialog}>
        <DialogContent data-testid="dialog-link-company">
          <DialogHeader>
            <DialogTitle>Link Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={companyMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setCompanyMode("existing")}
                data-testid="button-mode-existing"
              >
                Select Existing
              </Button>
              <Button
                variant={companyMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setCompanyMode("new")}
                data-testid="button-mode-new"
              >
                Create New
              </Button>
            </div>

            {companyMode === "existing" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Search Company</label>
                <Input
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  placeholder="Search by name..."
                  data-testid="input-company-search"
                />
                <div className="max-h-40 overflow-y-auto border rounded-md">
                  {allCompanies
                    .filter(c => {
                      if (!companySearch) return true;
                      const q = companySearch.toLowerCase();
                      return (
                        c.legalName.toLowerCase().includes(q) ||
                        (c.dba && c.dba.toLowerCase().includes(q))
                      );
                    })
                    .filter(c => !contactCompanies.some(cc => cc.companyId === c.id))
                    .map(c => (
                      <div
                        key={c.id}
                        className={`flex items-center gap-2 p-2 cursor-pointer hover-elevate ${selectedCompanyId === String(c.id) ? "bg-accent" : ""}`}
                        onClick={() => setSelectedCompanyId(String(c.id))}
                        data-testid={`company-option-${c.id}`}
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{c.legalName}</p>
                          {c.dba && <p className="text-xs text-muted-foreground truncate">DBA: {c.dba}</p>}
                        </div>
                      </div>
                    ))}
                  {allCompanies.filter(c => {
                    if (!companySearch) return true;
                    const q = companySearch.toLowerCase();
                    return c.legalName.toLowerCase().includes(q) || (c.dba && c.dba.toLowerCase().includes(q));
                  }).filter(c => !contactCompanies.some(cc => cc.companyId === c.id)).length === 0 && (
                    <p className="text-sm text-muted-foreground p-3 text-center">No companies found</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Legal Name *</label>
                  <Input
                    value={newCompanyForm.legalName}
                    onChange={e => setNewCompanyForm(p => ({ ...p, legalName: e.target.value }))}
                    placeholder="Company legal name"
                    data-testid="input-new-company-name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">DBA</label>
                  <Input
                    value={newCompanyForm.dba}
                    onChange={e => setNewCompanyForm(p => ({ ...p, dba: e.target.value }))}
                    placeholder="Doing business as"
                    data-testid="input-new-company-dba"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Vertical</label>
                  <Select value={newCompanyForm.vertical} onValueChange={v => setNewCompanyForm(p => ({ ...p, vertical: v }))}>
                    <SelectTrigger data-testid="select-new-company-vertical">
                      <SelectValue placeholder="Select vertical" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Medical/Dental/Medspa">Medical/Dental/Medspa</SelectItem>
                      <SelectItem value="Automotive">Automotive</SelectItem>
                      <SelectItem value="Restaurant">Restaurant</SelectItem>
                      <SelectItem value="Home Services">Home Services</SelectItem>
                      <SelectItem value="Retail">Retail</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Website</label>
                  <Input
                    value={newCompanyForm.website}
                    onChange={e => setNewCompanyForm(p => ({ ...p, website: e.target.value }))}
                    placeholder="https://..."
                    data-testid="input-new-company-website"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={companyRole} onValueChange={setCompanyRole}>
                <SelectTrigger data-testid="select-company-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Owner">Owner</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                  <SelectItem value="Employee">Employee</SelectItem>
                  <SelectItem value="Partner">Partner</SelectItem>
                  <SelectItem value="Consultant">Consultant</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="company-primary"
                checked={companyIsPrimary}
                onChange={e => setCompanyIsPrimary(e.target.checked)}
                className="rounded border-input"
                data-testid="checkbox-company-primary"
              />
              <label htmlFor="company-primary" className="text-sm font-medium cursor-pointer">
                Primary Company
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCompanyDialog(false)} data-testid="button-cancel-company">
                Cancel
              </Button>
              {companyMode === "existing" ? (
                <Button
                  onClick={() => addCompanyAssociation.mutate({
                    companyId: Number(selectedCompanyId),
                    role: companyRole || undefined,
                    isPrimary: companyIsPrimary,
                  })}
                  disabled={!selectedCompanyId || addCompanyAssociation.isPending}
                  data-testid="button-submit-link-company"
                >
                  Link Company
                </Button>
              ) : (
                <Button
                  onClick={() => createAndLinkCompany.mutate()}
                  disabled={!newCompanyForm.legalName || createAndLinkCompany.isPending}
                  data-testid="button-submit-create-company"
                >
                  Create & Link
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getDocCategoryColor(category: string | null | undefined): string {
  switch (category) {
    case "Application": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "Voided Check": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "Photo ID": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "Bank Statement": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "EIN Letter": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "Signed Proposal": return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200";
    case "Processing Statement": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocFileIcon({ mimeType }: { mimeType: string | null | undefined }) {
  if (!mimeType) return <File className="h-5 w-5 text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function ContactDocumentsTab({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadCategory, setUploadCategory] = useState("Other");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<Document | null>(null);

  const { data: docs = [], isLoading } = useQuery<Document[]>({
    queryKey: ["/api/merchant-documents/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/merchant-documents/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/merchant-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      setDeleteDocTarget(null);
      toast({ title: "Document deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete document", variant: "destructive" });
    },
  });

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", uploadCategory);
      formData.append("contactId", String(contactId));

      const res = await fetch("/api/merchant-documents/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      toast({ title: "Document uploaded", description: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [contactId, uploadCategory, queryClient, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  return (
    <div className="space-y-4" data-testid="contact-documents-tab">
      {/* Upload Zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="space-y-1">
              <label className="text-sm font-medium">Category</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="w-48" data-testid="select-upload-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept="*/*"
              data-testid="input-file-upload"
            />
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Drop file here or click to upload</p>
                <p className="text-xs text-muted-foreground">PDF, images, or any document type</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-documents">
            <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No documents uploaded yet</p>
            <p className="text-sm mt-1">Upload KYC documents using the zone above</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              {docs.length} Document{docs.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {docs.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  data-testid={`doc-item-${doc.id}`}
                >
                  <div className="shrink-0">
                    <DocFileIcon mimeType={doc.mimeType} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-doc-name-${doc.id}`}>
                      {doc.fileName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      {doc.fileSize && (
                        <span className="text-xs text-muted-foreground" data-testid={`text-doc-filesize-${doc.id}`}>
                          {formatFileSize(doc.fileSize)}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>
                        <Calendar className="h-3 w-3" />
                        {formatDate(doc.createdAt)}
                      </span>
                      {doc.uploadedBy && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-uploader-${doc.id}`}>
                          <User className="h-3 w-3" />
                          {doc.uploadedBy}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${getDocCategoryColor(doc.category)}`}
                      data-testid={`badge-doc-category-${doc.id}`}
                    >
                      {doc.category || "Other"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => window.open(`/api/merchant-documents/${doc.id}/download`, "_blank")}
                      title="Download"
                      data-testid={`button-download-${doc.id}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-destructive"
                      onClick={() => setDeleteDocTarget(doc)}
                      title="Delete"
                      data-testid={`button-delete-${doc.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteDocTarget} onOpenChange={open => !open && setDeleteDocTarget(null)}>
        <DialogContent data-testid="dialog-confirm-doc-delete">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <span className="font-medium text-foreground">{deleteDocTarget?.fileName}</span>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocTarget(null)} data-testid="button-cancel-doc-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteDocTarget && deleteDocMutation.mutate(deleteDocTarget.id)}
              disabled={deleteDocMutation.isPending}
              data-testid="button-confirm-doc-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactChargebacksTab({ contactId }: { contactId: number }) {
  const { data: chargebacks = [], isLoading } = useQuery<Chargeback[]>({
    queryKey: ["/api/chargebacks/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/chargebacks/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const open = chargebacks.filter(c => !["Won", "Lost"].includes(c.status));
  const won = chargebacks.filter(c => c.status === "Won");
  const lost = chargebacks.filter(c => c.status === "Lost");
  const totalAmount = chargebacks.reduce((sum, c) => sum + (c.amount || 0), 0);
  const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const now = new Date();
  const overdue = open.filter(c => c.responseDeadline && new Date(c.responseDeadline) < now);

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading chargebacks...</div>;
  }

  return (
    <div className="space-y-4" data-testid="contact-chargebacks-tab">
      {chargebacks.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-total">{chargebacks.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${overdue.length > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-overdue">{overdue.length}</div>
              <div className="text-xs text-muted-foreground">Overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-amount">${totalAmount.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">Total Disputed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${winRate !== null && winRate >= 50 ? "text-green-600 dark:text-green-400" : winRate !== null ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-winrate">
                {winRate !== null ? `${winRate}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </CardContent>
          </Card>
        </div>
      )}

      {chargebacks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-chargebacks-contact">
            <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No chargebacks for this merchant
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {chargebacks.map(cb => {
            const isOverdue = !["Won", "Lost"].includes(cb.status) && cb.responseDeadline && new Date(cb.responseDeadline) < now;
            return (
              <Card key={cb.id} className={isOverdue ? "border-red-300 dark:border-red-800" : ""} data-testid={`card-cb-${cb.id}`}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">${cb.amount.toFixed(2)}</span>
                        <Badge variant="outline">{cb.cardBrand}</Badge>
                        <Badge variant={cb.status === "Won" ? "default" : cb.status === "Lost" ? "destructive" : "secondary"}>
                          {cb.status}
                        </Badge>
                        {isOverdue && <Badge variant="destructive">OVERDUE</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{cb.reasonCode}</p>
                      {cb.responseDeadline && (
                        <p className={`text-xs ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                          Deadline: {new Date(cb.responseDeadline).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {cb.transactionDate ? new Date(cb.transactionDate).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
