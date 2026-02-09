import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Home from "@/pages/Home";
import GetStarted from "@/pages/GetStarted";
import UploadStatement from "@/pages/UploadStatement";
import NotFound from "@/pages/not-found";
import { DashboardLayout } from "@/pages/DashboardLayout";
import Overview from "@/pages/dashboard/Overview";
import Contacts from "@/pages/dashboard/Contacts";
import Chat from "@/pages/dashboard/Chat";

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
      <Route path="/dashboard/tickets">
        <ProtectedRoute component={() => <div>Tickets Component Placeholder</div>} />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
