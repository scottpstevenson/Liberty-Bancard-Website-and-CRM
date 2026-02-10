import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Upload, Sparkles, Loader2, ArrowRightLeft, UserPlus,
  Mail, Phone, Globe, CheckCircle2, Clock, XCircle, Brain,
  ChevronDown, Zap, Users, PlayCircle, LayoutList, Target,
  TrendingUp, AlertCircle,
} from "lucide-react";
import type { SunbizEntity, Prospect } from "@shared/schema";
import LeadIntelligence from "./LeadIntelligence";

type UnifiedRow = {
  id: string;
  source: "sunbiz" | "prospect";
  rawId: number;
  name: string;
  owner: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  vertical: string;
  score: string;
  enrichmentStatus: string;
  qualificationScore: string;
  estimatedResidual: string;
  contactId: number | null;
  prospectStatus: string;
};

function toUnifiedRows(entities: SunbizEntity[], prospects: Prospect[]): UnifiedRow[] {
  const eRows: UnifiedRow[] = entities.map((e) => ({
    id: `e-${e.id}`,
    source: "sunbiz" as const,
    rawId: e.id,
    name: e.entityName || "",
    owner: e.ownerName || "",
    email: e.email || e.ownerEmail || "",
    phone: e.phone || e.ownerPhone || "",
    website: e.website || "",
    city: e.principalCity || "",
    state: e.principalState || "",
    vertical: e.vertical || "",
    score: e.score || "raw",
    enrichmentStatus: e.enrichmentStatus || "pending",
    qualificationScore: "--",
    estimatedResidual: "--",
    contactId: null,
    prospectStatus: "",
  }));
  const pRows: UnifiedRow[] = prospects
    .filter((p) => p.status !== "converted")
    .map((p) => ({
      id: `p-${p.id}`,
      source: "prospect" as const,
      rawId: p.id,
      name: p.companyName || "",
      owner: [p.ownerFirstName, p.ownerLastName].filter(Boolean).join(" "),
      email: p.email || p.ownerEmail || "",
      phone: p.phone || p.ownerPhone || "",
      website: p.website || "",
      city: p.city || "",
      state: p.state || "",
      vertical: p.vertical || "",
      score: p.score || "cold",
      enrichmentStatus: p.status === "enriched" || p.status === "qualified" ? "enriched" : p.status === "enriching" ? "processing" : "pending",
      qualificationScore: p.qualificationScore || "--",
      estimatedResidual: p.estimatedResidual || "--",
      contactId: p.contactId ?? null,
      prospectStatus: p.status || "raw",
    }));
  return [...eRows, ...pRows];
}

