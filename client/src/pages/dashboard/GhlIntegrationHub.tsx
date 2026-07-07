import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GhlSettings from "./GhlSettings";
import GhlWorkflowManager from "./GhlWorkflowManager";
import GhlSequenceGuide from "./GhlSequenceGuide";

export default function GhlIntegrationHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const validTabs = isAdmin
    ? ["settings", "workflow-ids", "sequence-guide"]
    : ["sequence-guide"];

  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab = validTabs.includes(raw) ? raw : validTabs[0];
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/ghl-integration?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        {isAdmin && <TabsTrigger value="settings" data-testid="tab-ghl-settings">Settings</TabsTrigger>}
        {isAdmin && <TabsTrigger value="workflow-ids" data-testid="tab-ghl-workflow-ids">Workflow IDs</TabsTrigger>}
        <TabsTrigger value="sequence-guide" data-testid="tab-ghl-sequence-guide">Sequence Guide</TabsTrigger>
      </TabsList>
      {isAdmin && <TabsContent value="settings"><GhlSettings /></TabsContent>}
      {isAdmin && <TabsContent value="workflow-ids"><GhlWorkflowManager /></TabsContent>}
      <TabsContent value="sequence-guide"><GhlSequenceGuide /></TabsContent>
    </Tabs>
  );
}
