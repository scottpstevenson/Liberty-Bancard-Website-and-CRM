import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Governed provider booking command for one existing appointment (reschedule / cancel). Preview is read-only. Execute is
 * admin-only and refused by the server unless the owner has enabled the booking writer, so by default it is DENIED; the
 * panel shows the server's refusal instead of hiding the control. The browser never chooses notification or slot-validation
 * behavior and never names the provider contact: the server resolves it from the local contact.
 */
export interface Preview { operation: string; payloadHash: string; currentVersion: number | null; note?: string; payload?: { startTime?: string; endTime?: string; title?: string };
  context?: { purpose: "sales" | "account"; calendarRef: string | null; displayTimezone: string | null; notificationPolicy: string; revision: string; calendarConfig?: { available: boolean; slotMinutes?: number; reason?: string } } }
export type Outcome = { state: string; reason?: string; appointmentId?: string; replay?: boolean; blockingCommandId?: string };

/** Reason copy; `<purpose>_calendar_unavailable:<why>` is explicit and never falls back to another calendar. */
export function reasonText(reason: string | undefined): string {
  if (!reason) return "";
  const m = /^(sales|account)_calendar_unavailable(?::(.*))?$/.exec(reason);
  if (m) return `The ${m[1]} calendar is not available${m[2] ? ` (${m[2]})` : ""}. Nothing falls back to another calendar.`;
  return REASON_COPY[reason] ?? reason;
}

export const OUTCOME_COPY: Record<string, string> = {
  confirmed: "Confirmed: the provider record matches the reviewed change.",
  unconfirmed: "Unconfirmed: the provider accepted it but the read-back did not match. Check the provider calendar before trying again.",
  unknown: "Unknown: the provider may have processed it. It is not retried automatically; check the provider calendar.",
  refused: "Refused by the provider. Nothing changed.",
  denied: "Denied before any provider call. Nothing changed.",
};

export const REASON_COPY: Record<string, string> = {
  booking_writer_not_enabled: "The booking writer is not enabled for this deployment, so no provider change can be made from here.",
  expected_version_required: "The reviewed appointment version is missing. Preview again.",
  payload_changed_since_preview: "The request changed since the preview. Preview again.",
  saved_command_accepted_check_provider_record: "The saved command was recorded as accepted by the provider. Confirm the appointment time in the provider calendar.",
  command_id_bound_to_different_request: "This command id was already used for a different request. Preview again.",
  unresolved_prior_create: "An earlier create from your account has no confirmed result. Resolve it below before creating another appointment.",
  intent_record_unavailable: "The reviewed request could not be recorded, so nothing was sent. Try again.",
  local_contact_required: "Choose a contact from the authorized contact search. A new appointment cannot be created without one.",
  local_contact_not_found: "That contact no longer exists. Choose another contact.",
  local_contact_not_linked_to_provider: "That contact is not linked to the provider calendar system, so an appointment cannot be created for it from here.",
};

/**
 * An unresolved command is remembered (with no expiry) so a reload cannot lose it and a new preview cannot mint a
 * replacement for the same intent. It is released only by a refusal, an exact provider confirmation, or an explicit recorded
 * resolution; a 404 means "not observed" and never releases it. The server independently blocks replacement creates. Only the command identity and the reviewed numbers are stored: never contact details, provider ids of people,
 * tokens or the payload. The key is scoped to the actor and appointment; another actor never sees it and any entry of
 * another actor is removed.
 */
export const PENDING_PREFIX = "liberty.booking-command.v1:";
export interface PendingCommand { commandId: string; operation: "create" | "reschedule" | "cancel"; payloadHash: string; expectedVersion: number | null; start: string; durationMinutes: string; savedAt: number }
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readPending(key: string): PendingCommand | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingCommand>;
    const valid = typeof value.commandId === "string" && UUID_V4.test(value.commandId)
      && (value.operation === "create" || value.operation === "reschedule" || value.operation === "cancel") && typeof value.payloadHash === "string"
      && typeof value.savedAt === "number";
    if (!valid) { window.localStorage.removeItem(key); return null; }
    return { commandId: value.commandId!, operation: value.operation!, payloadHash: value.payloadHash!, expectedVersion: typeof value.expectedVersion === "number" ? value.expectedVersion : null,
      start: typeof value.start === "string" ? value.start : "", durationMinutes: typeof value.durationMinutes === "string" ? value.durationMinutes : "30", savedAt: value.savedAt! };
  } catch { return null; }
}
/** Returns false when the record could not be saved; callers must then NOT send (an unrecoverable command is never started). */
export const writePending = (key: string, value: PendingCommand): boolean => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return window.localStorage.getItem(key) !== null; } catch { return false; }
};
export const clearPending = (key: string) => { try { window.localStorage.removeItem(key); } catch { /* ignore */ } };
export function purgeOtherScopes(currentScope: string) {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PENDING_PREFIX) && !k.startsWith(currentScope)) window.localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

