import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Building2, Globe, MapPin, HelpCircle, Plus, Trash2,
  Star, Mail, AlertTriangle, Search, CheckCircle2, XCircle, Shield, Users
} from "lucide-react";
import { useState } from "react";

interface Company {
  id: number;
  legalName: string;
  dba: string | null;
  vertical: string | null;
  address: string | null;
  website: string | null;
  volumeRange: string | null;
  currentProvider: string | null;
  notes: string | null;
  managementType: string;
}

interface CompanyContact {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  emailStatus: string | null;
  isDecisionMaker: boolean;
  decisionMakerConfidence: number;
  title: string | null;
  companyName: string | null;
  bouncedAt: string | null;
}

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
}

interface ContactSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
}

const MA_EVENT_LABELS: Record<string, string> = {
  acquired: "Acquired",
  merged_into: "Merged Into",
  rebranded: "Rebranded",
  closed: "Closed Down",
  ownership_change: "Ownership Change",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0",
  bounced: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0",
  invalid: "bg-red-100 text-red-800 border-0",
  "opted-out": "bg-orange-100 text-orange-800 border-0",
  "role-based": "bg-yellow-100 text-yellow-800 border-0",
};

function ManagementTypePill({ value }: { value: string | null }) {
  if (!value || value === "unknown") return <Badge variant="secondary">Unknown</Badge>;
  if (value === "unified") return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0">Unified (Corporate Buyer)</Badge>;
  return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-0">Per Location</Badge>;
}

