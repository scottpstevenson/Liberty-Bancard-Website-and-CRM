import { ReactNode, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import logoBlue from "@assets/logo-blue.png";
import UniversalSearch from "@/components/UniversalSearch";
import { EmailComposer } from "@/components/EmailComposer";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  LayoutDashboard,
  Users,
  Ticket,
  MessageSquare,
  LogOut,
  TrendingUp,
  LineChart,
  Package,
  ClipboardList,
  Bell,
  FileCheck,
  Zap,
  FileQuestion,
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
  GitMerge,
  Repeat,
  Brain,
  ListOrdered,
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
  Activity,
  PlayCircle,
  Megaphone,
  Wand2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

interface DashboardLayoutProps {
  children: ReactNode;
}

type UserRole = "admin" | "manager" | "agent" | "merchant";

interface MenuItem {
  icon: any;
  label: string;
  href: string;
  tooltip: string;
  roles?: UserRole[];
}

// Group 1: Core — daily-use items (6 items)
const coreItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard", tooltip: "Overview", roles: ["admin", "manager", "agent"] },
  { icon: Users, label: "Contacts", href: "/dashboard/contacts", tooltip: "Contacts", roles: ["admin", "manager", "agent"] },
  { icon: TrendingUp, label: "Pipeline", href: "/dashboard/pipeline", tooltip: "Pipeline", roles: ["admin", "manager", "agent"] },
  { icon: Ticket, label: "Tickets", href: "/dashboard/tickets", tooltip: "Tickets", roles: ["admin", "manager"] },
  { icon: ClipboardList, label: "Tasks", href: "/dashboard/tasks", tooltip: "Tasks", roles: ["admin", "manager", "agent"] },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar", tooltip: "Calendar", roles: ["admin", "manager", "agent"] },
];

// Group 2: Outreach & AI — operational items (5 items)
const outreachItems: MenuItem[] = [
  { icon: Bot, label: "AI SDR Dashboard", href: "/dashboard/sdr", tooltip: "AI SDR Dashboard", roles: ["admin", "manager"] },
  { icon: Megaphone, label: "Outreach Command", href: "/dashboard/outreach-command", tooltip: "Outreach Command", roles: ["admin", "manager"] },
  { icon: ListOrdered, label: "Sequences", href: "/dashboard/sequences", tooltip: "Sequences", roles: ["admin", "manager"] },
  { icon: Mailbox, label: "Inbox Health", href: "/dashboard/inbox-health", tooltip: "Inbox Health", roles: ["admin", "manager"] },
  { icon: Sparkles, label: "Lead Intelligence", href: "/dashboard/lead-intelligence", tooltip: "Lead Intelligence", roles: ["admin", "manager"] },
];

// Group 3: Lead Generation — growth tools (5 items)
const leadGenItems: MenuItem[] = [
  { icon: Target, label: "Prospects", href: "/dashboard/prospects", tooltip: "Prospects / Sunbiz", roles: ["admin", "manager"] },
  { icon: Upload, label: "Lead Imports", href: "/dashboard/lead-imports", tooltip: "Lead Imports", roles: ["admin", "manager"] },
  { icon: FileBarChart, label: "Statement Review", href: "/dashboard/statement-review", tooltip: "Statement Review", roles: ["admin", "manager"] },
  { icon: BarChart2, label: "Outreach Analytics", href: "/dashboard/outreach-analytics", tooltip: "Outreach Analytics", roles: ["admin", "manager"] },
  { icon: Send, label: "Campaign Manager", href: "/dashboard/campaigns", tooltip: "Campaign Manager", roles: ["admin", "manager"] },
];

// Group 4: Business Intelligence — management items (5 items)
const businessItems: MenuItem[] = [
  { icon: DollarSign, label: "Revenue & Residuals", href: "/dashboard/residual-revenue", tooltip: "Revenue & Residuals", roles: ["admin", "manager"] },
  { icon: LineChart, label: "Forecasting", href: "/dashboard/forecasting", tooltip: "Forecasting", roles: ["admin", "manager"] },
  { icon: Trophy, label: "Win/Loss Analysis", href: "/dashboard/win-loss", tooltip: "Win/Loss Analysis", roles: ["admin", "manager"] },
  { icon: HeartPulse, label: "Merchant Health", href: "/dashboard/merchant-health", tooltip: "Merchant Health", roles: ["admin", "manager"] },
  { icon: Handshake, label: "Referral Program", href: "/dashboard/referral-program", tooltip: "Referral Program", roles: ["admin", "manager"] },
];

// Group 5: Settings & Admin — collapsible, secondary items
const settingsItems: MenuItem[] = [
  { icon: Settings, label: "GHL Settings", href: "/dashboard/ghl-settings", tooltip: "GHL Settings", roles: ["admin"] },
  { icon: GitMerge, label: "Automation Rules", href: "/dashboard/workflows", tooltip: "Automation Rules", roles: ["admin", "manager"] },
  { icon: GitBranch, label: "Pipeline Stages", href: "/dashboard/stage-rules", tooltip: "Pipeline Stages", roles: ["admin", "manager"] },
  { icon: UserCog, label: "User Management", href: "/dashboard/user-management", tooltip: "User Management", roles: ["admin"] },
  { icon: Zap, label: "Activation Panel", href: "/dashboard/activation", tooltip: "Activation Panel", roles: ["admin"] },
  { icon: Pencil, label: "Blog Generator", href: "/dashboard/blog-generator", tooltip: "Blog Generator", roles: ["admin"] },
];

