import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Star,
  Building2,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  RefreshCw,
  MapPin,
  Users,
  TrendingUp,
  Merge,
} from "lucide-react";

interface IntelligenceData {
  contactId: number;
  isDecisionMaker: boolean;
  decisionMakerConfidence: number;
  emailStatus: string;
  managementType: string;
  isParentAccount: boolean;
  maEvents: MaEvent[];
  childLocations: ChildLocation[];
}

interface MaEvent {
  id: number;
  entityType: string;
  entityId: number;
  eventType: string;
  counterpartyName?: string;
  eventDate?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
}

interface ChildLocation {
  id: number;
  name: string;
  companyName?: string;
  locationName?: string;
  emailStatus: string;
  email?: string;
}

const EMAIL_STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  active: { label: "Active", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle2 },
  bounced: { label: "Bounced", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertTriangle },
  invalid: { label: "Invalid", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertTriangle },
  "opted-out": { label: "Opted Out", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: AlertTriangle },
};

const MA_EVENT_LABELS: Record<string, string> = {
  acquired: "Acquired by",
  merged_into: "Merged into",
  rebranded: "Rebranded to",
  closed: "Business closed",
  spun_off: "Spun off as",
};

const MGMT_TYPE_LABELS: Record<string, string> = {
  unified: "Unified (single decision-maker)",
  per_location: "Per-location (each site manages independently)",
  unknown: "Unknown",
};

