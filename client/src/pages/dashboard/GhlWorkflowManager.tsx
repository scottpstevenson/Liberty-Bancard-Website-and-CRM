import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Save, RefreshCw, Workflow, Search } from "lucide-react";

const ALL_SEQUENCES = [
  { name: "1. Switch & Save — Statement Audit", category: "sales" },
  { name: "2. Payment Stack 101 — Education", category: "education" },
  { name: "3. Fast Approval — Application Completion", category: "onboarding" },
  { name: "4. Trust Builder — Authority Sequence", category: "sales" },
  { name: "5. Chargeback Defense", category: "risk" },
  { name: "6. Funding Speed & Reliability", category: "sales" },
  { name: "8. Liberty Smart Terminal — Product Showcase", category: "hardware" },
  { name: "9. Surcharge & Cash Discount — Compliance", category: "sales" },
  { name: "10. Retail Merchants — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "11. Auto Merchants — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "12. Medical & Med Spa — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "13. Recurring Billing — Subscription Merchants", category: "sales" },
  { name: "15. Omnichannel — Online + In-Person", category: "sales" },
  { name: "16. Security & PCI Compliance — Made Easy", category: "education" },
  { name: "17. Contract Escape — Switch Help", category: "sales" },
  { name: "18. Objection Crusher — Overcome Hesitation", category: "sales" },
  { name: "19. Reactivation — Cold Lead Revival", category: "reactivation" },
  { name: "20. Free Analysis Follow-Up", category: "sales" },
  { name: "Post-Call Review Follow-Up", category: "sales" },
  { name: "Proposal Follow-Up", category: "sales" },
  { name: "No-Show Reschedule", category: "sales" },
  { name: "Long-Term Nurture", category: "nurture" },
  { name: "SDR: Cold Outbound — Auto Repair", category: "sdr_cold_outbound" },
  { name: "SDR: Cold Outbound — Med Spa", category: "sdr_cold_outbound" },
  { name: "SDR: Cold Outbound — Dental", category: "sdr_cold_outbound" },
  { name: "SDR: Reply Engaged", category: "sdr_reply_engaged" },
  { name: "SDR: Statement Chase", category: "sdr_statement_chase" },
  { name: "SDR: Proposal Follow-Up", category: "sdr_proposal_followup" },
  { name: "SDR: No-Show Recovery", category: "sdr_noshow_recovery" },
  { name: "V-Retail: SDR Outbound Prospecting", category: "sdr" },
  { name: "V-Retail: Inbound Lead Nurture", category: "inbound" },
  { name: "V-Retail: Account Management Ops", category: "operations" },
  { name: "V-Auto: SDR Outbound Prospecting", category: "sdr" },
  { name: "V-Auto: Inbound Lead Nurture", category: "inbound" },
  { name: "V-Auto: Account Management Ops", category: "operations" },
  { name: "V-Medical: SDR Outbound Prospecting", category: "sdr" },
];

interface WorkflowMapping {
  id: number;
  sequenceName: string;
  ghlWorkflowId: string | null;
  category: string | null;
  description: string | null;
  updatedAt: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  sales: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  education: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  onboarding: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  risk: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  hardware: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  sdr_outbound: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  sdr_cold_outbound: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  sdr_reply_engaged: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  sdr_statement_chase: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  sdr_proposal_followup: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  sdr_noshow_recovery: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  reactivation: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  nurture: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  sdr: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  inbound: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  operations: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};

export default function GhlWorkflowManager() {
  const { toast } = useToast();
  const [editingIds, setEditingIds] = useState<Record<string, string>>({});
  const [savingSequences, setSavingSequences] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { data: mappings = [], isLoading } = useQuery<WorkflowMapping[]>({
    queryKey: ["/api/ghl/workflow-mappings"],
  });

  const mappingByName = Object.fromEntries(mappings.map(m => [m.sequenceName, m]));

  const saveMutation = useMutation({
    mutationFn: async ({ sequenceName, ghlWorkflowId, category }: { sequenceName: string; ghlWorkflowId: string; category: string }) => {
      return apiRequest("PUT", `/api/ghl/workflow-mappings/${encodeURIComponent(sequenceName)}`, { ghlWorkflowId: ghlWorkflowId || null, category });
    },
    onSuccess: (_, { sequenceName }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-mappings"] });
      setSavingSequences(prev => { const next = new Set(prev); next.delete(sequenceName); return next; });
      setEditingIds(prev => { const next = { ...prev }; delete next[sequenceName]; return next; });
      toast({ title: "Saved", description: "Workflow ID updated successfully." });
    },
    onError: (_, { sequenceName }) => {
      setSavingSequences(prev => { const next = new Set(prev); next.delete(sequenceName); return next; });
      toast({ title: "Error", description: "Failed to save workflow ID.", variant: "destructive" });
    },
  });

  const handleSave = (sequenceName: string, category: string) => {
    const ghlWorkflowId = editingIds[sequenceName] ?? (mappingByName[sequenceName]?.ghlWorkflowId || "");
    setSavingSequences(prev => new Set(prev).add(sequenceName));
    saveMutation.mutate({ sequenceName, ghlWorkflowId, category });
  };

  const getWorkflowId = (sequenceName: string) => {
    if (sequenceName in editingIds) return editingIds[sequenceName];
    return mappingByName[sequenceName]?.ghlWorkflowId || "";
  };

  const isEdited = (sequenceName: string) => sequenceName in editingIds;
  const hasId = (sequenceName: string) => {
    const id = mappingByName[sequenceName]?.ghlWorkflowId;
    return !!id && id.trim() !== "";
  };

  const configuredCount = ALL_SEQUENCES.filter(s => hasId(s.name)).length;

  const filteredSequences = ALL_SEQUENCES.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Workflow className="w-6 h-6 text-primary" />
            GHL Workflow ID Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Paste in GHL workflow IDs from the GHL admin panel to connect each sequence to the correct automation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{configuredCount}</span> / {ALL_SEQUENCES.length} configured
          </div>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-mappings"] })} data-testid="button-refresh-mappings">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Card data-testid="card-ghl-workflow-summary">
        <CardContent className="p-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm"><span className="font-semibold">{configuredCount}</span> sequences connected to GHL</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm"><span className="font-semibold">{ALL_SEQUENCES.length - configuredCount}</span> sequences need a workflow ID</span>
            </div>
          </div>
          {configuredCount < ALL_SEQUENCES.length && (
            <p className="text-xs text-muted-foreground mt-2">
              Sequences without a GHL workflow ID will not enroll contacts in GHL. Copy the workflow ID from GHL → Automation → Workflows → [workflow] → Settings.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search sequences by name or category..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-sequences"
        />
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading workflow mappings...</div>
        ) : (
          filteredSequences.map(seq => {
            const currentId = getWorkflowId(seq.name);
            const edited = isEdited(seq.name);
            const configured = hasId(seq.name);
            const isSaving = savingSequences.has(seq.name);
            const categoryColor = CATEGORY_COLORS[seq.category] || "bg-gray-100 text-gray-700";

            return (
              <Card key={seq.name} className={`transition-all ${edited ? "ring-2 ring-primary/30" : ""}`} data-testid={`card-sequence-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm text-foreground truncate">{seq.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor}`}>{seq.category}</span>
                        {configured && !edited && (
                          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle className="w-3 h-3" /> Connected
                          </span>
                        )}
                        {!configured && (
                          <span className="flex items-center gap-1 text-xs text-red-500">
                            <XCircle className="w-3 h-3" /> No ID set
                          </span>
                        )}
                        {edited && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Unsaved</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Input
                          placeholder="Paste GHL workflow ID here (e.g. abc123def456...)"
                          value={currentId}
                          onChange={e => setEditingIds(prev => ({ ...prev, [seq.name]: e.target.value }))}
                          className="font-mono text-xs h-8 flex-1"
                          data-testid={`input-workflow-id-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
                        />
                        <Button
                          size="sm"
                          variant={edited ? "default" : "outline"}
                          disabled={isSaving || (!edited && configured)}
                          onClick={() => handleSave(seq.name, seq.category)}
                          className="shrink-0 h-8"
                          data-testid={`button-save-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
                        >
                          {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          <span className="ml-1 text-xs">{isSaving ? "Saving..." : "Save"}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
