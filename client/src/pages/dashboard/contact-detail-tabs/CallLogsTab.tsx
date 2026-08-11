// #460 — Call Log tab on contact detail
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone } from "lucide-react";

interface CallLog {
  id: number;
  direction: string;
  outcome: string;
  duration: number | null;
  notes: string | null;
  calledAt: string | null;
  createdAt: string;
  agentEmail: string | null;
}

export function CallLogsTab({ contactId }: { contactId: number }) {
  const { data: callLogs, isLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/call-logs/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/call-logs/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!callLogs || callLogs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground" data-testid="call-logs-empty">
          <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No call logs yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Call Log ({callLogs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-0" data-testid="call-log-list">
        {callLogs.map(log => (
          <div
            key={log.id}
            className="flex items-start justify-between gap-3 px-4 py-3 border-b last:border-0"
            data-testid={`call-log-${log.id}`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-0.5">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium capitalize">{log.direction || "outbound"}</span>
                  {log.outcome && (
                    <Badge
                      variant={log.outcome === "answered" || log.outcome === "connected" ? "default" : "outline"}
                      className="text-xs px-1.5 py-0"
                    >
                      {log.outcome}
                    </Badge>
                  )}
                  {log.duration != null && log.duration > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {Math.floor(log.duration / 60)}m {log.duration % 60}s
                    </span>
                  )}
                </div>
                {log.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>
                )}
                {log.agentEmail && (
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Rep: {log.agentEmail.split("@")[0]}</p>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {new Date(log.calledAt || log.createdAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
