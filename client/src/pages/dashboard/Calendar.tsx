import { PageTitle } from "@/components/ui/page-header";
import { useState, useMemo, useEffect } from "react";
import { useUrlParam, parseMonthParam } from "@/hooks/use-url-param";
import { useAuth } from "@/hooks/use-auth";
import { BookingCommandPanel } from "@/components/BookingCommandPanel";
import { BookingCreatePanel } from "@/components/BookingCreatePanel";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { apiRequest } from "@/lib/queryClient";
import { localCalendarDateAtTime, moveCalendarEventToDate } from "@/lib/calendar-date-repair";
import { isCalendarStartInWindow } from "@/lib/calendar-window";
import { useToast } from "@/hooks/use-toast";
import type { CalendarEvent, Deal } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AuthorizedContactPicker, type ContactChoice } from "@/components/crm/AuthorizedContactPicker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon,
  Phone, Video, Clock, Users,
} from "lucide-react";

const EVENT_TYPES = ["meeting", "call", "follow-up", "demo"] as const;
type EventType = typeof EVENT_TYPES[number];

const TYPE_COLORS: Record<string, string> = {
  meeting: "bg-blue-500",
  call: "bg-green-500",
  "follow-up": "bg-amber-500",
  demo: "bg-purple-500",
};

