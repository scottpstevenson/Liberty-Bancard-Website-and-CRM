import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Outreach from "./Outreach";
import OutreachCommand from "./OutreachCommand";
import ColdLeads from "./ColdLeads";

const VALID_TABS = ["overview", "command", "prospects"] as const;
type Tab = typeof VALID_TABS[number];

export default function OutreachHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "overview";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/outreach-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview" data-testid="tab-outreach-overview">Outreach</TabsTrigger>
        <TabsTrigger value="command" data-testid="tab-outreach-command">Command</TabsTrigger>
        <TabsTrigger value="prospects" data-testid="tab-outreach-prospects">Prospects</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><Outreach /></TabsContent>
      <TabsContent value="command"><OutreachCommand /></TabsContent>
      <TabsContent value="prospects"><ColdLeads /></TabsContent>
    </Tabs>
  );
}
