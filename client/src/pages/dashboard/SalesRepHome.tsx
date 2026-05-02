import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Phone, Mail, User, Clock, TrendingUp, Target, CheckCircle2, AlertTriangle,
  Loader2, CalendarDays, PhoneCall, Link2, Copy, ChevronRight, Star,
  BookOpen, LayoutDashboard, Users, ClipboardList, Calendar, FileText,
} from "lucide-react";
import { SALES_STAGES } from "@shared/schema";

interface MyDayData {
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    commissionSplitPercent: number;
  } | null;
  contacts: Array<{
    id: number;
    firstName: string;
    lastName: string;
    companyName: string | null;
    phone: string;
    email: string;
    lastContactedAt: string | null;
    leadScore: number;
    status: string | null;
    dealStage: string | null;
    dealId: number | null;
  }>;
  dealsByStage: Record<string, Array<{
    id: number;
    contactId: number | null;
    stage: string;
    estimatedGrossProfitMonthly: string | null;
    estMonthlyRevenue: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }>>;
  openDeals: any[];
  quota: {
    period: string;
    targetDeals: number;
    actualDeals: number;
    targetRevenue: string;
    actualRevenue: string;
  } | null;
  closedWonThisMonth: number;
  tasksToday: Array<{
    id: number;
    title: string;
    description: string | null;
    dueDate: string | null;
    status: string | null;
    priority: string | null;
  }>;
}

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

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function LogActivityDialog({
  contactId,
  contactName,
  open,
  onClose,
}: {
  contactId: number;
  contactName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState("call");
  const [notes, setNotes] = useState("");

  const logMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/my-day/log-activity", { contactId, type, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      toast({ title: "Activity logged" });
      onClose();
      setNotes("");
    },
    onError: (err: Error) => toast({ title: "Failed to log", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-log-activity">
        <DialogHeader>
          <DialogTitle>Log Activity — {contactName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Activity Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Phone Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened?"
              data-testid="input-activity-notes"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-log">Cancel</Button>
            <Button
              onClick={() => logMutation.mutate()}
              disabled={logMutation.isPending}
              data-testid="button-submit-log"
            >
              {logMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Log Activity
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveStageDialog({
  dealId,
  currentStage,
  open,
  onClose,
}: {
  dealId: number;
  currentStage: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [stage, setStage] = useState(currentStage);

  const moveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/my-day/deals/${dealId}/stage`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      toast({ title: "Deal stage updated" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-move-stage">
        <DialogHeader>
          <DialogTitle>Move Deal Stage</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>New Stage</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger data-testid="select-new-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-stage">Cancel</Button>
            <Button
              onClick={() => moveMutation.mutate()}
              disabled={moveMutation.isPending || stage === currentStage}
              data-testid="button-confirm-stage"
            >
              {moveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Move Stage
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OnePagerDialog({ open, onClose, agentName }: { open: boolean; onClose: () => void; agentName: string }) {
  const { toast } = useToast();
  const [selectedVertical, setSelectedVertical] = useState("restaurant");
  const [prospectName, setProspectName] = useState("");

  const VERTICALS = [
    { value: "restaurant", label: "Restaurant" },
    { value: "retail", label: "Retail" },
    { value: "healthcare", label: "Healthcare" },
    { value: "home-services", label: "Home Services" },
    { value: "ecommerce", label: "E-Commerce" },
    { value: "cash-discount", label: "Cash Discount" },
    { value: "compare-rates", label: "Compare Rates" },
  ];

  const slug = selectedVertical;
  const utmParams = new URLSearchParams({
    utm_source: "rep",
    utm_medium: "direct",
    utm_campaign: "agent-share",
    utm_content: agentName.toLowerCase().replace(/\s+/g, "_"),
    ...(prospectName ? { utm_term: prospectName.toLowerCase().replace(/\s+/g, "_") } : {}),
  });

  const baseUrl = window.location.origin;
  const generatedUrl = `${baseUrl}/sales/${slug}?${utmParams.toString()}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl);
    toast({ title: "Link copied!", description: "Send this link to your prospect." });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-one-pager">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Generate Shareable One-Pager
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Vertical / Industry</Label>
            <Select value={selectedVertical} onValueChange={setSelectedVertical}>
              <SelectTrigger data-testid="select-vertical">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERTICALS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prospect Name (optional — for tracking)</Label>
            <Input
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              placeholder="e.g. Joe's Pizza"
              data-testid="input-prospect-name"
            />
          </div>
          <div className="rounded-md border bg-muted/50 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Generated Link</p>
            <p className="text-xs break-all font-mono" data-testid="text-generated-url">{generatedUrl}</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleCopy} data-testid="button-copy-link">
              <Copy className="w-4 h-4 mr-2" />
              Copy Link
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open(generatedUrl, "_blank")}
              data-testid="button-preview-link"
            >
              Preview
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this link via text or email. Activity is tracked back to you automatically.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesRepHome() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logActivityContact, setLogActivityContact] = useState<{ id: number; name: string } | null>(null);
  const [moveStageDeal, setMoveStageDeal] = useState<{ id: number; stage: string } | null>(null);
  const [onePagerOpen, setOnePagerOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<MyDayData>({
    queryKey: ["/api/my-day"],
    refetchInterval: 60000,
  });

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const agentName = data?.agent
    ? `${data.agent.firstName} ${data.agent.lastName}`
    : `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="my-day-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4" data-testid="my-day-error">
        <AlertTriangle className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">Could not load your dashboard. Please refresh.</p>
      </div>
    );
  }

  const { contacts = [], dealsByStage = {}, quota, closedWonThisMonth = 0, tasksToday = [] } = data ?? {};

  const stagesWithDeals = SALES_STAGES.filter(
    (s) => s !== "Closed Won" && s !== "Closed Lost" && (dealsByStage[s]?.length ?? 0) > 0
  );

  const overdueTasks = tasksToday.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed"
  );

  const quotaDealsPercent = quota && quota.targetDeals > 0
    ? Math.min(Math.round((quota.actualDeals / quota.targetDeals) * 100), 100)
    : null;

  const quotaRevenueTarget = parseFloat(quota?.targetRevenue ?? "0");
  const quotaRevenueActual = parseFloat(quota?.actualRevenue ?? "0");
  const quotaRevenuePercent = quotaRevenueTarget > 0
    ? Math.min(Math.round((quotaRevenueActual / quotaRevenueTarget) * 100), 100)
    : null;

  return (
    <div className="space-y-6" data-testid="my-day-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-my-day-title">
            Good morning, {user?.firstName || "there"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-today-date">{today}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setOnePagerOpen(true)} data-testid="button-generate-link">
            <Link2 className="w-4 h-4 mr-2" />
            Share One-Pager
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/assets" data-testid="link-collateral">
              <BookOpen className="w-4 h-4 mr-2" />
              Collateral
            </Link>
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="stat-contacts-today">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Users className="w-3.5 h-3.5" />
              Contacts to Call
            </div>
            <div className="text-2xl font-bold" data-testid="text-contacts-count">{contacts.length}</div>
          </CardContent>
        </Card>
        <Card data-testid="stat-open-deals">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Open Deals
            </div>
            <div className="text-2xl font-bold" data-testid="text-open-deals-count">
              {Object.values(dealsByStage).flat().length}
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-tasks-due">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <ClipboardList className="w-3.5 h-3.5" />
              Tasks Due
            </div>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold" data-testid="text-tasks-count">{tasksToday.length}</div>
              {overdueTasks.length > 0 && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-overdue-tasks">
                  {overdueTasks.length} overdue
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-closed-won">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Star className="w-3.5 h-3.5 text-green-600" />
              Closed Won (MTD)
            </div>
            <div className="text-2xl font-bold text-green-600" data-testid="text-closed-won-count">
              {closedWonThisMonth}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* My Contacts Today */}
        <div className="xl:col-span-2 space-y-4">
          <Card data-testid="card-contacts-today">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  My Contacts Today
                </CardTitle>
                <Button variant="ghost" size="sm" asChild data-testid="link-all-contacts">
                  <Link href="/dashboard/contacts">
                    View All <ChevronRight className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {contacts.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground" data-testid="text-no-contacts">
                  No contacts assigned. Add deals to see contacts here.
                </div>
              ) : (
                <div className="divide-y" data-testid="contacts-list">
                  {contacts.slice(0, 20).map((contact) => (
                    <div
                      key={contact.id}
                      className="px-4 py-3 hover:bg-muted/30 transition-colors"
                      data-testid={`contact-row-${contact.id}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-contact-name-${contact.id}`}>
                              {contact.firstName} {contact.lastName}
                            </span>
                            {contact.dealStage && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-contact-stage-${contact.id}`}
                              >
                                {contact.dealStage}
                              </Badge>
                            )}
                            {contact.leadScore > 70 && (
                              <Badge className="text-xs bg-amber-500 hover:bg-amber-500" data-testid={`badge-hot-${contact.id}`}>
                                Hot
                              </Badge>
                            )}
                          </div>
                          {contact.companyName && (
                            <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-contact-company-${contact.id}`}>
                              {contact.companyName}
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <a
                              href={`tel:${contact.phone}`}
                              className="flex items-center gap-1 hover:text-primary"
                              data-testid={`link-call-${contact.id}`}
                            >
                              <Phone className="w-3 h-3" />
                              {formatPhone(contact.phone)}
                            </a>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Last: {formatRelative(contact.lastContactedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => setLogActivityContact({ id: contact.id, name: `${contact.firstName} ${contact.lastName}` })}
                            data-testid={`button-log-activity-${contact.id}`}
                          >
                            <PhoneCall className="w-3 h-3 mr-1" />
                            Log
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2"
                            asChild
                          >
                            <Link href={`/dashboard/contacts/${contact.id}`} data-testid={`link-view-contact-${contact.id}`}>
                              <User className="w-3 h-3 mr-1" />
                              View
                            </Link>
                          </Button>
                          <a href={`mailto:${contact.email}`} data-testid={`link-email-${contact.id}`}>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <Mail className="w-3 h-3" />
                            </Button>
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* My Pipeline Strip */}
          <Card data-testid="card-pipeline">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  My Pipeline
                </CardTitle>
                <Button variant="ghost" size="sm" asChild data-testid="link-full-pipeline">
                  <Link href="/dashboard/pipeline">
                    Full Pipeline <ChevronRight className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {stagesWithDeals.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground" data-testid="text-no-pipeline">
                  No active deals yet. Deals assigned to you will appear here.
                </div>
              ) : (
                <div className="space-y-3" data-testid="pipeline-stages">
                  {stagesWithDeals.map((stage) => {
                    const stageDeals = dealsByStage[stage] ?? [];
                    const colorClass = STAGE_COLORS[stage] ?? "bg-slate-500";
                    return (
                      <div key={stage} data-testid={`stage-section-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${colorClass}`} />
                          <span className="text-sm font-medium">{stage}</span>
                          <Badge variant="secondary" className="text-xs ml-auto">
                            {stageDeals.length} deal{stageDeals.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-4">
                          {stageDeals.slice(0, 4).map((deal) => {
                            const contact = contacts.find((c) => c.id === deal.contactId);
                            const profit = deal.estimatedGrossProfitMonthly
                              ? `$${parseFloat(deal.estimatedGrossProfitMonthly).toLocaleString()}/mo`
                              : deal.estMonthlyRevenue
                              ? `$${parseFloat(deal.estMonthlyRevenue).toLocaleString()}/mo`
                              : null;

                            const createdDate = new Date(deal.createdAt);
                            const daysInStage = Math.floor((Date.now() - createdDate.getTime()) / 86400000);

                            return (
                              <div
                                key={deal.id}
                                className="border rounded-md p-2.5 bg-card text-sm flex items-center justify-between gap-2"
                                data-testid={`deal-card-${deal.id}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate" data-testid={`text-deal-contact-${deal.id}`}>
                                    {contact ? `${contact.firstName} ${contact.lastName}` : `Deal #${deal.id}`}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                    {profit && <span data-testid={`text-deal-value-${deal.id}`}>{profit}</span>}
                                    <span className="flex items-center gap-0.5">
                                      <CalendarDays className="w-3 h-3" />
                                      {daysInStage}d in stage
                                    </span>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2 shrink-0"
                                  onClick={() => setMoveStageDeal({ id: deal.id, stage: deal.stage })}
                                  data-testid={`button-move-stage-${deal.id}`}
                                >
                                  Move
                                </Button>
                              </div>
                            );
                          })}
                          {stageDeals.length > 4 && (
                            <div className="text-xs text-muted-foreground py-1 ml-1">
                              +{stageDeals.length - 4} more in this stage
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Quota Progress */}
          <Card data-testid="card-quota">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-green-600" />
                Quota Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!quota ? (
                <div className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-quota">
                  No quota set for this period.
                  <br />
                  <span className="text-xs">Contact your manager to set a target.</span>
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground font-medium mb-1" data-testid="text-quota-period">
                    {quota.period}
                  </div>
                  <div className="space-y-2" data-testid="quota-deals-progress">
                    <div className="flex items-center justify-between text-sm">
                      <span>Deals Closed</span>
                      <span className="font-medium">
                        {quota.actualDeals ?? 0} / {quota.targetDeals ?? 0}
                      </span>
                    </div>
                    <Progress
                      value={quotaDealsPercent ?? 0}
                      className="h-2"
                    />
                    <div className="text-xs text-right text-muted-foreground">{quotaDealsPercent ?? 0}%</div>
                  </div>
                  {quotaRevenueTarget > 0 && (
                    <div className="space-y-2" data-testid="quota-revenue-progress">
                      <div className="flex items-center justify-between text-sm">
                        <span>Revenue</span>
                        <span className="font-medium">
                          ${quotaRevenueActual.toLocaleString()} / ${quotaRevenueTarget.toLocaleString()}
                        </span>
                      </div>
                      <Progress value={quotaRevenuePercent ?? 0} className="h-2" />
                      <div className="text-xs text-right text-muted-foreground">{quotaRevenuePercent ?? 0}%</div>
                    </div>
                  )}
                  {closedWonThisMonth > 0 && (
                    <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-2 text-xs text-green-700 dark:text-green-400 flex items-center gap-2" data-testid="text-closed-won-banner">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {closedWonThisMonth} deal{closedWonThisMonth !== 1 ? "s" : ""} closed this month!
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Tasks Due Today */}
          <Card data-testid="card-tasks-today">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-primary" />
                  My Tasks
                </CardTitle>
                <Button variant="ghost" size="sm" asChild data-testid="link-all-tasks">
                  <Link href="/dashboard/tasks">
                    All Tasks <ChevronRight className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tasksToday.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-no-tasks">
                  No tasks due today.
                </div>
              ) : (
                <div className="divide-y" data-testid="tasks-list">
                  {tasksToday.slice(0, 8).map((task) => {
                    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "completed";
                    return (
                      <div
                        key={task.id}
                        className="px-4 py-2.5 flex items-start gap-2"
                        data-testid={`task-row-${task.id}`}
                      >
                        <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                          task.priority === "urgent" ? "bg-red-500" :
                          task.priority === "high" ? "bg-amber-500" : "bg-slate-400"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" data-testid={`text-task-title-${task.id}`}>
                            {task.title}
                          </div>
                          {task.dueDate && (
                            <div className={`text-xs mt-0.5 ${isOverdue ? "text-destructive" : "text-muted-foreground"}`} data-testid={`text-task-due-${task.id}`}>
                              {isOverdue ? "⚠ Overdue · " : ""}
                              {formatRelative(task.dueDate)}
                            </div>
                          )}
                        </div>
                        {task.status === "completed" && (
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card data-testid="card-quick-links">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4 text-primary" />
                Quick Access
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { href: "/dashboard/contacts", icon: Users, label: "Contacts" },
                { href: "/dashboard/pipeline", icon: TrendingUp, label: "Pipeline" },
                { href: "/dashboard/tasks", icon: ClipboardList, label: "Tasks" },
                { href: "/dashboard/calendar", icon: Calendar, label: "Calendar" },
                { href: "/dashboard/call-outcome", icon: PhoneCall, label: "Log Call" },
                { href: "/assets", icon: FileText, label: "Collateral" },
              ].map((item) => (
                <Button
                  key={item.href}
                  variant="outline"
                  size="sm"
                  className="justify-start h-9 text-xs"
                  asChild
                >
                  <Link href={item.href} data-testid={`quick-link-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                    <item.icon className="w-3.5 h-3.5 mr-2" />
                    {item.label}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      {logActivityContact && (
        <LogActivityDialog
          contactId={logActivityContact.id}
          contactName={logActivityContact.name}
          open={!!logActivityContact}
          onClose={() => setLogActivityContact(null)}
        />
      )}
      {moveStageDeal && (
        <MoveStageDialog
          dealId={moveStageDeal.id}
          currentStage={moveStageDeal.stage}
          open={!!moveStageDeal}
          onClose={() => setMoveStageDeal(null)}
        />
      )}
      <OnePagerDialog
        open={onePagerOpen}
        onClose={() => setOnePagerOpen(false)}
        agentName={agentName}
      />
    </div>
  );
}
