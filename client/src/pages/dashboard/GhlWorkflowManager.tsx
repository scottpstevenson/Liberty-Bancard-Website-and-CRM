import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Zap, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WorkflowMapping {
  sequenceName: string;
  category: string;
  vertical: string;
  ghlWorkflowId: string | null;
  source: "env" | "db" | null;
  envKey: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  sales: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  education: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  onboarding: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  sdr_outbound: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  sdr_cold_outbound: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  sdr_reply_engaged: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  nurture: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  reactivation: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  inbound: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  operations: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  risk: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  hardware: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};

function MappingRow({ mapping }: { mapping: WorkflowMapping }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(mapping.ghlWorkflowId || "");

  const saveMutation = useMutation({
    mutationFn: async (ghlWorkflowId: string) => {
      const res = await apiRequest("PUT", `/api/ghl/workflow-mappings/${encodeURIComponent(mapping.sequenceName)}`, { ghlWorkflowId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-mappings"] });
      setEditing(false);
      toast({ title: "Saved", description: `Workflow ID saved for "${mapping.sequenceName}"` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(inputValue.trim());
  };

  const handleCancel = () => {
    setInputValue(mapping.ghlWorkflowId || "");
    setEditing(false);
  };

  const isConfigured = !!mapping.ghlWorkflowId;
  const catColor = CATEGORY_COLORS[mapping.category] || "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300";

  return (
    <div className="border border-border rounded-lg p-4 space-y-3" data-testid={`row-workflow-${mapping.sequenceName}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {isConfigured
            ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            : <XCircle className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-medium text-sm text-foreground" data-testid="text-sequence-name">{mapping.sequenceName}</span>
            <Badge variant="outline" className={`text-xs px-2 py-0 ${catColor}`}>{mapping.category}</Badge>
            {mapping.vertical !== "all" && (
              <Badge variant="outline" className="text-xs px-2 py-0">{mapping.vertical}</Badge>
            )}
            {mapping.source === "env" && (
              <Badge variant="outline" className="text-xs px-2 py-0 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">via env var</Badge>
            )}
          </div>
          {isConfigured && !editing && (
            <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-workflow-id">
              {mapping.ghlWorkflowId}
            </p>
          )}
          {!isConfigured && !editing && (
            <p className="text-xs text-muted-foreground italic">No GHL workflow ID — outreach won't fire for this sequence</p>
          )}
        </div>
        {mapping.source !== "env" && (
          <div className="shrink-0">
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid={`button-edit-${mapping.sequenceName}`}>
                {isConfigured ? "Edit" : "Add ID"}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {editing && (
        <div className="flex gap-2 pl-8">
          <Input
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Paste GHL Workflow ID from GHL admin..."
            className="font-mono text-sm flex-1"
            data-testid="input-workflow-id"
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
          />
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-workflow-id">
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} data-testid="button-cancel-workflow-id">Cancel</Button>
        </div>
      )}
    </div>
  );
}

export default function GhlWorkflowManager() {
  const [filter, setFilter] = useState<"all" | "configured" | "missing">("all");
  const [search, setSearch] = useState("");

  const { data: mappings, isLoading } = useQuery<WorkflowMapping[]>({
    queryKey: ["/api/ghl/workflow-mappings"],
    refetchInterval: 30000,
  });

  const filtered = (mappings || []).filter(m => {
    if (filter === "configured" && !m.ghlWorkflowId) return false;
    if (filter === "missing" && m.ghlWorkflowId) return false;
    if (search && !m.sequenceName.toLowerCase().includes(search.toLowerCase()) && !m.category.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const configured = (mappings || []).filter(m => !!m.ghlWorkflowId).length;
  const total = (mappings || []).length;
  const missing = total - configured;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto" data-testid="page-ghl-workflow-manager">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">GHL Workflow ID Manager</h1>
        <p className="text-muted-foreground mt-1">
          Map each outreach sequence to its GHL workflow ID so contacts get enrolled in GHL when sequences fire.
        </p>
      </div>

      <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800 dark:text-amber-300">
          <strong>To find your GHL workflow IDs:</strong> In GoHighLevel, go to{" "}
          <strong>Automation → Workflows</strong>, open each workflow, and copy the ID from the URL{" "}
          (e.g. <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1 rounded">...workflows/<strong>abc123xyz</strong>/...</code>).{" "}
          <a href="https://app.gohighlevel.com/settings/automations/workflows" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
            Open GHL Workflows <ExternalLink className="w-3 h-3" />
          </a>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-3 gap-4">
        <Card data-testid="card-stat-total">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{total}</div>
            <div className="text-xs text-muted-foreground">Total Sequences</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-configured">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">{configured}</div>
            <div className="text-xs text-muted-foreground">Configured</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-missing">
          <CardContent className="p-4 text-center">
            <div className={`text-2xl font-bold ${missing > 0 ? "text-red-500" : "text-muted-foreground"}`}>{missing}</div>
            <div className="text-xs text-muted-foreground">Missing IDs</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Sequence → GHL Workflow Mappings
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              {(["all", "configured", "missing"] as const).map(f => (
                <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} data-testid={`button-filter-${f}`} className="capitalize">
                  {f}
                </Button>
              ))}
            </div>
          </div>
          <Input
            placeholder="Search sequences..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-2"
            data-testid="input-search-sequences"
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No sequences match your filter.</div>
          ) : (
            filtered.map(m => <MappingRow key={m.sequenceName} mapping={m} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