export const errorBody = (error: unknown): { message?: string; reason?: string; state?: string; blockingCommandId?: string } => {
  const text = error instanceof Error ? error.message : String(error);
  const json = text.replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(json); } catch { return { message: text }; }
};

export const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function BookingCommandPanel({ appointmentId, contactId, title, purpose, startTime, endTime, canExecute, onSettled }: {
  appointmentId: string; contactId: number; title: string; purpose: "sales" | "account";
  startTime: string; endTime: string; canExecute: boolean; onSettled: () => void;
}) {
  const [operation, setOperation] = useState<"reschedule" | "cancel">("reschedule");
  const [start, setStart] = useState(toLocalInput(startTime));
  const [durationMinutes, setDurationMinutes] = useState(() => {
    const minutes = Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60000);
    return String(Number.isFinite(minutes) && minutes > 0 ? minutes : 30);
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "execute" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const { user } = useAuth();
  const scope = useMemo(() => user?.id ? `${PENDING_PREFIX}${user.id}:` : null, [user?.id]);
  const storageKey = scope && /^[A-Za-z0-9_-]{1,128}$/.test(appointmentId) ? `${scope}${appointmentId}` : null;

  // Restore on load / on any actor, permission or appointment change; entries of other scopes are removed.
  useEffect(() => {
    setPreview(null); setCommandId(null); setOutcome(null); setNotice(null);
    if (!scope || !storageKey) { setPending(null); return; }
    purgeOtherScopes(scope);
    const saved = readPending(storageKey);
    setPending(saved);
    if (saved && saved.operation !== "create") { setOperation(saved.operation); if (saved.start) setStart(saved.start); setDurationMinutes(saved.durationMinutes); }
  }, [scope, storageKey]);

  const requestBody = () => {
    const base = { operation, purpose, contactId, appointmentId, title };
    if (operation === "cancel") return base;
    const startMs = new Date(start).getTime();
    const minutes = Number(durationMinutes);
    return { ...base, startTime: Number.isFinite(startMs) ? new Date(startMs).toISOString() : "", endTime: Number.isFinite(startMs) && minutes > 0 ? new Date(startMs + minutes * 60000).toISOString() : "" };
  };

  const reset = () => { setPreview(null); setCommandId(null); setOutcome(null); setNotice(null); };

  const runPreview = async () => {
    setBusy("preview"); setOutcome(null); setNotice(null);
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/preview", requestBody());
      const body = (await res.json()) as Preview;
      setPreview(body);
      // One command identity per reviewed request: a retry of the same execute reuses it (idempotent), a new preview mints a new one.
      setCommandId(crypto.randomUUID());
    } catch (error) {
      const body = errorBody(error);
      setPreview(null);
      setNotice({ tone: "error", text: `Preview failed: ${body.reason ?? body.message ?? "unavailable"}. Nothing was changed or sent.` });
    } finally { setBusy(null); }
  };

  const runExecute = async () => {
    if (!preview || !commandId) return;
    setBusy("execute"); setNotice(null);
    // The identity is saved BEFORE the request: a reload or lost response can never lose an unresolved command.
    const saved: PendingCommand = { commandId, operation, payloadHash: preview.payloadHash, expectedVersion: preview.currentVersion, start, durationMinutes, savedAt: Date.now() };
    if (!storageKey || !writePending(storageKey, saved)) {
      setBusy(null); setNotice({ tone: "error", text: "This browser cannot save the recovery record for this command, so nothing was sent. Allow site storage and try again." }); return;
    }
    const settle = (state: string | undefined) => {
      // confirmed / refused / denied are definite; anything else stays pending until checked.
      if (state === "confirmed" || state === "refused" || state === "denied") { clearPending(storageKey); setPending(null); }
      else setPending(saved);
    };
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/execute", {
        ...requestBody(), commandId, payloadHash: preview.payloadHash, expectedVersion: preview.currentVersion,
      });
      const result = (await res.json()) as Outcome;
      setOutcome(result); settle(result.state);
      onSettled();
    } catch (error) {
      const body = errorBody(error);
      if (body.state === "denied" || body.reason) { setOutcome({ state: body.state ?? "denied", reason: body.reason }); settle(body.state ?? "denied"); }
      else { settle(undefined); setNotice({ tone: "error", text: "The command status could not be read. It may or may not have run; check the provider calendar before trying again." }); }
      onSettled();
    } finally { setBusy(null); }
  };

  return (
    <section className="space-y-3" aria-labelledby="drawer-booking-command-h" data-testid="drawer-booking-command">
      <h3 id="drawer-booking-command-h" className="text-sm font-semibold">Change this appointment in the provider calendar</h3>
      <p className="text-xs text-muted-foreground">
        Preview is read-only and sends nothing. {canExecute ? "Applying a change is refused unless the booking writer is enabled." : "Only an administrator can apply a change."}
        {" "}The contact is not notified by this command.
      </p>
      {pending && storageKey && (
        <PendingRecovery pending={pending} storageKey={storageKey} canResolve={canExecute} testPrefix="booking" label={`A previous ${pending.operation} for this appointment`}
          onCleared={(o) => { setPending(null); if (o) setOutcome(o); onSettled(); }} />
      )}
      <div className="flex gap-2" role="group" aria-label="Operation">
        {(["reschedule", "cancel"] as const).map(op => (
          <Button key={op} type="button" size="sm" variant={operation === op ? "default" : "outline"} className="min-h-11 capitalize"
            aria-pressed={operation === op} onClick={() => { setOperation(op); reset(); }} data-testid={`booking-op-${op}`}>{op}</Button>
        ))}
      </div>
      {operation === "reschedule" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label htmlFor="booking-start">New start</Label>
            <Input id="booking-start" type="datetime-local" value={start} onChange={e => { setStart(e.target.value); reset(); }} data-testid="booking-start" /></div>
          <div className="space-y-1"><Label htmlFor="booking-duration">Minutes</Label>
            <Input id="booking-duration" type="number" min={5} max={480} value={durationMinutes} onChange={e => { setDurationMinutes(e.target.value); reset(); }} data-testid="booking-duration" /></div>
        </div>
      )}
      <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null || pending !== null} onClick={() => void runPreview()} data-testid="button-booking-preview">
        {busy === "preview" ? "Reading provider record…" : "Preview change"}
      </Button>
      {preview && (
        <div className="rounded-md border p-3 text-sm space-y-2" role="status" data-testid="booking-preview-result">
          <p className="font-medium capitalize">{preview.operation} reviewed</p>
          {preview.payload?.startTime && <p className="text-xs">New time: {new Date(preview.payload.startTime).toLocaleString()}</p>}
          <p className="text-xs text-muted-foreground">{preview.note ?? "Preview only. Nothing was booked or sent."}</p>
          {canExecute ? (
            <Button type="button" className="min-h-11" disabled={busy !== null || preview.currentVersion === null} onClick={() => void runExecute()} data-testid="button-booking-execute">
              {busy === "execute" ? "Applying…" : `Apply ${preview.operation}`}
            </Button>
          ) : <p className="text-xs text-muted-foreground" data-testid="booking-execute-denied">Applying is available to administrators only.</p>}
          {preview.currentVersion === null && <p className="text-xs text-amber-700 dark:text-amber-400">The provider did not return a version for this appointment, so it cannot be changed from here.</p>}
        </div>
      )}
      {outcome && (
        <div className="rounded-md border p-3 text-sm" role="status" data-testid={`booking-outcome-${outcome.state}`}>
          <p className="font-medium">{OUTCOME_COPY[outcome.state] ?? `Result: ${outcome.state}`}</p>
          {outcome.reason && <p className="text-xs text-muted-foreground">{REASON_COPY[outcome.reason] ?? outcome.reason}</p>}
        </div>
      )}
      {notice && <p role="alert" className="text-sm" data-testid="booking-notice">{notice.text}</p>}
    </section>
  );
}


