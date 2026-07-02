import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle, BarChart3, Search, MapPin, Building2, Zap, Settings, Play, Square, CheckCircle2, XCircle, RefreshCw, Clock, TrendingUp, Mail, Key, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { DiscoveryConfigCard, type SearchMatrixConfig, type SourceStatusData } from "./DiscoveryConfigCard";
import { SourcePerformancePanel } from "./SourcePerformancePanel";

interface DiscoveryStatsData {
  today: {
    rawFound: number;
    newInserted: number;
    duplicatesSkipped: number;
    enrichmentQueued: number;
    jobCount: number;
    dedupRate: number;
  };
  week: {
    rawFound: number;
    newInserted: number;
    duplicatesSkipped: number;
    enrichmentQueued: number;
    jobCount: number;
  };
  byVertical: { vertical: string; count: number; newCount: number }[];
  byMetro: { metro: string; count: number; newCount: number }[];
  bySource: { source: string; count: number; newCount: number }[];
}

interface DiscoveryStatusData {
  discoveryRunning: boolean;
  nightlySchedulerActive: boolean;
}

interface DiscoveryJob {
  id: number;
  status: string;
  triggerType: string;
  rawFound: number;
  newInserted: number;
  duplicatesSkipped: number;
  errorsCount: number;
  enrichmentQueued: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  searchVerticals: string[] | null;
  searchMetros: string[] | null;
  dataSources: string[] | null;
}

interface KeyStatusData {
  serper: boolean;
  outscraper: boolean;
  apify: boolean;
  apollo: boolean;
  zeroBounce: boolean;
}

const PAID_SOURCES = [
  { key: "serper", label: "Serper" },
  { key: "outscraper", label: "Outscraper" },
  { key: "apify", label: "Apify" },
];
const FREE_SOURCES = [
  { key: "osm", label: "OpenStreetMap (OSM)" },
  { key: "yellowpages", label: "Yellow Pages" },
  { key: "bbb", label: "BBB" },
];

