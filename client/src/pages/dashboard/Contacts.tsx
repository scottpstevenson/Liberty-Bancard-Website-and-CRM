import { useState } from "react";
import { useContacts, useCreateContact, useUpdateContact } from "@/hooks/use-contacts";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, MoreHorizontal, UserPlus, Mail, MessageSquare, Zap, AlertTriangle, Sparkles, Activity, ArrowRight, Clock, TrendingUp, Ticket } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

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
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search contacts..." 
            className="pl-9 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-md">
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

      <Dialog open={!!selectedContact} onOpenChange={(open) => { if (!open) setSelectedContact(null); }}>
        <DialogContent className="max-w-lg" data-testid="contact-detail-dialog">
          {selectedContact && (
            <>
              <DialogHeader>
                <DialogTitle data-testid="contact-detail-name">
                  {selectedContact.firstName} {selectedContact.lastName}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="font-medium" data-testid="contact-detail-email">{selectedContact.email}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone</span>
                    <p className="font-medium" data-testid="contact-detail-phone">{selectedContact.phone}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Company</span>
                    <p className="font-medium" data-testid="contact-detail-company">{selectedContact.companyName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p className="font-medium" data-testid="contact-detail-status">{selectedContact.status}</p>
                  </div>
                </div>
                <div className="border-t pt-2">
                  <ActivityTimeline entityType="contact" entityId={selectedContact.id} />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">Loading...</TableCell>
                </TableRow>
              ) : filteredContacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">No contacts found</TableCell>
                </TableRow>
              ) : (
                filteredContacts?.map((contact: any) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedContact(contact)}
                    data-testid={`contact-row-${contact.id}`}
                  >
                    <TableCell className="font-medium">{contact.firstName} {contact.lastName}</TableCell>
                    <TableCell>{contact.companyName}</TableCell>
                    <TableCell>{contact.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                        ${contact.status === 'New' ? 'bg-blue-100 text-blue-800' : 
                          contact.status === 'Won' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {contact.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
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
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
