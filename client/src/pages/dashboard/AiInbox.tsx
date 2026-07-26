import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Inbox, RefreshCw, AlertTriangle, Mail, MessageSquare, Bot, ArrowLeft, CheckCircle2, Ban, UserCheck, Phone, Calendar, Upload, Zap, Users, ShieldAlert, ExternalLink, Clock, Flag, User } from "lucide-react";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface InboxItem {
  id: string;
  contactId: number | null;
  contactName: string;
  companyName: string;
  channel: "email" | "sms" | "ghl_chat";
  direction: "inbound";
  body: string;
  receivedAt: string;
  intentLabel: string | null;
  confidence: number | null;
  isRead: boolean;
  phone?: string;
  ghlConversationId?: string;
}

interface Classification {
  intent: string;
  confidence: number;
  reasoning: string;
}

interface ClassifyResult {
  itemId: string;
  classification: Classification;
  suggestedReply: string;
  nextAction: string;
  senderIdentity: {
    from: string;
    replyTo: string;
    displayName: string;
    signatureType: string;
    department: string;
  };
  channel: string;
  sendBlocked: boolean;
  sendBlockReason: string | null;
  hasCalendar: boolean;
  bookingUrl: string | null;
}

interface InboxOwnership {
  sourceItemId?: string;
  ownerId?: string | null;
  ownerName?: string | null;
  department?: string;
  status?: string;
  priority?: string;
  slaDueAt?: string | null;
  nextAction?: string | null;
  escalationPath?: string | null;
  notes?: string | null;
}

interface StaffUser {
  id: string;
  email: string | null;
  role: string | null;
  firstName: string | null;
  lastName: string | null;
}

