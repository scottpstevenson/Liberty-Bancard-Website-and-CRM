import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Star, AlertTriangle, Plus, Trash2, Mail,
  CheckCircle2, XCircle, Shield, HelpCircle, MapPin, Search
} from "lucide-react";
import type { Contact } from "@shared/schema";

interface MaEvent {
  id: number;
  entityType: string;
  entityId: number;
  eventType: string;
  counterpartyName: string | null;
  counterpartyContactId: number | null;
  eventDate: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

interface EmailHealthSummary {
  total: number;
  active: number;
  bounced: number;
  invalid: number;
  optedOut: number;
  roleBased: number;
  contacts: {
    id: number;
    email: string | null;
    emailStatus: string | null;
    firstName: string;
    lastName: string;
    companyName: string | null;
  }[];
}

interface ContactSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: "text-green-600",
  bounced: "text-red-600",
  invalid: "text-red-500",
  "opted-out": "text-orange-500",
  "role-based": "text-yellow-600",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0",
  bounced: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0",
  invalid: "bg-red-100 text-red-800 border-0",
  "opted-out": "bg-orange-100 text-orange-800 border-0",
  "role-based": "bg-yellow-100 text-yellow-800 border-0",
};

const MA_EVENT_LABELS: Record<string, string> = {
  acquired: "Acquired",
  merged_into: "Merged Into",
  rebranded: "Rebranded",
  closed: "Closed Down",
  ownership_change: "Ownership Change",
};

function ManagementTypePill({ value }: { value: string | null }) {
  if (!value || value === "unknown") return <Badge variant="secondary" data-testid="mgmt-type-unknown">Unknown</Badge>;
  if (value === "unified") return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0" data-testid="mgmt-type-unified">Unified</Badge>;
  return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-0" data-testid="mgmt-type-per-location">Per Location</Badge>;
}

