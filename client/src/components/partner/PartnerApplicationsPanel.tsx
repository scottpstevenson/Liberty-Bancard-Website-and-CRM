import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CrmDataState, CrmDataTable, CrmDetailDrawer, type CrmDataColumn } from "@/components/crm/CrmPresentation";
import { apiRequest, parseApiRequestError, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useUrlParam } from "@/hooks/use-url-param";
import { useToast } from "@/hooks/use-toast";
import { PARTNER_PATH_IDS, PARTNER_PROFESSIONS } from "@shared/partner-public-content";

const STATUS_OPTIONS = [
  { value: "all", label: "All review states" },
  { value: "pending_review", label: "Pending review" },
  { value: "needs_info", label: "Needs information" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "superseded", label: "Superseded" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => [o.value, o.label]));
const PATH_LABEL: Record<string, string> = { referral: "Referral partner", sales_agent: "Sales agent" };
const PROFESSION_LABEL: Record<string, string> = Object.fromEntries(PARTNER_PROFESSIONS.map((p) => [p.id, p.label]));
const ANSWER_LABEL: Record<string, string> = {
  contactPreference: "Contact preference", company: "Company", background: "Background", profession: "Profession",
  professionOther: "Profession detail", referralNetwork: "Referral network", expectedIntroductions: "Expected introductions",
  region: "Region", experience: "Payments or sales experience", prospectingApproach: "Prospecting approach", leadSourceInterest: "Lead-source interest",
};
const DECISION_ERRORS: Record<string, string> = {
  STALE_REVISION: "This application changed since you opened it. The latest version is now showing; review it and decide again.",
  APPLICATION_NOT_OPEN: "This application has already been decided.",
  PARTNER_NOT_PENDING: "The partner record is no longer pending, so this application cannot be decided here.",
  TERMS_REQUIRED: "Enter the commission percentage from the agreement (a whole number from 1 to 100).",
  SCHEDULE_REFERENCE_REQUIRED: "Enter the agreement or schedule reference these terms come from.",
  NOTE_REQUIRED: "A note is required for this decision.",
  REVISION_REQUIRED: "Reload the application and try again.",
};

interface ListRow {
  id: string; receivedAt: string; applicantName: string | null; company: string | null; path: string; profession: string | null;
  region: string | null; reviewStatus: string; revision: number; assignedOwner: string | null; dueAt: string | null;
  reviewPolicy: string | null; termsState: "pending" | "recorded"; partnerStatus: string | null;
}
interface ListResponse { rows: ListRow[]; total: number; page: number; pageSize: number }
interface Detail {
  application: {
    id: string; path: string; profession: string | null; answers: Record<string, unknown>;
    contactConsent: { version: string; purpose: string; textSha256: string; acceptedAt: string };
    marketing: { optIn: boolean; disclosureId: string | null };
    sourcePage: string | null; attribution: Record<string, unknown>;
    reviewStatus: string; revision: number; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
    scheduleReference: string | null; receivedAt: string; inboundRequestId: string;
  };
  partner: { id: number; name: string | null; company: string; email: string | null; phone: string | null; partnerType: string | null; status: string | null; terms: string };
  contactId: number | null;
  invitation: { id: string; kind: string; state: string; generation: number; waitReason: string | null; terminalReason: string | null; updatedAt: string } | null;
  assignment: { owner: string | null; dueAt: string | null; policy: string | null; gap: string | null };
}

const oneOf = (allowed: readonly string[]) => (raw: string) => (allowed.includes(raw) ? raw : undefined);
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

