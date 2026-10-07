import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Reporting from "./Reporting";
import GrowthKPI from "./GrowthKPI";
import WinLoss from "./WinLoss";
import OutreachAnalytics from "./OutreachAnalytics";
import OperationsReport from "./OperationsReport";
import FinancialHub from "./FinancialHub";
import { selectValue, safeParams, safeContextKeys, destinationUrl, financialViews } from "@/lib/crm-destination-state";

const VALID_TABS = ["overview", "growth", "win-loss", "outreach-analytics", "operations", "financial"] as const;
type Tab = typeof VALID_TABS[number];

export default function ReportingHub() {
  const search = useSearch();
  const state = selectValue(new URLSearchParams(search), "tab", VALID_TABS, "overview");
  const tab = state.value;
  const [, navigate] = useLocation();
  const goTab = (v: string) => {
    if (!(VALID_TABS as readonly string[]).includes(v)) return;
    const params = safeParams(search, [...safeContextKeys, "financialTab"]);
    params.set("tab", v);
    if (v !== "financial") params.delete("financialTab");
    else params.set("financialTab", selectValue(new URLSearchParams(search), "financialTab", financialViews, "revenue").value);
    navigate(destinationUrl("/dashboard/reporting", params, window.location.hash));
  };

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      {state.issues.length > 0 && <p role="status">{state.issues[0].reason}</p>}
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="overview" data-testid="tab-reporting-overview">Overview</TabsTrigger>
        <TabsTrigger value="growth" data-testid="tab-reporting-growth">Growth Metrics</TabsTrigger>
        <TabsTrigger value="win-loss" data-testid="tab-reporting-win-loss">Win/Loss</TabsTrigger>
        <TabsTrigger value="outreach-analytics" data-testid="tab-reporting-outreach">Outreach Analytics</TabsTrigger>
        <TabsTrigger value="operations" data-testid="tab-reporting-operations">Operations Report</TabsTrigger>
        <TabsTrigger value="financial" data-testid="tab-reporting-financial">Financial</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><Reporting /></TabsContent>
      <TabsContent value="growth"><GrowthKPI /></TabsContent>
      <TabsContent value="win-loss"><WinLoss /></TabsContent>
      <TabsContent value="outreach-analytics"><OutreachAnalytics /></TabsContent>
      <TabsContent value="operations"><OperationsReport /></TabsContent>
      <TabsContent value="financial"><FinancialHub /></TabsContent>
    </Tabs>
  );
}
