import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertTriangle, RefreshCw, Mail, MessageSquare, Phone, CheckCircle2, XCircle, Clock, Voicemail } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CommHealthData {
  contactId: number;
  email: { status: string; bouncedAt: string | null };
  sms: { status: string };
  call: { attempts: number; lastVoicemailAt: string | null };
  engagementScore: number;
  reachabilityScore: number;
  preferredChannel: string | null;
  doNotAutoContact: boolean;
  allChannelsFailed: boolean;
  nextRecommendedAction: string;
  recentEvents: Array<{
    id: number;
    action: string;
    details: Record<string, unknown> | null;
    createdAt: string | null;
  }>;
}

function ChannelBadge({ status, label, icon: Icon }: { status: string; label: string; icon: any }) {
  const isGood = status === "active" || status === "ok";
  const isBad = status === "bounced" || status === "undeliverable" || status === "failed";
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg border bg-card" data-testid={`channel-badge-${label.toLowerCase()}`}>
      <Icon className={`w-4 h-4 ${isGood ? "text-green-600" : isBad ? "text-red-500" : "text-muted-foreground"}`} />
      <span className="text-sm font-medium">{label}</span>
      <Badge
        variant={isGood ? "default" : isBad ? "destructive" : "secondary"}
        className="ml-auto text-xs"
        data-testid={`channel-status-${label.toLowerCase()}`}
      >
        {status}
      </Badge>
    </div>
  );
}

function ScoreGauge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1" data-testid={`score-gauge-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${color}`} data-testid={`score-value-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  );
}

function eventLabel(action: string): string {
  return action
    .replace("comm_event_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function eventIcon(action: string) {
  if (action.includes("email")) return <Mail className="w-3 h-3" />;
  if (action.includes("sms")) return <MessageSquare className="w-3 h-3" />;
  if (action.includes("voicemail")) return <Voicemail className="w-3 h-3" />;
  if (action.includes("call")) return <Phone className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
}

function eventColor(action: string): string {
  if (action.includes("bounce") || action.includes("undeliverable") || action.includes("no_answer") || action.includes("busy")) {
    return "text-red-500";
  }
  if (action.includes("reply") || action.includes("answered") || action.includes("inbound")) {
    return "text-green-600";
  }
  return "text-muted-foreground";
}

export function CommunicationHealthTab({ contactId }: { contactId: number }) {
  const { data, isLoading, isError, refetch } = useQuery<CommHealthData>({
    queryKey: ["/api/contacts", contactId, "communication-health"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/communication-health`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch communication health");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="comm-health-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="comm-health-error">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-muted-foreground">Failed to load communication health</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-comm-health-contact">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const reachabilityColor =
    data.reachabilityScore >= 70 ? "text-green-600" :
    data.reachabilityScore >= 40 ? "text-yellow-600" :
    "text-red-500";

  const engagementColor =
    data.engagementScore >= 60 ? "text-green-600" :
    data.engagementScore >= 30 ? "text-yellow-600" :
    "text-red-500";

  return (
    <div className="space-y-4" data-testid="comm-health-panel">
      {data.allChannelsFailed && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 flex items-start gap-2" data-testid="all-channels-failed-alert">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">All Channels Failed</p>
            <p className="text-xs text-red-600 dark:text-red-500">Email bounced, SMS undeliverable, and 5+ unanswered calls. Auto-contact has been paused. Manual review required.</p>
          </div>
        </div>
      )}

      {data.doNotAutoContact && !data.allChannelsFailed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2" data-testid="do-not-auto-contact-alert">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">Auto-contact is paused for this contact.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ChannelBadge status={data.email.status} label="Email" icon={Mail} />
        <ChannelBadge status={data.sms.status} label="SMS" icon={MessageSquare} />
        <ChannelBadge
          status={data.call.attempts >= 5 ? "exhausted" : data.call.attempts >= 3 ? "low" : "active"}
          label="Call"
          icon={Phone}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Scores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScoreGauge label="Reachability Score" value={data.reachabilityScore} color={reachabilityColor} />
          <ScoreGauge label="Engagement Score" value={data.engagementScore} color={engagementColor} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Call Attempts</span>
            <Badge variant={data.call.attempts >= 5 ? "destructive" : data.call.attempts >= 3 ? "secondary" : "outline"} data-testid="call-attempts-badge">
              {data.call.attempts}
            </Badge>
          </div>
          {data.call.lastVoicemailAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last Voicemail</span>
              <span className="text-xs" data-testid="last-voicemail-at">{new Date(data.call.lastVoicemailAt).toLocaleString()}</span>
            </div>
          )}
          {data.email.bouncedAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Email Bounced At</span>
              <span className="text-xs" data-testid="bounced-at">{new Date(data.email.bouncedAt).toLocaleString()}</span>
            </div>
          )}
          {data.preferredChannel && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Preferred Channel</span>
              <Badge variant="outline" className="capitalize" data-testid="preferred-channel-badge">{data.preferredChannel}</Badge>
            </div>
          )}
          <div className="pt-1 border-t">
            <div className="flex items-start gap-2 mt-2">
              <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">Recommended Next Action</p>
                <p className="text-sm font-medium" data-testid="next-recommended-action">{data.nextRecommendedAction}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Last 10 Communication Events</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="no-comm-events">No communication events recorded yet.</p>
          ) : (
            <div className="space-y-2" data-testid="comm-events-list">
              {data.recentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0" data-testid={`comm-event-${event.id}`}>
                  <span className={`mt-0.5 ${eventColor(event.action)}`}>{eventIcon(event.action)}</span>
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${eventColor(event.action)}`}>{eventLabel(event.action)}</span>
                    {event.details && typeof event.details === "object" && (event.details as any).nextAction && (event.details as any).nextAction !== "none" && (
                      <span className="text-xs text-muted-foreground ml-2">→ {String((event.details as any).nextAction).replace(/_/g, " ")}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
