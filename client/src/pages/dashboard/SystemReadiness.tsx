import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Mail,
  Brain,
  Database,
  Bot,
  Send,
  Server,
  ShieldAlert,
} from "lucide-react";

interface ReadinessData {
  ghl: {
    status: "ok" | "expired" | "unconfigured";
    configured: boolean;
    locationName?: string;
    workflowIdsConfigured: number;
    workflowIdsTotal: number;
  };
  smtp: {
    configured: boolean;
    host: string | null;
    port: number;
    user: string | null;
    from: string | null;
  };
  openai: { configured: boolean };
  redis: { real: boolean; url: string };
  sdr: {
    sdrEnabled: boolean;
    orchestratorEnabled: boolean;
    legacyOutreachEnabled: boolean;
    voiceAiEnabled: boolean;
    smsEnabled: boolean;
    nightlyDiscoveryEnabled: boolean;
  };
  sendingIdentities: { activeCount: number };
  env: Record<string, boolean>;
  actions: string[];
  overallHealthy: boolean;
  criticalIssues: number;
}

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />;
  if (warn) return <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />;
  return <XCircle className="w-5 h-5 text-red-500 shrink-0" />;
}

function StatusBadge({ status }: { status: "ok" | "warning" | "error" }) {
  if (status === "ok") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Connected</Badge>;
  if (status === "warning") return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">Warning</Badge>;
  return <Badge variant="destructive">Not Configured</Badge>;
}

function FlagRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {enabled
        ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-xs">Enabled</Badge>
        : <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>}
    </div>
  );
}

function EnvRow({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <StatusIcon ok={present} />
      <span className="text-sm font-mono">{label}</span>
      {!present && <span className="text-xs text-muted-foreground ml-auto">Not set</span>}
    </div>
  );
}

