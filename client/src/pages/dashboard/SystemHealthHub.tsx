import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperatorDashboard from "./OperatorDashboard";
import SystemReadiness from "./SystemReadiness";
import SeoHealth from "./SeoHealth";
import IncidentsDashboard from "./IncidentsDashboard";
import { useAuth } from "@/hooks/use-auth";

const VALID_TABS = ["monitor", "readiness", "seo", "incidents"] as const;
const ADMIN_ONLY_TABS = ["monitor", "incidents"] as const;
type Tab = typeof VALID_TABS[number];

export default function SystemHealthHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  // Non-admin-only tabs (readiness/seo) must stay reachable via deep link even
  // when the user isn't an admin; only admin-only tabs fall back to "readiness".
  const requestedTab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "readiness";
  const tab: Tab = (ADMIN_ONLY_TABS as readonly string[]).includes(requestedTab) && !isAdmin ? "readiness" : requestedTab;
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/system-health?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1">
        {isAdmin && <TabsTrigger value="monitor" data-testid="tab-system-monitor">System Monitor</TabsTrigger>}
        <TabsTrigger value="readiness" data-testid="tab-system-readiness">System Readiness</TabsTrigger>
        <TabsTrigger value="seo" data-testid="tab-system-seo">SEO Health</TabsTrigger>
        {isAdmin && <TabsTrigger value="incidents" data-testid="tab-system-incidents">Incidents &amp; DLQ</TabsTrigger>}
      </TabsList>
      {isAdmin && <TabsContent value="monitor"><OperatorDashboard /></TabsContent>}
      <TabsContent value="readiness"><SystemReadiness /></TabsContent>
      <TabsContent value="seo"><SeoHealth /></TabsContent>
      {isAdmin && <TabsContent value="incidents"><IncidentsDashboard /></TabsContent>}
    </Tabs>
  );
}
