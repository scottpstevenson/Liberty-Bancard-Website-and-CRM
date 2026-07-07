import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperatorDashboard from "./OperatorDashboard";
import SystemReadiness from "./SystemReadiness";
import SeoHealth from "./SeoHealth";

const VALID_TABS = ["monitor", "readiness", "seo"] as const;
type Tab = typeof VALID_TABS[number];

export default function SystemHealthHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "monitor";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/system-health?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="monitor" data-testid="tab-system-monitor">System Monitor</TabsTrigger>
        <TabsTrigger value="readiness" data-testid="tab-system-readiness">System Readiness</TabsTrigger>
        <TabsTrigger value="seo" data-testid="tab-system-seo">SEO Health</TabsTrigger>
      </TabsList>
      <TabsContent value="monitor"><OperatorDashboard /></TabsContent>
      <TabsContent value="readiness"><SystemReadiness /></TabsContent>
      <TabsContent value="seo"><SeoHealth /></TabsContent>
    </Tabs>
  );
}
