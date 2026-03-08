import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Zap, RefreshCw, Mail, Phone, Target, TrendingUp, Users, Building2,
  Play, Square, Loader2, CheckCircle, Send, BarChart3, Pen, Settings,
  Download, Upload, ArrowRightLeft, AlertTriangle, Clock, Briefcase, Database
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OutreachStatus {
  entities: {
    total: number; enriched: number; pending: number; withEmail: number; withPhone: number;
    hot: number; warm: number; cold: number; unqualified: number; classified: number; pendingPromotion: number;
  };
  prospects: { total: number; withEmail: number; converted: number; qualified: number };
  contacts: { total: number; fromSunbiz: number; newLeads: number; syncedToGhl: number };
  deals: { total: number; fromSunbiz: number; newLead: number; contacted: number; qualified: number; won: number };
  activeCampaigns: number;
  verticalBreakdown: Record<string, number>;
  ghlSync: { configured: boolean; totalContacts: number; syncedToGhl: number; unsyncedToGhl: number; lastSyncTo: any; lastSyncFrom: any };
  importProgress: { status: string; totalProcessed?: number; totalImported?: number; totalDuplicates?: number; totalSkipped?: number; error?: string };
  cordataProgress: { status: string; totalProcessed?: number; totalUpdated?: number; totalNew?: number; totalSkipped?: number; error?: string };
  enrichmentProgress: { status: string; total?: number; processed?: number; classified?: number; emailsFound?: number; phonesFound?: number; errors?: number };
  lastOutreachRun: any;
  workerRunning: boolean;
  workerStatus: any;
}

interface SignatureData {
  signature: { name: string; title: string; phone: string; email: string; calendlyLink?: string };
  html: string;
}

