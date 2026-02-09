import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Deal, Contact } from "@shared/schema";
import { ONBOARDING_STAGES } from "@shared/schema";

const STAGE_COLORS: Record<string, string> = {
  "Contract Sent": "bg-blue-300 dark:bg-blue-700",
  "Application Started": "bg-blue-400 dark:bg-blue-600",
  "Underwriting Submitted": "bg-cyan-500 dark:bg-cyan-600",
  "Approved": "bg-teal-500 dark:bg-teal-600",
  "Terminal Ordered": "bg-emerald-400 dark:bg-emerald-600",
  "Go-Live Scheduled": "bg-emerald-500 dark:bg-emerald-500",
  "Live (First Batch)": "bg-green-500 dark:bg-green-600",
  "Active (7 Days)": "bg-green-600 dark:bg-green-500",
  "Active (30 Days)": "bg-green-700 dark:bg-green-400",
};

export default function Onboarding() {
  const { toast } = useToast();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [editStage, setEditStage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editGoLiveDate, setEditGoLiveDate] = useState("");

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals", { pipeline: "onboarding" }],
    queryFn: async () => {
      const res = await fetch("/api/deals?pipeline=onboarding", { credentials: "include" });
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

  const handleUpdateDeal = () => {
    if (!selectedDeal) return;
    const updates: Record<string, unknown> = {};
    if (editStage && editStage !== selectedDeal.stage) updates.stage = editStage;
    if (editNotes !== (selectedDeal.notes || "")) updates.notes = editNotes;
    if (editGoLiveDate) updates.goLiveDate = new Date(editGoLiveDate).toISOString();
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
    setEditGoLiveDate(deal.goLiveDate ? new Date(deal.goLiveDate).toISOString().slice(0, 16) : "");
    setDetailOpen(true);
  };

  const getDealsByStage = (stage: string) => {
    return deals?.filter((d) => d.stage === stage) || [];
  };

  if (dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="onboarding-loading">
        <div className="text-muted-foreground">Loading onboarding pipeline...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="onboarding-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-onboarding-title">Onboarding Pipeline</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-onboarding-stages-note">
            Stages: Contract Sent &rarr; Application &rarr; Underwriting &rarr; Approved &rarr; Terminal &rarr; Go-Live &rarr; Active
          </p>
        </div>
      </div>

      <ScrollArea className="w-full" data-testid="onboarding-board">
        <div className="flex gap-4 pb-4" style={{ minWidth: `${ONBOARDING_STAGES.length * 280}px` }}>
          {ONBOARDING_STAGES.map((stage) => {
            const stageDeals = getDealsByStage(stage);
            const colorClass = STAGE_COLORS[stage] || "bg-gray-500";

            return (
              <div key={stage} className="w-[270px] flex-shrink-0" data-testid={`stage-column-${stage.replace(/[\s()\/]+/g, "-").toLowerCase()}`}>
                <div className={`${colorClass} text-white px-3 py-2 rounded-md mb-3 flex items-center justify-between gap-2`}>
                  <span className="text-sm font-semibold truncate">{stage}</span>
                  <Badge variant="secondary" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-count-${stage.replace(/[\s()\/]+/g, "-").toLowerCase()}`}>
                    {stageDeals.length}
                  </Badge>
                </div>
                <div className="space-y-3 min-h-[200px]">
                  {stageDeals.map((deal) => (
                    <Card
                      key={deal.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => openDealDetail(deal)}
                      data-testid={`card-onboarding-deal-${deal.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="font-medium text-sm" data-testid={`text-onboarding-contact-${deal.id}`}>
                          {getContactName(deal.contactId)}
                        </div>
                        {getCompanyName(deal.contactId) && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-onboarding-company-${deal.id}`}>
                            {getCompanyName(deal.contactId)}
                          </div>
                        )}
                        {deal.goLiveDate && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-onboarding-golive-${deal.id}`}>
                            <Calendar className="w-3 h-3 inline-block mr-1" />
                            Go-Live: {new Date(deal.goLiveDate).toLocaleDateString()}
                          </div>
                        )}
                        {deal.offerPath && (
                          <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-onboarding-offer-${deal.id}`}>
                            {deal.offerPath}
                          </Badge>
                        )}
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
        <DialogContent className="max-w-md" data-testid="dialog-onboarding-detail">
          <DialogHeader>
            <DialogTitle>Onboarding Deal Details</DialogTitle>
          </DialogHeader>
          {selectedDeal && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Contact</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-contact">{getContactName(selectedDeal.contactId)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Company</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-company">{getCompanyName(selectedDeal.contactId) || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Pipeline</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-pipeline">{selectedDeal.pipeline}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Offer Path</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-offer">{selectedDeal.offerPath || "N/A"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-created">
                    {selectedDeal.createdAt ? new Date(selectedDeal.createdAt).toLocaleDateString() : "N/A"}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Go-Live Date</span>
                  <div className="font-medium" data-testid="text-onboarding-detail-golive">
                    {selectedDeal.goLiveDate ? new Date(selectedDeal.goLiveDate).toLocaleDateString() : "Not set"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={editStage} onValueChange={setEditStage}>
                  <SelectTrigger data-testid="select-onboarding-edit-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ONBOARDING_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Go-Live Date</Label>
                <Input
                  type="datetime-local"
                  value={editGoLiveDate}
                  onChange={(e) => setEditGoLiveDate(e.target.value)}
                  data-testid="input-onboarding-edit-golive"
                />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                  data-testid="input-onboarding-edit-notes"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDetailOpen(false)} data-testid="button-onboarding-cancel-edit">
                  Cancel
                </Button>
                <Button onClick={handleUpdateDeal} disabled={updateDealMutation.isPending} data-testid="button-onboarding-save-deal">
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
