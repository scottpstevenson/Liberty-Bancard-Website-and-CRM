import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Calendar, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Deal, Contact } from "@shared/schema";
import { SALES_STAGES, OFFER_PATHS } from "@shared/schema";

const STAGE_COLORS: Record<string, string> = {
  "New Lead": "bg-blue-500",
  "Statement Received": "bg-indigo-500",
  "Review In Progress": "bg-violet-500",
  "Call Booked": "bg-cyan-500",
  "Proposal Sent": "bg-amber-500",
  "Negotiation / Follow-Up": "bg-orange-500",
  "Nurture / Not Now": "bg-slate-500",
  "Closed Won": "bg-green-600",
  "Closed Lost": "bg-red-500",
};

export default function Pipeline() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [newDeal, setNewDeal] = useState({
    contactId: "",
    pipeline: "sales",
    stage: "New Lead",
    offerPath: "",
    notes: "",
  });

  const [editStage, setEditStage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFollowUp, setEditFollowUp] = useState("");

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals", { pipeline: "sales" }],
    queryFn: async () => {
      const res = await fetch("/api/deals?pipeline=sales", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const createDealMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/deals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setCreateOpen(false);
      setNewDeal({ contactId: "", pipeline: "sales", stage: "New Lead", offerPath: "", notes: "" });
      toast({ title: "Deal created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create deal", description: err.message, variant: "destructive" });
    },
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setDetailOpen(false);
      setSelectedDeal(null);
      toast({ title: "Deal updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update deal", description: err.message, variant: "destructive" });
    },
  });

  const autoProgressMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/auto-progress-deals");
      return res.json();
    },
    onSuccess: (data: { progressed: number; progressions: Array<{ dealId: number; from: string; to: string; reason: string }> }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      if (data.progressed === 0) {
        toast({ title: "No deals to advance", description: "All deals are at the correct stage based on their data." });
      } else {
        toast({ title: `AI advanced ${data.progressed} deal${data.progressed > 1 ? "s" : ""}`, description: data.progressions.map(p => `Deal #${p.dealId}: ${p.from} → ${p.to}`).join(", ") });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Auto-progression failed", description: err.message, variant: "destructive" });
    },
  });

  const contactsMap = new Map<number, Contact>();
  contacts?.forEach((c) => contactsMap.set(c.id, c));

  const getContactName = (contactId: number | null) => {
    if (!contactId) return "No contact";
    const contact = contactsMap.get(contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : `Contact #${contactId}`;
  };

  const getCompanyName = (contactId: number | null) => {
    if (!contactId) return "";
    const contact = contactsMap.get(contactId);
    return contact?.companyName || "";
  };

  const handleCreateDeal = () => {
    const payload: Record<string, unknown> = {
      pipeline: newDeal.pipeline,
      stage: newDeal.stage,
      notes: newDeal.notes || undefined,
      offerPath: newDeal.offerPath || undefined,
    };
    if (newDeal.contactId) {
      payload.contactId = Number(newDeal.contactId);
    }
    createDealMutation.mutate(payload);
  };

  const handleUpdateDeal = () => {
    if (!selectedDeal) return;
    const updates: Record<string, unknown> = {};
    if (editStage && editStage !== selectedDeal.stage) updates.stage = editStage;
    if (editNotes !== (selectedDeal.notes || "")) updates.notes = editNotes;
    if (editFollowUp) updates.nextFollowUp = new Date(editFollowUp).toISOString();
    if (Object.keys(updates).length === 0) {
      setDetailOpen(false);
      return;
    }
    updateDealMutation.mutate({ id: selectedDeal.id, ...updates });
  };

  const openDealDetail = (deal: Deal) => {
    setSelectedDeal(deal);
    setEditStage(deal.stage);
    setEditNotes(deal.notes || "");
    setEditFollowUp(deal.nextFollowUp ? new Date(deal.nextFollowUp).toISOString().slice(0, 16) : "");
    setDetailOpen(true);
  };

  const getDealsByStage = (stage: string) => {
    return deals?.filter((d) => d.stage === stage) || [];
  };

  if (dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="pipeline-loading">
        <div className="text-muted-foreground">Loading pipeline...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="pipeline-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold" data-testid="text-pipeline-title">Sales Pipeline</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="outline"
            data-testid="button-ai-auto-progress"
            className="gap-2"
            onClick={() => autoProgressMutation.mutate()}
            disabled={autoProgressMutation.isPending}
          >
            {autoProgressMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Auto-Progress
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-deal" className="gap-2">
                <Plus className="w-4 h-4" />
                New Deal
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-deal">
            <DialogHeader>
              <DialogTitle>Create New Deal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select value={newDeal.contactId} onValueChange={(v) => setNewDeal({ ...newDeal, contactId: v })}>
                  <SelectTrigger data-testid="select-contact">
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`select-contact-${c.id}`}>
                        {c.firstName} {c.lastName} {c.companyName ? `- ${c.companyName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Input value={newDeal.pipeline} disabled data-testid="input-pipeline" />
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={newDeal.stage} onValueChange={(v) => setNewDeal({ ...newDeal, stage: v })}>
                  <SelectTrigger data-testid="select-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALES_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Offer Path</Label>
                <Select value={newDeal.offerPath} onValueChange={(v) => setNewDeal({ ...newDeal, offerPath: v })}>
                  <SelectTrigger data-testid="select-offer-path">
                    <SelectValue placeholder="Select offer path" />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFER_PATHS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={newDeal.notes}
                  onChange={(e) => setNewDeal({ ...newDeal, notes: e.target.value })}
                  placeholder="Deal notes..."
                  data-testid="input-notes"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
                  Cancel
                </Button>
                <Button onClick={handleCreateDeal} disabled={createDealMutation.isPending} data-testid="button-submit-deal">
                  {createDealMutation.isPending ? "Creating..." : "Create Deal"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <ScrollArea className="w-full" data-testid="pipeline-board">
        <div className="flex gap-4 pb-4" style={{ minWidth: `${SALES_STAGES.length * 280}px` }}>
          {SALES_STAGES.map((stage) => {
            const stageDeals = getDealsByStage(stage);
            const colorClass = STAGE_COLORS[stage] || "bg-gray-500";

            return (
              <div key={stage} className="w-[270px] flex-shrink-0" data-testid={`stage-column-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className={`${colorClass} text-white px-3 py-2 rounded-md mb-3 flex items-center justify-between gap-2`}>
                  <span className="text-sm font-semibold truncate">{stage}</span>
                  <Badge variant="secondary" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-count-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
                    {stageDeals.length}
                  </Badge>
                </div>
                <div className="space-y-3 min-h-[200px]">
                  {stageDeals.map((deal) => (
                    <Card
                      key={deal.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => openDealDetail(deal)}
                      data-testid={`card-deal-${deal.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="font-medium text-sm" data-testid={`text-deal-contact-${deal.id}`}>
                          {getContactName(deal.contactId)}
                        </div>
                        {getCompanyName(deal.contactId) && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-deal-company-${deal.id}`}>
                            {getCompanyName(deal.contactId)}
                          </div>
                        )}
                        {deal.offerPath && (
                          <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-offer-${deal.id}`}>
                            {deal.offerPath}
                          </Badge>
                        )}
                        <div className="text-xs text-muted-foreground" data-testid={`text-deal-date-${deal.id}`}>
                          <Calendar className="w-3 h-3 inline-block mr-1" />
                          {deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : "N/A"}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">No deals</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-deal-detail">
          <DialogHeader>
            <DialogTitle>Deal Details</DialogTitle>
          </DialogHeader>
          {selectedDeal && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Contact</span>
                  <div className="font-medium" data-testid="text-detail-contact">{getContactName(selectedDeal.contactId)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Company</span>
                  <div className="font-medium" data-testid="text-detail-company">{getCompanyName(selectedDeal.contactId) || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Pipeline</span>
                  <div className="font-medium" data-testid="text-detail-pipeline">{selectedDeal.pipeline}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Offer Path</span>
                  <div className="font-medium" data-testid="text-detail-offer">{selectedDeal.offerPath || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <div className="font-medium" data-testid="text-detail-created">
                    {selectedDeal.createdAt ? new Date(selectedDeal.createdAt).toLocaleDateString() : "N/A"}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Owner</span>
                  <div className="font-medium" data-testid="text-detail-owner">{selectedDeal.owner || "Unassigned"}</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={editStage} onValueChange={setEditStage}>
                  <SelectTrigger data-testid="select-edit-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALES_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                  data-testid="input-edit-notes"
                />
              </div>

              <div className="space-y-2">
                <Label>Next Follow-Up</Label>
                <Input
                  type="datetime-local"
                  value={editFollowUp}
                  onChange={(e) => setEditFollowUp(e.target.value)}
                  data-testid="input-edit-followup"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDetailOpen(false)} data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button onClick={handleUpdateDeal} disabled={updateDealMutation.isPending} data-testid="button-save-deal">
                  {updateDealMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}