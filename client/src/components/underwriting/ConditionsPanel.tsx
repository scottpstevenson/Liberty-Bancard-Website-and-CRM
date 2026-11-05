/**
 * In-context underwriting conditions + merchant chase panel (Stage 5 / R07).
 *
 * Shows the conditions for one deal, the durable state of the merchant chase email and the preserved history of
 * each condition. Waive / reverse / supersede require a reason. A chase whose outcome is unknown ("held") is read-only:
 * the message may already have reached the merchant, so there is no resend control here.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Condition {
  id: number; conditionType: string; description: string; status: "pending" | "submitted" | "approved" | "waived";
  merchantVisible: boolean; waivedReason: string | null; reversalReason: string | null;
  supersededAt: string | null; supersededReason: string | null; dueDate: string | null;
}
interface ChaseState {
  status: string; state: "owed" | "sent" | "held_unknown_outcome" | "not_applicable"; attempts: number; reason: string | null;
  lastAttemptAt: string | null; sentAt: string | null; hasRecipient: boolean;
}
interface HistoryEntry { id: number; actorId: string | null; action: string; at: string; details: Record<string, unknown> | null }

type Reasoned = { kind: "waive" | "reverse" | "supersede"; condition: Condition } | null;

const CHASE_COPY: Record<ChaseState["state"], string> = {
  owed: "Owed — not sent yet. It is delivered automatically when sending is allowed.",
  sent: "Sent to the merchant.",
  held_unknown_outcome: "Held — an earlier send may have reached the merchant. It is not resent from here; check the mailbox before acting.",
  not_applicable: "Nothing outstanding for the merchant.",
};

const reasonCopy = (r: string | null) => {
  if (!r) return null;
  if (r.startsWith("paused:")) return "Waiting for sending to be allowed";
  if (r === "coordinator_hold") return "Waiting for the sending queue";
  if (r === "smtp_not_configured") return "Email sending is not configured";
  if (r.startsWith("unsent:")) return "The provider refused it; it will be retried";
  if (r.startsWith("unknown_outcome:")) return "Provider result was not confirmed";
  if (r === "no_recipient") return "No merchant email on file";
  return null;
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

export function ConditionsPanel({ dealId }: { dealId: number }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const role = (user as { role?: string } | undefined)?.role;
  const canWaive = role === "admin" || role === "manager";
  const canSupersede = role === "admin";
  const condKey = [`/api/underwriting/deals/${dealId}/conditions`, "all"];
  const chaseKey = [`/api/underwriting/deals/${dealId}/conditions/chase`];

  const conditions = useQuery<{ conditions: Condition[] }>({
    queryKey: condKey,
    queryFn: async () => {
      const r = await fetch(`/api/underwriting/deals/${dealId}/conditions?includeSuperseded=1`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });
  const chase = useQuery<{ chase: ChaseState | null }>({ queryKey: chaseKey });

  const [reasoned, setReasoned] = useState<Reasoned>(null);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<Condition | null>(null);
  const [newType, setNewType] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const history = useQuery<{ history: HistoryEntry[] }>({
    queryKey: [`/api/underwriting/conditions/${historyFor?.id}/history`],
    enabled: !!historyFor,
  });

  const refresh = () => {
    void conditions.refetch(); void chase.refetch();
    queryClient.invalidateQueries({ queryKey: [`/api/underwriting/conditions`] });
  };
  const onError = (err: unknown) => toast({ title: "Not changed", description: err instanceof Error ? err.message : "The change was refused.", variant: "destructive" });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => apiRequest("PATCH", `/api/underwriting/conditions/${id}`, body),
    onSuccess: () => { setReasoned(null); setReason(""); refresh(); },
    onError,
  });
  const supersede = useMutation({
    mutationFn: ({ id, why }: { id: number; why: string }) => apiRequest("DELETE", `/api/underwriting/conditions/${id}`, { reason: why }),
    onSuccess: () => { setReasoned(null); setReason(""); refresh(); },
    onError,
  });
  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/underwriting/deals/${dealId}/conditions`, { conditionType: newType.trim(), description: newDesc.trim() }),
    onSuccess: () => { setNewType(""); setNewDesc(""); refresh(); toast({ title: "Condition added", description: "The merchant chase will include it." }); },
    onError,
  });
  const retryChase = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/underwriting/deals/${dealId}/conditions/chase`)).json(),
    onSuccess: (r: { sent?: number; attempted?: number }) => { refresh(); toast({ title: r.sent ? "Chase sent" : "Chase not sent", description: r.sent ? "The merchant was emailed." : "Nothing was sent: it is held, not owed, or sending is not allowed right now." }); },
    onError,
  });

  function submitReason() {
    if (!reasoned) return;
    const text = reason.trim();
    if (text.length < 3) return;
    if (reasoned.kind === "waive") patch.mutate({ id: reasoned.condition.id, body: { status: "waived", waivedReason: text } });
    else if (reasoned.kind === "reverse") patch.mutate({ id: reasoned.condition.id, body: { status: "pending", reversalReason: text } });
    else supersede.mutate({ id: reasoned.condition.id, why: text });
  }

  const rows = conditions.data?.conditions ?? [];
  const active = rows.filter((c) => !c.supersededAt);
  const superseded = rows.filter((c) => c.supersededAt);
  const ch = chase.data?.chase ?? null;

  return (
    <section className="mt-3 rounded-lg border p-3 space-y-3" aria-label={`Conditions for deal ${dealId}`} data-testid={`panel-conditions-${dealId}`}>
      <div>
        <h4 className="text-sm font-semibold">Merchant chase</h4>
        {chase.isError ? <CrmDataState state="unavailable" message="Chase state could not be read." onRetry={() => void chase.refetch()} />
          : chase.isLoading ? <p className="text-xs text-muted-foreground" role="status">Loading…</p>
          : !ch ? <p className="text-xs text-muted-foreground" data-testid={`text-chase-none-${dealId}`}>No chase has been recorded for this deal.</p>
          : (
            <div className="text-xs space-y-1" data-testid={`text-chase-${dealId}`}>
              <p><Badge variant={ch.state === "held_unknown_outcome" ? "destructive" : "secondary"} data-testid={`badge-chase-${dealId}`}>{ch.state.replace(/_/g, " ")}</Badge> <span>{CHASE_COPY[ch.state]}</span></p>
              <p className="text-muted-foreground">Attempts {ch.attempts} · last attempt {fmt(ch.lastAttemptAt)} · sent {fmt(ch.sentAt)}{reasonCopy(ch.reason) ? ` · ${reasonCopy(ch.reason)}` : ""}</p>
              {ch.state === "owed" && (
                <Button size="sm" variant="outline" className="min-h-[44px]" disabled={retryChase.isPending} onClick={() => retryChase.mutate()} data-testid={`button-chase-retry-${dealId}`}>
                  Retry owed chase now
                </Button>
              )}
            </div>
          )}
      </div>

      <div>
        <h4 className="text-sm font-semibold">Conditions</h4>
        {conditions.isError ? <CrmDataState state="unavailable" message="Conditions could not be read." onRetry={() => void conditions.refetch()} />
          : conditions.isLoading ? <p className="text-xs text-muted-foreground" role="status">Loading…</p>
          : active.length === 0 ? <p className="text-xs text-muted-foreground">No conditions on this deal.</p>
          : (
            <ul className="space-y-2">
              {active.map((c) => (
                <li key={c.id} className="rounded border p-2 text-xs" data-testid={`condition-${c.id}`}>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <span className="min-w-0"><strong>{c.conditionType.replace(/_/g, " ")}</strong> <Badge variant="outline">{c.status}</Badge>{!c.merchantVisible && <span className="ml-1 text-muted-foreground">(internal)</span>}</span>
                    <span className="flex flex-wrap gap-1">
                      {c.status === "pending" && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => patch.mutate({ id: c.id, body: { status: "submitted" } })} data-testid={`button-cond-submit-${c.id}`}>Mark submitted</Button>}
                      {c.status === "submitted" && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => patch.mutate({ id: c.id, body: { status: "approved" } })} data-testid={`button-cond-approve-${c.id}`}>Approve</Button>}
                      {canWaive && (c.status === "pending" || c.status === "submitted") && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => { setReasoned({ kind: "waive", condition: c }); setReason(""); }} data-testid={`button-cond-waive-${c.id}`}>Waive…</Button>}
                      {c.status !== "pending" && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => { setReasoned({ kind: "reverse", condition: c }); setReason(""); }} data-testid={`button-cond-reverse-${c.id}`}>Reverse…</Button>}
                      {canSupersede && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => { setReasoned({ kind: "supersede", condition: c }); setReason(""); }} data-testid={`button-cond-supersede-${c.id}`}>Supersede…</Button>}
                      <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setHistoryFor(c)} data-testid={`button-cond-history-${c.id}`}>History</Button>
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{c.description}</p>
                  {c.status === "waived" && c.waivedReason && <p className="mt-1">Waived: {c.waivedReason}</p>}
                  {c.reversalReason && c.status === "pending" && <p className="mt-1">Reversed: {c.reversalReason}</p>}
                </li>
              ))}
            </ul>
          )}
        {superseded.length > 0 && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">{superseded.length} superseded (kept as history)</summary>
            <ul className="mt-1 space-y-1">{superseded.map((c) => <li key={c.id} className="text-muted-foreground">{c.conditionType.replace(/_/g, " ")} — {c.supersededReason ?? "no reason recorded"}</li>)}</ul>
          </details>
        )}
      </div>

      <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-end" onSubmit={(e) => { e.preventDefault(); if (newType.trim() && newDesc.trim()) add.mutate(); }}>
        <div><Label htmlFor={`cond-type-${dealId}`} className="text-xs">New condition type</Label><Input id={`cond-type-${dealId}`} value={newType} onChange={(e) => setNewType(e.target.value)} maxLength={80} data-testid={`input-cond-type-${dealId}`} /></div>
        <div><Label htmlFor={`cond-desc-${dealId}`} className="text-xs">What the merchant must provide</Label><Input id={`cond-desc-${dealId}`} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} maxLength={2000} data-testid={`input-cond-desc-${dealId}`} /></div>
        <Button type="submit" size="sm" className="min-h-[44px]" disabled={add.isPending || !newType.trim() || !newDesc.trim()} data-testid={`button-cond-add-${dealId}`}>Add condition</Button>
      </form>

      <Dialog open={!!reasoned} onOpenChange={(o) => { if (!o) { setReasoned(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{reasoned?.kind === "waive" ? "Waive condition" : reasoned?.kind === "reverse" ? "Reverse to pending" : "Supersede condition"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {reasoned?.kind === "supersede" ? "The condition stays on record as superseded; nothing is deleted." : "The earlier outcome stays in the condition history."} A reason is required.
          </p>
          <Label htmlFor="cond-reason">Reason</Label>
          <Textarea id="cond-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="input-cond-reason" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="min-h-[44px]" onClick={() => { setReasoned(null); setReason(""); }}>Cancel</Button>
            <Button className="min-h-[44px]" disabled={reason.trim().length < 3 || patch.isPending || supersede.isPending} onClick={submitReason} data-testid="button-cond-reason-confirm">Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyFor} onOpenChange={(o) => { if (!o) setHistoryFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Condition history</DialogTitle></DialogHeader>
          {history.isError ? <CrmDataState state="unavailable" message="History could not be read." onRetry={() => void history.refetch()} />
            : history.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading…</p>
            : (history.data?.history ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No history recorded.</p>
            : (
              <ul className="space-y-2 text-xs max-h-80 overflow-y-auto" data-testid="list-cond-history">
                {history.data!.history.map((h) => (
                  <li key={h.id} className="rounded border p-2"><strong>{h.action.replace(/^underwriting_condition_/, "").replace(/_/g, " ")}</strong> · {fmt(h.at)}<br /><span className="text-muted-foreground">By {h.actorId ?? "system"}</span></li>
                ))}
              </ul>
            )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
