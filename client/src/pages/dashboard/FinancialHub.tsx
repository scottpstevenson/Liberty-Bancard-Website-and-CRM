import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ResidualRevenue from "./ResidualRevenue";
import Forecasting from "./Forecasting";
import TerminalROI from "./TerminalROI";

const VALID_TABS = ["revenue", "forecasting", "terminal-roi"] as const;
type Tab = typeof VALID_TABS[number];

export default function FinancialHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("financialTab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "revenue";
  const [, navigate] = useLocation();
  const goTab = (v: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", "financial");
    params.set("financialTab", v);
    navigate(`/dashboard/reporting?${params.toString()}`);
  };

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="revenue" data-testid="tab-financial-revenue">Revenue Dashboard</TabsTrigger>
        <TabsTrigger value="forecasting" data-testid="tab-financial-forecasting">Forecasting</TabsTrigger>
        <TabsTrigger value="terminal-roi" data-testid="tab-financial-terminal-roi">Terminal ROI</TabsTrigger>
      </TabsList>
      <TabsContent value="revenue"><ResidualRevenue /></TabsContent>
      <TabsContent value="forecasting"><Forecasting /></TabsContent>
      <TabsContent value="terminal-roi"><TerminalROI /></TabsContent>
    </Tabs>
  );
}
