import { useState } from "react";
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
interface Preview { operation: string; payloadHash: string; currentVersion: number | null; note?: string; payload?: { startTime?: string; endTime?: string } }
type Outcome = { state: string; reason?: string; appointmentId?: string; replay?: boolean };

const OUTCOME_COPY: Record<string, string> = {
  confirmed: "Confirmed: the provider record matches the reviewed change.",
  unconfirmed: "Unconfirmed: the provider accepted it but the read-back did not match. Check the provider calendar before trying again.",
  unknown: "Unknown: the provider may have processed it. It is not retried automatically; check the provider calendar.",
  refused: "Refused by the provider. Nothing changed.",
  denied: "Denied before any provider call. Nothing changed.",
};

const REASON_COPY: Record<string, string> = {
  booking_writer_not_enabled: "The booking writer is not enabled for this deployment, so no provider change can be made from here.",
  expected_version_required: "The reviewed appointment version is missing. Preview again.",
  payload_changed_since_preview: "The request changed since the preview. Preview again.",
  command_id_bound_to_different_request: "This command id was already used for a different request. Preview again.",
};

const errorBody = (error: unknown): { message?: string; reason?: string; state?: string } => {
  const text = error instanceof Error ? error.message : String(error);
  const json = text.replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(json); } catch { return { message: text }; }
};

const toLocalInput = (iso: string): string => {
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
    try {
      const res = await apiRequest("POST", "/api/appointments/booking/execute", {
        ...requestBody(), commandId, payloadHash: preview.payloadHash, expectedVersion: preview.currentVersion,
      });
      setOutcome((await res.json()) as Outcome);
      onSettled();
    } catch (error) {
      const body = errorBody(error);
      if (body.state === "denied" || body.reason) setOutcome({ state: body.state ?? "denied", reason: body.reason });
      else setNotice({ tone: "error", text: "The command status could not be read. It may or may not have run; check the provider calendar before trying again." });
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
      <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void runPreview()} data-testid="button-booking-preview">
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
