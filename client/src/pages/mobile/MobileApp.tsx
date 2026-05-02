import { useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Home, Users, LayoutList, CheckSquare, User, WifiOff } from "lucide-react";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import MobileLogin from "./MobileLogin";
import MobileHome from "./MobileHome";
import MobileContacts from "./MobileContacts";
import MobileContactDetail from "./MobileContactDetail";
import MobilePipeline from "./MobilePipeline";
import MobileTasks from "./MobileTasks";
import MobileProfile from "./MobileProfile";

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  return online;
}

const TABS = [
  { path: "/mobile", label: "Home", icon: Home },
  { path: "/mobile/contacts", label: "Contacts", icon: Users },
  { path: "/mobile/pipeline", label: "Pipeline", icon: LayoutList },
  { path: "/mobile/tasks", label: "Tasks", icon: CheckSquare },
  { path: "/mobile/profile", label: "Profile", icon: User },
];

function BottomNav() {
  const [location, setLocation] = useLocation();

  function isActive(path: string) {
    if (path === "/mobile") return location === "/mobile" || location === "/mobile/";
    return location.startsWith(path);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex z-50 safe-bottom" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {TABS.map(({ path, label, icon: Icon }) => (
        <button
          key={path}
          data-testid={`nav-${label.toLowerCase()}`}
          onClick={() => setLocation(path)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
            isActive(path)
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          <Icon className={`w-5 h-5 ${isActive(path) ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`} />
          {label}
        </button>
      ))}
    </nav>
  );
}

function MobileShell() {
  const { user, isLoading } = useAuth();
  const online = useOnlineStatus();
  const { queueCount } = useOfflineQueue();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/mobile/login");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 max-w-md mx-auto relative" style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom))" }}>
      {!online && (
        <div className="bg-amber-500 text-white text-xs text-center py-1.5 px-3 flex items-center justify-center gap-1.5 sticky top-0 z-40" data-testid="offline-banner">
          <WifiOff className="w-3 h-3" />
          Offline — showing cached data
          {queueCount > 0 && (
            <span className="bg-white/30 rounded-full px-1.5 py-0.5 font-bold ml-1">
              {queueCount} pending
            </span>
          )}
        </div>
      )}
      <Switch>
        <Route path="/mobile" component={MobileHome} />
        <Route path="/mobile/contacts" component={MobileContacts} />
        <Route path="/mobile/contacts/:id" component={MobileContactDetail} />
        <Route path="/mobile/pipeline" component={MobilePipeline} />
        <Route path="/mobile/tasks" component={MobileTasks} />
        <Route path="/mobile/profile" component={MobileProfile} />
        <Route><Redirect to="/mobile" /></Route>
      </Switch>
      <BottomNav />
    </div>
  );
}

export default function MobileApp() {
  const [location] = useLocation();

  if (location === "/mobile/login") {
    return <MobileLogin />;
  }

  return <MobileShell />;
}
