import { IntakeTriage } from "@/components/intake/IntakeTriage";
import { MerchantSubmittedReferrals } from "@/components/intake/MerchantSubmittedReferrals";
import { IntakeAutomationStatus } from "@/components/intake/IntakeAutomationStatus";
import { lazy, Suspense } from "react";
import { Inbox, FileText, Building2, Users, Handshake, UserRoundPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useC4RetainedSelection } from "@/hooks/use-c4-retained-selection";
import { CrmPage, CrmPageHeader, CrmDataState } from "@/components/crm/CrmPresentation";
import { PageHeadingLevel } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { intakeViews, intakeViewLabels } from "@/lib/crm-destination-state";

const Forms = lazy(() => import("@/components/lead-ops/InboundOperationsPanel").then(m => ({default:m.InboundOperationsPanel})));
const Merchants = lazy(() => import("./MerchantApplicationsList").then(m => ({default:m.MerchantApplicationsPanel})));
const Applications = lazy(() => import("@/components/partner/PartnerApplicationsPanel").then(m => ({default:m.PartnerApplicationsPanel})));
const Introductions = lazy(() => import("@/components/partner/PartnerIntroductionsReview").then(m => ({default:m.PartnerIntroductionsReview})));
const Referrals = lazy(() => import("@/components/partner/MerchantReferralsPanel").then(m => ({default:m.MerchantReferralsPanel})));
const icons = { forms: FileText, merchants: Building2, applications: Users, introductions: UserRoundPlus, referrals: Handshake };
const descriptions = {
  forms: "Contact, estimate, equipment and statement-review requests, with their confirmation references and follow-up work.",
  merchants: "Merchant account applications, supporting documents and underwriting review.",
  applications: "People applying to become sales agents or referral partners, with assignment and application review.",
  introductions: "Businesses introduced by partners that need acceptance, duplicate review or referrer resolution.",
  referrals: "Recorded merchant referrals and their current relationship to a referring partner.",
};

export default function IntakeCenter() {
  const { user } = useAuth();
  const selection = useC4RetainedSelection("/dashboard/intake", "tab", intakeViews, "forms");
  if (user?.role !== "admin" && user?.role !== "manager") return <CrmDataState state="denied" message="The Intake Center is available to administrators and managers." />;
  return (
    <CrmPage className="space-y-5 min-w-0" data-testid="intake-center">
      <CrmPageHeader title="Intake Center" icon={<Inbox className="h-6 w-6" />} description="Every application, website request and referral. One place to review what came in and take the next step." />
      <IntakeAutomationStatus />
      {selection.issues.map(issue => <p key={issue.key} role="status" className="text-sm text-destructive">{issue.reason}</p>)}
      <Tabs value={selection.value} onValueChange={value => selection.setValue(value as typeof selection.value)}>
        <div className="max-w-full overflow-x-auto rounded-xl border bg-muted/40 p-1" data-testid="intake-tab-strip">
          <TabsList aria-label="Intake categories" className="inline-flex h-auto min-w-full justify-start gap-1 bg-transparent p-0">
            {intakeViews.map(view => {
              const Icon = icons[view];
              return <TabsTrigger key={view} value={view} className="min-h-12 shrink-0 gap-2 rounded-lg px-4 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid={`intake-tab-${view}`}><Icon className="h-4 w-4 shrink-0" aria-hidden />{intakeViewLabels[view]}</TabsTrigger>;
            })}
          </TabsList>
        </div>
        <PageHeadingLevel level={2}>
          {intakeViews.map(view => <TabsContent key={view} value={view} className="min-w-0 space-y-4 pt-2" data-testid={`intake-panel-${view}`}>
            <p className="text-sm text-muted-foreground">{descriptions[view]}</p>
            {selection.value === view && <IntakeTriage kind={view} />}
            {selection.value === "referrals" && view === "referrals" && <IntakeTriage kind="merchant_referrals" />}
            <Suspense fallback={<div role="status" aria-label={`Loading ${intakeViewLabels[view]}`}><Skeleton className="h-40 w-full" /><span className="sr-only">Loading…</span></div>}>
              {selection.value === view && (view === "forms" ? <Forms basePath="/dashboard/intake" /> : view === "merchants" ? <Merchants basePath="/dashboard/intake" /> : view === "applications" ? <Applications /> : view === "introductions" ? <Introductions /> : <><Referrals /><MerchantSubmittedReferrals /></>)}
            </Suspense>
          </TabsContent>)}
        </PageHeadingLevel>
      </Tabs>
    </CrmPage>
  );
}
