import { useState } from "react";
import { useContacts, useCreateContact, useUpdateContact } from "@/hooks/use-contacts";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, MoreHorizontal, UserPlus, Mail, MessageSquare, Zap, AlertTriangle, Sparkles, Activity, ArrowRight, Clock, TrendingUp, Ticket, Download, CheckSquare, ExternalLink, Users, Merge, ChevronRight, Archive, RotateCcw, Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToCSV } from "@/lib/export-csv";
import { useToast } from "@/hooks/use-toast";
import SavedFilterBar from "@/components/SavedFilterBar";
import DashboardErrorState from "@/components/DashboardErrorState";
import { VERTICALS } from "@shared/schema";

const formSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email(),
  phone: z.string().min(1, "Required"),
  companyName: z.string().min(1, "Required"),
  vertical: z.string().optional(),
  monthlyVolume: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface ActivityEvent {
  id: string;
  type: string;
  action: string;
  entityType: string;
  entityId: number;
  details: Record<string, string>;
  createdAt: string;
}

interface BulkMessageResult {
  sent: number;
  skipped: number;
  errors: number;
  total: number;
  results: { contactId: number; status: string; error?: string }[];
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

function ActivityTimeline({ entityType, entityId }: { entityType: string; entityId: number }) {
  const { data: events, isLoading } = useQuery<ActivityEvent[]>({
    queryKey: ["/api/activity", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/activity?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!entityId,
  });

  const displayEvents = events?.slice(0, 20) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4 pt-4" data-testid="activity-timeline-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 items-start">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (displayEvents.length === 0) {
    return (
      <div className="pt-4 text-center text-sm text-muted-foreground" data-testid="activity-timeline-empty">
        No activity yet
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-0" data-testid="activity-timeline">
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" /> Activity Timeline
      </h4>
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
                {!isLast && (
                  <div className="w-px flex-1 bg-border mt-1" />
                )}
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
    </div>
  );
}

interface DuplicateGroup {
  email: string;
  phone: string;
  contacts: any[];
}

function DuplicateFinderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [selectedGroup, setSelectedGroup] = useState<DuplicateGroup | null>(null);
  const [primaryId, setPrimaryId] = useState<string>("");

  const { data: duplicates, isLoading } = useQuery<DuplicateGroup[]>({
    queryKey: ["/api/contacts/duplicates"],
    enabled: open,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ primaryId, duplicateId }: { primaryId: number; duplicateId: number }) => {
      const res = await apiRequest("POST", "/api/contacts/merge", { primaryId, duplicateId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contacts merged", description: "Duplicate contact has been merged into the primary record." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setSelectedGroup(null);
      setPrimaryId("");
    },
    onError: (err: any) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const handleMerge = () => {
    if (!selectedGroup || !primaryId) return;
    const primary = Number(primaryId);
    const duplicateIds = selectedGroup.contacts.filter(c => c.id !== primary).map(c => c.id);
    for (const dupId of duplicateIds) {
      mergeMutation.mutate({ primaryId: primary, duplicateId: dupId });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSelectedGroup(null); setPrimaryId(""); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="text-duplicates-title">
            {selectedGroup ? "Merge Duplicate Contacts" : "Potential Duplicate Contacts"}
          </DialogTitle>
        </DialogHeader>

        {!selectedGroup ? (
          <div className="space-y-2">
            {isLoading ? (
              <div className="space-y-3 py-4" data-testid="duplicates-loading">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !duplicates || duplicates.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-duplicates">
                No duplicate contacts found. Your records are clean.
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                <div className="space-y-2 pr-1">
                  {duplicates.map((group, idx) => (
                    <Card
                      key={idx}
                      className="hover-elevate cursor-pointer"
                      onClick={() => { setSelectedGroup(group); setPrimaryId(String(group.contacts[0]?.id || "")); }}
                      data-testid={`duplicate-group-${idx}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="shrink-0" data-testid={`badge-duplicate-count-${idx}`}>
                                {group.contacts.length} matches
                              </Badge>
                              {group.email && (
                                <span className="text-sm text-muted-foreground truncate" data-testid={`text-dup-email-${idx}`}>
                                  {group.email}
                                </span>
                              )}
                              {group.phone && (
                                <span className="text-sm text-muted-foreground truncate" data-testid={`text-dup-phone-${idx}`}>
                                  {group.phone}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 mt-1 flex-wrap">
                              {group.contacts.map((c: any) => (
                                <span key={c.id} className="text-sm font-medium" data-testid={`text-dup-name-${c.id}`}>
                                  {c.firstName} {c.lastName}
                                </span>
                              ))}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedGroup(null); setPrimaryId(""); }} data-testid="button-back-to-list">
              Back to list
            </Button>

            <div>
              <p className="text-sm font-medium mb-2">Select the primary record to keep:</p>
              <div className="space-y-2" data-testid="radio-primary-select">
                {selectedGroup.contacts.map((c: any) => (
                  <Card
                    key={c.id}
                    className={`cursor-pointer ${primaryId === String(c.id) ? "border-primary" : ""}`}
                    onClick={() => setPrimaryId(String(c.id))}
                    data-testid={`merge-candidate-${c.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="primary-contact"
                          value={String(c.id)}
                          checked={primaryId === String(c.id)}
                          onChange={() => setPrimaryId(String(c.id))}
                          className="mt-1"
                          data-testid={`radio-contact-${c.id}`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{c.firstName} {c.lastName}</span>
                            {primaryId === String(c.id) && (
                              <Badge variant="default" data-testid={`badge-primary-${c.id}`}>Primary</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                            <span data-testid={`merge-email-${c.id}`}>Email: {c.email || "N/A"}</span>
                            <span data-testid={`merge-phone-${c.id}`}>Phone: {c.phone || "N/A"}</span>
                            <span data-testid={`merge-company-${c.id}`}>Company: {c.companyName || "N/A"}</span>
                            <span data-testid={`merge-status-${c.id}`}>Status: {c.status || "N/A"}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="rounded-md border p-3 bg-muted/50" data-testid="merge-preview">
              <p className="text-sm font-medium mb-1">Merge Preview</p>
              <p className="text-xs text-muted-foreground">
                All deals, tickets, tasks, and documents from duplicate records will be reassigned to the primary contact.
                Duplicate records will be archived with a merge note.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setSelectedGroup(null); setPrimaryId(""); }} data-testid="button-merge-cancel">
                Cancel
              </Button>
              <Button
                onClick={handleMerge}
                disabled={!primaryId || mergeMutation.isPending}
                data-testid="button-confirm-merge"
              >
                <Merge className="h-4 w-4 mr-2" />
                {mergeMutation.isPending ? "Merging..." : "Confirm Merge"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Contacts() {
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const { data: contactsResult, isLoading, isError, refetch } = useContacts({ limit: pageSize, offset: page * pageSize });
  const contacts = contactsResult?.data;
  const totalContacts = contactsResult?.total ?? 0;
  const totalPages = Math.ceil(totalContacts / pageSize);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [emailHealthFilter, setEmailHealthFilter] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [showArchived, setShowArchived] = useState(false);
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const { toast } = useToast();

  const archiveContactMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/contacts/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact archived" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to archive contact", description: err.message, variant: "destructive" });
    },
  });

  const restoreContactMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/contacts/${id}/restore`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact restored" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to restore contact", description: err.message, variant: "destructive" });
    },
  });

  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<"email" | "sms">("email");
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkMessageResult | null>(null);

  const bulkSendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bulk-message", {
        contactIds: Array.from(selectedIds),
        channel: bulkChannel,
        subject: bulkChannel === "email" ? bulkSubject : undefined,
        message: bulkMessage,
      });
      return res.json() as Promise<BulkMessageResult>;
    },
    onSuccess: (data) => {
      setBulkResults(data);
      toast({
        title: "Bulk message complete",
        description: `Sent: ${data.sent}, Skipped: ${data.skipped}, Errors: ${data.errors}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      companyName: "",
    }
  });

  const onSubmit = async (data: FormData) => {
    try {
      await createContact.mutateAsync({ ...data, status: "New" });
      setIsDialogOpen(false);
      form.reset();
    } catch {
      // onError handler in useCreateContact shows toast
    }
  };

  const EMAIL_HEALTH_OPTIONS = [
    { value: "", label: "All" },
    { value: "active", label: "Active" },
    { value: "bounced", label: "Bounced" },
    { value: "invalid", label: "Invalid" },
    { value: "opted_out", label: "Opted Out" },
  ];

  const filteredContacts = contacts?.filter((c: any) => {
    const matchesSearch = c.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.companyName?.toLowerCase().includes(searchTerm.toLowerCase());
    const isArchived = !!c.archivedAt;
    if (!showArchived && isArchived) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (emailHealthFilter) {
      const contactEmailStatus = (c.emailStatus || "active");
      if (contactEmailStatus !== emailHealthFilter) return false;
    }
    return matchesSearch;
  });

  const emailHealthCounts = EMAIL_HEALTH_OPTIONS.reduce((acc, opt) => {
    if (!opt.value) return acc;
    acc[opt.value] = contacts?.filter((c: any) => (c.emailStatus || "active") === opt.value).length ?? 0;
    return acc;
  }, {} as Record<string, number>);

  const contactsFilterState = { searchTerm, statusFilter, emailHealthFilter, showArchived: String(showArchived) };

  const handleApplySavedFilter = (filters: Record<string, unknown>) => {
    setSearchTerm(String(filters.searchTerm || ""));
    setStatusFilter(String(filters.statusFilter || ""));
    setEmailHealthFilter(String(filters.emailHealthFilter || ""));
    if (filters.showArchived === "true") setShowArchived(true);
    else setShowArchived(false);
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === (filteredContacts?.length || 0)) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts?.map((c: any) => c.id) || []));
    }
  };

  const bulkUpdateStatus = async (status: string) => {
    if (bulkUpdating) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await updateContact.mutateAsync({ id, status });
      }
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      toast({ title: "Bulk update failed", description: message, variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  };

  const openBulkDialog = (channel: "email" | "sms") => {
    setBulkChannel(channel);
    setBulkSubject("");
    setBulkMessage("");
    setBulkResults(null);
    setBulkDialogOpen(true);
  };

  const handleBulkLinkedInEnrich = async () => {
    if (bulkUpdating) return;
    setBulkUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/contacts/bulk-enrich-linkedin", {
        contactIds: Array.from(selectedIds),
      });
      const data = await res.json();
      toast({ title: "LinkedIn enrichment started", description: data.message });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: "LinkedIn enrichment failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  };

  const selectedContacts = Array.from(selectedIds);

  if (isError) {
    return <DashboardErrorState title="Failed to load contacts" onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search contacts..." 
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-contacts"
          />
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap" data-testid="email-health-filter">
            {EMAIL_HEALTH_OPTIONS.map((opt) => {
              const isActive = emailHealthFilter === opt.value;
              const count = opt.value ? emailHealthCounts[opt.value] : filteredContacts?.length;
              return (
                <button
                  key={opt.value || "all"}
                  onClick={() => setEmailHealthFilter(opt.value)}
                  data-testid={`chip-email-health-${opt.value || "all"}`}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive
                      ? opt.value === "bounced" || opt.value === "invalid"
                        ? "bg-red-100 border-red-300 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300"
                        : opt.value === "opted_out"
                        ? "bg-slate-200 border-slate-400 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-200"
                        : "bg-primary/10 border-primary/30 text-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                  {count !== undefined && count > 0 && (
                    <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${
                      isActive ? "bg-white/30 dark:bg-black/20" : "bg-muted-foreground/10"
                    }`} data-testid={`count-email-health-${opt.value || "all"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2" data-testid="toggle-show-archived-contacts">
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              data-testid="switch-show-archived-contacts"
            />
            <Label className="text-sm cursor-pointer" onClick={() => setShowArchived(!showArchived)}>
              Show Archived
            </Label>
          </div>
          {selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-bulk-actions">
                  <CheckSquare className="w-4 h-4" />
                  {selectedIds.size} selected
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Contacted")} disabled={bulkUpdating} data-testid="bulk-mark-contacted">Mark Contacted</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Won")} disabled={bulkUpdating} data-testid="bulk-mark-won">Mark Won</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Lost")} disabled={bulkUpdating} data-testid="bulk-mark-lost">Mark Lost</DropdownMenuItem>
                <DropdownMenuItem onClick={handleBulkLinkedInEnrich} disabled={bulkUpdating} data-testid="bulk-linkedin-enrich">
                  Enrich from LinkedIn
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDuplicatesOpen(true)} data-testid="button-find-duplicates">
            <Users className="w-4 h-4" /> Find Duplicates
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => exportToCSV(filteredContacts || [], "contacts", [
            { key: "firstName", label: "First Name" },
            { key: "lastName", label: "Last Name" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "companyName", label: "Company" },
            { key: "status", label: "Status" },
            { key: "leadScore", label: "Lead Score" },
            { key: "createdAt", label: "Created At" },
          ])} data-testid="button-export-contacts">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="button-add-contact">
                <Plus className="w-4 h-4" /> Add Contact
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Contact</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input {...field} type="email" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vertical"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vertical</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-contact-vertical">
                            <SelectValue placeholder="Select vertical (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VERTICALS.map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createContact.isPending}>
                    {createContact.isPending ? "Creating..." : "Create Contact"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {selectedContacts.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md flex-wrap" data-testid="bulk-actions-toolbar">
          <span className="text-sm font-medium" data-testid="text-selected-count">
            {selectedContacts.length} selected
          </span>
          <Button size="sm" onClick={() => openBulkDialog("email")} data-testid="button-bulk-email">
            <Mail className="w-4 h-4 mr-1" /> Bulk Email
          </Button>
          <Button size="sm" onClick={() => openBulkDialog("sms")} data-testid="button-bulk-sms">
            <MessageSquare className="w-4 h-4 mr-1" /> Bulk SMS
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
            Clear
          </Button>
        </div>
      )}

      <SavedFilterBar
        entityType="contact"
        currentFilters={contactsFilterState}
        onApplyFilter={handleApplySavedFilter}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size === (filteredContacts?.length || 0) && (filteredContacts?.length || 0) > 0}
                    onCheckedChange={toggleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-4 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredContacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center justify-center py-14 text-center gap-3" data-testid="empty-contacts">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Users className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-foreground" data-testid="text-empty-contacts">No contacts yet</p>
                      <p className="text-xs text-muted-foreground max-w-xs">Add your first contact to start tracking leads and customers.</p>
                      <Button size="sm" className="gap-1 mt-1" onClick={() => setIsDialogOpen(true)} data-testid="button-empty-add-contact">
                        <Plus className="w-3.5 h-3.5" /> Add Contact
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredContacts?.map((contact: any) => {
                  const isArchived = !!contact.archivedAt;
                  return (<TableRow
                    key={contact.id}
                    className={`cursor-pointer ${isArchived ? "opacity-50" : ""}`}
                    onClick={() => setLocation(`/dashboard/contacts/${contact.id}`)}
                    data-testid={`contact-row-${contact.id}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(contact.id)) next.delete(contact.id); else next.add(contact.id);
                            return next;
                          });
                        }}
                        data-testid={`checkbox-contact-${contact.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {contact.firstName[0]}{contact.lastName[0]}
                        </div>
                        <span className={isArchived ? "line-through" : ""}>{contact.firstName} {contact.lastName}</span>
                        {(contact as any).isDecisionMaker && (
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" aria-label="Decision Maker" data-testid={`badge-dm-${contact.id}`} />
                        )}
                        {(contact as any).emailStatus && (contact as any).emailStatus !== "active" && (
                          <span className={`text-xs px-1 py-0.5 rounded ${(contact as any).emailStatus === "bounced" || (contact as any).emailStatus === "invalid" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-slate-100 text-slate-600"}`} data-testid={`badge-email-status-${contact.id}`}>
                            {(contact as any).emailStatus}
                          </span>
                        )}
                        {isArchived && (
                          <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-archived-contact-${contact.id}`}>
                            <Archive className="w-3 h-3 mr-1" /> Archived
                          </Badge>
                        )}
                        {contact.isDecisionMaker && (
                          <Badge variant="default" className="text-xs bg-amber-500 text-white border-0 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-dm-${contact.id}`}>
                            DM
                          </Badge>
                        )}
                        {contact.emailStatus === "bounced" && (
                          <Badge variant="destructive" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-bounced-${contact.id}`}>
                            Bounced
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{contact.companyName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{contact.email}</TableCell>
                    <TableCell>
                      {contact.vertical ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary" data-testid={`badge-vertical-${contact.id}`}>
                          {contact.vertical}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {(contact.tags || []).slice(0, 2).map((tag: string) => (
                          <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">{tag}</span>
                        ))}
                        {(contact.tags || []).length > 2 && <span className="text-xs text-muted-foreground">+{contact.tags.length - 2}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                        ${contact.status === 'New' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 
                          contact.status === 'Won' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                          contact.status === 'Contacted' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>
                        {contact.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isArchived && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Restore contact"
                            onClick={(e) => { e.stopPropagation(); restoreContactMutation.mutate(contact.id); }}
                            data-testid={`button-restore-contact-${contact.id}`}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label="View contact" onClick={(e) => { e.stopPropagation(); setLocation(`/dashboard/contacts/${contact.id}`); }} data-testid={`button-view-${contact.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions" onClick={(e) => e.stopPropagation()} data-testid={`button-actions-${contact.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateContact.mutate({ id: contact.id, status: "Contacted" }); }}>
                              Mark Contacted
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateContact.mutate({ id: contact.id, status: "Won" }); }}>
                              Mark Won
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateContact.mutate({ id: contact.id, status: "Lost" }); }}>
                              Mark Lost
                            </DropdownMenuItem>
                            {isArchived ? (
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); restoreContactMutation.mutate(contact.id); }}
                                data-testid={`menu-restore-contact-${contact.id}`}
                              >
                                <RotateCcw className="w-4 h-4 mr-2" /> Restore
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); archiveContactMutation.mutate(contact.id); }}
                                data-testid={`menu-archive-contact-${contact.id}`}
                              >
                                <Archive className="w-4 h-4 mr-2" /> Archive
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t" data-testid="contacts-pagination">
            <span className="text-sm text-muted-foreground" data-testid="text-contacts-total">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalContacts)} of {totalContacts}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-contacts-prev">
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-contacts-next">
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <DuplicateFinderDialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen} />

      <Dialog open={bulkDialogOpen} onOpenChange={(open) => { setBulkDialogOpen(open); if (!open) setBulkResults(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-bulk-dialog-title">
              {bulkChannel === "email" ? "Send Bulk Email" : "Send Bulk SMS"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-bulk-recipient-count">
              Sending to {selectedContacts.length} contact{selectedContacts.length !== 1 ? "s" : ""} via {bulkChannel}
            </p>

            {bulkChannel === "email" && (
              <div>
                <label className="text-sm font-medium">Subject</label>
                <Input
                  value={bulkSubject}
                  onChange={(e) => setBulkSubject(e.target.value)}
                  placeholder="Email subject line"
                  data-testid="input-bulk-subject"
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Message</label>
              <Textarea
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={5}
                data-testid="input-bulk-message"
              />
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-template-hints">
                {"Available variables: {{firstName}}, {{lastName}}, {{companyName}}, {{email}}"}
              </p>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-3" data-testid="text-compliance-disclaimer">
              By sending this message you confirm all recipients have opted in to receive communications. Contacts flagged as Do Not Contact or without SMS consent will be automatically skipped.
            </p>

            {bulkResults && (
              <div className="rounded-md border p-3 space-y-1" data-testid="bulk-results-summary">
                <p className="text-sm font-medium">Results</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600 dark:text-green-400" data-testid="text-bulk-sent">Sent: {bulkResults.sent}</span>
                  <span className="text-yellow-600 dark:text-yellow-400" data-testid="text-bulk-skipped">Skipped: {bulkResults.skipped}</span>
                  <span className="text-red-600 dark:text-red-400" data-testid="text-bulk-errors">Errors: {bulkResults.errors}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setBulkDialogOpen(false)} data-testid="button-bulk-cancel">
                {bulkResults ? "Close" : "Cancel"}
              </Button>
              {!bulkResults && (
                <Button
                  onClick={() => bulkSendMutation.mutate()}
                  disabled={!bulkMessage || bulkSendMutation.isPending}
                  data-testid="button-bulk-send"
                >
                  {bulkSendMutation.isPending ? "Sending..." : `Send ${bulkChannel === "email" ? "Email" : "SMS"}`}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
