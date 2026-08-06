import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  CheckSquare, MessageSquare, BarChart3, ShieldAlert, Activity,
  Monitor, ChevronRight, TrendingUp, Mail, Users, Zap,
  AlertCircle, CheckCircle2, Clock, ExternalLink,
} from "lucide-react";

type HealthResult = {
  status: "ok" | "degraded" | "unavailable" | "error" | "warn";
  message?: string;
};
type HealthData = {
  checks: Record<string, HealthResult>;
  overallOk: boolean;
  okCount: number;
  totalCount: number;
};

function StatusDot({ status }: { status: string }) {
  const c =
    status === "ok" ? "bg-green-500" :
    status === "warn" ? "bg-yellow-500" :
    "bg-red-500";
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c}`} />;
}

function Row({
  icon: Icon, label, sublabel, onPress, badge, iconColor = "text-blue-600",
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  badge?: string;
  iconColor?: string;
}) {
  return (
    <button
      onClick={onPress}
      className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 dark:active:bg-gray-700/50 transition-colors text-left"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-800`}>
        <Icon className={`w-4.5 h-4.5 ${iconColor}`} style={{ width: "18px", height: "18px" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-white">{label}</div>
        {sublabel && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{sublabel}</div>}
      </div>
      {badge && (
        <span className="text-xs bg-blue-600 text-white rounded-full px-2 py-0.5 font-medium flex-shrink-0">
          {badge}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 pt-5 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {title}
      </span>
    </div>
  );
}

const PREFER_DESKTOP_KEY = "prefer_desktop";

export default function MobileMore() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = (user as any)?.role === "admin";
  const isManager = (user as any)?.role === "manager";
  const canSeeOps = isAdmin || isManager;

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
    staleTime: 1000 * 60 * 2,
    select: (d) => d.filter((t: any) => t.status !== "completed"),
  });

  const { data: inbox } = useQuery<{ total: number; unread: number }>({
    queryKey: ["/api/notifications"],
    staleTime: 1000 * 60,
    select: (d: any) => ({
      total: d?.total ?? (Array.isArray(d) ? d.length : 0),
      unread: d?.unread ?? (Array.isArray(d) ? d.filter((n: any) => !n.read).length : 0),
    }),
  });

  const { data: health } = useQuery<HealthData>({
    queryKey: ["/api/admin/live-health"],
    staleTime: 1000 * 60 * 10,
    enabled: isAdmin,
  });

  const { data: outreach } = useQuery<any>({
    queryKey: ["/api/outreach/status"],
    staleTime: 1000 * 60 * 5,
    enabled: canSeeOps,
  });

  function switchToDesktop() {
    localStorage.setItem(PREFER_DESKTOP_KEY, "true");
    window.location.href = "/dashboard";
  }

  const openTasks = tasks.length;
  const unreadInbox = inbox?.unread ?? 0;
  const healthOk = health?.overallOk ?? true;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">More</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">

        {/* Work */}
        <SectionHeader title="Work" />
        <div className="bg-white dark:bg-gray-800 mx-4 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
          <Row
            icon={CheckSquare}
            label="Tasks"
            sublabel={openTasks > 0 ? `${openTasks} open task${openTasks !== 1 ? "s" : ""}` : "All caught up"}
            onPress={() => setLocation("/mobile/tasks")}
            badge={openTasks > 0 ? String(openTasks) : undefined}
            iconColor="text-purple-600"
          />
          <Row
            icon={MessageSquare}
            label="Inbox"
            sublabel={unreadInbox > 0 ? `${unreadInbox} unread` : "No new messages"}
            onPress={() => setLocation("/mobile/inbox")}
            badge={unreadInbox > 0 ? String(unreadInbox) : undefined}
            iconColor="text-blue-600"
          />
        </div>

        {/* Analytics */}
        {canSeeOps && (
          <>
            <SectionHeader title="Analytics" />
            <div className="bg-white dark:bg-gray-800 mx-4 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
              <Row
                icon={BarChart3}
                label="Outreach Overview"
                sublabel={
                  outreach
                    ? `${outreach.contacts?.total ?? "—"} contacts · ${outreach.deals?.total ?? "—"} deals`
                    : "View funnel & source stats"
                }
                onPress={() => setLocation("/mobile/outreach")}
                iconColor="text-green-600"
              />
              <Row
                icon={TrendingUp}
                label="Full Reporting"
                sublabel="Open desktop reporting hub"
                onPress={() => {
                  localStorage.setItem(PREFER_DESKTOP_KEY, "true");
                  window.location.href = "/dashboard/reporting";
                }}
                iconColor="text-indigo-600"
              />
            </div>
          </>
        )}

        {/* Outreach Quick Stats (admin/manager) */}
        {canSeeOps && outreach && (
          <div className="mx-4 mt-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl border border-blue-100 dark:border-blue-900/40 p-4">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-3 uppercase tracking-wider">
              Live Outreach Stats
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Contacts", value: outreach.contacts?.total },
                { label: "Deals", value: outreach.deals?.total },
                { label: "Campaigns", value: outreach.activeCampaigns },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-lg font-bold text-gray-900 dark:text-white">
                    {value != null ? value.toLocaleString() : "—"}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Operator Tools (admin/manager) */}
        {canSeeOps && (
          <>
            <SectionHeader title="Operator Tools" />
            <div className="bg-white dark:bg-gray-800 mx-4 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
              {isAdmin && (
                <Row
                  icon={Activity}
                  label="System Health"
                  sublabel={
                    health
                      ? `${health.okCount}/${health.totalCount} checks passing`
                      : "Background workers & AI"
                  }
                  onPress={() => {
                    localStorage.setItem(PREFER_DESKTOP_KEY, "true");
                    window.location.href = "/dashboard/system-audit";
                  }}
                  iconColor={healthOk ? "text-green-600" : "text-red-500"}
                  badge={!healthOk ? "!" : undefined}
                />
              )}
              <Row
                icon={ShieldAlert}
                label="Blocked Contacts"
                sublabel="DNC, bounced & opted-out"
                onPress={() => {
                  localStorage.setItem(PREFER_DESKTOP_KEY, "true");
                  window.location.href = "/dashboard/contacts?tab=blocked";
                }}
                iconColor="text-orange-500"
              />
              <Row
                icon={Mail}
                label="Email Sequences"
                sublabel="Full sequence editor"
                onPress={() => {
                  localStorage.setItem(PREFER_DESKTOP_KEY, "true");
                  window.location.href = "/dashboard/sequences";
                }}
                iconColor="text-pink-600"
              />
              {isAdmin && (
                <Row
                  icon={Users}
                  label="Operator Dashboard"
                  sublabel="Full admin console"
                  onPress={() => {
                    localStorage.setItem(PREFER_DESKTOP_KEY, "true");
                    window.location.href = "/dashboard/operator";
                  }}
                  iconColor="text-gray-600"
                />
              )}
            </div>
          </>
        )}

        {/* System Health Summary (admin only, inline) */}
        {isAdmin && health && (
          <div className="mx-4 mt-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Health Checks
              </span>
              <span className={`text-xs font-medium ${healthOk ? "text-green-600" : "text-red-500"}`}>
                {healthOk ? "All systems go" : "Issues detected"}
              </span>
            </div>
            <div className="space-y-2">
              {Object.entries(health.checks).map(([name, result]) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <StatusDot status={result.status} />
                    <span className="text-gray-700 dark:text-gray-300 capitalize">
                      {name.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                  </div>
                  <span className="text-gray-400 dark:text-gray-500 truncate max-w-[140px] text-right">
                    {result.message ?? result.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Account */}
        <SectionHeader title="Account" />
        <div className="bg-white dark:bg-gray-800 mx-4 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
          <Row
            icon={Monitor}
            label="Switch to Desktop View"
            sublabel="Full dashboard with all features"
            onPress={switchToDesktop}
            iconColor="text-gray-500"
          />
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
