/**
 * SalesIntelPanel — compact two-row strip above the tab section.
 * Shows: vertical badge, lead temperature, preferred channel, last contacted,
 * days since last touch, next follow-up date, engagement score bar, and source batch.
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Flame, Thermometer, Snowflake, Phone, Mail, MessageSquare,
  Calendar, Clock, Zap, Package, TrendingUp,
} from "lucide-react";

interface SalesIntelPanelProps {
  contact: {
    leadScore?: number | null;
    engagementScore?: number | null;
    vertical?: string | null;
    preferredChannel?: string | null;
    lastContactedAt?: string | Date | null;
    importBatchId?: string | null;
    leadSource?: string | null;
    sourceCategory?: string | null;
  };
  nextFollowUp?: string | Date | null; // from first deal
}

function leadTemp(score: number | null | undefined): { label: string; color: string; icon: React.ReactNode } {
  if (score == null) return { label: "Unknown", color: "text-muted-foreground", icon: <Thermometer className="h-3.5 w-3.5" /> };
  if (score >= 80) return { label: "Hot", color: "text-red-600", icon: <Flame className="h-3.5 w-3.5 text-red-500" /> };
  if (score >= 50) return { label: "Warm", color: "text-orange-500", icon: <Thermometer className="h-3.5 w-3.5 text-orange-400" /> };
  return { label: "Cold", color: "text-blue-500", icon: <Snowflake className="h-3.5 w-3.5 text-blue-400" /> };
}

function channelIcon(ch: string | null | undefined) {
  if (!ch) return <Phone className="h-3.5 w-3.5" />;
  const lc = ch.toLowerCase();
  if (lc.includes("email")) return <Mail className="h-3.5 w-3.5" />;
  if (lc.includes("sms") || lc.includes("text")) return <MessageSquare className="h-3.5 w-3.5" />;
  return <Phone className="h-3.5 w-3.5" />;
}

function daysSince(ts: string | Date | null | undefined): number | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function daysSinceColor(days: number): string {
  if (days <= 1) return "text-green-600";
  if (days <= 7) return "text-yellow-600";
  if (days <= 30) return "text-orange-500";
  return "text-red-500";
}

export function SalesIntelPanel({ contact, nextFollowUp }: SalesIntelPanelProps) {
  const temp = leadTemp(contact.leadScore);
  const days = daysSince(contact.lastContactedAt);
  const engagePct = Math.min(100, Math.max(0, contact.engagementScore ?? 0));
  const nextFollowUpStr = nextFollowUp instanceof Date ? nextFollowUp.toISOString() : nextFollowUp;
  const source = contact.importBatchId
    ? `Batch ${contact.importBatchId.slice(0, 8)}`
    : contact.leadSource
    ? contact.leadSource
    : contact.sourceCategory
    ? contact.sourceCategory.replace(/_/g, " ")
    : null;

  const items: { label: string; value: React.ReactNode; icon: React.ReactNode; tooltip?: string }[] = [
    {
      label: "Lead Temp",
      icon: temp.icon,
      value: <span className={`text-xs font-semibold ${temp.color}`}>{temp.label}</span>,
      tooltip: contact.leadScore != null ? `Lead score: ${contact.leadScore}` : "No score yet",
    },
    ...(contact.vertical ? [{
      label: "Vertical",
      icon: <Package className="h-3.5 w-3.5 text-indigo-400" />,
      value: (
        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-medium">
          {contact.vertical}
        </Badge>
      ),
    }] : []),
    {
      label: "Preferred",
      icon: channelIcon(contact.preferredChannel),
      value: (
        <span className="text-xs text-foreground capitalize">
          {contact.preferredChannel || "Unknown"}
        </span>
      ),
    },
    {
      label: "Last Touch",
      icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
      value: days != null ? (
        <span className={`text-xs font-medium ${daysSinceColor(days)}`}>
          {days === 0 ? "Today" : `${days}d ago`}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never</span>
      ),
      tooltip: contact.lastContactedAt
        ? new Date(contact.lastContactedAt).toLocaleString()
        : "No outreach recorded",
    },
    ...(nextFollowUpStr ? [{
      label: "Next Follow-Up",
      icon: <Calendar className="h-3.5 w-3.5 text-green-500" />,
      value: (
        <span className="text-xs text-foreground">
          {new Date(nextFollowUpStr).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      ),
      tooltip: new Date(nextFollowUpStr).toLocaleString(),
    }] : []),
    {
      label: "Engagement",
      icon: <TrendingUp className="h-3.5 w-3.5 text-blue-400" />,
      value: (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${engagePct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{engagePct}</span>
        </div>
      ),
      tooltip: `Engagement score: ${engagePct}/100`,
    },
    ...(source ? [{
      label: "Source",
      icon: <Zap className="h-3.5 w-3.5 text-yellow-400" />,
      value: <span className="text-xs text-foreground truncate max-w-[80px]">{source}</span>,
    }] : []),
  ];

  return (
    <TooltipProvider>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 bg-muted/40 rounded-lg border border-border/50 text-sm"
        data-testid="sales-intel-panel"
      >
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted-foreground shrink-0">{item.icon}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0 hidden sm:block">
              {item.label}:
            </span>
            {item.tooltip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default">{item.value}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">{item.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              item.value
            )}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
