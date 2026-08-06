import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
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
  ExternalLink, XCircle, Activity, MessageSquare, Voicemail, Video,
  Trophy, TrendingDown, Minus, Crown, Medal, Award, Smartphone, QrCode, Calculator,
} from "lucide-react";
import { SALES_STAGES } from "@shared/schema";
import { trackPhoneCallClick } from "@/lib/analytics";

interface Appointment {
  id: string;
  title: string;
  contactName: string;
  contactId: string | null;
  startTime: string | number | null;
  endTime: string | number | null;
  status: string;
  calendarType: string;
  ghlLink: string | null;
  noShow: boolean;
  locationName: string | null;
}

function UpcomingMeetingsWidget() {
  const { data, isLoading } = useQuery<{ appointments: Appointment[]; configured: boolean }>({
    queryKey: ["/api/appointments"],
    refetchInterval: 5 * 60 * 1000,
  });

  const appointments = data?.appointments || [];

  function formatApptTime(ts: string | number | null): string {
    if (ts === null || ts === undefined || ts === "") return "—";
    const ms = typeof ts === "number" ? ts : Date.parse(ts);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <Card data-testid="card-upcoming-meetings">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Upcoming Meetings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !data?.configured ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Configure GHL calendar to see upcoming meetings
          </p>
        ) : appointments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No upcoming appointments scheduled
          </p>
        ) : (
          <div className="space-y-2">
            {appointments.slice(0, 5).map((appt) => (
              <div
                key={appt.id}
                className={`flex items-start gap-3 p-2.5 rounded-lg border ${appt.noShow ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800" : "bg-muted/40 border-transparent"}`}
                data-testid={`appt-row-${appt.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium truncate">{appt.contactName}</span>
                    {appt.noShow && (
                      <Badge variant="destructive" className="text-[10px] h-4">No-Show</Badge>
                    )}
                    {appt.status && appt.status !== "booked" && !appt.noShow && (
                      <Badge variant="secondary" className="text-[10px] h-4 capitalize">{appt.status}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span className="truncate">{formatApptTime(appt.startTime)}</span>
                  </div>
                  {appt.locationName && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{appt.locationName}</p>
                  )}
                </div>
                {appt.ghlLink && (
                  <a
                    href={appt.ghlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-primary hover:underline text-xs flex items-center gap-0.5"
                    data-testid={`appt-join-${appt.id}`}
                  >
                    Join <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LeaderboardEntry {
  agentId: number;
  name: string;
  initials: string;
  rank: number;
  dealsClosed: number;
  revenueManaged: number;
  proposalsSent: number;
  callsMade: number;
  responseRate: number;
  prevDealsClosed: number;
  prevRevenueManaged: number;
  prevProposalsSent: number;
  prevCallsMade: number;
  prevResponseRate: number;
  isCurrentUser: boolean;
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  period: string;
  settings: {
    showDeals: boolean;
    showRevenue: boolean;
    visibleToAgents: boolean;
    monthlyDealGoal: number;
    monthlyRevenueGoal: string;
  };
}

function formatRevenueShort(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${Math.round(val)}`;
}

function YourRankCard() {
  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/leaderboard", "month"],
    queryFn: async () => {
      const res = await fetch("/api/leaderboard?period=month", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-your-rank">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" />
            Your Rank
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  const entries = data?.entries ?? [];
  const settings = data?.settings;

  const sortedByDeals = [...entries].sort((a, b) => b.dealsClosed - a.dealsClosed);
  const me = sortedByDeals.find((e) => e.isCurrentUser);
  const myRank = me ? sortedByDeals.indexOf(me) + 1 : null;
  const totalAgents = sortedByDeals.length;

  // Compute previous-month rank for movement indicator
  const sortedByPrevDeals = [...entries].sort((a, b) => b.prevDealsClosed - a.prevDealsClosed);
  const prevRank = me ? sortedByPrevDeals.findIndex((e) => e.agentId === me.agentId) + 1 : 0;

  if (!me || totalAgents === 0) {
    return (
      <Card data-testid="card-your-rank">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" />
            Your Rank
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4" data-testid="text-no-rank">
            {settings && !settings.visibleToAgents
              ? "Leaderboard hidden by your team admin."
              : "Rank will appear once you have activity this month."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const dealGoal = settings?.monthlyDealGoal ?? 0;
  const revenueGoal = settings ? parseFloat(settings.monthlyRevenueGoal) || 0 : 0;
  const dealPct = dealGoal > 0 ? Math.min(100, Math.round((me.dealsClosed / dealGoal) * 100)) : null;
  const revenuePct = revenueGoal > 0 ? Math.min(100, Math.round((me.revenueManaged / revenueGoal) * 100)) : null;

  const rankDelta = prevRank > 0 ? prevRank - myRank! : 0; // positive = moved up
  const RankIcon = myRank === 1 ? Crown : myRank === 2 ? Medal : myRank === 3 ? Award : Trophy;
  const rankColor = myRank === 1 ? "text-yellow-500" : myRank === 2 ? "text-gray-400" : myRank === 3 ? "text-amber-600" : "text-primary";

  return (
    <Card data-testid="card-your-rank">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" />
            Your Rank
          </div>
          <Button variant="ghost" size="sm" asChild data-testid="link-leaderboard">
            <Link href="/dashboard/leaderboard">
              View <ChevronRight className="w-3 h-3 ml-0.5" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full bg-muted flex items-center justify-center ${rankColor}`}>
            <RankIcon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-your-rank">#{myRank}</span>
              <span className="text-xs text-muted-foreground">of {totalAgents}</span>
            </div>
            <div className="flex items-center gap-1 text-xs mt-0.5" data-testid="text-rank-trend">
              {prevRank === 0 ? (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Minus className="w-3 h-3" /> No data last month
                </span>
              ) : rankDelta > 0 ? (
                <span className="text-green-600 dark:text-green-500 flex items-center gap-1 font-medium">
                  <TrendingUp className="w-3 h-3" /> Up {rankDelta} from last month
                </span>
              ) : rankDelta < 0 ? (
                <span className="text-destructive flex items-center gap-1 font-medium">
                  <TrendingDown className="w-3 h-3" /> Down {Math.abs(rankDelta)} from last month
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Minus className="w-3 h-3" /> Same as last month
                </span>
              )}
            </div>
          </div>
        </div>

        {dealPct !== null && (
          <div className="space-y-1.5" data-testid="rank-deals-progress">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1.5">
                <Target className="w-3 h-3 text-primary" />
                Deals Closed
              </span>
              <span className="text-muted-foreground" data-testid="text-rank-deals-value">
                {me.dealsClosed} / {dealGoal}
              </span>
            </div>
            <Progress value={dealPct} className="h-1.5" />
          </div>
        )}

        {revenuePct !== null && (
          <div className="space-y-1.5" data-testid="rank-revenue-progress">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3 text-green-600" />
                Revenue
              </span>
              <span className="text-muted-foreground" data-testid="text-rank-revenue-value">
                {formatRevenueShort(me.revenueManaged)} / {formatRevenueShort(revenueGoal)}
              </span>
            </div>
            <Progress value={revenuePct} className="h-1.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
  recentActivity: Array<{
    id: number;
    contactId: number | null;
    outcome: string | null;
    summary: string | null;
    createdAt: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    contactCompanyName: string | null;
  }>;
}

const STAGE_COLORS: Record<string, string> = {
  "New Lead": "bg-blue-500",
  "Statement Received": "bg-indigo-500",
  "Review In Progress": "bg-violet-500",
  "Call Booked": "bg-cyan-500",
  "Proposal Sent": "bg-amber-500",
  "Negotiation / Follow-Up": "bg-orange-500",
  "Verbal Commit": "bg-purple-500",
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

function MobileAppCard() {
  const { toast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [showInstructions, setShowInstructions] = useState(false);
  const mobileUrl = typeof window !== "undefined" ? `${window.location.origin}/mobile` : "/mobile";

  useEffect(() => {
    QRCode.toDataURL(mobileUrl, { width: 160, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [mobileUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mobileUrl);
    toast({ title: "Link copied", description: "Mobile app URL copied to clipboard." });
  };

  return (
    <Card data-testid="card-mobile-app" className="border-blue-200 dark:border-blue-900 bg-gradient-to-br from-blue-50/60 to-transparent dark:from-blue-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Mobile Field App
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Take the CRM with you in the field. Scan the QR code with your phone or open it directly.
        </p>
        <div className="flex items-start gap-3">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Mobile app QR code"
              className="w-24 h-24 rounded-md border bg-white p-1 shrink-0"
              data-testid="img-mobile-qr"
            />
          ) : (
            <div className="w-24 h-24 rounded-md border bg-muted flex items-center justify-center shrink-0">
              <QrCode className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1.5">
            <Button size="sm" variant="default" className="w-full h-8 text-xs" asChild data-testid="link-open-mobile">
              <a href="/mobile" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3 mr-1.5" />
                Open Mobile App
              </a>
            </Button>
            <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={handleCopy} data-testid="button-copy-mobile-url">
              <Copy className="w-3 h-3 mr-1.5" />
              Copy Link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full h-7 text-xs text-muted-foreground"
              onClick={() => setShowInstructions((v) => !v)}
              data-testid="button-toggle-install-instructions"
            >
              {showInstructions ? "Hide" : "Add to Home Screen"}
              <ChevronRight className={`w-3 h-3 ml-1 transition-transform ${showInstructions ? "rotate-90" : ""}`} />
            </Button>
          </div>
        </div>
        {showInstructions && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-3 space-y-1.5" data-testid="install-instructions">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>iOS (Safari):</strong> Tap Share, then "Add to Home Screen".
            </p>
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>Android (Chrome):</strong> Tap the menu, then "Add to Home Screen".
            </p>
          </div>
        )}
      </CardContent>
    </Card>
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

  const { contacts = [], dealsByStage = {}, quota, closedWonThisMonth = 0, tasksToday = [], recentActivity = [] } = data ?? {};

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
                              onClick={() => trackPhoneCallClick({ contactId: contact.id, sourcePage: "/dashboard/sales-rep" })}
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
          {/* Mobile Field App */}
          <MobileAppCard />

          {/* Your Rank */}
          <YourRankCard />

          {/* Upcoming Meetings */}
          <UpcomingMeetingsWidget />

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

          {/* Recent Activity */}
          <Card data-testid="card-recent-activity">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentActivity.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-no-recent-activity">
                  No activity logged yet. Use "Log" on a contact to get started.
                </div>
              ) : (
                <div className="divide-y" data-testid="recent-activity-list">
                  {recentActivity.map((entry) => {
                    const contactName = entry.contactFirstName
                      ? `${entry.contactFirstName} ${entry.contactLastName ?? ""}`.trim()
                      : entry.contactCompanyName ?? "Unknown";
                    const activityType = entry.outcome ?? "activity";
                    const typeLabel = activityType.charAt(0).toUpperCase() + activityType.slice(1);
                    const icon = activityType === "call" ? Phone
                      : activityType === "email" ? Mail
                      : activityType === "sms" ? MessageSquare
                      : activityType === "voicemail" ? Voicemail
                      : activityType === "meeting" ? Video
                      : Activity;
                    const IconComponent = icon;
                    return (
                      <div
                        key={entry.id}
                        className="px-4 py-2.5 flex items-start gap-2.5"
                        data-testid={`activity-row-${entry.id}`}
                      >
                        <div className="mt-0.5 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <IconComponent className="w-3 h-3 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate" data-testid={`text-activity-contact-${entry.id}`}>
                              {contactName}
                            </span>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1" data-testid={`badge-activity-type-${entry.id}`}>
                              {typeLabel}
                            </Badge>
                          </div>
                          {entry.summary && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-activity-notes-${entry.id}`}>
                              {entry.summary}
                            </p>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1" data-testid={`text-activity-time-${entry.id}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {formatRelative(entry.createdAt)}
                          </div>
                        </div>
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
                { href: "/sales/agent-calculator", icon: Calculator, label: "Earnings Calc" },
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
