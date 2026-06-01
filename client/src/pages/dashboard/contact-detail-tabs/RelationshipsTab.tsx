import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, RefreshCw, Plus, Trash2, GitFork, ShieldAlert, Users, Building2, Briefcase, Link2,
} from "lucide-react";
import { useLocation } from "wouter";
import type { EntityRelationship } from "@shared/schema";

interface EnrichedRelationship extends EntityRelationship {
  targetName: string;
  targetUrl: string | null;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  riskFlag?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
  riskFlag?: boolean;
  confidence?: number;
}

function RelationshipTypeLabel({ type }: { type: string }) {
  const map: Record<string, { label: string; color: string }> = {
    same_ein: { label: "Same EIN", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
    same_bank: { label: "Same Bank", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
    same_phone: { label: "Same Phone", color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
    same_owner: { label: "Same Owner", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
    same_address: { label: "Same Address", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
    iso_agent: { label: "ISO / Agent", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
    manual: { label: "Manual", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
  };
  const meta = map[type] ?? { label: type, color: "bg-gray-100 text-gray-800" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function EntityIcon({ type }: { type: string }) {
  if (type === "contact") return <Users className="h-4 w-4 text-muted-foreground" />;
  if (type === "company") return <Building2 className="h-4 w-4 text-muted-foreground" />;
  if (type === "deal") return <Briefcase className="h-4 w-4 text-muted-foreground" />;
  return <Link2 className="h-4 w-4 text-muted-foreground" />;
}

function ForceGraph({ contactId }: { contactId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animFrameRef = useRef<number>(0);
  const hoveredRef = useRef<GraphNode | null>(null);
  const [, setLocation] = useLocation();

  const { data: graphData } = useQuery<{ nodes: Omit<GraphNode, "x" | "y" | "vx" | "vy">[]; edges: GraphEdge[] }>({
    queryKey: ["/api/relationships/graph/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/relationships/graph/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return { nodes: [], edges: [] };
      return res.json();
    },
  });

  useEffect(() => {
    if (!graphData) return;
    const W = canvasRef.current?.parentElement?.clientWidth ?? 500;
    const H = 320;

    const existingMap = new Map(nodesRef.current.map((n) => [n.id, n]));

    nodesRef.current = graphData.nodes.map((n, i) => {
      const existing = existingMap.get(n.id);
      if (existing) return { ...existing, ...n };
      const angle = (i / graphData.nodes.length) * 2 * Math.PI;
      const radius = Math.min(W, H) * 0.35;
      return {
        ...n,
        x: W / 2 + (i === 0 ? 0 : radius * Math.cos(angle)),
        y: H / 2 + (i === 0 ? 0 : radius * Math.sin(angle)),
        vx: 0,
        vy: 0,
      };
    });
    edgesRef.current = graphData.edges;
  }, [graphData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.parentElement?.clientWidth ?? 500;
    const H = 320;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const REPULSION = 3000;
    const ATTRACTION = 0.05;
    const DAMPING = 0.85;
    const CENTER_PULL = 0.01;

    function tick() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      for (let i = 0; i < nodes.length; i++) {
        let fx = 0, fy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distSq = dx * dx + dy * dy + 1;
          const f = REPULSION / distSq;
          fx += f * (dx / Math.sqrt(distSq));
          fy += f * (dy / Math.sqrt(distSq));
        }

        for (const edge of edges) {
          const srcIdx = nodes.findIndex((n) => n.id === edge.source);
          const tgtIdx = nodes.findIndex((n) => n.id === edge.target);
          if (srcIdx === -1 || tgtIdx === -1) continue;
          const other = i === srcIdx ? nodes[tgtIdx] : i === tgtIdx ? nodes[srcIdx] : null;
          if (!other) continue;
          const dx = other.x - nodes[i].x;
          const dy = other.y - nodes[i].y;
          fx += ATTRACTION * dx;
          fy += ATTRACTION * dy;
        }

        fx += CENTER_PULL * (W / 2 - nodes[i].x);
        fy += CENTER_PULL * (H / 2 - nodes[i].y);

        if (i === 0) {
          fx = CENTER_PULL * 10 * (W / 2 - nodes[i].x);
          fy = CENTER_PULL * 10 * (H / 2 - nodes[i].y);
        }

        nodes[i].vx = (nodes[i].vx + fx) * DAMPING;
        nodes[i].vy = (nodes[i].vy + fy) * DAMPING;
        nodes[i].x = Math.max(30, Math.min(W - 30, nodes[i].x + nodes[i].vx));
        nodes[i].y = Math.max(30, Math.min(H - 30, nodes[i].y + nodes[i].vy));
      }

      ctx.clearRect(0, 0, W, H);

      for (const edge of edges) {
        const src = nodes.find((n) => n.id === edge.source);
        const tgt = nodes.find((n) => n.id === edge.target);
        if (!src || !tgt) continue;

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = edge.riskFlag ? "#ef4444" : "#94a3b8";
        ctx.lineWidth = edge.riskFlag ? 2 : 1;
        if (!edge.riskFlag) ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);

        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.textAlign = "center";
        ctx.fillText(edge.label, mx, my - 4);
      }

      for (const node of nodes) {
        const isCenter = node.id === `contact_${contactId}`;
        const isHovered = hoveredRef.current?.id === node.id;
        const r = isCenter ? 20 : 14;

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (node.riskFlag) {
          ctx.fillStyle = isHovered ? "#fca5a5" : "#fecaca";
          ctx.strokeStyle = "#ef4444";
        } else if (isCenter) {
          ctx.fillStyle = isHovered ? "#6366f1" : "#818cf8";
          ctx.strokeStyle = "#4338ca";
        } else {
          ctx.fillStyle = isHovered ? "#64748b" : "#94a3b8";
          ctx.strokeStyle = "#475569";
        }
        ctx.lineWidth = isCenter ? 3 : 2;
        ctx.fill();
        ctx.stroke();

        if (node.riskFlag) {
          ctx.fillStyle = "#ef4444";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("!", node.x, node.y + r + 12);
        }

        ctx.fillStyle = "#1e293b";
        ctx.font = isCenter ? "bold 10px sans-serif" : "9px sans-serif";
        ctx.textAlign = "center";
        const maxLen = 16;
        const label = node.label.length > maxLen ? node.label.slice(0, maxLen) + "…" : node.label;
        ctx.fillText(label, node.x, node.y + r + (node.riskFlag ? 22 : 12));
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const found = nodesRef.current.find((n) => Math.hypot(n.x - mx, n.y - my) < 20) ?? null;
      hoveredRef.current = found;
      canvas.style.cursor = found ? "pointer" : "default";
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const found = nodesRef.current.find((n) => Math.hypot(n.x - mx, n.y - my) < 20);
      if (found && found.type === "contact") {
        const id = found.id.split("_")[1];
        if (id && id !== String(contactId)) {
          setLocation(`/dashboard/contacts/${id}`);
        }
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleClick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleClick);
    };
  }, [contactId, setLocation]);

  if (!graphData || graphData.nodes.length <= 1) return null;

  return (
    <Card className="mb-4" data-testid="relationships-graph-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitFork className="h-4 w-4" /> Entity Graph
          <span className="text-xs font-normal text-muted-foreground ml-1">Click a node to navigate</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <canvas ref={canvasRef} className="w-full rounded-b-lg" style={{ height: 320 }} data-testid="relationships-graph-canvas" />
      </CardContent>
    </Card>
  );
}

export function RelationshipsTab({ contactId }: { contactId: number }) {
  const { user } = useAuth();
  const isManagerOrAdmin = user?.role === "admin" || user?.role === "manager";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    targetEntityType: "contact",
    targetEntityId: "",
    relationshipType: "manual",
    note: "",
  });

  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [dismissId, setDismissId] = useState<number | null>(null);
  const [dismissNote, setDismissNote] = useState("");

  const { data: relationships = [], isLoading, refetch } = useQuery<EnrichedRelationship[]>({
    queryKey: ["/api/contacts", contactId, "relationships"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/relationships`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/relationships/scan`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "relationships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/relationships/graph/contact", contactId] });
      toast({ title: "Scan complete", description: `Found ${data.count} relationship(s)` });
    },
    onError: (err: Error) => toast({ title: "Scan failed", description: err.message, variant: "destructive" }),
  });

  const riskScanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/relationships/risk-scan`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "relationships"] });
      if (data.hasRisk) {
        toast({
          title: "Risk detected",
          description: `${data.relationships.length} risk relationship(s) found`,
          variant: "destructive",
        });
      } else {
        toast({ title: "No risk detected", description: "No flagged relationships found" });
      }
    },
    onError: (err: Error) => toast({ title: "Risk scan failed", description: err.message, variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/relationships", {
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: addForm.targetEntityType,
        targetEntityId: Number(addForm.targetEntityId),
        relationshipType: addForm.relationshipType,
        note: addForm.note || undefined,
        source: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "relationships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/relationships/graph/contact", contactId] });
      setShowAddDialog(false);
      setAddForm({ targetEntityType: "contact", targetEntityId: "", relationshipType: "manual", note: "" });
      toast({ title: "Relationship added" });
    },
    onError: (err: Error) => toast({ title: "Failed to add relationship", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!dismissId) return;
      const res = await apiRequest("DELETE", `/api/relationships/${dismissId}`, { reason: dismissNote });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "relationships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/relationships/graph/contact", contactId] });
      setShowDismissDialog(false);
      setDismissNote("");
      setDismissId(null);
      toast({ title: "Relationship dismissed" });
    },
    onError: (err: Error) => toast({ title: "Failed to dismiss", description: err.message, variant: "destructive" }),
  });

  const active = relationships.filter((r) => !r.dismissedAt);
  const dismissed = relationships.filter((r) => !!r.dismissedAt);
  const riskRelationships = active.filter((r) => r.riskFlag);

  return (
    <div className="space-y-4" data-testid="relationships-tab">
      {riskRelationships.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3" data-testid="risk-banner">
          <ShieldAlert className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-sm text-destructive">Relationship Risk Detected</p>
            <p className="text-xs text-destructive/80 mt-0.5">
              This contact shares identifiers with {riskRelationships.length} flagged or terminated entity
              {riskRelationships.length !== 1 ? "ies" : ""}. Review before proceeding with underwriting.
            </p>
          </div>
        </div>
      )}

      <ForceGraph contactId={contactId} />

      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            data-testid="button-scan-relationships"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${scanMutation.isPending ? "animate-spin" : ""}`} />
            Scan for Relationships
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => riskScanMutation.mutate()}
            disabled={riskScanMutation.isPending}
            data-testid="button-risk-scan"
          >
            <ShieldAlert className="h-4 w-4 mr-1" />
            Risk Scan
          </Button>
        </div>
        {isManagerOrAdmin && (
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            data-testid="button-add-relationship"
          >
            <Plus className="h-4 w-4 mr-1" /> Add Relationship
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : active.length === 0 ? (
        <Card data-testid="relationships-empty">
          <CardContent className="pt-6 pb-6 text-center text-muted-foreground">
            <GitFork className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No relationships found.</p>
            <p className="text-xs mt-1">Click "Scan for Relationships" to auto-detect shared identifiers.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="relationships-list">
          {active.map((rel) => (
            <div
              key={rel.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${rel.riskFlag ? "border-destructive/50 bg-destructive/5" : ""}`}
              data-testid={`relationship-item-${rel.id}`}
            >
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <EntityIcon type={rel.targetEntityType} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {rel.targetUrl ? (
                      <button
                        className="font-medium text-sm hover:underline text-left truncate"
                        onClick={() => rel.targetUrl && setLocation(rel.targetUrl)}
                        data-testid={`link-relationship-target-${rel.id}`}
                      >
                        {rel.targetName}
                      </button>
                    ) : (
                      <span className="font-medium text-sm truncate">{rel.targetName}</span>
                    )}
                    {rel.riskFlag && (
                      <Badge variant="destructive" className="text-xs gap-1" data-testid={`badge-risk-${rel.id}`}>
                        <AlertTriangle className="h-3 w-3" /> Risk
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <RelationshipTypeLabel type={rel.relationshipType} />
                    <span className="text-xs text-muted-foreground">
                      {rel.source === "manual" ? "Manual" : "Auto-detected"} · Confidence: {Math.round((rel.confidence ?? 1) * 100)}%
                    </span>
                  </div>
                  {rel.riskReason && (
                    <p className="text-xs text-destructive mt-0.5 truncate" data-testid={`text-risk-reason-${rel.id}`}>
                      {rel.riskReason}
                    </p>
                  )}
                  {rel.note && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">{rel.note}</p>
                  )}
                </div>
              </div>
              {isManagerOrAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss relationship"
                  onClick={() => {
                    setDismissId(rel.id);
                    setShowDismissDialog(true);
                  }}
                  data-testid={`button-dismiss-relationship-${rel.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {dismissed.length > 0 && (
        <details className="text-sm text-muted-foreground" data-testid="dismissed-relationships">
          <summary className="cursor-pointer hover:text-foreground py-1">
            {dismissed.length} dismissed relationship{dismissed.length !== 1 ? "s" : ""}
          </summary>
          <div className="space-y-1 mt-2 pl-2 border-l">
            {dismissed.map((rel) => (
              <div key={rel.id} className="text-xs text-muted-foreground/70 line-through" data-testid={`dismissed-item-${rel.id}`}>
                {rel.targetName} — {rel.relationshipType.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent data-testid="dialog-add-relationship">
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Target Entity Type</Label>
              <Select
                value={addForm.targetEntityType}
                onValueChange={(v) => setAddForm((p) => ({ ...p, targetEntityType: v }))}
              >
                <SelectTrigger data-testid="select-target-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="deal">Deal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Target Entity ID</Label>
              <Input
                type="number"
                placeholder="Enter entity ID..."
                value={addForm.targetEntityId}
                onChange={(e) => setAddForm((p) => ({ ...p, targetEntityId: e.target.value }))}
                data-testid="input-target-entity-id"
              />
            </div>
            <div className="space-y-1">
              <Label>Relationship Type</Label>
              <Select
                value={addForm.relationshipType}
                onValueChange={(v) => setAddForm((p) => ({ ...p, relationshipType: v }))}
              >
                <SelectTrigger data-testid="select-relationship-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="same_ein">Same EIN</SelectItem>
                  <SelectItem value="same_bank">Same Bank</SelectItem>
                  <SelectItem value="same_phone">Same Phone</SelectItem>
                  <SelectItem value="same_owner">Same Owner</SelectItem>
                  <SelectItem value="same_address">Same Address</SelectItem>
                  <SelectItem value="iso_agent">ISO / Agent</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Textarea
                placeholder="Reason for this relationship..."
                value={addForm.note}
                onChange={(e) => setAddForm((p) => ({ ...p, note: e.target.value }))}
                data-testid="input-relationship-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !addForm.targetEntityId}
              data-testid="button-confirm-add-relationship"
            >
              Add Relationship
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDismissDialog} onOpenChange={setShowDismissDialog}>
        <DialogContent data-testid="dialog-dismiss-relationship">
          <DialogHeader>
            <DialogTitle>Dismiss Relationship</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea
              placeholder="Why are you dismissing this relationship?"
              value={dismissNote}
              onChange={(e) => setDismissNote(e.target.value)}
              data-testid="input-dismiss-note"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDismissDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
              data-testid="button-confirm-dismiss"
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
