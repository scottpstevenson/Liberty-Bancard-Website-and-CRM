// #460 + #1475 — Call Log & Voicemails tab on contact detail
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Phone, PhoneMissed, PhoneCall, Voicemail, CheckCircle,
  CalendarClock, ExternalLink, MessageSquare,
} from "lucide-react";

interface CallLog {
  id: number;
  direction: string;
  outcome: string | null;
  duration: number | null;
  notes: string | null;
  summary: string | null;
  nextSteps: string | null;
  calledAt: string | null;
  createdAt: string;
  agentEmail: string | null;
}

interface VoicemailEvent {
  id: number;
  contactId: number;
  channel: string;
  direction: string;
  body: string | null;
  createdAt: string;
  externalMessageId: string | null;
  metadata: {
    callerName?: string;
    mediaUrl?: string;
    duration?: number;
    transcript?: string;
    receivedAt?: string;
  } | null;
}

function outcomeColor(outcome: string | null) {
  if (!outcome) return "outline";
  const lc = outcome.toLowerCase();
  if (lc.includes("connected") || lc.includes("answered")) return "default";
  if (lc.includes("no answer") || lc.includes("no show")) return "secondary";
  if (lc.includes("vm") || lc.includes("voicemail")) return "outline";
  if (lc.includes("scheduled") || lc.includes("callback")) return "secondary";
  return "outline";
}

function outcomeIcon(outcome: string | null) {
  if (!outcome) return <Phone className="h-3.5 w-3.5 text-muted-foreground" />;
  const lc = outcome.toLowerCase();
  if (lc.includes("connected")) return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (lc.includes("no answer") || lc.includes("no show")) return <PhoneMissed className="h-3.5 w-3.5 text-yellow-500" />;
  if (lc.includes("vm") || lc.includes("voicemail")) return <Voicemail className="h-3.5 w-3.5 text-blue-500" />;
  if (lc.includes("scheduled") || lc.includes("callback")) return <CalendarClock className="h-3.5 w-3.5 text-purple-500" />;
  return <Phone className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function VoicemailCard({ vm }: { vm: VoicemailEvent }) {
  const meta = vm.metadata || {};
  const receivedAt = meta.receivedAt || vm.createdAt;
  const dur = meta.duration;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 border-b last:border-0 bg-blue-50/30 dark:bg-blue-950/10"
      data-testid={`voicemail-event-${vm.id}`}
    >
      <div className="mt-0.5 shrink-0">
        <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/40">
          <Voicemail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Voicemail</span>
          {meta.callerName && (
            <span className="text-xs text-muted-foreground">from {meta.callerName}</span>
          )}
          {dur != null && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {formatDuration(dur)}
            </Badge>
          )}
        </div>
        {(meta.transcript || vm.body) && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
            {meta.transcript || vm.body}
          </p>
        )}
        {meta.mediaUrl && (
          <a
            href={meta.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
            data-testid={`link-voicemail-play-${vm.id}`}
          >
            <ExternalLink className="h-3 w-3" /> Play recording
          </a>
        )}
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {new Date(receivedAt).toLocaleDateString(undefined, {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        })}
      </div>
    </div>
  );
}

export function CallLogsTab({ contactId }: { contactId: number }) {
  const { data: callLogs, isLoading: loadingCalls } = useQuery<CallLog[]>({
    queryKey: ["/api/call-logs/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/call-logs/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: voicemails, isLoading: loadingVms } = useQuery<VoicemailEvent[]>({
    queryKey: ["/api/contacts", contactId, "voicemails"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/voicemails`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const isLoading = loadingCalls || loadingVms;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const totalCalls = callLogs?.length ?? 0;
  const totalVms = voicemails?.length ?? 0;

  if (totalCalls === 0 && totalVms === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground" data-testid="call-logs-empty">
          <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>No calls or voicemails yet</p>
        </CardContent>
      </Card>
    );
  }

  // Merge and sort by date (newest first)
  type MergedItem =
    | { kind: "call"; item: CallLog; date: Date }
    | { kind: "voicemail"; item: VoicemailEvent; date: Date };

  const merged: MergedItem[] = [
    ...(callLogs || []).map(c => ({
      kind: "call" as const,
      item: c,
      date: new Date(c.calledAt || c.createdAt),
    })),
    ...(voicemails || []).map(v => ({
      kind: "voicemail" as const,
      item: v,
      date: new Date((v.metadata as any)?.receivedAt || v.createdAt),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PhoneCall className="h-4 w-4" />
          Calls &amp; Voicemails
          <span className="text-muted-foreground font-normal text-sm">
            ({totalCalls} call{totalCalls !== 1 ? "s" : ""}{totalVms > 0 ? `, ${totalVms} voicemail${totalVms !== 1 ? "s" : ""}` : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 p-0" data-testid="call-log-list">
        {merged.map((entry) => {
          if (entry.kind === "voicemail") {
            return <VoicemailCard key={`vm-${entry.item.id}`} vm={entry.item} />;
          }

          const log = entry.item;
          return (
            <div
              key={`call-${log.id}`}
              className="flex items-start gap-3 px-4 py-3 border-b last:border-0"
              data-testid={`call-log-${log.id}`}
            >
              <div className="mt-0.5 shrink-0">
                {outcomeIcon(log.outcome)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium capitalize">{log.direction || "outbound"}</span>
                  {log.outcome && (
                    <Badge
                      variant={outcomeColor(log.outcome)}
                      className="text-xs px-1.5 py-0"
                    >
                      {log.outcome}
                    </Badge>
                  )}
                  {log.duration != null && log.duration > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(log.duration)}
                    </span>
                  )}
                </div>
                {(log.summary || log.notes) && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {log.summary || log.notes}
                  </p>
                )}
                {log.nextSteps && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                    → {log.nextSteps}
                  </p>
                )}
                {log.agentEmail && (
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Rep: {log.agentEmail.split("@")[0]}
                  </p>
                )}
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {new Date(log.calledAt || log.createdAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric",
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