function getScoreVariant(score: string) {
  switch (score) {
    case "hot": return "destructive" as const;
    case "warm": return "default" as const;
    case "cold": return "secondary" as const;
    default: return "outline" as const;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "enriched": return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "processing": return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case "failed": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function filterRows(rows: UnifiedRow[], search: string, scoreFilter: string, statusFilter: string, sourceFilter: string) {
  return rows.filter((r) => {
    if (search) {
      const t = search.toLowerCase();
      if (!r.name.toLowerCase().includes(t) && !r.owner.toLowerCase().includes(t) && !r.email.toLowerCase().includes(t) && !r.city.toLowerCase().includes(t)) return false;
    }
    if (scoreFilter !== "all" && r.score !== scoreFilter) return false;
    if (statusFilter !== "all" && r.enrichmentStatus !== statusFilter) return false;
    if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
    return true;
  });
}

export default function LeadCommandCenter() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterScore, setFilterScore] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState("queue");

  const { data: entities = [], isLoading: entitiesLoading } = useQuery<SunbizEntity[]>({ queryKey: ["/api/sunbiz/entities"] });
  const { data: stats } = useQuery<{ total: number; enriched: number; pending: number; withEmail: number; withPhone: number; withWebsite: number }>({ queryKey: ["/api/sunbiz/stats"] });
  const { data: prospects = [], isLoading: prospectsLoading } = useQuery<Prospect[]>({ queryKey: ["/api/prospects"] });
  const { data: sequences = [] } = useQuery<any[]>({ queryKey: ["/api/sequences"] });
  const { data: workflows = [] } = useQuery<any[]>({ queryKey: ["/api/workflows"] });

  const isLoading = entitiesLoading || prospectsLoading;

  const allRows = useMemo(() => toUnifiedRows(entities, prospects), [entities, prospects]);
  const filteredQueue = useMemo(() => filterRows(allRows, searchTerm, filterScore, filterStatus, filterSource), [allRows, searchTerm, filterScore, filterStatus, filterSource]);

  const qualifiedRows = useMemo(() => {
    return allRows.filter((r) => {
      if (r.source !== "prospect") return false;
      const isHotWarm = r.score === "hot" || r.score === "warm";
      const isGoodGrade = r.qualificationScore === "A" || r.qualificationScore === "B";
      const isQualifiedStatus = r.prospectStatus === "qualified" || r.prospectStatus === "enriched";
      return (isHotWarm && isGoodGrade) || (isQualifiedStatus && isGoodGrade);
    });
  }, [allRows]);

  const kpis = useMemo(() => {
    const totalLeads = (stats?.total || 0) + prospects.length;
    const pendingEnrichment = stats?.pending || 0;
    const enriched = (stats?.enriched || 0) + prospects.filter((p) => p.status === "enriched" || p.status === "qualified").length;
    const hotLeads = entities.filter((e) => e.score === "hot").length + prospects.filter((p) => p.score === "hot").length;
    const warmLeads = entities.filter((e) => e.score === "warm").length + prospects.filter((p) => p.score === "warm").length;
    const converted = prospects.filter((p) => p.status === "converted").length;
    return { totalLeads, pendingEnrichment, enriched, hotLeads, warmLeads, converted };
  }, [stats, entities, prospects]);

  const selectedEntities = useMemo(() => Array.from(selectedIds).filter((id) => id.startsWith("e-")).map((id) => parseInt(id.slice(2))), [selectedIds]);
  const selectedProspects = useMemo(() => Array.from(selectedIds).filter((id) => id.startsWith("p-")).map((id) => parseInt(id.slice(2))), [selectedIds]);
  const selectedProspectsWithContact = useMemo(() => {
    return allRows.filter((r) => selectedIds.has(r.id) && r.source === "prospect" && r.contactId).map((r) => ({ prospectId: r.rawId, contactId: r.contactId! }));
  }, [selectedIds, allRows]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sunbiz/entities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sunbiz/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/sunbiz/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Upload Complete", description: `Imported ${data.imported} entities.` }); invalidateAll(); },
    onError: (err: any) => { toast({ title: "Upload Failed", description: err.message, variant: "destructive" }); },
  });

  const corevtUploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/sunbiz/upload-corevt", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Import Complete", description: `Imported ${data.imported} entities from state filing data.` }); invalidateAll(); },
    onError: (err: any) => { toast({ title: "Import Failed", description: err.message, variant: "destructive" }); },
  });

  const enrichBatchMutation = useMutation({
    mutationFn: async () => {
      const promises: Promise<any>[] = [];
      if (selectedEntities.length > 0) {
        promises.push(apiRequest("POST", "/api/sunbiz/enrich-batch", { limit: selectedEntities.length }).then((r) => r.json()));
      }
      for (const pid of selectedProspects) {
        promises.push(apiRequest("POST", "/api/enrichment-jobs", { jobType: "full_enrich", prospectId: pid }));
      }
      return Promise.all(promises);
    },
    onSuccess: () => { toast({ title: "Enrichment Started", description: "Selected leads are being enriched." }); invalidateAll(); setSelectedIds(new Set()); },
    onError: (err: any) => { toast({ title: "Enrichment Error", description: err.message, variant: "destructive" }); },
  });

  const convertToProspectsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sunbiz/convert-batch", { entityIds: selectedEntities });
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Converted", description: `${data.converted} entities pushed to prospects.` }); invalidateAll(); setSelectedIds(new Set()); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const convertToContactsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prospects/convert-batch", { prospectIds: selectedProspects });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Converted", description: `${data.converted} prospects converted to contacts.` });
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedIds(new Set());
    },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const aiRouteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/ai/route-prospects-bulk", { prospectIds: ids });
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "AI Routing Complete", description: `Routed ${data.routed} prospects to campaigns.` }); invalidateAll(); setSelectedIds(new Set()); },
    onError: (err: any) => { toast({ title: "Routing Error", description: err.message, variant: "destructive" }); },
  });

  const enrollSequenceMutation = useMutation({
    mutationFn: async (sequenceId: number) => {
      const promises = selectedProspectsWithContact.map((p) =>
        apiRequest("POST", "/api/sequence-enrollments", { sequenceId, contactId: p.contactId, status: "active" })
      );
      return Promise.all(promises);
    },
    onSuccess: () => { toast({ title: "Enrolled", description: "Selected prospects enrolled in sequence." }); setSelectedIds(new Set()); },
    onError: (err: any) => { toast({ title: "Enrollment Error", description: err.message, variant: "destructive" }); },
  });

  const addToWorkflowMutation = useMutation({
    mutationFn: async (workflowId: number) => {
      const selected = allRows.filter((r) => selectedIds.has(r.id));
      const promises = selected.map((r) =>
        apiRequest("POST", `/api/workflows/${workflowId}/run`, { entityType: r.source === "sunbiz" ? "sunbiz_entity" : "prospect", entityId: r.rawId })
      );
      return Promise.all(promises);
    },
    onSuccess: () => { toast({ title: "Workflow Started", description: "Selected items added to workflow." }); setSelectedIds(new Set()); },
    onError: (err: any) => { toast({ title: "Workflow Error", description: err.message, variant: "destructive" }); },
  });

  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const formData = new FormData();
    formData.append("file", file);
    const isZip = file.name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    if (isZip || file.name.toLowerCase().includes("corevt")) {
      formData.append("listName", `Corevt Import ${new Date().toLocaleDateString()}`);
      formData.append("maxRecords", "10000");
      formData.append("onlyWithAddress", "true");
      corevtUploadMutation.mutate(formData);
    } else {
      formData.append("listName", `Sunbiz Import ${new Date().toLocaleDateString()}`);
      uploadMutation.mutate(formData);
    }
  }, [uploadMutation, corevtUploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = (rows: UnifiedRow[]) => {
    const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  };

  const renderTable = (rows: UnifiedRow[], showSelectAll: boolean) => {
    const displayed = rows.slice(0, 200);
    return (
      <>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {showSelectAll && (
                    <Checkbox
                      checked={displayed.length > 0 && displayed.every((r) => selectedIds.has(r.id))}
                      onCheckedChange={() => toggleSelectAll(displayed)}
                      data-testid="checkbox-select-all"
                    />
                  )}
                </TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Owner/Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Est. Residual</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-8 text-muted-foreground" data-testid="text-no-results">
                    No leads found matching your criteria
                  </TableCell>
                </TableRow>
              ) : (
                displayed.map((row) => (
                  <TableRow key={row.id} data-testid={`row-lead-${row.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                        data-testid={`checkbox-${row.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.source === "sunbiz" ? "outline" : "secondary"} data-testid={`badge-source-${row.id}`}>
                        {row.source === "sunbiz" ? "Sunbiz" : "Prospect"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm max-w-[180px] truncate" title={row.name}>
                        {row.name || "--"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm max-w-[140px] truncate">{row.owner || "--"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm max-w-[160px] truncate">{row.email || "--"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{row.phone || "--"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm max-w-[120px] truncate">{row.website || "--"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{row.city}{row.state ? `, ${row.state}` : ""}</div>
                    </TableCell>
                    <TableCell>
                      {row.vertical ? <Badge variant="outline" className="text-xs">{row.vertical}</Badge> : <span className="text-sm text-muted-foreground">--</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getScoreVariant(row.score)} data-testid={`badge-score-${row.id}`}>
                        {row.score}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(row.enrichmentStatus)}
                        <span className="text-xs capitalize">{row.enrichmentStatus}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{row.qualificationScore}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{row.estimatedResidual}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {row.enrichmentStatus !== "enriched" && (
                          <Button size="icon" variant="ghost" title="Enrich" data-testid={`button-enrich-${row.id}`}>
                            <Sparkles className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {rows.length > 200 && (
          <div className="p-3 text-center text-xs text-muted-foreground border-t">
            Showing 200 of {rows.length} leads. Use filters to narrow results.
          </div>
        )}
      </>
    );
  };

  const renderMassActions = () => {
    if (selectedIds.size === 0) return null;
    return (
      <div className="sticky top-0 z-50 flex flex-wrap items-center gap-2 p-3 border rounded-md bg-background shadow-sm" data-testid="mass-action-bar">
        <span className="text-sm font-medium mr-2">{selectedIds.size} selected</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => enrichBatchMutation.mutate()}
          disabled={enrichBatchMutation.isPending}
          data-testid="button-enrich-selected"
        >
          {enrichBatchMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
          Enrich Selected
        </Button>
        {selectedEntities.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => convertToProspectsMutation.mutate()}
            disabled={convertToProspectsMutation.isPending}
            data-testid="button-convert-to-prospects"
          >
            {convertToProspectsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ArrowRightLeft className="h-4 w-4 mr-1.5" />}
            Convert to Prospects
          </Button>
        )}
        {selectedProspects.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => convertToContactsMutation.mutate()}
            disabled={convertToContactsMutation.isPending}
            data-testid="button-convert-to-contacts"
          >
            {convertToContactsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
            Convert to Contacts
          </Button>
        )}
        {selectedProspects.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => aiRouteMutation.mutate(selectedProspects)}
            disabled={aiRouteMutation.isPending}
            data-testid="button-ai-route"
          >
            {aiRouteMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
            AI Route to Campaigns
          </Button>
        )}
        {selectedProspectsWithContact.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={enrollSequenceMutation.isPending} data-testid="button-enroll-sequence">
                {enrollSequenceMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1.5" />}
                Enroll in Sequence
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {sequences.length === 0 ? (
                <DropdownMenuItem disabled>No sequences available</DropdownMenuItem>
              ) : (
                sequences.map((seq: any) => (
                  <DropdownMenuItem key={seq.id} onClick={() => enrollSequenceMutation.mutate(seq.id)} data-testid={`menu-sequence-${seq.id}`}>
                    {seq.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={addToWorkflowMutation.isPending} data-testid="button-add-workflow">
              {addToWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LayoutList className="h-4 w-4 mr-1.5" />}
              Add to Workflow
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {workflows.length === 0 ? (
              <DropdownMenuItem disabled>No workflows available</DropdownMenuItem>
            ) : (
              workflows.map((wf: any) => (
                <DropdownMenuItem key={wf.id} onClick={() => addToWorkflowMutation.mutate(wf.id)} data-testid={`menu-workflow-${wf.id}`}>
                  {wf.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const uploading = uploadMutation.isPending || corevtUploadMutation.isPending;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Lead Command Center</h1>
        <p className="text-sm text-muted-foreground">Unified view of all leads, enrichment, and conversion pipeline</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-kpi-total">{kpis.totalLeads}</div>
            <div className="text-xs text-muted-foreground">Total Leads</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-kpi-pending">{kpis.pendingEnrichment}</div>
            <div className="text-xs text-muted-foreground">Pending Enrichment</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-kpi-enriched">{kpis.enriched}</div>
            <div className="text-xs text-muted-foreground">Enriched</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-kpi-hot">{kpis.hotLeads}</div>
            <div className="text-xs text-muted-foreground">Hot Leads</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-kpi-warm">{kpis.warmLeads}</div>
            <div className="text-xs text-muted-foreground">Warm Leads</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-kpi-converted">{kpis.converted}</div>
            <div className="text-xs text-muted-foreground">Converted</div>
          </CardContent>
        </Card>
      </div>

      <div
        className={`flex items-center gap-3 p-3 border-2 border-dashed rounded-md transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        data-testid="upload-zone"
      >
        {uploading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Processing file...</span>
          </div>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">Drag & drop CSV or corevt.zip files here</span>
            <label htmlFor="lcc-file-upload" className="ml-auto">
              <Button variant="outline" size="sm" asChild>
                <span data-testid="button-upload-file">
                  <Upload className="h-4 w-4 mr-1.5" />
                  Select File
                </span>
              </Button>
            </label>
            <input
              id="lcc-file-upload"
              type="file"
              accept=".csv,.txt,.tsv,.zip"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
              data-testid="input-file-upload"
            />
          </>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedIds(new Set()); }}>
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="queue" data-testid="tab-queue">Enrichment Queue</TabsTrigger>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline">Qualified Pipeline</TabsTrigger>
          <TabsTrigger value="intelligence" data-testid="tab-intelligence">Lead Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-3 mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads, owners, emails, cities..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search"
              />
            </div>
            <Select value={filterScore} onValueChange={setFilterScore}>
              <SelectTrigger className="w-[130px]" data-testid="select-filter-score">
                <SelectValue placeholder="Score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scores</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
                <SelectItem value="raw">Raw</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="enriched">Enriched</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-[130px]" data-testid="select-filter-source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="sunbiz">Sunbiz</SelectItem>
                <SelectItem value="prospect">Prospect</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs">{filteredQueue.length} results</Badge>
          </div>

          {renderMassActions()}

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Card>
              {renderTable(filteredQueue, true)}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-3 mt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold" data-testid="text-pipeline-title">Qualified Pipeline</h2>
              <p className="text-xs text-muted-foreground">{qualifiedRows.length} qualified leads ready for conversion</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={convertToContactsMutation.isPending || qualifiedRows.filter((r) => r.score === "hot").length === 0}
                onClick={() => {
                  const hotIds = qualifiedRows.filter((r) => r.score === "hot").map((r) => r.rawId);
                  if (hotIds.length > 0) {
                    setSelectedIds(new Set(qualifiedRows.filter((r) => r.score === "hot").map((r) => r.id)));
                    convertToContactsMutation.mutate();
                  }
                }}
                data-testid="button-convert-all-hot"
              >
                {convertToContactsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Target className="h-4 w-4 mr-1.5" />}
                Convert All Hot
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={aiRouteMutation.isPending || qualifiedRows.length === 0}
                onClick={() => aiRouteMutation.mutate(qualifiedRows.map((r) => r.rawId))}
                data-testid="button-ai-route-all"
              >
                {aiRouteMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
                AI Route All
              </Button>
              {selectedProspectsWithContact.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="button-pipeline-enroll">
                      <PlayCircle className="h-4 w-4 mr-1.5" />
                      Enroll in Sequence
                      <ChevronDown className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {sequences.map((seq: any) => (
                      <DropdownMenuItem key={seq.id} onClick={() => enrollSequenceMutation.mutate(seq.id)}>
                        {seq.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Card>
              {renderTable(qualifiedRows, true)}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="intelligence" className="mt-3">
          <LeadIntelligence />
        </TabsContent>
      </Tabs>
    </div>
  );
}
