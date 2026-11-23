import { useCrmQuery } from "@/hooks/use-crm-query";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { IntakeRecordActions, intakeDeliveryStateLabel, type IntakeKind } from "./IntakeRecordActions";

type TriageRow = {
  id: string;
  name: string | null;
  status: string;
  received_at: string;
  owner: string | null;
  due_at: string | null;
  deadline_open: boolean;
  receipt_state: string | null;
  staff_alert_state: string | null;
};

const deadlineFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function IntakeTriage({ kind }: { kind: IntakeKind }) {
  const triage = useCrmQuery<TriageRow[]>({ queryKey: [`/api/intake-center/triage/${kind}`] });
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4" aria-labelledby={`intake-triage-${kind}`}>
      <h3 id={`intake-triage-${kind}`} className="font-semibold">
        {kind === "merchant_referrals" ? "Recent merchant referral follow-up" : "Recent follow-up"}
      </h3>
      {triage.isLoading ? <Skeleton className="mt-3 h-24" /> : triage.isError ? (
        <CrmDataState state="unavailable" message="Follow-up status could not be loaded." onRetry={() => void triage.refetch()} />
      ) : !triage.data?.length ? (
        <p className="mt-2 text-sm text-muted-foreground">No submissions in this category yet.</p>
      ) : (
        <ul className="mt-2 divide-y" data-testid="intake-triage">
          {triage.data.map(row => {
            const due = row.due_at ? Date.parse(row.due_at) : NaN;
            const missed = row.deadline_open && due < Date.now();
            return (
              <li key={row.id} className="grid gap-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <p className="break-words font-medium">{row.name || "Submission"}</p>
                  <p className="text-muted-foreground">{row.status.replaceAll("_", " ")} · {row.id.replaceAll("-", "").slice(0, 8).toUpperCase()}</p>
                </div>
                <div className="min-w-0">
                  <p className="break-words">{row.owner || "Unassigned"}</p>
                  <p className="text-muted-foreground">{Number.isFinite(due) ? `Due ${deadlineFormat.format(due)}` : "No deadline recorded"}</p>
                  {missed && <Badge variant="destructive" className="mt-1">SLA missed</Badge>}
                </div>
                <div className="text-muted-foreground">
                  <p>Receipt · {row.receipt_state ? intakeDeliveryStateLabel(row.receipt_state) : "No attempt recorded"}</p>
                  <p>Staff alert · {row.staff_alert_state ? intakeDeliveryStateLabel(row.staff_alert_state) : "No attempt recorded"}</p>
                </div>
                <div><IntakeRecordActions kind={kind} id={row.id} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