function StatusBadge({ status }: { status: string }) {
  const variant = status === "accepted" ? "default" : status === "pending_review" || status === "needs_info" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function ownerText(row: { assignedOwner: string | null; reviewPolicy: string | null }) {
  if (row.assignedOwner) return "Assigned";
  return "Unassigned: assignment policy required";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Decision form. Admin-only: the server also enforces this, the UI just does not offer a control that would be refused. */
function DecisionForm({ detail, onDecided }: { detail: Detail; onDecided: () => void }) {
  const { toast } = useToast();
  const open = detail.application.reviewStatus === "pending_review" || detail.application.reviewStatus === "needs_info";
  const [decision, setDecision] = useState<"" | "accept" | "decline" | "needs_info">("");
  const [percent, setPercent] = useState("");
  const [schedule, setSchedule] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { decision, expectedRevision: detail.application.revision };
      if (decision === "accept") {
        body.commissionPercent = /^\d{1,3}$/.test(percent.trim()) ? Number(percent.trim()) : null;
        body.scheduleReference = schedule.trim();
      }
      if (note.trim()) body.note = note.trim();
      const res = await apiRequest("POST", `/api/partner-applications/${detail.application.id}/decision`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: decision === "accept" ? "Application accepted" : decision === "decline" ? "Application declined" : "More information requested" });
      setConfirming(false);
      setDecision(""); setPercent(""); setSchedule(""); setNote("");
      onDecided();
    },
    onError: (err: Error) => {
      const { code } = parseApiRequestError(err.message);
      setConfirming(false);
      setError((code && DECISION_ERRORS[code]) || "The decision could not be saved. Nothing was changed.");
      if (code === "STALE_REVISION" || code === "APPLICATION_NOT_OPEN" || code === "PARTNER_NOT_PENDING") onDecided();
    },
  });

  if (!open) {
    return (
      <section aria-label="Decision" className="space-y-2">
        <h3 className="text-lg font-semibold">Decision</h3>
        <p className="text-sm text-muted-foreground" data-testid="application-decision-closed">
          {STATUS_LABEL[detail.application.reviewStatus] ?? detail.application.reviewStatus} {detail.application.decidedAt ? `on ${fmt(detail.application.decidedAt)}` : ""}.
        </p>
        {detail.application.decisionNote ? <p className="text-sm text-foreground">{detail.application.decisionNote}</p> : null}
      </section>
    );
  }

  const needsNote = decision === "decline" || decision === "needs_info";
  const validate = (): string | null => {
    if (!decision) return "Choose a decision.";
    if (decision === "accept") {
      if (!/^\d{1,3}$/.test(percent.trim()) || Number(percent) < 1 || Number(percent) > 100) return DECISION_ERRORS.TERMS_REQUIRED;
      if (!schedule.trim()) return DECISION_ERRORS.SCHEDULE_REFERENCE_REQUIRED;
    }
    if (needsNote && !note.trim()) return DECISION_ERRORS.NOTE_REQUIRED;
    return null;
  };

  return (
    <section aria-label="Decision" className="space-y-3" data-testid="application-decision-form">
      <h3 className="text-lg font-semibold">Decision</h3>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Outcome</legend>
        {([["accept", "Accept"], ["needs_info", "Request more information"], ["decline", "Decline"]] as const).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="application-decision" value={value} checked={decision === value}
              onChange={() => { setDecision(value); setError(null); setConfirming(false); }} className="h-5 w-5" data-testid={`application-decision-${value}`} />
            {label}
          </label>
        ))}
      </fieldset>
      {decision === "accept" ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="application-terms" className="mb-1 block text-sm font-medium">Commission percentage from the signed agreement*</label>
            <Input id="application-terms" inputMode="numeric" value={percent} onChange={(e) => { setPercent(e.target.value); setConfirming(false); }} className="min-h-11" data-testid="application-terms-input" />
          </div>
          <div>
            <label htmlFor="application-schedule" className="mb-1 block text-sm font-medium">Agreement or schedule reference*</label>
            <Input id="application-schedule" value={schedule} maxLength={200} onChange={(e) => { setSchedule(e.target.value); setConfirming(false); }} className="min-h-11" data-testid="application-schedule-input" />
          </div>
          <p className="text-xs text-muted-foreground">
            Accepting records these terms and queues one account invitation. It does not give marketing consent and does not start any email sequence.
          </p>
        </div>
      ) : null}
      {decision ? (
        <div>
          <label htmlFor="application-note" className="mb-1 block text-sm font-medium">Note{needsNote ? "*" : " (optional)"}</label>
          <Textarea id="application-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="application-note-input" />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive" data-testid="application-decision-error">{error}</p> : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm decision">
          <span className="text-sm text-foreground">
            {decision === "accept" ? `Accept with ${percent.trim()}% under ${schedule.trim()}?` : decision === "decline" ? "Decline this application?" : "Send this request for more information?"}
          </span>
          <Button className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate()} data-testid="application-decision-confirm">
            {decide.isPending ? "Saving..." : "Confirm"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={decide.isPending} onClick={() => setConfirming(false)}>Back</Button>
        </div>
      ) : (
        <Button className="min-h-11" onClick={() => { const found = validate(); setError(found); if (!found) setConfirming(true); }} data-testid="application-decision-submit">
          Review decision
        </Button>
      )}
    </section>
  );
}

