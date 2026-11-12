import { useMemo } from "react";
import { Link } from "wouter";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { apiRequest } from "@/lib/queryClient";
import { decodeInboxSourcePage, type InboxSourcePage } from "@/lib/inbox-source";
import { decodeTaskRows } from "@/lib/task-source";
import {
  appointmentRow, cockpitPermissions, cockpitRowText, intakeRow, unassignedRow, unreadRow,
  type AppointmentRangeRead, type CockpitRow, type CockpitTask, type IntakeSummaryRead,
} from "@/lib/today-cockpit";

const HOUR_MS = 3_600_000;

/**
 * The part of Today that answers "what needs me now" beyond due tasks: unread conversations, new website requests,
 * unassigned review (managers only) and upcoming appointments. Each row has its own read, so one failing source says
 * "Unavailable" for that row only. Counts are actionable: every row opens the exact cohort it counted.
 */
export function TodayWorkQueue({ role }: { role: string | null | undefined }) {
  const permitted = cockpitPermissions(role);
  // The window is anchored to the hour so the query identity is stable between renders and refetches.
  const range = useMemo(() => {
    const start = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    return { start: new Date(start).toISOString(), end: new Date(start + 7 * 24 * HOUR_MS).toISOString(), anchoredAt: start };
  }, []);

  const unread = useQuery<InboxSourcePage>({
    queryKey: ["/api/inbox/items", "today-queue", { channel: "all", filter: "unread", limit: 30 }],
    queryFn: async ({ signal }) => decodeInboxSourcePage(
      await (await apiRequest("GET", "/api/inbox/items?channel=all&filter=unread&limit=30", undefined, undefined, signal)).json(),
    ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const intake = useQuery<IntakeSummaryRead>({
    queryKey: ["/api/lead-ops/inbound-requests/summary"],
    enabled: permitted.intake,
    refetchInterval: 60_000,
  });
  const tasks = useQuery<CockpitTask[]>({
    queryKey: ["/api/tasks", "all"],
    queryFn: async ({ signal }) => decodeTaskRows(await (await apiRequest("GET", "/api/tasks", undefined, undefined, signal)).json()),
    enabled: permitted.unassigned,
    staleTime: 60_000,
  });
  const appointments = useQuery<AppointmentRangeRead>({
    queryKey: ["/api/appointments/range", "today-queue", range.start, range.end, "sales"],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ start: range.start, end: range.end, purpose: "sales" });
      const response = await fetch(`/api/appointments/range?${params}`, { credentials: "include", signal });
      // 409 is the reader's explicit "calendar not configured" answer; it is stated, never counted as zero.
      if (response.status === 409) return { appointments: [], configured: false, status: "not_configured" };
      if (!response.ok) throw new Error("Appointments are unavailable.");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });

  const rows: CockpitRow[] = [
    unreadRow(unread),
    ...(permitted.intake ? [intakeRow(intake)] : []),
    ...(permitted.unassigned ? [unassignedRow(tasks)] : []),
    appointmentRow(appointments, new Date(range.anchoredAt)),
  ];
  const stamps = [unread.dataUpdatedAt, permitted.intake ? intake.dataUpdatedAt : 0, permitted.unassigned ? tasks.dataUpdatedAt : 0, appointments.dataUpdatedAt].filter(Boolean);
  const asOf = stamps.length ? new Date(Math.min(...stamps)) : null;

  return (
    <section aria-labelledby="today-work-queue-heading" className="rounded-lg border bg-card p-4" data-testid="today-work-queue">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-work-queue-heading" className="text-base font-semibold">Conversations, intake and appointments</h2>
        <span className="text-xs text-muted-foreground" data-testid="today-work-queue-asof">
          {asOf ? `Oldest read ${asOf.toLocaleTimeString()}` : "Reading…"}
        </span>
      </div>
      <ul className="mt-2 divide-y">
        {rows.map((row) => (
          <li key={row.key} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2" data-testid={`today-queue-row-${row.key}`} data-row-state={row.state}>
            <span className="min-w-0 text-sm">
              <span className="font-semibold tabular-nums" data-testid={`today-queue-value-${row.key}`}>{cockpitRowText(row)}</span>{" "}{row.label}
              {row.note && <span className="block text-xs text-muted-foreground" data-testid={`today-queue-note-${row.key}`}>{row.note}</span>}
            </span>
            <Link href={row.href} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">{row.cta}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
