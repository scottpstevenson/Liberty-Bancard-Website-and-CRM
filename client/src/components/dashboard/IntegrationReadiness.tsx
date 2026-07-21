import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, SkipForward,
  RefreshCw, ChevronDown, ChevronRight, Mail, Shield, Wifi,
  Database, Server, Key, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type LiveStatus = "pass" | "fail" | "unverified" | "skipped";
type Importance = "required_launch" | "required_feature" | "optional";
type Category = "CORE" | "GHL" | "EMAIL" | "ENRICHMENT" | "ALERTS" | "COVERAGE";

interface CheckResult {
  key: string;
  category: Category;
  label: string;
  present: boolean;
  formatValid: boolean | null;
  liveStatus: LiveStatus;
  identity: string | null;
  diagnosisHint: string | null;
  ownerAction: string | null;
  lastTestedAt: string;
  importance: Importance;
  featureName?: string;
}

interface ValidationReport {
  runAt: string;
  checks: CheckResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    unverified: number;
    skipped: number;
    requiredLaunchFailing: number;
  };
  goNoGo: "GO" | "NO-GO";
}

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status, className }: { status: LiveStatus; className?: string }) {
  const base = cn("h-4 w-4 shrink-0", className);
  if (status === "pass")       return <CheckCircle2 className={cn(base, "text-green-500")} />;
  if (status === "fail")       return <XCircle className={cn(base, "text-red-500")} />;
  if (status === "unverified") return <HelpCircle className={cn(base, "text-yellow-500")} />;
  return <SkipForward className={cn(base, "text-gray-400")} />;
}

function StatusBadge({ status }: { status: LiveStatus }) {
  const map: Record<LiveStatus, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    pass:       { label: "PASS",       variant: "default" },
    fail:       { label: "FAIL",       variant: "destructive" },
    unverified: { label: "UNVERIFIED", variant: "secondary" },
    skipped:    { label: "SKIPPED",    variant: "outline" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant} className="text-[10px] px-1.5 py-0">{label}</Badge>;
}

function ImportanceBadge({ importance }: { importance: Importance }) {
  if (importance === "required_launch") {
    return <Badge variant="destructive" className="text-[9px] px-1 py-0 font-normal">LAUNCH REQ</Badge>;
  }
  if (importance === "required_feature") {
    return <Badge variant="secondary" className="text-[9px] px-1 py-0 font-normal">FEATURE</Badge>;
  }
  return <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">OPTIONAL</Badge>;
}

const CATEGORY_META: Record<Category, { label: string; icon: React.FC<{ className?: string }> }> = {
  CORE:       { label: "Core Runtime",               icon: ({ className }) => <Server className={className} /> },
  GHL:        { label: "GoHighLevel (GHL)",           icon: ({ className }) => <Wifi className={className} /> },
  EMAIL:      { label: "Email & SMTP",               icon: ({ className }) => <Mail className={className} /> },
  ENRICHMENT: { label: "Enrichment & Providers",     icon: ({ className }) => <Database className={className} /> },
  ALERTS:     { label: "Alerts & Backups",           icon: ({ className }) => <AlertTriangle className={className} /> },
  COVERAGE:   { label: "Environment Coverage",       icon: ({ className }) => <Key className={className} /> },
};

