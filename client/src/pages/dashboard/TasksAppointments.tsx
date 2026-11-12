import { Link, useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, CalendarDays, Inbox } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import TasksPage from "./Tasks";
import CalendarPage from "./Calendar";
import { buildWorkWorkspaceHref, workWorkspaceState } from "@/lib/crm-destination-state";
import { CrmPage, CrmPageHeader } from "@/components/crm/CrmPresentation";

/**
 * Tasks & Appointments — unified tabbed view
 * Tab "tasks"    → existing Tasks page
 * Tab "calendar" → existing Calendar page
 *
 * URL: /dashboard/tasks-appointments?tab=tasks|calendar
 */
export default function TasksAppointments() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  // Intake (website requests) is the existing Lead Ops request list; managers reach it from Work without a new sidebar entry.
  const canOpenIntake = user?.role === "admin" || user?.role === "manager";
  const { tab, issues } = workWorkspaceState(search);

  const handleTabChange = (value: string) => {
    if (value !== "tasks" && value !== "calendar") return;
    navigate(buildWorkWorkspaceHref(window.location.href, value), { replace: false });
  };

  return (
    <CrmPage className="crm-work-area space-y-5">
      <CrmPageHeader title="Work" description="Tasks and appointments in your authorized scope." />
      {issues.length > 0 && <p className="crm-state-panel" role="status">{issues[0].reason} Showing Tasks.</p>}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="tasks" className="gap-2" data-testid="tab-tasks">
            <ClipboardList className="w-4 h-4" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2" data-testid="tab-calendar">
            <CalendarDays className="w-4 h-4" />
            Appointments
          </TabsTrigger>
        </TabsList>
        {canOpenIntake && (
          <Link href="/dashboard/lead-ops?tab=pipeline" className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted" data-testid="link-work-intake">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Intake: website requests
          </Link>
        )}
        </div>

        <TabsContent value="tasks" data-testid="tab-content-tasks">
          <TasksPage embedded />
        </TabsContent>

        <TabsContent value="calendar" data-testid="tab-content-calendar">
          <CalendarPage embedded />
        </TabsContent>
      </Tabs>
    </CrmPage>
  );
}
