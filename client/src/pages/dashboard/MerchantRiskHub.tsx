import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Chargebacks from "./Chargebacks";
import MerchantHealth from "./MerchantHealth";

const VALID_TABS = ["chargebacks", "health"] as const;
type Tab = typeof VALID_TABS[number];

export default function MerchantRiskHub() {
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "chargebacks";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/merchant-risk?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="chargebacks" data-testid="tab-merchant-risk-chargebacks">Chargebacks</TabsTrigger>
        <TabsTrigger value="health" data-testid="tab-merchant-risk-health">Merchant Health</TabsTrigger>
      </TabsList>
      <TabsContent value="chargebacks"><Chargebacks /></TabsContent>
      <TabsContent value="health"><MerchantHealth /></TabsContent>
    </Tabs>
  );
}
