import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Rocket, ShieldCheck, Pause, Play,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PreflightCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "blocked";
  detail: string;
}

interface PreflightReport {
  verdict: "GO" | "NO-GO" | "BLOCKED";
  timestamp: string;
  checks: PreflightCheck[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    blocked: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: PreflightCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  if (status === "blocked") return <Pause className="h-5 w-5 text-blue-500 shrink-0" />;
  return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
}

function StatusBadge({ status }: { status: PreflightCheck["status"] }) {
  const styles: Record<PreflightCheck["status"], string> = {
    pass: "bg-green-50 text-green-700 border-green-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    fail: "bg-red-50 text-red-700 border-red-200",
    blocked: "bg-blue-50 text-blue-700 border-blue-200",
  };
  const labels: Record<PreflightCheck["status"], string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
    blocked: "BLOCKED",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ── Links from check ID to the relevant settings page ─────────────────────────

const CHECK_LINKS: Record<string, { label: string; href: string }> = {
  ghl_token: { label: "GHL Settings", href: "/dashboard/settings" },
  active_sequences: { label: "Sequences", href: "/dashboard/outbound-center?tab=sequences" },
  global_pause: { label: "Outbound Readiness", href: "/dashboard/outbound-readiness" },
  sending_identity: { label: "Outbound Readiness", href: "/dashboard/outbound-readiness" },
  daily_cap: { label: "Outbound Settings", href: "/dashboard/outbound-readiness" },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function OutboundPreflight() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<PreflightReport>({
    queryKey: ["/api/admin/outbound-preflight"],
    refetchInterval: 60_000,
  });

  const verdict = data?.verdict ?? null;
  const verdictStyle = verdict === "GO"
    ? { bg: "bg-green-50 border-green-200", text: "text-green-700", icon: <Rocket className="h-6 w-6 text-green-600" /> }
    : verdict === "BLOCKED"
      ? { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", icon: <Pause className="h-6 w-6 text-blue-600" /> }
      : { bg: "bg-red-50 border-red-200", text: "text-red-700", icon: <ShieldCheck className="h-6 w-6 text-red-600" /> };

  return (
    <>
      <Helmet>
        <title>Outbound Preflight — Liberty Bancard</title>
      </Helmet>

      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="h-6 w-6 text-primary" />
              Outbound Preflight
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              7-point launch gate. All checks must pass before enabling live outbound sends.
              {data && (
                <span className="ml-2 text-xs">
                  Checked at {new Date(data.timestamp).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {/* Verdict banner */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running preflight checks…
          </div>
        ) : isError ? (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Failed to load preflight report. Check server logs.
          </div>
        ) : verdict && (
          <div className={`flex items-center gap-4 p-5 rounded-lg border ${verdictStyle.bg}`}>
            {verdictStyle.icon}
            <div>
              <p className={`text-xl font-bold ${verdictStyle.text}`}>
                {verdict === "GO" ? "✅ GO — Ready to launch" :
                 verdict === "BLOCKED" ? "⏸ BLOCKED — Outbound paused (safe state)" :
                 "🚫 NO-GO — Issues must be resolved"}
              </p>
              {data?.summary && (
                <p className="text-sm mt-1 text-muted-foreground">
                  {data.summary.pass} pass · {data.summary.warn} warn · {data.summary.fail} fail · {data.summary.blocked} blocked
                </p>
              )}
            </div>
          </div>
        )}

        {/* Check table */}
        {data?.checks && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Launch Gate Checks</CardTitle>
              <CardDescription>
                Each check maps to a platform subsystem. Click the fix link to navigate directly to the relevant settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {data.checks.map((check) => (
                  <div key={check.id} className="flex items-start gap-3 py-3">
                    <CheckIcon status={check.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{check.label}</p>
                        <StatusBadge status={check.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                      {check.status !== "pass" && CHECK_LINKS[check.id] && (
                        <Link
                          href={CHECK_LINKS[check.id].href}
                          className="text-xs text-primary underline mt-1 inline-block"
                        >
                          → Fix: {CHECK_LINKS[check.id].label}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Explainer */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How to use this page</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1.5">
            <p>
              <span className="font-medium text-green-600">PASS</span> — Check is satisfied. No action needed.
            </p>
            <p>
              <span className="font-medium text-amber-600">WARN</span> — Not required to launch, but recommended (e.g. daily cap).
            </p>
            <p>
              <span className="font-medium text-red-600">FAIL</span> — Blocking issue. Outbound sends will not work until resolved.
            </p>
            <p>
              <span className="font-medium text-blue-600">BLOCKED</span> — Global outbound pause is active (normal safe state before launch).
              Toggle it off on the <Link href="/dashboard/outbound-readiness" className="underline text-primary">Outbound Readiness</Link> page when you're ready to go live.
            </p>
            <p className="pt-1">
              This page auto-refreshes every 60 seconds. Run the pre-deploy gate for a full 27-suite compliance check before enabling live traffic.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
