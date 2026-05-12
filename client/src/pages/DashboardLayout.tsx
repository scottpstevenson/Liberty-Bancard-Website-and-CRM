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

const menuItems: MenuItem[] = [
  { icon: Star, label: "My Day", href: "/dashboard/my-day", roles: ["agent"] },
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard", roles: ["admin", "manager"] },
  { icon: Users, label: "My Contacts", href: "/dashboard/contacts", roles: ["agent"] },
  { icon: Users, label: "Contacts", href: "/dashboard/contacts", roles: ["admin", "manager"] },
  { icon: TrendingUp, label: "My Pipeline", href: "/dashboard/pipeline", roles: ["agent"] },
  { icon: TrendingUp, label: "Pipeline", href: "/dashboard/pipeline", roles: ["admin", "manager"] },
  { icon: Package, label: "Onboarding", href: "/dashboard/onboarding", roles: ["admin", "manager"] },
  { icon: Ticket, label: "Tickets", href: "/dashboard/tickets", roles: ["admin", "manager"] },
  { icon: ClipboardList, label: "My Tasks", href: "/dashboard/tasks", roles: ["agent"] },
  { icon: ClipboardList, label: "Tasks", href: "/dashboard/tasks", roles: ["admin", "manager"] },
  { icon: Bell, label: "Notifications", href: "/dashboard/notifications", roles: ["admin", "manager", "agent"], badgeKey: "notificationsUnread" },
  { icon: Inbox, label: "Messages", href: "/dashboard/sms-inbox", roles: ["admin", "manager", "agent"], badgeKey: "smsUnread" },
  { icon: MessageSquare, label: "AI Advisor", href: "/dashboard/chat", roles: ["admin", "manager", "agent"] },
  { icon: MessageCircle, label: "Live Chat", href: "/dashboard/live-chat", roles: ["admin", "manager", "agent"], badgeKey: "liveChatUnread" },
  { icon: FileQuestion, label: "RFIs", href: "/dashboard/rfis", roles: ["admin", "manager"] },
  { icon: ListChecks, label: "Review Queue", href: "/dashboard/review-queue", roles: ["admin", "manager"], badgeKey: "reviewQueuePending" },
  { icon: PieChart, label: "Reporting", href: "/dashboard/reporting", roles: ["admin", "manager"] },
  { icon: Calendar, label: "My Calendar", href: "/dashboard/calendar", roles: ["agent"] },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar", roles: ["admin", "manager"] },
];

const sdrItems: MenuItem[] = [
  { icon: RocketIcon, label: "Activation Panel", href: "/dashboard/activation", roles: ["admin"] },
  { icon: Bot, label: "AI SDR", href: "/dashboard/sdr", roles: ["admin", "manager"] },
  { icon: Activity, label: "Operator Dashboard", href: "/dashboard/operator", roles: ["admin", "manager"], badgeKey: "jobAlerts" },
  { icon: Mailbox, label: "Inbox Health", href: "/dashboard/inbox-health", roles: ["admin", "manager"] },
];

const automationItems: MenuItem[] = [
  { icon: BarChart3, label: "Automation", href: "/dashboard/automation", roles: ["admin", "manager"] },
  { icon: Zap, label: "Workflows", href: "/dashboard/workflows", roles: ["admin", "manager"] },
  { icon: ListOrdered, label: "Sequences", href: "/dashboard/sequences", roles: ["admin", "manager"] },
  { icon: GitBranch, label: "Stage Rules", href: "/dashboard/stage-rules", roles: ["admin", "manager"] },
  { icon: Repeat, label: "Outreach", href: "/dashboard/outreach", roles: ["admin", "manager"] },
  { icon: Megaphone, label: "Campaigns", href: "/dashboard/campaigns", roles: ["admin", "manager"] },
  { icon: Wand2, label: "Blaze.ai Marketing", href: "/dashboard/blaze", roles: ["admin", "manager"] },
  { icon: Settings, label: "GHL Settings", href: "/dashboard/ghl-settings", roles: ["admin"] },
  { icon: Workflow, label: "GHL Workflow IDs", href: "/dashboard/ghl-workflows", roles: ["admin"] },
  { icon: Settings, label: "Settings → Integrations", href: "/dashboard/settings/integrations", roles: ["admin"] },
];

