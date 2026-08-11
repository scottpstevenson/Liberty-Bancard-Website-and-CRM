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
  onOpenTicketsClick?: () => void; // #602 — navigate to tickets tab
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

export function OverviewTab({ contact, dealsCount, openTicketsCount, pendingTasksCount, onOpenTicketsClick }: OverviewTabProps) {
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
            {/* #1146 — Company size (employee count) */}
            {(contact as any).employeeCount != null && (
              <DetailRow label="Employees" value={String((contact as any).employeeCount)} />
            )}
            <DetailRow label="Primary Offer Path" value={contact.primaryOfferPath} />
            <DetailRow label="Interested in 0%" value={contact.interestedIn0Percent ? "Yes" : "No"} />
            <DetailRow label="Needs Terminal" value={contact.needTerminal ? "Yes" : "No"} />
            <DetailRow label="SMS Consent" value={contact.consentSms ? "Yes" : "No"} />
            <DetailRow label="Email Consent" value={contact.consentEmail ? "Yes" : "No"} />
            <DetailRow label="Do Not Contact" value={contact.doNotContact ? "Yes" : "No"} />
            {/* #456 — Referral source */}
            {contact.referralSource && <DetailRow label="Referral Source" value={contact.referralSource} />}
            {/* #515 — Lead source */}
            {(contact as any).leadSource && <DetailRow label="Lead Source" value={((contact as any).leadSource as string).replace(/_/g, " ")} />}
            {/* #485 — Assigned rep */}
            {(contact as any).assignedTo && <DetailRow label="Assigned Rep" value={(contact as any).assignedTo.split("@")[0]} />}
            {/* #520 — Lifecycle state */}
            {(contact as any).lifecycleState && <DetailRow label="Lifecycle State" value={((contact as any).lifecycleState as string).replace(/_/g, " ")} />}
            {/* #471 — Timezone display */}
            {(contact as any).timezone && (
              <div className="flex items-center gap-2 text-xs" data-testid="row-timezone">
                <span className="text-muted-foreground w-28 shrink-0">Timezone</span>
                <span className="font-medium">{(contact as any).timezone}</span>
              </div>
            )}
            {/* #532 — Social media links */}
            {(contact as any).linkedinUrl && (
              <div className="flex items-center gap-2 text-xs" data-testid="row-linkedin-url">
                <span className="text-muted-foreground w-28 shrink-0">LinkedIn</span>
                <a href={(contact as any).linkedinUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 truncate hover:underline">
                  {((contact as any).linkedinUrl as string).replace(/^https?:\/\/(www\.)?linkedin\.com\//i, "in/")}
                </a>
              </div>
            )}
            {(contact as any).facebookUrl && (
              <div className="flex items-center gap-2 text-xs" data-testid="row-facebook-url">
                <span className="text-muted-foreground w-28 shrink-0">Facebook</span>
                <a href={(contact as any).facebookUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 truncate hover:underline">
                  {((contact as any).facebookUrl as string).replace(/^https?:\/\/(www\.)?facebook\.com\//i, "fb/")}
                </a>
              </div>
            )}
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
              {/* #436 — Total deal value for this contact */}
              {(contact as any).deals && Array.isArray((contact as any).deals) && (() => {
                const dealValues = ((contact as any).deals as any[])
                  .filter(d => !d.archivedAt)
                  .map(d => parseFloat(d.totalVolume || d.monthlyVolume || "0") || 0);
                const totalVal = dealValues.reduce((s, v) => s + v, 0);
                if (totalVal <= 0) return null;
                return (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Deal Volume</span>
                    <span className="font-medium" data-testid="text-total-deal-volume">
                      ${totalVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                    </span>
                  </div>
                );
              })()}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Open Tickets</span>
                {/* #602 — click to jump to Tickets tab */}
                {onOpenTicketsClick ? (
                  <button
                    onClick={onOpenTicketsClick}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    data-testid="text-open-tickets"
                  >{openTicketsCount}</button>
                ) : (
                  <span className="font-medium" data-testid="text-open-tickets">{openTicketsCount}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending Tasks</span>
                <span className="font-medium" data-testid="text-pending-tasks">{pendingTasksCount}</span>
              </div>
              {/* #475 — Days since created */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days Since Added</span>
                <span className="font-medium" data-testid="text-days-since-created">
                  {contact.createdAt ? Math.floor((Date.now() - new Date(contact.createdAt).getTime()) / 86400000) : "—"}d
                </span>
              </div>
              {/* #870 — Outreach summary totals */}
              {((contact as any).totalCalls != null || (contact as any).totalEmails != null || (contact as any).totalSms != null) && (
                <div className="flex justify-between" data-testid="stat-outreach-summary">
                  <span className="text-muted-foreground">Total Outreach</span>
                  <span className="font-medium text-xs">
                    {(contact as any).totalCalls != null && <span title="Calls">📞{(contact as any).totalCalls}</span>}
                    {(contact as any).totalEmails != null && <span className="ml-1" title="Emails">✉️{(contact as any).totalEmails}</span>}
                    {(contact as any).totalSms != null && <span className="ml-1" title="SMS">💬{(contact as any).totalSms}</span>}
                  </span>
                </div>
              )}
              {/* #558 — Time since last contact */}
              {(contact as any).lastContactedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Contacted</span>
                  <span className="font-medium" data-testid="text-days-since-contact">
                    {Math.floor((Date.now() - new Date((contact as any).lastContactedAt).getTime()) / 86400000)}d ago
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <DecisionMakerCard contact={contact} />
          <SuppressionStatusCard contact={contact} />
        </div>
      </div>
    </div>
  );
}
