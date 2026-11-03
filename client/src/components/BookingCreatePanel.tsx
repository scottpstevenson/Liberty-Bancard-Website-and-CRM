import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthorizedContactPicker, type ContactChoice } from "@/components/crm/AuthorizedContactPicker";
import {
  OUTCOME_COPY, REASON_COPY, PENDING_PREFIX, errorBody, readPending, writePending, clearPending, purgeOtherScopes,
  type Preview, type Outcome, type PendingCommand,
} from "@/components/BookingCommandPanel";

/**
 * Governed provider booking CREATE. It uses the same authority as the reschedule/cancel panel: an authorized local
 * contact (the server resolves the provider contact; the browser never names it), the same read-only preview and
 * reviewed hash, the same actor-scoped saved command identity, the same writer-disabled refusal and the same
 * read-back. A new booking has no prior provider version, so a null reviewed version is valid here and only here.
 * Preview sends nothing and applying is refused by the server unless the owner enabled the booking writer.
 */
const CREATE_KEY_SUFFIX = "create:new";
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const defaultStart = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
};

export function BookingCreatePanel({ purpose, canExecute, onSettled }: {
  purpose: "sales" | "account"; canExecute: boolean; onSettled: () => void;
}) {
  const { user } = useAuth();
  const [contact, setContact] = useState<ContactChoice | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "execute" | "check" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);

  const scope = useMemo(
    () => user?.id ? `${PENDING_PREFIX}${user.id}:${user.accountVersion ?? 0}:${canExecute ? "x" : "p"}:` : null,
    [user?.id, user?.accountVersion, canExecute],
  );
  const storageKey = scope ? `${scope}${CREATE_KEY_SUFFIX}` : null;

  const reset = () => { setPreview(null); setCommandId(null); setOutcome(null); setNotice(null); };

  // Restore on load and on any actor / permission change; entries of other scopes are removed ; no contact details are saved with the command identity.
  useEffect(() => {
    setPreview(null); setCommandId(null); setOutcome(null); setNotice(null);
    if (!scope || !storageKey) { setPending(null); setContact(null); return; }
    purgeOtherScopes(scope);
    const saved = readPending(storageKey);
    if (saved && saved.operation === "create") {
      setPending(saved);
      if (saved.start) setStart(saved.start);
      setDurationMinutes(saved.durationMinutes);
    } else {
      setPending(null);
    }
  }, [scope, storageKey]);

  const requestBody = () => {
    const startMs = new Date(start).getTime();
    const minutes = Number(durationMinutes);
    return {
      operation: "create", purpose, contactId: contact?.id, title: title.trim().slice(0, 120),
      startTime: Number.isFinite(startMs) ? new Date(startMs).toISOString() : "",
      endTime: Number.isFinite(startMs) && minutes > 0 ? new Date(startMs + minutes * 60000).toISOString() : "",
    };
  };

  const checkSaved = useCallback(async () => {
    if (!pending || !storageKey) return;
    setBusy("check"); setNotice(null);
    try {
      const res = await apiRequest("GET", `/api/appointments/booking/command/${pending.commandId}`);
      const body = await res.json() as { state: string; appointmentId?: string | null; provider?: { checked?: boolean } };
      if (body.state === "unknown") {
        setNotice({ tone: "info", text: "Still unknown. The provider may have created the appointment. It is not retried automatically; check the provider calendar before creating another." });
        return;
      }
      clearPending(storageKey); setPending(null);
      setOutcome({ state: body.state === "accepted" ? "unconfirmed" : body.state, reason: body.state === "accepted" ? "saved_command_accepted_check_provider_record" : undefined });
      onSettled();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (/^404:/.test(text)) {
        clearPending(storageKey); setPending(null);
        setNotice({ tone: "info", text: "No record of that command exists, so nothing was created. You can preview again." });
      } else {
        setNotice({ tone: "error", text: "The saved command could not be checked right now. It is kept; try again." });
      }
    } finally { setBusy(null); }
  }, [pending, storageKey, onSettled]);

  const runPreview = async () => {
    if (!contact) { setNotice({ tone: "error", text: REASON_COPY.local_contact_required }); return; }
    setBusy("preview"); setOutcome(null); setNotice(null);
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/preview", requestBody());
      setPreview((await res.json()) as Preview);
      // One command identity per reviewed request: a retry of the same execute reuses it, a new preview mints a new one.
      setCommandId(crypto.randomUUID());
    } catch (error) {
      const body = errorBody(error);
      setPreview(null);
      const reason = body.reason ? (REASON_COPY[body.reason] ?? body.reason) : (body.message ?? "unavailable");
      setNotice({ tone: "error", text: `Preview failed: ${reason}. Nothing was created or sent.` });
    } finally { setBusy(null); }
  };

  const runExecute = async () => {
    if (!preview || !commandId || !contact) return;
    setBusy("execute"); setNotice(null);
    // Saved BEFORE the request: a reload or lost response can never lose an unresolved create.
    const saved: PendingCommand = {
      commandId, operation: "create", payloadHash: preview.payloadHash, expectedVersion: null, start, durationMinutes, savedAt: Date.now(),
    };
    if (storageKey) writePending(storageKey, saved);
    const settle = (state: string | undefined) => {
      if (state === "confirmed" || state === "refused" || state === "denied") { if (storageKey) clearPending(storageKey); setPending(null); }
      else setPending(saved);
    };
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/execute", { ...requestBody(), commandId, payloadHash: preview.payloadHash, expectedVersion: null });
      const result = (await res.json()) as Outcome;
      setOutcome(result); settle(result.state);
      onSettled();
    } catch (error) {
      const body = errorBody(error);
      if (body.state === "denied" || body.reason) { setOutcome({ state: body.state ?? "denied", reason: body.reason }); settle(body.state ?? "denied"); }
      else { settle(undefined); setNotice({ tone: "error", text: "The command status could not be read. It may or may not have run; check the provider calendar before creating another." }); }
      onSettled();
    } finally { setBusy(null); }
  };

  const formInvalid = !contact || !title.trim() || !start || !(Number(durationMinutes) >= 5 && Number(durationMinutes) <= 480);

  return (
    <section className="space-y-3" aria-labelledby="booking-create-h" data-testid="booking-create-panel">
      <h3 id="booking-create-h" className="text-sm font-semibold">Create an appointment in the {purpose} provider calendar</h3>
      <p className="text-xs text-muted-foreground">
        Preview is read-only and sends nothing. {canExecute ? "Creating is refused unless the booking writer is enabled." : "Only an administrator can create."}
        {" "}The contact is not notified by this command. Times are in {timeZone()}.
      </p>
      {pending && (
        <div className="rounded-md border p-3 text-sm space-y-2" role="status" data-testid="booking-create-pending-saved">
          <p className="font-medium">A previous create has no confirmed result.</p>
          <p className="text-xs text-muted-foreground">Check the saved result before creating another. Nothing is sent by checking.</p>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void checkSaved()} data-testid="button-booking-create-check-saved">
            {busy === "check" ? "Checking…" : "Check saved result"}
          </Button>
        </div>
      )}
      <div className="space-y-1">
        <Label>Contact</Label>
        <AuthorizedContactPicker value={contact} onSelect={value => { setContact(value); reset(); }} testId="booking-create-contact" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="booking-create-title">Title</Label>
        <Input id="booking-create-title" value={title} maxLength={120} onChange={e => { setTitle(e.target.value); reset(); }} data-testid="booking-create-title" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor="booking-create-start">Start</Label>
          <Input id="booking-create-start" type="datetime-local" value={start} onChange={e => { setStart(e.target.value); reset(); }} data-testid="booking-create-start" /></div>
        <div className="space-y-1"><Label htmlFor="booking-create-duration">Minutes</Label>
          <Input id="booking-create-duration" type="number" min={5} max={480} value={durationMinutes} onChange={e => { setDurationMinutes(e.target.value); reset(); }} data-testid="booking-create-duration" /></div>
      </div>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null || pending !== null || formInvalid} onClick={() => void runPreview()} data-testid="button-booking-create-preview">
        {busy === "preview" ? "Reviewing…" : "Preview appointment"}
      </Button>
      {preview && (
        <div className="rounded-md border p-3 text-sm space-y-2" role="status" data-testid="booking-create-preview-result">
          <p className="font-medium">Create reviewed</p>
          {preview.payload?.startTime && <p className="text-xs">Start: {new Date(preview.payload.startTime).toLocaleString()} ({timeZone()}), {preview.payload.startTime} UTC</p>}
          <p className="text-xs text-muted-foreground">{preview.note ?? "Preview only. Nothing was booked or sent."}</p>
          {canExecute ? (
            <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => void runExecute()} data-testid="button-booking-create-execute">
              {busy === "execute" ? "Creating…" : "Create appointment"}
            </Button>
          ) : <p className="text-xs text-muted-foreground" data-testid="booking-create-execute-denied">Creating is available to administrators only.</p>}
        </div>
      )}
      {outcome && (
        <div className="rounded-md border p-3 text-sm" role="status" data-testid={`booking-create-outcome-${outcome.state}`}>
          <p className="font-medium">{OUTCOME_COPY[outcome.state] ?? `Result: ${outcome.state}`}</p>
          {outcome.reason && <p className="text-xs text-muted-foreground">{REASON_COPY[outcome.reason] ?? outcome.reason}</p>}
        </div>
      )}
      {notice && <p role="alert" className="text-sm" data-testid="booking-create-notice">{notice.text}</p>}
    </section>
  );
}
