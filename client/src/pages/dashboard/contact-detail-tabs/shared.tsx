import { File, FileImage, FileText, Activity, Mail, MessageSquare, UserPlus, TrendingUp, ArrowRight, Ticket, Sparkles, AlertTriangle, Zap, PhoneIncoming } from "lucide-react";
import type { Contact, Deal, Ticket as TicketType, Task as TaskType, Note } from "@shared/schema";

export interface ActivityEvent {
  id: string;
  type: string;
  action: string;
  entityType: string;
  entityId: number;
  details: Record<string, any>;
  createdAt: string;
}

export interface ContactDetailData {
  contact: Contact;
  deals: Deal[];
  tickets: TicketType[];
  tasks: TaskType[];
  notes: Note[];
}

export function formatRelativeTime(dateStr: string | Date): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  if (diffWeek < 5) return `${diffWeek} week${diffWeek !== 1 ? "s" : ""} ago`;
  return `${diffMonth} month${diffMonth !== 1 ? "s" : ""} ago`;
}

export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString();
}

const INTENT_DISPLAY: Record<string, string> = {
  booking_intent: "Booking Intent",
  positive_reply: "Positive Reply",
  interested: "Interested",
  meeting_intent: "Meeting Intent",
  unsubscribe: "Unsubscribe",
  stop: "Opt-Out",
  opt_out: "Opt-Out",
  not_interested: "Not Interested",
  angry: "Hostile",
  objection: "Objection",
  question: "Question",
  later: "Not Now",
  unclear: "Unclear",
  support: "Support",
  pricing_question: "Pricing Question",
};

function intentColorClass(intent: string): string {
  const green = ["booking_intent", "positive_reply", "interested", "meeting_intent"];
  const red = ["unsubscribe", "stop", "opt_out", "not_interested", "angry"];
  if (green.includes(intent)) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (red.includes(intent)) return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
}

export function getIntentFromEvent(event: ActivityEvent): string | null {
  if (!event.details) return null;
  if (event.action === "inbound_message_processed") {
    const cls = event.details.classification;
    if (cls && typeof cls === "object" && cls.intent) return cls.intent as string;
    if (typeof cls === "string") return cls;
  }
  if (event.action === "workflow_auto_triggered" && event.details.classification) {
    return event.details.classification as string;
  }
  return null;
}

export function getTriggeredWorkflowName(event: ActivityEvent): string | null {
  if (event.action === "workflow_auto_triggered" && event.details.workflowName) {
    return event.details.workflowName as string;
  }
  return null;
}

export function ClassificationBadge({ intent }: { intent: string }) {
  const label = INTENT_DISPLAY[intent] || intent.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const colorClass = intentColorClass(intent);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
      data-testid={`classification-badge-${intent}`}
    >
      {label}
    </span>
  );
}

export function getActionMeta(event: ActivityEvent): { icon: typeof Activity; label: string } {
  if (event.type === "ghl") {
    if (event.action === "email") {
      const dir = event.details?.direction === "inbound" ? "Received" : "Sent";
      return { icon: Mail, label: `Email ${dir}` };
    }
    if (event.action === "sms") {
      const dir = event.details?.direction === "inbound" ? "Received" : "Sent";
      return { icon: MessageSquare, label: `SMS ${dir}` };
    }
  }
  switch (event.action) {
    case "contact_created": return { icon: UserPlus, label: "Contact Created" };
    case "deal_created": return { icon: TrendingUp, label: "Deal Created" };
    case "deal_updated":
    case "deal_auto_progressed": return { icon: ArrowRight, label: "Deal Updated" };
    case "ticket_created": return { icon: Ticket, label: "Ticket Created" };
    case "ticket_ai_classified": return { icon: Sparkles, label: "AI Classified" };
    case "sla_breach": return { icon: AlertTriangle, label: "SLA Breach" };
    case "workflow_triggered":
    case "workflow_auto_triggered": return { icon: Zap, label: "Workflow Triggered" };
    case "inbound_message_processed": {
      const channel = event.details?.channel;
      if (channel === "sms") return { icon: PhoneIncoming, label: "Inbound SMS Classified" };
      if (channel === "email") return { icon: Mail, label: "Inbound Email Classified" };
      return { icon: PhoneIncoming, label: "Inbound Message Classified" };
    }
    default: return { icon: Activity, label: event.action };
  }
}

export function getDetailText(event: ActivityEvent): string | null {
  if (!event.details) return null;
  if (event.action === "inbound_message_processed") {
    return event.details.messagePreview ? String(event.details.messagePreview) : null;
  }
  if (event.action === "workflow_auto_triggered") {
    return event.details.workflowName ? `Rule: ${event.details.workflowName}` : null;
  }
  if (event.details.subject) return event.details.subject;
  if (event.details.name) return event.details.name;
  if (event.details.stageName) return `Stage: ${event.details.stageName}`;
  if (event.details.category) return event.details.category;
  return null;
}

export function statusColor(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (status?.toLowerCase()) {
    case "new": return "default";
    case "active":
    case "qualified": return "default";
    case "won":
    case "closed": return "default";
    default: return "secondary";
  }
}

export function priorityVariant(priority: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (priority?.toLowerCase()) {
    case "urgent": return "destructive";
    case "high": return "destructive";
    case "normal": return "default";
    case "low": return "secondary";
    default: return "outline";
  }
}

export function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

export function getDocCategoryColor(category: string | null | undefined): string {
  switch (category) {
    case "Application": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "Voided Check": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "Photo ID": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "Bank Statement": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "EIN Letter": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "Signed Proposal": return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200";
    case "Processing Statement": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocFileIcon({ mimeType }: { mimeType: string | null | undefined }) {
  if (!mimeType) return <File className="h-5 w-5 text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}
