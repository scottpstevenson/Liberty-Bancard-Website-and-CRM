import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, ShieldOff, AlertTriangle, CheckCircle2, XCircle, Ban } from "lucide-react";
import { useState } from "react";
import type { Contact } from "@shared/schema";
import { DetailRow } from "./shared";

interface OverviewTabProps {
  contact: Contact;
  dealsCount: number;
  openTicketsCount: number;
  pendingTasksCount: number;
}

// ── Suppression Status Card ───────────────────────────────────────────────────
interface SuppressionStatus {
  isSuppressed: boolean;
  suppressionReasons: string[];
  doNotContact: boolean;
  dncReason?: string;
  dncDate?: string;
  dncSource?: string;
  optOutStatus?: string;
  optOutDate?: string;
  unsubscribeStatus?: string;
  unsubscribeDate?: string;
  bounceStatus?: string;
  bounceReason?: string;
  complaintStatus?: string;
  emailStatus?: string;
  smsConsentStatus?: string;
  suppressionHistory?: Array<{ reason: string; source: string; date: string }>;
}

function SuppressionStatusCard({ contact }: { contact: Contact }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dncReason, setDncReason] = useState("");
  const [showDncForm, setShowDncForm] = useState(false);

  const { data: suppression, isLoading } = useQuery<SuppressionStatus>({
    queryKey: [`/api/contacts/${contact.id}/suppression-status`],
    staleTime: 30_000,
  });

  const markDnc = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contacts/${contact.id}/mark-dnc`, { reason: dncReason, source: "manual_crm" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      qc.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}/suppression-status`] });
      toast({ title: "Contact marked Do Not Contact", description: dncReason });
      setDncReason("");
      setShowDncForm(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message ?? "Could not update", variant: "destructive" }),
  });

  const statusBadge = (label: string, active: boolean, activeVariant: "destructive" | "secondary" = "destructive") => (
    <Badge variant={active ? activeVariant : "outline"} className={active ? "" : "opacity-50"}>
      {active ? <XCircle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
      {label}
    </Badge>
  );

  if (isLoading) return null;
  const s = suppression;

  return (
    <Card data-testid="card-suppression-status">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-red-500" />
          Compliance &amp; Suppression
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {s?.isSuppressed && (
          <div className="flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-400 font-medium">
              Suppressed — all automated sends blocked
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {statusBadge("Do Not Contact", !!s?.doNotContact)}
          {statusBadge("Opted Out", s?.optOutStatus === "opted_out")}
          {statusBadge("Unsubscribed", s?.unsubscribeStatus === "unsubscribed")}
          {statusBadge("Hard Bounce", s?.bounceStatus === "hard")}
          {statusBadge("Complaint", s?.complaintStatus === "reported")}
          {statusBadge("SMS Consent", s?.smsConsentStatus === "opted_in", "secondary")}
        </div>

        {s?.doNotContact && s.dncReason && (
          <p className="text-xs text-muted-foreground">
            DNC reason: <span className="font-medium">{s.dncReason}</span>
            {s.dncDate && ` — ${new Date(s.dncDate).toLocaleDateString()}`}
          </p>
        )}

        {!s?.doNotContact && (
          showDncForm ? (
            <div className="space-y-2">
              <Label className="text-xs">Reason for DNC (required)</Label>
              <Input
                value={dncReason}
                onChange={e => setDncReason(e.target.value)}
                placeholder="e.g. Requested no contact by phone"
                className="text-sm h-8"
                data-testid="input-dnc-reason"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={dncReason.trim().length < 3 || markDnc.isPending}
                  onClick={() => markDnc.mutate()}
                  className="gap-1"
                  data-testid="btn-confirm-dnc"
                >
                  <Ban className="w-3 h-3" /> Confirm DNC
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowDncForm(false); setDncReason(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
              onClick={() => setShowDncForm(true)}
              data-testid="btn-mark-dnc"
            >
              <Ban className="w-3 h-3" /> Mark Do Not Contact
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

function DecisionMakerCard({ contact }: { contact: Contact }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const toggleDm = useMutation({
    mutationFn: (isDecisionMaker: boolean) =>
      apiRequest("PATCH", `/api/contacts/${contact.id}/decision-maker`, { isDecisionMaker }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      toast({ title: "Updated", description: "Decision maker status saved." });
    },
    onError: () => toast({ title: "Error", description: "Could not update status.", variant: "destructive" }),
  });

  return (
    <Card data-testid="card-decision-maker">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          Decision Maker
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            {contact.isDecisionMaker ? (
              <Badge className="bg-amber-500 text-white border-0" data-testid="badge-is-dm">Decision Maker</Badge>
            ) : (
              <Badge variant="secondary" data-testid="badge-not-dm">Not a Decision Maker</Badge>
            )}
            {contact.decisionMakerConfidence != null && contact.decisionMakerConfidence > 0 && (
              <div className="text-xs text-muted-foreground mt-1" data-testid="dm-confidence">
                AI confidence: {contact.decisionMakerConfidence}%
              </div>
            )}
            {contact.title && (
              <div className="text-xs text-muted-foreground mt-0.5">Title: {contact.title}</div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleDm.mutate(!contact.isDecisionMaker)}
            disabled={toggleDm.isPending}
            data-testid="btn-toggle-dm"
          >
            {contact.isDecisionMaker ? "Mark as Not DM" : "Mark as DM"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ contact, dealsCount, openTicketsCount, pendingTasksCount }: OverviewTabProps) {
  return (
    <div className="space-y-4">
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
                <span className="font-medium" data-testid="text-deal-count">{dealsCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Open Tickets</span>
                <span className="font-medium" data-testid="text-open-tickets">{openTicketsCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending Tasks</span>
                <span className="font-medium" data-testid="text-pending-tasks">{pendingTasksCount}</span>
              </div>
            </CardContent>
          </Card>

          <DecisionMakerCard contact={contact} />
          <SuppressionStatusCard contact={contact} />
        </div>
      </div>
    </div>
  );
}
