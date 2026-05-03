import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Contact } from "@shared/schema";
import { DetailRow } from "./shared";

interface OverviewTabProps {
  contact: Contact;
  dealsCount: number;
  openTicketsCount: number;
  pendingTasksCount: number;
}

export function OverviewTab({ contact, dealsCount, openTicketsCount, pendingTasksCount }: OverviewTabProps) {
  return (
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">UTM &amp; Lead Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <DetailRow label="UTM Source" value={contact.utmSource} />
            <DetailRow label="UTM Medium" value={contact.utmMedium} />
            <DetailRow label="UTM Campaign" value={contact.utmCampaign} />
            <DetailRow label="UTM Content" value={contact.utmContent} />
            <DetailRow label="UTM Term" value={contact.utmTerm} />
            <DetailRow label="Landing Page" value={contact.landingPage} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
