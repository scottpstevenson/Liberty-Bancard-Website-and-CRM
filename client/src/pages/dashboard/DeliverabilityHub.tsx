import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EmailHealth from "./EmailHealth";
import InboxHealth from "./InboxHealth";

const VALID_TABS = ["email-health", "inbox-health"] as const;
type Tab = typeof VALID_TABS[number];

export default function DeliverabilityHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "email-health";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/deliverability-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="email-health" data-testid="tab-deliverability-email">Email Health</TabsTrigger>
        <TabsTrigger value="inbox-health" data-testid="tab-deliverability-inbox">Inbox Health</TabsTrigger>
      </TabsList>
      <TabsContent value="email-health"><EmailHealth /></TabsContent>
      <TabsContent value="inbox-health"><InboxHealth /></TabsContent>
    </Tabs>
  );
}
