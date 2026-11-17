import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CrmDataState, CrmDataTable, CrmDetailDrawer, type CrmDataColumn } from "@/components/crm/CrmPresentation";
import { apiRequest, parseApiRequestError, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUrlParam } from "@/hooks/use-url-param";
import { BusinessTimeNote, OpenLink, ReviewHistory, contactHref, fmtBusiness, referralsHref, type ReviewHistoryEvent } from "./partner-review-shared";

interface Row {
  id: string; partnerId: number; partnerName: string; businessName: string; contactName: string;
  reviewState: string; reviewReason: string | null; revision: number; completionState: string; completionErrorCode: string | null;
  contactId: number | null; referralId: number | null;
  permissionVersion: string; permissionConfirmedAt: string; createdAt: string;
}
interface Response { rows: Row[]; total: number; page: number; pageSize: number }

type Command = "accept" | "decline" | "resolve_duplicate" | "keep_existing_referrer";
interface Detail {
  introduction: {
    id: string; reviewState: string; reviewReason: string | null; revision: number;
    businessName: string; contactName: string; contactEmail: string | null; contactPhone: string | null; website: string | null; context: string | null;
    submittedAt: string; decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
    permission: { version: string; textSha256: string; confirmedAt: string };
    completion: { state: string; attempts: number; lastAttemptAt: string | null; errorCode: string | null;
      checkpoints: { contact: string | null; referral: string | null; notification: string | null; count: string | null } };
  };
  partner: { id: number; company: string; name: string | null; status: string | null };
  linked: {
    contact: { id: number; name: string; company: string | null; createdByThisIntroduction: boolean } | null;
    referral: { id: number; status: string | null } | null;
  };
  evidence: {
    domain: string | null; businessIds: number[];
    otherContacts: Array<{ id: number; name: string; company: string | null }>;
    otherClaims: Array<{ kind: "referral" | "introduction"; id: string; partnerId: number | null; partnerName: string | null }>;
  };
  history: ReviewHistoryEvent[];
  allowedCommands: Command[];
}

