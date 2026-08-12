import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Megaphone, ListOrdered, LineChart, Users } from "lucide-react";
import OutreachCommandPage from "./OutreachCommand";
import CampaignsPage from "./Campaigns";
import SequencesPage from "./Sequences";
import OutreachAnalyticsPage from "./OutreachAnalytics";
import ColdLeadsPage from "./ColdLeads";

/**
 * Outbound Command Center — unified tabbed shell
 * Merges: Campaigns, Sequences, OutreachCommand, ColdLeads, OutreachAnalytics
 *
 * Tab "command"   → Outreach Command (pipeline, import, enrich)
 * Tab "campaigns" → Email campaigns
 * Tab "sequences" → Drip sequences
 * Tab "prospects" → Cold leads dormant-contact list
 * Tab "analytics" → Outreach analytics
 *
 * URL: /dashboard/outbound-center?tab=command|campaigns|sequences|prospects|analytics
 *
 * Legacy routes that redirect here:
 *   /dashboard/campaigns          → tab=campaigns
 *   /dashboard/sequences          → tab=sequences
 *   /dashboard/outreach-command   → tab=command (already redirected in App.tsx)
 *   /dashboard/cold-leads         → tab=prospects
 *   /dashboard/acquisition-hub    → tab=analytics
 *   /dashboard/outreach-hub       → redirect to here
 */
export default function OutboundCenter() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const params = new URLSearchParams(search);
  const rawTab = params.get("tab") ?? "command";
  const validTabs = ["command", "campaigns", "sequences", "prospects", "analytics"];
  const initialTab = validTabs.includes(rawTab) ? rawTab : "command";
  const [tab, setTab] = useState(initialTab);

  const handleTabChange = (value: string) => {
    setTab(value);
    navigate(`/dashboard/outbound-center?tab=${value}`, { replace: true });
  };

  useEffect(() => {
    const t = params.get("tab") ?? "command";
    setTab(validTabs.includes(t) ? t : "command");
  }, [search]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="command" className="gap-2" data-testid="tab-outbound-command">
            <Zap className="w-4 h-4" />
            Command
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2" data-testid="tab-outbound-campaigns">
            <Megaphone className="w-4 h-4" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="sequences" className="gap-2" data-testid="tab-outbound-sequences">
            <ListOrdered className="w-4 h-4" />
            Sequences
          </TabsTrigger>
          <TabsTrigger value="prospects" className="gap-2" data-testid="tab-outbound-prospects">
            <Users className="w-4 h-4" />
            Prospects
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2" data-testid="tab-outbound-analytics">
            <LineChart className="w-4 h-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="command" data-testid="tab-content-command">
          <OutreachCommandPage />
        </TabsContent>

        <TabsContent value="campaigns" data-testid="tab-content-campaigns">
          <CampaignsPage />
        </TabsContent>

        <TabsContent value="sequences" data-testid="tab-content-sequences">
          <SequencesPage />
        </TabsContent>

        <TabsContent value="prospects" data-testid="tab-content-prospects">
          <ColdLeadsPage />
        </TabsContent>

        <TabsContent value="analytics" data-testid="tab-content-analytics">
          <OutreachAnalyticsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
