import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MailCheck } from "lucide-react";
import { apiRequest, queryClient, parseApiRequestError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  describeWebsiteEmailReason, PROGRAM_LABELS, WEBSITE_SOURCE_LABELS, WEBSITE_SOURCE_PROGRAMS,
} from "@/lib/website-email-reasons";

export interface WebsiteEmailStatus {
  generatedAt: string;
  lane: {
    effectiveState: "closed" | "open" | "revoked" | "malformed";
    revision: number | null;
    senderAccount: string | null;
    senderCategory: string | null;
    eligibilityStartsAt: string | null;
    dailyLimit: number | null;
    sourceProgramMap: Record<string, Record<string, number>>;
  };
  sender: { category: string; replyTo: string; replyPathProven: boolean; account: string | null } | null;
  reader: { account: string | null; state: string; lastSuccessAt: string | null; lastError: string | null; hasCursor: boolean; unappliedEvidence: number; freshWithinMs: number };
  ledger: { acceptsGmail: boolean };
  capacity: { used: number; limit: number | null; day: string };
  warmRevisions: Array<{ id: number; program: string; state: string; steps: number; unsupportedSteps: number; sourceSequenceId: number | null; snapshotHash: string; createdAt: string; approvedAt: string | null }>;
  intents: Array<{ program: string; state: string; reason: string | null; count: number }>;
  admissions: Array<{ program: string; state: string; count: number }>;
  receipts: Array<{ outcome: string; count: number }>;
  uncertainReceipts: Array<{ id: number; admissionId: number | null; contactId: number | null; stepOrder: number; createdAt: string }>;
  meaning: Record<string, string>;
}

interface LaneReview { ok: boolean; problems: string[]; currentRevision: number; nextRevision: number; effectiveEligibilityStartsAt: string | null }

export const WEBSITE_EMAIL_STATUS_KEY = ["/api/admin/website-email/status"];

const STATE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default", closed: "secondary", revoked: "destructive", malformed: "destructive",
};

