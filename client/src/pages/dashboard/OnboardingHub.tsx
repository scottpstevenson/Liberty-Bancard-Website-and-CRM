import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Onboarding from "./Onboarding";
import OnboardingBoard from "./OnboardingBoard";

const VALID_TABS = ["overview", "board"] as const;
type Tab = typeof VALID_TABS[number];

export default function OnboardingHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "overview";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/onboarding?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview" data-testid="tab-onboarding-overview">Onboarding</TabsTrigger>
        <TabsTrigger value="board" data-testid="tab-onboarding-board">Board</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><Onboarding /></TabsContent>
      <TabsContent value="board"><OnboardingBoard /></TabsContent>
    </Tabs>
  );
}