export default function SystemReadiness() {
  const { data, isLoading, refetch, isFetching } = useQuery<ReadinessData>({
    queryKey: ["/api/admin/system-readiness"],
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const ghlStatus = data?.ghl.status === "ok" ? "ok" : data?.ghl.status === "expired" ? "warning" : "error";
  const smtpStatus = data?.smtp.configured ? "ok" : data?.smtp.host ? "warning" : "error";

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="System Readiness"
        subtitle="Full health check of all integrations and pipeline dependencies. Resolving all action items ensures every pipeline runs smoothly once configured."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-readiness">
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-32" />
            </Card>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Overall Banner */}
          <div
            data-testid="banner-overall-health"
            className={`flex items-center gap-4 rounded-lg border px-5 py-4 ${
              data.overallHealthy
                ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                : data.criticalIssues > 0
                ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
            }`}
          >
            {data.overallHealthy ? (
              <CheckCircle2 className="w-7 h-7 text-green-600 shrink-0" />
            ) : data.criticalIssues > 0 ? (
              <XCircle className="w-7 h-7 text-red-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-7 h-7 text-yellow-600 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-sm">
                {data.overallHealthy
                  ? "All systems go — every pipeline is configured and ready."
                  : data.criticalIssues > 0
                  ? `${data.criticalIssues} critical issue${data.criticalIssues > 1 ? "s" : ""} detected — pipelines are silently failing. Resolve action items below.`
                  : `${data.actions.length} action item${data.actions.length > 1 ? "s" : ""} — system is partially configured.`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Auto-refreshes every 30 seconds</p>
            </div>
          </div>

          {/* Action Items */}
          {data.actions.length > 0 && (
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-orange-500" />
                  Action Items ({data.actions.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.actions.map((action, i) => {
                  const isCritical = action.toLowerCase().includes("silently failing") || action.toLowerCase().includes("fail") || action.toLowerCase().includes("security");
                  return (
                    <div key={i} data-testid={`action-item-${i}`} className={`flex items-start gap-3 rounded-md px-3 py-2 ${isCritical ? "bg-red-50 dark:bg-red-950/20" : "bg-yellow-50 dark:bg-yellow-950/20"}`}>
                      {isCritical
                        ? <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />}
                      <p className="text-sm">{action}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Integration Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* GHL */}
            <Card data-testid="card-ghl-status">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-primary" />
                    GoHighLevel CRM
                  </div>
                  <StatusBadge status={ghlStatus} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.ghl.configured} />
                  <span>Integration Token</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.ghlLocationId} />
                  <span>Location ID</span>
                </div>
                {data.ghl.locationName && (
                  <p className="text-xs text-muted-foreground pl-7">📍 {data.ghl.locationName}</p>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Workflow IDs</span>
                  <span className={`font-mono font-semibold text-xs ${data.ghl.workflowIdsConfigured < data.ghl.workflowIdsTotal ? "text-red-600 dark:text-red-400" : "text-green-600"}`}>
                    {data.ghl.workflowIdsConfigured}/{data.ghl.workflowIdsTotal}
                  </span>
                </div>
                {data.ghl.workflowIdsConfigured < data.ghl.workflowIdsTotal && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {data.ghl.workflowIdsTotal - data.ghl.workflowIdsConfigured} workflows unconfigured → all automation silently fails
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.ghlWebhookSecret} />
                  <span>Webhook Secret</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.ghlBookingLink} warn={!data.env.ghlBookingLink} />
                  <span>Default Booking Link</span>
                </div>
              </CardContent>
            </Card>

            {/* SMTP */}
            <Card data-testid="card-smtp-status">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    SMTP Email Fallback
                  </div>
                  <StatusBadge status={smtpStatus} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.smtpHost} />
                  <span>SMTP_HOST</span>
                  {data.smtp.host && <span className="text-xs text-muted-foreground ml-auto font-mono">{data.smtp.host}:{data.smtp.port}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.smtpUser} />
                  <span>SMTP_USER</span>
                  {data.smtp.user && <span className="text-xs text-muted-foreground ml-auto font-mono truncate max-w-[120px]">{data.smtp.user}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.smtpPass} />
                  <span>SMTP_PASS</span>
                  {!data.env.smtpPass && <span className="text-xs text-red-600 dark:text-red-400 ml-auto">Required for delivery</span>}
                </div>
                {!data.smtp.configured && (
                  <>
                    <Separator />
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Without SMTP, transactional emails (proposals, merchant welcome, rep alerts, digests) rely solely on GHL and will silently fail when GHL is down.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* OpenAI */}
            <Card data-testid="card-openai-status">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-primary" />
                    OpenAI / AI Engine
                  </div>
                  <StatusBadge status={data.openai.configured ? "ok" : "error"} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.openai.configured} />
                  <span>AI_INTEGRATIONS_OPENAI_API_KEY</span>
                </div>
                {!data.openai.configured && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    AI enrichment, intent classification, deal blueprints, and proposal generation will all fail without this key.
                  </p>
                )}
                {data.openai.configured && (
                  <p className="text-xs text-muted-foreground">
                    Powers: enrichment, reply classification, blueprints, proposals, conversation AI, campaign content.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Redis / Queue */}
            <Card data-testid="card-redis-status">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    Redis / Job Queue
                  </div>
                  <StatusBadge status={data.redis.real ? "ok" : "warning"} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.redis.real} warn={!data.redis.real} />
                  <span>REDIS_URL</span>
                </div>
                {!data.redis.real ? (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    Using in-memory queue (ioredis-mock). Jobs are not durable — all queued work is lost on server restart. Safe for dev, not for production.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Durable BullMQ queues active: GHL sync (45s), SLA checks (5m), sequences (30s), enrichment (10m), discovery (daily).
                  </p>
                )}
              </CardContent>
            </Card>

            {/* SDR Feature Flags */}
            <Card data-testid="card-sdr-flags">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bot className="w-4 h-4 text-primary" />
                  SDR Feature Flags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FlagRow label="SDR Pipeline" enabled={data.sdr.sdrEnabled} />
                <FlagRow label="Orchestrator" enabled={data.sdr.orchestratorEnabled} />
                <FlagRow label="Legacy Outreach" enabled={data.sdr.legacyOutreachEnabled} />
                <FlagRow label="Voice AI" enabled={data.sdr.voiceAiEnabled} />
                <FlagRow label="SMS" enabled={data.sdr.smsEnabled} />
                <FlagRow label="Nightly Discovery" enabled={data.sdr.nightlyDiscoveryEnabled} />
                <Separator className="my-2" />
                <p className="text-xs text-muted-foreground">Manage flags in the Activation Panel</p>
              </CardContent>
            </Card>

            {/* Sending Identities */}
            <Card data-testid="card-sending-identities">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-primary" />
                    Sending Identities
                  </div>
                  <StatusBadge status={data.sendingIdentities.activeCount >= 3 ? "ok" : data.sendingIdentities.activeCount > 0 ? "warning" : "error"} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Active identities</span>
                  <span className={`font-mono font-semibold ${data.sendingIdentities.activeCount >= 3 ? "text-green-600" : "text-yellow-600"}`}>
                    {data.sendingIdentities.activeCount}
                  </span>
                </div>
                {data.sendingIdentities.activeCount < 3 ? (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    Recommend 3+ for inbox rotation and deliverability protection. Add identities in Email Health.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Inbox rotation active. Monitor bounce rates and health scores in Inbox Health.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <StatusIcon ok={data.env.adminEmail} />
                  <span>ADMIN_DIGEST_EMAIL</span>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Enrichment APIs */}
          <Card data-testid="card-enrichment-apis">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                Enrichment & Discovery APIs
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <EnvRow label="SERPER_API_KEY" present={data.env.serperApiKey} />
              <EnvRow label="APOLLO_API_KEY" present={data.env.apolloApiKey} />
              <EnvRow label="APIFY_API_TOKEN" present={data.env.apifyToken} />
              <EnvRow label="OUTSCRAPER_API_KEY" present={data.env.outscraperKey} />
              <EnvRow label="APP_URL" present={data.env.appUrl} />
              <EnvRow label="NMI_SECURITY_KEY" present={data.env.nmiKey} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Failed to load system readiness data.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
