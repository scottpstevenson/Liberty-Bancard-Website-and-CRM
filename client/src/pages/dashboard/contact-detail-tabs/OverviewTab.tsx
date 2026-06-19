import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import type { Contact } from "@shared/schema";
import { DetailRow } from "./shared";

interface OverviewTabProps {
  contact: Contact;
  dealsCount: number;
  openTicketsCount: number;
  pendingTasksCount: number;
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
        </div>
      </div>
    </div>
  );
}
