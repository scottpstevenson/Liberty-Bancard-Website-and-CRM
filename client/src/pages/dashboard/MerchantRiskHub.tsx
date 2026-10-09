import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Chargebacks from "./Chargebacks";
import MerchantHealth from "./MerchantHealth";
import { c4WorkspaceSelection, c4WorkspaceUrl, merchantRiskViews } from "@/lib/crm-destination-state";

export default function MerchantRiskHub() {
  const search = useSearch();
  const state = c4WorkspaceSelection(search, "tab", merchantRiskViews, "chargebacks");
  const [, navigate] = useLocation();
  const goTab = (value: string) => {
    if ((merchantRiskViews as readonly string[]).includes(value))
      navigate(c4WorkspaceUrl("/dashboard/merchant-risk", search, window.location.hash, "tab", merchantRiskViews, "chargebacks", value as typeof merchantRiskViews[number]));
  };

  return (
    <Tabs value={state.value} onValueChange={goTab} className="min-w-0 space-y-4">
      {state.issues.length > 0 && <p className="rounded-md border-l-2 border-destructive bg-muted px-3 py-2 text-sm" role="status">{state.issues[0].reason}</p>}
      <TabsList>
        <TabsTrigger value="chargebacks" data-testid="tab-merchant-risk-chargebacks">Chargebacks</TabsTrigger>
        <TabsTrigger value="health" data-testid="tab-merchant-risk-health">Merchant Health</TabsTrigger>
      </TabsList>
      <TabsContent value="chargebacks"><Chargebacks /></TabsContent>
      <TabsContent value="health"><MerchantHealth /></TabsContent>
    </Tabs>
  );
}
