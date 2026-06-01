import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Bot, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { formatRelativeTime } from "./shared";

interface AuditLogEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  actorType: string | null;
  actorId: string | null;
  createdAt: string;
}

interface ChangeHistoryTabProps {
  entityType: string;
  entityId: number;
}

const HIDDEN_FIELDS = new Set([
  "updatedAt", "createdAt", "archivedAt", "scoreBreakdown",
  "dealBlueprint", "savingsProposal", "boardingLog", "linkedinEnrichmentLog",
]);

function formatFieldName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "string" && val === "") return "—";
  if (typeof val === "object") return JSON.stringify(val).slice(0, 120);
  return String(val);
}

function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Array<{ field: string; from: string; to: string }> {
  if (!after) return [];
  const allKeys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after),
  ]);
  const changes: Array<{ field: string; from: string; to: string }> = [];

  for (const key of allKeys) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const oldVal = before?.[key] ?? null;
    const newVal = after[key] ?? null;
    const oldStr = formatValue(oldVal);
    const newStr = formatValue(newVal);
    if (oldStr !== newStr) {
      changes.push({ field: formatFieldName(key), from: oldStr, to: newStr });
    }
  }
  return changes;
}

function actorIcon(actorType: string | null) {
  if (actorType === "ai") return <Bot className="h-3.5 w-3.5" />;
  if (actorType === "system") return <Settings className="h-3.5 w-3.5" />;
  return <User className="h-3.5 w-3.5" />;
}

function actorLabel(entry: AuditLogEntry): string {
  if (entry.actorType === "ai") return entry.actorId ? `AI: ${entry.actorId}` : "AI";
  if (entry.actorType === "system") return "System";
  return entry.userId ? `User ${entry.userId.slice(0, 8)}` : "Unknown";
}

function actionLabel(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}

function actorTypeBadge(actorType: string | null) {
  if (actorType === "ai") return <Badge variant="secondary" className="text-xs gap-1 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"><Bot className="h-3 w-3" />AI</Badge>;
  if (actorType === "system") return <Badge variant="outline" className="text-xs"><Settings className="h-3 w-3 mr-1" />System</Badge>;
  return <Badge variant="outline" className="text-xs"><User className="h-3 w-3 mr-1" />User</Badge>;
}

function ChangeEntry({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const diff = computeDiff(entry.beforeState, entry.afterState);
  const isCreate = entry.action.endsWith("_created") || entry.beforeState === null;

  return (
    <div className="relative flex gap-3 pb-4" data-testid={`history-entry-${entry.id}`}>
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
          {actorIcon(entry.actorType)}
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium" data-testid={`history-action-${entry.id}`}>
            {actionLabel(entry.action)}
          </span>
          {actorTypeBadge(entry.actorType)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span data-testid={`history-actor-${entry.id}`}>{actorLabel(entry)}</span>
          <span>·</span>
          <span data-testid={`history-time-${entry.id}`}>{formatRelativeTime(entry.createdAt)}</span>
        </div>

        {isCreate && entry.afterState && (
          <p className="text-xs text-muted-foreground italic">Record created</p>
        )}

        {!isCreate && diff.length > 0 && (
          <div className="mt-1">
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(!expanded)}
              data-testid={`history-toggle-${entry.id}`}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {diff.length} field{diff.length !== 1 ? "s" : ""} changed
            </button>
            {expanded && (
              <div className="mt-2 space-y-1 rounded-md border p-2 bg-muted/30" data-testid={`history-diff-${entry.id}`}>
                {diff.map((d, i) => (
                  <div key={i} className="text-xs grid grid-cols-[auto_1fr] gap-x-2 items-start">
                    <span className="font-medium text-muted-foreground whitespace-nowrap">{d.field}:</span>
                    <span className="min-w-0">
                      {d.from !== "—" && (
                        <span className="line-through text-red-500 dark:text-red-400 mr-1 break-all">{d.from}</span>
                      )}
                      <span className="text-green-700 dark:text-green-400 break-all">{d.to}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isCreate && diff.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No field changes recorded</p>
        )}
      </div>
    </div>
  );
}

export function ChangeHistoryTab({ entityType, entityId }: ChangeHistoryTabProps) {
  const { data: logs, isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/audit-logs/entity", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs/entity/${entityType}/${entityId}?limit=100`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!entityId,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground" data-testid="history-empty">
          No change history yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6" data-testid="change-history-timeline">
        <div className="relative">
          {logs.map((entry, index) => (
            <div key={entry.id} className={index === logs.length - 1 ? "[&>div>div:first-child>div:last-child]:hidden" : ""}>
              <ChangeEntry entry={entry} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
