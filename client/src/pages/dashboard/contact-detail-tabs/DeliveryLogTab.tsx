import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, RefreshCw, Mail, MessageSquare, CheckCircle2, XCircle, Clock, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeliveryLogRow {
  id: number;
  sequenceName: string | null;
  stepOrder: number | null;
  channel: string;
  fromAddress: string | null;
  toAddress: string;
  subject: string | null;
  status: string;
  failureReason: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

function channelIcon(channel: string) {
  if (channel.startsWith("sms")) return <MessageSquare className="w-3.5 h-3.5" />;
  return <Mail className="w-3.5 h-3.5" />;
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "email_smtp": return "SMTP";
    case "email_ghl":  return "GHL Email";
    case "email_gmail":return "Gmail";
    case "sms_ghl":    return "SMS";
    default:           return channel;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    sent:      { variant: "default",     icon: <CheckCircle2 className="w-3 h-3" /> },
    delivered: { variant: "default",     icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:    { variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
    bounced:   { variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
    complained:{ variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
    pending:   { variant: "secondary",   icon: <Clock className="w-3 h-3" /> },
    skipped:   { variant: "outline",     icon: <Clock className="w-3 h-3" /> },
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="flex items-center gap-1 capitalize text-xs" data-testid={`delivery-status-${status}`}>
      {cfg.icon}
      {status}
    </Badge>
  );
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function DeliveryLogTab({ contactId }: { contactId: number }) {
  const { data, isLoading, isError, refetch } = useQuery<DeliveryLogRow[]>({
    queryKey: ["/api/contacts", contactId, "delivery-log"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/delivery-log`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delivery log");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="delivery-log-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="delivery-log-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load delivery log</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-delivery-log">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <Card data-testid="delivery-log-empty">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <SendHorizonal className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No outbound messages recorded for this contact yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="delivery-log-panel">
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {rows.length} {rows.length === 1 ? "message" : "messages"} recorded
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.id}
                className="px-4 py-3 space-y-1.5"
                data-testid={`delivery-log-row-${row.id}`}
              >
                {/* Top row: channel, status, timestamp */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`delivery-channel-${row.id}`}>
                    {channelIcon(row.channel)}
                    {channelLabel(row.channel)}
                  </span>
                  <StatusBadge status={row.status} />
                  <span className="ml-auto text-xs text-muted-foreground" data-testid={`delivery-ts-${row.id}`}>
                    {formatTs(row.sentAt ?? row.failedAt ?? row.createdAt)}
                  </span>
                </div>

                {/* Subject line */}
                {row.subject && (
                  <p className="text-sm font-medium truncate" data-testid={`delivery-subject-${row.id}`}>
                    {row.subject}
                  </p>
                )}

                {/* From → To */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {row.fromAddress && (
                    <span data-testid={`delivery-from-${row.id}`}>
                      <span className="font-medium">From:</span> {row.fromAddress}
                    </span>
                  )}
                  <span data-testid={`delivery-to-${row.id}`}>
                    <span className="font-medium">To:</span> {row.toAddress}
                  </span>
                </div>

                {/* Sequence / step */}
                {(row.sequenceName || row.stepOrder != null) && (
                  <div className="text-xs text-muted-foreground" data-testid={`delivery-sequence-${row.id}`}>
                    <span className="font-medium">Sequence:</span>{" "}
                    {row.sequenceName ?? "Unknown"}
                    {row.stepOrder != null && ` · Step ${row.stepOrder}`}
                  </div>
                )}

                {/* Failure reason */}
                {row.failureReason && (
                  <div
                    className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-1 text-xs text-red-700 dark:text-red-400"
                    data-testid={`delivery-failure-${row.id}`}
                  >
                    <span className="font-medium">Reason:</span> {row.failureReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
