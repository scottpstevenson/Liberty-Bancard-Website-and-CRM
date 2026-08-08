import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Zap, ZapOff, Clock, AlertTriangle, CheckCircle2, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AutomationRow {
  id: number;
  key: string;
  title: string | null;
  triggerDescription: string | null;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunRecordsAffected: number | null;
  lastRunErrors: number | null;
  killSwitchEnabled: boolean;
  owner: string | null;
  version: string | null;
  updatedAt: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export default function AutomationRegistry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  if (user?.role !== "admin") {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Shield className="mx-auto h-10 w-10 mb-3 opacity-40" />
          <p>Admin access required.</p>
        </CardContent>
      </Card>
    );
  }

  const { data: automations, isLoading, isError } = useQuery<AutomationRow[]>({
    queryKey: ["/api/admin/automations"],
    queryFn: () => apiRequest("GET", "/api/admin/automations").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, killSwitchEnabled }: { key: string; killSwitchEnabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/automations/${encodeURIComponent(key)}`, {
        killSwitchEnabled,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to update automation");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/automations"] });
      toast({
        title: variables.killSwitchEnabled ? "Automation killed" : "Automation re-enabled",
        description: `${variables.key} kill switch is now ${variables.killSwitchEnabled ? "ON" : "OFF"}.`,
        variant: variables.killSwitchEnabled ? "destructive" : "default",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Automation Registry
          </CardTitle>
          <CardDescription>
            All BullMQ queues and scheduled workers. Use the Kill Switch to immediately stop any automation.
            Changes take effect within 30 seconds (cache TTL).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <div className="p-6 text-center text-destructive flex items-center justify-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>Failed to load automation registry.</span>
            </div>
          )}
          {automations && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Automation</TableHead>
                  <TableHead className="min-w-[240px]">Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-center">Kill Switch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automations.map((row) => (
                  <TableRow key={row.key} className={row.killSwitchEnabled ? "bg-destructive/5" : undefined}>
                    <TableCell>
                      <div className="font-medium flex items-center gap-1.5">
                        {row.killSwitchEnabled ? (
                          <ZapOff className="h-3.5 w-3.5 text-destructive shrink-0" />
                        ) : (
                          <Zap className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        )}
                        {row.title ?? row.key}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{row.key}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {row.triggerDescription ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.killSwitchEnabled
                            ? "destructive"
                            : row.status === "active"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {row.killSwitchEnabled ? "killed" : row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {formatDate(row.lastRunAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.lastRunRecordsAffected != null ? (
                        <span className="flex items-center justify-end gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          {row.lastRunRecordsAffected}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.lastRunErrors != null && row.lastRunErrors > 0 ? (
                        <span className="flex items-center justify-end gap-1 text-destructive font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {row.lastRunErrors}
                        </span>
                      ) : row.lastRunErrors === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={row.killSwitchEnabled}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ key: row.key, killSwitchEnabled: checked })
                        }
                        disabled={toggleMutation.isPending}
                        aria-label={`Kill switch for ${row.title ?? row.key}`}
                        className="data-[state=checked]:bg-destructive"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
