import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Users, DollarSign, TrendingUp, Copy, LogIn, LogOut, Link2,
  BarChart3, FileText, Download, ExternalLink, Shield, CheckCircle,
  Clock, ArrowRight, Handshake, CalendarDays, MousePointerClick, Code2,
  TrendingDown, Building2, Loader2,
} from "lucide-react";

type PortalView = "login" | "dashboard" | "forgot" | "reset";

interface PartnerData {
  partner: {
    name: string;
    code: string;
    email: string;
    status: string;
    partnerType: string;
    commissionPercent: number;
    totalPayouts: string | null;
  };
  kpis: {
    totalMerchants: number;
    totalReferrals: number;
    commissionMTD: number;
    totalCommissionLifetime: number;
    nextPaymentDate: string;
    pendingReferrals: number;
    totalClicks: number;
    conversionRate: number;
  };
  tier: { name: string; commissionPercent: number } | null;
  nextTier: { name: string; minReferrals: number; commissionPercent: number } | null;
  merchants: Array<{
    id: number;
    name: string;
    status: string;
    commissionEarned: number;
    monthlyVolume: number | null;
    createdAt: string | null;
  }>;
  referralLink: string;
}

interface QuickStartTabProps {
  partner: { name: string; code: string; status: string };
  kpis: { totalClicks: number; totalReferrals: number; totalMerchants: number };
  referralLink: string;
  copyLink: (link: string) => void;
}