const CATEGORY_ORDER: Category[] = ["CORE", "GHL", "EMAIL", "ENRICHMENT", "ALERTS", "COVERAGE"];

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: CheckResult }) {
  const [open, setOpen] = useState(false);
  const hasDiag = !!(check.diagnosisHint || check.ownerAction);

  return (
    <div
      className={cn(
        "border rounded p-2.5 text-sm",
        check.liveStatus === "fail" && check.importance === "required_launch"
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
          : check.liveStatus === "fail"
          ? "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20"
          : check.liveStatus === "pass"
          ? "border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-950/20"
          : "border-gray-200 bg-background"
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIcon status={check.liveStatus} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-xs">{check.label}</span>
            <StatusBadge status={check.liveStatus} />
            <ImportanceBadge importance={check.importance} />
            {check.featureName && (
              <span className="text-[10px] text-muted-foreground">· {check.featureName}</span>
            )}
          </div>
          {check.identity && (
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{check.identity}</p>
          )}
          {hasDiag && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 mt-1 hover:underline" data-testid={`toggle-diag-${check.key}`}>
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {open ? "Hide details" : "Show diagnosis"}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1.5 space-y-1.5">
                  {check.diagnosisHint && (
                    <p className="text-[11px] leading-relaxed text-foreground/80 bg-muted/50 rounded px-2 py-1.5">
                      {check.diagnosisHint}
                    </p>
                  )}
                  {check.ownerAction && (
                    <div className="flex gap-1.5 items-start">
                      <Shield className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
                        <strong>Action:</strong> {check.ownerAction}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
          {new Date(check.lastTestedAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// ── Category group ────────────────────────────────────────────────────────────

function CategoryGroup({ category, checks }: { category: Category; checks: CheckResult[] }) {
  const [open, setOpen] = useState(
    checks.some((c) => c.liveStatus === "fail" || c.liveStatus === "unverified")
  );
  const meta = CATEGORY_META[category];
  const fails = checks.filter((c) => c.liveStatus === "fail").length;
  const passes = checks.filter((c) => c.liveStatus === "pass").length;
  const unverified = checks.filter((c) => c.liveStatus === "unverified").length;

  const Icon = meta.icon;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="w-full flex items-center gap-2 py-2 px-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
          data-testid={`category-toggle-${category}`}
        >
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm flex-1 text-left">{meta.label}</span>
          <div className="flex items-center gap-1.5">
            {fails > 0 && <Badge variant="destructive" className="text-[10px] px-1.5">{fails} fail</Badge>}
            {unverified > 0 && <Badge variant="secondary" className="text-[10px] px-1.5">{unverified} unverified</Badge>}
            {passes > 0 && <Badge className="text-[10px] px-1.5 bg-green-600">{passes} pass</Badge>}
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-1.5 pl-1">
          {checks.map((c) => <CheckRow key={c.key} check={c} />)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Test email dialog ─────────────────────────────────────────────────────────

function TestEmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [to, setTo] = useState("");
  const { toast } = useToast();

  const send = useMutation({
    mutationFn: async () => {
      const csrf = await fetch("/api/csrf-token", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.token || "");
      return apiRequest("POST", "/api/admin/integration-readiness/test-email", { to, channel: "smtp" });
    },
    onSuccess: (res: any) => {
      if (res?.success) {
        toast({ title: "Test email sent", description: `Delivered to ${to}` });
        setTo("");
        onClose();
      } else {
        toast({ title: "Send failed", description: res?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: any) => {
      toast({ title: "Send error", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send SMTP Test Email</DialogTitle>
          <DialogDescription>
            Sends a test message via SMTP. Only @libertybancard.com addresses are permitted.
            No prospect or customer data is used. This action is audit-logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium block mb-1">Recipient</label>
            <Input
              type="email"
              placeholder="you@libertybancard.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-test-email-to"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Must be a @libertybancard.com address
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!to.endsWith("@libertybancard.com") || send.isPending}
            onClick={() => send.mutate()}
            data-testid="button-send-test-email"
          >
            {send.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Send Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IntegrationReadiness() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<ValidationReport>({
    queryKey: ["/api/admin/integration-readiness"],
    refetchInterval: 3 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const retest = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/integration-readiness/retest", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integration-readiness"] });
      toast({ title: "Retest complete", description: "All integration probes refreshed" });
    },
    onError: (e: any) => {
      toast({ title: "Retest failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Running integration probes…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-red-500">Failed to load integration readiness data.</p>
        </CardContent>
      </Card>
    );
  }

  const { summary, goNoGo, runAt, checks } = data;
  const byCategory = CATEGORY_ORDER.reduce<Record<Category, CheckResult[]>>(
    (acc, cat) => {
      acc[cat] = checks.filter((c) => c.category === cat);
      return acc;
    },
    {} as Record<Category, CheckResult[]>
  );

  const hasSmtp = checks.find((c) => c.key === "SMTP" && c.liveStatus === "pass");

  return (
    <div className="space-y-4">
      {/* Header / verdict */}
      <Card className={cn(
        "border-2",
        goNoGo === "GO" ? "border-green-400 bg-green-50/30 dark:bg-green-950/20" : "border-red-400 bg-red-50/30 dark:bg-red-950/20"
      )}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {goNoGo === "GO"
                ? <CheckCircle2 className="h-8 w-8 text-green-500" />
                : <XCircle className="h-8 w-8 text-red-500" />
              }
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{goNoGo}</span>
                  <span className="text-sm text-muted-foreground">— Secrets &amp; Integration Readiness</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary.requiredLaunchFailing > 0
                    ? `${summary.requiredLaunchFailing} required-for-launch secret(s) failing`
                    : "All required-for-launch secrets verified"}
                  {" · "}Last run: {new Date(runAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-2 text-xs">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />{summary.pass} pass</span>
                <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-500" />{summary.fail} fail</span>
                <span className="flex items-center gap-1"><HelpCircle className="h-3.5 w-3.5 text-yellow-500" />{summary.unverified} unverified</span>
                <span className="flex items-center gap-1"><SkipForward className="h-3.5 w-3.5 text-gray-400" />{summary.skipped} skipped</span>
              </div>
              {hasSmtp && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setEmailDialogOpen(true)}
                  data-testid="button-open-test-email"
                >
                  <Mail className="h-3 w-3 mr-1" />
                  Test Email
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => retest.mutate()}
                disabled={retest.isPending}
                data-testid="button-integration-retest"
              >
                <RefreshCw className={cn("h-3 w-3 mr-1", retest.isPending && "animate-spin")} />
                {retest.isPending ? "Retesting…" : "Retest All"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* P0 failures callout */}
      {summary.requiredLaunchFailing > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {summary.requiredLaunchFailing} Required-for-Launch Failure{summary.requiredLaunchFailing > 1 ? "s" : ""} — NO-GO
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-1.5">
              {checks
                .filter((c) => c.importance === "required_launch" && c.liveStatus === "fail")
                .map((c) => (
                  <div key={c.key} className="text-xs flex items-start gap-2">
                    <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">{c.label}</span>
                      {c.diagnosisHint && <span className="text-muted-foreground"> — {c.diagnosisHint.slice(0, 120)}</span>}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category groups */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            Configuration Checks ({summary.total} total)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Read-only probes only — no secret values are revealed, logged, or transmitted.
            Results cached 2 minutes; use Retest All to force refresh.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {CATEGORY_ORDER.map((cat) =>
              byCategory[cat]?.length > 0 ? (
                <CategoryGroup key={cat} category={cat} checks={byCategory[cat]} />
              ) : null
            )}
          </div>
        </CardContent>
      </Card>

      {/* Security note */}
      <p className="text-[11px] text-muted-foreground text-center">
        Integration Readiness runs safe read-only probes. No secret values, hashes, or partial values are ever returned.
        Test email restricted to @libertybancard.com addresses. All retests are audit-logged.
      </p>

      <TestEmailDialog open={emailDialogOpen} onClose={() => setEmailDialogOpen(false)} />
    </div>
  );
}