function CounterpartyPicker({
  value,
  onSelect,
}: {
  value: { id: number; name: string } | null;
  onSelect: (c: { id: number; name: string } | null) => void;
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
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelect(null)} data-testid="btn-clear-counterparty">Clear</Button>
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

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const companyId = Number(id);

  const [maOpen, setMaOpen] = useState(false);
  const [counterparty, setCounterparty] = useState<{ id: number; name: string } | null>(null);
  const [maForm, setMaForm] = useState({
    eventType: "acquired",
    counterpartyName: "",
    eventDate: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: [`/api/companies/${companyId}`],
  });

  const { data: linkedContacts = [] } = useQuery<CompanyContact[]>({
    queryKey: [`/api/companies/${companyId}/contacts`],
    enabled: !!companyId,
  });

  const { data: events = [] } = useQuery<MaEvent[]>({
    queryKey: ["/api/ma-events", "company", companyId],
    queryFn: () => fetch(`/api/ma-events?entityType=company&entityId=${companyId}`).then(r => r.json()),
    enabled: !!companyId,
  });

  const setMgmtType = useMutation({
    mutationFn: (managementType: string) =>
      apiRequest("PATCH", `/api/companies/${companyId}/management-type`, { managementType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/companies/${companyId}`] });
      qc.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Management type updated" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const createMaEvent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ma-events", {
      entityType: "company",
      entityId: companyId,
      eventType: maForm.eventType,
      counterpartyName: counterparty?.name ?? maForm.counterpartyName || null,
      counterpartyContactId: counterparty?.id ?? null,
      eventDate: maForm.eventDate,
      note: maForm.note || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ma-events", "company", companyId] });
      setMaOpen(false);
      setCounterparty(null);
      setMaForm({ eventType: "acquired", counterpartyName: "", eventDate: new Date().toISOString().slice(0, 10), note: "" });
      toast({ title: "M&A Event logged" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteMaEvent = useMutation({
    mutationFn: (eventId: number) => apiRequest("DELETE", `/api/ma-events/${eventId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ma-events", "company", companyId] });
      toast({ title: "Event deleted" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="container max-w-4xl mx-auto py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="container max-w-4xl mx-auto py-6">
        <p className="text-muted-foreground">Company not found.</p>
      </div>
    );
  }

  const decisionMakers = linkedContacts.filter(c => c.isDecisionMaker);
  const bouncedCount = linkedContacts.filter(c => c.emailStatus === "bounced").length;
  const activeCount = linkedContacts.filter(c => !c.emailStatus || c.emailStatus === "active").length;

  return (
    <div className="container max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard/contacts")} data-testid="btn-back-company">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{company.legalName}</h1>
          {company.dba && <p className="text-muted-foreground text-sm">DBA: {company.dba}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Company Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {company.vertical && <div><span className="text-muted-foreground">Vertical:</span> {company.vertical}</div>}
            {company.address && <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" /> {company.address}</div>}
            {company.website && <div className="flex items-center gap-1"><Globe className="h-3 w-3 text-muted-foreground" /> <a href={`https://${company.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{company.website}</a></div>}
            {company.volumeRange && <div><span className="text-muted-foreground">Volume:</span> {company.volumeRange}</div>}
            {company.currentProvider && <div><span className="text-muted-foreground">Current Provider:</span> {company.currentProvider}</div>}
          </CardContent>
        </Card>

        <Card data-testid="card-company-management-type">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Star className="h-4 w-4 text-blue-500" /> Management Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-2">
              <ManagementTypePill value={company.managementType} />
            </div>
            <Select
              value={company.managementType ?? "unknown"}
              onValueChange={(v) => setMgmtType.mutate(v)}
              disabled={setMgmtType.isPending}
            >
              <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-company-mgmt-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unified">Unified (Corporate Buyer)</SelectItem>
                <SelectItem value="per_location">Per Location</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              Unified = corporate purchasing for all locations. Per Location = each site decides independently.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Linked Contacts — Delivery Health & Decision Maker Status */}
      <Card data-testid="card-company-contacts">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-purple-500" /> Linked Contacts — Delivery Health &amp; Decision Makers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {linkedContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No contacts linked to this company.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-green-600" data-testid="company-active-contacts">{activeCount}</div>
                  <div className="text-xs text-muted-foreground">Active Email</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${bouncedCount > 0 ? "text-red-600" : "text-muted-foreground"}`} data-testid="company-bounced-contacts">{bouncedCount}</div>
                  <div className="text-xs text-muted-foreground">Bounced</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-amber-600" data-testid="company-dm-contacts">{decisionMakers.length}</div>
                  <div className="text-xs text-muted-foreground">Decision Makers</div>
                </div>
              </div>

              {bouncedCount > 0 && (
                <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                  <span className="text-xs text-red-700 dark:text-red-400">{bouncedCount} contact{bouncedCount > 1 ? "s" : ""} bounced — outreach may be blocked for affected contacts</span>
                </div>
              )}

              <div className="space-y-1.5">
                {linkedContacts.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs py-1.5 px-2 border rounded hover:bg-muted/30" data-testid={`company-contact-row-${c.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        className="font-medium hover:text-primary hover:underline text-left"
                        onClick={() => setLocation(`/dashboard/contacts/${c.id}`)}
                        data-testid={`link-contact-${c.id}`}
                      >
                        {c.firstName} {c.lastName}
                      </button>
                      {c.title && <span className="text-muted-foreground truncate">— {c.title}</span>}
                      {c.isDecisionMaker && (
                        <Badge className="bg-amber-500 text-white border-0 text-[10px] px-1.5 py-0 shrink-0" data-testid={`badge-dm-${c.id}`}>DM</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {c.email && <span className="text-muted-foreground hidden sm:block">{c.email}</span>}
                      <Badge
                        className={`${STATUS_BADGE[c.emailStatus ?? "active"] ?? "bg-gray-100 text-gray-700 border-0"} text-[10px] px-1.5 py-0`}
                        data-testid={`badge-email-status-${c.id}`}
                      >
                        {c.emailStatus ?? "active"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* M&A / Ownership Events */}
      <Card data-testid="card-company-ma-events">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-indigo-500" /> M&amp;A / Ownership Events
            </CardTitle>
            <Dialog open={maOpen} onOpenChange={setMaOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="btn-add-company-ma-event">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Event
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Log M&amp;A Event</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div>
                    <Label>Event Type</Label>
                    <Select value={maForm.eventType} onValueChange={v => setMaForm(f => ({ ...f, eventType: v }))}>
                      <SelectTrigger data-testid="select-company-event-type"><SelectValue /></SelectTrigger>
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
                        value={maForm.counterpartyName}
                        onChange={e => setMaForm(f => ({ ...f, counterpartyName: e.target.value }))}
                        placeholder="e.g. Acquirer Corp"
                        data-testid="input-company-counterparty"
                      />
                    </div>
                  )}
                  <div>
                    <Label>Event Date</Label>
                    <Input type="date" value={maForm.eventDate} onChange={e => setMaForm(f => ({ ...f, eventDate: e.target.value }))} data-testid="input-company-event-date" />
                  </div>
                  <div>
                    <Label>Note (optional)</Label>
                    <Textarea value={maForm.note} onChange={e => setMaForm(f => ({ ...f, note: e.target.value }))} rows={2} data-testid="input-company-event-note" />
                  </div>
                  <Button className="w-full" onClick={() => createMaEvent.mutate()} disabled={createMaEvent.isPending} data-testid="btn-submit-company-ma-event">
                    Save Event
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-company-ma-events">No M&amp;A events logged.</p>
          ) : (
            <div className="space-y-2">
              {events.map(event => (
                <div key={event.id} className="flex items-start justify-between p-2 rounded border bg-muted/30" data-testid={`company-ma-event-${event.id}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{MA_EVENT_LABELS[event.eventType] ?? event.eventType}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(event.eventDate).toLocaleDateString()}</span>
                      {event.counterpartyContactId && (
                        <Badge variant="outline" className="text-xs border-indigo-300 text-indigo-700">linked</Badge>
                      )}
                    </div>
                    {event.counterpartyName && <div className="text-xs mt-0.5">→ {event.counterpartyName}</div>}
                    {event.note && <div className="text-xs text-muted-foreground mt-0.5">{event.note}</div>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteMaEvent.mutate(event.id)} data-testid={`btn-delete-company-ma-event-${event.id}`}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {company.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{company.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