const STATES = [
  { value: "all", label: "All review states" },
  { value: "pending_review", label: "Pending review" },
  { value: "duplicate_review", label: "Duplicate review" },
  { value: "competing_referrer", label: "Competing referrer" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];
const LABEL: Record<string, string> = Object.fromEntries(STATES.filter((s) => s.value !== "all").map((s) => [s.value, s.label]));
const statusLabel = (status: string) => LABEL[status] ?? status;

const REASON_LABEL: Record<string, string> = {
  CONTACT_ALREADY_EXISTS: "A contact with these details already exists",
  SAME_BUSINESS_EVIDENCE: "Another person at this business is already in the CRM",
  ANOTHER_PARTNER_ALREADY_REFERRED: "Another partner already referred this contact",
  ANOTHER_PARTNER_REFERRED_SAME_BUSINESS: "Another partner already introduced this business",
  ACCEPTED_BY_STAFF: "Accepted by staff",
  ACCEPTED_EXISTING_RECORD_KEPT: "Accepted; the existing record was kept",
  DECLINED_BY_STAFF: "Declined by staff",
  DUPLICATE_OF_EXISTING_RECORD: "Closed as a duplicate of an existing record",
  COMPETING_REFERRER_EXISTING_KEPT: "Closed; the existing referrer was kept",
};
const reasonText = (code: string | null) => (code ? REASON_LABEL[code] ?? `Other reason (${code})` : "—");

const COMMAND_LABEL: Record<Command, string> = {
  accept: "Accept this introduction",
  decline: "Decline this introduction",
  resolve_duplicate: "Close as a duplicate of the existing record",
  keep_existing_referrer: "Keep the existing referrer and close this one",
};
const COMMAND_EFFECT: Record<Command, string> = {
  accept: "Records the decision only. No commission, referral or attribution changes.",
  decline: "Records the decision only. The introducer sees that it was not accepted.",
  resolve_duplicate: "Records the decision only. The existing contact is not edited or merged.",
  keep_existing_referrer: "Records the decision only. The other partner's referral and attribution stay as they are.",
};
const DECISION_ERRORS: Record<string, string> = {
  STALE_REVISION: "This introduction changed since you opened it. The latest version is showing; review it and decide again.",
  INTRODUCTION_ALREADY_DECIDED: "This introduction has already been decided.",
  INTRODUCTION_PROCESSING: "This introduction is still being recorded. Try again in a moment.",
  COMMAND_NOT_ALLOWED_FOR_STATE: "That action is not available for the introduction's current state.",
  NOTE_REQUIRED: "A written reason is required.",
  REVISION_REQUIRED: "Reload the introduction and try again.",
};

function completionText(row: { completionState: string; completionErrorCode: string | null }) {
  if (row.completionState === "complete") return "Recorded";
  if (row.completionState === "held") return `Held${row.completionErrorCode ? ` (${row.completionErrorCode})` : ""}`;
  return "Finishing";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function DecisionForm({ detail, onDecided }: { detail: Detail; onDecided: () => void }) {
  const { toast } = useToast();
  const [command, setCommand] = useState<Command | "">("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/partner-introductions/${detail.introduction.id}/decision`, {
        command, expectedRevision: detail.introduction.revision, note: note.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Decision recorded", description: command ? COMMAND_EFFECT[command] : undefined });
      setConfirming(false); setCommand(""); setNote("");
      onDecided();
    },
    onError: (err: Error) => {
      const { code } = parseApiRequestError(err.message);
      setConfirming(false);
      setError((code && DECISION_ERRORS[code]) || "The decision could not be saved. Nothing was changed.");
      if (code === "STALE_REVISION" || code === "INTRODUCTION_ALREADY_DECIDED") onDecided();
    },
  });

  if (detail.allowedCommands.length === 0) {
    const decided = detail.introduction.reviewState === "accepted" || detail.introduction.reviewState === "declined";
    return (
      <section aria-label="Decision" className="space-y-2">
        <h3 className="text-lg font-semibold">Decision</h3>
        <p className="text-sm text-muted-foreground" data-testid="introduction-decision-closed">
          {decided
            ? `${statusLabel(detail.introduction.reviewState)}${detail.introduction.decidedAt ? ` on ${fmtBusiness(detail.introduction.decidedAt)}` : ""}${detail.introduction.decidedByName ? ` by ${detail.introduction.decidedByName}` : ""}.`
            : "This introduction is still being recorded, so no decision can be made yet."}
        </p>
        {detail.introduction.decisionNote ? <p className="whitespace-pre-wrap text-sm text-foreground">{detail.introduction.decisionNote}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Decision" className="space-y-3" data-testid="introduction-decision-form">
      <h3 className="text-lg font-semibold">Decision</h3>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Outcome</legend>
        {detail.allowedCommands.map((value) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="introduction-decision" value={value} checked={command === value} className="h-5 w-5"
              onChange={() => { setCommand(value); setError(null); setConfirming(false); }} data-testid={`introduction-decision-${value}`} />
            {COMMAND_LABEL[value]}
          </label>
        ))}
      </fieldset>
      {command ? <p className="text-xs text-muted-foreground">{COMMAND_EFFECT[command]}</p> : null}
      <div>
        <label htmlFor="introduction-note" className="mb-1 block text-sm font-medium">Reason*</label>
        <Textarea id="introduction-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="introduction-note-input" />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive" data-testid="introduction-decision-error">{error}</p> : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm decision">
          <span className="text-sm text-foreground">{command ? `${COMMAND_LABEL[command]}?` : ""}</span>
          <Button className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate()} data-testid="introduction-decision-confirm">
            {decide.isPending ? "Saving..." : "Confirm"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={decide.isPending} onClick={() => setConfirming(false)}>Back</Button>
        </div>
      ) : (
        <Button className="min-h-11" data-testid="introduction-decision-submit" onClick={() => {
          if (!command) { setError("Choose an outcome."); return; }
          if (!note.trim()) { setError(DECISION_ERRORS.NOTE_REQUIRED); return; }
          setError(null); setConfirming(true);
        }}>Review decision</Button>
      )}
    </section>
  );
}

