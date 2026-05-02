import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, User, ExternalLink, Shield, Bell, ChevronRight, Smartphone, Info, BellOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function getInitials(first?: string | null, last?: string | null): string {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "?";
}

type NotifStatus = "default" | "granted" | "denied" | "unsupported";

async function urlBase64ToUint8Array(base64String: string): Promise<Uint8Array> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function MobileProfile() {
  const { user, logout, isLoggingOut } = useAuth();
  const { toast } = useToast();
  const [notifStatus, setNotifStatus] = useState<NotifStatus>("default");
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotifStatus("unsupported");
    } else {
      setNotifStatus(Notification.permission as NotifStatus);
    }
  }, []);

  async function handleEnableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Not supported", description: "Push notifications are not supported on this browser.", variant: "destructive" });
      return;
    }

    setSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      setNotifStatus(permission as NotifStatus);

      if (permission !== "granted") {
        toast({ title: "Permission denied", description: "Enable notifications in your browser settings to receive alerts.", variant: "destructive" });
        setSubscribing(false);
        return;
      }

      const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!keyRes.ok) throw new Error("Could not load push config");
      const { publicKey } = await keyRes.json();

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await urlBase64ToUint8Array(publicKey),
      });

      const subRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription }),
      });

      if (!subRes.ok) throw new Error("Failed to register subscription");

      toast({ title: "Notifications enabled", description: "You'll be notified of new leads and deal changes." });
    } catch (err: any) {
      console.error("[Push]", err);
      toast({ title: "Setup failed", description: err.message || "Could not enable push notifications.", variant: "destructive" });
    } finally {
      setSubscribing(false);
    }
  }

  async function handleDisableNotifications() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setNotifStatus("default");
      toast({ title: "Notifications disabled" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  if (!user) return null;

  const initials = getInitials(user.firstName, user.lastName);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div>
      <div className="bg-blue-600 px-4 pb-8" style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}>
        <h1 className="text-white text-xl font-bold mb-4">Profile</h1>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
            <span className="text-white text-xl font-bold" data-testid="text-user-initials">{initials}</span>
          </div>
          <div>
            <div className="text-white font-bold text-lg" data-testid="text-user-name">{name}</div>
            <div className="text-blue-200 text-sm" data-testid="text-user-email">{user.email}</div>
            {user.role && (
              <span className="inline-block bg-white/20 text-white text-xs px-2 py-0.5 rounded-full mt-1 capitalize">
                {user.role}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden mb-4">
          <a
            data-testid="link-full-crm"
            href="/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-4 active:bg-gray-50 dark:active:bg-gray-700"
          >
            <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <ExternalLink className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Open Full CRM</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">Access the full dashboard</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
          </a>

          <a
            data-testid="link-security"
            href="/dashboard/security"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-4 active:bg-gray-50 dark:active:bg-gray-700"
          >
            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
              <Shield className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Security Settings</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">Password, 2FA, sessions</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
          </a>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden mb-4">
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                {notifStatus === "granted" ? (
                  <Bell className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                ) : (
                  <BellOff className="w-4 h-4 text-gray-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-white">Push Notifications</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  {notifStatus === "granted"
                    ? "Enabled — alerts for new leads & deal changes"
                    : notifStatus === "denied"
                    ? "Blocked — enable in browser settings"
                    : notifStatus === "unsupported"
                    ? "Not supported by this browser"
                    : "Get alerts for new leads and deal updates"}
                </div>
              </div>
            </div>
            {notifStatus !== "unsupported" && notifStatus !== "denied" && (
              <button
                data-testid="button-enable-notifications"
                onClick={notifStatus === "granted" ? handleDisableNotifications : handleEnableNotifications}
                disabled={subscribing}
                className={`mt-3 w-full py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                  notifStatus === "granted"
                    ? "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    : "bg-blue-600 text-white active:bg-blue-700"
                }`}
              >
                {subscribing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Setting up...</>
                ) : notifStatus === "granted" ? (
                  <><BellOff className="w-4 h-4" /> Disable Notifications</>
                ) : (
                  <><Bell className="w-4 h-4" /> Enable Notifications</>
                )}
              </button>
            )}
            {notifStatus === "denied" && (
              <p className="mt-2 text-xs text-red-500">
                Open your browser/OS notification settings to unblock this site.
              </p>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4">
          <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 dark:border-gray-700">
            <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-gray-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Add to Home Screen</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">Install this app on your device</div>
            </div>
          </div>
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              <strong>iOS:</strong> Tap the share icon in Safari, then "Add to Home Screen"
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              <strong>Android:</strong> Tap the menu in Chrome, then "Add to Home Screen"
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center">
              <Info className="w-4 h-4 text-gray-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">App Info</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">Liberty Bancard Field Sales v1.0</div>
            </div>
          </div>
        </div>

        <button
          data-testid="button-logout"
          onClick={() => logout()}
          disabled={isLoggingOut}
          className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <LogOut className="w-4 h-4" />
          {isLoggingOut ? "Signing out..." : "Sign Out"}
        </button>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-4 pb-2">
          Liberty Bancard · Field Sales Portal
        </p>
      </div>
    </div>
  );
}
