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
import { Search, Plus, MoreHorizontal, UserPlus, Mail, MessageSquare, Zap, AlertTriangle, Sparkles, Activity, ArrowRight, Clock, TrendingUp, Ticket, Download, CheckSquare, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { exportToCSV } from "@/lib/export-csv";
import { useToast } from "@/hooks/use-toast";

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

export default function Contacts() {
  const { data: contacts, isLoading } = useContacts();
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [, setLocation] = useLocation();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const { toast } = useToast();

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
    await createContact.mutateAsync({ ...data, status: "New" });
    setIsDialogOpen(false);
    form.reset();
  };

  const filteredContacts = contacts?.filter((c: any) => 
    c.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.companyName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await updateContact.mutateAsync({ id, status });
    }
    setSelectedIds(new Set());
  };

  const openBulkDialog = (channel: "email" | "sms") => {
    setBulkChannel(channel);
    setBulkSubject("");
    setBulkMessage("");
    setBulkResults(null);
    setBulkDialogOpen(true);
  };

  const selectedContacts = Array.from(selectedIds);

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
          {selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-bulk-actions">
                  <CheckSquare className="w-4 h-4" />
                  {selectedIds.size} selected
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Contacted")} data-testid="bulk-mark-contacted">Mark Contacted</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Won")} data-testid="bulk-mark-won">Mark Won</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkUpdateStatus("Lost")} data-testid="bulk-mark-lost">Mark Lost</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                <div className="grid grid-cols-2 gap-4">
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
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">Loading...</TableCell>
                </TableRow>
              ) : filteredContacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">No contacts found</TableCell>
                </TableRow>
              ) : (
                filteredContacts?.map((contact: any) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer"
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
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {contact.firstName[0]}{contact.lastName[0]}
                        </div>
                        <span>{contact.firstName} {contact.lastName}</span>
                      </div>
                    </TableCell>
                    <TableCell>{contact.companyName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{contact.email}</TableCell>
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
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setLocation(`/dashboard/contacts/${contact.id}`); }} data-testid={`button-view-${contact.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} data-testid={`button-actions-${contact.id}`}>
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
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