export default function OutreachCommand() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [enrichLimit, setEnrichLimit] = useState("50");
  const [importLimit, setImportLimit] = useState("");
  const [workerInterval, setWorkerInterval] = useState("60");
  const [editingSig, setEditingSig] = useState<string | null>(null);
  const [sigForm, setSigForm] = useState({ name: "", title: "", phone: "", email: "", calendlyLink: "" });

  const { data: status, isLoading } = useQuery<OutreachStatus>({
    queryKey: ["/api/outreach/status"],
    refetchInterval: 10000,
  });

  const { data: signatures } = useQuery<Record<string, SignatureData>>({
    queryKey: ["/api/email-signatures"],
  });

  const importMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/import-corevt-full", {
      maxRecords: importLimit ? Number(importLimit) : undefined,
      onlyActive: true,
    }),
    onSuccess: () => toast({ title: "Full import started", description: "Streaming 9.5GB corevt file. This will take a while." }),
    onError: () => toast({ title: "Error", description: "Failed to start import", variant: "destructive" }),
  });

  const cordataImportMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/import-cordata", {
      download: true,
    }),
    onSuccess: () => toast({ title: "Cordata import started", description: "Downloading 1.7GB cordata.zip from FL Sunbiz SFTP. This adds officers, registered agents, FEI/EIN numbers, and annual reports." }),
    onError: () => toast({ title: "Error", description: "Failed to start cordata import", variant: "destructive" }),
  });

  const reEnrichMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/re-enrich-all", { limit: Number(enrichLimit) }),
    onSuccess: () => toast({ title: "Re-enrichment started", description: `Processing up to ${enrichLimit} entities with AI` }),
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const promoteMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/promote-qualified"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Promotion complete", description: `${data.promoted} promoted, ${data.dealsCreated} deals created` });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const runDailyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/run-daily"),
    onSuccess: () => toast({ title: "Daily outreach started" }),
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const startWorkerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/start-worker", { intervalMinutes: Number(workerInterval) }),
    onSuccess: () => { toast({ title: "Outreach worker started" }); queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const stopWorkerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/stop-worker"),
    onSuccess: () => { toast({ title: "Worker stopped" }); queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const syncToGhlMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ghl/sync-all-to-ghl"),
    onSuccess: () => toast({ title: "GHL sync started", description: "Pushing all unsynced contacts to GoHighLevel" }),
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const syncFromGhlMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ghl/sync-all-from-ghl"),
    onSuccess: () => toast({ title: "GHL pull started", description: "Pulling contacts from GoHighLevel" }),
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const saveSignatureMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: any }) => apiRequest("PUT", `/api/email-signatures/${type}`, data),
    onSuccess: () => { toast({ title: "Signature saved" }); queryClient.invalidateQueries({ queryKey: ["/api/email-signatures"] }); setEditingSig(null); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const s = status;
  const imp = s.importProgress;
  const cord = s.cordataProgress || { status: "idle" };
  const enr = s.enrichmentProgress;

  return (
    <div className="space-y-6" data-testid="outreach-command-center">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Outreach Command Center</h1>
          <p className="text-muted-foreground text-sm">Full pipeline: Import → Enrich → Classify → Promote → Outreach → Close</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {s.workerRunning ? (
            <Button variant="outline" onClick={() => stopWorkerMutation.mutate()} disabled={stopWorkerMutation.isPending} className="gap-2" data-testid="button-stop-worker">
              <Square className="w-4 h-4" /> Stop Worker
            </Button>
          ) : (
            <Button onClick={() => startWorkerMutation.mutate()} disabled={startWorkerMutation.isPending} className="gap-2" data-testid="button-start-worker">
              <Play className="w-4 h-4" /> Start Worker
            </Button>
          )}
          <Button onClick={() => runDailyMutation.mutate()} disabled={runDailyMutation.isPending} variant="secondary" className="gap-2" data-testid="button-run-daily">
            {runDailyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Run Now
          </Button>
        </div>
      </div>

      {s.workerRunning && (
        <Alert data-testid="alert-worker-running">
          <Play className="h-4 w-4" />
          <AlertDescription>
            Automation worker is <strong>running</strong>. Enriching entities every 30 min, outreach every {s.workerStatus?.intervalMinutes || 60} min.
            {s.lastOutreachRun && <span className="text-muted-foreground"> Last run: {new Date(s.lastOutreachRun.timestamp).toLocaleString()} ({s.lastOutreachRun.sent || 0} sent)</span>}
          </AlertDescription>
        </Alert>
      )}

      {(imp.status === "running") && (
        <Alert data-testid="alert-import-running">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Import running: <strong>{(imp.totalImported || 0).toLocaleString()}</strong> imported, {(imp.totalDuplicates || 0).toLocaleString()} duplicates, {(imp.totalSkipped || 0).toLocaleString()} skipped
          </AlertDescription>
        </Alert>
      )}

      {(enr.status === "running") && (
        <Alert data-testid="alert-enrichment-running">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Enrichment: <strong>{enr.processed || 0}/{enr.total || 0}</strong> processed, {enr.emailsFound || 0} emails, {enr.phonesFound || 0} phones, {enr.classified || 0} classified
            {enr.total ? <Progress value={((enr.processed || 0) / enr.total) * 100} className="mt-2 h-2" /> : null}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Building2} color="blue" value={s.entities.total.toLocaleString()} label="FL Entities" testId="card-total-entities" />
        <StatCard icon={Target} color="green" value={s.entities.classified} label="Classified" testId="card-classified" />
        <StatCard icon={Mail} color="purple" value={s.entities.withEmail} label="With Email" testId="card-with-email" />
        <StatCard icon={Users} color="amber" value={s.contacts.total} label="CRM Contacts" testId="card-contacts" />
        <StatCard icon={Briefcase} color="indigo" value={s.deals.total} label="Active Deals" testId="card-deals" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <ScoreCard value={s.entities.hot} label="Hot" emoji="🔥" color="red" />
        <ScoreCard value={s.entities.warm} label="Warm" emoji="🟠" color="orange" />
        <ScoreCard value={s.entities.cold} label="Cold" emoji="❄️" color="blue" />
        <ScoreCard value={s.entities.unqualified} label="Unqualified" emoji="⛔" color="gray" />
        <ScoreCard value={s.entities.pendingPromotion} label="Ready" emoji="📤" color="green" />
        <ScoreCard value={s.contacts.syncedToGhl} label="In GHL" emoji="🔗" color="indigo" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" data-testid="tab-overview">Pipeline</TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-import">Import</TabsTrigger>
          <TabsTrigger value="enrichment" data-testid="tab-enrichment">Enrich & Classify</TabsTrigger>
          <TabsTrigger value="ghl" data-testid="tab-ghl">GHL Sync</TabsTrigger>
          <TabsTrigger value="automation" data-testid="tab-automation">Automation</TabsTrigger>
          <TabsTrigger value="signatures" data-testid="tab-signatures">Signatures</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> Sunbiz Entities</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Total" value={s.entities.total.toLocaleString()} />
                <Row label="Enriched" value={s.entities.enriched} />
                <Row label="Pending" value={s.entities.pending} highlight />
                <Row label="With Email" value={s.entities.withEmail} color="green" />
                <Row label="With Phone" value={s.entities.withPhone} color="green" />
                <Row label="Classified" value={s.entities.classified} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Prospects</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Total" value={s.prospects.total} />
                <Row label="With Email" value={s.prospects.withEmail} />
                <Row label="Qualified (A/B)" value={s.prospects.qualified} color="green" />
                <Row label="Converted" value={s.prospects.converted} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Contacts</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Total" value={s.contacts.total} />
                <Row label="From Sunbiz" value={s.contacts.fromSunbiz} />
                <Row label="New Leads" value={s.contacts.newLeads} color="blue" />
                <Row label="Synced to GHL" value={s.contacts.syncedToGhl} color="green" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="w-4 h-4" /> Deals</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Total" value={s.deals.total} />
                <Row label="New Lead" value={s.deals.newLead} color="blue" />
                <Row label="Contacted" value={s.deals.contacted} />
                <Row label="Qualified" value={s.deals.qualified} color="green" />
                <Row label="Won" value={s.deals.won} color="green" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Industry Classification</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(s.verticalBreakdown).sort((a, b) => b[1] - a[1]).map(([v, c]) => (
                  <Badge key={v} variant={v === "Unclassified" ? "outline" : "secondary"} className="no-default-hover-elevate" data-testid={`badge-vertical-${v.toLowerCase().replace(/\s+/g, '-')}`}>
                    {v}: {c.toLocaleString()}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sales Pipeline Funnel</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <FunnelStep label="Entities" value={s.entities.total} color="bg-slate-200 dark:bg-slate-700" />
                <span className="text-muted-foreground">→</span>
                <FunnelStep label="Enriched" value={s.entities.enriched} color="bg-blue-100 dark:bg-blue-900" />
                <span className="text-muted-foreground">→</span>
                <FunnelStep label="Hot/Warm" value={s.entities.hot + s.entities.warm} color="bg-orange-100 dark:bg-orange-900" />
                <span className="text-muted-foreground">→</span>
                <FunnelStep label="Contacts" value={s.contacts.fromSunbiz} color="bg-green-100 dark:bg-green-900" />
                <span className="text-muted-foreground">→</span>
                <FunnelStep label="Deals" value={s.deals.fromSunbiz} color="bg-purple-100 dark:bg-purple-900" />
                <span className="text-muted-foreground">→</span>
                <FunnelStep label="Won" value={s.deals.won} color="bg-emerald-100 dark:bg-emerald-900" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Upload className="w-5 h-5" /> Full Florida Sunbiz Import</CardTitle>
              <p className="text-sm text-muted-foreground">
                Import from the 9.5 GB corevt.zip file containing the entire Florida Sunbiz corporate database. Currently <strong>{s.entities.total.toLocaleString()}</strong> entities in database.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="import-limit">Max Records (leave blank for all)</Label>
                  <Input id="import-limit" type="number" placeholder="Unlimited" value={importLimit} onChange={(e) => setImportLimit(e.target.value)} className="w-48" data-testid="input-import-limit" />
                </div>
                <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending || imp.status === "running"} className="gap-2" data-testid="button-start-import">
                  {importMutation.isPending || imp.status === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {imp.status === "running" ? "Import Running..." : "Start Full Import"}
                </Button>
              </div>

              {imp.status === "running" && (
                <div className="rounded-lg border p-4 bg-muted/50 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Processed: <strong>{(imp.totalProcessed || 0).toLocaleString()}</strong></span>
                    <span>Imported: <strong className="text-green-600">{(imp.totalImported || 0).toLocaleString()}</strong></span>
                    <span>Duplicates: <strong>{(imp.totalDuplicates || 0).toLocaleString()}</strong></span>
                    <span>Skipped: <strong>{(imp.totalSkipped || 0).toLocaleString()}</strong></span>
                  </div>
                </div>
              )}

              {imp.status === "complete" && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Import complete: <strong>{(imp.totalImported || 0).toLocaleString()}</strong> imported, {(imp.totalDuplicates || 0).toLocaleString()} duplicates skipped
                  </AlertDescription>
                </Alert>
              )}

              {imp.status === "error" && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Import error: {imp.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Database className="w-5 h-5" /> Sunbiz Cordata Import (Officers, Agents, EIN)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Download the 1.7 GB quarterly corporate data file directly from FL Sunbiz SFTP. This adds <strong>officer names</strong>, <strong>registered agents</strong>, <strong>FEI/EIN numbers</strong>, and <strong>annual report dates</strong> to all existing entities. Up to 6 officers per entity with titles, names, and addresses.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => cordataImportMutation.mutate()}
                disabled={cordataImportMutation.isPending || cord.status === "downloading" || cord.status === "processing"}
                className="gap-2"
                data-testid="button-start-cordata-import"
              >
                {cordataImportMutation.isPending || cord.status === "downloading" || cord.status === "processing"
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />}
                {cord.status === "downloading" ? "Downloading from SFTP..." :
                 cord.status === "processing" ? "Processing Records..." :
                 "Download & Import Cordata"}
              </Button>

              {(cord.status === "downloading" || cord.status === "processing") && (
                <div className="rounded-lg border p-4 bg-muted/50 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Status: <strong className="capitalize">{cord.status}</strong></span>
                    {cord.totalProcessed !== undefined && <span>Processed: <strong>{(cord.totalProcessed).toLocaleString()}</strong></span>}
                    {cord.totalUpdated !== undefined && <span>Updated: <strong className="text-blue-600">{(cord.totalUpdated).toLocaleString()}</strong></span>}
                    {cord.totalNew !== undefined && <span>New: <strong className="text-green-600">{(cord.totalNew).toLocaleString()}</strong></span>}
                  </div>
                </div>
              )}

              {cord.status === "complete" && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Cordata import complete: <strong>{(cord.totalUpdated || 0).toLocaleString()}</strong> entities updated with officer/agent/EIN data, <strong>{(cord.totalNew || 0).toLocaleString()}</strong> new entities added
                  </AlertDescription>
                </Alert>
              )}

              {cord.status === "error" && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Cordata import error: {cord.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enrichment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><RefreshCw className="w-5 h-5" /> AI Enrichment & Classification</CardTitle>
              <p className="text-sm text-muted-foreground">
                Re-process entities: discover websites, scrape contact/about pages, extract emails and phones, AI-classify industry vertical, and score lead quality.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label>Batch Size</Label>
                  <Input type="number" value={enrichLimit} onChange={(e) => setEnrichLimit(e.target.value)} className="w-32" data-testid="input-enrich-limit" />
                </div>
                <Button onClick={() => reEnrichMutation.mutate()} disabled={reEnrichMutation.isPending || enr.status === "running"} className="gap-2" data-testid="button-re-enrich">
                  {reEnrichMutation.isPending || enr.status === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {enr.status === "running" ? "Enriching..." : "Re-Classify Entities"}
                </Button>
              </div>

              {enr.status === "running" && enr.total && (
                <div className="space-y-2">
                  <Progress value={((enr.processed || 0) / enr.total) * 100} className="h-2" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{enr.processed}/{enr.total} processed</span>
                    <span>{enr.classified} classified</span>
                    <span>{enr.emailsFound} emails</span>
                    <span>{enr.phonesFound} phones</span>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-4 bg-muted/50 text-sm space-y-2">
                <p className="font-medium">Enhanced Enrichment Pipeline:</p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  <li>Guesses and verifies websites using 10+ domain patterns per company</li>
                  <li>Scrapes homepage + /contact, /about, /team pages for deeper contact extraction</li>
                  <li>AI classifies each business by industry vertical (Restaurant, Retail, Healthcare, etc.)</li>
                  <li>Scores leads as Hot, Warm, Cold, or Unqualified for merchant processing potential</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" /> Promote to CRM Contacts</CardTitle>
              <p className="text-sm text-muted-foreground">
                Convert Hot and Warm entities with contact info into CRM Contacts and auto-create deals. {s.entities.pendingPromotion} ready.
              </p>
            </CardHeader>
            <CardContent>
              <Button onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending || s.entities.pendingPromotion === 0} className="gap-2" data-testid="button-promote">
                {promoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Promote {s.entities.pendingPromotion} Leads → Contacts + Deals
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ghl" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><ArrowRightLeft className="w-5 h-5" /> GoHighLevel 2-Way Sync</CardTitle>
              <p className="text-sm text-muted-foreground">
                Sync contacts and deals bidirectionally with GoHighLevel for email/SMS outreach, calendar booking, and document e-signatures.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-medium text-sm">Sync Status</h3>
                  <div className="space-y-1 text-sm">
                    <Row label="GHL Connected" value={s.ghlSync.configured ? "Yes" : "No"} color={s.ghlSync.configured ? "green" : "red"} />
                    <Row label="Total Contacts" value={s.ghlSync.totalContacts} />
                    <Row label="Synced to GHL" value={s.ghlSync.syncedToGhl} color="green" />
                    <Row label="Not Yet Synced" value={s.ghlSync.unsyncedToGhl} highlight />
                  </div>
                  {s.ghlSync.lastSyncTo && (
                    <p className="text-xs text-muted-foreground">Last push: {new Date(s.ghlSync.lastSyncTo.timestamp).toLocaleString()}</p>
                  )}
                  {s.ghlSync.lastSyncFrom && (
                    <p className="text-xs text-muted-foreground">Last pull: {new Date(s.ghlSync.lastSyncFrom.timestamp).toLocaleString()}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <Button onClick={() => syncToGhlMutation.mutate()} disabled={syncToGhlMutation.isPending || !s.ghlSync.configured} className="w-full gap-2" data-testid="button-sync-to-ghl">
                    {syncToGhlMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Push {s.ghlSync.unsyncedToGhl} Contacts → GHL
                  </Button>
                  <Button onClick={() => syncFromGhlMutation.mutate()} disabled={syncFromGhlMutation.isPending || !s.ghlSync.configured} variant="outline" className="w-full gap-2" data-testid="button-sync-from-ghl">
                    {syncFromGhlMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Pull Contacts from GHL
                  </Button>
                  {!s.ghlSync.configured && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Set GHL_API_KEY and GHL_LOCATION_ID to enable sync</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Zap className="w-5 h-5" /> Automated Outreach Pipeline</CardTitle>
              <p className="text-sm text-muted-foreground">
                Full autopilot: enrich entities → promote qualified → queue campaign emails → send 100/day via GHL → auto-create deals → auto-enroll in sequences.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Outreach Interval (minutes)</Label>
                    <Input type="number" value={workerInterval} onChange={(e) => setWorkerInterval(e.target.value)} className="w-32" data-testid="input-worker-interval" />
                  </div>
                  <div className="flex gap-2">
                    {s.workerRunning ? (
                      <Button variant="outline" onClick={() => stopWorkerMutation.mutate()} disabled={stopWorkerMutation.isPending} className="gap-2" data-testid="button-stop-worker-tab">
                        <Square className="w-4 h-4" /> Stop
                      </Button>
                    ) : (
                      <Button onClick={() => startWorkerMutation.mutate()} disabled={startWorkerMutation.isPending} className="gap-2" data-testid="button-start-worker-tab">
                        <Play className="w-4 h-4" /> Start Worker
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => runDailyMutation.mutate()} disabled={runDailyMutation.isPending} className="gap-2" data-testid="button-run-daily-tab">
                      {runDailyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Run Once
                    </Button>
                  </div>
                  {s.workerRunning && (
                    <Badge variant="secondary" className="no-default-hover-elevate gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Running
                    </Badge>
                  )}
                </div>
                <div className="rounded-lg border p-4 bg-muted/50 text-sm space-y-2">
                  <p className="font-medium">Full Lifecycle Pipeline:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                    <li>Enrich 50 unclassified entities per cycle (websites, emails, AI classification)</li>
                    <li>Promote hot/warm leads with contact info → CRM Contacts + Deals</li>
                    <li>Auto-sync new contacts to GoHighLevel</li>
                    <li>Queue campaign messages (100/day limit)</li>
                    <li>Send via GHL with email signatures</li>
                    <li>Auto-score, auto-route, auto-enroll in follow-up sequences</li>
                    <li>Track opens/replies, trigger stage changes</li>
                  </ol>
                </div>
              </div>

              {s.lastOutreachRun && (
                <div className="rounded-lg border p-4 space-y-1 text-sm">
                  <h3 className="font-medium flex items-center gap-2"><Clock className="w-4 h-4" /> Last Run: {new Date(s.lastOutreachRun.timestamp).toLocaleString()}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                    <div><span className="text-muted-foreground">Enriched:</span> <strong>{s.lastOutreachRun.enriched || 0}</strong></div>
                    <div><span className="text-muted-foreground">Promoted:</span> <strong>{s.lastOutreachRun.promoted || 0}</strong></div>
                    <div><span className="text-muted-foreground">Deals:</span> <strong>{s.lastOutreachRun.dealsCreated || 0}</strong></div>
                    <div><span className="text-muted-foreground">Queued:</span> <strong>{s.lastOutreachRun.queued || 0}</strong></div>
                    <div><span className="text-muted-foreground">Sent:</span> <strong>{s.lastOutreachRun.sent || 0}</strong></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Active Campaigns: {s.activeCampaigns}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {s.activeCampaigns === 0 ? (
                <p>No active campaigns. Create a campaign in the Campaigns page to start sending outreach.</p>
              ) : (
                <p>{s.activeCampaigns} campaign(s) actively queuing and sending messages.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signatures" className="space-y-4">
          {signatures && Object.entries(signatures).map(([type, data]) => (
            <Card key={type}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2 capitalize"><Pen className="w-5 h-5" /> {type} Signature</CardTitle>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => { setEditingSig(type); setSigForm({ name: data.signature.name, title: data.signature.title, phone: data.signature.phone, email: data.signature.email, calendlyLink: data.signature.calendlyLink || "" }); }} data-testid={`button-edit-sig-${type}`}>
                    <Settings className="w-3 h-3" /> Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg p-4 bg-white dark:bg-gray-950" data-testid={`sig-preview-${type}`}>
                  <div dangerouslySetInnerHTML={{ __html: data.html }} />
                </div>
              </CardContent>
            </Card>
          ))}

          {editingSig && (
            <Dialog open={!!editingSig} onOpenChange={() => setEditingSig(null)}>
              <DialogContent data-testid="dialog-edit-signature">
                <DialogHeader><DialogTitle className="capitalize">Edit {editingSig} Signature</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {["name", "title", "phone", "email", "calendlyLink"].map(field => (
                    <div key={field} className="space-y-1">
                      <Label className="capitalize">{field === "calendlyLink" ? "Calendar Link" : field}</Label>
                      <Input value={(sigForm as any)[field]} onChange={e => setSigForm(p => ({ ...p, [field]: e.target.value }))} data-testid={`input-sig-${field}`} />
                    </div>
                  ))}
                  <Button onClick={() => saveSignatureMutation.mutate({ type: editingSig, data: sigForm })} disabled={saveSignatureMutation.isPending} className="w-full gap-2" data-testid="button-save-signature">
                    {saveSignatureMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Save
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, color, value, label, testId }: { icon: any; color: string; value: any; label: string; testId: string }) {
  const colorClasses: Record<string, string> = {
    blue: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
    green: "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400",
    purple: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400",
    amber: "bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400",
    indigo: "bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400",
  };
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreCard({ value, label, emoji, color }: { value: number; label: string; emoji: string; color: string }) {
  const borderColors: Record<string, string> = {
    red: "border-red-200 dark:border-red-800", orange: "border-orange-200 dark:border-orange-800",
    blue: "border-blue-200 dark:border-blue-800", gray: "border-gray-200 dark:border-gray-700",
    green: "border-green-200 dark:border-green-800", indigo: "border-indigo-200 dark:border-indigo-800",
  };
  const textColors: Record<string, string> = {
    red: "text-red-600 dark:text-red-400", orange: "text-orange-600 dark:text-orange-400",
    blue: "text-blue-600 dark:text-blue-400", gray: "text-muted-foreground",
    green: "text-green-600 dark:text-green-400", indigo: "text-indigo-600 dark:text-indigo-400",
  };
  return (
    <Card className={borderColors[color]}>
      <CardContent className="p-2 text-center">
        <p className={`text-lg font-bold ${textColors[color]}`}>{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{emoji} {label}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, color, highlight }: { label: string; value: any; color?: string; highlight?: boolean }) {
  const textColor = color === "green" ? "text-green-600 dark:text-green-400" : color === "blue" ? "text-blue-600 dark:text-blue-400" : color === "red" ? "text-red-600 dark:text-red-400" : "";
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${textColor} ${highlight ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function FunnelStep({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} rounded-lg px-3 py-2 text-center min-w-[80px]`}>
      <p className="font-bold text-sm">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
