import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, CalendarDays } from "lucide-react";
import TasksPage from "./Tasks";
import CalendarPage from "./Calendar";

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

  const params = new URLSearchParams(search);
  const initialTab = params.get("tab") === "calendar" ? "calendar" : "tasks";
  const [tab, setTab] = useState(initialTab);

  const handleTabChange = (value: string) => {
    setTab(value);
    navigate(`/dashboard/tasks-appointments?tab=${value}`, { replace: true });
  };

  useEffect(() => {
    const t = params.get("tab") === "calendar" ? "calendar" : "tasks";
    setTab(t);
  }, [search]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={handleTabChange}>
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

        <TabsContent value="tasks" data-testid="tab-content-tasks">
          <TasksPage />
        </TabsContent>

        <TabsContent value="calendar" data-testid="tab-content-calendar">
          <CalendarPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
