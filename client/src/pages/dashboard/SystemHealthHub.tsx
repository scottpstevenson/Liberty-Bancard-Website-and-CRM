import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperatorDashboard from "./OperatorDashboard";
import SystemReadiness from "./SystemReadiness";
import SeoHealth from "./SeoHealth";
import IncidentsDashboard from "./IncidentsDashboard";

const VALID_TABS = ["monitor", "readiness", "seo", "incidents"] as const;
type Tab = typeof VALID_TABS[number];

export default function SystemHealthHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "monitor";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/system-health?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="monitor" data-testid="tab-system-monitor">System Monitor</TabsTrigger>
        <TabsTrigger value="readiness" data-testid="tab-system-readiness">System Readiness</TabsTrigger>
        <TabsTrigger value="seo" data-testid="tab-system-seo">SEO Health</TabsTrigger>
        <TabsTrigger value="incidents" data-testid="tab-system-incidents">Incidents &amp; DLQ</TabsTrigger>
      </TabsList>
      <TabsContent value="monitor"><OperatorDashboard /></TabsContent>
      <TabsContent value="readiness"><SystemReadiness /></TabsContent>
      <TabsContent value="seo"><SeoHealth /></TabsContent>
      <TabsContent value="incidents"><IncidentsDashboard /></TabsContent>
    </Tabs>
  );
}
