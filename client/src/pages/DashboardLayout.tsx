import { ReactNode, useState } from "react";
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

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
  { icon: Users, label: "Contacts", href: "/dashboard/contacts" },
  { icon: TrendingUp, label: "Pipeline", href: "/dashboard/pipeline" },
  { icon: Package, label: "Onboarding", href: "/dashboard/onboarding" },
  { icon: Ticket, label: "Tickets", href: "/dashboard/tickets" },
  { icon: ClipboardList, label: "Tasks", href: "/dashboard/tasks" },
  { icon: Bell, label: "Notifications", href: "/dashboard/notifications" },
  { icon: MessageSquare, label: "AI Advisor", href: "/dashboard/chat" },
  { icon: FileQuestion, label: "RFIs", href: "/dashboard/rfis" },
  { icon: PieChart, label: "Reporting", href: "/dashboard/reporting" },
];

const automationItems = [
  { icon: BarChart3, label: "Automation", href: "/dashboard/automation" },
  { icon: Zap, label: "Workflows", href: "/dashboard/workflows" },
  { icon: ListOrdered, label: "Sequences", href: "/dashboard/sequences" },
  { icon: GitBranch, label: "Stage Rules", href: "/dashboard/stage-rules" },
  { icon: Repeat, label: "Outreach", href: "/dashboard/outreach" },
  { icon: Megaphone, label: "Campaigns", href: "/dashboard/campaigns" },
  { icon: Wand2, label: "Blaze.ai Marketing", href: "/dashboard/blaze" },
  { icon: Settings, label: "GHL Settings", href: "/dashboard/ghl-settings" },
];

const leadGenItems = [
  { icon: Brain, label: "Lead Command Center", href: "/dashboard/lead-command-center" },
  { icon: Target, label: "Prospects", href: "/dashboard/prospects" },
  { icon: FileSearch, label: "Sunbiz Lead Gen", href: "/dashboard/lead-gen" },
  { icon: Sparkles, label: "Lead Intelligence", href: "/dashboard/lead-intelligence" },
  { icon: FileBarChart, label: "Statement Review", href: "/dashboard/statement-review" },
  { icon: BarChart2, label: "Outreach Analytics", href: "/dashboard/outreach-analytics" },
];

const businessItems = [
  { icon: DollarSign, label: "Revenue Dashboard", href: "/dashboard/residual-revenue" },
  { icon: UserPlus, label: "Agent Management", href: "/dashboard/agent-management" },
  { icon: HeartPulse, label: "Merchant Health", href: "/dashboard/merchant-health" },
  { icon: Trophy, label: "Win/Loss Analysis", href: "/dashboard/win-loss" },
  { icon: Handshake, label: "Referral Program", href: "/dashboard/referral-program" },
  { icon: Star, label: "Review Requests", href: "/dashboard/review-requests" },
];

const merchantItems = [
  { icon: ShieldCheck, label: "My Portal", href: "/dashboard/merchant-portal" },
  { icon: HelpCircle, label: "Knowledge Base", href: "/dashboard/knowledge-base" },
];

const formItems = [
  { icon: PhoneCall, label: "Call Outcome", href: "/dashboard/call-outcome" },
  { icon: FileCheck, label: "Review Complete", href: "/dashboard/review-complete" },
  { icon: Rocket, label: "Onboarding Kickoff", href: "/dashboard/onboarding-kickoff" },
  { icon: BookOpen, label: "Case Study Intake", href: "/dashboard/case-study-intake" },
];

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const currentLabel =
    menuItems.find((i) => i.href === location)?.label ||
    automationItems.find((i) => i.href === location)?.label ||
    leadGenItems.find((i) => i.href === location)?.label ||
    businessItems.find((i) => i.href === location)?.label ||
    merchantItems.find((i) => i.href === location)?.label ||
    formItems.find((i) => i.href === location)?.label ||
    "Dashboard";

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
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item) => {
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

            <SidebarGroup>
              <SidebarGroupLabel>Automation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {automationItems.map((item) => {
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

            <SidebarGroup>
              <SidebarGroupLabel>Lead Generation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {leadGenItems.map((item) => {
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

            <SidebarGroup>
              <SidebarGroupLabel>Business Intelligence</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {businessItems.map((item) => {
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

            <SidebarGroup>
              <SidebarGroupLabel>Merchant</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {merchantItems.map((item) => {
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

            <SidebarGroup>
              <SidebarGroupLabel>Forms</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {formItems.map((item) => {
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
