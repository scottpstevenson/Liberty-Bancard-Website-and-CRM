import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { SourceQualityData } from "./types";

interface WeeklyKpiData {
  period: { start: string; end: string };
  topFunnel: { leadsFound: number; leadsEnriched: number; enrichmentRate: number; hotCreated: number; warmCreated: number };
  outreach: { emailsSent: number; smsSent: number; callsMade: number; replies: number; replyRate: number; meetingsBooked: number };
  midFunnel: { statementsReceived: number; proposalsSent: number };
  bottomFunnel: { closedWon: number; closedLost: number; winRate: number };
  verticalPerformance: { vertical: string; leads: number; replies: number; meetings: number; closedWon: number }[];
  sourceQuality: SourceQualityData[];
  identityHealth: { label: string; domain: string; healthScore: number; alert: string | null }[];
  expansionSuggestions: { reason: string }[];
}

export function WeeklyKpiReport() {
  const { data, isLoading } = useQuery<WeeklyKpiData>({
    queryKey: ["/api/sdr/weekly-kpi"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const sections = [
    { title: "Top of Funnel", items: [
      { label: "Leads Found", value: data.topFunnel.leadsFound },
      { label: "Enriched", value: `${data.topFunnel.leadsEnriched} (${data.topFunnel.enrichmentRate}%)` },
      { label: "Hot Leads", value: data.topFunnel.hotCreated },
      { label: "Warm Leads", value: data.topFunnel.warmCreated },
    ]},
    { title: "Outreach", items: [
      { label: "Emails Sent", value: data.outreach.emailsSent },
      { label: "SMS Sent", value: data.outreach.smsSent },
      { label: "Calls Made", value: data.outreach.callsMade },
      { label: "Replies", value: `${data.outreach.replies} (${data.outreach.replyRate}%)` },
      { label: "Meetings Booked", value: data.outreach.meetingsBooked },
    ]},
    { title: "Mid Funnel", items: [
      { label: "Statements Received", value: data.midFunnel.statementsReceived },
      { label: "Proposals Sent", value: data.midFunnel.proposalsSent },
    ]},
    { title: "Bottom Funnel", items: [
      { label: "Closed Won", value: data.bottomFunnel.closedWon },
      { label: "Closed Lost", value: data.bottomFunnel.closedLost },
      { label: "Win Rate", value: `${data.bottomFunnel.winRate}%` },
    ]},
  ];

  return (
    <div className="space-y-4" data-testid="section-weekly-kpi">
      <div className="text-sm text-muted-foreground" data-testid="text-kpi-period">
        Week of {data.period.start} to {data.period.end}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {sections.map((section) => (
          <Card key={section.title} data-testid={`card-kpi-${section.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.verticalPerformance.length > 0 && (
        <Card data-testid="card-kpi-verticals">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Vertical Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Vertical</th>
                    <th className="text-right py-2 px-3 font-medium">Leads</th>
                    <th className="text-right py-2 px-3 font-medium">Replies</th>
                    <th className="text-right py-2 px-3 font-medium">Meetings</th>
                    <th className="text-right py-2 px-3 font-medium">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verticalPerformance.map((v) => (
                    <tr key={v.vertical} className="border-b border-muted" data-testid={`kpi-vertical-${v.vertical}`}>
                      <td className="py-2 px-3">{v.vertical}</td>
                      <td className="text-right py-2 px-3">{v.leads}</td>
                      <td className="text-right py-2 px-3">{v.replies}</td>
                      <td className="text-right py-2 px-3">{v.meetings}</td>
                      <td className="text-right py-2 px-3 font-medium">{v.closedWon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
