import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Target } from "lucide-react";
import ContactsPage from "./Contacts";
import ProspectsPage from "./Prospects";

/**
 * Contacts & Leads — unified tabbed view
 * Tab "people"  → existing Contacts page
 * Tab "leads"   → existing Prospects page
 *
 * URL: /dashboard/contacts-leads?tab=people|leads
 * Both /dashboard/contacts and /dashboard/prospects redirect here with the
 * correct tab pre-selected.
 */
export default function ContactsAndLeads() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const params = new URLSearchParams(search);
  const initialTab = params.get("tab") === "leads" ? "leads" : "people";
  const [tab, setTab] = useState(initialTab);

  // Keep URL in sync when tab changes
  const handleTabChange = (value: string) => {
    setTab(value);
    navigate(`/dashboard/contacts-leads?tab=${value}`, { replace: true });
  };

  // Sync if URL changes externally (e.g. back-button)
  useEffect(() => {
    const t = params.get("tab") === "leads" ? "leads" : "people";
    setTab(t);
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
          <ProspectsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
