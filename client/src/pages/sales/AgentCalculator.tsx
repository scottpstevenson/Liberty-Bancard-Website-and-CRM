import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingUp,
  Award,
  Printer,
  ArrowLeft,
  ChevronRight,
  Star,
  Zap,
} from "lucide-react";

interface CommissionTier {
  label: string;
  minAccounts: number;
  maxAccounts: number | null;
  residualBps: number;
  bonusLabel: string | null;
}

function getTierForAccounts(tiers: CommissionTier[], accounts: number): CommissionTier {
  return (
    tiers.find(
      (t) =>
        accounts >= t.minAccounts &&
        (t.maxAccounts === null || accounts <= t.maxAccounts)
    ) ?? tiers[0]
  );
}

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function AgentCalculator() {
  const [avgVolume, setAvgVolume] = useState(50000);
  const [accounts, setAccounts] = useState(10);

  const { data: tiers, isLoading } = useQuery<CommissionTier[]>({
    queryKey: ["/api/agent-tiers"],
  });

  const activeTiers = tiers ?? [];
  const currentTier = activeTiers.length > 0 ? getTierForAccounts(activeTiers, accounts) : null;
  const bpsRate = currentTier?.residualBps ?? 0;

  const monthlyResidualPerAccount = (avgVolume * bpsRate) / 10000;
  const totalMonthly = monthlyResidualPerAccount * accounts;
  const totalAnnual = totalMonthly * 12;

  const nextTier = activeTiers.find((t) => t.minAccounts > accounts);
  const accountsToNextTier = nextTier ? nextTier.minAccounts - accounts : 0;
  const projectedMonthlyAtNext = nextTier
    ? ((avgVolume * nextTier.residualBps) / 10000) * accounts
    : null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SEO
        title="Agent Earnings Calculator — Liberty Bancard"
        description="Estimate your monthly and annual residual income as a Liberty Bancard agent. View tiered commission rates and project your earnings."
        path="/sales/agent-calculator"
        noindex
      />

      <div className="max-w-4xl mx-auto px-4 py-10 print:py-4">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back-dashboard">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => window.print()}
            data-testid="button-print-summary"
          >
            <Printer className="w-4 h-4" />
            Download / Print Summary
          </Button>
        </div>

        <div className="mb-8 print:mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground" data-testid="text-calculator-heading">
                Agent Earnings Calculator
              </h1>
              <p className="text-sm text-muted-foreground">Liberty Bancard — Residual Income Estimator</p>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-4 mb-8">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          <div className="lg:col-span-3 space-y-6 print:hidden">
            <Card data-testid="card-volume-slider">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Average Merchant Monthly Volume
                </CardTitle>
                <CardDescription>Typical monthly card processing volume per merchant account</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-muted-foreground">$5,000</span>
                  <span className="text-2xl font-bold text-foreground" data-testid="text-avg-volume">
                    {formatCurrency(avgVolume)}
                  </span>
                  <span className="text-sm text-muted-foreground">$500,000</span>
                </div>
                <Slider
                  min={5000}
                  max={500000}
                  step={5000}
                  value={[avgVolume]}
                  onValueChange={([v]) => setAvgVolume(v)}
                  data-testid="slider-avg-volume"
                />
              </CardContent>
            </Card>

            <Card data-testid="card-accounts-slider">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" />
                  Active Merchant Accounts
                </CardTitle>
                <CardDescription>Your current or projected number of active merchant accounts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-muted-foreground">1</span>
                  <div className="text-center">
                    <span className="text-2xl font-bold text-foreground" data-testid="text-account-count">
                      {accounts}
                    </span>
                    <span className="text-sm text-muted-foreground ml-1">accounts</span>
                    <div className="mt-1">
                      <Badge variant="secondary" className="text-xs" data-testid="badge-current-tier">
                        {currentTier?.label ?? "—"} Tier
                      </Badge>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">100</span>
                </div>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[accounts]}
                  onValueChange={([v]) => setAccounts(v)}
                  data-testid="slider-accounts"
                />
              </CardContent>
            </Card>

            {nextTier && (
              <Card className="border-dashed border-primary/40 bg-primary/5" data-testid="card-next-tier-hint">
                <CardContent className="p-4 flex items-center gap-3">
                  <Zap className="w-5 h-5 text-primary shrink-0" />
                  <p className="text-sm text-foreground">
                    Add <span className="font-bold text-primary">{accountsToNextTier} more account{accountsToNextTier !== 1 ? "s" : ""}</span> to reach{" "}
                    <span className="font-semibold">{nextTier.label}</span> tier ({nextTier.residualBps} bps) and earn an estimated{" "}
                    <span className="font-bold text-primary">{projectedMonthlyAtNext ? formatCurrency(projectedMonthlyAtNext) : ""}/mo</span> at your current volume.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="bg-primary text-primary-foreground" data-testid="card-earnings-summary">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-primary-foreground/80">Estimated Residuals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-primary-foreground/70 mb-1">Monthly Income</p>
                  <p className="text-4xl font-bold" data-testid="text-monthly-residual">
                    {formatCurrency(totalMonthly)}
                  </p>
                </div>
                <Separator className="bg-primary-foreground/20" />
                <div>
                  <p className="text-xs text-primary-foreground/70 mb-1">Annual Income</p>
                  <p className="text-2xl font-semibold" data-testid="text-annual-residual">
                    {formatCurrency(totalAnnual)}
                  </p>
                </div>
                <Separator className="bg-primary-foreground/20" />
                <div className="text-xs text-primary-foreground/60 space-y-1">
                  <p>{accounts} accounts × {formatCurrency(avgVolume)}/mo avg × {bpsRate} bps</p>
                  <p>Tier: {currentTier?.label ?? "—"} | Rate: {(bpsRate / 100).toFixed(2)}%</p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-tier-info">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Current Tier</p>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500" />
                  <span className="font-bold text-foreground">{currentTier?.label ?? "—"}</span>
                  <Badge variant="outline" className="text-xs">{bpsRate} bps</Badge>
                </div>
                {currentTier?.bonusLabel && (
                  <p className="text-xs text-muted-foreground">✓ {currentTier.bonusLabel}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-display font-semibold text-foreground mb-4" data-testid="text-tiers-heading">
            Commission Tier Schedule
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm" data-testid="table-commission-tiers">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Tier</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Active Accounts</th>
                  <th className="text-right px-4 py-3 font-semibold text-foreground">Residual Rate</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground hidden sm:table-cell">Includes</th>
                </tr>
              </thead>
              <tbody>
                {activeTiers.map((tier, i) => {
                  const isActive = tier.label === currentTier?.label;
                  return (
                    <tr
                      key={tier.label}
                      className={`border-t border-border transition-colors ${isActive ? "bg-primary/5 font-medium" : i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                      data-testid={`row-tier-${tier.label.toLowerCase()}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isActive && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                          <span className={isActive ? "text-primary" : "text-foreground"}>{tier.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {tier.minAccounts}{tier.maxAccounts ? `–${tier.maxAccounts}` : "+"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant={isActive ? "default" : "secondary"} className="text-xs">
                          {tier.residualBps} bps
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                        {tier.bonusLabel ?? "Standard support"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Residual rates are expressed in basis points (bps). 25 bps = 0.25% of monthly processing volume.
            Actual residuals depend on merchant card mix, processing volume, and applicable interchange and assessment fees.
            This calculator provides an estimate only and is not a guarantee of earnings.
          </p>
        </div>

        <div className="bg-muted/30 rounded-xl p-6 print:border print:border-border" data-testid="card-agreement-summary">
          <h2 className="text-base font-display font-semibold text-foreground mb-3">Agent Agreement Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Residuals paid monthly, net 30 days following close of processing month</span>
              </div>
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Tier is calculated based on total active accounts at time of payout</span>
              </div>
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Residuals are earned for life of merchant relationship</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">No chargebacks, clawbacks, or processing minimums</span>
              </div>
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Agents may refer sub-agents for additional override income</span>
              </div>
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">W-9 required. 1099 issued annually for earnings &gt; $600</span>
              </div>
            </div>
          </div>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            This summary is for reference only. The binding terms of your agent agreement govern all compensation.
            Contact your Liberty Bancard representative to review or sign your agent agreement.
          </p>
        </div>
      </div>
    </div>
  );
}
