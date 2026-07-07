import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Tickets from "./Tickets";
import RFIs from "./RFIs";
import ReviewQueue from "./ReviewQueue";

const VALID_TABS = ["tickets", "rfis", "review-queue"] as const;
type Tab = typeof VALID_TABS[number];

export default function SupportHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "tickets";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/support-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="tickets" data-testid="tab-support-tickets">Tickets</TabsTrigger>
        <TabsTrigger value="rfis" data-testid="tab-support-rfis">RFIs</TabsTrigger>
        <TabsTrigger value="review-queue" data-testid="tab-support-review-queue">Review Queue</TabsTrigger>
      </TabsList>
      <TabsContent value="tickets"><Tickets /></TabsContent>
      <TabsContent value="rfis"><RFIs /></TabsContent>
      <TabsContent value="review-queue"><ReviewQueue /></TabsContent>
    </Tabs>
  );
}