/**
 * Shared recovery card for create and change commands. It reads the recorded state only and releases the saved command
 * identity solely on: a definitive refusal, an exact provider readback of the reviewed intent, or an explicit recorded
 * resolution by an administrator. "Not observed" (404), unknown, accepted-but-unmatched and read failures all keep it.
 */
export function PendingRecovery({ pending, storageKey, canResolve, testPrefix, label, onCleared }: {
  pending: PendingCommand; storageKey: string; canResolve: boolean; testPrefix: string; label: string; onCleared: (outcome?: Outcome) => void;
}) {
  const [busy, setBusy] = useState<"check" | "resolve" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsResolution, setNeedsResolution] = useState(false);
  const [resolution, setResolution] = useState<"not_created" | "created_verified">("not_created");
  const [note, setNote] = useState("");
  const release = (outcome?: Outcome) => { clearPending(storageKey); onCleared(outcome); };

  const check = async () => {
    setBusy("check"); setNotice(null);
    try {
      const res = await apiRequest("GET", `/api/appointments/booking/command/${pending.commandId}`);
      const body = await res.json() as { state: string; confirmation?: string; resolved?: boolean };
      if (body.state === "refused") { release({ state: "refused" }); return; }
      if (body.state === "accepted" && (body.confirmation === "confirmed" || body.resolved)) { release({ state: "confirmed" }); return; }
      setNeedsResolution(true);
      if (body.state === "accepted") {
        setNotice(`The provider accepted this command but the provider record could not be matched to the reviewed change (${(body.confirmation ?? "unverified").replace(/_/g, " ")}). It stays saved. Check the provider calendar, then record what you found.`);
      } else {
        setNotice("Still unknown. The provider may have processed it. It is not retried automatically and stays saved. Check the provider calendar, then record what you found.");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (/^404:/.test(text)) {
        setNeedsResolution(true);
        setNotice("Not observed: no receipt for this command is visible yet. That does not prove it was not sent; the original request may still be in flight. It stays saved.");
      } else {
        setNotice("The saved command could not be checked right now. It is kept; try again.");
      }
    } finally { setBusy(null); }
  };

  const resolve = async () => {
    setBusy("resolve"); setNotice(null);
    try {
      await apiRequest("POST", `/api/appointments/booking/command/${pending.commandId}/resolve`, { resolution, note: note.trim() });
      release({ state: resolution === "created_verified" ? "confirmed" : "refused", reason: resolution === "created_verified" ? "resolved_by_operator_created" : "resolved_by_operator_not_created" });
    } catch (error) {
      const body = errorBody(error);
      setNotice(`Not recorded: ${body.reason ? (RESOLVE_COPY[body.reason] ?? body.reason) : (body.message ?? "unavailable")}. The command stays saved.`);
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-md border p-3 text-sm space-y-2" role="status" data-testid={`${testPrefix}-pending-saved`}>
      <p className="font-medium">{label} has no confirmed result.</p>
      <p className="text-xs text-muted-foreground">Check the saved result before making another change. Nothing is sent by checking. It is released only by a refusal, an exact provider match, or a recorded resolution.</p>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void check()} data-testid={`button-${testPrefix}-check-saved`}>
        {busy === "check" ? "Checking…" : "Check saved result"}
      </Button>
      {notice && <p role="alert" className="text-xs" data-testid={`${testPrefix}-notice`}>{notice}</p>}
      {needsResolution && (canResolve ? (
        <div className="space-y-2 border-t pt-2" data-testid={`${testPrefix}-resolution`}>
          <Label htmlFor={`${testPrefix}-resolution-kind`}>After checking the provider calendar</Label>
          <select id={`${testPrefix}-resolution-kind`} className="min-h-11 w-full rounded-md border bg-background px-2 text-sm" value={resolution}
            onChange={e => setResolution(e.target.value === "created_verified" ? "created_verified" : "not_created")} data-testid={`${testPrefix}-resolution-kind`}>
            <option value="not_created">It was not created</option>
            <option value="created_verified">It exists and I verified it</option>
          </select>
          <Input value={note} maxLength={300} placeholder="What did you check?" aria-label="What did you check" onChange={e => setNote(e.target.value)} data-testid={`${testPrefix}-resolution-note`} />
          <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null || note.trim().length < 5} onClick={() => void resolve()} data-testid={`button-${testPrefix}-resolve`}>
            {busy === "resolve" ? "Recording…" : "Record resolution"}
          </Button>
        </div>
      ) : <p className="text-xs text-muted-foreground" data-testid={`${testPrefix}-resolution-admin-only`}>Only an administrator can record a resolution.</p>)}
    </div>
  );
}

const RESOLVE_COPY: Record<string, string> = {
  still_in_flight: "that command may still be in flight; wait two minutes and check again",
  receipt_says_accepted: "the provider accepted it, so it cannot be recorded as not created",
  no_receipt_to_verify: "there is no receipt to verify",
  already_refused: "it was already refused, so nothing was created",
  command_started_concurrently: "the command started while resolving; check again",
};