function ApplicationDetailBody({ id, canDecide, onChanged }: { id: string; canDecide: boolean; onChanged: () => void }) {
  const detailKey = `/api/partner-applications/${id}`;
  const query = useQuery<Detail>({ queryKey: [detailKey], staleTime: 0 });
  if (query.isLoading) return <CrmDataState state="loading" />;
  if (query.isError || !query.data) return <CrmDataState state="unavailable" message="This application could not be loaded." onRetry={() => void query.refetch()} />;
  const d = query.data;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [detailKey] }); onChanged(); };
  const answers = Object.entries(d.application.answers).filter(([, v]) => typeof v === "string" && v.length > 0) as [string, string][];
  return (
    <div className="space-y-6" data-testid="application-detail">
      <section aria-label="State" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={d.application.reviewStatus} />
          <span className="text-sm text-muted-foreground">Received {fmt(d.application.receivedAt)}</span>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Terms"><span data-testid="application-terms-state">{d.partner.terms === "Terms pending" ? "Terms pending: none recorded" : "Terms recorded"}</span></Field>
          <Field label="Partner account">{d.partner.status ?? "—"}</Field>
          <Field label="Assigned owner">{d.assignment.owner ? "Assigned" : "Unassigned: assignment policy required"}</Field>
          <Field label="Due">{d.assignment.dueAt ? fmt(d.assignment.dueAt) : d.assignment.gap ? `Held: ${d.assignment.gap}` : "No due time set"}</Field>
          <Field label="Related contact">{d.contactId ? `Contact #${d.contactId}` : "None linked"}</Field>
          <Field label="Invitation">
            {d.invitation
              ? `${d.invitation.state}${d.invitation.waitReason ? ` (${d.invitation.waitReason})` : ""}${d.invitation.terminalReason ? ` (${d.invitation.terminalReason})` : ""}`
              : "No invitation queued"}
          </Field>
        </dl>
      </section>

      {canDecide ? <DecisionForm detail={d} onDecided={refresh} /> : (
        <section aria-label="Decision" className="space-y-2">
          <h3 className="text-lg font-semibold">Decision</h3>
          <p className="text-sm text-muted-foreground" data-testid="application-read-only">Only an administrator can decide an application. You can review the details here.</p>
          {d.application.decisionNote ? <p className="text-sm text-foreground">{d.application.decisionNote}</p> : null}
        </section>
      )}

      <section aria-label="Applicant" className="space-y-2">
        <h3 className="text-lg font-semibold">Applicant</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">{d.partner.name ?? "—"}</Field>
          <Field label="Company">{d.partner.company}</Field>
          <Field label="Email">{d.partner.email ?? "—"}</Field>
          <Field label="Phone">{d.partner.phone ?? "—"}</Field>
          <Field label="Path">{PATH_LABEL[d.application.path] ?? d.application.path}</Field>
          <Field label="Profession">{d.application.profession ? PROFESSION_LABEL[d.application.profession] ?? d.application.profession : "—"}</Field>
        </dl>
      </section>

      <section aria-label="Submitted answers" className="space-y-2">
        <h3 className="text-lg font-semibold">Submitted answers</h3>
        {answers.length === 0 ? <p className="text-sm text-muted-foreground">No additional answers were submitted.</p> : (
          <dl className="space-y-3">{answers.map(([key, value]) => <Field key={key} label={ANSWER_LABEL[key] ?? key}><span className="whitespace-pre-wrap">{value}</span></Field>)}</dl>
        )}
      </section>

      <section aria-label="Permissions and source" className="space-y-2">
        <h3 className="text-lg font-semibold">Permissions and source</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Permission to contact about this application">
            {d.application.contactConsent.version}, {fmt(d.application.contactConsent.acceptedAt)}
          </Field>
          <Field label="Marketing email permission">
            {d.application.marketing.optIn ? `Opted in (${d.application.marketing.disclosureId ?? "disclosure on record"})` : "Not given"}
          </Field>
          <Field label="Source page">{d.application.sourcePage ?? "—"}</Field>
          <Field label="Request reference"><code className="font-mono text-xs">{d.application.inboundRequestId}</code></Field>
          {d.application.scheduleReference ? <Field label="Agreement reference">{d.application.scheduleReference}</Field> : null}
          {Object.entries(d.application.attribution).filter(([, v]) => typeof v === "string" && v).slice(0, 8).map(([k, v]) => <Field key={k} label={k}>{String(v)}</Field>)}
        </dl>
      </section>
    </div>
  );
}