export function CompanyIntelligenceTab({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addMaOpen, setAddMaOpen] = useState(false);
  const [deleteMaId, setDeleteMaId] = useState<number | null>(null);

  const [maForm, setMaForm] = useState({
    eventType: "acquired" as string,
    counterpartyName: "",
    eventDate: "",
    note: "",
  });

  const { data: intel, isLoading } = useQuery<IntelligenceData>({
    queryKey: ["/api/contacts", contactId, "intelligence"],
    queryFn: () => fetch(`/api/contacts/${contactId}/intelligence`, { credentials: "include" }).then(r => r.json()),
  });

  const dmMutation = useMutation({
    mutationFn: (isDecisionMaker: boolean) =>
      apiRequest("PATCH", `/api/contacts/${contactId}/decision-maker`, { isDecisionMaker }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      toast({ title: "Decision maker status updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const mgmtMutation = useMutation({
    mutationFn: (managementType: string) =>
      apiRequest("PATCH", `/api/contacts/${contactId}/management-type`, { managementType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "intelligence"] });
      toast({ title: "Management type updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const addMaMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/ma-events", { ...data, entityType: "contact", entityId: contactId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "intelligence"] });
      toast({ title: "M&A event recorded" });
      setAddMaOpen(false);
      setMaForm({ eventType: "acquired", counterpartyName: "", eventDate: "", note: "" });
    },
    onError: (err: any) => toast({ title: "Failed to add event", description: err.message, variant: "destructive" }),
  });

  const deleteMaMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ma-events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "intelligence"] });
      toast({ title: "M&A event removed" });
      setDeleteMaId(null);
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!intel) return null;

  const emailMeta = EMAIL_STATUS_META[intel.emailStatus] ?? EMAIL_STATUS_META.active;
  const EmailIcon = emailMeta.icon;

  return (
    <div className="space-y-4 p-1">
      {/* Decision Maker + Email Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Decision Maker Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              Decision Maker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {intel.isDecisionMaker ? "Yes — primary decision maker" : "Not flagged as decision maker"}
                </p>
                {intel.decisionMakerConfidence > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Confidence: {intel.decisionMakerConfidence}%
                    {intel.decisionMakerConfidence === 100 ? " (manually set)" : " (AI-detected)"}
                  </p>
                )}
              </div>
              <Switch
                checked={intel.isDecisionMaker}
                onCheckedChange={v => dmMutation.mutate(v)}
                disabled={dmMutation.isPending}
                data-testid="toggle-decision-maker"
              />
            </div>
            {intel.isDecisionMaker && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                Gold star badge shown in contacts list
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Health Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              Email Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <EmailIcon className="h-4 w-4" />
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${emailMeta.color}`}>
                {emailMeta.label}
              </span>
            </div>
            {intel.emailStatus === "bounced" && (
              <p className="text-xs text-red-600 dark:text-red-400">
                This contact's email has bounced. They will be skipped in sequence enrollment.
              </p>
            )}
            {intel.emailStatus === "active" && (
              <p className="text-xs text-muted-foreground">
                Email is deliverable. Eligible for sequence enrollment.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Management Type */}
      {intel.isParentAccount && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              Management Structure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">How are payment decisions made across locations?</Label>
              <Select
                value={intel.managementType}
                onValueChange={v => mgmtMutation.mutate(v)}
              >
                <SelectTrigger data-testid="select-management-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="unified">Unified (one decision-maker for all)</SelectItem>
                  <SelectItem value="per_location">Per-location (each manages independently)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {MGMT_TYPE_LABELS[intel.managementType]}
              </p>
            </div>

            {/* Child Locations Email Health */}
            {intel.childLocations.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  {intel.childLocations.length} Child Location{intel.childLocations.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1.5">
                  {intel.childLocations.map(loc => {
                    const locMeta = EMAIL_STATUS_META[loc.emailStatus] ?? EMAIL_STATUS_META.active;
                    return (
                      <div key={loc.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                        <div>
                          <span className="font-medium">{loc.locationName || loc.companyName || loc.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{loc.email}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${locMeta.color}`}>{locMeta.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* M&A Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Merge className="h-4 w-4 text-slate-500" />
              M&A / Ownership Timeline
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAddMaOpen(true)} data-testid="button-add-ma-event">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Event
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {intel.maEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No M&A or ownership events recorded.</p>
          ) : (
            <div className="space-y-3">
              {intel.maEvents.map(evt => (
                <div key={evt.id} className="flex items-start justify-between gap-2 py-2 border-b last:border-0" data-testid={`ma-event-${evt.id}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium">
                        {MA_EVENT_LABELS[evt.eventType] || evt.eventType}
                        {evt.counterpartyName && <span className="font-normal text-muted-foreground"> {evt.counterpartyName}</span>}
                      </span>
                    </div>
                    {evt.eventDate && (
                      <p className="text-xs text-muted-foreground ml-5">
                        {new Date(evt.eventDate).toLocaleDateString()}
                      </p>
                    )}
                    {evt.note && (
                      <p className="text-xs text-muted-foreground ml-5 mt-0.5">{evt.note}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setDeleteMaId(evt.id)}
                    data-testid={`button-delete-ma-event-${evt.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add M&A Dialog */}
      <Dialog open={addMaOpen} onOpenChange={setAddMaOpen}>
        <DialogContent data-testid="dialog-add-ma-event">
          <DialogHeader>
            <DialogTitle>Record M&A / Ownership Event</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Event Type</Label>
              <Select value={maForm.eventType} onValueChange={v => setMaForm(p => ({ ...p, eventType: v }))}>
                <SelectTrigger data-testid="select-ma-event-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acquired">Acquired by another company</SelectItem>
                  <SelectItem value="merged_into">Merged into another entity</SelectItem>
                  <SelectItem value="rebranded">Rebranded / name change</SelectItem>
                  <SelectItem value="closed">Business closed</SelectItem>
                  <SelectItem value="spun_off">Spun off as new entity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Counterparty Name (optional)</Label>
              <Input
                placeholder="e.g. Acme Corp"
                value={maForm.counterpartyName}
                onChange={e => setMaForm(p => ({ ...p, counterpartyName: e.target.value }))}
                data-testid="input-ma-counterparty"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Event Date (optional)</Label>
              <Input
                type="date"
                value={maForm.eventDate}
                onChange={e => setMaForm(p => ({ ...p, eventDate: e.target.value }))}
                data-testid="input-ma-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea
                placeholder="Additional context about this event…"
                rows={3}
                value={maForm.note}
                onChange={e => setMaForm(p => ({ ...p, note: e.target.value }))}
                data-testid="textarea-ma-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMaOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMaMutation.mutate({ eventType: maForm.eventType, counterpartyName: maForm.counterpartyName || undefined, eventDate: maForm.eventDate || undefined, note: maForm.note || undefined })}
              disabled={addMaMutation.isPending}
              data-testid="button-confirm-add-ma"
            >
              {addMaMutation.isPending ? "Saving…" : "Save Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteMaId !== null} onOpenChange={o => !o && setDeleteMaId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMaId && deleteMaMutation.mutate(deleteMaId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