export function DiscoveryDashboard() {
  const { toast } = useToast();
  const [showConfig, setShowConfig] = useState(false);
  const [pilotLimit, setPilotLimit] = useState(25);
  const [pilotSources, setPilotSources] = useState<string[]>(["osm"]);

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<DiscoveryStatsData>({
    queryKey: ["/api/sdr/discovery/stats"],
  });

  const { data: status } = useQuery<DiscoveryStatusData>({
    queryKey: ["/api/sdr/discovery/status"],
    refetchInterval: 5000,
  });

  const { data: config } = useQuery<SearchMatrixConfig>({
    queryKey: ["/api/sdr/discovery/config"],
  });

  const { data: sourceStatus } = useQuery<SourceStatusData>({
    queryKey: ["/api/sdr/discovery/source-status"],
  });

  const { data: ownerCoverage } = useQuery<{ totalMerchants: number; merchantsWithEmail: number; coveragePct: number }>({
    queryKey: ["/api/sdr/discovery/owner-coverage"],
    refetchInterval: 60000,
  });

  const { data: jobs, isError: jobsError, refetch: refetchJobs } = useQuery<DiscoveryJob[]>({
    queryKey: ["/api/sdr/discovery/jobs"],
    refetchInterval: 10000,
  });

  const { data: keyStatus } = useQuery<KeyStatusData>({
    queryKey: ["/api/sdr/discovery/key-status"],
  });

  const runDiscoveryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sdr/discovery/run", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/jobs"] });
    },
    onError: (err: any) => {
      toast({ title: "Discovery run failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleNightlyMutation = useMutation({
    mutationFn: async (start: boolean) => {
      return apiRequest("POST", `/api/sdr/discovery/nightly/${start ? "start" : "stop"}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Toggle nightly failed", description: err.message, variant: "destructive" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<SearchMatrixConfig>) => {
      return apiRequest("PUT", "/api/sdr/discovery/config", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/config"] });
    },
    onError: (err: any) => {
      toast({ title: "Config update failed", description: err.message, variant: "destructive" });
    },
  });

  const [apolloTestResult, setApolloTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const testApolloMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sdr/discovery/test-source", { source: "apollo" });
      return res.json() as Promise<{ success: boolean; message: string; count?: number }>;
    },
    onSuccess: (data) => {
      setApolloTestResult({ success: data.success, message: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/source-status"] });
    },
    onError: (err: any) => {
      let msg = "Test failed";
      try {
        const parsed = JSON.parse(err.message?.replace(/^\d+: /, "") || "{}");
        msg = parsed.message || err.message || msg;
      } catch {
        msg = err.message || msg;
      }
      setApolloTestResult({ success: false, message: msg });
    },
  });

  const runPilotMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sdr/discovery/pilot", {
        limit: pilotLimit,
        sources: pilotSources,
      });
      return res.json() as Promise<{ message: string; jobId: number; safeLimit: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Pilot started",
        description: `Job #${data.jobId} — cap: ${data.safeLimit} results`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/discovery/source-performance"] });
    },
    onError: (err: any) => {
      toast({ title: "Pilot failed", description: err.message, variant: "destructive" });
    },
  });

  const togglePilotSource = (src: string) => {
    setPilotSources(prev =>
      prev.includes(src) ? prev.filter(s => s !== src) : [...prev, src]
    );
  };

  const hasPaidKey = keyStatus && (keyStatus.serper || keyStatus.outscraper || keyStatus.apify);

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (statsError) {
    return (
      <Card data-testid="card-discovery-error">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Failed to load discovery data</p>
          <Button variant="outline" size="sm" onClick={() => refetchStats()} data-testid="btn-retry-discovery">
            <RefreshCw className="w-4 h-4 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const todayStats = stats?.today || { rawFound: 0, newInserted: 0, duplicatesSkipped: 0, enrichmentQueued: 0, jobCount: 0, dedupRate: 0 };
  const weekStats = stats?.week || { rawFound: 0, newInserted: 0, duplicatesSkipped: 0, enrichmentQueued: 0, jobCount: 0 };

  const pilotJobs = (jobs || []).filter(j => j.triggerType === "pilot");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status?.discoveryRunning && (
            <Badge variant="secondary" className="animate-pulse" data-testid="badge-discovery-running">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Discovery Running
            </Badge>
          )}
          {status?.nightlySchedulerActive && (
            <Badge variant="outline" data-testid="badge-nightly-active">
              <Clock className="w-3 h-3 mr-1" />
              Nightly Active (2 AM EST)
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
            data-testid="btn-toggle-config"
          >
            <Settings className="w-4 h-4 mr-1" />
            Config
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleNightlyMutation.mutate(!status?.nightlySchedulerActive)}
            disabled={toggleNightlyMutation.isPending}
            data-testid="btn-toggle-nightly"
          >
            {status?.nightlySchedulerActive ? (
              <><Square className="w-4 h-4 mr-1" />Stop Nightly</>
            ) : (
              <><Clock className="w-4 h-4 mr-1" />Start Nightly</>
            )}
          </Button>
          <Button
            size="sm"
            onClick={() => runDiscoveryMutation.mutate()}
            disabled={runDiscoveryMutation.isPending || status?.discoveryRunning}
            data-testid="btn-run-discovery"
          >
            {runDiscoveryMutation.isPending || status?.discoveryRunning ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Running...</>
            ) : (
              <><Play className="w-4 h-4 mr-1" />Run Discovery</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card data-testid="card-discovery-raw">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Found Today</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-raw">{todayStats.rawFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-new">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-green-600" />
              <span className="text-xs text-muted-foreground">New Inserted</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-new">{todayStats.newInserted}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-dupes">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-orange-600" />
              <span className="text-xs text-muted-foreground">Duplicates</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-dupes">{todayStats.duplicatesSkipped}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-dedup-rate">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">Dedup Rate</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-dedup-rate">{todayStats.dedupRate}%</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-enrichment">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-muted-foreground">Enrichment Queue</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-enrichment">{todayStats.enrichmentQueued}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-discovery-week">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-muted-foreground">This Week</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-discovery-week">{weekStats.newInserted}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-owner-coverage">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-teal-600" />
              <span className="text-xs text-muted-foreground">Owner Email</span>
            </div>
            <div className="text-2xl font-bold" data-testid="value-owner-coverage">
              {ownerCoverage ? `${ownerCoverage.coveragePct}%` : "—"}
            </div>
            {ownerCoverage && (
              <div className="text-xs text-muted-foreground mt-0.5" data-testid="value-owner-coverage-detail">
                {ownerCoverage.merchantsWithEmail} / {ownerCoverage.totalMerchants}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showConfig && config && (
        <DiscoveryConfigCard
          config={config}
          sourceStatus={sourceStatus}
          updateDataSources={(next) => updateConfigMutation.mutate({ dataSources: next })}
          apolloTestResult={apolloTestResult}
          setApolloTestResult={setApolloTestResult}
          testApolloPending={testApolloMutation.isPending}
          onTestApollo={() => testApolloMutation.mutate()}
        />
      )}

      {/* API Key Readiness Card */}
      <Card data-testid="card-key-status">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Key className="w-4 h-4" />
            API Key Readiness
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { key: "serper", label: "Serper" },
              { key: "outscraper", label: "Outscraper" },
              { key: "apify", label: "Apify" },
              { key: "apollo", label: "Apollo" },
              { key: "zeroBounce", label: "ZeroBounce" },
              { key: "osm", label: "OSM (free)", alwaysGreen: true },
            ].map(({ key, label, alwaysGreen }) => {
              const active = alwaysGreen || (keyStatus ? (keyStatus as any)[key] === true : false);
              return (
                <div key={key} className="flex items-center gap-2 text-sm" data-testid={`key-status-${key}`}>
                  {active ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3" data-testid="text-key-restart-note">
            Newly added Replit Secrets require a server restart to take effect.
          </p>
        </CardContent>
      </Card>

      {/* Run Pilot Section */}
      <Card data-testid="card-run-pilot">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Run Pilot Discovery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pilot-limit" className="text-xs">Result Limit (1–50)</Label>
              <Input
                id="pilot-limit"
                type="number"
                min={1}
                max={50}
                value={pilotLimit}
                onChange={e => setPilotLimit(Math.min(50, Math.max(1, Number(e.target.value))))}
                className="w-24 h-8 text-sm"
                data-testid="input-pilot-limit"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paid Sources</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAID_SOURCES.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2" data-testid={`checkbox-source-${key}`}>
                  <Checkbox
                    id={`pilot-src-${key}`}
                    checked={pilotSources.includes(key)}
                    onCheckedChange={() => togglePilotSource(key)}
                  />
                  <Label htmlFor={`pilot-src-${key}`} className="text-sm cursor-pointer">{label}</Label>
                  {keyStatus && !(keyStatus as any)[key] && (
                    <Badge variant="outline" className="text-[10px] px-1">No key</Badge>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 col-span-full" data-testid="checkbox-source-apollo-note">
                <span className="text-xs text-muted-foreground italic">Apollo — paid B2B/person-contact source (runs as enrichment only, not merchant discovery)</span>
              </div>
            </div>

            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-3">Free Sources</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FREE_SOURCES.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2" data-testid={`checkbox-source-${key}`}>
                  <Checkbox
                    id={`pilot-src-${key}`}
                    checked={pilotSources.includes(key)}
                    onCheckedChange={() => togglePilotSource(key)}
                  />
                  <Label htmlFor={`pilot-src-${key}`} className="text-sm cursor-pointer">{label}</Label>
                  <Badge variant="secondary" className="text-[10px] px-1">Free</Badge>
                </div>
              ))}
            </div>
          </div>

          {!hasPaidKey && pilotSources.some(s => PAID_SOURCES.map(p => p.key).includes(s)) && (
            <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-no-paid-keys-warning">
              Configure at least one API key to run a paid source pilot.
            </p>
          )}

          <Button
            size="sm"
            onClick={() => runPilotMutation.mutate()}
            disabled={runPilotMutation.isPending || pilotSources.length === 0}
            data-testid="btn-run-pilot"
          >
            {runPilotMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Starting...</>
            ) : (
              <><FlaskConical className="w-4 h-4 mr-1" />Run Pilot ({Math.min(pilotLimit, 50)} max results)</>
            )}
          </Button>

          {pilotJobs.length > 0 && (
            <div className="space-y-2 mt-3">
              <p className="text-xs font-medium text-muted-foreground">Pilot Jobs</p>
              {pilotJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="border rounded-lg p-3 space-y-1" data-testid={`pilot-job-${job.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Pilot #{job.id}</span>
                    <Badge variant={
                      job.status === "completed" ? "secondary" :
                      job.status === "running" ? "outline" :
                      job.status === "failed" ? "destructive" : "secondary"
                    } className="text-xs">
                      {job.status === "running" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                      {job.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300">
                      Manual Review Required
                    </Badge>
                  </div>
                  {job.dataSources && job.dataSources.length > 0 && (
                    <p className="text-xs text-muted-foreground">Sources: {job.dataSources.join(", ")}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{job.rawFound ?? 0} found</span>
                    <span className="text-green-600">{job.newInserted ?? 0} new</span>
                    <span className="text-orange-600">{job.duplicatesSkipped ?? 0} dupes</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source Performance Panel */}
      <SourcePerformancePanel />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-discovery-by-vertical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              By Vertical (Today)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.byVertical || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No data yet</div>
            ) : (
              <div className="space-y-2">
                {(stats?.byVertical || []).map((v) => (
                  <div key={v.vertical} className="flex items-center justify-between text-sm" data-testid={`row-vertical-${v.vertical}`}>
                    <span className="text-muted-foreground">{v.vertical}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{v.newCount} new</span>
                      <span className="text-xs text-muted-foreground">/ {v.count} found</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-discovery-by-metro">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              By Metro (Today)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.byMetro || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No data yet</div>
            ) : (
              <div className="space-y-2">
                {(stats?.byMetro || []).map((m) => (
                  <div key={m.metro} className="flex items-center justify-between text-sm" data-testid={`row-metro-${m.metro}`}>
                    <span className="text-muted-foreground">{m.metro}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.newCount} new</span>
                      <span className="text-xs text-muted-foreground">/ {m.count} found</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-discovery-sources">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Data Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(["serper", "outscraper", "apify", "apollo"] as const).map((src) => {
                const srcData = sourceStatus?.[src as keyof SourceStatusData] as { configured: boolean; usage: any } | undefined;
                const usage = srcData?.usage;
                const calls = src === "apify" ? usage?.totalRuns : usage?.totalCalls;
                const records = src === "apify" ? usage?.businessesFound : src === "apollo" ? usage?.contactsFound : usage?.businessesFound;
                const cost = usage?.estimatedCost;
                return (
                  <div key={src} className="space-y-1" data-testid={`row-source-${src}`}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {srcData?.configured ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <XCircle className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="capitalize font-medium">{src}</span>
                        {src === "apollo" && <span className="text-[10px] text-muted-foreground">(B2B contacts)</span>}
                      </div>
                      <Badge variant={srcData?.configured ? "secondary" : "outline"} className="text-xs">
                        {srcData?.configured ? "Active" : "No key"}
                      </Badge>
                    </div>
                    {usage && (
                      <div className="flex gap-3 text-xs text-muted-foreground pl-6">
                        <span data-testid={`stat-${src}-calls`}>{calls ?? 0} calls</span>
                        <span data-testid={`stat-${src}-records`}>{records ?? 0} records</span>
                        <span data-testid={`stat-${src}-cost`}>${(cost ?? 0).toFixed(2)} est.</span>
                      </div>
                    )}
                    {src === "apollo" && (
                      <div className="pl-6 flex flex-col gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-fit text-xs h-6 px-2"
                          data-testid="btn-test-apollo-card"
                          disabled={testApolloMutation.isPending}
                          onClick={() => {
                            setApolloTestResult(null);
                            testApolloMutation.mutate();
                          }}
                        >
                          {testApolloMutation.isPending ? (
                            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Testing...</>
                          ) : (
                            <><Zap className="w-3 h-3 mr-1" />Test Apollo Connection</>
                          )}
                        </Button>
                        {apolloTestResult && (
                          <p
                            data-testid="text-apollo-test-result-card"
                            className={`text-xs flex items-center gap-1 ${apolloTestResult.success ? "text-green-600" : "text-destructive"}`}
                          >
                            {apolloTestResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {apolloTestResult.message}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-discovery-jobs">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Job History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobsError ? (
            <div className="text-center py-4" data-testid="panel-discovery-jobs-error">
              <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-1" />
              <p className="text-sm text-muted-foreground mb-2">Failed to load discovery jobs</p>
              <Button variant="outline" size="sm" onClick={() => refetchJobs()} data-testid="btn-retry-discovery-jobs">
                <RefreshCw className="w-3 h-3 mr-1" /> Retry
              </Button>
            </div>
          ) : (!jobs || jobs.length === 0) ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No discovery jobs yet. Click "Run Discovery" to start finding leads.
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 10).map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`job-${job.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Job #{job.id}</span>
                      <Badge variant={
                        job.status === "completed" ? "secondary" :
                        job.status === "running" ? "outline" :
                        job.status === "failed" ? "destructive" : "secondary"
                      } className="text-xs" data-testid={`badge-job-status-${job.id}`}>
                        {job.status === "running" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        {job.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{job.triggerType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="font-medium">{job.rawFound || 0}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-green-600">{job.newInserted || 0}</div>
                      <div className="text-xs text-muted-foreground">New</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-orange-600">{job.duplicatesSkipped || 0}</div>
                      <div className="text-xs text-muted-foreground">Dupes</div>
                    </div>
                    {(job.errorsCount || 0) > 0 && (
                      <div className="text-center">
                        <div className="font-medium text-red-600">{job.errorsCount}</div>
                        <div className="text-xs text-muted-foreground">Errors</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
