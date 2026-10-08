import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Phone, Mail, FileText, Shield, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { CrmPage, CrmPageHeader } from "@/components/crm/CrmPresentation";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { useOutboundPauseObservation } from "@/hooks/use-outbound-pause-observation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NbaRow {
  id: number;
  contact_id: number;
  action_type: string;
  channel: string | null;
  owner_role: string | null;
  due_at: string | null;
  urgency: string;
  reason_code: string;
  explanation: string | null;
  confidence: number | null;
  opportunity_value_cents: number | null;
  automation_eligible: boolean;
  human_required: boolean;
  status: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  lifecycle_state?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const URGENCY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  normal: "bg-blue-100 text-blue-800 border-blue-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

const ACTION_ICONS: Record<string, typeof Phone> = {
  CALL_PROSPECT: Phone,
  RETENTION_CALL: Phone,
  CONTACT_AT_RISK_MERCHANT: Phone,
  WINBACK_OUTREACH: Phone,
  SEND_EMAIL: Mail,
  REQUEST_STATEMENT: FileText,
  REVIEW_STATEMENT: FileText,
  PREPARE_PROPOSAL: FileText,
  SEND_PROPOSAL: Mail,
  FOLLOW_UP_PROPOSAL: Mail,
  REVIEW_APPROVAL: Shield,
};

function formatValue(cents: number | null): string {
  if (!cents) return "—";
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(dollars);
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return "—";
  const d = new Date(dueAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.round(diffMs / 3600000);
  if (diffH < 0) return `${Math.abs(diffH)}h overdue`;
  if (diffH < 24) return `in ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `in ${diffD}d`;
}

function contactName(row: NbaRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  return name || row.email || `Contact #${row.contact_id}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function NbaPriorityPage() {
  const { toast } = useToast();
  const pause = useOutboundPauseObservation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("none");

  const safeFilter = filter === "none" ? undefined : filter;

  const { data, isLoading, isError, error, refetch } = useCrmQuery<{items:NbaRow[]}>({
    queryKey: ["/api/nba/priority", safeFilter],
    queryFn: async ({signal}) => {
      const data=await (await apiRequest("GET", `/api/nba/priority?limit=100${safeFilter ? `&filter=${safeFilter}` : ""}`,undefined,undefined,signal)).json();
      if(!data || !Array.isArray(data.items) || !data.items.every((row:any)=>Number.isSafeInteger(row.contact_id)))
        throw new Error("Invalid authorized recommendation queue");
      return data;
    },
    refetchInterval: 60_000,
  });

  const executeMutation = useMutation({
    mutationFn: (contactId: number) => {
      if(pause.blocked) throw new Error(pause.reason);
      return apiRequest("POST", `/api/contacts/${contactId}/nba/execute`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/nba/priority"] });
      toast({ title: "Action marked as completed" });
    },
    onError: (err: Error) => toast({ title: "Action was not completed", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: (contactId: number) =>
      apiRequest("POST", `/api/contacts/${contactId}/nba/dismiss`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/nba/priority"] });
      toast({ title: "Recommendation dismissed" });
    },
    onError: (err: Error) => toast({ title: "Recommendation was not dismissed", description: err.message, variant: "destructive" }),
  });

  const items: NbaRow[] = data?.items ?? [];

  // Summarize urgency counts
  const counts = { critical: 0, high: 0, normal: 0, low: 0 };
  for (const row of items) {
    if (row.urgency in counts) counts[row.urgency as keyof typeof counts]++;
  }

  return (
    <CrmPage className="space-y-6">
        <p role="status" data-testid="nba-pause-reason">{pause.reason}</p>
        <CrmPageHeader title="Next best action" description="Priority queue of recommended actions across active contacts."
          primaryAction={<Button variant="outline" onClick={() => void refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>} />

        {/* Urgency summary chips */}
        <div className="flex gap-3 flex-wrap">
          {(["critical", "high", "normal", "low"] as const).map(u => (
            <div key={u} className={`px-3 py-1.5 rounded-full border text-sm font-medium ${URGENCY_COLORS[u]}`}>
              {isLoading ? "Loading" : isError ? "Unavailable" : `${counts[u]} on page`} {u}
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-3 items-center">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All Open</SelectItem>
              <SelectItem value="highest_value">Highest Value</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="human_required">Human Required</SelectItem>
              <SelectItem value="at_risk">At Risk Merchants</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{items.length} actions</span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-full space-y-3" aria-label="Loading recommendations">
              <div className="h-12 animate-pulse rounded-md bg-muted" />
              <div className="h-24 animate-pulse rounded-md bg-muted" />
              <div className="h-24 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        ) : isError ? (
          <Card role="alert"><CardContent className="py-8 text-center">
            <p className="font-medium">Recommendations are unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error)?.message || "The authorized queue did not respond."}</p>
            <Button className="mt-4" variant="outline" onClick={() => void refetch()}>Retry</Button>
          </CardContent></Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No open actions in this view.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((row) => {
              const Icon = ACTION_ICONS[row.action_type] ?? FileText;
              const isOverdue = row.due_at ? new Date(row.due_at) < new Date() : false;

              return (
                <Card key={row.id} className={`border ${isOverdue ? "border-red-200 bg-red-50/30" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className={`mt-0.5 p-2 rounded-lg ${URGENCY_COLORS[row.urgency]}`}>
                        <Icon className="h-4 w-4" />
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/dashboard/contacts/${row.contact_id}`}>
                            <span className="font-semibold hover:underline cursor-pointer">
                              {contactName(row)}
                            </span>
                          </Link>
                          <Badge variant="outline" className={URGENCY_COLORS[row.urgency]}>
                            {row.urgency}
                          </Badge>
                          {row.human_required && (
                            <Badge variant="outline" className="text-orange-700 border-orange-300">
                              Human required
                            </Badge>
                          )}
                          {isOverdue && (
                            <Badge variant="outline" className="text-red-700 border-red-300">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Overdue
                            </Badge>
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                          <span className="font-medium text-foreground">
                            {row.action_type.replace(/_/g, " ")}
                          </span>
                          {row.channel && <span>via {row.channel}</span>}
                          <span>Due {formatDueAt(row.due_at)}</span>
                          {row.opportunity_value_cents && (
                            <span className="text-emerald-700 font-medium">
                              {formatValue(row.opportunity_value_cents)}/mo
                            </span>
                          )}
                          {row.lifecycle_state && (
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {row.lifecycle_state.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>

                        {row.explanation && (
                          <p className="mt-1.5 text-sm text-muted-foreground italic">
                            {row.explanation}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => executeMutation.mutate(row.contact_id)}
                          disabled={pause.blocked || executeMutation.isPending}
                        >
                          Done
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => dismissMutation.mutate(row.contact_id)}
                          disabled={dismissMutation.isPending}
                          className="text-muted-foreground"
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </CrmPage>
  );
}
