import { useLocation, useSearch } from "wouter";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { Button } from "@/components/ui/button";
import { appointmentsInWindow, formatAppointmentWindow, type AppointmentRangeRead } from "@/lib/today-cockpit";
import { appointmentWindowState } from "@/lib/crm-destination-state";

type WindowAppointment = {
  id: string; title?: string; contactName?: string; startTime: string | number | null; status?: string;
};
type WindowRead = AppointmentRangeRead & { appointments?: WindowAppointment[] };

const WINDOW_KEYS = ["cal_window_from", "cal_window_days"] as const;
const startMs = (value: string | number | null) => (typeof value === "number" ? value : Date.parse(String(value ?? "")));

/**
 * The exact appointment window a Today count covered. It opens from the Today "Appointments in the next 7 days" action and
 * lists the active appointments that count included (same predicate, same sales calendar), so the number and the list are
 * the same population. It is a view only: nothing here creates, moves or cancels an appointment. The month grid below is
 * unchanged.
 */
export function AppointmentWindowPanel() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const requested = WINDOW_KEYS.some((key) => params.has(key));
  const window_ = appointmentWindowState(search);
  const fromMs = window_ ? Date.parse(window_.from) : 0;
  const days = window_?.days ?? 0;

  const read = useQuery<WindowRead>({
    queryKey: ["/api/appointments/range", "window", window_?.from ?? "", days, "sales"],
    enabled: window_ !== null,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ start: new Date(fromMs).toISOString(), end: new Date(fromMs + days * 86_400_000).toISOString(), purpose: "sales" });
      const response = await fetch(`/api/appointments/range?${query}`, { credentials: "include", signal });
      // 409 is the reader's explicit "calendar not configured" answer: stated, never an empty list.
      if (response.status === 409) return { appointments: [], configured: false, status: "not_configured" };
      if (!response.ok) throw new Error("Appointments are unavailable.");
      return response.json();
    },
  });

  if (!requested) return null;
  const close = () => {
    const next = new URLSearchParams(search);
    for (const key of WINDOW_KEYS) next.delete(key);
    const qs = next.toString();
    navigate(`${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  };

  if (!window_) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm" data-testid="calendar-window-invalid">
        <span>This appointment window link is not valid, so the month view is shown instead.</span>
        <Button type="button" variant="outline" className="min-h-11" onClick={close}>Dismiss</Button>
      </div>
    );
  }

  const rows = read.data && read.data.configured !== false && read.data.status !== "not_configured"
    ? appointmentsInWindow(read.data.appointments, fromMs, days).sort((a, b) => startMs(a.startTime) - startMs(b.startTime))
    : [];
  const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <section aria-labelledby="calendar-window-heading" className="rounded-lg border bg-card p-4 space-y-2" data-testid="calendar-window">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="calendar-window-heading" className="text-base font-semibold">Appointments counted on Today</h3>
        <Button type="button" variant="ghost" className="min-h-11" onClick={close} data-testid="calendar-window-close">Show month only</Button>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="calendar-window-range">
        {formatAppointmentWindow(fromMs, days)}. Sales calendar, excluding cancelled and no-show appointments. Appointments that started before the window opened are not listed.
      </p>
      {read.isLoading ? (
        <p role="status" className="text-sm" data-testid="calendar-window-loading">Reading appointments…</p>
      ) : read.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm" data-testid="calendar-window-unavailable">
          <span>Appointments could not be read. This is not an all-clear.</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void read.refetch()} data-testid="calendar-window-retry">Retry</Button>
        </div>
      ) : read.data && (read.data.configured === false || read.data.status === "not_configured") ? (
        <p role="status" className="text-sm" data-testid="calendar-window-not-configured">The sales calendar is not connected, so appointments cannot be listed.</p>
      ) : (
        <>
          <p className="text-sm font-medium" role="status" data-testid="calendar-window-count">{rows.length} {rows.length === 1 ? "appointment" : "appointments"} in this window</p>
          {rows.length > 0 && (
            <ol className="divide-y text-sm" data-testid="calendar-window-list">
              {rows.map((row) => (
                <li key={row.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2" data-testid={`calendar-window-row-${row.id}`}>
                  <span className="min-w-0 break-words">{row.title || row.contactName || "Appointment"}</span>
                  <span className="tabular-nums text-muted-foreground">{timeFormat.format(new Date(startMs(row.startTime)))} ET</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
