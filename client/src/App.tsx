import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { ExitIntentPopup } from "@/components/ExitIntentPopup";
import { ContactBubble } from "@/components/ContactBubble";

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
import ThanksStatement from "@/pages/ThanksStatement";
import ThanksEstimate from "@/pages/ThanksEstimate";
import ThanksCall from "@/pages/ThanksCall";
import ThanksSupport from "@/pages/ThanksSupport";
import AssetPage from "@/pages/AssetPage";
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
import CaseStudyIntake from "@/pages/dashboard/CaseStudyIntake";
import GhlSettings from "@/pages/dashboard/GhlSettings";
import Automation from "@/pages/dashboard/Automation";
import Prospects from "@/pages/dashboard/Prospects";
import ProspectImport from "@/pages/dashboard/ProspectImport";
import Campaigns from "@/pages/dashboard/Campaigns";
import OutreachAnalytics from "@/pages/dashboard/OutreachAnalytics";
import Reporting from "@/pages/dashboard/Reporting";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Redirect to login handled by useAuth or manual check
    window.location.href = "/api/login";
    return null;
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
      <Route path="/thanks-statement" component={ThanksStatement} />
      <Route path="/thanks-estimate" component={ThanksEstimate} />
      <Route path="/thanks-call" component={ThanksCall} />
      <Route path="/thanks-support" component={ThanksSupport} />

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
      <Route path="/dashboard/onboarding-kickoff">
        <ProtectedRoute component={OnboardingKickoff} />
      </Route>
      <Route path="/dashboard/workflows">
        <ProtectedRoute component={Workflows} />
      </Route>
      <Route path="/dashboard/rfis">
        <ProtectedRoute component={RFIs} />
      </Route>
      <Route path="/dashboard/case-study-intake">
        <ProtectedRoute component={CaseStudyIntake} />
      </Route>
      <Route path="/dashboard/ghl-settings">
        <ProtectedRoute component={GhlSettings} />
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
      <Route path="/dashboard/campaigns">
        <ProtectedRoute component={Campaigns} />
      </Route>
      <Route path="/dashboard/outreach-analytics">
        <ProtectedRoute component={OutreachAnalytics} />
      </Route>
      <Route path="/dashboard/reporting">
        <ProtectedRoute component={Reporting} />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function PublicLayout() {
  const [location] = useLocation();
  const isDashboard = location.startsWith("/dashboard");
  const isThanksPage = location.startsWith("/thanks");

  return (
    <>
      <Router />
      {!isDashboard && !isThanksPage && <StickyMobileCTA />}
      {!isDashboard && <ExitIntentPopup />}
      {!isDashboard && !isThanksPage && <ContactBubble />}
    </>
  );
}

function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <PublicLayout />
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
