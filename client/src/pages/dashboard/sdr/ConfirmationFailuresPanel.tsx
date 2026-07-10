/**
 * ConfirmationFailuresPanel.tsx
 *
 * Displays unresolved inbound confirmation delivery failures.
 * Sibling to AnomalyAlertsPanel — never mixed into statistical anomaly detection.
 * Polls every 60 seconds (failures change slowly).
 *
 * Deduplication: one card per (contactId, submissionId) pair.
 * A failure resolves automatically on the next poll when it's no longer in the unresolved set.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import type { FailedSubmission } from "@shared/confirmation-status-types";
import { labelForConfirmationStatus } from "@shared/confirmation-status-types";

interface FailuresResponse {
  failures: FailedSubmission[];
  total: number;
}

export function ConfirmationFailuresPanel() {
  const { data, isLoading } = useQuery<FailuresResponse>({
    queryKey: ["/api/operator/confirmation-failures"],
    queryFn: async () => {
      const res = await fetch("/api/operator/confirmation-failures", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch confirmation failures");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8" data-testid="confirmation-failures-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const failures = data?.failures ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4" data-testid="panel-confirmation-failures">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Confirmation Failures</h3>
        </div>
        {total > 0 && (
          <Badge variant="destructive" data-testid="badge-failure-count">
            {total} unresolved
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Polls every 60s · Last 7 days
        </span>
      </div>

      {failures.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-failures">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            No unresolved confirmation failures in the last 7 days.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {failures.map((failure) => (
            <Card
              key={`${failure.contactId}-${failure.submissionId}`}
              className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20"
              data-testid={`failure-card-${failure.contactId}-${failure.submissionId}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        Contact #{failure.contactId}
                      </span>
                      <Badge variant="destructive" className="text-xs" data-testid={`badge-failure-state-${failure.contactId}`}>
                        {labelForConfirmationStatus("failed", null)}
                      </Badge>
                      {failure.formType && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-failure-form-${failure.contactId}`}>
                          {failure.formType}
                        </Badge>
                      )}
                    </div>
                    {failure.safeReason && (
                      <p className="text-xs text-red-700 dark:text-red-400" data-testid={`text-failure-reason-${failure.contactId}`}>
                        {failure.safeReason}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(failure.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {total > failures.length && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Showing {failures.length} of {total} failures
            </p>
          )}
        </div>
      )}
    </div>
  );
}
