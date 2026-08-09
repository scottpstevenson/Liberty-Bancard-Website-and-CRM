/**
 * CommunicationTimelineTab — Task #1413
 * Unified inbound + outbound communication history for a contact.
 * Reads from communication_events via GET /api/contacts/:id/communication-timeline.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, AlertTriangle, RefreshCw,
  Mail, MessageSquare, Phone, Voicemail, Radio,
  ArrowUpRight, ArrowDownLeft, Globe, MessageCircle,
  CheckCircle2, XCircle, Clock, AlertCircle, Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommEvent {
  id: number;
  contactId: number | null;
  dealId: number | null;
  direction: string;          // 'inbound' | 'outbound'
  channel: string;            // 'email'|'sms'|'call'|'voicemail'|'chat'|'form'|'portal'|'rvm'
  provider: string | null;    // 'ghl'|'smtp'|'twilio'|'internal'|'manual'
  subject: string | null;
  body: string | null;
  status: string;             // 'sent'|'failed'|'skipped'|'received'|'replied'|'bounced'
  intentClassification: string | null;
  intentConfidence: string | null;
  automationStopped: boolean;
  automationStopReason: string | null;
  sentBy: string;             // 'automation'|'human'
  sequenceId: number | null;
  sequenceStepId: number | null;
  externalMessageId: string | null;
  ghlMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface TimelineResponse {
  events: CommEvent[];
  total: number;
  contactId: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function channelIcon(channel: string, className = "w-3.5 h-3.5") {
  switch (channel) {
    case "email":    return <Mail className={className} />;
    case "sms":      return <MessageSquare className={className} />;
    case "call":     return <Phone className={className} />;
    case "voicemail":
    case "rvm":      return <Voicemail className={className} />;
    case "chat":     return <MessageCircle className={className} />;
    case "form":     return <Globe className={className} />;
    case "portal":   return <Wifi className={className} />;
    default:         return <Radio className={className} />;
  }
}

function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    email: "Email", sms: "SMS", call: "Call",
    voicemail: "Voicemail", rvm: "RVM", chat: "Chat",
    form: "Form", portal: "Portal",
  };
  return map[channel] ?? channel;
}

function statusConfig(status: string): {
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: React.ReactNode;
  label: string;
} {
  switch (status) {
    case "sent":
    case "received":
      return { variant: "default",     icon: <CheckCircle2 className="w-3 h-3" />, label: status };
    case "replied":
    case "delivered":
      return { variant: "default",     icon: <CheckCircle2 className="w-3 h-3" />, label: status };
    case "failed":
    case "bounced":
    case "complained":
      return { variant: "destructive", icon: <XCircle className="w-3 h-3" />,      label: status };
    case "skipped":
      return { variant: "outline",     icon: <Clock className="w-3 h-3" />,        label: status };
    default:
      return { variant: "secondary",   icon: <AlertCircle className="w-3 h-3" />,  label: status };
  }
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatConfidence(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : `${Math.round(n * 100)}%`;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: CommEvent }) {
  const isOutbound = event.direction === "outbound";
  const sc = statusConfig(event.status);
  const conf = formatConfidence(event.intentConfidence);

  return (
    <div
      className={cn(
        "px-4 py-3 space-y-1.5 border-l-2",
        isOutbound
          ? "border-l-blue-400 dark:border-l-blue-600"
          : "border-l-emerald-400 dark:border-l-emerald-600"
      )}
      data-testid={`comm-event-row-${event.id}`}
    >
      {/* Top: direction arrow, channel, status, timestamp */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Direction */}
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            isOutbound ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"
          )}
          data-testid={`comm-event-direction-${event.id}`}
        >
          {isOutbound
            ? <ArrowUpRight className="w-3.5 h-3.5" />
            : <ArrowDownLeft className="w-3.5 h-3.5" />
          }
          {isOutbound ? "Outbound" : "Inbound"}
        </span>

        {/* Channel */}
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          data-testid={`comm-event-channel-${event.id}`}
        >
          {channelIcon(event.channel)}
          {channelLabel(event.channel)}
        </span>

        {/* Provider */}
        {event.provider && (
          <span className="text-xs text-muted-foreground/70" data-testid={`comm-event-provider-${event.id}`}>
            via {event.provider.toUpperCase()}
          </span>
        )}

        {/* Status badge */}
        <Badge
          variant={sc.variant}
          className="flex items-center gap-1 capitalize text-xs"
          data-testid={`comm-event-status-${event.id}`}
        >
          {sc.icon}
          {sc.label}
        </Badge>

        {/* Timestamp */}
        <span className="ml-auto text-xs text-muted-foreground" data-testid={`comm-event-ts-${event.id}`}>
          {formatTs(event.createdAt)}
        </span>
      </div>

      {/* Subject */}
      {event.subject && (
        <p className="text-sm font-medium truncate" data-testid={`comm-event-subject-${event.id}`}>
          {event.subject}
        </p>
      )}

      {/* Body preview */}
      {event.body && (
        <p
          className="text-xs text-muted-foreground line-clamp-2"
          data-testid={`comm-event-body-${event.id}`}
        >
          {event.body}
        </p>
      )}

      {/* Metadata row: sentBy, intent, automation-stopped */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span data-testid={`comm-event-sent-by-${event.id}`}>
          <span className="font-medium">By:</span>{" "}
          {event.sentBy === "automation" ? "Automation" : "Human"}
        </span>

        {event.intentClassification && (
          <span data-testid={`comm-event-intent-${event.id}`}>
            <span className="font-medium">Intent:</span>{" "}
            {event.intentClassification}
            {conf && ` (${conf})`}
          </span>
        )}

        {event.sequenceId && (
          <span data-testid={`comm-event-sequence-${event.id}`}>
            <span className="font-medium">Seq ID:</span> {event.sequenceId}
          </span>
        )}

        {event.automationStopped && (
          <span className="text-amber-600 dark:text-amber-400 font-medium" data-testid={`comm-event-auto-stopped-${event.id}`}>
            ⚠ Automation stopped
            {event.automationStopReason && ` — ${event.automationStopReason}`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CommunicationTimelineTab({ contactId }: { contactId: number }) {
  const { data, isLoading, isError, refetch } = useQuery<TimelineResponse>({
    queryKey: ["/api/contacts", contactId, "communication-timeline"],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/${contactId}/communication-timeline?limit=100`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch communication timeline");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="comm-timeline-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="comm-timeline-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load communication timeline</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-comm-timeline">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <Card data-testid="comm-timeline-empty">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Mail className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-medium">No communications recorded</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Events are recorded automatically when emails, SMS, calls, or form submissions are processed for this contact.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Count by direction for summary
  const outboundCount = events.filter(e => e.direction === "outbound").length;
  const inboundCount = events.filter(e => e.direction === "inbound").length;

  return (
    <div className="space-y-3" data-testid="comm-timeline-panel">
      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{events.length} events</span>
        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <ArrowUpRight className="w-3.5 h-3.5" />
          {outboundCount} outbound
        </span>
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <ArrowDownLeft className="w-3.5 h-3.5" />
          {inboundCount} inbound
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="ml-auto h-7 px-2 text-xs"
          data-testid="btn-refresh-comm-timeline"
        >
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* Events list */}
      <Card data-testid="comm-timeline-list">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Most recent first · left border = direction
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {events.map(event => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
