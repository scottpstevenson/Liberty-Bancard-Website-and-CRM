import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiErrorMessage, getSameOriginCommandUrl, isGhlCommandActive, type GhlCommandStatus } from "@/lib/ghlTruth";
import { useToast } from "@/hooks/use-toast";

interface GhlCommandActionProps {
  title: string;
  description: string;
  endpoint: string;
  contactIdRequired?: boolean;
  testId: string;
  statusEndpointToInvalidate?: string;
}

function stateTone(state: string) {
  const normalized = state.toLowerCase();
  if (["succeeded", "completed", "complete"].includes(normalized)) return "text-green-700 dark:text-green-400";
  if (["failed", "error", "blocked", "needs_identity_backfill", "cancelled", "canceled"].includes(normalized)) return "text-destructive";
  return "text-amber-700 dark:text-amber-400";
}

export function GhlCommandAction({
  title,
  description,
  endpoint,
  contactIdRequired = false,
  testId,
  statusEndpointToInvalidate,
}: GhlCommandActionProps) {
  const { toast } = useToast();
  const [contactId, setContactId] = useState("");
  const [command, setCommand] = useState<GhlCommandStatus | null>(null);
  const pollingUrl = command?.pollingUrl ?? null;
  const commandStatusQuery = useQuery<GhlCommandStatus>({
    queryKey: ["ghl-durable-command", pollingUrl],
    enabled: !!pollingUrl,
    queryFn: async () => {
      const safeUrl = getSameOriginCommandUrl(pollingUrl!);
      const response = await apiRequest("GET", safeUrl);
      const status = await response.json();
      return {
        ...(command ?? {}),
        ...status,
        pollingUrl: status.pollingUrl ?? command?.pollingUrl,
        stepUrl: status.stepUrl ?? command?.stepUrl,
        complete: status.complete ?? ["succeeded", "completed", "complete", "failed", "error", "blocked", "needs_identity_backfill", "cancelled", "canceled"].includes(String(status.state ?? "").toLowerCase()),
      } as GhlCommandStatus;
    },
    refetchInterval: (query) => isGhlCommandActive(query.state.data ?? command) ? 2_000 : false,
    retry: false,
  });
  const currentCommand = commandStatusQuery.data ?? command;

  const startCommand = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (contactIdRequired) body.contactId = Number(contactId);
      body.idempotencyKey = crypto.randomUUID();
      const response = await apiRequest("POST", endpoint, body);
      if (response.status !== 202) {
        const details = await response.json().catch(() => ({}));
        throw new Error(`Expected HTTP 202 durable-command acceptance; received ${response.status}: ${JSON.stringify(details)}`);
      }
      const accepted = await response.json() as GhlCommandStatus;
      if (accepted.accepted !== true || !accepted.runId || !accepted.pollingUrl || !accepted.state) {
        throw new Error("The server accepted an HTTP 202 response without a complete durable-command status projection.");
      }
      return accepted;
    },
    onSuccess: (accepted) => {
      setCommand(accepted);
      if (statusEndpointToInvalidate) queryClient.invalidateQueries({ queryKey: [statusEndpointToInvalidate] });
      toast({ title: `${title} queued`, description: `Command ${accepted.runId} is ${accepted.state}.` });
    },
    onError: (error) => toast({
      title: `${title} failed`,
      description: getApiErrorMessage(error, "The server could not accept this command."),
      variant: "destructive",
    }),
  });

  const runStep = useMutation({
    mutationFn: async () => {
      if (!currentCommand?.stepUrl) throw new Error("The server has not provided a bounded-step URL.");
      if (!isGhlCommandActive(currentCommand)) throw new Error("This command is terminal; it will not be restarted automatically.");
      const response = await apiRequest("POST", getSameOriginCommandUrl(currentCommand.stepUrl), {});
      if (response.status !== 200 && response.status !== 202) {
        const details = await response.json().catch(() => ({}));
        throw new Error(`Expected HTTP 200 or 202 bounded-step status; received ${response.status}: ${JSON.stringify(details)}`);
      }
      return response.json() as Promise<GhlCommandStatus>;
    },
    onSuccess: (next) => setCommand(next),
    onError: (error) => toast({
      title: `${title} step failed`,
      description: getApiErrorMessage(error, "The bounded step could not be started."),
      variant: "destructive",
    }),
  });

  const active = isGhlCommandActive(currentCommand);
  const commandError = startCommand.error || runStep.error || commandStatusQuery.error;
  const validContactId = /^\d+$/.test(contactId.trim()) && Number(contactId) > 0;

  return (
    <section className="space-y-3" data-testid={testId}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {contactIdRequired && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Contact ID for permission-field sync"
            placeholder="Contact ID (number)"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
            className="max-w-[220px]"
            inputMode="numeric"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => startCommand.mutate()}
          disabled={startCommand.isPending || active || (contactIdRequired && !validContactId)}
          className="gap-2"
          data-testid={`${testId}-start`}
        >
          {startCommand.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {active ? "Command running" : "Start command"}
        </Button>
        {active && currentCommand?.stepUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => runStep.mutate()}
            disabled={runStep.isPending}
            className="gap-2"
            data-testid={`${testId}-step`}
          >
            {runStep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run bounded step
          </Button>
        )}
      </div>

      {commandError && (
        <Alert variant="destructive" data-testid={`${testId}-error`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getApiErrorMessage(commandError, "Command status is unavailable.")}</AlertDescription>
        </Alert>
      )}
      {currentCommand && (
        <div className="rounded-md border p-3 space-y-2" data-testid={`${testId}-status`}>
          <div className={`flex flex-wrap items-center gap-2 text-sm font-medium ${stateTone(currentCommand.state)}`}>
            {["succeeded", "completed", "complete"].includes(currentCommand.state.toLowerCase())
              ? <CheckCircle2 className="h-4 w-4" />
              : active
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <AlertCircle className="h-4 w-4" />}
            <span>Status: {["succeeded", "completed", "complete"].includes(currentCommand.state.toLowerCase())
              ? "Succeeded"
              : ["failed", "error", "blocked", "needs_identity_backfill", "cancelled", "canceled"].includes(currentCommand.state.toLowerCase())
                ? (currentCommand.state.toLowerCase() === "blocked" ? "Blocked" : "Failed")
                : active ? "Pending / running" : currentCommand.state}</span>
            <span className="font-normal text-muted-foreground">({currentCommand.state})</span>
            <span className="font-normal text-muted-foreground">Run {currentCommand.runId}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span>Processed: {currentCommand.processed ?? "Unknown"}</span>
            <span>Matched: {currentCommand.matched ?? "Unknown"}</span>
            <span>Not found: {currentCommand.notFound ?? "Unknown"}</span>
            <span>Skipped: {currentCommand.skipped ?? "Unknown"}</span>
            <span>Errors: {currentCommand.errors ?? "Unknown"}</span>
            <span>Cursor: {currentCommand.cursor ?? "Unknown"}</span>
            <span>Watermark: {currentCommand.watermark ?? "Unknown"}</span>
            <span>Heartbeat: {currentCommand.heartbeatAt ? new Date(currentCommand.heartbeatAt).toLocaleString() : "Unknown"}</span>
          </div>
          {currentCommand.kind && <div className="text-xs text-muted-foreground">Command kind: {currentCommand.kind}</div>}
          {currentCommand.lastError && (
            <div className="text-sm text-destructive" data-testid={`${testId}-last-error`}>
              Actual command error: {currentCommand.lastError}
            </div>
          )}
          {contactIdRequired && (
            <div className="text-xs text-muted-foreground">
              GHL contact ID: {currentCommand.ghlContactId ?? "Unknown"} · Actual field result:{" "}
              {(currentCommand.actualFieldResult ?? currentCommand.fieldProjection) == null
                ? "Unknown"
                : JSON.stringify(currentCommand.actualFieldResult ?? currentCommand.fieldProjection)}
            </div>
          )}
          {commandStatusQuery.isError && <p className="text-xs text-destructive">Polling failed; the last received command status is shown above and is not assumed current.</p>}
        </div>
      )}
    </section>
  );
}