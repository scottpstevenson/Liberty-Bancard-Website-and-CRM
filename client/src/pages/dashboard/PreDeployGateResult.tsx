import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface SuiteResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  durationMs: number;
}

interface GateResult {
  ranAt: string;
  passed: boolean;
  passedCount: number;
  totalCount: number;
  skippedCount: number;
  suites: SuiteResult[];
}

export default function PreDeployGateResult() {
  const { data, isLoading, error } = useQuery<GateResult>({
    queryKey: ["/api/admin/pre-deploy-result"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          No gate result recorded yet. Run{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            GHL_TEST_MODE=true npx tsx scripts/pre-deploy.ts
          </code>{" "}
          while the dev server is live.
        </CardContent>
      </Card>
    );
  }

  const { ranAt, passed, passedCount, totalCount, skippedCount, suites } = data;
  const failedSuites = suites.filter((s) => !s.passed && !s.skipped);

  return (
    <div className="space-y-5">
      {/* Summary banner */}
      <Card className={passed ? "border-green-500/40 bg-green-50/30 dark:bg-green-950/20" : "border-red-500/40 bg-red-50/30 dark:bg-red-950/20"}>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3">
            {passed
              ? <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400 shrink-0" />
              : <XCircle className="w-8 h-8 text-red-600 dark:text-red-400 shrink-0" />}
            <div>
              <p className="text-lg font-semibold leading-tight">
                {passed ? "Pre-Deploy Gate Passed" : "Pre-Deploy Gate Failed"}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {passedCount}/{totalCount} suites passed
                {skippedCount > 0 && ` · ${skippedCount} skipped`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="w-3.5 h-3.5" />
            {format(new Date(ranAt), "MMM d, yyyy 'at' HH:mm 'UTC'")}
          </div>
        </CardContent>
      </Card>

      {/* Failed suites callout */}
      {failedSuites.length > 0 && (
        <Card className="border-red-300 dark:border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 dark:text-red-400">
              {failedSuites.length} suite{failedSuites.length > 1 ? "s" : ""} failing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {failedSuites.map((s) => (
                <li key={s.name} className="flex items-center gap-2 text-sm">
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  {s.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Full suite list */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">All Suites</CardTitle>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> auto-refreshes every 60 s
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 px-4 font-medium">Suite</th>
                <th className="text-center py-2 px-2 font-medium">Status</th>
                <th className="text-right py-2 px-4 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {suites.map((s) => (
                <tr key={s.name} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2.5 px-4 font-medium">{s.name}</td>
                  <td className="py-2.5 px-2 text-center">
                    {s.skipped ? (
                      <Badge variant="secondary" className="text-xs">Skipped</Badge>
                    ) : s.passed ? (
                      <Badge className="text-xs bg-green-600 hover:bg-green-600">Pass</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">Fail</Badge>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                    {(s.durationMs / 1000).toFixed(1)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
