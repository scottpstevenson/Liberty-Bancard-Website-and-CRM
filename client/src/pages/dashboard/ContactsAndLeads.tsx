import { useLocation, useSearch, Redirect } from "wouter";
import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Target } from "lucide-react";
import ContactsPage from "./Contacts";
import LeadsPage from "./Leads";
import { destinationUrl, safeParams, safeContextKeys, peopleHubState } from "@/lib/crm-destination-state";

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

  const state = peopleHubState(search);

  // The old "prospect-staging" deep link now lives under Lead Ops → Source
  // Prospects; redirect explicitly instead of silently falling back to People (#1957).
  const tab = state.value;
  useEffect(() => {
    const params=new URLSearchParams(search);
    if(!state.issues.length && params.getAll("tab").length>1){
      params.set("tab",tab);
      navigate(destinationUrl("/dashboard/contacts-leads",params,window.location.hash),{replace:true});
    }
  },[search,tab,navigate,state.issues.length]);

  // Keep URL in sync when tab changes
  const handleTabChange = (value: string) => {
    if(value!=="people" && value!=="leads")return;
    const next = new URLSearchParams(search);
    next.set("tab", value);
    navigate(destinationUrl("/dashboard/contacts-leads", next, window.location.hash));
  };

  // All hooks run on both entrances; same-component history transitions cannot
  // change the hook count or mount People before resolving the staging alias.
  if (tab === "prospect-staging") {
    const next = safeParams(search, [...safeContextKeys, "search", "source", "page"]);
    next.set("tab", "prospects");
    return <Redirect to={destinationUrl("/dashboard/lead-ops", next, window.location.hash)} />;
  }

  return (
    <div className="space-y-4">
      {state.issues[0] && <p role="status">{state.issues[0].reason}</p>}
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
