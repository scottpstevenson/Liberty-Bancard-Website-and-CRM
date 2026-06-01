import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { ExitIntentPopup } from "@/components/ExitIntentPopup";
import { ContactBubble } from "@/components/ContactBubble";
import { CookieConsent } from "@/components/CookieConsent";
import ChatWidget from "@/components/ChatWidget";
import { trackPageView } from "@/lib/tracking";
import { captureUTMParams } from "@/lib/utm";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import Home from "@/pages/Home";
import GetStarted from "@/pages/GetStarted";
import UploadStatement from "@/pages/UploadStatement";
import ZeroPercent from "@/pages/ZeroPercent";
import BeatSquareStripe from "@/pages/BeatSquareStripe";
import AboutContact from "@/pages/AboutContact";
import Estimate from "@/pages/Estimate";
import Support from "@/pages/Support";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import CookiePolicy from "@/pages/CookiePolicy";
import AdvertisingDisclosure from "@/pages/AdvertisingDisclosure";
import AccessibilityStatement from "@/pages/AccessibilityStatement";
import SmsTerms from "@/pages/SmsTerms";
import ESignConsent from "@/pages/ESignConsent";
import SurchargingDisclosure from "@/pages/SurchargingDisclosure";
import MerchantPolicies from "@/pages/MerchantPolicies";
import RegulatoryNotices from "@/pages/RegulatoryNotices";
import SecurityCompliance from "@/pages/SecurityCompliance";
import DoNotSell from "@/pages/DoNotSell";
import DataProcessingAgreement from "@/pages/DataProcessingAgreement";
import ResponsibleAI from "@/pages/ResponsibleAI";
import TestimonialsDisclosure from "@/pages/TestimonialsDisclosure";
import LawEnforcementGuidelines from "@/pages/LawEnforcementGuidelines";
import DisputeResolution from "@/pages/DisputeResolution";
import ThanksStatement from "@/pages/ThanksStatement";
import ProposalViewer from "@/pages/ProposalViewer";
import CoBrandedProposalViewer from "@/pages/CoBrandedProposalViewer";
import ThanksEstimate from "@/pages/ThanksEstimate";
import ThanksCall from "@/pages/ThanksCall";
import ThanksSupport from "@/pages/ThanksSupport";
import ThanksApplication from "@/pages/ThanksApplication";
import MerchantApplication from "@/pages/MerchantApplication";
import AssetPage from "@/pages/AssetPage";
import CompareVs from "@/pages/CompareVs";
import NotFound from "@/pages/not-found";
import { DashboardLayout } from "@/pages/DashboardLayout";
import Overview from "@/pages/dashboard/Overview";
import Contacts from "@/pages/dashboard/Contacts";
import Chat from "@/pages/dashboard/Chat";
import Pipeline from "@/pages/dashboard/Pipeline";
import Onboarding from "@/pages/dashboard/Onboarding";
import Tickets from "@/pages/dashboard/Tickets";
import Tasks from "@/pages/dashboard/Tasks";
import Notifications from "@/pages/dashboard/Notifications";
import CallOutcome from "@/pages/dashboard/CallOutcome";
import ReviewComplete from "@/pages/dashboard/ReviewComplete";
import OnboardingKickoff from "@/pages/dashboard/OnboardingKickoff";
import Workflows from "@/pages/dashboard/Workflows";
import RFIs from "@/pages/dashboard/RFIs";
import ReviewQueuePage from "@/pages/dashboard/ReviewQueue";
import CaseStudyIntake from "@/pages/dashboard/CaseStudyIntake";
import GhlSettings from "@/pages/dashboard/GhlSettings";
import GhlWorkflowManager from "@/pages/dashboard/GhlWorkflowManager";
import Automation from "@/pages/dashboard/Automation";
import Prospects from "@/pages/dashboard/Prospects";
import ProspectImport from "@/pages/dashboard/ProspectImport";
import Campaigns from "@/pages/dashboard/Campaigns";
import OutreachAnalytics from "@/pages/dashboard/OutreachAnalytics";
import Reporting from "@/pages/dashboard/Reporting";
import ContactDetail from "@/pages/dashboard/ContactDetail";
import StageRules from "@/pages/dashboard/StageRules";
import Sequences from "@/pages/dashboard/Sequences";
import LeadGenCleaner from "@/pages/dashboard/LeadGenCleaner";
import LeadIntelligence from "@/pages/dashboard/LeadIntelligence";
import StatementReview from "@/pages/dashboard/StatementReview";
import Outreach from "@/pages/dashboard/Outreach";
import OutreachCommand from "@/pages/dashboard/OutreachCommand";
import LeadEngine from "@/pages/dashboard/LeadEngine";
import LeadCommandCenter from "@/pages/dashboard/LeadCommandCenter";
import LeadImports from "@/pages/dashboard/LeadImports";
import BlazeIntegration from "@/pages/dashboard/BlazeIntegration";
import MerchantPortal from "@/pages/dashboard/MerchantPortal";
import MerchantApplicationsList from "@/pages/dashboard/MerchantApplicationsList";
import BoardingTracker from "@/pages/dashboard/BoardingTracker";
import AgentManagement from "@/pages/dashboard/AgentManagement";
import MerchantHealth from "@/pages/dashboard/MerchantHealth";
import Chargebacks from "@/pages/dashboard/Chargebacks";
import NpsDashboard from "@/pages/dashboard/NpsDashboard";
import RetentionCampaigns from "@/pages/dashboard/RetentionCampaigns";
import NpsSurvey from "@/pages/NpsSurvey";
import WinLoss from "@/pages/dashboard/WinLoss";
import ReferralProgram from "@/pages/dashboard/ReferralProgram";
import KnowledgeBase from "@/pages/dashboard/KnowledgeBase";
import ReviewRequests from "@/pages/dashboard/ReviewRequests";
import TestimonialSubmissions from "@/pages/dashboard/TestimonialSubmissions";
import ResidualRevenue from "@/pages/dashboard/ResidualRevenue";
import ConsentAudit from "@/pages/dashboard/ConsentAudit";
import UserManagement from "@/pages/dashboard/UserManagement";
import Permissions from "@/pages/dashboard/Permissions";
import SecuritySettings from "@/pages/dashboard/SecuritySettings";
import Calendar from "@/pages/dashboard/Calendar";
import Forecasting from "@/pages/dashboard/Forecasting";
import PciAssessment from "@/pages/dashboard/PciAssessment";
import DataRequests from "@/pages/dashboard/DataRequests";
import BlogGenerator from "@/pages/dashboard/BlogGenerator";
import ContentEditor from "@/pages/dashboard/ContentEditor";
import SocialComposer from "@/pages/dashboard/SocialComposer";
import AuthorPage from "@/pages/AuthorPage";
import SdrDashboard from "@/pages/dashboard/SdrDashboard";
import SmsInbox from "@/pages/dashboard/SmsInbox";
import BinLookup from "@/pages/dashboard/BinLookup";
import RoundRobinAdmin from "@/pages/dashboard/RoundRobinAdmin";
import InboxHealth from "@/pages/dashboard/InboxHealth";
import SettingsIntegrations from "@/pages/dashboard/SettingsIntegrations";
import ActivationPanel from "@/pages/dashboard/ActivationPanel";
import OperatorDashboard from "@/pages/dashboard/OperatorDashboard";
import SeoHealth from "@/pages/dashboard/SeoHealth";
import Training from "@/pages/dashboard/Training";
import Leaderboard from "@/pages/dashboard/Leaderboard";
import SalesRepHome from "@/pages/dashboard/SalesRepHome";
import LiveChatDashboard from "@/pages/dashboard/LiveChat";
import DocumentVault from "@/pages/dashboard/DocumentVault";
import VirtualTerminal from "@/pages/dashboard/VirtualTerminal";
import DataRetention from "@/pages/DataRetention";
import TCPAConsent from "@/pages/TCPAConsent";
import RefundPolicy from "@/pages/RefundPolicy";
import CaliforniaPrivacy from "@/pages/CaliforniaPrivacy";
import ADACompliance from "@/pages/ADACompliance";
import SavingsCalculator from "@/pages/SavingsCalculator";
import RateComparison from "@/pages/RateComparison";
import Blog from "@/pages/Blog";
import BlogPost from "@/pages/BlogPost";
import IndustryPage from "@/pages/IndustryPage";
import LocationIndustryPage from "@/pages/LocationIndustryPage";
import HelpCenter from "@/pages/HelpCenter";
import TerminalShop from "@/pages/TerminalShop";
import HelpArticle from "@/pages/HelpArticle";
import FreeAnalysis from "@/pages/FreeAnalysis";
import CostQuiz from "@/pages/sales/CostQuiz";
import SalesOnePager from "@/pages/sales/SalesOnePager";
import WhyLiberty from "@/pages/WhyLiberty";
import CaseStudies from "@/pages/CaseStudies";
import Testimonials from "@/pages/Testimonials";
import TestimonialsSubmit from "@/pages/TestimonialsSubmit";
import Integrations from "@/pages/Integrations";
import FAQ from "@/pages/FAQ";
import AffiliateProgram from "@/pages/AffiliateProgram";
import ISOPartnerProgram from "@/pages/ISOPartnerProgram";
import PartnerPortal from "@/pages/PartnerPortal";
import PartnerBrandedPage from "@/pages/PartnerBrandedPage";
import PartnerOrgDashboard from "@/pages/PartnerOrgDashboard";
import PartnerOrgs from "@/pages/dashboard/PartnerOrgs";
import PartnerLogin from "@/pages/PartnerLogin";
import SalesToolsHub from "@/pages/SalesToolsHub";
import MobileApp from "@/pages/mobile/MobileApp";

function AgentRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
    if (!isLoading && user && user.role !== "agent") {
      setLocation("/dashboard");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.role !== "agent") return null;

  return (
    <DashboardLayout>
      <Component />
    </DashboardLayout>
  );
}

function ProtectedRoute({ component: Component, allowedRoles }: { component: React.ComponentType; allowedRoles?: string[] }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === "agent" && location === "/dashboard") {
      setLocation("/dashboard/my-day");
    }
  }, [isLoading, user, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if ((user as any).role === "partner") {
    return <Redirect to="/partner-portal" />;
  }

  if (user.role === "agent" && location === "/dashboard") return null;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <DashboardLayout>
      <Component />
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/" component={Home} />
      <Route path="/get-started" component={GetStarted} />
      <Route path="/upload-statement" component={UploadStatement} />
      <Route path="/0-percent-processing" component={ZeroPercent} />
      <Route path="/beat-square-stripe" component={BeatSquareStripe} />
      <Route path="/about-contact" component={AboutContact} />
      <Route path="/estimate" component={Estimate} />
      <Route path="/support" component={Support} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms" component={Terms} />
      <Route path="/cookie-policy" component={CookiePolicy} />
      <Route path="/advertising-disclosure" component={AdvertisingDisclosure} />
      <Route path="/accessibility" component={AccessibilityStatement} />
      <Route path="/sms-terms" component={SmsTerms} />
      <Route path="/esign-consent" component={ESignConsent} />
      <Route path="/surcharging-disclosure" component={SurchargingDisclosure} />
      <Route path="/merchant-policies" component={MerchantPolicies} />
      <Route path="/regulatory-notices" component={RegulatoryNotices} />
      <Route path="/security-compliance" component={SecurityCompliance} />
      <Route path="/do-not-sell" component={DoNotSell} />
      <Route path="/data-processing-agreement" component={DataProcessingAgreement} />
      <Route path="/responsible-ai" component={ResponsibleAI} />
      <Route path="/testimonials-disclosure" component={TestimonialsDisclosure} />
      <Route path="/law-enforcement" component={LawEnforcementGuidelines} />
      <Route path="/dispute-resolution" component={DisputeResolution} />
      <Route path="/data-retention" component={DataRetention} />
      <Route path="/tcpa-consent" component={TCPAConsent} />
      <Route path="/refund-policy" component={RefundPolicy} />
      <Route path="/california-privacy" component={CaliforniaPrivacy} />
      <Route path="/ada-compliance" component={ADACompliance} />
      <Route path="/thanks-statement" component={ThanksStatement} />
      <Route path="/proposal/:token" component={ProposalViewer} />
      <Route path="/co-branded-proposal/:token" component={CoBrandedProposalViewer} />
      <Route path="/thanks-estimate" component={ThanksEstimate} />
      <Route path="/thanks-call" component={ThanksCall} />
      <Route path="/thanks-support" component={ThanksSupport} />
      <Route path="/thanks/application" component={ThanksApplication} />
      {/* /thanks-application is 301-redirected server-side to /thanks/application (Task #178) */}
      <Route path="/merchant-application" component={MerchantApplication} />
      <Route path="/equipment">
        <Redirect to="/shop" />
      </Route>
      <Route path="/shop" component={TerminalShop} />
      <Route path="/savings-calculator" component={SavingsCalculator} />
      <Route path="/compare-rates" component={RateComparison} />
      <Route path="/compare/:competitor" component={CompareVs} />
      <Route path="/why-liberty-bancard" component={WhyLiberty} />
      <Route path="/case-studies" component={CaseStudies} />
      <Route path="/testimonials/submit" component={TestimonialsSubmit} />
      <Route path="/testimonials" component={Testimonials} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/faq" component={FAQ} />
      <Route path="/affiliate" component={AffiliateProgram} />
      <Route path="/partners" component={ISOPartnerProgram} />
      <Route path="/partner-portal" component={PartnerPortal} />
      <Route path="/partner-login" component={PartnerLogin} />
      <Route path="/dashboard/partner" component={PartnerPortal} />
      <Route path="/partner/:slug" component={PartnerBrandedPage} />
      <Route path="/partner-org/:slug" component={PartnerOrgDashboard} />
      <Route path="/blog/:slug" component={BlogPost} />
      <Route path="/blog" component={Blog} />
      <Route path="/authors/:slug" component={AuthorPage} />
      <Route path="/help/:category/:slug" component={HelpArticle} />
      <Route path="/help/:category" component={HelpArticle} />
      <Route path="/help" component={HelpCenter} />

      {/* Mobile PWA for Field Sales Reps */}
      <Route path="/mobile/login" component={MobileApp} />
      <Route path="/mobile/contacts/:id" component={MobileApp} />
      <Route path="/mobile/contacts" component={MobileApp} />
      <Route path="/mobile/pipeline" component={MobileApp} />
      <Route path="/mobile/tasks" component={MobileApp} />
      <Route path="/mobile/profile" component={MobileApp} />
      <Route path="/mobile" component={MobileApp} />

      {/* Sales Tools Hub */}
      <Route path="/sales-tools" component={SalesToolsHub} />

      {/* Free Analysis Landing Page */}
      <Route path="/free-analysis" component={FreeAnalysis} />

      {/* Sales Landing Pages (hidden, noindex) */}
      <Route path="/quiz/processing-cost" component={CostQuiz} />
      <Route path="/sales/:slug" component={SalesOnePager} />

      {/* Industry Pages */}
      <Route path="/industries/:slug" component={IndustryPage} />

      {/* Location × Industry Pages */}
      <Route path="/locations/:city/:industry" component={LocationIndustryPage} />

      {/* Asset Library & Packet Routes */}
      <Route path="/assets/:a/:b" component={AssetPage} />
      <Route path="/assets/:a" component={AssetPage} />
      <Route path="/assets" component={AssetPage} />
      <Route path="/packet/:a/:b" component={AssetPage} />
      <Route path="/packet/:a" component={AssetPage} />
      
      {/* Dashboard Routes */}
      <Route path="/dashboard">
        <ProtectedRoute component={Overview} />
      </Route>
      <Route path="/dashboard/contacts/:id">
        <ProtectedRoute component={ContactDetail} />
      </Route>
      <Route path="/dashboard/contacts">
        <ProtectedRoute component={Contacts} />
      </Route>
      <Route path="/dashboard/chat">
        <ProtectedRoute component={Chat} />
      </Route>
      <Route path="/dashboard/pipeline">
        <ProtectedRoute component={Pipeline} />
      </Route>
      <Route path="/dashboard/onboarding">
        <ProtectedRoute component={Onboarding} />
      </Route>
      <Route path="/dashboard/tickets">
        <ProtectedRoute component={Tickets} />
      </Route>
      <Route path="/dashboard/tasks">
        <ProtectedRoute component={Tasks} />
      </Route>
      <Route path="/dashboard/notifications">
        <ProtectedRoute component={Notifications} />
      </Route>
      <Route path="/dashboard/call-outcome">
        <ProtectedRoute component={CallOutcome} />
      </Route>
      <Route path="/dashboard/review-complete">
        <ProtectedRoute component={ReviewComplete} />
      </Route>
      <Route path="/dashboard/review-requests">
        <ProtectedRoute component={ReviewRequests} />
      </Route>
      <Route path="/dashboard/testimonial-submissions">
        <ProtectedRoute component={TestimonialSubmissions} />
      </Route>
      <Route path="/dashboard/onboarding-kickoff">
        <ProtectedRoute component={OnboardingKickoff} />
      </Route>
      <Route path="/dashboard/workflows">
        <ProtectedRoute component={Workflows} />
      </Route>
      <Route path="/dashboard/rfis">
        <ProtectedRoute component={RFIs} />
      </Route>
      <Route path="/dashboard/review-queue">
        <ProtectedRoute component={ReviewQueuePage} allowedRoles={["admin", "manager"]} />
      </Route>
      <Route path="/dashboard/case-study-intake">
        <ProtectedRoute component={CaseStudyIntake} />
      </Route>
      <Route path="/dashboard/ghl-settings">
        <ProtectedRoute component={GhlSettings} />
      </Route>
      <Route path="/dashboard/ghl-workflows">
        <ProtectedRoute component={GhlWorkflowManager} />
      </Route>
      <Route path="/dashboard/automation">
        <ProtectedRoute component={Automation} />
      </Route>
      <Route path="/dashboard/prospects">
        <ProtectedRoute component={Prospects} />
      </Route>
      <Route path="/dashboard/prospects/import">
        <ProtectedRoute component={ProspectImport} />
      </Route>
      <Route path="/dashboard/lead-imports">
        <ProtectedRoute component={LeadImports} />
      </Route>
      <Route path="/dashboard/campaigns">
        <ProtectedRoute component={Campaigns} />
      </Route>
      <Route path="/dashboard/outreach-analytics">
        <ProtectedRoute component={OutreachAnalytics} />
      </Route>
      <Route path="/dashboard/reporting">
        <ProtectedRoute component={Reporting} />
      </Route>
      <Route path="/dashboard/win-loss">
        <ProtectedRoute component={WinLoss} />
      </Route>
      <Route path="/dashboard/stage-rules">
        <ProtectedRoute component={StageRules} />
      </Route>
      <Route path="/dashboard/sequences">
        <ProtectedRoute component={Sequences} />
      </Route>
      <Route path="/dashboard/lead-gen">
        <ProtectedRoute component={LeadGenCleaner} />
      </Route>
      <Route path="/dashboard/lead-intelligence">
        <ProtectedRoute component={LeadIntelligence} />
      </Route>
      <Route path="/dashboard/statement-review">
        <ProtectedRoute component={StatementReview} />
      </Route>
      <Route path="/dashboard/outreach">
        <ProtectedRoute component={Outreach} />
      </Route>
      <Route path="/dashboard/outreach-command">
        <ProtectedRoute component={OutreachCommand} />
      </Route>
      <Route path="/dashboard/lead-engine">
        <ProtectedRoute component={LeadEngine} />
      </Route>
      <Route path="/dashboard/lead-command-center">
        <ProtectedRoute component={LeadCommandCenter} />
      </Route>
      <Route path="/dashboard/blaze">
        <ProtectedRoute component={BlazeIntegration} />
      </Route>
      <Route path="/dashboard/merchant-applications">
        <ProtectedRoute component={MerchantApplicationsList} />
      </Route>
      <Route path="/dashboard/boarding">
        <ProtectedRoute component={BoardingTracker} />
      </Route>
      <Route path="/dashboard/merchant-portal">
        <ProtectedRoute component={MerchantPortal} />
      </Route>
      <Route path="/dashboard/merchant-health">
        <ProtectedRoute component={MerchantHealth} />
      </Route>
      <Route path="/dashboard/chargebacks">
        <ProtectedRoute component={Chargebacks} />
      </Route>
      <Route path="/dashboard/nps">
        <ProtectedRoute component={NpsDashboard} />
      </Route>
      <Route path="/dashboard/retention-campaigns">
        <ProtectedRoute component={RetentionCampaigns} />
      </Route>
      <Route path="/nps/:token" component={NpsSurvey} />
      <Route path="/dashboard/agent-management">
        <ProtectedRoute component={AgentManagement} />
      </Route>

      <Route path="/dashboard/residual-revenue">
        <ProtectedRoute component={ResidualRevenue} />
      </Route>
      <Route path="/dashboard/referral-program">
        <ProtectedRoute component={ReferralProgram} />
      </Route>
      <Route path="/dashboard/partner-orgs">
        <ProtectedRoute component={PartnerOrgs} />
      </Route>
      <Route path="/dashboard/knowledge-base">
        <ProtectedRoute component={KnowledgeBase} />
      </Route>
      <Route path="/dashboard/consent-audit">
        <ProtectedRoute component={ConsentAudit} />
      </Route>
      <Route path="/dashboard/calendar">
        <ProtectedRoute component={Calendar} />
      </Route>
      <Route path="/dashboard/user-management">
        <ProtectedRoute component={UserManagement} />
      </Route>
      <Route path="/dashboard/permissions">
        <ProtectedRoute component={Permissions} />
      </Route>
      <Route path="/dashboard/security">
        <ProtectedRoute component={SecuritySettings} />
      </Route>
      <Route path="/dashboard/settings/integrations">
        <ProtectedRoute component={SettingsIntegrations} />
      </Route>
      <Route path="/dashboard/forecasting">
        <ProtectedRoute component={Forecasting} />
      </Route>
      <Route path="/dashboard/pci-assessment">
        <ProtectedRoute component={PciAssessment} />
      </Route>
      <Route path="/dashboard/data-requests">
        <ProtectedRoute component={DataRequests} />
      </Route>
      <Route path="/dashboard/blog-generator">
        <ProtectedRoute component={BlogGenerator} />
      </Route>
      <Route path="/dashboard/content">
        <ProtectedRoute component={ContentEditor} />
      </Route>
      <Route path="/dashboard/social">
        <ProtectedRoute component={SocialComposer} />
      </Route>
      <Route path="/dashboard/sdr">
        <ProtectedRoute component={SdrDashboard} />
      </Route>
      <Route path="/dashboard/sms-inbox">
        <ProtectedRoute component={SmsInbox} />
      </Route>
      <Route path="/dashboard/bin-lookup">
        <ProtectedRoute component={BinLookup} />
      </Route>
      <Route path="/dashboard/round-robin">
        <ProtectedRoute component={RoundRobinAdmin} />
      </Route>
      <Route path="/dashboard/inbox-health">
        <ProtectedRoute component={InboxHealth} />
      </Route>
      <Route path="/dashboard/activation">
        <ProtectedRoute component={ActivationPanel} />
      </Route>
      <Route path="/dashboard/operator">
        <ProtectedRoute component={OperatorDashboard} />
      </Route>
      <Route path="/dashboard/seo-health">
        <ProtectedRoute component={SeoHealth} />
      </Route>
      <Route path="/dashboard/training">
        <ProtectedRoute component={Training} />
      </Route>
      <Route path="/dashboard/leaderboard">
        <ProtectedRoute component={Leaderboard} />
      </Route>
      <Route path="/dashboard/my-day">
        <AgentRoute component={SalesRepHome} />
      </Route>
      <Route path="/dashboard/live-chat">
        <ProtectedRoute component={LiveChatDashboard} />
      </Route>
      <Route path="/dashboard/document-vault">
        <ProtectedRoute component={DocumentVault} />
      </Route>
      <Route path="/dashboard/virtual-terminal">
        <ProtectedRoute component={VirtualTerminal} />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function useReferralTracking() {
  const [location] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("lb_ref_code", ref);
      fetch("/api/affiliate/track-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ref }),
      }).catch(() => {});
      fetch(`/api/partner/track/${encodeURIComponent(ref)}`).catch(() => {});
    }
  }, [location]);
}

function usePageTracking() {
  const [location] = useLocation();
  useEffect(() => {
    captureUTMParams();
    trackPageView(location);
  }, [location]);
}

function PublicLayout() {
  const [location] = useLocation();
  useReferralTracking();
  usePageTracking();
  const isDashboard = location.startsWith("/dashboard");
  const isThanksPage = location.startsWith("/thanks");
  const isAuthPage = location === "/login" || location === "/signup" || location === "/forgot-password" || location === "/reset-password" || location === "/verify-email";
  const isMobile = location.startsWith("/mobile");

  return (
    <>
      <ErrorBoundary key={location}>
        <Router />
      </ErrorBoundary>
      {!isDashboard && !isThanksPage && !isAuthPage && !isMobile && <StickyMobileCTA />}
      {!isDashboard && !isAuthPage && !isMobile && <ExitIntentPopup />}
      {!isDashboard && !isThanksPage && !isAuthPage && !isMobile && <ContactBubble />}
      {!isDashboard && !isAuthPage && !isMobile && <CookieConsent />}
      {!isDashboard && !isThanksPage && !isAuthPage && !isMobile && <ChatWidget />}
    </>
  );
}

function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <PublicLayout />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