function ManagementTypeSection({ contact }: { contact: Contact }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const setMgmtType = useMutation({
    mutationFn: (managementType: string) =>
      apiRequest("PATCH", `/api/contacts/${contact.id}/management-type`, { managementType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      toast({ title: "Updated", description: "Management type saved." });
    },
    onError: () => toast({ title: "Error", description: "Could not update.", variant: "destructive" }),
  });

  return (
    <Card data-testid="card-management-type">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-500" />
          Management Type
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <ManagementTypePill value={(contact as any).managementType ?? "unknown"} />
          <Select
            value={(contact as any).managementType ?? "unknown"}
            onValueChange={(v) => setMgmtType.mutate(v)}
            disabled={setMgmtType.isPending}
          >
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-mgmt-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unified">Unified</SelectItem>
              <SelectItem value="per_location">Per Location</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Indicates whether this multi-location business makes purchasing decisions centrally or at each location.
        </p>
      </CardContent>
    </Card>
  );
}

function EmailHealthSection({ contactId }: { contactId: number }) {
  const { data, isLoading } = useQuery<EmailHealthSummary>({
    queryKey: [`/api/contacts/${contactId}/email-health`],
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  return (
    <Card data-testid="card-email-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4 text-purple-500" />
          Email Health — All Locations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { label: "Active", key: "active", color: "text-green-600" },
            { label: "Bounced", key: "bounced", color: "text-red-600" },
            { label: "Invalid", key: "invalid", color: "text-red-500" },
            { label: "Opted Out", key: "optedOut", color: "text-orange-500" },
            { label: "Role-Based", key: "roleBased", color: "text-yellow-600" },
          ].map(({ label, key, color }) => (
            <div key={key} className="text-center">
              <div className={`text-lg font-bold ${color}`} data-testid={`email-health-${key}`}>{(data as any)[key] ?? 0}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        {/* Per-location list */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Child Locations ({data.contacts.length})
          </div>
          {data.contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No child locations found.</p>
          ) : (
            data.contacts.map(c => (
              <div key={c.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0" data-testid={`location-row-${c.id}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate font-medium">{c.firstName} {c.lastName}</span>
                  {c.companyName && <span className="text-muted-foreground truncate">— {c.companyName}</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {c.email && <span className="text-muted-foreground">{c.email}</span>}
                  <Badge className={`${STATUS_BADGE[c.emailStatus ?? "active"] ?? "bg-gray-100 text-gray-700 border-0"} text-[10px] px-1.5 py-0`} data-testid={`location-email-status-${c.id}`}>
                    {c.emailStatus ?? "active"}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>

        {data.bounced > 0 && (
          <div className="mt-3 p-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
            <div className="text-xs font-medium text-red-700 dark:text-red-400 mb-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {data.bounced} bounced contact{data.bounced > 1 ? "s" : ""} — outreach blocked
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CounterpartyPicker({
  value,
  onSelect,
}: {
  value: { id: number; name: string } | null;
  onSelect: (contact: { id: number; name: string } | null) => void;
}) {
  const [search, setSearch] = useState("");

  const { data: results = [] } = useQuery<ContactSearchResult[]>({
    queryKey: ["/api/contacts", { search }],
    queryFn: () => fetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`).then(r => r.json()),
    enabled: search.length >= 2,
  });

  return (
    <div className="space-y-1">
      <Label>Counterparty (CRM Contact)</Label>
      {value ? (
        <div className="flex items-center justify-between border rounded px-3 py-2 bg-muted/30">
          <span className="text-sm font-medium">{value.name}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelect(null)} data-testid="btn-clear-counterparty">
            Clear
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-7"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-counterparty-search"
          />
          {results.length > 0 && (
            <div className="absolute z-50 w-full mt-1 border rounded bg-background shadow-md max-h-40 overflow-y-auto">
              {results.map(c => (
                <button
                  key={c.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                  onClick={() => {
                    onSelect({ id: c.id, name: `${c.firstName} ${c.lastName}${c.companyName ? ` (${c.companyName})` : ""}` });
                    setSearch("");
                  }}
                  data-testid={`counterparty-option-${c.id}`}
                >
                  <span className="font-medium">{c.firstName} {c.lastName}</span>
                  {c.companyName && <span className="text-muted-foreground ml-1">— {c.companyName}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Selecting a CRM contact creates a linked entity relationship. Optional — leave blank for external parties.
      </p>
    </div>
  );
}

function MaEventsSection({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [counterparty, setCounterparty] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState({
    eventType: "acquired",
    counterpartyName: "",
    eventDate: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const { data: events, isLoading } = useQuery<MaEvent[]>({
    queryKey: ["/api/ma-events", contactId],
    queryFn: () => fetch(`/api/ma-events?entityType=contact&entityId=${contactId}`).then(r => r.json()),
  });

  const createEvent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ma-events", {
      entityType: "contact",
      entityId: contactId,
      eventType: form.eventType,
      counterpartyName: counterparty?.name ?? (form.counterpartyName || null),
      counterpartyContactId: counterparty?.id ?? null,
      eventDate: form.eventDate,
      note: form.note || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ma-events", contactId] });
      setOpen(false);
      setCounterparty(null);
      setForm({ eventType: "acquired", counterpartyName: "", eventDate: new Date().toISOString().slice(0, 10), note: "" });
      toast({ title: "M&A Event logged" });
    },
    onError: () => toast({ title: "Error", description: "Could not save event.", variant: "destructive" }),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ma-events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ma-events", contactId] });
      toast({ title: "Event deleted" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  return (
    <Card data-testid="card-ma-events">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-indigo-500" />
            M&amp;A / Ownership Events
          </CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="btn-add-ma-event">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log M&amp;A Event</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div>
                  <Label>Event Type</Label>
                  <Select value={form.eventType} onValueChange={v => setForm(f => ({ ...f, eventType: v }))}>
                    <SelectTrigger data-testid="select-event-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="acquired">Acquired</SelectItem>
                      <SelectItem value="merged_into">Merged Into</SelectItem>
                      <SelectItem value="rebranded">Rebranded</SelectItem>
                      <SelectItem value="closed">Closed Down</SelectItem>
                      <SelectItem value="ownership_change">Ownership Change</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <CounterpartyPicker value={counterparty} onSelect={setCounterparty} />
                {!counterparty && (
                  <div>
                    <Label>Counterparty Name (external / free-text)</Label>
                    <Input
                      value={form.counterpartyName}
                      onChange={e => setForm(f => ({ ...f, counterpartyName: e.target.value }))}
                      placeholder="e.g. Acquirer Corp"
                      data-testid="input-counterparty-name"
                    />
                  </div>
                )}
                <div>
                  <Label>Event Date</Label>
                  <Input type="date" value={form.eventDate} onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))} data-testid="input-event-date" />
                </div>
                <div>
                  <Label>Note (optional)</Label>
                  <Textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} data-testid="input-event-note" />
                </div>
                <Button className="w-full" onClick={() => createEvent.mutate()} disabled={createEvent.isPending} data-testid="btn-submit-ma-event">
                  Save Event
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-ma-events">No M&amp;A events logged.</p>
        ) : (
          <div className="space-y-2">
            {events.map(event => (
              <div key={event.id} className="flex items-start justify-between p-2 rounded border bg-muted/30" data-testid={`ma-event-${event.id}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{MA_EVENT_LABELS[event.eventType] ?? event.eventType}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(event.eventDate).toLocaleDateString()}</span>
                    {event.counterpartyContactId && (
                      <Badge variant="outline" className="text-xs border-indigo-300 text-indigo-700">linked</Badge>
                    )}
                  </div>
                  {event.counterpartyName && (
                    <div className="text-xs mt-0.5">→ {event.counterpartyName}</div>
                  )}
                  {event.note && <div className="text-xs text-muted-foreground mt-0.5">{event.note}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteEvent.mutate(event.id)} data-testid={`btn-delete-ma-event-${event.id}`}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CompanyIntelligenceTab({ contact }: { contact: Contact }) {
  return (
    <div className="space-y-4 mt-2" data-testid="company-intelligence-content">
      <ManagementTypeSection contact={contact} />
      <EmailHealthSection contactId={contact.id} />
      <MaEventsSection contactId={contact.id} />
    </div>
  );
}
