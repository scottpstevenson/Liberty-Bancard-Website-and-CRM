import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, AlertTriangle } from "lucide-react";
import { formatRate } from "@shared/rate-evidence";

export interface IdentityHealthData {
  id: number;
  label: string;
  domain: string;
  emailAddress: string;
  isActive: boolean;
  warmupStatus: string;
  dailyLimit: number;
  sentToday: number;
  healthScore: number | null;
  // null = no sends in the 7-day window, so there is no evidence for a rate (not 0%).
  bounceRate: number | null;
  replyRate: number | null;
  complaintRate: number | null;
  openRate: number | null;
  weekSent: number;
  evidence?: { basis: string; denominator: number; sufficient: boolean };
  alert: string | null;
}

export interface IdentityHealthViewProps {
  data?: IdentityHealthData[] | null;
  error?: Error | null;
  isLoading?: boolean;
  onRetry?: () => void;
}

/** Pure view: loading, denied, unavailable and a successful empty list are four different states. */
export function IdentityHealthView({ data, error, isLoading, onRetry }: IdentityHealthViewProps) {
  if (isLoading && !data && !error) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const denied = !!error && /^(401|403)\b/.test(error.message);
  const identities = data || [];

  return (
    <Card data-testid="card-identity-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Inbox Deliverability Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && !data ? (
          <div className="text-center py-8 text-muted-foreground space-y-3" data-testid={denied ? "identity-health-denied" : "identity-health-unavailable"}>
            <p>{denied ? "Your role cannot read inbox health. Nothing is shown; this does not mean no inboxes exist." : "Inbox health could not be read. The state of your inboxes is unknown."}</p>
            {!denied && onRetry && <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-identity-health-retry">Retry read</Button>}
          </div>
        ) : identities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="identity-health-empty">
            No sending identities configured yet. Set up inboxes in the inbox rotation settings.
          </div>
        ) : (
          <div className="space-y-3">
            {identities.map((identity) => (
              <div key={identity.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg" data-testid={`identity-${identity.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{identity.label}</span>
                    <Badge variant={identity.isActive ? "secondary" : "outline"} className="text-xs">
                      {identity.warmupStatus}
                    </Badge>
                    {identity.alert && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {identity.alert}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{identity.emailAddress} ({identity.domain})</div>
                  {identity.evidence && !identity.evidence.sufficient && (
                    <div className="text-xs text-muted-foreground mt-1" data-testid={`identity-${identity.id}-no-evidence`}>
                      No sends in the last 7 days: bounce, reply and open rates are not available (n/a), not 0%.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className={`font-medium ${identity.healthScore == null ? "text-muted-foreground" : identity.healthScore >= 80 ? "text-green-600" : identity.healthScore >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                      {identity.healthScore != null ? `${identity.healthScore}%` : "unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground">Health</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{identity.sentToday}/{identity.dailyLimit}</div>
                    <div className="text-xs text-muted-foreground">Today</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{formatRate(identity.bounceRate)}</div>
                    <div className="text-xs text-muted-foreground">Bounce</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{formatRate(identity.replyRate)}</div>
                    <div className="text-xs text-muted-foreground">Reply</div>
                  </div>
                  <div className="text-center">
                    <div className="font-medium">{formatRate(identity.openRate)}</div>
                    <div className="text-xs text-muted-foreground">Open</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IdentityHealthDashboard() {
  const { data, error, isLoading, refetch } = useQuery<IdentityHealthData[]>({
    queryKey: ["/api/sdr/identity-health"],
  });
  return <IdentityHealthView data={data} error={error as Error | null} isLoading={isLoading} onRetry={() => { void refetch(); }} />;
}