const STATE_TEXT: Record<string, string> = {
  open: "Requests received after the eligible-from time are admitted when their program has an approved revision. Sending still needs outbound unpaused, a proven reply path and a running worker.",
  revoked: "The lane was revoked: admitted journeys were revoked and nothing is sent.",
  malformed: "The stored configuration failed its integrity check, so the lane is treated as closed and nothing is sent.",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const ageOf = (iso: string | null) => {
  if (!iso) return null;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return seconds < 120 ? `${seconds}s ago` : seconds < 7200 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
};

/** Readiness card for the narrow website email lane: read-only facts for admins and managers, explicit controls for admins. */
export function WebsiteEmailLaneCard({ canControl }: { canControl: boolean }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<WebsiteEmailStatus>({ queryKey: WEBSITE_EMAIL_STATUS_KEY, refetchInterval: 30_000 });

  const [status, setStatus] = useState<"closed" | "open" | "revoked">("closed");
  const [senderAccount, setSenderAccount] = useState("");
  const [dailyLimit, setDailyLimit] = useState("0");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [understood, setUnderstood] = useState(false);
  const [review, setReview] = useState<{ key: string; value: LaneReview } | null>(null);
  const [resolving, setResolving] = useState<{ id: number; resolution: "accepted" | "not_sent" } | null>(null);

  const approved = useMemo(() => (data?.warmRevisions ?? []).filter((r) => r.state === "approved" && r.unsupportedSteps === 0), [data]);

  const proposed = useMemo(() => {
    const sourceProgramMap: Record<string, Record<string, number>> = {};
    for (const [key, value] of Object.entries(mapping)) {
      if (!value) continue;
      const [source, program] = key.split("::");
      (sourceProgramMap[source] ??= {})[program] = Number(value);
    }
    return { status, sourceProgramMap, senderAccount: senderAccount.trim() ? senderAccount.trim() : null, dailyLimit: Number.parseInt(dailyLimit, 10) };
  }, [status, mapping, senderAccount, dailyLimit]);
  const proposedKey = JSON.stringify(proposed);
  const currentReview = review && review.key === proposedKey ? review.value : null;

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!Number.isInteger(proposed.dailyLimit)) throw new Error("Enter a whole number for the daily limit.");
      const res = await apiRequest("POST", "/api/admin/website-email/config/preview", proposed);
      return (await res.json()) as LaneReview;
    },
    onSuccess: (value) => setReview({ key: proposedKey, value }),
    onError: (e: Error) => toast({ title: "Could not preview the change", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentReview) throw new Error("Preview this exact configuration first.");
      const res = await apiRequest("POST", "/api/admin/website-email/config", { ...proposed, expectedRevision: currentReview.currentRevision });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lane configuration saved", description: "A new revision was appended. Nothing was sent." });
      setReview(null);
      setUnderstood(false);
      queryClient.invalidateQueries({ queryKey: WEBSITE_EMAIL_STATUS_KEY });
    },
    onError: (e: Error) => {
      const parsed = parseApiRequestError(e.message);
      toast({ title: "Configuration was not saved", description: describeWebsiteEmailReason(parsed.code) || e.message, variant: "destructive" });
      setReview(null);
      queryClient.invalidateQueries({ queryKey: WEBSITE_EMAIL_STATUS_KEY });
    },
  });

  const readerMutation = useMutation({
    mutationFn: async (action: "open" | "close") => (await apiRequest("POST", `/api/admin/website-email/reader/${action}`, {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WEBSITE_EMAIL_STATUS_KEY }),
    onError: (e: Error) => toast({ title: "Reader change failed", description: describeWebsiteEmailReason(parseApiRequestError(e.message).code) || e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async (input: { id: number; resolution: "accepted" | "not_sent" }) =>
      (await apiRequest("POST", `/api/admin/website-email/receipts/${input.id}/resolve`, { resolution: input.resolution })).json(),
    onSuccess: () => { setResolving(null); queryClient.invalidateQueries({ queryKey: WEBSITE_EMAIL_STATUS_KEY }); },
    onError: (e: Error) => { setResolving(null); toast({ title: "Could not resolve the send", description: e.message, variant: "destructive" }); },
  });

  const state = data?.lane.effectiveState ?? "closed";
  const needsAcknowledgement = status === "open";
  const canSave = Boolean(currentReview?.ok) && (!needsAcknowledgement || understood) && !saveMutation.isPending;

  return (
    <Card data-testid="card-website-email-lane">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <MailCheck className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Website email follow-up lane</CardTitle>
          {data && (
            <Badge variant={STATE_VARIANT[state] ?? "outline"} className="text-xs" data-testid="badge-website-lane-state">
              {state === "open" ? "Open" : state === "closed" ? "Closed" : state === "revoked" ? "Revoked" : "Configuration invalid"}
            </Badge>
          )}
        </div>
        <CardDescription>
          First-party email to website leads from the connected Gmail account, in two programs: a requested follow-up and an opted-in nurture.
          It is separate from request receipts, from cold outreach to the recruited list, and from GHL and SMS. It never unpauses outbound.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive" data-testid="text-website-lane-error">Lane status could not be loaded. Nothing is assumed about its state.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="text-website-lane-meaning">{STATE_TEXT[state] ?? data.meaning.closed}</p>

            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="list-website-lane-facts">
              <Fact label="Configuration revision" value={data.lane.revision === null ? "none (default closed)" : String(data.lane.revision)} />
              <Fact label="Sender account" value={data.lane.senderAccount ?? "not selected"} />
              <Fact label="Eligible from" value={data.lane.eligibilityStartsAt ? when(data.lane.eligibilityStartsAt) : "not set"} />
              <Fact label="Daily limit" value={data.lane.dailyLimit === null ? "not set" : String(data.lane.dailyLimit)} />
              <Fact label="Sent or reserved today (UTC)" value={`${data.capacity.used}${data.capacity.limit === null ? "" : ` of ${data.capacity.limit}`}`} testId="text-website-lane-capacity" />
              <Fact
                label="Reply path"
                value={data.sender ? (data.sender.replyPathProven ? `proven (${data.sender.replyTo})` : `not proven (${data.sender.replyTo})`) : "unavailable"}
                testId="text-website-lane-reply-path"
              />
              <Fact
                label="Reply reader"
                value={`${data.reader.state}${data.reader.lastSuccessAt ? `, last success ${ageOf(data.reader.lastSuccessAt)}` : ", no success yet"}`}
                testId="text-website-lane-reader"
              />
              <Fact label="Unmatched reader evidence" value={String(data.reader.unappliedEvidence)} />
              <Fact
                label="Message ledger accepts Gmail"
                value={data.ledger.acceptsGmail ? "yes" : "no (migration 0382 has not reached this database)"}
                testId="text-website-lane-ledger"
              />
            </dl>
            {data.reader.lastError && (
              <p className="text-sm text-destructive" data-testid="text-website-lane-reader-error">Reader error: {data.reader.lastError}</p>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <CountList title="Intents" rows={data.intents.map((r) => ({ key: `${r.program}/${r.state}/${r.reason ?? ""}`, label: `${r.program} · ${r.state}${r.reason ? ` · ${describeWebsiteEmailReason(r.reason)}` : ""}`, count: r.count }))} testId="list-website-lane-intents" />
              <CountList title="Admissions" rows={data.admissions.map((r) => ({ key: `${r.program}/${r.state}`, label: `${r.program} · ${r.state}`, count: r.count }))} testId="list-website-lane-admissions" />
              <CountList title="Send attempts" rows={data.receipts.map((r) => ({ key: r.outcome, label: r.outcome === "accepted" ? "accepted by Gmail (not inbox delivery)" : r.outcome, count: r.count }))} testId="list-website-lane-receipts" />
            </div>

            {data.uncertainReceipts.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-300 p-3" data-testid="section-website-lane-uncertain">
                <p className="text-sm font-medium">Sends with an unknown outcome</p>
                <p className="text-xs text-muted-foreground">{data.meaning.uncertain}</p>
                {data.uncertainReceipts.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>Attempt {r.id}, step {r.stepOrder + 1}, {when(r.createdAt)}</span>
                    {canControl ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => setResolving({ id: r.id, resolution: "not_sent" })} data-testid={`button-resolve-not-sent-${r.id}`}>Not in the mailbox</Button>
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => setResolving({ id: r.id, resolution: "accepted" })} data-testid={`button-resolve-accepted-${r.id}`}>Found in the mailbox</Button>
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Background worker selection and global and channel pauses are on the{" "}
              <Link href="/dashboard/activation" className="underline">Activation panel</Link>. Message content is approved on the{" "}
              <Link href="/dashboard/sequences" className="underline">Sequences page</Link>. Status as of {when(data.generatedAt)}.
            </p>

            {canControl ? (
              <div className="space-y-4 border-t pt-4" data-testid="section-website-lane-controls">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Reply reader</span>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={readerMutation.isPending} onClick={() => readerMutation.mutate("open")} data-testid="button-website-reader-open">Open reader</Button>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={readerMutation.isPending} onClick={() => readerMutation.mutate("close")} data-testid="button-website-reader-close">Close reader</Button>
                  <span className="text-xs text-muted-foreground">Read-only from now on; no history is read and nothing is sent.</span>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Lane configuration</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="website-lane-status">State</Label>
                      <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                        <SelectTrigger id="website-lane-status" className="min-h-11" data-testid="select-website-lane-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="closed">Closed</SelectItem>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="revoked">Revoked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="website-lane-sender">Sender account</Label>
                      <Input id="website-lane-sender" className="min-h-11" value={senderAccount} onChange={(e) => setSenderAccount(e.target.value)} placeholder="accounts@libertybancard.com" data-testid="input-website-lane-sender" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="website-lane-limit">Daily limit</Label>
                      <Input id="website-lane-limit" className="min-h-11" inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} data-testid="input-website-lane-limit" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Approved revisions per source and program{approved.length === 0 ? " (none approved yet: create and approve one on the Sequences page)" : ""}.</p>
                    {Object.entries(WEBSITE_SOURCE_PROGRAMS).map(([source, programs]) => (
                      <div key={source} className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]">
                        <span className="text-sm">{WEBSITE_SOURCE_LABELS[source]}</span>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {programs.map((program) => {
                            const key = `${source}::${program}`;
                            return (
                              <Select key={key} value={mapping[key] ?? "none"} onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v === "none" ? "" : v }))}>
                                <SelectTrigger className="min-h-11" aria-label={`${WEBSITE_SOURCE_LABELS[source]} ${program}`} data-testid={`select-map-${source.split("|")[1]}-${program}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">{program === "nurture" ? "No nurture" : "No follow-up"}</SelectItem>
                                  {approved.filter((r) => r.program === program).map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>Revision {r.id} ({r.steps} step{r.steps === 1 ? "" : "s"})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">{Object.values(PROGRAM_LABELS).join(" ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="min-h-11" disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()} data-testid="button-website-lane-preview">
                      {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Preview change
                    </Button>
                  </div>
                  {currentReview && (
                    <div className={`rounded-md border p-3 text-sm ${currentReview.ok ? "border-emerald-300" : "border-destructive/50"}`} role="status" data-testid="section-website-lane-review">
                      {currentReview.ok ? (
                        <p>This configuration passes every check. Saving appends revision {currentReview.nextRevision}{currentReview.effectiveEligibilityStartsAt ? `; only requests received after ${when(currentReview.effectiveEligibilityStartsAt)} are eligible` : ""}. Saving sends nothing.</p>
                      ) : (
                        <div>
                          <p className="font-medium">Blocked:</p>
                          <ul className="list-disc pl-5" data-testid="list-website-lane-problems">
                            {currentReview.problems.map((p) => <li key={p}>{describeWebsiteEmailReason(p)}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {needsAcknowledgement && (
                    <div className="flex items-start gap-2 min-h-11">
                      <Checkbox id="website-lane-ack" checked={understood} onCheckedChange={(c) => setUnderstood(c === true)} data-testid="checkbox-website-lane-ack" />
                      <Label htmlFor="website-lane-ack" className="text-sm leading-snug">
                        I understand that an open lane lets first-party email go to website leads who requested it or opted in, from the selected account, up to the daily limit, once outbound is unpaused elsewhere.
                      </Label>
                    </div>
                  )}
                  <Button className="min-h-11" disabled={!canSave} onClick={() => saveMutation.mutate()} data-testid="button-website-lane-save">
                    {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save configuration revision
                  </Button>
                </fieldset>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Only an administrator can change the lane or the reader.</p>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog open={resolving !== null} onOpenChange={(o) => { if (!o) setResolving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{resolving?.resolution === "accepted" ? "Record that Gmail accepted this message?" : "Record that this message was not sent?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {resolving?.resolution === "accepted"
                ? "Use this only after finding the sent message in the mailbox. The step is recorded as accepted and is not sent again."
                : "Use this only after confirming the message is not in the mailbox. The same message identity is retried once; it is never sent twice."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => resolving && resolveMutation.mutate(resolving)} data-testid="button-website-resolve-confirm">Record</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right" data-testid={testId}>{value}</dd>
    </div>
  );
}

function CountList({ title, rows, testId }: { title: string; rows: Array<{ key: string; label: string; count: number }>; testId: string }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-sm font-medium">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
        <ul className="space-y-0.5 text-xs">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3"><span className="text-muted-foreground">{r.label}</span><span className="font-mono tabular-nums">{r.count}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Read-only summary for the Activation panel. It reports the lane state and capacity and links to the one place where the
 * lane is configured; it has no control that enables anything.
 */
export function WebsiteEmailLaneSummary() {
  const { data, isLoading, isError } = useQuery<WebsiteEmailStatus>({ queryKey: WEBSITE_EMAIL_STATUS_KEY, refetchInterval: 30_000 });
  const state = data?.lane.effectiveState ?? "closed";
  return (
    <Card data-testid="card-website-email-lane-summary">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <MailCheck className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Website email follow-up lane</CardTitle>
          {data && <Badge variant={STATE_VARIANT[state] ?? "outline"} className="text-xs" data-testid="badge-website-lane-summary-state">{state === "open" ? "Open" : state === "closed" ? "Closed" : state === "revoked" ? "Revoked" : "Configuration invalid"}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : isError || !data ? (
          <p className="text-destructive" data-testid="text-website-lane-summary-error">Lane status could not be loaded; its state is unknown, not closed.</p>
        ) : (
          <p className="text-muted-foreground" data-testid="text-website-lane-summary">
            {STATE_TEXT[state] ?? data.meaning.closed} Sent or reserved today: {data.capacity.used}{data.capacity.limit === null ? "" : ` of ${data.capacity.limit}`}.
            Reply reader: {data.reader.state}.
          </p>
        )}
        <p className="text-muted-foreground">
          This lane has its own configuration and does not use the controls on this tab. Configure or review it on the{" "}
          <Link href="/dashboard/outbound-readiness" className="underline" data-testid="link-website-lane-outbound-readiness">Outbound readiness page</Link>.
        </p>
      </CardContent>
    </Card>
  );
}