const TYPE_BADGE_VARIANTS: Record<string, string> = {
  meeting: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  call: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "follow-up": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  demo: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const TYPE_ICONS: Record<string, typeof CalendarIcon> = {
  meeting: Users,
  call: Phone,
  "follow-up": Clock,
  demo: Video,
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const INVALID_DATE_KEY = "invalid";

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "--:--";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateKey(date: Date): string {
  if (isNaN(date.getTime())) return INVALID_DATE_KEY;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarItem {
  id: string;
  title: string;
  type: string;
  startTime: string;
  endTime: string;
  description?: string | null;
  contactId?: number | null;
  dealId?: number | null;
  source: "event" | "deal" | "appointment";
  sourceLabel: string;
  purpose?: "sales" | "account";
  externalUrl?: string | null;
  readOnly?: boolean;
  noShow?: boolean;
  rawId: number | string;
}

interface AppointmentRead {
  appointments: Array<{
    id: string;
    title: string;
    contactName?: string;
    contactId: number | null;
    startTime: string | number | null;
    endTime: string | number | null;
    status: string;
    noShow: boolean;
    locationName: string | null;
    ghlLink?: string | null;
    source?: string;
    purpose?: "sales" | "account";
  }>;
  configured: boolean;
  status?: string;
  source?: string;
  purpose?: "sales" | "account";
  completeness?: string;
  exact?: boolean;
  queueLimit?: number;
  scope?: string;
  asOf?: string;
  sourceStatus?: Array<{ source: string; status: string; fetched?: number; truncated?: boolean }>;
}

type SourceFilter = "all" | "sales" | "account" | "local";
const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string; hint: string }> = [
  { value: "all", label: "Sales + local", hint: "Sales-calendar appointments, local events and deal follow-ups. The account calendar is a separate source; choose it to see those appointments." },
  { value: "sales", label: "Sales calendar", hint: "GoHighLevel sales calendar appointments only" },
  { value: "account", label: "Account calendar", hint: "GoHighLevel account-management calendar appointments only" },
  { value: "local", label: "Local", hint: "Events and deal follow-ups saved in this CRM only" },
];

interface AppointmentDetail {
  appointmentId: string;
  recorded: boolean;
  /** The server answered 404: this actor may not read the appointment (or it is unknown). Never "no command recorded". */
  denied?: boolean;
  occurrence: null | {
    status: string; startTime: string | null; endTime: string | null; purpose: "sales" | "account";
    rescheduleCount: number; current: boolean; currentAppointmentId: string | null;
  };
  lastObservation: null | { eventAt: string; recordedAt: string };
  commands: Array<{ operation: string; state: "pending" | "accepted" | "unknown" | "refused"; startedAt: string; settledAt: string | null }>;
}

const COMMAND_STATE_COPY: Record<AppointmentDetail["commands"][number]["state"], string> = {
  pending: "Pending — sent, provider confirmation not yet recorded",
  accepted: "Accepted by the provider",
  unknown: "Unknown — the outcome could not be determined and is not retried automatically",
  refused: "Refused — the provider did not apply it",
};

const MAX_NAME_LOOKUPS = 20;

export default function CalendarPage({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = new Date();
  // Month, selected date, source and the opened item live in validated URL parameters so reload and Back/Forward restore them.
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const todayKeyForUrl = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const [monthKey, setMonthKey] = useUrlParam<string>("cal_month", todayKeyForUrl.slice(0, 7), raw => (parseMonthParam(raw) ? raw : undefined));
  const { year: currentYear, month: currentMonth } = parseMonthParam(monthKey) ?? { year: today.getFullYear(), month: today.getMonth() };
  const setMonthParts = (year: number, month: number) => setMonthKey(`${year}-${pad2(month + 1)}`);
  const [selectedDate, setSelectedDate] = useUrlParam<string>("cal_date", todayKeyForUrl,
    raw => (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw) ? raw : undefined), { history: "replace" });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showProviderCreate, setShowProviderCreate] = useState(false);
  const { user: calendarUser } = useAuth();
  const calendarRole = (calendarUser as { role?: string } | null | undefined)?.role;
  const canUseProviderCreate = calendarRole === "admin" || calendarRole === "manager";
  // At phone width the seven-column month grid is replaced by an agenda list of the days that have items.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 480px)");
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  const [sourceFilter, setSourceFilter] = useUrlParam<SourceFilter>("cal_source", "all",
    raw => (["all", "sales", "account", "local"].includes(raw) ? (raw as SourceFilter) : undefined));
  const [drawerParam, setDrawerItemId] = useUrlParam<string>("cal_item", "", raw => (/^[\w:.-]{1,120}$/.test(raw) ? raw : undefined));
  const drawerItemId: string | null = drawerParam || null;
  const [pickedContact, setPickedContact] = useState<ContactChoice | null>(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    type: "meeting" as EventType,
    notes: "",
  });

  const startOfMonth = new Date(currentYear, currentMonth, 1);
  // The reader's upper bound is exclusive. Preserve browser-local month
  // boundaries as instants rather than slicing UTC dates (which shifts zones).
  const endOfMonth = new Date(currentYear, currentMonth + 1, 1);
  const startParam = startOfMonth.toISOString();
  const endParam = endOfMonth.toISOString();

  const { data: calendarEvents, isLoading: eventsLoading, isError: eventsError, refetch: retryEvents } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar-events", startParam, endParam],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ start: startParam, end: endParam });
      const res = await fetch(`/api/calendar-events?${params}`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Calendar events are unavailable.");
      return res.json();
    },
  });

  // The reader serves one calendar purpose at a time. "Account" reads the account-management calendar; every other
  // filter reads the sales calendar; "Local" makes no provider read at all.
  const appointmentPurpose: "sales" | "account" = sourceFilter === "account" ? "account" : "sales";
  const { data: appointmentRead, isLoading: appointmentsLoading, isError: appointmentsError, refetch: retryAppointments } = useQuery<AppointmentRead>({
    // Month-range reader: the selected window (exclusive end) and the chosen calendar, not the bounded "next 10" queue.
    queryKey: ["/api/appointments/range", startParam, endParam, appointmentPurpose],
    enabled: sourceFilter !== "local",
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ start: startParam, end: endParam, purpose: appointmentPurpose });
      const response = await fetch(`/api/appointments/range?${params}`, { credentials: "include", signal });
      // 409 is the reader's explicit "this purpose calendar is not configured" answer, not a failure and not "empty".
      if (response.status === 409) return { appointments: [], configured: false, status: "not_configured", purpose: appointmentPurpose, completeness: "unavailable" };
      if (!response.ok) throw new Error("Appointments are unavailable.");
      return response.json();
    },
    refetchInterval: 300000,
  });
  const { data: dealsRes, isLoading: dealsLoading, isError: dealsError, refetch: retryDeals } = useQuery<{ data: Deal[]; total: number }>({
    // Scoped range reader: only deals whose follow-up falls in the displayed month (exclusive end), in the user's scope.
    queryKey: ["/api/deals", { calendar: true, from: startParam, to: endParam }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: "2000", offset: "0", followUpFrom: startParam, followUpTo: endParam });
      const res = await fetch(`/api/deals?${params}`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Deal follow-ups are unavailable.");
      return res.json();
    },
  });
  const allDeals = dealsRes?.data;

  const createEventMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/calendar-events", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      setShowAddDialog(false);
      setEventForm({ title: "", description: "", date: "", startTime: "09:00", endTime: "10:00", type: "meeting", notes: "" });
      setPickedContact(null);
      toast({ title: "Local event created", description: "Not a GoHighLevel appointment." });
    },
    onError: () => {
      toast({ title: "Failed to create event", variant: "destructive" });
    },
  });

  const [fixingItemId, setFixingItemId] = useState<string | null>(null);
  const [fixDate, setFixDate] = useState<string>("");
  const [fixStartTime, setFixStartTime] = useState("09:00");
  const [fixDurationMinutes, setFixDurationMinutes] = useState("60");

  const fixEventDateMutation = useMutation({
    mutationFn: async ({ item, newDate, replacement }: {
      item: CalendarItem; newDate: string; replacement?: { startTime: string; durationMinutes: number };
    }) => {
      if (item.readOnly || item.source === "appointment") throw new Error("Provider appointments are read-only.");
      if (item.source === "event") {
        return apiRequest("PUT", `/api/calendar-events/${item.rawId}`, moveCalendarEventToDate(item, newDate, replacement));
      }
      const iso = localCalendarDateAtTime(newDate, "09:00").toISOString();
      return apiRequest("PUT", `/api/deals/${item.rawId}`, { nextFollowUp: iso });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setFixingItemId(null);
      setFixDate("");
      toast({ title: variables.item.source === "event" ? "Event date fixed" : "Follow-up date fixed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to fix date", description: error.message, variant: "destructive" });
    },
  });

  const removeInvalidDateMutation = useMutation({
    mutationFn: async (item: CalendarItem) => {
      if (item.readOnly || item.source === "appointment") throw new Error("Provider appointments are read-only.");
      if (item.source === "event") {
        return apiRequest("DELETE", `/api/calendar-events/${item.rawId}`);
      }
      return apiRequest("PUT", `/api/deals/${item.rawId}`, { nextFollowUp: null });
    },
    onSuccess: (_data, item) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: item.source === "event" ? "Event removed" : "Follow-up cleared" });
    },
    onError: () => {
      toast({ title: "Failed to remove event", variant: "destructive" });
    },
  });

  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = [];

    calendarEvents?.forEach(evt => {
      items.push({
        id: `event_${evt.id}`,
        title: evt.title,
        type: evt.type || "meeting",
        startTime: evt.startTime as unknown as string,
        endTime: evt.endTime as unknown as string,
        description: evt.description,
        contactId: evt.contactId,
        dealId: evt.dealId,
        source: "event",
        sourceLabel: "Local event",
        rawId: evt.id,
      });
    });

    (appointmentRead?.appointments ?? []).forEach(appt => {
      const dateValue = appt.startTime;
      const startDate = new Date(typeof dateValue === "number" ? dateValue : dateValue ?? "");
      if (Number.isFinite(startDate.getTime()) && !isCalendarStartInWindow(startDate, startOfMonth, endOfMonth)) return;
      items.push({
        id: `appointment_${appt.id}`,
        title: appt.title || appt.contactName || "Appointment",
        type: "meeting",
        startTime: typeof appt.startTime === "number" ? new Date(appt.startTime).toISOString() : appt.startTime ?? "",
        endTime: typeof appt.endTime === "number" ? new Date(appt.endTime).toISOString() : appt.endTime ?? "",
        contactId: appt.contactId,
        description: [
          appt.status ? `Appointment status: ${appt.status}` : "",
          appt.locationName || "",
        ].filter(Boolean).join(" · ") || undefined,
        source: "appointment",
        purpose: appt.purpose ?? appointmentRead?.purpose ?? appointmentPurpose,
        sourceLabel: `GHL · ${appt.purpose ?? appointmentRead?.purpose ?? appointmentPurpose} calendar`,
        externalUrl: appt.ghlLink,
        readOnly: true,
        noShow: appt.noShow,
        rawId: appt.id,
      });
    });

    allDeals?.forEach(deal => {
      if (deal.nextFollowUp) {
        const followUpDate = new Date(deal.nextFollowUp);
        const isInRange = isCalendarStartInWindow(followUpDate, startOfMonth, endOfMonth);
        // Invalid dates can't be range-checked — surface them regardless of month so they aren't silently dropped.
        if (isInRange || isNaN(followUpDate.getTime())) {
          items.push({
            id: `deal_followup_${deal.id}`,
            title: `Follow-up: Deal #${deal.id}`,
            type: "follow-up",
            startTime: deal.nextFollowUp as unknown as string,
            endTime: deal.nextFollowUp as unknown as string,
            contactId: deal.contactId,
            dealId: deal.id,
            source: "deal",
            sourceLabel: "Local follow-up",
            rawId: deal.id,
          });
        }
      }
    });

    return items;
  }, [calendarEvents, appointmentRead, allDeals, startOfMonth, endOfMonth, appointmentPurpose]);

  // "sales" and "account" show only that provider calendar; "local" shows only items saved in this CRM.
  const visibleItems = useMemo(() => calendarItems.filter(item =>
    sourceFilter === "all" ? true
    : sourceFilter === "local" ? item.source !== "appointment"
    : item.source === "appointment"), [calendarItems, sourceFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    visibleItems.forEach(item => {
      const key = formatDateKey(new Date(item.startTime));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return map;
  }, [visibleItems]);

  const invalidDateEvents = eventsByDate.get(INVALID_DATE_KEY) || [];

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const prevMonth = () => {
    if (currentMonth === 0) setMonthParts(currentYear - 1, 11);
    else setMonthParts(currentYear, currentMonth - 1);
  };

  const nextMonth = () => {
    if (currentMonth === 11) setMonthParts(currentYear + 1, 0);
    else setMonthParts(currentYear, currentMonth + 1);
  };

  const handleSubmitEvent = () => {
    if (!eventForm.title || !eventForm.date) return;
    const startDateTime = new Date(`${eventForm.date}T${eventForm.startTime}:00`);
    const endDateTime = new Date(`${eventForm.date}T${eventForm.endTime}:00`);

    createEventMutation.mutate({
      title: eventForm.title,
      description: eventForm.notes || undefined,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      type: eventForm.type,
      contactId: pickedContact?.id,
    });
  };

  const selectedDayEvents = eventsByDate.get(selectedDate) || [];
  const drawerItem = drawerItemId ? calendarItems.find(item => item.id === drawerItemId) ?? null : null;

  // Contact names are read only for what is on screen (the selected day and the open drawer) through the authorized
  // single-contact reader. There is no first-N contact list; a contact the actor may not read keeps its id.
  const nameIds = useMemo(() => {
    const ids = new Set<number>();
    selectedDayEvents.forEach(item => { if (item.contactId) ids.add(item.contactId); });
    if (drawerItem?.contactId) ids.add(drawerItem.contactId);
    return [...ids].sort((a, b) => a - b).slice(0, MAX_NAME_LOOKUPS);
  }, [selectedDayEvents, drawerItem]);
  const { data: contactNames, isError: contactsError, refetch: retryContacts } = useQuery<{ names: Record<number, string>; failed: number }>({
    queryKey: ["/api/contacts", { calendarNames: nameIds }],
    enabled: nameIds.length > 0,
    queryFn: async ({ signal }) => {
      const names: Record<number, string> = {};
      let failed = 0;
      await Promise.all(nameIds.map(async id => {
        try {
          const res = await fetch(`/api/contacts/${id}`, { credentials: "include", signal });
          if (res.status === 403 || res.status === 404) return; // not visible to this actor: keep the id, not a failure
          if (!res.ok) { failed += 1; return; }
          const c = await res.json();
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.companyName || c.email;
          if (name) names[id] = name; else failed += 1;
        } catch (error) {
          if ((error as Error).name === "AbortError") throw error;
          failed += 1;
        }
      }));
      return { names, failed };
    },
  });
  const contactMap = useMemo(() => new Map(Object.entries(contactNames?.names ?? {}).map(([id, name]) => [Number(id), name])), [contactNames]);
  const contactLookupFailed = contactsError || (contactNames?.failed ?? 0) > 0;

  useEffect(() => {
    // A month change can remove the opened item from the window; close instead of showing a stale drawer.
    // Only after every reader has settled: a restored URL item must not be dropped while its month is still loading.
    if (drawerItemId && !drawerItem && !eventsLoading && !dealsLoading && !appointmentsLoading) setDrawerItemId("");
  }, [drawerItemId, drawerItem, eventsLoading, dealsLoading, appointmentsLoading]);
  const todayKey = formatDateKey(today);
  const dealsPartial = Boolean(dealsRes && dealsRes.data.length < dealsRes.total);
  const appointmentPartial = Boolean(appointmentRead && (
    (typeof appointmentRead.exact !== "boolean" && !appointmentRead.completeness) ||
    (appointmentRead.exact === false && appointmentRead.completeness !== "provider_range") ||
    Boolean(appointmentRead.completeness && !["complete", "all_sources_exhausted", "provider_range"].includes(appointmentRead.completeness)) ||
    Boolean(appointmentRead.status && ["failed", "error", "unavailable", "partial"].includes(appointmentRead.status.toLowerCase())) ||
    appointmentRead.sourceStatus?.some(source => source.status === "failed" || source.truncated)
  ));

  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  if (eventsLoading || dealsLoading) {
    return (
      <div className={embedded ? "space-y-4" : "space-y-4 p-4 md:p-6"} data-testid="calendar-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-6" : "space-y-6 p-4 md:p-6 max-w-6xl mx-auto"} data-testid="calendar-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-6 w-6 text-muted-foreground" />
          {embedded ? <h2 className="text-lg font-semibold" data-testid="text-calendar-title">Calendar</h2> : <PageTitle className="text-2xl font-bold" data-testid="text-calendar-title">Calendar</PageTitle>}
          <span className="text-xs text-muted-foreground" data-testid="text-calendar-timezone">
            Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canUseProviderCreate && (
            <Button variant="outline" className="min-h-11" onClick={() => setShowProviderCreate(true)} data-testid="button-create-provider-appointment">
              <CalendarIcon className="h-4 w-4 mr-1" /> New provider appointment
            </Button>
          )}
          <Button onClick={() => { setEventForm(f => ({ ...f, date: selectedDate })); setShowAddDialog(true); }} data-testid="button-add-event">
            <Plus className="h-4 w-4 mr-1" /> Add local event
          </Button>
        </div>
      </div>

      <div className="space-y-1" data-testid="calendar-source-filter">
        <p className="text-xs font-medium text-muted-foreground" id="calendar-source-filter-label">Source</p>
        <ToggleGroup
          type="single"
          variant="outline"
          value={sourceFilter}
          onValueChange={value => { if (value) setSourceFilter(value as SourceFilter); }}
          aria-labelledby="calendar-source-filter-label"
          className="flex flex-wrap justify-start"
        >
          {SOURCE_FILTERS.map(option => (
            <ToggleGroupItem key={option.value} value={option.value} title={option.hint} className="min-h-11 px-3"
              data-testid={`filter-source-${option.value}`}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground" data-testid="text-source-filter-hint" role="status">
          {SOURCE_FILTERS.find(option => option.value === sourceFilter)?.hint}
          {sourceFilter !== "local" && appointmentsLoading ? " · reading appointments…" : ""}
        </p>
      </div>

      {(eventsError || appointmentsError || dealsError || contactLookupFailed || dealsPartial || appointmentPartial || appointmentRead?.configured === false) && (
        <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" role="status" data-testid="calendar-source-status">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium">Calendar source coverage</p>
            {eventsError && <p className="flex flex-wrap items-center gap-2">Internal events could not be read.
              <Button size="sm" variant="outline" onClick={() => void retryEvents()}>Retry</Button></p>}
            {appointmentsError && <p className="flex flex-wrap items-center gap-2">Appointment provider read failed; appointments are not assumed absent.
              <Button size="sm" variant="outline" onClick={() => void retryAppointments()}>Retry</Button></p>}
            {dealsError && <p className="flex flex-wrap items-center gap-2">Deal follow-up dates could not be read.
              <Button size="sm" variant="outline" onClick={() => void retryDeals()}>Retry</Button></p>}
            {contactLookupFailed && <p className="flex flex-wrap items-center gap-2">Contact names are unavailable; IDs are retained.
              <Button size="sm" variant="outline" onClick={() => void retryContacts()}>Retry</Button></p>}
            {dealsPartial && <p>Deal follow-ups are a partial window ({dealsRes?.data.length} of {dealsRes?.total} reported).</p>}
            {appointmentRead?.configured === false && <p data-testid="text-calendar-not-configured">{appointmentPurpose === "account" ? "Account" : "Sales"} calendar is not configured; no appointments are assumed absent.</p>}
            {appointmentPartial && <p>Appointment list is bounded or incomplete{appointmentRead?.queueLimit ? ` (queue limit ${appointmentRead.queueLimit})` : ""}; an empty result is not definitive.</p>}
            {appointmentRead && <p className="text-xs text-muted-foreground">
              {appointmentRead.source || appointmentRead.scope || "Appointment source"}
              {appointmentRead.status ? ` · ${appointmentRead.status}` : ""}
              {appointmentRead.asOf ? ` · read ${new Date(appointmentRead.asOf).toLocaleString()}` : ""}
            </p>}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card data-testid="calendar-grid-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <Button variant="outline" size="icon" aria-label="Previous month" onClick={prevMonth} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-lg" data-testid="text-current-month">
                {MONTH_NAMES[currentMonth]} {currentYear}
              </CardTitle>
              <Button variant="outline" size="icon" aria-label="Next month" onClick={nextMonth} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {narrow ? (
                <ol className="space-y-2" data-testid="calendar-agenda" aria-label={`${MONTH_NAMES[currentMonth]} ${currentYear} agenda`}>
                  {[...eventsByDate.entries()].filter(([key]) => key !== INVALID_DATE_KEY).sort(([x], [y]) => x.localeCompare(y)).map(([dateKey, items]) => (
                    <li key={dateKey}>
                      <button type="button" onClick={() => setSelectedDate(dateKey)}
                        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left ${dateKey === selectedDate ? "ring-2 ring-primary bg-primary/5" : ""}`}
                        data-testid={`calendar-agenda-day-${dateKey}`}>
                        <span className="text-sm font-medium">{new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                        <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                      </button>
                    </li>
                  ))}
                  {[...eventsByDate.keys()].filter(key => key !== INVALID_DATE_KEY).length === 0 && (
                    <li className="text-sm text-muted-foreground" data-testid="calendar-agenda-empty">
                      {appointmentsLoading || eventsLoading || dealsLoading ? "Reading sources; this month is not known to be empty yet." : "No items found in the available source windows for this month."}
                    </li>
                  )}
                </ol>
              ) : (
              <div className="grid grid-cols-7 gap-px" data-testid="calendar-grid">
                {DAY_NAMES.map(day => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2" data-testid={`calendar-day-header-${day}`}>
                    {day}
                  </div>
                ))}
                {calendarCells.map((day, idx) => {
                  if (day === null) {
                    return <div key={`empty-${idx}`} className="min-h-[4.5rem] p-1" />;
                  }
                  const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = eventsByDate.get(dateKey) || [];
                  const isToday = dateKey === todayKey;
                  const isSelected = dateKey === selectedDate;

                  return (
                    <button
                      key={dateKey}
                      onClick={() => setSelectedDate(dateKey)}
                      className={`min-h-[4.5rem] p-1 rounded-md text-left transition-colors ${
                        isSelected
                          ? "ring-2 ring-primary bg-primary/5"
                          : "hover-elevate"
                      }`}
                      data-testid={`calendar-day-${dateKey}`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                          isToday ? "bg-primary text-primary-foreground" : ""
                        }`}
                        data-testid={`text-day-number-${day}`}
                      >
                        {day}
                      </span>
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {dayEvents.slice(0, 3).map(evt => (
                          <span
                            key={evt.id}
                            className={`h-1.5 w-1.5 rounded-full ${TYPE_COLORS[evt.type] || "bg-muted-foreground"}`}
                            data-testid={`dot-event-${evt.id}`}
                          />
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted-foreground" data-testid={`text-more-events-${dateKey}`}>
                            +{dayEvents.length - 3}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              )}
            </CardContent>
          </Card>

          {invalidDateEvents.length > 0 && (
            <Card className="mt-4 border-amber-300" data-testid="card-invalid-date-events">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-700 dark:text-amber-400" data-testid="text-invalid-date-warning">
                  {invalidDateEvents.length} event{invalidDateEvents.length === 1 ? "" : "s"} with an unrecognized date could not be placed on the calendar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {invalidDateEvents.map(evt => (
                    <div key={evt.id} className="text-sm space-y-2 border-b last:border-b-0 pb-2 last:pb-0" data-testid={`row-invalid-date-event-${evt.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{evt.title}</span>
                        <span className="text-xs text-muted-foreground shrink-0">Invalid date</span>
                      </div>
                      {evt.readOnly ? (
                        <p className="text-xs text-muted-foreground">Provider appointment · read-only</p>
                      ) : fixingItemId === evt.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="date"
                            value={fixDate}
                            onChange={e => setFixDate(e.target.value)}
                            className="h-8 text-xs"
                            data-testid={`input-fix-date-${evt.id}`}
                          />
                          {evt.source === "event" && (
                            <>
                              <label className="text-xs">
                                Replacement start
                                <Input type="time" value={fixStartTime} onChange={e => setFixStartTime(e.target.value)}
                                  className="h-8 text-xs" data-testid={`input-fix-start-${evt.id}`} />
                              </label>
                              <label className="text-xs">
                                Duration (minutes)
                                <Input type="number" min={1} max={10080} step={1} value={fixDurationMinutes}
                                  onChange={e => setFixDurationMinutes(e.target.value)}
                                  className="h-8 text-xs" data-testid={`input-fix-duration-${evt.id}`} />
                              </label>
                              <p className="w-full text-xs text-muted-foreground">
                                Valid original times and duration are preserved. These replacements apply only to invalid times.
                              </p>
                            </>
                          )}
                          <Button
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={!fixDate || fixEventDateMutation.isPending}
                            onClick={() => fixEventDateMutation.mutate({ item: evt, newDate: fixDate,
                              replacement: { startTime: fixStartTime, durationMinutes: Number(fixDurationMinutes) } })}
                            data-testid={`button-save-fix-${evt.id}`}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => { setFixingItemId(null); setFixDate(""); }}
                            data-testid={`button-cancel-fix-${evt.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => { setFixingItemId(evt.id); setFixDate(formatDateKey(today));
                              setFixStartTime("09:00"); setFixDurationMinutes("60"); }}
                            data-testid={`button-edit-invalid-date-${evt.id}`}
                          >
                            Fix Date
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            disabled={removeInvalidDateMutation.isPending}
                            onClick={() => removeInvalidDateMutation.mutate(evt)}
                            data-testid={`button-delete-invalid-date-${evt.id}`}
                          >
                            {evt.source === "event" ? "Delete" : "Clear Follow-Up"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card data-testid="selected-day-events">
            <CardHeader className="pb-2">
              <CardTitle className="text-base" data-testid="text-selected-date">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDayEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-no-events">
                  {sourceFilter !== "local" && appointmentsLoading
                    ? "Reading appointments; this day is not known to be empty yet."
                    : eventsError || appointmentsError || dealsError
                    ? "Some calendar sources could not be read; no-empty results are not assumed."
                    : appointmentRead?.configured === false
                    ? "No local items are scheduled. The selected appointment calendar is not configured."
                    : appointmentPartial || dealsPartial
                    ? "No events found in the available source windows; coverage is partial."
                    : "No events scheduled"}
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedDayEvents.map(evt => {
                    const Icon = TYPE_ICONS[evt.type] || CalendarIcon;
                    return (
                      <div
                        key={evt.id}
                        className="flex items-start gap-3 p-2 rounded-md border"
                        data-testid={`event-item-${evt.id}`}
                      >
                        <div className={`mt-0.5 p-1.5 rounded-md ${TYPE_BADGE_VARIANTS[evt.type] || ""}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-sm font-medium truncate" data-testid={`text-event-title-${evt.id}`}>
                            {evt.title}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-event-time-${evt.id}`}>
                            {formatTime(evt.startTime)} - {formatTime(evt.endTime)}
                          </p>
                          {evt.contactId && contactMap.get(evt.contactId) && (
                            <p className="text-xs text-muted-foreground" data-testid={`text-event-contact-${evt.id}`}>
                              {contactMap.get(evt.contactId!)}
                            </p>
                          )}
                          {evt.description && (
                            <p className="text-xs text-muted-foreground truncate" data-testid={`text-event-desc-${evt.id}`}>
                              {evt.description}
                            </p>
                          )}
                          {evt.contactId && !contactMap.has(evt.contactId) && (
                            <p className="text-xs text-muted-foreground">
                              Contact #{evt.contactId}{contactLookupFailed ? " · name lookup failed" : ""}
                            </p>
                          )}
                          <Badge variant="secondary" className={`text-[10px] ${TYPE_BADGE_VARIANTS[evt.type] || ""}`} data-testid={`badge-event-type-${evt.id}`}>
                            {evt.type}
                          </Badge>
                          <Badge variant="outline" className="ml-1 text-[10px]" data-testid={`badge-event-source-${evt.id}`}>{evt.sourceLabel}</Badge>
                          {evt.noShow && <Badge variant="destructive" className="ml-1 text-[10px]">No-show</Badge>}
                          <div>
                            <Button size="sm" variant="outline" className="mt-1 min-h-11" onClick={() => setDrawerItemId(evt.id)}
                              aria-label={`View details for ${evt.title}`} data-testid={`button-event-details-${evt.id}`}>
                              Details
                            </Button>
                          </div>
                          {evt.externalUrl && <a href={evt.externalUrl} target="_blank" rel="noopener noreferrer"
                            className="ml-2 inline-flex items-center text-xs text-primary underline">Open appointment</a>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="event-type-legend">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Legend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {EVENT_TYPES.map(type => (
                  <div key={type} className="flex items-center gap-2 text-sm" data-testid={`legend-${type}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${TYPE_COLORS[type]}`} />
                    <span className="capitalize">{type}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={!!drawerItem} onOpenChange={open => { if (!open) setDrawerItemId(""); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="calendar-detail-drawer">
          {drawerItem && (
            <AppointmentDrawerBody
              item={drawerItem}
              contactName={drawerItem.contactId ? contactMap.get(drawerItem.contactId) : undefined}
              contactLookupFailed={contactLookupFailed}
              providerReadAt={drawerItem.source === "appointment" ? appointmentRead?.asOf : undefined}
            />
          )}
        </SheetContent>
      </Sheet>

      {canUseProviderCreate && (
        <Dialog open={showProviderCreate} onOpenChange={setShowProviderCreate}>
          <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="dialog-create-provider-appointment">
            <DialogHeader>
              <DialogTitle>New provider appointment</DialogTitle>
            </DialogHeader>
            <BookingCreatePanel purpose={appointmentPurpose} canExecute={calendarRole === "admin"}
              onSettled={() => { void retryAppointments(); }} />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent data-testid="dialog-add-event">
          <DialogHeader>
            <DialogTitle>Add local event</DialogTitle>
            <p className="text-xs text-muted-foreground" data-testid="text-local-event-note">Saved in this CRM only. It does not book a GoHighLevel appointment or send a message.</p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={eventForm.title}
                onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Event title"
                data-testid="input-event-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Date</label>
              <Input
                type="date"
                value={eventForm.date}
                onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
                data-testid="input-event-date"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Start Time</label>
                <Input
                  type="time"
                  value={eventForm.startTime}
                  onChange={e => setEventForm(f => ({ ...f, startTime: e.target.value }))}
                  data-testid="input-event-start-time"
                />
              </div>
              <div>
                <label className="text-sm font-medium">End Time</label>
                <Input
                  type="time"
                  value={eventForm.endTime}
                  onChange={e => setEventForm(f => ({ ...f, endTime: e.target.value }))}
                  data-testid="input-event-end-time"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={eventForm.type} onValueChange={v => setEventForm(f => ({ ...f, type: v as EventType }))}>
                <SelectTrigger data-testid="select-event-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(t => (
                    <SelectItem key={t} value={t} data-testid={`option-event-type-${t}`}>
                      <span className="capitalize">{t}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium" id="label-event-contact">Contact (optional)</label>
              <AuthorizedContactPicker value={pickedContact} onSelect={setPickedContact} label="contact" testId="event-contact-picker" />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={eventForm.notes}
                onChange={e => setEventForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Add notes..."
                className="resize-none"
                data-testid="input-event-notes"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)} data-testid="button-cancel-event">
                Cancel
              </Button>
              <Button
                onClick={handleSubmitEvent}
                disabled={!eventForm.title || !eventForm.date || createEventMutation.isPending}
                data-testid="button-submit-event"
              >
                {createEventMutation.isPending ? "Creating..." : "Create Event"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatStamp(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function DetailRow({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="space-y-0.5" data-testid={testId}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function AppointmentDrawerBody({ item, contactName, contactLookupFailed, providerReadAt }: {
  item: CalendarItem; contactName?: string; contactLookupFailed: boolean; providerReadAt?: string;
}) {
  const isAppointment = item.source === "appointment";
  const { user } = useAuth();
  const role = (user as { role?: string } | null | undefined)?.role;
  const detail = useQuery<AppointmentDetail>({
    queryKey: ["/api/appointments/detail", item.rawId],
    enabled: isAppointment,
    // Recorded occurrence and command state change as webhooks and commands land: always re-read when the drawer opens.
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/appointments/${encodeURIComponent(String(item.rawId))}/detail`, { credentials: "include", signal });
      // The server answers 404 for an appointment this actor may not read. That is "not available to you", never "no
      // command recorded": it carries no occurrence and no command list, and the commands section says so.
      if (res.status === 404) return { appointmentId: String(item.rawId), recorded: false, denied: true, occurrence: null, lastObservation: null, commands: [] };
      if (!res.ok) throw new Error("Appointment detail is unavailable.");
      return res.json();
    },
  });
  const occurrence = detail.data?.occurrence;
  const listedStart = new Date(item.startTime).getTime();
  const recordedStart = occurrence?.startTime ? new Date(occurrence.startTime).getTime() : NaN;
  const startsDiffer = Number.isFinite(listedStart) && Number.isFinite(recordedStart) && listedStart !== recordedStart;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-words pr-6" data-testid="drawer-title">{item.title}</SheetTitle>
        <SheetDescription data-testid="drawer-source">{item.sourceLabel}</SheetDescription>
      </SheetHeader>
      <dl className="mt-4 space-y-4">
        <DetailRow label="When" testId="drawer-when">
          {formatStamp(item.startTime)}{item.endTime && item.endTime !== item.startTime ? ` – ${formatTime(item.endTime)}` : ""}
          <span className="block text-xs text-muted-foreground">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        </DetailRow>
        <DetailRow label="Type">{item.type}{item.noShow ? " · no-show" : ""}</DetailRow>
        {item.contactId && (
          <DetailRow label="Contact" testId="drawer-contact">
            {contactName ?? `Contact #${item.contactId}${contactLookupFailed ? " · name lookup failed" : ""}`}
          </DetailRow>
        )}
        {item.description && <DetailRow label="Notes">{item.description}</DetailRow>}
        {item.contactId && (
          <DetailRow label="Handoff" testId="drawer-handoff-links">
            <a href={`/dashboard/contacts/${item.contactId}`} className="inline-flex min-h-11 items-center text-sm text-primary underline" data-testid="link-drawer-contact">Open contact (journey and follow-ups)</a>
          </DetailRow>
        )}
      </dl>

      {!isAppointment ? (
        <p className="mt-6 rounded-md border p-3 text-sm text-muted-foreground" data-testid="drawer-local-note">
          {item.source === "event"
            ? "Local event: saved in this CRM only. It is not a GoHighLevel appointment and sent no message."
            : "Local deal follow-up date. It is not a GoHighLevel appointment."}
        </p>
      ) : (
        <div className="mt-6 space-y-5" data-testid="drawer-appointment-sections">
          <section aria-labelledby="drawer-occurrence-h" className="space-y-2" data-testid="drawer-occurrence">
            <h3 id="drawer-occurrence-h" className="text-sm font-semibold">Current occurrence</h3>
            {detail.isPending ? <p role="status" className="text-sm text-muted-foreground">Reading recorded appointment state…</p>
              : detail.isError ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>Recorded appointment state could not be read. This is not “no record”.</p>
                  <Button size="sm" variant="outline" className="min-h-11" onClick={() => void detail.refetch()} data-testid="button-retry-detail">Retry</Button>
                </div>
              ) : detail.data.denied ? (
                <p className="text-sm text-muted-foreground" role="status" data-testid="drawer-detail-denied">
                  Recorded state for this appointment is not available to your account. This is not “no record”.
                </p>
              ) : !detail.data.recorded || !occurrence ? (
                <p className="text-sm text-muted-foreground" data-testid="drawer-not-recorded">
                  No recorded occurrence for this appointment. Whether it is the current meeting cannot be determined from this listing alone.
                </p>
              ) : (
                <dl className="space-y-2">
                  <DetailRow label="Recorded status"><Badge variant="secondary" data-testid="drawer-recorded-status">{occurrence.status.replace("_", " ")}</Badge></DetailRow>
                  <DetailRow label="Current meeting" testId="drawer-current">
                    {occurrence.current
                      ? "Yes — the current meeting for this contact and calendar."
                      : occurrence.currentAppointmentId
                        ? "No — another open appointment is current for this contact."
                        : "No — this appointment is closed or superseded; no open appointment is recorded."}
                  </DetailRow>
                  <DetailRow label="Recorded start">{formatStamp(occurrence.startTime)}</DetailRow>
                  <DetailRow label="Rescheduled">{occurrence.rescheduleCount} time{occurrence.rescheduleCount === 1 ? "" : "s"}</DetailRow>
                  {startsDiffer && <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="drawer-start-differs">
                    The recorded start differs from the provider listing; the provider listing is shown above.</p>}
                </dl>
              )}
          </section>

          <section aria-labelledby="drawer-observation-h" className="space-y-2" data-testid="drawer-observation">
            <h3 id="drawer-observation-h" className="text-sm font-semibold">Last observation</h3>
            <dl className="space-y-2">
              <DetailRow label="Provider calendar read">{providerReadAt ? formatStamp(providerReadAt) : "Not recorded"}</DetailRow>
              <DetailRow label="Last recorded provider event">
                {detail.data?.lastObservation ? formatStamp(detail.data.lastObservation.eventAt) : detail.isPending ? "Reading…" : "No provider event recorded"}
              </DetailRow>
            </dl>
          </section>

          <section aria-labelledby="drawer-commands-h" className="space-y-2" data-testid="drawer-commands">
            <h3 id="drawer-commands-h" className="text-sm font-semibold">Booking commands</h3>
            {detail.isPending ? <p role="status" className="text-sm text-muted-foreground">Reading booking commands…</p>
              : detail.isError ? <p className="text-sm text-muted-foreground">Command state unavailable.</p>
              : detail.data.denied ? <p className="text-sm text-muted-foreground" data-testid="drawer-commands-denied">Booking commands are not available to your account.</p>
              : detail.data.commands.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="drawer-no-commands">No booking command is recorded for this appointment.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.data.commands.map((command, index) => (
                    <li key={`${command.startedAt}-${index}`} className="rounded-md border p-2 text-sm" data-testid={`drawer-command-${command.state}`}>
                      <span className="font-medium capitalize">{command.operation}</span>
                      <span className="block text-xs">{COMMAND_STATE_COPY[command.state]}</span>
                      <span className="block text-xs text-muted-foreground">Started {formatStamp(command.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {item.contactId && (role === "admin" || role === "manager") && !detail.data?.denied && (
            <BookingCommandPanel
              key={String(item.rawId)} appointmentId={String(item.rawId)} contactId={item.contactId} title={item.title.slice(0, 120)}
              purpose={item.purpose ?? "sales"} startTime={item.startTime} endTime={item.endTime} canExecute={role === "admin"}
              onSettled={() => { void detail.refetch(); }} />
          )}
          <p className="text-xs text-muted-foreground">The listing is read-only; provider changes go only through the reviewed command above.</p>
          {item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-sm text-primary underline">Open appointment</a>}
        </div>
      )}
    </>
  );
}
