import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Users, 
  Ticket, 
  MessageSquare, 
  LogOut, 
  Settings,
  CreditCard
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  const menuItems = [
    { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
    { icon: Users, label: "Contacts", href: "/dashboard/contacts" },
    { icon: Ticket, label: "Tickets", href: "/dashboard/tickets" },
    { icon: MessageSquare, label: "AI Advisor", href: "/dashboard/chat" },
  ];

  return (
    <div className="min-h-screen bg-muted/20 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-primary text-primary-foreground flex-shrink-0 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <Link href="/" className="font-display font-bold text-xl tracking-tight">Liberty Bancard</Link>
        </div>

        <div className="flex-1 py-6 px-3 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-sm font-medium",
                  isActive 
                    ? "bg-accent text-white shadow-lg shadow-accent/20" 
                    : "text-primary-foreground/70 hover:bg-white/10 hover:text-white"
                )}>
                  <Icon className="w-5 h-5" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">
              {user?.firstName?.[0] || "U"}
            </div>
            <div className="overflow-hidden">
              <div className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</div>
              <div className="text-xs text-primary-foreground/50 truncate">{user?.email}</div>
            </div>
          </div>
          <button 
            onClick={() => logout()}
            className="flex items-center gap-3 px-2 py-2 w-full text-left text-sm text-primary-foreground/70 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="h-16 bg-white border-b border-border flex items-center justify-between px-8 sticky top-0 z-10">
          <h1 className="font-display font-semibold text-lg text-primary">
            {menuItems.find(i => i.href === location)?.label || "Dashboard"}
          </h1>
          <div className="md:hidden">
            {/* Mobile menu trigger would go here */}
          </div>
        </header>
        <div className="p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
