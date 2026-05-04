import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUpdateContact } from "@/hooks/use-contacts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, Ticket as TicketType, Task as TaskType, Note, Company, ContactCompany, Document, Agent } from "@shared/schema";

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
  Ticket, Mail, Phone, Building2,
  Activity, Link2, Trash2, Star,
  RefreshCw, CheckCircle2, AlertCircle, Linkedin, FolderOpen, Info,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Comments from "@/components/Comments";

import {
  type ActivityEvent,
  type ContactDetailData,
  statusColor,
} from "./contact-detail-tabs/shared";
import { OverviewTab } from "./contact-detail-tabs/OverviewTab";
import { DealsTab } from "./contact-detail-tabs/DealsTab";
import { LiveProcessingTabBody } from "./contact-detail-tabs/LiveProcessingTabBody";
import { TicketsTab } from "./contact-detail-tabs/TicketsTab";
import { TasksTab } from "./contact-detail-tabs/TasksTab";
import { NotesTab } from "./contact-detail-tabs/NotesTab";
import { ContactDocumentsTab } from "./contact-detail-tabs/DocumentsTab";
import { ContactChargebacksTab } from "./contact-detail-tabs/ChargebacksTab";
import { ActivityTimelineFull } from "./contact-detail-tabs/ActivityTab";
import { LinkedinEnrichmentSection } from "./contact-detail-tabs/LinkedinEnrichmentSection";
  import { CreateDialogs } from "./contact-detail-tabs/CreateDialogs";
import { GhlSyncStatus } from "./contact-detail-tabs/GhlSyncStatus";
  
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

  const [showLinkedinHistory, setShowLinkedinHistory] = useState(false);

  const [showDealDialog, setShowDealDialog] = useState(false);
  const [dealForm, setDealForm] = useState({ pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });

  const { data: proxycurlStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/proxycurl/status"],
  });
  const proxycurlConfigured = proxycurlStatus?.configured ?? true;

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
      const isKeyMissing = err.message?.toLowerCase().includes("proxycurl") || err.message?.toLowerCase().includes("api key");
      if (isKeyMissing) {
        toast({
          title: "Proxycurl API key not configured",
          description: "Add your Proxycurl API key in Settings → Integrations to enable LinkedIn enrichment.",
          variant: "destructive",
        });
      } else {
        toast({ title: "LinkedIn enrichment failed", description: err.message, variant: "destructive" });
      }
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
        <GhlSyncStatus
          contact={contact}
          ghlSyncStatus={ghlSyncStatus}
          resyncToGhlMutation={resyncToGhlMutation}
        />

      {/* LinkedIn Enrichment */}
        <LinkedinEnrichmentSection
          contact={contact}
          proxycurlConfigured={proxycurlConfigured}
          showLinkedinHistory={showLinkedinHistory}
          setShowLinkedinHistory={setShowLinkedinHistory}
          enrichLinkedInMutation={enrichLinkedInMutation}
        />


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
                      aria-label="Remove company association"
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

        <TabsContent value="overview" data-testid="tab-content-overview">
          <OverviewTab
            contact={contact}
            dealsCount={deals.length}
            openTicketsCount={openTickets.length}
            pendingTasksCount={pendingTasks.length}
          />
        </TabsContent>

        <TabsContent value="deals" data-testid="tab-content-deals">
          <DealsTab
            deals={deals}
            contactId={contactId}
            isManagerOrAdmin={isManagerOrAdmin}
            agentsList={agentsList}
            setLocation={setLocation}
          />
        </TabsContent>

        <TabsContent value="live-processing" data-testid="tab-content-live-processing">
          <LiveProcessingTabBody deals={deals} />
        </TabsContent>

        <TabsContent value="tickets" data-testid="tab-content-tickets">
          <TicketsTab tickets={tickets} />
        </TabsContent>

        <TabsContent value="tasks" data-testid="tab-content-tasks">
          <TasksTab tasks={tasks} />
        </TabsContent>

        <TabsContent value="notes" data-testid="tab-content-notes">
          <NotesTab
            sortedNotes={sortedNotes}
            noteContent={noteContent}
            setNoteContent={setNoteContent}
            addNote={addNote}
          />
        </TabsContent>

        <TabsContent value="documents" data-testid="tab-content-documents">
          <ContactDocumentsTab contactId={contactId} />
        </TabsContent>

        <TabsContent value="chargebacks" data-testid="tab-content-chargebacks">
          <ContactChargebacksTab contactId={contactId} />
        </TabsContent>

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

      <CreateDialogs
          showDealDialog={showDealDialog}
          setShowDealDialog={setShowDealDialog}
          dealForm={dealForm}
          setDealForm={setDealForm}
          createDeal={createDeal}
          showTicketDialog={showTicketDialog}
          setShowTicketDialog={setShowTicketDialog}
          ticketForm={ticketForm}
          setTicketForm={setTicketForm}
          createTicket={createTicket}
          showTaskDialog={showTaskDialog}
          setShowTaskDialog={setShowTaskDialog}
          taskForm={taskForm}
          setTaskForm={setTaskForm}
          createTask={createTask}
          showCompanyDialog={showCompanyDialog}
          setShowCompanyDialog={setShowCompanyDialog}
          companyMode={companyMode}
          setCompanyMode={setCompanyMode}
          companySearch={companySearch}
          setCompanySearch={setCompanySearch}
          selectedCompanyId={selectedCompanyId}
          setSelectedCompanyId={setSelectedCompanyId}
          newCompanyForm={newCompanyForm}
          setNewCompanyForm={setNewCompanyForm}
          companyRole={companyRole}
          setCompanyRole={setCompanyRole}
          companyIsPrimary={companyIsPrimary}
          setCompanyIsPrimary={setCompanyIsPrimary}
          allCompanies={allCompanies}
          contactCompanies={contactCompanies}
          addCompanyAssociation={addCompanyAssociation}
          createAndLinkCompany={createAndLinkCompany}
        />
    </div>
  );
}
