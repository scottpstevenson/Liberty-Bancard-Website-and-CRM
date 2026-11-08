import { Link } from "wouter";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Globe, Loader2 } from "lucide-react";

interface Summary {
  asOf: string;
  windowDays: number;
  timezone: string;
  received: number | null;
  needsReview: number | null;
  statementAttention: number | null;
  tasksDueToday: number | null;
  tasksOverdue: number | null;
  excluded: { nonProduction: number | null; archived: number | null };
}

const KEY = ["/api/lead-ops/inbound-requests/summary"];

/**
 * Website request populations for admins and managers. Each tile answers one question with its own window; a tile whose
 * source failed says "Unavailable" instead of 0, so a partial read can never look like an all-clear.
 */
export function WebsiteRequestsSummary() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Summary>({ queryKey: KEY, refetchInterval: 60_000 });

  const tiles: Array<{ id: string; label: string; hint: string; value: number | null | undefined; href: string; tone?: "alert" }> = data ? [
    { id: "received", label: "Website submissions received", hint: `Last ${data.windowDays} days`, value: data.received, href: "/dashboard/lead-ops?tab=pipeline" },
    { id: "needs-review", label: "Needs assignment or review", hint: "Open now, any age", value: data.needsReview, href: "/dashboard/lead-ops?tab=pipeline", tone: "alert" },
    { id: "statement-attention", label: "Statement processing needs attention", hint: "File saved, not processed", value: data.statementAttention, href: "/dashboard/lead-ops?tab=pipeline", tone: "alert" },
    { id: "due-today", label: "Request tasks due today", hint: "Eastern time", value: data.tasksDueToday, href: "/dashboard/tasks-appointments?tab=tasks" },
    { id: "overdue", label: "Request tasks overdue", hint: "Due before today", value: data.tasksOverdue, href: "/dashboard/tasks-appointments?tab=tasks", tone: "alert" },
  ] : [];

  return (
    <Card data-testid="card-website-requests">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Website requests</CardTitle>
          </div>
          {data && <span className="text-xs text-muted-foreground" data-testid="text-website-requests-asof">Updated {new Date(data.asOf).toLocaleTimeString()}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : isError || !data ? (
          <div className="flex items-center gap-3 flex-wrap" role="alert" data-testid="text-website-requests-error">
            <p className="text-sm text-destructive">Website request counts are unavailable. This is not an all-clear.</p>
            <Button variant="outline" className="min-h-11" onClick={() => refetch()} disabled={isFetching} data-testid="button-website-requests-retry">Retry</Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {tiles.map((tile) => (
                <Link
                  key={tile.id}
                  href={tile.href}
                  className="rounded-lg border p-3 min-h-11 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  data-testid={`tile-website-${tile.id}`}
                >
                  <p className="text-xs text-muted-foreground">{tile.label}</p>
                  <p className={`text-2xl font-semibold tabular-nums ${tile.tone === "alert" && (tile.value ?? 0) > 0 ? "text-destructive" : ""}`} data-testid={`text-website-${tile.id}`}>
                    {tile.value == null ? <span className="text-base text-muted-foreground">Unavailable</span> : tile.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{tile.hint}</p>
                </Link>
              ))}
            </div>
            <details className="text-xs text-muted-foreground" data-testid="details-website-requests-scope">
              <summary className="cursor-pointer min-h-11 flex items-center">What these counts include</summary>
              <p className="pb-2">
                Each number is a separate group and they are not added together. Test, demo and archived records are left out
                {data.excluded.nonProduction != null || data.excluded.archived != null
                  ? ` (${data.excluded.nonProduction ?? "?"} test or demo and ${data.excluded.archived ?? "?"} archived submissions in the last ${data.windowDays} days)`
                  : ""}.
                Records not yet classified are counted. Zero due today does not mean no work exists: check Overdue and the unassigned review count.
              </p>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
