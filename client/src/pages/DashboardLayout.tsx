import { ReactNode, useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { countUnreadSessions } from "@/lib/chatNotifications";
import logoBlue from "@assets/logo-blue.png";
import UniversalSearch from "@/components/UniversalSearch";
import { EmailComposer } from "@/components/EmailComposer";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  LayoutDashboard,
  Users,
  Ticket,
  MessageSquare,
  MessageCircle,
  LogOut,
  TrendingUp,
  Package,
  ClipboardList,
  Bell,
  PhoneCall,
  FileCheck,
  Rocket,
  Zap,
  FileQuestion,
  ListChecks,
  Settings,
  BarChart3,
  BookOpen,
  Target,
  Upload,
  Send,
  BarChart2,
  Mail,
  PieChart,
  GitBranch,
  Repeat,
  Wand2,
  Brain,
  ListOrdered,
  Megaphone,
  Sparkles,
  FileSearch,
  FileBarChart,
  Trophy,
  DollarSign,
  UserPlus,
  HeartPulse,
  Handshake,
  Star,
  ShieldCheck,
  HelpCircle,
  UserCog,
  Calendar,
  Pencil,
  Bot,
  Mailbox,
  Rocket as RocketIcon,
  Activity,
  Search as SearchIcon,
  Workflow,
  GraduationCap,
  Link2,
  ShieldAlert,
  CreditCard,
  ArrowRightLeft,
  Inbox,
  ThumbsUp,
  RefreshCw,
  FolderOpen,
  X,
  ShieldOff,
  FileText,
  Linkedin,
  Code2,
  Monitor,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

interface DashboardLayoutProps {
  children: ReactNode;
}

type UserRole = "admin" | "manager" | "agent" | "merchant";

interface MenuItem {
  icon: any;
  label: string;
  href: string;
  roles?: UserRole[];
  badgeKey?: string;
}

// ─── WORK ─────────────────────────────────────────────────────────────────────
// Daily work items for all CRM users. Virtual Terminal is appended via filteredTools.
const workItems: MenuItem[] = [
  { icon: Star, label: "My Day", href: "/dashboard/my-day", roles: ["agent"] },
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard", roles: ["admin", "manager"] },
  { icon: Users, label: "My Contacts", href: "/dashboard/contacts", roles: ["agent"] },
  { icon: Users, label: "Contacts", href: "/dashboard/contacts", roles: ["admin", "manager"] },
  { icon: TrendingUp, label: "My Pipeline", href: "/dashboard/pipeline", roles: ["agent"] },
  { icon: TrendingUp, label: "Pipeline", href: "/dashboard/pipeline", roles: ["admin", "manager"] },
  { icon: ClipboardList, label: "My Tasks", href: "/dashboard/tasks", roles: ["agent"] },
  { icon: ClipboardList, label: "Tasks", href: "/dashboard/tasks", roles: ["admin", "manager"] },
  { icon: Calendar, label: "My Calendar", href: "/dashboard/calendar", roles: ["agent"] },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar", roles: ["admin", "manager"] },
  { icon: Inbox, label: "Comms Hub", href: "/dashboard/comms-hub", roles: ["admin", "manager", "agent"] },
  { icon: Ticket, label: "Support Hub", href: "/dashboard/support-hub", roles: ["admin", "manager"] },
  { icon: MessageSquare, label: "AI Advisor", href: "/dashboard/chat", roles: ["admin", "manager", "agent"] },
];
// Note: /dashboard/notifications is accessible via the topbar bell icon and is intentionally
// excluded from the sidebar to keep WORK at 12 visible items for admin.

// Virtual Terminal: admin/manager always; agents with "virtual_terminal" permission.
// Handled by filteredTools (concatenated into filteredWork at render time).
const toolsItems: MenuItem[] = [
  { icon: CreditCard, label: "Virtual Terminal", href: "/dashboard/virtual-terminal", roles: ["admin", "manager"] },
];

// ─── MERCHANT OPS ─────────────────────────────────────────────────────────────
const merchantOpsItems: MenuItem[] = [
  { icon: ShieldCheck, label: "My Portal", href: "/dashboard/merchant-portal", roles: ["merchant"] },
  { icon: ClipboardList, label: "Applications", href: "/dashboard/merchant-applications", roles: ["admin", "manager"], badgeKey: "pendingApplications" },
  { icon: Send, label: "Boarding", href: "/dashboard/boarding", roles: ["admin", "manager"] },
  { icon: Package, label: "Onboarding", href: "/dashboard/onboarding", roles: ["admin", "manager"] },
  { icon: Rocket, label: "Onboarding Kickoff", href: "/dashboard/onboarding-kickoff", roles: ["admin", "manager"] },
  { icon: FileBarChart, label: "Statement Review", href: "/dashboard/statement-review", roles: ["admin", "manager"] },
  { icon: ShieldCheck, label: "Underwriting", href: "/dashboard/underwriting", roles: ["admin", "manager"] },
  { icon: ShieldAlert, label: "Merchant Risk", href: "/dashboard/merchant-risk", roles: ["admin", "manager"] },
  { icon: FolderOpen, label: "Document Vault", href: "/dashboard/document-vault", roles: ["admin", "manager"] },
  { icon: HelpCircle, label: "Knowledge Base", href: "/dashboard/knowledge-base" },
  { icon: GraduationCap, label: "Training", href: "/dashboard/training", roles: ["admin", "manager", "agent"] },
];

// ─── LEAD ENGINE ──────────────────────────────────────────────────────────────
const leadEngineItems: MenuItem[] = [
  { icon: Bot, label: "SDR Hub", href: "/dashboard/sdr-hub", roles: ["admin", "manager"] },
  { icon: RocketIcon, label: "Outreach Hub", href: "/dashboard/outreach-hub", roles: ["admin", "manager"] },
  { icon: Brain, label: "Lead Command Center", href: "/dashboard/lead-command-center", roles: ["admin", "manager"] },
  { icon: Upload, label: "Lead Imports", href: "/dashboard/lead-imports", roles: ["admin", "manager"] },
  { icon: Target, label: "Prospects", href: "/dashboard/prospects", roles: ["admin", "manager"] },
  { icon: FileSearch, label: "Sunbiz Lead Gen", href: "/dashboard/lead-gen", roles: ["admin", "manager"] },
  { icon: Sparkles, label: "Lead Intelligence", href: "/dashboard/lead-intelligence", roles: ["admin", "manager"] },
  { icon: CreditCard, label: "Card BIN Lookup", href: "/dashboard/bin-lookup", roles: ["admin", "manager", "agent"] },
  { icon: PhoneCall, label: "Call Outcome", href: "/dashboard/call-outcome", roles: ["admin", "manager", "agent"] },
  { icon: FileCheck, label: "Review Complete", href: "/dashboard/review-complete", roles: ["admin", "manager", "agent"] },
];

// ─── AUTOMATION ───────────────────────────────────────────────────────────────
// Automation overview is the first item per spec. Email Health + Inbox Health together.
// All GHL items live in SYSTEM per spec; Settings → Integrations and Data Requests
// are included here as integration/configuration items to keep AUTOMATION at 12.
const automationItems: MenuItem[] = [
  { icon: BarChart3, label: "Automation", href: "/dashboard/automation", roles: ["admin", "manager"] },
  { icon: Zap, label: "Workflows", href: "/dashboard/workflows", roles: ["admin", "manager"] },
  { icon: ListOrdered, label: "Sequences", href: "/dashboard/sequences", roles: ["admin", "manager"] },
  { icon: GitBranch, label: "Stage Rules", href: "/dashboard/stage-rules", roles: ["admin", "manager"] },
  { icon: Megaphone, label: "Campaigns", href: "/dashboard/campaigns", roles: ["admin", "manager"] },
  { icon: Mail, label: "Deliverability", href: "/dashboard/deliverability-hub", roles: ["admin", "manager"] },
  { icon: RocketIcon, label: "Go-Live Controls", href: "/dashboard/activation", roles: ["admin"] },
  { icon: ArrowRightLeft, label: "Round-Robin", href: "/dashboard/round-robin", roles: ["admin", "manager"] },
  { icon: Settings, label: "Settings → Integrations", href: "/dashboard/settings/integrations", roles: ["admin"] },
  { icon: Database, label: "Data Requests", href: "/dashboard/data-requests", roles: ["admin", "manager"] },
];

// ─── INTELLIGENCE ─────────────────────────────────────────────────────────────
const intelligenceItems: MenuItem[] = [
  { icon: PieChart, label: "Reporting", href: "/dashboard/reporting", roles: ["admin", "manager"] },
  { icon: DollarSign, label: "Financial Hub", href: "/dashboard/financial-hub", roles: ["admin", "manager"] },
  { icon: Activity, label: "System Health", href: "/dashboard/system-health", roles: ["admin", "manager"] },
  { icon: Trophy, label: "Leaderboard", href: "/dashboard/leaderboard", roles: ["admin", "manager", "agent"] },
];

// ─── GROWTH & PARTNERS ────────────────────────────────────────────────────────
// Marketing Playbook + Growth Playbook here per spec. Collateral is agent-only.
const growthItems: MenuItem[] = [
  { icon: UserPlus, label: "Agent Management", href: "/dashboard/agent-management", roles: ["admin", "manager"] },
  { icon: Handshake, label: "Referral Program", href: "/dashboard/referral-program", roles: ["admin", "manager"] },
  { icon: Link2, label: "Partner Orgs", href: "/dashboard/partner-orgs", roles: ["admin"] },
  { icon: FileCheck, label: "Co-Branded Proposals", href: "/dashboard/co-branded-proposals", roles: ["admin", "manager"] },
  { icon: Code2, label: "Widget Generator", href: "/dashboard/widget-generator", roles: ["admin", "manager"] },
  { icon: HeartPulse, label: "Merchant Success", href: "/dashboard/merchant-success", roles: ["admin", "manager"] },
  { icon: BookOpen, label: "Playbooks", href: "/dashboard/playbooks", roles: ["admin", "manager", "agent"] },
  { icon: BookOpen, label: "Case Study Intake", href: "/dashboard/case-study-intake", roles: ["admin", "manager"] },
  { icon: BookOpen, label: "Collateral", href: "/assets", roles: ["agent"] },
];

// ─── SYSTEM ───────────────────────────────────────────────────────────────────
const systemItems: MenuItem[] = [
  { icon: Workflow, label: "GHL Integration", href: "/dashboard/ghl-integration", roles: ["admin", "manager"] },
  { icon: FileText, label: "Content Hub", href: "/dashboard/content-hub", roles: ["admin", "manager"] },
  { icon: UserCog, label: "Admin Hub", href: "/dashboard/admin-hub", roles: ["admin", "manager"] },
  { icon: ShieldCheck, label: "Security Settings", href: "/dashboard/security", roles: ["admin", "manager", "agent", "merchant"] },
];

function filterByRole(items: MenuItem[], role: UserRole): MenuItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

const TWO_FA_BANNER_KEY = "2fa_banner_dismissed";

function GhlAlertBanner({ role }: { role: UserRole }) {
  const isPrivileged = role === "admin" || role === "manager";
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<{ connected: boolean; status: "ok" | "expired" | "unconfigured"; error?: string; locationName?: string }>({
    queryKey: ["/api/admin/ghl-health"],
    enabled: isPrivileged && !dismissed,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 25_000,
  });

  if (!isPrivileged || dismissed || !data || data.status === "ok") return null;

  const isUnconfigured = data.status === "unconfigured";

  return (
    <div
      data-testid="banner-ghl-alert"
      className="flex items-start gap-3 px-4 py-3 text-sm bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100 border-b border-red-200 dark:border-red-800"
      role="alert"
    >
      <Workflow className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
      <span className="flex-1">
        {isUnconfigured ? (
          <>
            <strong>GHL not configured.</strong>{" "}
            Set <code className="text-xs bg-red-100 dark:bg-red-900 px-1 rounded">GHL_PRIVATE_INTEGRATION_TOKEN</code> and{" "}
            <code className="text-xs bg-red-100 dark:bg-red-900 px-1 rounded">GHL_LOCATION_ID</code> in Replit Secrets to enable sync.
          </>
        ) : (
          <>
            <strong>GHL token expired or rejected.</strong>{" "}
            {data.error && <span className="opacity-80">{data.error}. </span>}
            To fix: go to{" "}
            <a
              href="https://app.gohighlevel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold hover:opacity-80"
              data-testid="link-ghl-ext-regen"
            >
              app.gohighlevel.com
            </a>
            {" "}→ Settings → Private Integrations → regenerate token → update{" "}
            <code className="text-xs bg-red-100 dark:bg-red-900 px-1 rounded">GHL_PRIVATE_INTEGRATION_TOKEN</code>.
          </>
        )}
      </span>
      <Link
        href="/dashboard/ghl-integration"
        data-testid="link-ghl-banner-fix"
        className="underline underline-offset-2 font-semibold text-red-800 dark:text-red-200 hover:opacity-80 whitespace-nowrap shrink-0"
      >
        GHL Settings
      </Link>
      <button
        onClick={() => setDismissed(true)}
        data-testid="button-ghl-banner-dismiss"
        aria-label="Dismiss GHL alert until next page load"
        className="ml-1 p-0.5 rounded hover:opacity-70 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function TwoFaBanner({ role }: { role: UserRole }) {
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(TWO_FA_BANNER_KEY) === "true"
  );

  const handleDismiss = () => {
    localStorage.setItem(TWO_FA_BANNER_KEY, "true");
    setDismissed(true);
  };

  if (dismissed) return null;

  const isAdmin = role === "admin";

  return (
    <div
      data-testid="banner-2fa-enrollment"
      className={
        isAdmin
          ? "flex items-center gap-3 px-4 py-3 text-sm font-medium bg-destructive text-destructive-foreground"
          : "flex items-center gap-3 px-4 py-2.5 text-sm bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100 border-b border-amber-200 dark:border-amber-800"
      }
    >
      <ShieldOff className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {isAdmin
          ? "Security warning: Your admin account does not have two-factor authentication enabled. Enable 2FA immediately to protect your account."
          : "Protect your account by enabling two-factor authentication (2FA)."}
      </span>
      <Link
        href="/dashboard/security"
        data-testid="link-2fa-banner-setup"
        className={
          isAdmin
            ? "underline underline-offset-2 font-semibold hover:opacity-80 whitespace-nowrap"
            : "underline underline-offset-2 font-semibold text-amber-800 dark:text-amber-200 hover:opacity-80 whitespace-nowrap"
        }
      >
        Set up 2FA
      </Link>
      <button
        onClick={handleDismiss}
        data-testid="button-2fa-banner-dismiss"
        aria-label="Dismiss 2FA banner"
        className="ml-1 p-0.5 rounded hover:opacity-70 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const role = (user?.role as UserRole) || "merchant";

  const { data: smsUnreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/sms-inbox/unread-count"],
    refetchInterval: 60000,
    enabled: ["admin", "manager", "agent"].includes(role),
  });
  const smsUnreadCount = smsUnreadData?.count || 0;

  const { data: pendingAppsData } = useQuery<{ count: number }>({
    queryKey: ["/api/merchant-applications/pending-count"],
    refetchInterval: 60000,
    enabled: ["admin", "manager"].includes(role),
  });
  const pendingApplicationsCount = pendingAppsData?.count || 0;

  const { data: jobStatusData } = useQuery<{ jobs: Array<{ consecutiveFailures: number }> }>({
    queryKey: ["/api/operator/job-status"],
    refetchInterval: 60000,
    enabled: ["admin", "manager"].includes(role),
  });
  const jobAlertsCount = (jobStatusData?.jobs ?? []).filter(j => j.consecutiveFailures >= 3).length;

  const { data: notifCountData } = useQuery<{ unread: number }>({
    queryKey: ["/api/notifications/count"],
    refetchInterval: 30000,
    enabled: ["admin", "manager", "agent"].includes(role),
  });
  const notificationsUnreadCount = notifCountData?.unread || 0;

  const { data: liveChatSessions = [] } = useQuery<Array<{ id: number; lastMessageAt: string; status: string }>>({
    queryKey: ["/api/live-chat/sessions", "active"],
    queryFn: async () => {
      const res = await fetch("/api/live-chat/sessions?status=active", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 8000,
    enabled: ["admin", "manager", "agent"].includes(role),
  });

  const [liveChatUnreadCount, setLiveChatUnreadCount] = useState(0);

  useEffect(() => {
    setLiveChatUnreadCount(countUnreadSessions(liveChatSessions));
  }, [liveChatSessions]);

  const { data: reviewQueueCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/review-queue/pending-count"],
    refetchInterval: 60000,
    enabled: ["admin", "manager"].includes(role),
  });
  const reviewQueuePendingCount = reviewQueueCountData?.count || 0;

  const badges: Record<string, number> = {
    smsUnread: smsUnreadCount,
    notificationsUnread: notificationsUnreadCount,
    liveChatUnread: liveChatUnreadCount,
    pendingApplications: pendingApplicationsCount,
    jobAlerts: jobAlertsCount,
    reviewQueuePending: reviewQueuePendingCount,
  };

  // Virtual Terminal: admin/manager always; agents with virtual_terminal permission.
  const filteredTools = useMemo(() => {
    if (role === "admin" || role === "manager") return toolsItems;
    const perms: string[] = user?.permissions ?? [];
    return perms.includes("virtual_terminal") ? toolsItems : [];
  }, [role, user]);

  // WORK group includes filteredTools so VT lands in the right group for all eligible roles.
  const filteredWork = useMemo(
    () => [...filterByRole(workItems, role), ...filteredTools],
    [role, filteredTools]
  );

  const filteredMerchantOps = useMemo(() => filterByRole(merchantOpsItems, role), [role]);
  const filteredLeadEngine = useMemo(() => filterByRole(leadEngineItems, role), [role]);
  const filteredAutomation = useMemo(() => filterByRole(automationItems, role), [role]);
  const filteredIntelligence = useMemo(() => filterByRole(intelligenceItems, role), [role]);
  const filteredGrowth = useMemo(() => filterByRole(growthItems, role), [role]);
  const filteredSystem = useMemo(() => filterByRole(systemItems, role), [role]);

  const allItems = [
    ...workItems, ...toolsItems,
    ...merchantOpsItems, ...leadEngineItems, ...automationItems,
    ...intelligenceItems, ...growthItems, ...systemItems,
  ];

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const currentLabel =
    allItems.find((i) => i.href === location)?.label ||
    "Dashboard";

  const renderGroup = (label: string, items: MenuItem[]) => {
    if (items.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
              return (
                <SidebarMenuItem key={item.href + item.label}>
                  <SidebarMenuButton asChild isActive={isActive} data-testid={`link-sidebar-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Link href={item.href}>
                      <Icon className="w-4 h-4" />
                      <span className="flex-1">{item.label}</span>
                      {badgeCount > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground" data-testid={`badge-sidebar-${item.badgeKey}`}>
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <Sidebar>
          <SidebarHeader className="p-4 border-b">
            <Link href="/" data-testid="link-sidebar-logo">
              <img src={logoBlue} alt="Liberty Bancard" className="h-8 w-auto" />
            </Link>
          </SidebarHeader>

          <SidebarContent>
            {renderGroup("WORK", filteredWork)}
            {renderGroup("MERCHANT OPS", filteredMerchantOps)}
            {renderGroup("LEAD ENGINE", filteredLeadEngine)}
            {renderGroup("AUTOMATION", filteredAutomation)}
            {renderGroup("INTELLIGENCE", filteredIntelligence)}
            {renderGroup("GROWTH & PARTNERS", filteredGrowth)}
            {renderGroup("SYSTEM", filteredSystem)}
          </SidebarContent>

          <SidebarFooter className="p-4 border-t">
            <div className="flex items-center gap-3 px-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {user?.firstName?.[0] || "U"}
              </div>
              <div className="overflow-hidden flex-1">
                <div className="text-sm font-medium truncate" data-testid="text-user-name">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
                  {user?.email}
                </div>
              </div>
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => logout()} data-testid="button-logout">
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="h-14 bg-background border-b flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 sticky top-0 z-50">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="font-display font-semibold text-base sm:text-lg truncate" data-testid="text-page-title">
                {currentLabel}
              </h1>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <UniversalSearch />
              <Link href="/dashboard/notifications" className="relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground h-9 w-9" aria-label={`Notifications (${notificationsUnreadCount} unread)`} data-testid="button-topbar-notifications">
                <Bell className="w-4 h-4" />
                {notificationsUnreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground" data-testid="badge-topbar-notifications">
                    {notificationsUnreadCount > 99 ? "99+" : notificationsUnreadCount}
                  </span>
                )}
              </Link>
              <ThemeToggle />
              <Button size="icon" variant="ghost" onClick={() => setEmailOpen(true)} aria-label="Compose email" data-testid="button-compose-email">
                <Mail className="w-4 h-4" />
              </Button>
            </div>
          </header>
          <EmailComposer open={emailOpen} onClose={() => setEmailOpen(false)} />
          {user && !user.totpEnabled && (
            <TwoFaBanner role={role} />
          )}
          <GhlAlertBanner role={role} />
          <main className="flex-1 overflow-auto p-3 sm:p-6 max-w-7xl mx-auto w-full" data-testid="dashboard-main">
            <ErrorBoundary key={location}>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