const leadGenItems: MenuItem[] = [
  { icon: Rocket, label: "Outreach Command", href: "/dashboard/outreach-command", roles: ["admin", "manager"] },
  { icon: Brain, label: "Lead Command Center", href: "/dashboard/lead-command-center", roles: ["admin", "manager"] },
  { icon: Upload, label: "Lead Imports", href: "/dashboard/lead-imports", roles: ["admin", "manager"] },
  { icon: Target, label: "Prospects", href: "/dashboard/prospects", roles: ["admin", "manager"] },
  { icon: FileSearch, label: "Sunbiz Lead Gen", href: "/dashboard/lead-gen", roles: ["admin", "manager"] },
  { icon: Sparkles, label: "Lead Intelligence", href: "/dashboard/lead-intelligence", roles: ["admin", "manager"] },
  { icon: FileBarChart, label: "Statement Review", href: "/dashboard/statement-review", roles: ["admin", "manager"] },
  { icon: BarChart2, label: "Outreach Analytics", href: "/dashboard/outreach-analytics", roles: ["admin", "manager"] },
  { icon: CreditCard, label: "BIN Lookup", href: "/dashboard/bin-lookup", roles: ["admin", "manager", "agent"] },
];

const toolsItems: MenuItem[] = [
  { icon: CreditCard, label: "Virtual Terminal", href: "/dashboard/virtual-terminal", roles: ["admin", "manager", "agent"] },
];

const businessItems: MenuItem[] = [
  { icon: DollarSign, label: "Revenue Dashboard", href: "/dashboard/residual-revenue", roles: ["admin", "manager"] },
  { icon: TrendingUp, label: "Forecasting", href: "/dashboard/forecasting", roles: ["admin", "manager"] },
  { icon: UserPlus, label: "Agent Management", href: "/dashboard/agent-management", roles: ["admin", "manager"] },
  { icon: HeartPulse, label: "Merchant Health", href: "/dashboard/merchant-health", roles: ["admin", "manager"] },
  { icon: ShieldAlert, label: "Chargebacks", href: "/dashboard/chargebacks", roles: ["admin", "manager"] },
  { icon: Trophy, label: "Leaderboard", href: "/dashboard/leaderboard", roles: ["admin", "manager", "agent"] },
  { icon: Trophy, label: "Win/Loss Analysis", href: "/dashboard/win-loss", roles: ["admin", "manager"] },
  { icon: Handshake, label: "Referral Program", href: "/dashboard/referral-program", roles: ["admin", "manager"] },
  { icon: Link2, label: "Partner Orgs", href: "/dashboard/partner-orgs", roles: ["admin"] },
  { icon: Star, label: "Review Requests", href: "/dashboard/review-requests", roles: ["admin", "manager"] },
  { icon: MessageSquare, label: "Testimonial Submissions", href: "/dashboard/testimonial-submissions", roles: ["admin", "manager"] },
  { icon: ThumbsUp, label: "NPS / CSAT", href: "/dashboard/nps", roles: ["admin", "manager"] },
  { icon: RefreshCw, label: "Retention Campaigns", href: "/dashboard/retention-campaigns", roles: ["admin", "manager"] },
];

const merchantItems: MenuItem[] = [
  { icon: ShieldCheck, label: "My Portal", href: "/dashboard/merchant-portal" },
  { icon: ClipboardList, label: "Applications", href: "/dashboard/merchant-applications", roles: ["admin", "manager"], badgeKey: "pendingApplications" },
  { icon: Send, label: "Boarding Submissions", href: "/dashboard/boarding", roles: ["admin", "manager"] },
  { icon: HelpCircle, label: "Knowledge Base", href: "/dashboard/knowledge-base" },
  { icon: GraduationCap, label: "Training", href: "/dashboard/training", roles: ["admin", "manager", "agent"] },
];