// Merchant-only items
const merchantItems: MenuItem[] = [
  { icon: ShieldCheck, label: "My Portal", href: "/dashboard/merchant-portal", tooltip: "My Portal" },
  { icon: HelpCircle, label: "Knowledge Base", href: "/dashboard/knowledge-base", tooltip: "Knowledge Base" },
];

// All items (for page title lookup) — includes items moved out of sidebar but still routable
const allItems: MenuItem[] = [
  ...coreItems,
  ...outreachItems,
  ...leadGenItems,
  ...businessItems,
  ...settingsItems,
  ...merchantItems,
  // Additional routable items not in sidebar (Forms group moved to contextual)
  { icon: Activity, label: "Operator Dashboard", href: "/dashboard/operator", tooltip: "Operator Dashboard" },
  { icon: Bell, label: "Notifications", href: "/dashboard/notifications", tooltip: "Notifications" },
  { icon: Package, label: "Onboarding", href: "/dashboard/onboarding", tooltip: "Onboarding" },
  { icon: FileQuestion, label: "RFIs", href: "/dashboard/rfis", tooltip: "RFIs" },
  { icon: PieChart, label: "Reporting", href: "/dashboard/reporting", tooltip: "Reporting" },
  { icon: Brain, label: "Lead Command Center", href: "/dashboard/lead-command-center", tooltip: "Lead Command Center" },
  { icon: FileSearch, label: "Sunbiz Lead Gen", href: "/dashboard/lead-gen", tooltip: "Sunbiz Lead Gen" },
  { icon: BarChart3, label: "Automation", href: "/dashboard/automation", tooltip: "Automation" },
  { icon: Repeat, label: "Outreach", href: "/dashboard/outreach", tooltip: "Outreach" },
  { icon: Wand2, label: "Blaze.ai Marketing", href: "/dashboard/blaze", tooltip: "Blaze.ai Marketing" },
  { icon: UserPlus, label: "Agent Management", href: "/dashboard/agent-management", tooltip: "Agent Management" },
  { icon: Star, label: "Review Requests", href: "/dashboard/review-requests", tooltip: "Review Requests" },
  // Forms group items (contextual, accessible via Pipeline/Contacts)
  { icon: PlayCircle, label: "Onboarding Kickoff", href: "/dashboard/onboarding-kickoff", tooltip: "Onboarding Kickoff" },
  { icon: FileCheck, label: "Review Complete", href: "/dashboard/review-complete", tooltip: "Review Complete" },
  { icon: BookOpen, label: "Case Study Intake", href: "/dashboard/case-study-intake", tooltip: "Case Study Intake" },
];

function filterByRole(items: MenuItem[], role: UserRole): MenuItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const role = (user?.role as UserRole) || "merchant";

  const filteredCore = useMemo(() => filterByRole(coreItems, role), [role]);
  const filteredOutreach = useMemo(() => filterByRole(outreachItems, role), [role]);
  const filteredLeadGen = useMemo(() => filterByRole(leadGenItems, role), [role]);
  const filteredBusiness = useMemo(() => filterByRole(businessItems, role), [role]);
  const filteredSettings = useMemo(() => filterByRole(settingsItems, role), [role]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const currentLabel =
    allItems.find((i) => i.href === location)?.label ||
    "Dashboard";

  const renderGroup = (label: string, items: MenuItem[], secondary = false) => {
    if (items.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.tooltip}
                    data-testid={`link-sidebar-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={secondary ? "opacity-75 text-sm" : undefined}
                  >
                    <Link href={item.href}>
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
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
            {renderGroup("Core", filteredCore)}
            {renderGroup("Outreach & AI", filteredOutreach)}
            {renderGroup("Lead Generation", filteredLeadGen)}
            {renderGroup("Business Intelligence", filteredBusiness)}
            {role === "merchant" && renderGroup("Merchant", merchantItems)}
            {filteredSettings.length > 0 && (
              <>
                <div className="mx-4 my-1 border-t border-border/50" />
                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <SidebarGroup>
                    <CollapsibleTrigger asChild>
                      <SidebarGroupLabel
                        className="flex items-center justify-between cursor-pointer select-none hover:text-foreground"
                        data-testid="button-settings-admin-toggle"
                      >
                        Settings & Admin
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`}
                        />
                      </SidebarGroupLabel>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {filteredSettings.map((item) => {
                            const Icon = item.icon;
                            const isActive = location === item.href;
                            return (
                              <SidebarMenuItem key={item.href}>
                                <SidebarMenuButton
                                  asChild
                                  isActive={isActive}
                                  tooltip={item.tooltip}
                                  data-testid={`link-sidebar-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                                  className="opacity-75 text-sm"
                                >
                                  <Link href={item.href}>
                                    <Icon className="w-4 h-4" />
                                    <span>{item.label}</span>
                                  </Link>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              </>
            )}
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
                <SidebarMenuButton onClick={() => logout()} tooltip="Sign Out" data-testid="button-logout">
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
              <ThemeToggle />
              <Button size="icon" variant="ghost" onClick={() => setEmailOpen(true)} data-testid="button-compose-email">
                <Mail className="w-4 h-4" />
              </Button>
            </div>
          </header>
          <EmailComposer open={emailOpen} onClose={() => setEmailOpen(false)} />
          <main className="flex-1 overflow-auto p-3 sm:p-6 max-w-7xl mx-auto w-full">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
