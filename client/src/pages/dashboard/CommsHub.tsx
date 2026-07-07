import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SmsInbox from "./SmsInbox";
import LiveChat from "./LiveChat";

const VALID_TABS = ["messages", "live-chat"] as const;
type Tab = typeof VALID_TABS[number];

export default function CommsHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "messages";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/comms-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="messages" data-testid="tab-comms-messages">Messages</TabsTrigger>
        <TabsTrigger value="live-chat" data-testid="tab-comms-live-chat">Live Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="messages"><SmsInbox /></TabsContent>
      <TabsContent value="live-chat"><LiveChat /></TabsContent>
    </Tabs>
  );
}