const agentResourceItems: MenuItem[] = [
  { icon: BookOpen, label: "Collateral", href: "/assets", roles: ["agent"] },
  { icon: GraduationCap, label: "Training", href: "/dashboard/training", roles: ["agent"] },
  { icon: HelpCircle, label: "Support", href: "/dashboard/knowledge-base", roles: ["agent"] },
];

const adminItems: MenuItem[] = [
  { icon: FolderOpen, label: "Document Vault", href: "/dashboard/document-vault", roles: ["admin", "manager"] },
  { icon: UserCog, label: "User Management", href: "/dashboard/user-management", roles: ["admin"] },
  { icon: ShieldCheck, label: "Permissions Audit", href: "/dashboard/permissions", roles: ["admin"] },
  { icon: ArrowRightLeft, label: "Round-Robin", href: "/dashboard/round-robin", roles: ["admin", "manager"] },
  { icon: ShieldCheck, label: "Security Settings", href: "/dashboard/security", roles: ["admin", "manager", "agent", "merchant"] },
  { icon: Pencil, label: "Blog Generator", href: "/dashboard/blog-generator", roles: ["admin"] },
  { icon: FileText, label: "Content Engine", href: "/dashboard/content", roles: ["admin", "manager"] },
  { icon: Linkedin, label: "LinkedIn Composer", href: "/dashboard/social", roles: ["admin", "manager"] },
  { icon: GraduationCap, label: "Training Hub Setup", href: "/dashboard/training", roles: ["admin", "manager"] },
  { icon: SearchIcon, label: "SEO Health", href: "/dashboard/seo-health", roles: ["admin", "manager"] },
];

const formItems: MenuItem[] = [
  { icon: PhoneCall, label: "Call Outcome", href: "/dashboard/call-outcome", roles: ["admin", "manager", "agent"] },
  { icon: FileCheck, label: "Review Complete", href: "/dashboard/review-complete", roles: ["admin", "manager", "agent"] },
  { icon: Rocket, label: "Onboarding Kickoff", href: "/dashboard/onboarding-kickoff", roles: ["admin", "manager"] },
  { icon: BookOpen, label: "Case Study Intake", href: "/dashboard/case-study-intake", roles: ["admin", "manager"] },
];

function filterByRole(items: MenuItem[], role: UserRole): MenuItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

const TWO_FA_BANNER_KEY = "2fa_banner_dismissed";

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

  const filteredMenu = useMemo(() => filterByRole(menuItems, role), [role]);
  const filteredSdr = useMemo(() => filterByRole(sdrItems, role), [role]);
  const filteredAutomation = useMemo(() => filterByRole(automationItems, role), [role]);
  const filteredLeadGen = useMemo(() => filterByRole(leadGenItems, role), [role]);
  const filteredBusiness = useMemo(() => filterByRole(businessItems, role), [role]);
  const filteredMerchant = useMemo(() => filterByRole(merchantItems, role), [role]);
  const filteredAdmin = useMemo(() => filterByRole(adminItems, role), [role]);
  const filteredForms = useMemo(() => filterByRole(formItems, role), [role]);
  const filteredAgentResources = useMemo(() => filterByRole(agentResourceItems, role), [role]);
  const filteredTools = useMemo(() => {
    if (role === "admin" || role === "manager") return toolsItems;
    const perms: string[] = user?.permissions ?? [];
    return perms.includes("virtual_terminal") ? toolsItems : [];
  }, [role, user]);

  const allItems = [...menuItems, ...sdrItems, ...automationItems, ...leadGenItems, ...businessItems, ...merchantItems, ...agentResourceItems, ...adminItems, ...formItems, ...filteredTools];

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
                <SidebarMenuItem key={item.href}>
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
            {renderGroup("Navigation", filteredMenu)}
            {renderGroup("AI SDR", filteredSdr)}
            {renderGroup("Automation", filteredAutomation)}
            {renderGroup("Lead Generation", filteredLeadGen)}
            {renderGroup("Business Intelligence", filteredBusiness)}
            {renderGroup("Tools", filteredTools)}
            {renderGroup("Merchant", filteredMerchant)}
            {renderGroup("Resources", filteredAgentResources)}
            {renderGroup("Administration", filteredAdmin)}
            {renderGroup("Forms", filteredForms)}
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
