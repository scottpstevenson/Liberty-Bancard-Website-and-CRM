import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ResidualRevenue from "./ResidualRevenue";
import Forecasting from "./Forecasting";
import TerminalROI from "./TerminalROI";
import { financialState, financialUrl, selectionMessage } from "@/lib/crm-destination-state";

const VALID_TABS = ["revenue", "forecasting", "terminal-roi"] as const;
type Tab = typeof VALID_TABS[number];

export default function FinancialHub() {
  const search = useSearch();
  const state = financialState(search);
  const tab: Tab = state.value === "financial" ? "revenue" : state.value;
  const reason = state.issues[0]?.reason ?? selectionMessage(search);
  const [, navigate] = useLocation();
  const goTab = (v: string) => {
    if ((VALID_TABS as readonly string[]).includes(v))
      navigate(financialUrl(search, window.location.hash, v as Tab));
  };

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      {reason && <p role="status">{reason}</p>}
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
