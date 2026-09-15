import { useState, useEffect } from "react";
import { useLocation, useSearch, Redirect } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Target } from "lucide-react";
import ContactsPage from "./Contacts";
import LeadsPage from "./Leads";

/**
 * Contacts & Leads — unified tabbed view
 * Tab "people"  → existing Contacts page
 * Tab "leads"   → revenue leads
 *
 * URL: /dashboard/contacts-leads?tab=people|leads
 * /dashboard/contacts redirects here with the correct tab pre-selected.
 * Prospect staging/import now lives under Lead Ops → Source Prospects
 * (/dashboard/lead-ops?tab=prospects); any deep link to the old
 * "prospect-staging" tab here is redirected there (see App.tsx).
 */
export default function ContactsAndLeads() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");

  // The old "prospect-staging" deep link now lives under Lead Ops → Source
  // Prospects; redirect explicitly instead of silently falling back to People (#1957).
  if (requestedTab === "prospect-staging") {
    return <Redirect to="/dashboard/lead-ops?tab=prospects" />;
  }

  const tabFromSearch = requestedTab === "leads" ? requestedTab : "people";
  const [tab, setTab] = useState(tabFromSearch);

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
    setTab(requested === "leads" ? requested : "people");
  }, [search]);

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
        </TabsList>

        <TabsContent value="people" data-testid="tab-content-people">
          <ContactsPage />
        </TabsContent>

        <TabsContent value="leads" data-testid="tab-content-leads">
          <LeadsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
