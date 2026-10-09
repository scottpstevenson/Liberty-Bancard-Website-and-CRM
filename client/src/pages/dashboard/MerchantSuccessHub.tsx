import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReviewRequests from "./ReviewRequests";
import TestimonialSubmissions from "./TestimonialSubmissions";
import NpsDashboard from "./NpsDashboard";
import RetentionCampaigns from "./RetentionCampaigns";
import { c4WorkspaceSelection, c4WorkspaceUrl, merchantSuccessViews } from "@/lib/crm-destination-state";

export default function MerchantSuccessHub() {
  const search = useSearch();
  const state = c4WorkspaceSelection(search, "tab", merchantSuccessViews, "reviews");
  const [, navigate] = useLocation();
  const goTab = (value: string) => {
    if ((merchantSuccessViews as readonly string[]).includes(value))
      navigate(c4WorkspaceUrl("/dashboard/merchant-success", search, window.location.hash, "tab", merchantSuccessViews, "reviews", value as typeof merchantSuccessViews[number]));
  };

  return (
    <Tabs value={state.value} onValueChange={goTab} className="min-w-0 space-y-4">
      {state.issues.length > 0 && <p className="rounded-md border-l-2 border-destructive bg-muted px-3 py-2 text-sm" role="status">{state.issues[0].reason}</p>}
      <TabsList>
        <TabsTrigger value="reviews" data-testid="tab-merchant-success-reviews">Review Requests</TabsTrigger>
        <TabsTrigger value="testimonials" data-testid="tab-merchant-success-testimonials">Testimonials</TabsTrigger>
        <TabsTrigger value="nps" data-testid="tab-merchant-success-nps">NPS / CSAT</TabsTrigger>
        <TabsTrigger value="retention" data-testid="tab-merchant-success-retention">Retention Campaigns</TabsTrigger>
      </TabsList>
      <TabsContent value="reviews"><ReviewRequests /></TabsContent>
      <TabsContent value="testimonials"><TestimonialSubmissions /></TabsContent>
      <TabsContent value="nps"><NpsDashboard /></TabsContent>
      <TabsContent value="retention"><RetentionCampaigns /></TabsContent>
    </Tabs>
  );
}