/**
 * Applications review inside the Referral & Partner Program page. Server-paginated with bounded filters kept in the URL.
 * Admin and manager read; only an administrator is shown the decision controls (the server enforces the same rule).
 */
export function PartnerApplicationsPanel() {
  const { user } = useAuth();
  const canDecide = user?.role === "admin";
  const [status, setStatus] = useUrlParam("appStatus", "pending_review", oneOf(STATUS_OPTIONS.map((o) => o.value)), { history: "replace" });
  const [path, setPath] = useUrlParam("appPath", "", oneOf(["", ...PARTNER_PATH_IDS]), { history: "replace" });
  const [profession, setProfession] = useUrlParam("appProfession", "", oneOf(["", ...PARTNER_PROFESSIONS.map((p) => p.id)]), { history: "replace" });
  const [owner, setOwner] = useUrlParam("appOwner", "", oneOf(["", "assigned", "unassigned"]), { history: "replace" });
  const [page, setPage] = useUrlParam("appPage", 1, (raw) => (/^\d{1,4}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined), { history: "replace" });
  const [openId, setOpenId] = useUrlParam("application", "", (raw) => (/^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined), { history: "push" });

  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (path) params.set("path", path);
    if (profession) params.set("profession", profession);
    if (owner) params.set("owner", owner);
    params.set("page", String(page));
    params.set("pageSize", "25");
    return `/api/partner-applications?${params.toString()}`;
  }, [status, path, profession, owner, page]);
  const list = useQuery<ListResponse>({ queryKey: [listKey], staleTime: 0 });

  const columns: CrmDataColumn<ListRow>[] = [
    { id: "received", label: "Received", render: (r) => fmt(r.receivedAt) },
    { id: "applicant", label: "Applicant", render: (r) => <span className="font-medium">{r.applicantName ?? "—"}</span> },
    { id: "company", label: "Company", render: (r) => r.company ?? "—" },
    { id: "path", label: "Path", render: (r) => PATH_LABEL[r.path] ?? r.path },
    { id: "profession", label: "Profession / region", render: (r) => [r.profession ? PROFESSION_LABEL[r.profession] ?? r.profession : null, r.region].filter(Boolean).join(" · ") || "—" },
    { id: "status", label: "Review status", render: (r) => <StatusBadge status={r.reviewStatus} /> },
    { id: "owner", label: "Assigned owner", render: (r) => ownerText(r) },
    { id: "due", label: "Due", render: (r) => (r.dueAt ? fmt(r.dueAt) : "Not set") },
    { id: "terms", label: "Terms", render: (r) => (r.termsState === "recorded" ? "Recorded" : "Pending") },
    { id: "open", label: "Open", render: (r) => (
      <Button variant="outline" size="sm" className="min-h-11" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} data-testid={`button-open-application-${r.id}`}>Open</Button>
    ) },
  ];

  const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
  const reset = () => { setStatus("pending_review"); setPath(""); setProfession(""); setOwner(""); setPage(1); };
  const data = list.data;

  return (
    <div className="space-y-4" data-testid="partner-applications-panel">
      <Card>
        <CardHeader><CardTitle className="text-lg">Applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A submitted application is pending review. It is not an approval, a signed agreement or an active account. An administrator decides each one.
          </p>
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Application filters">
            <label className="text-xs text-muted-foreground">Review state
              <select className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="filter-application-status">
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Path
              <select className={selectClass} value={path} onChange={(e) => { setPath(e.target.value); setPage(1); }} data-testid="filter-application-path">
                <option value="">All paths</option>
                {PARTNER_PATH_IDS.map((id) => <option key={id} value={id}>{PATH_LABEL[id]}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Profession
              <select className={selectClass} value={profession} onChange={(e) => { setProfession(e.target.value); setPage(1); }} data-testid="filter-application-profession">
                <option value="">All professions</option>
                {PARTNER_PROFESSIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Owner
              <select className={selectClass} value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }} data-testid="filter-application-owner">
                <option value="">Any owner</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
            <div className="flex items-end"><Button type="button" variant="outline" className="min-h-11 w-full" onClick={reset} data-testid="filter-application-reset">Reset filters</Button></div>
          </form>

          {list.isLoading ? <CrmDataState state="loading" /> : list.isError || !data ? (
            <CrmDataState state="unavailable" message="Applications could not be loaded." onRetry={() => void list.refetch()} />
          ) : data.rows.length === 0 ? (
            <CrmDataState state={status !== "all" || path || profession || owner ? "no-match" : "empty"} message={status !== "all" || path || profession || owner ? undefined : "No applications have been submitted yet."} />
          ) : (
            <CrmDataTable<ListRow>
              testId="applications-table"
              rows={data.rows}
              columns={columns}
              onRowClick={(row) => setOpenId(row.id)}
              page={data.page}
              pageSize={25}
              total={data.total}
              totalAvailability="known"
              hasPrevious={data.page > 1}
              hasNext={data.page * data.pageSize < data.total}
              onPageChange={setPage}
              mobileCard={(r) => (
                <div className="rounded-lg border p-3 space-y-1" aria-label={`Application from ${r.applicantName ?? "applicant"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.applicantName ?? "—"}</span>
                    <StatusBadge status={r.reviewStatus} />
                  </div>
                  <p className="text-sm text-muted-foreground">{r.company ?? "No company"} · {PATH_LABEL[r.path] ?? r.path}</p>
                  <p className="text-xs text-muted-foreground">Received {fmt(r.receivedAt)} · Terms {r.termsState === "recorded" ? "recorded" : "pending"}</p>
                  <p className="text-xs text-muted-foreground">{ownerText(r)}{r.dueAt ? ` · Due ${fmt(r.dueAt)}` : ""}</p>
                  <Button variant="outline" className="mt-2 min-h-11 w-full" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>Open</Button>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <CrmDetailDrawer open={Boolean(openId)} onOpenChange={(next) => { if (!next) setOpenId(""); }} title="Application" description="Review the application and record a decision.">
        {openId ? <ApplicationDetailBody id={openId} canDecide={canDecide} onChanged={() => void queryClient.invalidateQueries({ queryKey: [listKey] })} /> : null}
      </CrmDetailDrawer>
    </div>
  );
}
