import React, { Suspense, lazy, useEffect } from "react";
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
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DashboardLayout } from "@/pages/DashboardLayout";

// ─── Auth / Identity ──────────────────────────────────────────────────────────
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));

// ─── Public Marketing Pages ───────────────────────────────────────────────────
const Home = lazy(() => import("@/pages/Home"));
const GetStarted = lazy(() => import("@/pages/GetStarted"));
const UploadStatement = lazy(() => import("@/pages/UploadStatement"));
const ZeroPercent = lazy(() => import("@/pages/ZeroPercent"));
const BeatSquareStripe = lazy(() => import("@/pages/BeatSquareStripe"));
const AboutContact = lazy(() => import("@/pages/AboutContact"));
const Estimate = lazy(() => import("@/pages/Estimate"));
const Support = lazy(() => import("@/pages/Support"));
const WhyLiberty = lazy(() => import("@/pages/WhyLiberty"));
const CaseStudies = lazy(() => import("@/pages/CaseStudies"));
const Testimonials = lazy(() => import("@/pages/Testimonials"));
const TestimonialsSubmit = lazy(() => import("@/pages/TestimonialsSubmit"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const FAQ = lazy(() => import("@/pages/FAQ"));
const AffiliateProgram = lazy(() => import("@/pages/AffiliateProgram"));
const ISOPartnerProgram = lazy(() => import("@/pages/ISOPartnerProgram"));
const PartnerCPA = lazy(() => import("@/pages/PartnerCPA"));
const PartnerBookkeeper = lazy(() => import("@/pages/PartnerBookkeeper"));
const PartnerInsurance = lazy(() => import("@/pages/PartnerInsurance"));
const SavingsCalculator = lazy(() => import("@/pages/SavingsCalculator"));
const RateComparison = lazy(() => import("@/pages/RateComparison"));
const FreeAnalysis = lazy(() => import("@/pages/FreeAnalysis"));
const FreeAnalysisGuaranteed = lazy(() => import("@/pages/FreeAnalysisGuaranteed"));
const SalesToolsHub = lazy(() => import("@/pages/SalesToolsHub"));
const CompareVs = lazy(() => import("@/pages/CompareVs"));
const AssetPage = lazy(() => import("@/pages/AssetPage"));

// ─── Legal / Compliance Pages ─────────────────────────────────────────────────
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const Terms = lazy(() => import("@/pages/Terms"));
const CookiePolicy = lazy(() => import("@/pages/CookiePolicy"));
const AdvertisingDisclosure = lazy(() => import("@/pages/AdvertisingDisclosure"));
const AccessibilityStatement = lazy(() => import("@/pages/AccessibilityStatement"));
const SmsTerms = lazy(() => import("@/pages/SmsTerms"));
const ESignConsent = lazy(() => import("@/pages/ESignConsent"));
const SurchargingDisclosure = lazy(() => import("@/pages/SurchargingDisclosure"));
const MerchantPolicies = lazy(() => import("@/pages/MerchantPolicies"));
const RegulatoryNotices = lazy(() => import("@/pages/RegulatoryNotices"));
const SecurityCompliance = lazy(() => import("@/pages/SecurityCompliance"));
const DoNotSell = lazy(() => import("@/pages/DoNotSell"));
const DataProcessingAgreement = lazy(() => import("@/pages/DataProcessingAgreement"));
const ResponsibleAI = lazy(() => import("@/pages/ResponsibleAI"));
const TestimonialsDisclosure = lazy(() => import("@/pages/TestimonialsDisclosure"));
const LawEnforcementGuidelines = lazy(() => import("@/pages/LawEnforcementGuidelines"));
const DisputeResolution = lazy(() => import("@/pages/DisputeResolution"));
const DataRetention = lazy(() => import("@/pages/DataRetention"));
const TCPAConsent = lazy(() => import("@/pages/TCPAConsent"));
const RefundPolicy = lazy(() => import("@/pages/RefundPolicy"));
const CaliforniaPrivacy = lazy(() => import("@/pages/CaliforniaPrivacy"));
const ADACompliance = lazy(() => import("@/pages/ADACompliance"));

// ─── Conversion / Thank-You Pages ─────────────────────────────────────────────
const ThanksStatement = lazy(() => import("@/pages/ThanksStatement"));
const ThanksEstimate = lazy(() => import("@/pages/ThanksEstimate"));
const ThanksCall = lazy(() => import("@/pages/ThanksCall"));
const ThanksSupport = lazy(() => import("@/pages/ThanksSupport"));
const ThanksApplication = lazy(() => import("@/pages/ThanksApplication"));
const ProposalViewer = lazy(() => import("@/pages/ProposalViewer"));
const CoBrandedProposalViewer = lazy(() => import("@/pages/CoBrandedProposalViewer"));
const SavingsPage = lazy(() => import("@/pages/SavingsPage"));

// ─── Merchant / Partner Public Pages ──────────────────────────────────────────
const MerchantApplication = lazy(() => import("@/pages/MerchantApplication"));
const NpsSurvey = lazy(() => import("@/pages/NpsSurvey"));
const PartnerPortal = lazy(() => import("@/pages/PartnerPortal"));
const PartnerLogin = lazy(() => import("@/pages/PartnerLogin"));
const PartnerBrandedPage = lazy(() => import("@/pages/PartnerBrandedPage"));
const PartnerOrgDashboard = lazy(() => import("@/pages/PartnerOrgDashboard"));

// ─── Content Pages ────────────────────────────────────────────────────────────
const Blog = lazy(() => import("@/pages/Blog"));
const BlogPost = lazy(() => import("@/pages/BlogPost"));
const AuthorPage = lazy(() => import("@/pages/AuthorPage"));
const HelpCenter = lazy(() => import("@/pages/HelpCenter"));
const HelpArticle = lazy(() => import("@/pages/HelpArticle"));
const IndustryPage = lazy(() => import("@/pages/IndustryPage"));
const LocationIndustryPage = lazy(() => import("@/pages/LocationIndustryPage"));
const TerminalShop = lazy(() => import("@/pages/TerminalShop"));

// ─── Sales Tools (hidden) ─────────────────────────────────────────────────────
const CostQuiz = lazy(() => import("@/pages/sales/CostQuiz"));
const SalesOnePager = lazy(() => import("@/pages/sales/SalesOnePager"));

// ─── Mobile PWA ───────────────────────────────────────────────────────────────
const MobileApp = lazy(() => import("@/pages/mobile/MobileApp"));

// ─── Misc ─────────────────────────────────────────────────────────────────────
const NotFound = lazy(() => import("@/pages/not-found"));

// ─── Dashboard Pages ──────────────────────────────────────────────────────────
const Overview = lazy(() => import("@/pages/dashboard/Overview"));
const Contacts = lazy(() => import("@/pages/dashboard/Contacts"));
const Chat = lazy(() => import("@/pages/dashboard/Chat"));
const Pipeline = lazy(() => import("@/pages/dashboard/Pipeline"));
const Onboarding = lazy(() => import("@/pages/dashboard/Onboarding"));
const Tickets = lazy(() => import("@/pages/dashboard/Tickets"));
const Tasks = lazy(() => import("@/pages/dashboard/Tasks"));
const Notifications = lazy(() => import("@/pages/dashboard/Notifications"));
const CallOutcome = lazy(() => import("@/pages/dashboard/CallOutcome"));
const ReviewComplete = lazy(() => import("@/pages/dashboard/ReviewComplete"));
const OnboardingKickoff = lazy(() => import("@/pages/dashboard/OnboardingKickoff"));
const Workflows = lazy(() => import("@/pages/dashboard/Workflows"));
const RFIs = lazy(() => import("@/pages/dashboard/RFIs"));
const ReviewQueuePage = lazy(() => import("@/pages/dashboard/ReviewQueue"));
const CaseStudyIntake = lazy(() => import("@/pages/dashboard/CaseStudyIntake"));
const GhlSettings = lazy(() => import("@/pages/dashboard/GhlSettings"));
const GhlWorkflowManager = lazy(() => import("@/pages/dashboard/GhlWorkflowManager"));
const Automation = lazy(() => import("@/pages/dashboard/Automation"));
const Prospects = lazy(() => import("@/pages/dashboard/Prospects"));
const ProspectImport = lazy(() => import("@/pages/dashboard/ProspectImport"));
const Campaigns = lazy(() => import("@/pages/dashboard/Campaigns"));
const OutreachAnalytics = lazy(() => import("@/pages/dashboard/OutreachAnalytics"));
const Reporting = lazy(() => import("@/pages/dashboard/Reporting"));
const ContactDetail = lazy(() => import("@/pages/dashboard/ContactDetail"));
const StageRules = lazy(() => import("@/pages/dashboard/StageRules"));
const Sequences = lazy(() => import("@/pages/dashboard/Sequences"));
const LeadGenCleaner = lazy(() => import("@/pages/dashboard/LeadGenCleaner"));
const LeadIntelligence = lazy(() => import("@/pages/dashboard/LeadIntelligence"));
const StatementReview = lazy(() => import("@/pages/dashboard/StatementReview"));
const Outreach = lazy(() => import("@/pages/dashboard/Outreach"));
const OutreachCommand = lazy(() => import("@/pages/dashboard/OutreachCommand"));
const LeadEngine = lazy(() => import("@/pages/dashboard/LeadEngine"));
const LeadCommandCenter = lazy(() => import("@/pages/dashboard/LeadCommandCenter"));
const LeadImports = lazy(() => import("@/pages/dashboard/LeadImports"));
const BlazeIntegration = lazy(() => import("@/pages/dashboard/BlazeIntegration"));
const MerchantPortal = lazy(() => import("@/pages/dashboard/MerchantPortal"));
const MerchantApplicationsList = lazy(() => import("@/pages/dashboard/MerchantApplicationsList"));
const BoardingTracker = lazy(() => import("@/pages/dashboard/BoardingTracker"));
const AgentManagement = lazy(() => import("@/pages/dashboard/AgentManagement"));
const MerchantHealth = lazy(() => import("@/pages/dashboard/MerchantHealth"));
const Chargebacks = lazy(() => import("@/pages/dashboard/Chargebacks"));
const NpsDashboard = lazy(() => import("@/pages/dashboard/NpsDashboard"));
const RetentionCampaigns = lazy(() => import("@/pages/dashboard/RetentionCampaigns"));
const WinLoss = lazy(() => import("@/pages/dashboard/WinLoss"));
const ReferralProgram = lazy(() => import("@/pages/dashboard/ReferralProgram"));
const KnowledgeBase = lazy(() => import("@/pages/dashboard/KnowledgeBase"));
const ReviewRequests = lazy(() => import("@/pages/dashboard/ReviewRequests"));
const TestimonialSubmissions = lazy(() => import("@/pages/dashboard/TestimonialSubmissions"));
const ResidualRevenue = lazy(() => import("@/pages/dashboard/ResidualRevenue"));
const ConsentAudit = lazy(() => import("@/pages/dashboard/ConsentAudit"));
const UserManagement = lazy(() => import("@/pages/dashboard/UserManagement"));
const Permissions = lazy(() => import("@/pages/dashboard/Permissions"));
const SecuritySettings = lazy(() => import("@/pages/dashboard/SecuritySettings"));
const Calendar = lazy(() => import("@/pages/dashboard/Calendar"));
const Forecasting = lazy(() => import("@/pages/dashboard/Forecasting"));
const PciAssessment = lazy(() => import("@/pages/dashboard/PciAssessment"));
const DataRequests = lazy(() => import("@/pages/dashboard/DataRequests"));
const AuditLogs = lazy(() => import("@/pages/dashboard/AuditLogs"));
const BlogGenerator = lazy(() => import("@/pages/dashboard/BlogGenerator"));
const ContentEditor = lazy(() => import("@/pages/dashboard/ContentEditor"));
const SocialComposer = lazy(() => import("@/pages/dashboard/SocialComposer"));
const SdrDashboard = lazy(() => import("@/pages/dashboard/SdrDashboard"));
const SmsInbox = lazy(() => import("@/pages/dashboard/SmsInbox"));
const BinLookup = lazy(() => import("@/pages/dashboard/BinLookup"));
const RoundRobinAdmin = lazy(() => import("@/pages/dashboard/RoundRobinAdmin"));
const InboxHealth = lazy(() => import("@/pages/dashboard/InboxHealth"));
const SettingsIntegrations = lazy(() => import("@/pages/dashboard/SettingsIntegrations"));
const ActivationPanel = lazy(() => import("@/pages/dashboard/ActivationPanel"));
const OperatorDashboard = lazy(() => import("@/pages/dashboard/OperatorDashboard"));
const SeoHealth = lazy(() => import("@/pages/dashboard/SeoHealth"));
const Training = lazy(() => import("@/pages/dashboard/Training"));
const Leaderboard = lazy(() => import("@/pages/dashboard/Leaderboard"));
const SalesRepHome = lazy(() => import("@/pages/dashboard/SalesRepHome"));
const LiveChatDashboard = lazy(() => import("@/pages/dashboard/LiveChat"));
const DocumentVault = lazy(() => import("@/pages/dashboard/DocumentVault"));
const VirtualTerminal = lazy(() => import("@/pages/dashboard/VirtualTerminal"));
const PartnerOrgs = lazy(() => import("@/pages/dashboard/PartnerOrgs"));
const GhlSequenceGuide = lazy(() => import("@/pages/dashboard/GhlSequenceGuide"));
const GrowthPlaybook = lazy(() => import("@/pages/dashboard/GrowthPlaybook"));
const GrowthKPI = lazy(() => import("@/pages/dashboard/GrowthKPI"));

// ─────────────────────────────────────────────────────────────────────────────

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
    <Suspense fallback={<PageSkeleton />}>
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
        <Route path="/savings/:token" component={SavingsPage} />
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
        <Route path="/partners/cpa" component={PartnerCPA} />
        <Route path="/partners/bookkeeper" component={PartnerBookkeeper} />
        <Route path="/partners/insurance" component={PartnerInsurance} />
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

        {/* Guarantee Landing Page */}
        <Route path="/free-analysis-guaranteed" component={FreeAnalysisGuaranteed} />

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

        {/* NPS Survey (public token-based) */}
        <Route path="/nps/:token" component={NpsSurvey} />

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
        <Route path="/dashboard/audit-logs">
          <ProtectedRoute component={AuditLogs} />
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
        <Route path="/dashboard/ghl-sequence-guide">
          <ProtectedRoute component={GhlSequenceGuide} />
        </Route>
        <Route path="/dashboard/growth-playbook">
          <ProtectedRoute component={GrowthPlaybook} />
        </Route>
        <Route path="/dashboard/growth-kpi">
          <ProtectedRoute component={GrowthKPI} allowedRoles={["admin", "manager"]} />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Suspense>
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