function IntroductionDetailBody({ id, canDecide, onChanged }: { id: string; canDecide: boolean; onChanged: () => void }) {
  const detailKey = `/api/partner-introductions/${id}`;
  const query = useQuery<Detail>({ queryKey: [detailKey], staleTime: 0 });
  if (query.isLoading) return <CrmDataState state="loading" />;
  if (query.isError || !query.data) return <CrmDataState state="unavailable" message="This introduction could not be loaded." onRetry={() => void query.refetch()} />;
  const d = query.data;
  const i = d.introduction;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [detailKey] }); onChanged(); };
  return (
    <div className="space-y-6" data-testid="introduction-detail">
      <section aria-label="State" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={i.reviewState === "pending_review" ? "secondary" : "outline"}>{statusLabel(i.reviewState)}</Badge>
          <span className="text-sm text-muted-foreground">Submitted {fmtBusiness(i.submittedAt)}</span>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Reason">{reasonText(i.reviewReason)}</Field>
          <Field label="Recording">
            <span data-testid="introduction-completion-state">{completionText({ completionState: i.completion.state, completionErrorCode: i.completion.errorCode })}</span>
            {i.completion.attempts > 0 ? ` (${i.completion.attempts} attempt${i.completion.attempts === 1 ? "" : "s"}${i.completion.lastAttemptAt ? `, last ${fmtBusiness(i.completion.lastAttemptAt)}` : ""})` : ""}
          </Field>
          <Field label="Introduced by">{d.partner.company}{d.partner.name ? ` (${d.partner.name})` : ""}</Field>
          <Field label="Introducer permission">{i.permission.version}, {fmtBusiness(i.permission.confirmedAt)}</Field>
        </dl>
      </section>

      {canDecide ? <DecisionForm detail={d} onDecided={refresh} /> : (
        <section aria-label="Decision" className="space-y-2">
          <h3 className="text-lg font-semibold">Decision</h3>
          <p className="text-sm text-muted-foreground" data-testid="introduction-read-only">Only an administrator can decide an introduction. You can review the details here.</p>
          {i.decisionNote ? <p className="whitespace-pre-wrap text-sm text-foreground">{i.decisionNote}</p> : null}
        </section>
      )}

      <section aria-label="Introduced business" className="space-y-2">
        <h3 className="text-lg font-semibold">Introduced business</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Business">{i.businessName}</Field>
          <Field label="Contact">{i.contactName}</Field>
          <Field label="Email">{i.contactEmail ?? "—"}</Field>
          <Field label="Phone">{i.contactPhone ?? "—"}</Field>
          <Field label="Website">{i.website ?? "—"}</Field>
          <Field label="Context from the partner">{i.context ? <span className="whitespace-pre-wrap">{i.context}</span> : "—"}</Field>
        </dl>
      </section>

      <section aria-label="Linked records" className="space-y-2" data-testid="introduction-linked">
        <h3 className="text-lg font-semibold">Linked records</h3>
        {d.linked.contact ? (
          <div>
            <p className="text-sm">{d.linked.contact.name}{d.linked.contact.company ? `, ${d.linked.contact.company}` : ""}
              {d.linked.contact.createdByThisIntroduction ? " (created by this introduction)" : " (existing contact)"}</p>
            <OpenLink href={contactHref(d.linked.contact.id)} testId="link-open-contact">Open contact #{d.linked.contact.id}</OpenLink>
          </div>
        ) : <p className="text-sm text-muted-foreground">No contact is linked yet.</p>}
        {d.linked.referral ? (
          <div>
            <p className="text-sm">Referral #{d.linked.referral.id}{d.linked.referral.status ? ` (${d.linked.referral.status})` : ""}</p>
            <OpenLink href={referralsHref()} testId="link-open-referral">Open referrals</OpenLink>
          </div>
        ) : <p className="text-sm text-muted-foreground">No referral was created for this introduction.</p>}
      </section>

      <section aria-label="Identity evidence" className="space-y-2" data-testid="introduction-evidence">
        <h3 className="text-lg font-semibold">Identity evidence</h3>
        <p className="text-xs text-muted-foreground">Staff only. Nothing here is merged, moved or shown to partners.</p>
        {d.evidence.domain ? <p className="text-sm">Business domain: <span className="font-mono">{d.evidence.domain}</span></p> : null}
        {d.evidence.otherContacts.length === 0 && d.evidence.otherClaims.length === 0
          ? <p className="text-sm text-muted-foreground">No other contacts or partner claims were found for this business.</p> : null}
        {d.evidence.otherContacts.length > 0 ? (
          <ul className="space-y-1">
            {d.evidence.otherContacts.map((c) => (
              <li key={c.id} className="text-sm">{c.name}{c.company ? `, ${c.company}` : ""} <OpenLink href={contactHref(c.id)}>Open contact #{c.id}</OpenLink></li>
            ))}
          </ul>
        ) : null}
        {d.evidence.otherClaims.length > 0 ? (
          <ul className="space-y-1">
            {d.evidence.otherClaims.map((c) => (
              <li key={`${c.kind}-${c.id}`} className="text-sm">
                {c.kind === "referral" ? "Existing referral" : "Another introduction"} from {c.partnerName ?? (c.partnerId ? `partner #${c.partnerId}` : "an unknown partner")}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <ReviewHistory events={d.history} statusLabel={statusLabel} />
    </div>
  );
}

/**
 * Staff review of partner introductions. Admins and managers read the list and the authorized detail; only an
 * administrator is shown decision controls (the server enforces the same rule). A decision never moves attribution,
 * merges a company or creates a commission. Contact details are in the detail view only, never the list.
 */
export function PartnerIntroductionsReview() {
  const { user } = useAuth();
  const canDecide = user?.role === "admin";
  const [state, setState] = useUrlParam("introState", "all", (raw) => (STATES.some((s) => s.value === raw) ? raw : undefined), { history: "replace" });
  const [page, setPage] = useUrlParam("introPage", 1, (raw) => (/^\d{1,4}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined), { history: "replace" });
  const [openId, setOpenId] = useUrlParam("introduction", "", (raw) => (/^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined), { history: "push" });
  const params = new URLSearchParams();
  if (state !== "all") params.set("reviewState", state);
  params.set("page", String(page));
  params.set("pageSize", "25");
  const key = `/api/partner-introductions?${params.toString()}`;
  const query = useQuery<Response>({ queryKey: [key], staleTime: 0 });
  const data = query.data;

  const columns: CrmDataColumn<Row>[] = [
    { id: "submitted", label: "Submitted", render: (r) => fmtBusiness(r.createdAt) },
    { id: "business", label: "Business", render: (r) => <span className="font-medium">{r.businessName}</span> },
    { id: "contact", label: "Contact", render: (r) => r.contactName },
    { id: "partner", label: "Introduced by", render: (r) => r.partnerName },
    { id: "state", label: "Review state", render: (r) => <Badge variant={r.reviewState === "pending_review" ? "secondary" : "outline"}>{statusLabel(r.reviewState)}</Badge> },
    { id: "recording", label: "Recording", render: (r) => completionText(r) },
    { id: "reason", label: "Reason", render: (r) => reasonText(r.reviewReason) },
    { id: "links", label: "Linked records", render: (r) => [r.contactId ? `Contact #${r.contactId}` : null, r.referralId ? `Referral #${r.referralId}` : null].filter(Boolean).join(" · ") || "None" },
    { id: "open", label: "Open", render: (r) => (
      <Button variant="outline" size="sm" className="min-h-11" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} data-testid={`button-open-introduction-${r.id}`}>Open</Button>
    ) },
  ];

  return (
    <Card data-testid="partner-introductions-review">
      <CardHeader><CardTitle className="text-lg">Introductions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Businesses introduced by approved partners. The permission shown is the partner's statement that the contact agreed to be introduced; it is not the business's own marketing consent.
        </p>
        <label className="block max-w-xs text-xs text-muted-foreground">Review state
          <select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={state}
            onChange={(e) => { setState(e.target.value); setPage(1); }} data-testid="filter-introduction-state">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {query.isLoading ? <CrmDataState state="loading" /> : query.isError || !data ? (
          <CrmDataState state="unavailable" message="Introductions could not be loaded." onRetry={() => void query.refetch()} />
        ) : data.rows.length === 0 ? (
          <CrmDataState state={state === "all" ? "empty" : "no-match"} message={state === "all" ? "No introductions have been submitted yet." : undefined} />
        ) : (
          <CrmDataTable<Row>
            testId="introductions-table"
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
              <div className="space-y-1 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.businessName}</span>
                  <Badge variant="outline">{statusLabel(r.reviewState)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{r.contactName} · introduced by {r.partnerName}</p>
                <p className="text-xs text-muted-foreground">Submitted {fmtBusiness(r.createdAt)} · {completionText(r)}</p>
                {r.reviewReason ? <p className="text-xs text-muted-foreground">{reasonText(r.reviewReason)}</p> : null}
                <Button variant="outline" className="mt-2 min-h-11 w-full" onClick={() => setOpenId(r.id)}>Open</Button>
              </div>
            )}
          />
        )}
        <BusinessTimeNote />
      </CardContent>
      <CrmDetailDrawer open={Boolean(openId)} onOpenChange={(next) => { if (!next) setOpenId(""); }} title="Introduction" description="Review the introduced business and record a decision.">
        {openId ? <IntroductionDetailBody id={openId} canDecide={canDecide} onChanged={() => void queryClient.invalidateQueries({ queryKey: [key] })} /> : null}
      </CrmDetailDrawer>
    </Card>
  );
}
