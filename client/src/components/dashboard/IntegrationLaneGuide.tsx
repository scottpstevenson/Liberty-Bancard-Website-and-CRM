import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Which system does what when a request arrives, and where each one is controlled. Every row names its own owner
 * and what the control does, so a saved workflow ID is never read as permission to send. Wording and timing
 * claims for customers are not written here: they come from the reviewed message wording and the approved
 * claims process.
 */
export const INTEGRATION_LANES: ReadonlyArray<{
  key: string; lane: string; effect: string; control: string; href: string | null;
}> = [
  { key: "receipt", lane: "Request receipt",
    effect: "A transactional email Replit sends once per request, using the reviewed wording. It is the only confirmation of a submitted request.",
    control: "GHL Integration → Settings → Request receipts", href: "/dashboard/ghl-integration?tab=settings" },
  { key: "internal", lane: "Internal task and notification",
    effect: "Creates the follow-up task and tells the team a request arrived. It sends nothing to the person who asked.",
    control: "Owned by the request intake service; no setting here", href: null },
  { key: "website", lane: "Opted-in website follow-up",
    effect: "A separate, default-closed email lane for people who opted in on the website. It has its own approval, pause and release.",
    control: "Outbound Readiness → Website email follow-up lane", href: "/dashboard/outbound-readiness" },
  { key: "cold", lane: "Cold outreach sequences",
    effect: "Replit's sequence engine decides eligibility, timing and suppression. Sequences start paused and stay under the global outbound pause.",
    control: "Sequences and Outbound Readiness", href: "/dashboard/outbound-readiness" },
  { key: "export", lane: "GHL contact sync and export",
    effect: "Moves contact records between Replit and GHL under its own switches. Syncing a contact does not message anyone.",
    control: "GHL Integration → Settings → Sync", href: "/dashboard/ghl-integration?tab=settings" },
  { key: "booking", lane: "Booking",
    effect: "Appointments are scheduled and cancelled locally. A booking handoff workflow, if used, only mirrors an appointment that already exists.",
    control: "GHL Integration → Workflow IDs", href: "/dashboard/ghl-integration?tab=workflow-ids" },
  { key: "native", lane: "Native GHL workflow installation",
    effect: "Building or publishing a workflow in GHL is a separate, reviewed step. A saved workflow ID alone never starts a message or an enrollment.",
    control: "GHL Integration → Workflow IDs (reference and handoff slots)", href: "/dashboard/ghl-integration?tab=workflow-ids" },
];

export function IntegrationLaneGuide() {
  return (
    <Card data-testid="integration-lane-guide">
      <CardHeader>
        <CardTitle className="text-base">What sends, what records, and where each is controlled</CardTitle>
        <CardDescription>
          Each lane is controlled separately. Configuring one does not enable another, and none of them is switched on by saving a GHL workflow ID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {INTEGRATION_LANES.map(row => (
            <div key={row.key} className="grid gap-1 py-2 md:grid-cols-[14rem_1fr_16rem]" data-testid={`integration-lane-${row.key}`}>
              <dt className="font-medium">{row.lane}</dt>
              <dd className="text-muted-foreground">{row.effect}</dd>
              <dd className="text-xs">
                {row.href ? <Link href={row.href} className="underline">{row.control}</Link> : row.control}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
