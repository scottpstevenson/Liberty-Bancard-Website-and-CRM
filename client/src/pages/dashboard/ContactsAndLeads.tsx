import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Target, Database } from "lucide-react";
import ContactsPage from "./Contacts";
import ProspectsPage from "./Prospects";
import LeadsPage from "./Leads";
import { useAuth } from "@/hooks/use-auth";

/**
 * Contacts & Leads — unified tabbed view
 * Tab "people"  → existing Contacts page
 * Tab "leads"   → revenue leads
 * Tab "prospect-staging" → imported prospects (manager/admin only)
 *
 * URL: /dashboard/contacts-leads?tab=people|leads|prospect-staging
 * Both /dashboard/contacts and /dashboard/prospects redirect here with the
 * correct tab pre-selected.
 */
export default function ContactsAndLeads() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canManageStaging = user?.role === "admin" || user?.role === "manager";

  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const tabFromSearch = requestedTab === "leads" || (requestedTab === "prospect-staging" && canManageStaging)
    ? requestedTab
    : "people";
  const initialTab = tabFromSearch;
  const [tab, setTab] = useState(initialTab);

  // Keep URL in sync when tab changes
  const handleTabChange = (value: string) => {
    setTab(value);
    const next = new URLSearchParams(search);
    next.set("tab", value);
    navigate(`/dashboard/contacts-leads?${next.toString()}`, { replace: true });
  };

  // Sync if URL changes externally (e.g. back-button)
  useEffect(() => {
    const requested = params.get("tab");
    const t = requested === "leads" || (requested === "prospect-staging" && canManageStaging)
      ? requested
      : "people";
    setTab(t);
  }, [search, canManageStaging]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="people" className="gap-2" data-testid="tab-contacts-people">
            <Users className="w-4 h-4" />
            People
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-2" data-testid="tab-contacts-leads">
            <Target className="w-4 h-4" />
            Leads
          </TabsTrigger>
          {canManageStaging && (
            <TabsTrigger value="prospect-staging" className="gap-2" data-testid="tab-contacts-prospect-staging">
              <Database className="w-4 h-4" />
              Prospect Staging
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="people" data-testid="tab-content-people">
          <ContactsPage />
        </TabsContent>

        <TabsContent value="leads" data-testid="tab-content-leads">
          <LeadsPage />
        </TabsContent>
        {canManageStaging && (
          <TabsContent value="prospect-staging" data-testid="tab-content-prospect-staging">
            <ProspectsPage />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
