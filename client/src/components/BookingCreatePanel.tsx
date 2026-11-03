import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveZonedWallTime, ZONED_REASON_COPY } from "@/lib/zoned-time";
import { AuthorizedContactPicker, type ContactChoice } from "@/components/crm/AuthorizedContactPicker";
import {
  OUTCOME_COPY, REASON_COPY, reasonText, PENDING_PREFIX, errorBody, readPending, writePending, clearPending, purgeOtherScopes, PendingRecovery,
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
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const ZONES = Array.from(new Set([browserZone(), "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"]));
const NOTIFY_COPY: Record<string, string> = {
  contact_not_notified: "The contact is not notified by this command (server-owned). Any native follow-up is a separate effect.",
  contact_notified: "The contact would be notified by the provider.",
};
const defaultStart = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
};

export function BookingCreatePanel({ purpose: initialPurpose, canExecute, onSettled }: {
  purpose: "sales" | "account"; canExecute: boolean; onSettled: () => void;
}) {
  const [purpose, setPurpose] = useState<"sales" | "account">(initialPurpose);
  const [zone, setZone] = useState(browserZone());
  const { user } = useAuth();
  const [contact, setContact] = useState<ContactChoice | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [occurrence, setOccurrence] = useState<"first" | "second" | "">("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "execute" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);

  const scope = useMemo(() => user?.id ? `${PENDING_PREFIX}${user.id}:` : null, [user?.id]);
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

  const repeatedTime = useMemo(() => { const r = resolveZonedWallTime(start, zone); return !r.ok && r.reason === "ambiguous_local_time"; }, [start, zone]);
  const timeResolution = useMemo(() => resolveZonedWallTime(start, zone, occurrence || undefined), [start, zone, occurrence]);
  const requestBody = () => {
    // The wall time is read in the explicitly chosen IANA zone; the payload carries UTC only.
    const startMs = timeResolution.ok ? timeResolution.ms : NaN;
    const minutes = Number(durationMinutes);
    return {
      operation: "create", purpose, displayTimezone: zone, contactId: contact?.id, title: title.trim().slice(0, 120),
      startTime: Number.isFinite(startMs) ? new Date(startMs).toISOString() : "",
      endTime: Number.isFinite(startMs) && minutes > 0 ? new Date(startMs + minutes * 60000).toISOString() : "",
    };
  };

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
      const reason = body.reason ? reasonText(body.reason) : (body.message ?? "unavailable");
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
    if (!storageKey || !writePending(storageKey, saved)) {
      setBusy(null); setNotice({ tone: "error", text: "This browser cannot save the recovery record for this command, so nothing was sent. Allow site storage and try again." }); return;
    }
    const settle = (state: string | undefined) => {
      if (state === "confirmed" || state === "refused" || state === "denied") { clearPending(storageKey); setPending(null); }
      else setPending(saved);
    };
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/execute", { ...requestBody(), commandId, payloadHash: preview.payloadHash, expectedVersion: null });
      const result = (await res.json()) as Outcome;
      setOutcome(result); settle(result.state);
      onSettled();
    } catch (error) {
      const body = errorBody(error);
      if (body.reason === "unresolved_prior_create" && body.blockingCommandId && storageKey) {
        // The server knows an earlier create is unresolved even if this browser lost it: adopt it so it can be checked.
        const adopted: PendingCommand = { commandId: body.blockingCommandId, operation: "create", payloadHash: "", expectedVersion: null, start, durationMinutes, savedAt: Date.now() };
        writePending(storageKey, adopted); setPending(adopted); setOutcome({ state: "denied", reason: body.reason });
      }
      else if (body.state === "denied" || body.reason) { setOutcome({ state: body.state ?? "denied", reason: body.reason }); settle(body.state ?? "denied"); }
      else { settle(undefined); setNotice({ tone: "error", text: "The command status could not be read. It may or may not have run; check the provider calendar before creating another." }); }
      onSettled();
    } finally { setBusy(null); }
  };

  const formInvalid = !contact || !title.trim() || !start || !timeResolution.ok || !(Number(durationMinutes) >= 5 && Number(durationMinutes) <= 480);

  return (
    <section className="space-y-3" aria-labelledby="booking-create-h" data-testid="booking-create-panel">
      <h3 id="booking-create-h" className="text-sm font-semibold">Create an appointment in the {purpose} provider calendar</h3>
      <p className="text-xs text-muted-foreground">
        Preview is read-only and sends nothing. {canExecute ? "Creating is refused unless the booking writer is enabled." : "Only an administrator can create."}
        {" "}The contact is not notified by this command. Times are read in the zone you choose and sent as UTC.
      </p>
      {pending && storageKey && (
        <PendingRecovery pending={pending} storageKey={storageKey} canResolve={canExecute} testPrefix="booking-create" label="A previous create"
          onCleared={(o) => { setPending(null); if (o) setOutcome(o); onSettled(); }} />
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor="booking-create-purpose">Purpose</Label>
          <select id="booking-create-purpose" className="min-h-11 w-full rounded-md border bg-background px-2 text-sm" value={purpose}
            onChange={e => { setPurpose(e.target.value === "account" ? "account" : "sales"); reset(); }} data-testid="booking-create-purpose">
            <option value="sales">Sales</option><option value="account">Account</option>
          </select></div>
        <div className="space-y-1"><Label htmlFor="booking-create-zone">Time zone</Label>
          <select id="booking-create-zone" className="min-h-11 w-full rounded-md border bg-background px-2 text-sm" value={zone}
            onChange={e => { setZone(e.target.value); setOccurrence(""); reset(); }} data-testid="booking-create-zone">
            {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
          </select></div>
      </div>
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
          <Input id="booking-create-start" type="datetime-local" value={start} onChange={e => { setStart(e.target.value); setOccurrence(""); reset(); }} data-testid="booking-create-start" /></div>
        <div className="space-y-1"><Label htmlFor="booking-create-duration">Minutes</Label>
          <Input id="booking-create-duration" type="number" min={5} max={480} value={durationMinutes} onChange={e => { setDurationMinutes(e.target.value); reset(); }} data-testid="booking-create-duration" /></div>
      </div>
      {!timeResolution.ok && start && !(repeatedTime && timeResolution.reason === "ambiguous_local_time" && !occurrence) && (
        <p role="alert" className="text-xs text-destructive" data-testid="booking-create-time-error">{ZONED_REASON_COPY[timeResolution.reason]}</p>
      )}
      {repeatedTime && (
        <div className="space-y-1" data-testid="booking-create-occurrence">
          <Label htmlFor="booking-create-occurrence-select">Repeated hour</Label>
          <select id="booking-create-occurrence-select" className="min-h-11 w-full rounded-md border bg-background px-2 text-sm" value={occurrence}
            onChange={e => { setOccurrence(e.target.value === "second" ? "second" : e.target.value === "first" ? "first" : ""); reset(); }} data-testid="booking-create-occurrence-select">
            <option value="">Choose…</option>
            <option value="first">First time (before the clocks change)</option>
            <option value="second">Second time (after the clocks change)</option>
          </select>
        </div>
      )}
      {timeResolution.ok && timeResolution.ambiguous && (
        <p className="text-xs text-muted-foreground" data-testid="booking-create-occurrence-chosen">Repeated local time: using the {occurrence} occurrence (UTC{timeResolution.offsetMinutes < 0 ? "-" : "+"}{Math.abs(timeResolution.offsetMinutes / 60)}).</p>
      )}
      <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null || pending !== null || formInvalid} onClick={() => void runPreview()} data-testid="button-booking-create-preview">
        {busy === "preview" ? "Reviewing…" : "Preview appointment"}
      </Button>
      {preview && (
        <div className="rounded-md border p-3 text-sm space-y-2" role="status" data-testid="booking-create-preview-result">
          <p className="font-medium">Create reviewed</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="booking-create-preview-detail">
            <dt className="text-muted-foreground">Recipient</dt><dd>{contact?.name ?? "Selected contact"}</dd>
            <dt className="text-muted-foreground">Operation</dt><dd>Create</dd>
            <dt className="text-muted-foreground">Purpose</dt><dd>{preview.context?.purpose === "account" ? "Account" : "Sales"}</dd>
            <dt className="text-muted-foreground">Calendar</dt><dd>{preview.context?.calendarRef ?? "Resolved by the server"} (read only)</dd>
            {preview.payload?.title && (<><dt className="text-muted-foreground">Title</dt><dd>{preview.payload.title}</dd></>)}
            {preview.payload?.startTime && (<><dt className="text-muted-foreground">Start</dt><dd>{new Date(preview.payload.startTime).toLocaleString("en-US", { timeZone: preview.context?.displayTimezone ?? zone })} ({preview.context?.displayTimezone ?? zone}) = {preview.payload.startTime} UTC</dd></>)}
            {preview.payload?.endTime && (<><dt className="text-muted-foreground">End</dt><dd>{preview.payload.endTime} UTC</dd></>)}
            <dt className="text-muted-foreground">Calendar slot</dt>
            <dd>{preview.context?.calendarConfig?.available ? `${preview.context.calendarConfig.slotMinutes} minutes configured` : `Not available from the calendar (${preview.context?.calendarConfig?.reason ?? "unknown"}); the length you entered is used`}</dd>
            <dt className="text-muted-foreground">Notification</dt><dd>{NOTIFY_COPY[preview.context?.notificationPolicy ?? ""] ?? "Server-owned"}</dd>
            <dt className="text-muted-foreground">Revision</dt><dd className="font-mono">{preview.context?.revision ?? preview.payloadHash.slice(0, 12)}</dd>
          </dl>
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
          {outcome.reason && <p className="text-xs text-muted-foreground">{reasonText(outcome.reason)}</p>}
        </div>
      )}
      {notice && <p role="alert" className="text-sm" data-testid="booking-create-notice">{notice.text}</p>}
    </section>
  );
}
