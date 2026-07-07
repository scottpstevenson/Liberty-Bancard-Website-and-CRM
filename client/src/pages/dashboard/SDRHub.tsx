import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SdrDashboard from "./SdrDashboard";
import ConversationAI from "./ConversationAI";

const VALID_TABS = ["sdr", "chatbot"] as const;
type Tab = typeof VALID_TABS[number];

export default function SDRHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "sdr";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/sdr-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="sdr" data-testid="tab-sdr-dashboard">AI SDR</TabsTrigger>
        <TabsTrigger value="chatbot" data-testid="tab-sdr-chatbot">Chat Bot Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="sdr"><SdrDashboard /></TabsContent>
      <TabsContent value="chatbot"><ConversationAI /></TabsContent>
    </Tabs>
  );
}
