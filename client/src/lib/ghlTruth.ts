export interface GhlCommandStatus {
  accepted?: boolean;
  runId: string;
  kind?: string;
  state: string;
  pollingUrl: string;
  stepUrl: string | null;
  processed: number | null;
  matched: number | null;
  notFound: number | null;
  skipped: number | null;
  errors: number | null;
  cursor: string | null;
  watermark: string | null;
  heartbeatAt: string | null;
  lastError: string | null;
  complete: boolean;
  contactId?: number;
  ghlContactId?: string | null;
  actualFieldResult?: Record<string, unknown> | null;
  fieldProjection?: Record<string, unknown> | null;
}

export function parseStructuredApiError(message: string): {
  code?: string;
  message?: string;
} {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return {};

  try {
    const body = JSON.parse(message.slice(jsonStart));
    return {
      code: typeof body?.code === "string"
        ? body.code
        : typeof body?.error === "string"
          ? body.error
          : undefined,
      message: typeof body?.message === "string"
        ? body.message
        : typeof body?.reason === "string"
          ? body.reason
          : undefined,
    };
  } catch {
    return {};
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const parsed = parseStructuredApiError(raw);
  return parsed.message || parsed.code || raw.replace(/^\d{3}:\s*/, "") || fallback;
}

export function isGhlCommandActive(command: GhlCommandStatus | null | undefined): boolean {
  if (!command) return false;
  return !command.complete && !["succeeded", "completed", "complete", "failed", "error", "blocked", "needs_identity_backfill", "cancelled", "canceled"].includes(command.state.toLowerCase());
}

export function getSameOriginCommandUrl(url: string): string {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) {
    throw new Error("The server returned a command URL outside this application.");
  }
  return `${target.pathname}${target.search}`;
}

export function valueOrUnknown(value: unknown): string {
  return value === null || value === undefined || value === "" ? "Unknown" : String(value);
}