// ─── Intent metadata ─────────────────────────────────────────────────────────
const INTENT_META: Record<string, { label: string; color: string; emoji: string }> = {
  interested: { label: "Interested", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", emoji: "✅" },
  meeting_intent: { label: "Meeting Request", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", emoji: "📅" },
  send_info: { label: "Wants Info", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200", emoji: "📋" },
  pricing_question: { label: "Pricing Question", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200", emoji: "💰" },
  call_me: { label: "Call Me", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", emoji: "📞" },
  later: { label: "Later", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", emoji: "⏰" },
  not_interested: { label: "Not Interested", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", emoji: "👎" },
  already_have_provider: { label: "Has Provider", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", emoji: "🔒" },
  wrong_person: { label: "Wrong Person", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", emoji: "🔄" },
  stop: { label: "Stop / Opt-Out", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", emoji: "🛑" },
  angry: { label: "Angry / Hostile", color: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100", emoji: "⚠️" },
  booked: { label: "Booked", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", emoji: "🎉" },
  sent_statement: { label: "Sent Statement", color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", emoji: "📄" },
  unclear: { label: "Unclear", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", emoji: "❓" },
};

const CHANNEL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  email: { label: "Email", icon: <Mail className="w-3 h-3" /> },
  sms: { label: "SMS", icon: <Phone className="w-3 h-3" /> },
  ghl_chat: { label: "GHL Chat", icon: <MessageSquare className="w-3 h-3" /> },
};

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "text-gray-500" },
  normal: { label: "Normal", color: "text-blue-500" },
  high: { label: "High", color: "text-amber-500" },
  urgent: { label: "Urgent", color: "text-red-500" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  waiting: { label: "Waiting", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  escalated: { label: "Escalated 🚨", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const UPLOAD_INSTRUCTIONS = `Please upload your most recent processing statement using this secure link:
https://libertybancard.com/upload-statement

Once we receive it, our team will prepare a personalized savings analysis within 24-48 hours. The review is completely free and there's no obligation.

If you have any questions, feel free to reply to this message or book a call: `;

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SlaCountdown({ slaDueAt }: { slaDueAt: string | null | undefined }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  if (!slaDueAt) return null;
  const due = new Date(slaDueAt).getTime();
  const diff = due - now;
  const breached = diff < 0;
  const absDiff = Math.abs(diff);
  const hours = Math.floor(absDiff / 3600000);
  const mins = Math.floor((absDiff % 3600000) / 60000);
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${breached ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
      <Clock className="w-3 h-3" />
      {breached ? `SLA breached ${label} ago` : `SLA in ${label}`}
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 85 ? "bg-green-500" : pct >= 65 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8">{pct}%</span>
    </div>
  );
}

// ─── Ownership Panel ───────────────────────────────────────────────────────────
function OwnershipPanel({
  itemId,
  contactId,
  intent,
  classifyResult,
  onEscalated,
}: {
  itemId: string;
  contactId: number | null;
  intent: string | undefined;
  classifyResult: ClassifyResult | null;
  onEscalated?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ownership, isLoading: ownershipLoading } = useQuery<InboxOwnership>({
    queryKey: ["/api/inbox/items", itemId, "ownership"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inbox/items/${itemId}/ownership`);
      return res.json();
    },
    enabled: !!itemId,
  });

  const { data: staffList = [] } = useQuery<StaffUser[]>({
    queryKey: ["/api/inbox/staff"],
    staleTime: 5 * 60 * 1000,
  });

  const [ownerId, setOwnerId] = useState("");
  const [department, setDepartment] = useState("sales");
  const [status, setStatus] = useState("new");
  const [priority, setPriority] = useState("normal");

  useEffect(() => {
    if (ownership) {
      setOwnerId(ownership.ownerId || "");
      setDepartment(ownership.department || "sales");
      setStatus(ownership.status || "new");
      setPriority(ownership.priority || "normal");
    }
  }, [ownership]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const selectedStaff = staffList.find((s) => s.id === ownerId);
      const res = await apiRequest("PATCH", `/api/inbox/items/${itemId}/ownership`, {
        ownerId: ownerId || undefined,
        ownerName: selectedStaff
          ? `${selectedStaff.firstName || ""} ${selectedStaff.lastName || ""}`.trim() || selectedStaff.email || undefined
          : undefined,
        department,
        status,
        priority,
        contactId: contactId || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items", itemId, "ownership"] });
      toast({ title: "Assignment saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const escalateMutation = useMutation({
    mutationFn: async () => {
      const csrf = getCsrfToken();
      const res = await fetch(`/api/inbox/items/${itemId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
        body: JSON.stringify({ contactId, intent, reason: "Manual escalation from inbox" }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items", itemId, "ownership"] });
      toast({ title: "🚨 Escalated to Scott", description: "Priority set to urgent, task + notification sent" });
      onEscalated?.();
    },
    onError: (err: any) => {
      toast({ title: "Escalation failed", description: err.message, variant: "destructive" });
    },
  });

  const noShowMutation = useMutation({
    mutationFn: async () => {
      const csrf = getCsrfToken();
      const res = await fetch(`/api/inbox/items/${itemId}/no-show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
        body: JSON.stringify({ contactId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items", itemId, "ownership"] });
      toast({ title: "No-show recorded", description: "Reschedule task created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  if (ownershipLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading ownership…
      </div>
    );
  }

  const slaDue = ownership?.slaDueAt;
  const statusMeta = STATUS_META[ownership?.status || "new"] || STATUS_META.new;
  const priorityMeta = PRIORITY_META[ownership?.priority || "normal"] || PRIORITY_META.normal;

  return (
    <div className="space-y-3" data-testid="panel-ownership">
      {/* Current state badges */}
      <div className="flex items-center flex-wrap gap-2">
        <Badge className={`text-[10px] ${statusMeta.color}`}>
          {statusMeta.label}
        </Badge>
        <span className={`text-xs font-medium flex items-center gap-0.5 ${priorityMeta.color}`}>
          <Flag className="w-3 h-3" />
          {priorityMeta.label}
        </span>
        {ownership?.ownerName && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <User className="w-3 h-3" />
            {ownership.ownerName}
          </span>
        )}
        <SlaCountdown slaDueAt={slaDue} />
      </div>

      {/* Assignment form */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Assign to</p>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-owner">
              <SelectValue placeholder="Choose owner…" />
            </SelectTrigger>
            <SelectContent>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.firstName ? `${s.firstName} ${s.lastName || ""}`.trim() : s.email || s.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Department</p>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="accounts">Accounts</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Status</p>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">Priority</p>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => assignMutation.mutate()}
          disabled={assignMutation.isPending}
          data-testid="button-save-ownership"
        >
          {assignMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Save Assignment
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400"
          onClick={() => escalateMutation.mutate()}
          disabled={escalateMutation.isPending}
          data-testid="button-escalate-ownership"
        >
          {escalateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldAlert className="w-3 h-3 mr-1" />}
          Escalate to Scott
        </Button>

        {(intent === "meeting_intent" || intent === "call_me" || intent === "booked") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
            onClick={() => noShowMutation.mutate()}
            disabled={noShowMutation.isPending}
            data-testid="button-mark-no-show"
          >
            {noShowMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Mark No-Show
          </Button>
        )}
      </div>

      {ownership?.escalationPath && (
        <p className="text-[10px] text-orange-600 dark:text-orange-400 italic">
          Escalation: {ownership.escalationPath}
        </p>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function AiInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [search, setSearch] = useState("");
  const [classifying, setClassifying] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{
    items: InboxItem[];
    total: number;
    ghlConfigured: boolean;
  }>({
    queryKey: ["/api/inbox/items"],
    refetchInterval: 60000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action, extra }: { action: string; extra?: Record<string, any> }) => {
      if (!selected) throw new Error("No item selected");
      const res = await apiRequest("POST", `/api/inbox/items/${selected.id}/action`, {
        action,
        contactId: selected.contactId,
        channel: selected.channel,
        intent: classifyResult?.classification.intent,
        confidence: classifyResult?.classification.confidence,
        replyText: action === "send_reply" ? replyDraft : undefined,
        ghlConversationId: selected.ghlConversationId,
        senderIdentity: classifyResult?.senderIdentity,
        ...extra,
      });
      const body = await res.json();
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || `Action "${action}" failed`);
      }
      return body;
    },
    onSuccess: (data: any, { action }) => {
      if (action === "send_reply") {
        if (data?.delivered === false) {
          toast({ title: "Draft saved (not sent)", description: data?.deliveryNote || "GHL not configured.", variant: "default" });
        } else {
          toast({ title: "Reply sent" });
        }
      } else {
        const labels: Record<string, string> = {
          book_appointment: "Appointment task created",
          send_upload_instructions: "Upload instructions inserted",
          create_task: "Task created",
          assign_to_sales: "Assigned to Sales",
          assign_to_support: "Assigned to Support",
          mark_unsubscribed: "Contact suppressed",
          escalate_to_scott: "Escalated to Scott",
        };
        toast({ title: labels[action] || "Action complete" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items"] });
    },
    onError: (err: any) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  const bookAppointmentMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No item selected");
      const csrf = getCsrfToken();
      const res = await fetch(`/api/inbox/items/${selected.id}/book-appointment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
        body: JSON.stringify({
          contactId: selected.contactId,
          contactName: selected.contactName,
          companyName: selected.companyName,
          intent: classifyResult?.classification.intent,
        }),
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Failed");
      return body;
    },
    onSuccess: (data: any) => {
      if (data.bookingUrl) {
        // Insert booking link into reply draft
        setReplyDraft((prev) => {
          const link = `\n\nBook a time here: ${data.bookingUrl}`;
          return prev.includes(data.bookingUrl) ? prev : prev + link;
        });
        if (data.hasCalendar) {
          window.open(data.bookingUrl, "_blank");
        }
      }
      toast({ title: data.taskCreated ? "Booking task created" : "Booking link generated", description: data.hasCalendar ? "Calendar link inserted into reply" : "Manual booking task created" });
    },
    onError: (err: any) => {
      toast({ title: "Book Appointment failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSelectItem = useCallback(async (item: InboxItem) => {
    setSelected(item);
    setClassifyResult(null);
    setReplyDraft("");
    setClassifying(true);
    try {
      const res = await apiRequest("POST", `/api/inbox/items/${item.id}/classify`, {
        body: item.body,
        contactId: item.contactId,
        channel: item.channel,
      });
      const result: ClassifyResult = await res.json();
      setClassifyResult(result);
      setReplyDraft(result.suggestedReply);
    } catch (err: any) {
      toast({ title: "Classification failed", description: err.message, variant: "destructive" });
    } finally {
      setClassifying(false);
    }
  }, [toast]);

  const handleInsertUploadInstructions = useCallback(() => {
    const bookingUrl = classifyResult?.bookingUrl || "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr";
    setReplyDraft(prev => (UPLOAD_INSTRUCTIONS + bookingUrl + "\n\n" + prev).trim());
    toast({ title: "Upload instructions inserted" });
  }, [classifyResult, toast]);

  const items = data?.items || [];
  const filtered = items.filter(item =>
    !search ||
    item.contactName.toLowerCase().includes(search.toLowerCase()) ||
    item.companyName.toLowerCase().includes(search.toLowerCase()) ||
    item.body.toLowerCase().includes(search.toLowerCase())
  );

  const intent = classifyResult?.classification.intent;
  const sendBlocked = classifyResult?.sendBlocked;
  const nextAction = classifyResult?.nextAction;
  const showBookAppointment = intent === "meeting_intent" || intent === "call_me" || intent === "interested";

  return (
    <div className="space-y-4" data-testid="page-ai-inbox">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="w-6 h-6 text-blue-500" />
            AI Inbox
            {(data?.total || 0) > 0 && (
              <Badge variant="secondary" className="text-xs">
                {data?.total}
              </Badge>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            Inbound messages with AI intent classification, ownership routing, and draft replies
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {!data?.ghlConfigured && !isLoading && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            GHL not configured — SMS and GHL Chat messages unavailable. Email inbox events shown from audit logs only.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[600px]">
        {/* ── Left: Inbox list ── */}
        <Card className="md:col-span-1 flex flex-col" data-testid="card-inbox-list">
          <CardHeader className="pb-2 pt-4 px-4">
            <Input
              placeholder="Search messages..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-inbox-search"
            />
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="text-center py-10 text-sm text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto mb-2" />
                Failed to load inbox
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground px-4">
                <Inbox className="w-7 h-7 mx-auto mb-2 opacity-30" />
                {search ? "No matching messages" : "No inbound messages yet"}
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map(item => {
                  const ch = CHANNEL_META[item.channel] || CHANNEL_META.email;
                  const im = item.intentLabel ? INTENT_META[item.intentLabel] : null;
                  return (
                    <button
                      key={item.id}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${selected?.id === item.id ? "bg-muted" : ""} ${!item.isRead ? "border-l-2 border-l-blue-500" : ""}`}
                      onClick={() => handleSelectItem(item)}
                      data-testid={`inbox-item-${item.id}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-sm font-medium truncate ${!item.isRead ? "font-semibold" : ""}`}>
                          {item.contactName}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                          {formatTime(item.receivedAt)}
                        </span>
                      </div>
                      {item.companyName && (
                        <p className="text-xs text-muted-foreground truncate mb-0.5">{item.companyName}</p>
                      )}
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5 flex items-center">
                          {ch.icon}{ch.label}
                        </Badge>
                        {im && (
                          <Badge className={`text-[10px] h-4 px-1 ${im.color}`}>
                            {im.emoji} {im.label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{item.body}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right: Detail + actions panel ── */}
        <Card className="md:col-span-2 flex flex-col" data-testid="card-inbox-detail">
          {!selected ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground p-8">
              <div className="text-center">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Select a message</p>
                <p className="text-xs mt-1">AI will classify intent and draft a reply</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Header */}
              <CardHeader className="pb-3 border-b shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 md:hidden"
                    onClick={() => setSelected(null)}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate" data-testid="text-inbox-contact">
                      {selected.contactName}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selected.companyName && (
                        <span className="text-xs text-muted-foreground">{selected.companyName}</span>
                      )}
                      {selected.contactId && (
                        <a
                          href={`/dashboard/contacts/${selected.contactId}`}
                          className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View Contact
                        </a>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs flex items-center gap-1">
                    {CHANNEL_META[selected.channel]?.icon}
                    {CHANNEL_META[selected.channel]?.label}
                  </Badge>
                </div>
              </CardHeader>

              <div className="flex-1 overflow-y-auto">
                {/* Message body */}
                <div className="p-4 border-b">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Message</p>
                  <div className="bg-muted rounded-lg p-3 text-sm whitespace-pre-wrap" data-testid="text-inbox-body">
                    {selected.body}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{formatTime(selected.receivedAt)}</p>
                </div>

                {/* Classification panel */}
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2 mb-3">
                    <Bot className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Analysis</span>
                    {classifying && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                  </div>

                  {classifying ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Classifying intent…
                    </div>
                  ) : classifyResult ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Detected Intent</p>
                          {(() => {
                            const im = INTENT_META[classifyResult.classification.intent] || { label: classifyResult.classification.intent, color: "bg-gray-100 text-gray-700", emoji: "❓" };
                            return (
                              <Badge className={`${im.color} text-xs`} data-testid="badge-intent">
                                {im.emoji} {im.label}
                              </Badge>
                            );
                          })()}
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Confidence</p>
                          <ConfidenceBar confidence={classifyResult.classification.confidence} />
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Reasoning</p>
                        <p className="text-xs text-muted-foreground italic">{classifyResult.classification.reasoning}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Sender Identity</p>
                          <p className="font-medium">{classifyResult.senderIdentity.displayName}</p>
                          <p className="text-muted-foreground text-[10px]">{classifyResult.senderIdentity.from}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Recommended Action</p>
                          <Badge variant="outline" className="text-[10px]">
                            {nextAction?.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </div>

                      {sendBlocked && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {classifyResult.sendBlockReason}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Ownership & routing panel */}
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-purple-500" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ownership & Routing</span>
                  </div>
                  <OwnershipPanel
                    itemId={selected.id}
                    contactId={selected.contactId}
                    intent={intent}
                    classifyResult={classifyResult}
                    onEscalated={() => {
                      setClassifyResult(prev => prev ? {
                        ...prev,
                        nextAction: "escalated_to_scott",
                      } : prev);
                    }}
                  />
                </div>

                {/* Reply draft */}
                <div className="p-4 border-b">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Reply Draft (editable)</p>
                  <Textarea
                    value={replyDraft}
                    onChange={e => setReplyDraft(e.target.value)}
                    rows={6}
                    className="text-sm resize-none"
                    placeholder="AI will generate a draft reply after classification…"
                    data-testid="textarea-reply-draft"
                    disabled={intent === "stop" || intent === "angry"}
                  />
                  {(intent === "stop" || intent === "angry") && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <Ban className="w-3 h-3" />
                      No reply should be sent — contact must be suppressed
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Send Reply */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            disabled={
                              sendBlocked ||
                              !replyDraft.trim() ||
                              intent === "stop" ||
                              intent === "angry" ||
                              actionMutation.isPending
                            }
                            onClick={() => actionMutation.mutate({ action: "send_reply" })}
                            data-testid="button-send-reply"
                          >
                            {actionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Mail className="w-3.5 h-3.5 mr-1" />}
                            Send Reply
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {sendBlocked && (
                        <TooltipContent>
                          <p>{classifyResult?.sendBlockReason || "Outbound paused — review only"}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>

                    {/* Book Appointment — shown prominently when intent warrants it */}
                    {showBookAppointment ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-blue-600 hover:bg-blue-700"
                        onClick={() => bookAppointmentMutation.mutate()}
                        disabled={bookAppointmentMutation.isPending}
                        data-testid="button-book-appointment"
                      >
                        {bookAppointmentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Calendar className="w-3.5 h-3.5 mr-1" />}
                        Book Appointment
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => bookAppointmentMutation.mutate()}
                        disabled={bookAppointmentMutation.isPending}
                        data-testid="button-book-appointment"
                      >
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        Book Appointment
                      </Button>
                    )}

                    {/* Send Upload Instructions */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleInsertUploadInstructions}
                      disabled={actionMutation.isPending}
                      data-testid="button-upload-instructions"
                    >
                      <Upload className="w-3.5 h-3.5 mr-1" />
                      Upload Instructions
                    </Button>

                    {/* Create Task */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMutation.mutate({ action: "create_task" })}
                      disabled={actionMutation.isPending}
                      data-testid="button-create-task"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Create Task
                    </Button>

                    {/* Assign to Sales */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMutation.mutate({ action: "assign_to_sales" })}
                      disabled={actionMutation.isPending}
                      data-testid="button-assign-sales"
                    >
                      <Users className="w-3.5 h-3.5 mr-1" />
                      Assign → Sales
                    </Button>

                    {/* Assign to Support */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMutation.mutate({ action: "assign_to_support" })}
                      disabled={actionMutation.isPending}
                      data-testid="button-assign-support"
                    >
                      <UserCheck className="w-3.5 h-3.5 mr-1" />
                      Assign → Support
                    </Button>

                    {/* Mark Unsubscribed */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                      onClick={() => actionMutation.mutate({ action: "mark_unsubscribed" })}
                      disabled={actionMutation.isPending}
                      data-testid="button-mark-unsubscribed"
                    >
                      <Ban className="w-3.5 h-3.5 mr-1" />
                      Mark Unsubscribed
                    </Button>

                    {/* Escalate to Scott */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400"
                      onClick={() => actionMutation.mutate({ action: "escalate_to_scott" })}
                      disabled={actionMutation.isPending}
                      data-testid="button-escalate-scott"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                      Escalate to Scott
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
