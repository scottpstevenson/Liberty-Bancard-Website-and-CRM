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
  Package,
  ClipboardList,
  Bell,
  PhoneCall,
  FileCheck,
  Rocket,
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

interface DashboardLayoutProps {
  children: ReactNode;
}

type UserRole = "admin" | "manager" | "agent" | "merchant";

interface MenuItem {
  icon: any;
  label: string;
  href: string;
  roles?: UserRole[];
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard", roles: ["admin", "manager", "agent"] },
  { icon: Users, label: "Contacts", href: "/dashboard/contacts", roles: ["admin", "manager", "agent"] },
  { icon: TrendingUp, label: "Pipeline", href: "/dashboard/pipeline", roles: ["admin", "manager", "agent"] },
  { icon: Package, label: "Onboarding", href: "/dashboard/onboarding", roles: ["admin", "manager"] },
  { icon: Ticket, label: "Tickets", href: "/dashboard/tickets", roles: ["admin", "manager"] },
  { icon: ClipboardList, label: "Tasks", href: "/dashboard/tasks", roles: ["admin", "manager", "agent"] },
  { icon: Bell, label: "Notifications", href: "/dashboard/notifications", roles: ["admin", "manager", "agent"] },
  { icon: MessageSquare, label: "AI Advisor", href: "/dashboard/chat", roles: ["admin", "manager", "agent"] },
  { icon: FileQuestion, label: "RFIs", href: "/dashboard/rfis", roles: ["admin", "manager"] },
  { icon: PieChart, label: "Reporting", href: "/dashboard/reporting", roles: ["admin", "manager"] },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar", roles: ["admin", "manager", "agent"] },
];

const sdrItems: MenuItem[] = [
  { icon: RocketIcon, label: "Activation Panel", href: "/dashboard/activation", roles: ["admin"] },
  { icon: Bot, label: "AI SDR", href: "/dashboard/sdr", roles: ["admin", "manager"] },
  { icon: Activity, label: "Operator Dashboard", href: "/dashboard/operator", roles: ["admin", "manager"] },
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
  { icon: GitBranch, label: "GHL Workflows", href: "/dashboard/ghl-workflows", roles: ["admin"] },
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
];

const businessItems: MenuItem[] = [
  { icon: DollarSign, label: "Revenue Dashboard", href: "/dashboard/residual-revenue", roles: ["admin", "manager"] },
  { icon: TrendingUp, label: "Forecasting", href: "/dashboard/forecasting", roles: ["admin", "manager"] },
  { icon: UserPlus, label: "Agent Management", href: "/dashboard/agent-management", roles: ["admin", "manager"] },
  { icon: HeartPulse, label: "Merchant Health", href: "/dashboard/merchant-health", roles: ["admin", "manager"] },
  { icon: Trophy, label: "Win/Loss Analysis", href: "/dashboard/win-loss", roles: ["admin", "manager"] },
  { icon: Handshake, label: "Referral Program", href: "/dashboard/referral-program", roles: ["admin", "manager"] },
  { icon: Star, label: "Review Requests", href: "/dashboard/review-requests", roles: ["admin", "manager"] },
];

const merchantItems: MenuItem[] = [
  { icon: ShieldCheck, label: "My Portal", href: "/dashboard/merchant-portal" },
  { icon: HelpCircle, label: "Knowledge Base", href: "/dashboard/knowledge-base" },
];

const adminItems: MenuItem[] = [
  { icon: UserCog, label: "User Management", href: "/dashboard/user-management", roles: ["admin"] },
  { icon: Pencil, label: "Blog Generator", href: "/dashboard/blog-generator", roles: ["admin"] },
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

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const role = (user?.role as UserRole) || "merchant";

  const filteredMenu = useMemo(() => filterByRole(menuItems, role), [role]);
  const filteredSdr = useMemo(() => filterByRole(sdrItems, role), [role]);
  const filteredAutomation = useMemo(() => filterByRole(automationItems, role), [role]);
  const filteredLeadGen = useMemo(() => filterByRole(leadGenItems, role), [role]);
  const filteredBusiness = useMemo(() => filterByRole(businessItems, role), [role]);
  const filteredAdmin = useMemo(() => filterByRole(adminItems, role), [role]);
  const filteredForms = useMemo(() => filterByRole(formItems, role), [role]);

  const allItems = [...menuItems, ...sdrItems, ...automationItems, ...leadGenItems, ...businessItems, ...merchantItems, ...adminItems, ...formItems];

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
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive} data-testid={`link-sidebar-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
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
            {renderGroup("Navigation", filteredMenu)}
            {renderGroup("AI SDR", filteredSdr)}
            {renderGroup("Automation", filteredAutomation)}
            {renderGroup("Lead Generation", filteredLeadGen)}
            {renderGroup("Business Intelligence", filteredBusiness)}
            {renderGroup("Merchant", merchantItems)}
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
