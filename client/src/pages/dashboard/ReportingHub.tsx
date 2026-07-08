import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Reporting from "./Reporting";
import GrowthKPI from "./GrowthKPI";
import WinLoss from "./WinLoss";
import OutreachAnalytics from "./OutreachAnalytics";

const VALID_TABS = ["overview", "growth", "win-loss", "outreach-analytics"] as const;
type Tab = typeof VALID_TABS[number];

export default function ReportingHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "overview";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/reporting?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview" data-testid="tab-reporting-overview">Overview</TabsTrigger>
        <TabsTrigger value="growth" data-testid="tab-reporting-growth">Growth Metrics</TabsTrigger>
        <TabsTrigger value="win-loss" data-testid="tab-reporting-win-loss">Win/Loss</TabsTrigger>
        <TabsTrigger value="outreach-analytics" data-testid="tab-reporting-outreach">Outreach Analytics</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><Reporting /></TabsContent>
      <TabsContent value="growth"><GrowthKPI /></TabsContent>
      <TabsContent value="win-loss"><WinLoss /></TabsContent>
      <TabsContent value="outreach-analytics"><OutreachAnalytics /></TabsContent>
    </Tabs>
  );
}