function QuickStartTab({ partner, kpis, referralLink, copyLink }: QuickStartTabProps) {
  const milestones = [
    {
      day: "Day 1",
      title: "Get your referral link live",
      description: "Copy your referral link and share it with at least 3 business owners you know. Add it to your email signature, LinkedIn bio, and any social profiles.",
      done: partner.status === "active",
      action: (
        <Button size="sm" variant="outline" className="gap-1.5 mt-2" onClick={() => copyLink(referralLink)} data-testid="button-qs-copy-link">
          <Copy className="w-3.5 h-3.5" /> Copy Referral Link
        </Button>
      ),
    },
    {
      day: "Day 3",
      title: "Send your first 5 outreach messages",
      description: "Use the templated emails in your Collateral tab to reach out to 5 business owner contacts. Personalize the subject line with their business name.",
      done: kpis.totalClicks > 0,
      action: (
        <a href="/partner-portal#collateral">
          <Button size="sm" variant="outline" className="gap-1.5 mt-2" data-testid="button-qs-collateral">
            <FileText className="w-3.5 h-3.5" /> View Collateral
          </Button>
        </a>
      ),
    },
    {
      day: "Day 7",
      title: "Submit your first referral",
      description: "Send at least one merchant to your pre-tagged application link. The merchant fills out the form — Liberty Bancard does the rest. You earn residual from day one of processing.",
      done: kpis.totalReferrals > 0,
      action: (
        <a href={`/merchant-application?ref=${partner.code}`} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline" className="gap-1.5 mt-2" data-testid="button-qs-application">
            <ArrowRight className="w-3.5 h-3.5" /> Open Application Link
          </Button>
        </a>
      ),
    },
    {
      day: "Day 14",
      title: "First merchant goes live",
      description: "Your referred merchant is approved, boarded, and processing. You start earning residual. Review the Merchants tab and follow up with your next 5 prospects.",
      done: kpis.totalMerchants > 0,
      action: null,
    },
  ];

  const completedCount = milestones.filter(m => m.done).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg">14-Day Activation Playbook</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Follow these 4 steps to earn your first residual check.</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-foreground">{completedCount}/4</p>
              <p className="text-xs text-muted-foreground">milestones complete</p>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2 mt-3">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(completedCount / 4) * 100}%` }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {milestones.map((m, i) => (
            <div key={i} className={`flex gap-4 p-4 rounded-lg border ${m.done ? "bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-800" : "border-border"}`} data-testid={`card-milestone-${i}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.done ? "bg-green-600" : "bg-muted"}`}>
                {m.done ? <CheckCircle className="w-4 h-4 text-white" /> : <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{m.title}</p>
                  <span className="text-xs text-muted-foreground font-mono">{m.day}</span>
                  {m.done && <span className="text-xs text-green-700 dark:text-green-400 font-medium">Done</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{m.description}</p>
                {!m.done && m.action}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Quick Tips for Your First 14 Days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              { icon: <MousePointerClick className="w-4 h-4 text-primary shrink-0" />, tip: "Always use your pre-tagged link so referrals are automatically attributed to your account." },
              { icon: <CalendarDays className="w-4 h-4 text-primary shrink-0" />, tip: "Follow up with referred merchants within 24 hours — your introduction increases approval rates." },
              { icon: <DollarSign className="w-4 h-4 text-primary shrink-0" />, tip: "Merchants processing $20K+/month are your highest-value referrals. Prioritize restaurants, retail, and med-spas." },
              { icon: <Users className="w-4 h-4 text-primary shrink-0" />, tip: "Your commission is recurring — every month your merchant processes, you earn. Refer more to build a passive income stream." },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 p-3 bg-muted/30 rounded-lg border border-border/50">
                {item.icon}
                <p className="text-muted-foreground text-xs leading-relaxed">{item.tip}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border text-center">
            <p className="text-sm text-muted-foreground mb-2">Questions? Your partner rep is here to help.</p>
            <a href="mailto:partners@libertybancard.com">
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-qs-contact-rep">
                <Handshake className="w-3.5 h-3.5" /> Contact Partner Team
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const getCollateral = (refCode: string) => [
  {
    title: "Pre-Tagged Merchant Application",
    description: "Send this direct application link to prospects — your referral code is embedded so you get automatic credit.",
    href: `/merchant-application?ref=${refCode}`,
    type: "Lead Tool",
    highlight: true,
  },
  {
    title: "Pre-Tagged Free Savings Analysis",
    description: "Send prospects here to start the savings quiz — auto-attributed to your account.",
    href: `/free-analysis?ref=${refCode}`,
    type: "Lead Tool",
    highlight: true,
  },
  {
    title: "Why Liberty Bancard — One-Pager",
    description: "A concise overview of our value proposition for sharing with business owners.",
    href: "/why-liberty-bancard",
    type: "One-Pager",
    highlight: false,
  },
  {
    title: "Beat Square & Stripe",
    description: "Side-by-side comparison of interchange-plus vs flat-rate pricing.",
    href: "/beat-square-stripe",
    type: "Comparison",
    highlight: false,
  },
  {
    title: "Liberty Zero™ — 0% Processing Overview",
    description: "Explains the cash discount / dual-pricing program for your clients.",
    href: "/0-percent-processing",
    type: "Program Guide",
    highlight: false,
  },
  {
    title: "Restaurant Processing One-Pager",
    description: "Vertical-specific collateral for restaurant prospects.",
    href: "/sales/restaurant",
    type: "Vertical",
    highlight: false,
  },
  {
    title: "Healthcare Processing One-Pager",
    description: "Vertical-specific collateral for medical and dental prospects.",
    href: "/sales/healthcare",
    type: "Vertical",
    highlight: false,
  },
  {
    title: "Upload a Statement for Review",
    description: "Send your prospect here to upload their statement — triggers a full free analysis.",
    href: "/upload-statement",
    type: "Lead Tool",
    highlight: false,
  },
];

interface EmbedCodeCardProps {
  partnerCode: string;
  referralLink: string;
  copyLink: (text: string) => void;
}

function EmbedCodeCard({ partnerCode, referralLink, copyLink }: EmbedCodeCardProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://libertybancard.com";
  const applicationUrl = `${origin}/merchant-application?ref=${partnerCode}`;
  const embedSnippet = `<!-- Liberty Bancard Partner Widget -->
<a href="${applicationUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1e3a5f;color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Apply for Payment Processing &rarr;
</a>`;

  return (
    <div className="mt-5 p-4 bg-muted/40 rounded-lg border border-border/40" data-testid="card-embed-code">
      <div className="flex items-center gap-2 mb-2">
        <Code2 className="w-4 h-4 text-primary shrink-0" />
        <p className="text-sm font-medium text-foreground">Your Embed Code</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Paste this snippet on your website, blog, or email to add a pre-tagged "Apply" button that automatically tracks referrals to your account.
      </p>
      <pre className="text-xs font-mono bg-background border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-muted-foreground" data-testid="text-embed-snippet">
        {embedSnippet}
      </pre>
      <Button
        size="sm"
        variant="outline"
        onClick={() => copyLink(embedSnippet)}
        className="gap-1.5 mt-3"
        data-testid="button-copy-embed"
      >
        <Copy className="w-3 h-3" /> Copy Embed Code
      </Button>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "converted": case "paid": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "qualified": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "contacted": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "lost": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function formatType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Pipeline tab ─────────────────────────────────────────────────────────────

type PipelineItem = {
  id: number;
  merchantName: string;
  merchantEmail: string | null;
  status: string;
  pipelineStage: "pending" | "contacted" | "boarded" | "earning";
  commissionEarned: number;
  convertedAt: string | null;
  paidAt: string | null;
  createdAt: string | null;
  dealId: number | null;
};

const PIPELINE_STAGES: { key: PipelineItem["pipelineStage"]; label: string; description: string }[] = [
  { key: "pending",   label: "Pending",   description: "Referral submitted — Liberty Bancard is reviewing." },
  { key: "contacted", label: "Contacted", description: "Merchant has been contacted by our team." },
  { key: "boarded",   label: "Boarded",   description: "Merchant is approved and setting up." },
  { key: "earning",   label: "Earning",   description: "Merchant is live — you're earning residuals!" },
];

const STAGE_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  boarded:   "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  earning:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

function PartnerPipelineTab({ partnerCode }: { partnerCode: string }) {
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/partner/pipeline", { credentials: "include" })
      .then(res => { if (!res.ok) throw new Error("Failed to load pipeline"); return res.json(); })
      .then(data => { setPipeline(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [partnerCode]);

  const grouped = PIPELINE_STAGES.map(stage => ({
    ...stage,
    items: pipeline.filter(p => p.pipelineStage === stage.key),
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">{error}</CardContent>
      </Card>
    );
  }

  if (pipeline.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground mb-1">No referrals yet</p>
          <p className="text-sm text-muted-foreground">Start referring merchants and track their progress here — from submission to earning.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="partner-pipeline-tab">
      {/* Stage funnel summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {grouped.map(stage => (
          <Card key={stage.key} data-testid={`pipeline-stage-${stage.key}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{stage.label}</p>
              <p className="text-2xl font-bold">{stage.items.length}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-tight">{stage.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detailed list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Referral Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Merchant</th>
                  <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Stage</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Commission Earned</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Referred</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map(item => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 font-medium text-foreground">{item.merchantName}</td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[item.pipelineStage] || ""}`}>
                        {item.pipelineStage.charAt(0).toUpperCase() + item.pipelineStage.slice(1)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-foreground">
                      {item.commissionEarned > 0 ? `$${item.commissionEarned.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-right text-muted-foreground text-xs">
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Earnings tab ─────────────────────────────────────────────────────────────

type EarningsMonth = {
  month: string;
  merchants: Array<{ name: string; volume: string; commission: string }>;
  totalCommission: number;
};

type EarningsData = {
  months: EarningsMonth[];
  totalLifetime: number;
};

function fmtMoney(value: number | string): string {
  const num = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (isNaN(num)) return "$0.00";
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function PartnerEarningsTab() {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/partner/earnings", { credentials: "include" })
      .then(res => { if (!res.ok) throw new Error("Failed to load earnings"); return res.json(); })
      .then(d => { setData(d); setLoading(false); if (d.months.length > 0) setOpenMonth(d.months[0].month); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.months.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground mb-1">No earnings data yet</p>
          <p className="text-sm text-muted-foreground">Once your referred merchants start processing, monthly residuals will appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="partner-earnings-tab">
      {/* Lifetime summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Lifetime Earnings</p>
            <p className="text-2xl font-bold text-primary" data-testid="earnings-lifetime">{fmtMoney(data.totalLifetime)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Months active</p>
            <p className="text-lg font-semibold">{data.months.length}</p>
          </div>
        </CardContent>
      </Card>

      {/* Month-by-month breakdown */}
      {data.months.map(m => (
        <Card key={m.month} data-testid={`earnings-month-${m.month}`}>
          <button
            className="w-full text-left"
            onClick={() => setOpenMonth(openMonth === m.month ? null : m.month)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{monthLabel(m.month)}</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-primary">{fmtMoney(m.totalCommission)}</span>
                  <span className="text-xs text-muted-foreground">{m.merchants.length} merchant{m.merchants.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </CardHeader>
          </button>

          {openMonth === m.month && (
            <CardContent className="pt-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-2 text-muted-foreground font-medium">Merchant</th>
                    <th className="text-right pb-2 text-muted-foreground font-medium">Volume</th>
                    <th className="text-right pb-2 text-muted-foreground font-medium">Your Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {m.merchants.map((merchant, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-2 text-foreground">{merchant.name}</td>
                      <td className="py-2 text-right text-muted-foreground">{fmtMoney(merchant.volume)}</td>
                      <td className="py-2 text-right font-medium text-primary">{fmtMoney(merchant.commission)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30">
                    <td colSpan={2} className="py-2 font-semibold text-foreground">Total</td>
                    <td className="py-2 text-right font-bold text-primary">{fmtMoney(m.totalCommission)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function PartnerPortal() {
  const { toast } = useToast();
  const [view, setView] = useState<PortalView>("login");
  const [dashboardData, setDashboardData] = useState<PartnerData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [partnerCode, setPartnerCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetForm, setResetForm] = useState({ password: "", confirmPassword: "" });
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (token) {
      setResetToken(token);
      setView("reset");
      return;
    }
    fetch("/api/partner/session", { credentials: "include" })
      .then(res => { if (res.ok) return res.json(); throw new Error("no session"); })
      .then(data => {
        if (data.affiliateCode) {
          setPartnerCode(data.affiliateCode);
          loadDashboard(data.affiliateCode);
        }
      })
      .catch(() => {});
  }, []);

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      toast({ title: "Please enter your email", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await fetch("/api/partner/reset-password-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotSubmitted(true);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (resetForm.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (resetForm.password !== resetForm.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!resetToken) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: resetForm.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Reset failed", variant: "destructive" });
        return;
      }
      setResetSuccess(true);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const loadDashboard = async (code: string) => {
    try {
      const res = await fetch(`/api/partner/dashboard/${code}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) setView("login");
        return;
      }
      const data = await res.json();
      setDashboardData(data);
      setView("dashboard");
    } catch {
      toast({ title: "Failed to load dashboard", variant: "destructive" });
    }
  };

  const handleLogin = async () => {
    if (!loginForm.email || !loginForm.password) {
      toast({ title: "Please enter email and password", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Login failed", variant: "destructive" });
        return;
      }
      setPartnerCode(data.affiliateCode || "");
      toast({ title: `Welcome back, ${data.name}!` });
      loadDashboard(data.affiliateCode);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try { await fetch("/api/partner/logout", { method: "POST", credentials: "include" }); } catch {}
    setDashboardData(null);
    setPartnerCode("");
    setView("login");
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast({ title: "Link copied!" });
  };

  const referralLink = dashboardData?.referralLink || (partnerCode ? `${window.location.origin}/get-started?ref=${partnerCode}` : "");

  if (view === "dashboard" && dashboardData) {
    const { partner, kpis, merchants } = dashboardData;
    const nextPayment = kpis.nextPaymentDate ? new Date(kpis.nextPaymentDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";

    return (
      <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
        <SEO title="Partner Dashboard | Liberty Bancard" description="Your Liberty Bancard partner dashboard" path="/partner-portal" noindex={true} />
        <Navbar />
        <main className="flex-grow pt-28 pb-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground" data-testid="text-portal-welcome">
                  Welcome back, {partner.name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={partner.status === "active" ? "default" : "secondary"} data-testid="badge-partner-status">
                    {partner.status === "active" ? "Active Partner" : partner.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{formatType(partner.partnerType)}</span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => copyLink(referralLink)} className="gap-2" data-testid="button-copy-referral">
                  <Copy className="w-4 h-4" /> Copy Referral Link
                </Button>
                <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2" data-testid="button-logout">
                  <LogOut className="w-4 h-4" /> Log Out
                </Button>
              </div>
            </div>

            {/* Pending Banner */}
            {partner.status === "pending" && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">Your application is under review. We'll reach out within 1 business day to activate your account and finalize your commission structure.</span>
                </div>
              </div>
            )}

            {/* Referral Link Widget */}
            <div className="bg-muted/30 rounded-xl border border-border/50 p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Link2 className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">Your Referral Link</p>
                <p className="font-mono text-sm text-foreground truncate" data-testid="text-referral-link">{referralLink}</p>
              </div>
              <Button size="sm" onClick={() => copyLink(referralLink)} className="gap-1.5 shrink-0" data-testid="button-copy-link">
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card data-testid="kpi-total-merchants">
                <CardContent className="p-4 text-center">
                  <Users className="w-5 h-5 text-primary mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground" data-testid="text-total-merchants">{kpis.totalMerchants}</p>
                  <p className="text-xs text-muted-foreground">Converted Merchants</p>
                </CardContent>
              </Card>
              <Card data-testid="kpi-pending-referrals">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground" data-testid="text-pending-referrals">{kpis.pendingReferrals}</p>
                  <p className="text-xs text-muted-foreground">In Pipeline</p>
                </CardContent>
              </Card>
              <Card data-testid="kpi-commission-mtd">
                <CardContent className="p-4 text-center">
                  <DollarSign className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground" data-testid="text-commission-mtd">
                    ${kpis.commissionMTD.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">Commission MTD</p>
                </CardContent>
              </Card>
              <Card data-testid="kpi-commission-lifetime">
                <CardContent className="p-4 text-center">
                  <BarChart3 className="w-5 h-5 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground" data-testid="text-commission-lifetime">
                    ${kpis.totalCommissionLifetime.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">Lifetime Earned</p>
                </CardContent>
              </Card>
            </div>

            {/* Clicks + Conversion KPI row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Card data-testid="kpi-total-clicks">
                <CardContent className="p-4 flex items-center gap-4">
                  <MousePointerClick className="w-8 h-8 text-violet-500 shrink-0" />
                  <div>
                    <p className="text-2xl font-bold text-foreground" data-testid="text-total-clicks">{kpis.totalClicks.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Referral Link Clicks</p>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="kpi-click-to-lead">
                <CardContent className="p-4 flex items-center gap-4">
                  <TrendingUp className="w-8 h-8 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-2xl font-bold text-foreground" data-testid="text-click-to-lead">
                      {kpis.totalClicks > 0
                        ? `${((kpis.totalReferrals / kpis.totalClicks) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">Click-to-Lead Rate</p>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="kpi-conversion-rate">
                <CardContent className="p-4 flex items-center gap-4">
                  <BarChart3 className="w-8 h-8 text-teal-500 shrink-0" />
                  <div>
                    <p className="text-2xl font-bold text-foreground" data-testid="text-conversion-rate">
                      {kpis.conversionRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">Lead-to-Close Rate</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tier + Payouts row */}
            {(dashboardData.tier || partner.totalPayouts) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {dashboardData.tier && (
                  <Card data-testid="kpi-commission-tier" className="border-primary/20 bg-primary/5">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Commission Tier</p>
                      <p className="text-lg font-bold text-primary" data-testid="text-tier-name">{dashboardData.tier.name}</p>
                      {dashboardData.nextTier && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Next tier: <span className="text-foreground font-medium">{dashboardData.nextTier.name}</span> at {dashboardData.nextTier.minReferrals} conversions
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                {partner.totalPayouts && (
                  <Card data-testid="kpi-total-payouts">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Lifetime Payouts (estimated)</p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-total-payouts">{partner.totalPayouts}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Next Payment */}
            <Card className="mb-8 border-primary/20 bg-primary/5">
              <CardContent className="p-4 flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Next Estimated Payment Date</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-next-payment">{nextPayment}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xs text-muted-foreground">Your Split</p>
                  <p className="text-sm font-semibold text-primary">{partner.commissionPercent}%</p>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="quickstart" className="space-y-4">
              <TabsList className="flex h-auto flex-wrap gap-1 w-full max-w-2xl">
                <TabsTrigger value="quickstart" data-testid="tab-quickstart">Quick Start</TabsTrigger>
                <TabsTrigger value="pipeline" data-testid="tab-pipeline">My Pipeline</TabsTrigger>
                <TabsTrigger value="earnings" data-testid="tab-earnings">Earnings</TabsTrigger>
                <TabsTrigger value="merchants" data-testid="tab-merchants">Merchants</TabsTrigger>
                <TabsTrigger value="collateral" data-testid="tab-collateral">Collateral</TabsTrigger>
                <TabsTrigger value="account" data-testid="tab-account">Account</TabsTrigger>
              </TabsList>

              <TabsContent value="quickstart">
                <QuickStartTab partner={partner} kpis={kpis} referralLink={referralLink} copyLink={copyLink} />
              </TabsContent>

              <TabsContent value="pipeline">
                <PartnerPipelineTab partnerCode={partner.code} />
              </TabsContent>

              <TabsContent value="earnings">
                <PartnerEarningsTab />
              </TabsContent>

              <TabsContent value="merchants">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Referred Merchants</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {merchants.length === 0 ? (
                      <div className="text-center py-10">
                        <Handshake className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                        <p className="text-muted-foreground mb-2">No referrals yet</p>
                        <p className="text-sm text-muted-foreground mb-4">Share your referral link with business owners to get started.</p>
                        <Button size="sm" className="gap-2" onClick={() => copyLink(referralLink)}>
                          <Copy className="w-4 h-4" /> Copy Referral Link
                        </Button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Merchant / Business</th>
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                              <th className="text-right py-2 px-3 text-muted-foreground font-medium">Commission Earned</th>
                              <th className="text-right py-2 px-3 text-muted-foreground font-medium">Referred</th>
                            </tr>
                          </thead>
                          <tbody>
                            {merchants.map((m) => (
                              <tr key={m.id} className="border-b border-border/50" data-testid={`row-merchant-${m.id}`}>
                                <td className="py-2.5 px-3 font-medium text-foreground">{m.name}</td>
                                <td className="py-2.5 px-3">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor(m.status)}`}>
                                    {m.status}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {m.commissionEarned > 0 ? `$${m.commissionEarned.toFixed(2)}` : "—"}
                                </td>
                                <td className="py-2.5 px-3 text-right text-muted-foreground text-xs">
                                  {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="collateral">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Co-Branded Collateral & Sales Assets</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-5">
                      Share these assets with your business owner contacts. Each opens a detailed page you can screenshot, link, or share directly with a prospect.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {getCollateral(partner.code).map((item) => (
                        <a
                          key={item.href}
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors group ${item.highlight ? "border-primary/40 bg-primary/5 hover:bg-primary/10" : "border-border hover:border-primary/40 hover:bg-primary/5"}`}
                          data-testid={`link-collateral-${item.href.replace(/[?=]/g, "-").replace(/\//g, "-").slice(1)}`}
                        >
                          <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{item.title}</p>
                              <Badge variant={item.highlight ? "default" : "outline"} className="text-xs shrink-0">{item.type}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                        </a>
                      ))}
                    </div>
                    <div className="mt-5 p-4 bg-muted/40 rounded-lg border border-border/40">
                      <p className="text-sm font-medium text-foreground mb-1">Your Pre-Tagged Referral Link</p>
                      <p className="text-xs text-muted-foreground mb-3">Add this to any asset or email you share with prospects — it automatically tracks leads back to you.</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 truncate">{referralLink}</code>
                        <Button size="sm" variant="outline" onClick={() => copyLink(referralLink)} className="gap-1.5 shrink-0" data-testid="button-copy-collateral-link">
                          <Copy className="w-3 h-3" /> Copy
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3" data-testid="collateral-link-stats">
                      <div className="p-3 bg-muted/30 rounded-lg border border-border/40 text-center">
                        <p className="text-lg font-bold text-foreground" data-testid="collateral-text-clicks">{kpis.totalClicks.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Total Link Clicks</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg border border-border/40 text-center">
                        <p className="text-lg font-bold text-foreground" data-testid="collateral-text-ctr">
                          {kpis.totalClicks > 0
                            ? `${((kpis.totalReferrals / kpis.totalClicks) * 100).toFixed(1)}%`
                            : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">Click-to-Lead Rate</p>
                      </div>
                    </div>

                    {/* Embed Code Card */}
                    <EmbedCodeCard partnerCode={partner.code} referralLink={referralLink} copyLink={copyLink} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="account">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Account Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Name</p>
                        <p className="text-sm font-medium text-foreground" data-testid="text-account-name">{partner.name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Email</p>
                        <p className="text-sm font-medium text-foreground" data-testid="text-account-email">{partner.email}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Partner Type</p>
                        <p className="text-sm font-medium text-foreground">{formatType(partner.partnerType)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Account Status</p>
                        <Badge variant={partner.status === "active" ? "default" : "secondary"}>{partner.status}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Revenue Share</p>
                        <p className="text-sm font-medium text-foreground">{partner.commissionPercent}% of net processing revenue</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Referral Code</p>
                        <code className="text-sm font-mono text-primary" data-testid="text-referral-code">{partner.code}</code>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-border">
                      <p className="text-sm text-muted-foreground mb-3">Questions about your commissions or account? Reach out to your partner rep directly.</p>
                      <a href="mailto:partners@libertybancard.com">
                        <Button variant="outline" size="sm" className="gap-2" data-testid="button-contact-rep">
                          Contact Partner Team
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (view === "forgot") {
    return (
      <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
        <SEO title="Forgot Password | Partner Portal" description="Reset your Liberty Bancard partner password" path="/partner-portal" noindex={true} />
        <Navbar />
        <main className="flex-grow pt-28 pb-16">
          <div className="max-w-md mx-auto px-4">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Handshake className="w-7 h-7 text-primary" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-forgot-title">
                Forgot Password
              </h1>
              <p className="text-muted-foreground text-sm">
                Enter the email associated with your partner account and we'll send you a reset link.
              </p>
            </div>
            <Card>
              <CardContent className="p-6 space-y-4">
                {forgotSubmitted ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md" data-testid="text-forgot-success">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span>If an account with that email exists, a reset link has been sent.</span>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => { setView("login"); setForgotSubmitted(false); }} data-testid="button-back-to-login">
                      Back to Sign In
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                      <Input
                        type="email"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        placeholder="your@email.com"
                        onKeyDown={e => e.key === "Enter" && handleForgotPassword()}
                        data-testid="input-forgot-email"
                      />
                    </div>
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleForgotPassword}
                      disabled={submitting}
                      data-testid="button-send-reset-link"
                    >
                      {submitting ? "Sending..." : "Send Reset Link"}
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setView("login")}
                        className="text-sm text-primary hover:underline"
                        data-testid="link-back-to-login"
                      >
                        Back to sign in
                      </button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (view === "reset") {
    return (
      <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
        <SEO title="Reset Password | Partner Portal" description="Set a new password for your Liberty Bancard partner account" path="/partner-portal" noindex={true} />
        <Navbar />
        <main className="flex-grow pt-28 pb-16">
          <div className="max-w-md mx-auto px-4">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-7 h-7 text-primary" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-reset-title">
                Reset Your Password
              </h1>
              <p className="text-muted-foreground text-sm">
                Enter a new password for your partner account.
              </p>
            </div>
            <Card>
              <CardContent className="p-6 space-y-4">
                {resetSuccess ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md" data-testid="text-reset-success">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span>Your password has been reset. You can now sign in.</span>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => {
                        window.history.replaceState({}, "", "/partner-portal");
                        setResetToken(null);
                        setResetSuccess(false);
                        setResetForm({ password: "", confirmPassword: "" });
                        setView("login");
                      }}
                      data-testid="button-go-to-login"
                    >
                      Go to Sign In
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
                      <Input
                        type="password"
                        value={resetForm.password}
                        onChange={e => setResetForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="At least 6 characters"
                        data-testid="input-reset-password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Confirm Password</label>
                      <Input
                        type="password"
                        value={resetForm.confirmPassword}
                        onChange={e => setResetForm(f => ({ ...f, confirmPassword: e.target.value }))}
                        placeholder="Re-enter new password"
                        onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                        data-testid="input-reset-confirm-password"
                      />
                    </div>
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleResetPassword}
                      disabled={submitting}
                      data-testid="button-reset-password"
                    >
                      {submitting ? "Resetting..." : "Reset Password"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Partner Portal Login | Liberty Bancard" description="Log in to your Liberty Bancard partner dashboard" path="/partner-portal" noindex={true} />
      <Navbar />
      <main className="flex-grow pt-28 pb-16">
        <div className="max-w-md mx-auto px-4">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Handshake className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-portal-title">
              Partner Portal
            </h1>
            <p className="text-muted-foreground text-sm">
              Log in to view your referred merchants, commission earnings, and sales collateral.
            </p>
          </div>

          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <Input
                  type="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="your@email.com"
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  data-testid="input-login-email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                <Input
                  type="password"
                  value={loginForm.password}
                  onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  data-testid="input-login-password"
                />
              </div>
              <Button
                className="w-full gap-2"
                size="lg"
                onClick={handleLogin}
                disabled={submitting}
                data-testid="button-login"
              >
                {submitting ? "Logging in..." : "Log In to Partner Portal"}
                {!submitting && <LogIn className="w-4 h-4" />}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setView("forgot"); setForgotSubmitted(false); setForgotEmail(loginForm.email); }}
                  className="text-sm text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </button>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground mt-4">
            Not a partner yet?{" "}
            <Link href="/partners" className="text-primary hover:underline font-medium" data-testid="link-apply-partner">
              Apply to join the program
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
