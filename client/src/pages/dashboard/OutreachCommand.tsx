import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, RefreshCw, Mail, Phone, Target, TrendingUp, Users, Building2,
  Play, Square, Settings, Loader2, CheckCircle, AlertTriangle,
  Send, BarChart3, Globe, Briefcase, Pen
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OutreachStatus {
  entities: {
    total: number;
    enriched: number;
    withEmail: number;
    withPhone: number;
    hot: number;
    warm: number;
    cold: number;
    unqualified: number;
    classified: number;
    pendingPromotion: number;
  };
  prospects: {
    total: number;
    withEmail: number;
    converted: number;
    qualified: number;
  };
  contacts: {
    total: number;
    fromSunbiz: number;
    newLeads: number;
  };
  activeCampaigns: number;
  verticalBreakdown: Record<string, number>;
}

interface SignatureData {
  signature: { name: string; title: string; phone: string; email: string; calendlyLink?: string };
  html: string;
  plainText: string;
}

export default function OutreachCommand() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [enrichLimit, setEnrichLimit] = useState("50");
  const [workerInterval, setWorkerInterval] = useState("60");
  const [editingSig, setEditingSig] = useState<string | null>(null);
  const [sigForm, setSigForm] = useState({ name: "", title: "", phone: "", email: "", calendlyLink: "" });

  const { data: status, isLoading } = useQuery<OutreachStatus>({
    queryKey: ["/api/outreach/status"],
    refetchInterval: 15000,
  });

  const { data: signatures } = useQuery<Record<string, SignatureData>>({
    queryKey: ["/api/email-signatures"],
  });

  const reEnrichMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/re-enrich-all", { limit: Number(enrichLimit) }),
    onSuccess: () => {
      toast({ title: "Re-enrichment started", description: `Processing up to ${enrichLimit} entities with AI classification` });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] }), 5000);
    },
    onError: () => toast({ title: "Error", description: "Failed to start re-enrichment", variant: "destructive" }),
  });

  const promoteMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sunbiz/promote-qualified"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Promotion complete", description: `${data.promoted} leads promoted to contacts` });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to promote leads", variant: "destructive" }),
  });

  const runDailyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/run-daily"),
    onSuccess: () => {
      toast({ title: "Daily outreach started", description: "Enriching, promoting, and sending messages" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/outreach/status"] }), 10000);
    },
    onError: () => toast({ title: "Error", description: "Failed to start outreach", variant: "destructive" }),
  });

  const startWorkerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/start-worker", { intervalMinutes: Number(workerInterval) }),
    onSuccess: () => toast({ title: "Outreach worker started", description: `Will run every ${workerInterval} minutes` }),
    onError: () => toast({ title: "Error", description: "Failed to start worker", variant: "destructive" }),
  });

  const stopWorkerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/stop-worker"),
    onSuccess: () => toast({ title: "Outreach worker stopped" }),
    onError: () => toast({ title: "Error", description: "Failed to stop worker", variant: "destructive" }),
  });

  const saveSignatureMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: any }) => apiRequest("PUT", `/api/email-signatures/${type}`, data),
    onSuccess: () => {
      toast({ title: "Signature saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-signatures"] });
      setEditingSig(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to save signature", variant: "destructive" }),
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

  const s = status!;

  return (
    <div className="space-y-6" data-testid="outreach-command-center">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Outreach Command Center</h1>
          <p className="text-muted-foreground text-sm">Automated prospecting, enrichment, classification, and daily outreach</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runDailyMutation.mutate()}
            disabled={runDailyMutation.isPending}
            className="gap-2"
            data-testid="button-run-daily"
          >
            {runDailyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Run Daily Outreach
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-entities">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-entities">{s.entities.total}</p>
                <p className="text-xs text-muted-foreground">Florida Entities</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-classified">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Target className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-classified">{s.entities.classified}</p>
                <p className="text-xs text-muted-foreground">Classified</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-with-email">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                <Mail className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-with-email">{s.entities.withEmail}</p>
                <p className="text-xs text-muted-foreground">With Email</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-with-phone">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                <Phone className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-with-phone">{s.entities.withPhone}</p>
                <p className="text-xs text-muted-foreground">With Phone</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-red-200 dark:border-red-800" data-testid="card-hot-leads">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-hot">{s.entities.hot}</p>
            <p className="text-xs text-muted-foreground">🔥 Hot</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 dark:border-orange-800" data-testid="card-warm-leads">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-warm">{s.entities.warm}</p>
            <p className="text-xs text-muted-foreground">🟠 Warm</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 dark:border-blue-800" data-testid="card-cold-leads">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-cold">{s.entities.cold}</p>
            <p className="text-xs text-muted-foreground">❄️ Cold</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 dark:border-gray-700" data-testid="card-unqualified">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-muted-foreground" data-testid="text-unqualified">{s.entities.unqualified}</p>
            <p className="text-xs text-muted-foreground">⛔ Unqualified</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 dark:border-green-800" data-testid="card-pending-promotion">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-pending">{s.entities.pendingPromotion}</p>
            <p className="text-xs text-muted-foreground">📤 Ready to Promote</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Pipeline Overview</TabsTrigger>
          <TabsTrigger value="enrichment" data-testid="tab-enrichment">Enrichment & Classification</TabsTrigger>
          <TabsTrigger value="automation" data-testid="tab-automation">Automation Controls</TabsTrigger>
          <TabsTrigger value="signatures" data-testid="tab-signatures">Email Signatures</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4" /> Sunbiz Entities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium">{s.entities.total}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Enriched</span><span className="font-medium">{s.entities.enriched}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Classified</span><span className="font-medium">{s.entities.classified}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">With Email</span><span className="font-medium text-green-600">{s.entities.withEmail}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">With Phone</span><span className="font-medium text-green-600">{s.entities.withPhone}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" /> Prospects
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium">{s.prospects.total}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">With Email</span><span className="font-medium">{s.prospects.withEmail}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Qualified (A/B)</span><span className="font-medium text-green-600">{s.prospects.qualified}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Converted</span><span className="font-medium">{s.prospects.converted}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Contacts & Campaigns
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Contacts</span><span className="font-medium">{s.contacts.total}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">From Sunbiz</span><span className="font-medium">{s.contacts.fromSunbiz}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">New Leads</span><span className="font-medium text-blue-600">{s.contacts.newLeads}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Active Campaigns</span><span className="font-medium">{s.activeCampaigns}</span></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Industry Classification Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(s.verticalBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([vertical, count]) => (
                    <Badge
                      key={vertical}
                      variant={vertical === "Unclassified" ? "outline" : "secondary"}
                      className="no-default-hover-elevate no-default-active-elevate"
                      data-testid={`badge-vertical-${vertical.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {vertical}: {count}
                    </Badge>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enrichment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="w-5 h-5" /> AI Enrichment & Classification
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Re-process Sunbiz entities with AI to discover websites, extract emails and phone numbers, classify industry verticals, and score lead quality.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="enrich-limit">Batch Size</Label>
                  <Input
                    id="enrich-limit"
                    type="number"
                    value={enrichLimit}
                    onChange={(e) => setEnrichLimit(e.target.value)}
                    className="w-32"
                    data-testid="input-enrich-limit"
                  />
                </div>
                <Button
                  onClick={() => reEnrichMutation.mutate()}
                  disabled={reEnrichMutation.isPending}
                  className="gap-2"
                  data-testid="button-re-enrich"
                >
                  {reEnrichMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Re-Classify All Entities
                </Button>
              </div>
              <div className="rounded-lg border p-4 bg-muted/50 space-y-2 text-sm">
                <p className="font-medium">What this does:</p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  <li>Guesses and verifies business websites from company names</li>
                  <li>Scrapes websites for emails and phone numbers</li>
                  <li>AI classifies each business by industry vertical</li>
                  <li>Scores leads as Hot, Warm, Cold, or Unqualified</li>
                  <li>Identifies the best decision-maker contact</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" /> Promote Qualified Leads
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Convert Hot and Warm Sunbiz entities with contact info into CRM Contacts for active outreach.
                Currently {s.entities.pendingPromotion} entities ready to promote.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => promoteMutation.mutate()}
                disabled={promoteMutation.isPending || s.entities.pendingPromotion === 0}
                className="gap-2"
                data-testid="button-promote"
              >
                {promoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Promote {s.entities.pendingPromotion} Qualified Leads
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5" /> Daily Outreach Worker
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Automated pipeline: enrich entities → promote qualified → queue campaign emails → send outreach. Target: 100 messages/day.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="worker-interval">Run Interval (minutes)</Label>
                    <Input
                      id="worker-interval"
                      type="number"
                      value={workerInterval}
                      onChange={(e) => setWorkerInterval(e.target.value)}
                      className="w-32"
                      data-testid="input-worker-interval"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => startWorkerMutation.mutate()}
                      disabled={startWorkerMutation.isPending}
                      className="gap-2"
                      data-testid="button-start-worker"
                    >
                      {startWorkerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Start Worker
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => stopWorkerMutation.mutate()}
                      disabled={stopWorkerMutation.isPending}
                      className="gap-2"
                      data-testid="button-stop-worker"
                    >
                      {stopWorkerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                      Stop Worker
                    </Button>
                  </div>
                </div>
                <div className="rounded-lg border p-4 bg-muted/50 space-y-2 text-sm">
                  <p className="font-medium">Automation Pipeline:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                    <li>Re-enrich 10 unclassified entities per cycle</li>
                    <li>Promote hot/warm leads with email to Contacts</li>
                    <li>Queue campaign messages (up to 100/day)</li>
                    <li>Process send queue via GoHighLevel</li>
                    <li>Auto-score, route, and enroll new contacts in sequences</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Send className="w-5 h-5" /> Manual Outreach Run
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Run the full daily outreach pipeline once, right now.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => runDailyMutation.mutate()}
                disabled={runDailyMutation.isPending}
                className="gap-2"
                data-testid="button-run-daily-manual"
              >
                {runDailyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Run Full Pipeline Now
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signatures" className="space-y-4">
          {signatures && Object.entries(signatures).map(([type, data]) => (
            <Card key={type}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2 capitalize">
                    <Pen className="w-5 h-5" /> {type} Signature
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setEditingSig(type);
                      setSigForm({
                        name: data.signature.name,
                        title: data.signature.title,
                        phone: data.signature.phone,
                        email: data.signature.email,
                        calendlyLink: data.signature.calendlyLink || "",
                      });
                    }}
                    data-testid={`button-edit-sig-${type}`}
                  >
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
                <DialogHeader>
                  <DialogTitle className="capitalize">Edit {editingSig} Signature</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Name</Label>
                    <Input value={sigForm.name} onChange={e => setSigForm(p => ({ ...p, name: e.target.value }))} data-testid="input-sig-name" />
                  </div>
                  <div className="space-y-1">
                    <Label>Title</Label>
                    <Input value={sigForm.title} onChange={e => setSigForm(p => ({ ...p, title: e.target.value }))} data-testid="input-sig-title" />
                  </div>
                  <div className="space-y-1">
                    <Label>Phone</Label>
                    <Input value={sigForm.phone} onChange={e => setSigForm(p => ({ ...p, phone: e.target.value }))} data-testid="input-sig-phone" />
                  </div>
                  <div className="space-y-1">
                    <Label>Email</Label>
                    <Input value={sigForm.email} onChange={e => setSigForm(p => ({ ...p, email: e.target.value }))} data-testid="input-sig-email" />
                  </div>
                  <div className="space-y-1">
                    <Label>Calendar/Booking Link</Label>
                    <Input value={sigForm.calendlyLink} onChange={e => setSigForm(p => ({ ...p, calendlyLink: e.target.value }))} data-testid="input-sig-calendly" />
                  </div>
                  <Button
                    onClick={() => saveSignatureMutation.mutate({ type: editingSig, data: sigForm })}
                    disabled={saveSignatureMutation.isPending}
                    className="w-full gap-2"
                    data-testid="button-save-signature"
                  >
                    {saveSignatureMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Save Signature
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
