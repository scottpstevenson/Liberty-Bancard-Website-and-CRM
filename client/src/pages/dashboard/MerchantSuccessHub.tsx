import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReviewRequests from "./ReviewRequests";
import TestimonialSubmissions from "./TestimonialSubmissions";
import NpsDashboard from "./NpsDashboard";
import RetentionCampaigns from "./RetentionCampaigns";

const VALID_TABS = ["reviews", "testimonials", "nps", "retention"] as const;
type Tab = typeof VALID_TABS[number];

export default function MerchantSuccessHub() {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : "reviews";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/merchant-success?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
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
