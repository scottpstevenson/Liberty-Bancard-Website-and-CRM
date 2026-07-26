import { useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Home, Users, LayoutList, CheckSquare, MessageSquare, Monitor, WifiOff, LogOut, ChevronRight, X } from "lucide-react";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import MobileLogin from "./MobileLogin";
import MobileHome from "./MobileHome";
import MobileContacts from "./MobileContacts";
import MobileContactDetail from "./MobileContactDetail";
import MobilePipeline from "./MobilePipeline";
import MobileTasks from "./MobileTasks";
import MobileProfile from "./MobileProfile";
import MobileInbox from "./MobileInbox";

const PREFER_DESKTOP_KEY = "prefer_desktop";

// Pages that already show a prominent profile header — hide the avatar overlay there
const HIDE_AVATAR_PATHS = ["/mobile/profile"];

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

/** Deterministic hue from a string — same logic used in contact avatars */
function stringToHue(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function getAvatarStyle(name: string): { background: string; color: string } {
  const hue = stringToHue(name);
  return {
    background: `hsl(${hue}, 55%, 45%)`,
    color: "#ffffff",
  };
}

function getInitials(first?: string | null, last?: string | null): string {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "?";
}

const TABS = [
  { path: "/mobile", label: "Home", icon: Home },
  { path: "/mobile/contacts", label: "Contacts", icon: Users },
  { path: "/mobile/pipeline", label: "Pipeline", icon: LayoutList },
  { path: "/mobile/inbox", label: "Inbox", icon: MessageSquare },
  { path: "/mobile/tasks", label: "Tasks", icon: CheckSquare },
];

function BottomNav() {
  const [location, setLocation] = useLocation();

  function isActive(path: string) {
    if (path === "/mobile") return location === "/mobile" || location === "/mobile/";
    return location.startsWith(path);
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
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

/** Slide-up profile quick-access sheet */
function ProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user, logout, isLoggingOut } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const initials = getInitials(user.firstName, user.lastName);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const avatarStyle = getAvatarStyle(name);

  function goToProfile() {
    onClose();
    setLocation("/mobile/profile");
  }

  async function handleSignOut() {
    onClose();
    await logout();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile menu"
        data-testid="profile-sheet"
        className={`fixed bottom-0 left-0 right-0 z-[70] bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out max-w-md mx-auto ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={avatarStyle}
            >
              <span className="text-white text-sm font-bold">{initials}</span>
            </div>
            <div>
              <div className="font-semibold text-gray-900 dark:text-white text-sm leading-tight" data-testid="sheet-user-name">
                {name}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500" data-testid="sheet-user-email">
                {user.email}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="px-4 pt-3 space-y-2">
          <button
            data-testid="sheet-link-profile"
            onClick={goToProfile}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-gray-50 dark:bg-gray-800 rounded-2xl active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
          >
            <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Profile & Settings</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">Password, notifications, account</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
          </button>

          <button
            data-testid="sheet-button-signout"
            onClick={handleSignOut}
            disabled={isLoggingOut}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 rounded-2xl active:bg-red-100 dark:active:bg-red-900/40 transition-colors"
          >
            {isLoggingOut ? (
              <Loader2 className="w-4 h-4 text-red-500 animate-spin flex-shrink-0" />
            ) : (
              <LogOut className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
              {isLoggingOut ? "Signing out…" : "Sign Out"}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

/** Fixed avatar button shown in every mobile shell page header */
function AvatarOverlay() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!user) return null;

  // Hide on the profile page itself — it already shows the avatar prominently
  if (HIDE_AVATAR_PATHS.some((p) => location === p || location.startsWith(p + "/"))) {
    return null;
  }

  const initials = getInitials(user.firstName, user.lastName);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const avatarStyle = getAvatarStyle(name);

  return (
    <>
      <button
        data-testid="button-avatar-overlay"
        onClick={() => setSheetOpen(true)}
        aria-label="Open profile menu"
        className="fixed right-4 z-[55] flex items-center justify-center w-9 h-9 rounded-full shadow-md active:scale-90 transition-transform"
        style={{
          top: "calc(env(safe-area-inset-top) + 12px)",
          ...avatarStyle,
        }}
      >
        <span className="text-white text-xs font-bold leading-none">{initials}</span>
      </button>

      <ProfileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
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

  function switchToDesktop() {
    localStorage.setItem(PREFER_DESKTOP_KEY, "true");
    window.location.href = "/dashboard";
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-950 max-w-md mx-auto relative"
      style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom))" }}
    >
      {!online && (
        <div
          className="bg-amber-500 text-white text-xs text-center py-1.5 px-3 flex items-center justify-center gap-1.5 sticky top-0 z-40"
          data-testid="offline-banner"
        >
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
        <Route path="/mobile/inbox" component={MobileInbox} />
        <Route path="/mobile/tasks" component={MobileTasks} />
        <Route path="/mobile/profile" component={MobileProfile} />
        <Route><Redirect to="/mobile" /></Route>
      </Switch>

      {/* Desktop switch — discreet footer link */}
      <div className="text-center py-2 pb-0">
        <button
          data-testid="button-switch-desktop"
          onClick={switchToDesktop}
          className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
        >
          <Monitor className="w-3 h-3" />
          Switch to desktop view
        </button>
      </div>

      {/* Avatar overlay — floats over every page in the shell */}
      <AvatarOverlay />

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
