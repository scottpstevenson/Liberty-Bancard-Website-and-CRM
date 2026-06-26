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
import { Calendar, Sparkles, Loader2, Package, CheckCircle2, Circle, Clock, AlertTriangle, FileText, Users, ArrowRight, Timer } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import type { Deal, Contact } from "@shared/schema";
import { ONBOARDING_STAGES } from "@shared/schema";

interface OnboardingStatus {
  dealId: number;
  contactId: number | null;
  stage: string;
  progress: number;
  milestones: Array<{ name: string; done: boolean }>;
  pendingTasks: number;
  nextStep: string;
  daysSinceSignup: number;
  docReadiness: {
    statement: boolean;
    voidedCheck: boolean;
    id: boolean;
    appCompleted: boolean;
    score: number;
  };
  goLiveDate: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

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

function getDaysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function getDaysColor(days: number): string {
  if (days <= 3) return "text-green-600 dark:text-green-400";
  if (days <= 7) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export default function Onboarding() {
  const { toast } = useToast();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [editStage, setEditStage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editGoLiveDate, setEditGoLiveDate] = useState("");
  const [editTerminalRec, setEditTerminalRec] = useState("");
  const [editTerminalStatus, setEditTerminalStatus] = useState("");

  const { data: dealsResult, isLoading: dealsLoading } = useQuery<{ data: Deal[]; total: number }>({
    queryKey: ["/api/deals", { pipeline: "onboarding" }],
    queryFn: async () => {
      const res = await fetch("/api/deals?pipeline=onboarding&limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
  });
  const deals = dealsResult?.data;

  const { data: onboardingStatuses } = useQuery<OnboardingStatus[]>({
    queryKey: ["/api/ai/onboarding-status"],
    queryFn: async () => {
      const res = await fetch("/api/ai/onboarding-status", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: contactsResult } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts?limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });
  const contacts = contactsResult?.data;

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/onboarding-status"] });
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
    if (editTerminalRec !== (selectedDeal.terminalRecommendation || "")) updates.terminalRecommendation = editTerminalRec;
    if (editTerminalStatus !== (selectedDeal.terminalStatus || "")) updates.terminalStatus = editTerminalStatus;
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
    setEditTerminalRec(deal.terminalRecommendation || "");
    setEditTerminalStatus(deal.terminalStatus || "");
    setDetailOpen(true);
  };

  const getDealsByStage = (stage: string) => {
    return deals?.filter((d) => d.stage === stage) || [];
  };

  const totalDeals = deals?.length || 0;
  const avgProgress = onboardingStatuses?.length
    ? Math.round(onboardingStatuses.reduce((sum, s) => sum + s.progress, 0) / onboardingStatuses.length)
    : 0;
  const atRiskDeals = onboardingStatuses?.filter(s => s.daysSinceSignup > 7 && s.progress < 50).length || 0;
  const pendingDocsCount = onboardingStatuses?.filter(s => s.docReadiness && s.docReadiness.score < 100).length || 0;

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="onboarding-summary-stats">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-total-onboarding">{totalDeals}</p>
              <p className="text-xs text-muted-foreground">Total Onboarding</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center shrink-0">
              <ArrowRight className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-avg-progress">{avgProgress}%</p>
              <p className="text-xs text-muted-foreground">Avg Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-at-risk">{atRiskDeals}</p>
              <p className="text-xs text-muted-foreground">At Risk ({">"}7d, {"<"}50%)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-pending-docs">{pendingDocsCount}</p>
              <p className="text-xs text-muted-foreground">Pending Docs</p>
            </div>
          </CardContent>
        </Card>
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
                  {stageDeals.map((deal) => {
                    const status = onboardingStatuses?.find(s => s.dealId === deal.id);
                    return (
                      <Card
                        key={deal.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => openDealDetail(deal)}
                        data-testid={`card-onboarding-deal-${deal.id}`}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm" data-testid={`text-onboarding-contact-${deal.id}`}>
                              {getContactName(deal.contactId)}
                            </div>
                            {status && (
                              <div className={`text-xs font-medium flex items-center gap-1 shrink-0 ${getDaysColor(status.daysSinceSignup)}`} data-testid={`text-days-since-${deal.id}`}>
                                <Timer className="w-3 h-3" />
                                {getDaysLabel(status.daysSinceSignup)}
                              </div>
                            )}
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
                          {status ? (
                            <div className="space-y-1.5 pt-1 border-t mt-2" data-testid={`onboarding-progress-${deal.id}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">{status.progress}%</span>
                                {status.pendingTasks > 0 && (
                                  <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">
                                    {status.pendingTasks} tasks
                                  </Badge>
                                )}
                              </div>
                              <Progress value={status.progress} className="h-1.5" />
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Next: {status.nextStep}
                              </div>
                              {status.docReadiness && status.docReadiness.score < 100 && (
                                <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" data-testid={`doc-readiness-${deal.id}`}>
                                  <FileText className="w-3 h-3" />
                                  Docs: {status.docReadiness.score}%
                                  {!status.docReadiness.statement && <span className="text-[10px]">(stmt)</span>}
                                  {!status.docReadiness.voidedCheck && <span className="text-[10px]">(check)</span>}
                                  {!status.docReadiness.id && <span className="text-[10px]">(ID)</span>}
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            {deal.mid ? (
                              <Badge
                                variant="outline"
                                className="text-xs font-mono text-green-700 dark:text-green-400 border-green-300 no-default-hover-elevate no-default-active-elevate"
                                data-testid={`badge-mid-${deal.id}`}
                              >
                                MID: {deal.mid}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-xs text-muted-foreground no-default-hover-elevate no-default-active-elevate"
                                data-testid={`badge-mid-pending-${deal.id}`}
                              >
                                MID Pending
                              </Badge>
                            )}
                            {deal.terminalStatus && (
                              <Badge
                                variant="outline"
                                className="text-xs no-default-hover-elevate no-default-active-elevate"
                                data-testid={`badge-terminal-${deal.id}`}
                              >
                                <Package className="w-3 h-3 mr-1" />
                                {deal.terminalStatus}
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
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

              {(() => {
                const status = onboardingStatuses?.find(s => s.dealId === selectedDeal.id);
                return status ? (
                  <>
                    <div className="border-t pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Onboarding Progress</h4>
                        <span className={`text-xs font-medium ${getDaysColor(status.daysSinceSignup)}`}>
                          {getDaysLabel(status.daysSinceSignup)} since signup
                        </span>
                      </div>
                      <Progress value={status.progress} className="h-2" />
                      <div className="space-y-1">
                        {status.milestones.map((m, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm" data-testid={`milestone-${i}`}>
                            {m.done ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                            <span className={m.done ? "text-muted-foreground line-through" : ""}>{m.name}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-sm bg-muted/50 p-2 rounded-md flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary shrink-0" />
                        <span>Next: {status.nextStep}</span>
                      </div>
                    </div>

                    {status.docReadiness && (
                      <div className="border-t pt-3 space-y-2">
                        <h4 className="text-sm font-medium">Document Readiness ({status.docReadiness.score}%)</h4>
                        <Progress value={status.docReadiness.score} className="h-1.5" />
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex items-center gap-2" data-testid="doc-statement-status">
                            {status.docReadiness.statement ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className={status.docReadiness.statement ? "text-muted-foreground" : ""}>Statement</span>
                          </div>
                          <div className="flex items-center gap-2" data-testid="doc-check-status">
                            {status.docReadiness.voidedCheck ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className={status.docReadiness.voidedCheck ? "text-muted-foreground" : ""}>Voided Check</span>
                          </div>
                          <div className="flex items-center gap-2" data-testid="doc-id-status">
                            {status.docReadiness.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className={status.docReadiness.id ? "text-muted-foreground" : ""}>Government ID</span>
                          </div>
                          <div className="flex items-center gap-2" data-testid="doc-app-status">
                            {status.docReadiness.appCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className={status.docReadiness.appCompleted ? "text-muted-foreground" : ""}>Application</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : null;
              })()}

              {selectedDeal.pipeline === "onboarding" && (
                <div className="border-t pt-3 space-y-3">
                  <h4 className="text-sm font-medium">Terminal & Shipping</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Terminal</span>
                      <div className="font-medium" data-testid="text-terminal-recommendation">
                        {selectedDeal.terminalRecommendation || "Not set"}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <div className="font-medium" data-testid="text-terminal-status">
                        {selectedDeal.terminalStatus || "Not ordered"}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Terminal Recommendation</Label>
                    <Select value={editTerminalRec} onValueChange={setEditTerminalRec}>
                      <SelectTrigger data-testid="select-terminal-recommendation">
                        <SelectValue placeholder="Select terminal" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Clover Flex">Clover Flex</SelectItem>
                        <SelectItem value="Clover Mini">Clover Mini</SelectItem>
                        <SelectItem value="Clover Station">Clover Station</SelectItem>
                        <SelectItem value="Dejavoo Z11">Dejavoo Z11</SelectItem>
                        <SelectItem value="PAX A920">PAX A920</SelectItem>
                        <SelectItem value="Virtual Terminal">Virtual Terminal</SelectItem>
                        <SelectItem value="Gateway Only">Gateway Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Shipping Status</Label>
                    <Select value={editTerminalStatus} onValueChange={setEditTerminalStatus}>
                      <SelectTrigger data-testid="select-terminal-status">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Not Ordered">Not Ordered</SelectItem>
                        <SelectItem value="Ordered">Ordered</SelectItem>
                        <SelectItem value="Shipped">Shipped</SelectItem>
                        <SelectItem value="In Transit">In Transit</SelectItem>
                        <SelectItem value="Delivered">Delivered</SelectItem>
                        <SelectItem value="Installed">Installed</SelectItem>
                        <SelectItem value="N/A - Virtual">N/A - Virtual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

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
