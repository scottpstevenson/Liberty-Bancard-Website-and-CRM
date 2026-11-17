import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import {
  PartnerFaqList,
  PartnerPathCards,
  PartnerReviewDisclosure,
  selectedPartnerFaqs,
} from "@/components/public/PartnerPageSections";
import { usePartnerReferralPolicy } from "@/hooks/use-partner-policy";
import { useToast } from "@/hooks/use-toast";
import { AFFILIATE_PAGE } from "@shared/public-affiliate";
import { PARTNER_ROUTES } from "@shared/partner-public-content";
import { partnerLink, pickPartnerAttribution } from "@shared/partner-application";
import { trackPartnerEvent } from "@/lib/tracking";
import { partnerRouteWithAttribution } from "@/lib/partner-application-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  DollarSign,
  Link2,
  CheckCircle,
  ArrowRight,
  Copy,
  ExternalLink,
  Eye,
  Handshake,
  Share,
  Trophy,
  Medal,
  FileText,
  Mail,
  MessageSquare,
  Lock,
  LogIn,
} from "lucide-react";

/**
 * /affiliate: the entry for people who already have an affiliate account (sign in, link, dashboard). New applicants are
 * sent to the referral-partner application; this page no longer creates accounts, sets a password or states a rate.
 */
type ViewMode = "info" | "login" | "dashboard";

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

function useReferralAttribution() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setCookie("lb_ref", ref, 30);
      localStorage.setItem("lb_ref_code", ref);
      fetch("/api/affiliate/track-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ref }),
      }).catch(() => {});
    }
  }, []);
}

const AFFILIATE_FAQ_IDS = ["difference", "referral-compensation", "permission", "timing", "account", "existing"] as const;

const AFFILIATE_ACCOUNT_POINTS = [
  { icon: Link2, title: "Your link keeps working", body: "Existing affiliate links, codes and history are unchanged." },
  { icon: Handshake, title: "You introduce, Liberty sells", body: "Our team handles the statement review, the sales conversation and onboarding." },
  { icon: FileText, title: "Terms in writing", body: "Compensation is set in your written agreement, not on this page." },
] as const;

export default function AffiliateProgram() {
  const { toast } = useToast();
  const { policy } = usePartnerReferralPolicy();
  const [view, setView] = useState<ViewMode>("info");
  const [submitting, setSubmitting] = useState(false);
  const [affiliateCode, setAffiliateCode] = useState<string | null>(null);
  const [dashboardCode, setDashboardCode] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [commissionReport, setCommissionReport] = useState<any>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  useReferralAttribution();

  useEffect(() => {
    fetch("/api/affiliate/session", { credentials: "include" })
      .then(res => { if (res.ok) return res.json(); throw new Error("no session"); })
      .then(data => {
        setAffiliateCode(data.affiliateCode);
        setDashboardCode(data.affiliateCode);
        loadDashboard(data.affiliateCode);
      })
      .catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!loginForm.email || !loginForm.password) {
      toast({ title: "Please enter email and password", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/affiliate/login", {
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
      setAffiliateCode(data.affiliateCode);
      setDashboardCode(data.affiliateCode);
      toast({ title: `Welcome back, ${data.name}!` });
      loadDashboard(data.affiliateCode);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/affiliate/logout", { method: "POST", credentials: "include" });
    } catch {}
    setAffiliateCode(null);
    setStats(null);
    setCommissionReport(null);
    setLeaderboard([]);
    setView("info");
  };

  const loadDashboard = async (code?: string) => {
    const c = code || dashboardCode;
    if (!c) {
      toast({ title: "Please log in to access your dashboard", variant: "destructive" });
      return;
    }
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/affiliate/stats/${c}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
          toast({ title: "Please log in to access your dashboard", variant: "destructive" });
          setView("login");
        } else {
          toast({ title: data.message || "Error loading dashboard", variant: "destructive" });
        }
        setLoadingStats(false);
        return;
      }
      setStats(data);
      setAffiliateCode(c);
      setView("dashboard");
      fetchLeaderboard();
      fetchCommissionReport(c);
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch("/api/affiliate/leaderboard", { credentials: "include" });
      if (res.ok) setLeaderboard(await res.json());
    } catch {}
  };

  const fetchCommissionReport = async (code: string) => {
    try {
      const res = await fetch(`/api/affiliate/commission-report/${code}`, { credentials: "include" });
      if (res.ok) setCommissionReport(await res.json());
    } catch {}
  };

  const copyLink = () => {
    const link = `${window.location.origin}?ref=${affiliateCode}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Referral link copied!" });
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://libertybancard.com";
  const applyHref = partnerLink(PARTNER_ROUTES.referral, {
    attribution: pickPartnerAttribution(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)),
    hash: "apply",
  });
  const faqs = selectedPartnerFaqs(policy, AFFILIATE_FAQ_IDS);
  const onApply = () => trackPartnerEvent("partner_path_selected", { path: "referral", source_page: AFFILIATE_PAGE.path });
  // The login form mounts after the click, so scroll to it and move focus to its first field once it exists.
  const openLogin = () => {
    setView("login");
    window.setTimeout(() => {
      document.getElementById("affiliate-login")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("affiliate-login-email")?.focus({ preventScroll: true });
    }, 50);
  };

  // Shared-link copy: states what the free statement review is and nothing about savings, rates or earnings.
  const marketingMaterials = [
    {
      category: "Email Templates",
      icon: Mail,
      items: [
        {
          title: "Introduction Email",
          content: `Subject: A free look at your card-processing statement\n\nHi [Name],\n\nYou mentioned your card-processing costs. Liberty Bancard offers a free, no-obligation statement review that shows what a business is paying and why.\n\nIf you would like to take a look, here is the link:\n${baseUrl}/free-analysis?ref=${affiliateCode}\n\nBest regards`,
        },
        {
          title: "Follow-Up Email",
          content: `Subject: Following up on the statement review\n\nHi [Name],\n\nJust checking in. I shared a link for a free card-processing statement review from Liberty Bancard.\n\nIt is optional and there is no commitment. Here is the link again: ${baseUrl}/free-analysis?ref=${affiliateCode}\n\nLet me know if you have any questions.`,
        },
        {
          title: "Referral Ask Email",
          content: `Subject: Know a business owner who might want a statement review?\n\nHi [Name],\n\nIf you know a business owner who accepts credit cards and would be open to hearing from Liberty Bancard, they can request a free statement review here: ${baseUrl}/free-analysis?ref=${affiliateCode}\n\nPlease only pass this along to people who would welcome it.\n\nThanks`,
        },
      ],
    },
    {
      category: "Social Media Posts",
      icon: MessageSquare,
      items: [
        {
          title: "Facebook/LinkedIn Post",
          content: `Business owners: curious what your card-processing statement really says? Liberty Bancard offers a free, no-obligation statement review.\n\n${baseUrl}/free-analysis?ref=${affiliateCode}`,
        },
        {
          title: "Short Post",
          content: `Free, no-obligation review of your card-processing statement from Liberty Bancard: ${baseUrl}/free-analysis?ref=${affiliateCode}`,
        },
      ],
    },
    {
      category: "Text Messages",
      icon: MessageSquare,
      items: [
        {
          title: "Personal Recommendation",
          content: `Hi [Name], you mentioned your processing fees. Liberty Bancard does a free statement review if you want a second opinion: ${baseUrl}/free-analysis?ref=${affiliateCode}\n\nSend this only to people who have agreed to receive it.`,
        },
      ],
    },
    {
      category: "Explainer Content",
      icon: FileText,
      items: [
        {
          title: "Elevator Pitch",
          content: `"Do you accept credit cards? Liberty Bancard does a free, no-obligation review of your processing statement so you can see what you are paying. There is no commitment. Want me to send you the link?"`,
        },
        {
          title: "Key Talking Points",
          content: `• Free statement review with no commitment\n• Liberty's team handles the sales conversation and onboarding\n• Any proposal is explained in writing before a business decides\n• Terms depend on the business and its written agreement\n• Share the link only with people who would welcome it`,
        },
      ],
    },
  ];

  if (view === "dashboard" && stats) {
    return (
      <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
        <SEO title="Affiliate Dashboard" description="Track your referrals and earnings" path="/affiliate" noindex={true} />
        <Navbar />
        <main className="flex-grow public-main-offset pb-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground" data-testid="text-affiliate-dashboard-title">
                  Welcome back, {stats.affiliate.name}
                </h1>
                <p className="text-muted-foreground mt-1">Affiliate Code: <span className="font-mono font-semibold text-primary">{stats.affiliate.code}</span></p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={copyLink} className="gap-2" data-testid="button-copy-link">
                  <Copy className="w-4 h-4" /> Copy Referral Link
                </Button>
                <Button variant="outline" size="sm" onClick={handleLogout} data-testid="button-logout">
                  <LogIn className="w-4 h-4 rotate-180" /> Log Out
                </Button>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Link2 className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground mb-1">Your Referral Link</p>
                <p className="font-mono text-sm text-foreground truncate" data-testid="text-referral-link">
                  {baseUrl}?ref={stats.affiliate.code}
                </p>
              </div>
              <Button size="sm" onClick={copyLink} className="gap-1.5 shrink-0">
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card data-testid="stat-clicks">
                <CardContent className="p-4 text-center">
                  <Eye className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.stats.totalClicks}</p>
                  <p className="text-xs text-muted-foreground">Link Clicks</p>
                </CardContent>
              </Card>
              <Card data-testid="stat-referrals">
                <CardContent className="p-4 text-center">
                  <Users className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.stats.totalReferrals}</p>
                  <p className="text-xs text-muted-foreground">Total Referrals</p>
                </CardContent>
              </Card>
              <Card data-testid="stat-converted">
                <CardContent className="p-4 text-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.stats.converted}</p>
                  <p className="text-xs text-muted-foreground">Converted</p>
                </CardContent>
              </Card>
              <Card data-testid="stat-earnings">
                <CardContent className="p-4 text-center">
                  <DollarSign className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">${stats.stats.totalEarnings}</p>
                  <p className="text-xs text-muted-foreground">Total Earnings</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Pending Referrals</p>
                  <p className="text-xl font-bold text-foreground">{stats.stats.pending}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Qualified Leads</p>
                  <p className="text-xl font-bold text-foreground">{stats.stats.qualified}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Pending Earnings</p>
                  <p className="text-xl font-bold text-foreground">${stats.stats.pendingEarnings}</p>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="referrals" className="space-y-4">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="referrals" data-testid="tab-referrals">Referrals</TabsTrigger>
                <TabsTrigger value="commissions" data-testid="tab-commissions">Commissions</TabsTrigger>
                <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
                <TabsTrigger value="materials" data-testid="tab-materials">Marketing</TabsTrigger>
              </TabsList>

              <TabsContent value="referrals">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Referrals</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {stats.recentReferrals.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
                        <p className="text-muted-foreground mb-2">No referrals yet</p>
                        <p className="text-sm text-muted-foreground">Share your referral link to start introducing businesses.</p>
                        <Button size="sm" className="mt-4 gap-2" onClick={copyLink}>
                          <Copy className="w-4 h-4" /> Copy Referral Link
                        </Button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Referral #</th>
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                              <th className="text-right py-2 px-3 text-muted-foreground font-medium">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.recentReferrals.map((r: any, idx: number) => (
                              <tr key={r.id} className="border-b border-border/50">
                                <td className="py-2 px-3 text-foreground">#{idx + 1}</td>
                                <td className="py-2 px-3">
                                  <Badge variant={r.status === "converted" || r.status === "paid" ? "default" : "secondary"} className="text-xs">
                                    {r.status}
                                  </Badge>
                                </td>
                                <td className="py-2 px-3 text-right text-muted-foreground">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="commissions">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <DollarSign className="w-5 h-5" /> Commission Report
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {commissionReport ? (
                      <div className="space-y-6">
                        {commissionReport.tiers && commissionReport.tiers.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Commission Tiers</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {commissionReport.tiers.map((tier: any) => (
                                <div
                                  key={tier.id}
                                  className={`rounded-lg border p-3 text-center ${
                                    commissionReport.currentTierReferrals >= tier.minReferrals &&
                                    (tier.maxReferrals === null || commissionReport.currentTierReferrals <= tier.maxReferrals)
                                      ? "border-primary bg-primary/5"
                                      : ""
                                  }`}
                                  data-testid={`tier-${tier.id}`}
                                >
                                  <p className="text-lg font-bold text-foreground">${tier.commissionAmount}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {tier.label || `${tier.minReferrals}${tier.maxReferrals ? `-${tier.maxReferrals}` : "+"} referrals`}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Monthly Payout Report</h4>
                            <p className="text-sm font-semibold text-foreground">Total: ${commissionReport.totalEarnings}</p>
                          </div>
                          {commissionReport.report.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No commissions yet.</p>
                          ) : (
                            <div className="space-y-4">
                              {commissionReport.report.map((month: any) => (
                                <div key={month.month} className="border rounded-lg p-4" data-testid={`report-month-${month.month}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <h5 className="font-semibold text-foreground">{month.month}</h5>
                                    <span className="text-sm font-bold text-primary">${month.total}</span>
                                  </div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-border">
                                        <th className="text-left py-1.5 text-muted-foreground font-medium">Merchant</th>
                                        <th className="text-left py-1.5 text-muted-foreground font-medium">Date</th>
                                        <th className="text-left py-1.5 text-muted-foreground font-medium">Status</th>
                                        <th className="text-right py-1.5 text-muted-foreground font-medium">Commission</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {month.entries.map((entry: any) => (
                                        <tr key={entry.referralId} className="border-b border-border/50">
                                          <td className="py-1.5 text-foreground">{entry.merchantName}</td>
                                          <td className="py-1.5 text-muted-foreground">{entry.signupDate ? new Date(entry.signupDate).toLocaleDateString() : "—"}</td>
                                          <td className="py-1.5">
                                            <Badge variant={entry.status === "paid" ? "default" : "secondary"} className="text-xs">{entry.status}</Badge>
                                          </td>
                                          <td className="py-1.5 text-right font-medium">${entry.commissionAmount}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Loading commission data...</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="leaderboard">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-amber-500" /> Affiliate Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {leaderboard.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No leaderboard data yet. Be the first to make referrals!</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Rank</th>
                              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Affiliate</th>
                              <th className="text-center py-2 px-3 text-muted-foreground font-medium">Referrals</th>
                              <th className="text-center py-2 px-3 text-muted-foreground font-medium">Conversions</th>
                              <th className="text-right py-2 px-3 text-muted-foreground font-medium">Earnings</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaderboard.map((leader: any) => (
                              <tr
                                key={leader.rank}
                                className={`border-b border-border/50 ${leader.name === stats.affiliate.name ? "bg-primary/5" : ""}`}
                                data-testid={`leaderboard-row-${leader.rank}`}
                              >
                                <td className="py-2.5 px-3">
                                  <div className="flex items-center gap-1.5">
                                    {leader.rank === 1 ? (
                                      <Trophy className="w-4 h-4 text-amber-500" />
                                    ) : leader.rank === 2 ? (
                                      <Medal className="w-4 h-4 text-gray-400" />
                                    ) : leader.rank === 3 ? (
                                      <Medal className="w-4 h-4 text-amber-700" />
                                    ) : (
                                      <span className="text-muted-foreground font-medium">#{leader.rank}</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-medium text-foreground">
                                  {leader.name}
                                  {leader.name === stats.affiliate.name && (
                                    <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center">{leader.referrals}</td>
                                <td className="py-2.5 px-3 text-center">{leader.conversions}</td>
                                <td className="py-2.5 px-3 text-right font-medium">${parseFloat(leader.earnings).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="materials">
                <div className="space-y-6">
                  {marketingMaterials.map((category) => (
                    <Card key={category.category}>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <category.icon className="w-5 h-5 text-primary" /> {category.category}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {category.items.map((item, idx) => (
                          <div key={idx} className="border rounded-lg p-4" data-testid={`material-${category.category.toLowerCase().replace(/\s+/g, "-")}-${idx}`}>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-sm text-foreground">{item.title}</h4>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.content);
                                  toast({ title: `${item.title} copied!` });
                                }}
                                data-testid={`button-copy-material-${idx}`}
                              >
                                <Copy className="w-3 h-3" /> Copy
                              </Button>
                            </div>
                            <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans bg-muted/30 rounded p-3 max-h-40 overflow-y-auto">
                              {item.content}
                            </pre>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-8 bg-primary/5 rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-2">Sharing tips</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Share your link on social media and in local business groups</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Talk to business owners you know who accept credit cards, and ask before you pass on their details</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Share only with business owners who would welcome hearing from Liberty</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Mention the free statement review. It carries no commitment</li>
              </ul>
            </div>

            <Card className="mt-8" data-testid="card-quick-share">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Share className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Quick Share Panel</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Pre-written messages for people who would welcome hearing from Liberty</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Industry-Specific Quiz Links</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Restaurant", value: "restaurant" },
                      { label: "Retail", value: "retail" },
                      { label: "Healthcare", value: "healthcare" },
                      { label: "Automotive", value: "automotive" },
                      { label: "Home Services", value: "home-services" },
                    ].map((ind) => (
                      <Button
                        key={ind.value}
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          const link = `${baseUrl}/free-analysis?ref=${stats.affiliate.code}&industry=${ind.value}`;
                          navigator.clipboard.writeText(link);
                          toast({ title: `${ind.label} quiz link copied` });
                        }}
                        data-testid={`button-share-industry-${ind.value}`}
                      >
                        <Copy className="w-3 h-3" />
                        {ind.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">SMS Message</p>
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-sm text-foreground" data-testid="text-share-sms">
                        Hi! Liberty Bancard offers a free, no-obligation review of your card-processing statement if you would like a second opinion: {baseUrl}/free-analysis?ref={stats.affiliate.code}
                      </p>
                    </CardContent>
                  </Card>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-2"
                    onClick={() => {
                      navigator.clipboard.writeText(`Hi! Liberty Bancard offers a free, no-obligation review of your card-processing statement if you would like a second opinion: ${baseUrl}/free-analysis?ref=${stats.affiliate.code}`);
                      toast({ title: "SMS message copied" });
                    }}
                    data-testid="button-copy-sms"
                  >
                    <Copy className="w-3 h-3" /> Copy SMS
                  </Button>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Email Message</p>
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-sm font-semibold text-foreground mb-1">Subject: A free look at your card-processing statement</p>
                      <p className="text-sm text-foreground" data-testid="text-share-email">
                        Hi there,{"\n\n"}Liberty Bancard offers a free, no-obligation review of your card-processing statement, so you can see what you are paying and why.{"\n\n"}If you would like a second opinion, here is the link: {baseUrl}/free-analysis?ref={stats.affiliate.code}
                      </p>
                    </CardContent>
                  </Card>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-2"
                    onClick={() => {
                      const emailBody = `Hi there,\n\nLiberty Bancard offers a free, no-obligation review of your card-processing statement, so you can see what you are paying and why.\n\nIf you would like a second opinion, here is the link: ${baseUrl}/free-analysis?ref=${stats.affiliate.code}`;
                      navigator.clipboard.writeText(emailBody);
                      toast({ title: "Email message copied" });
                    }}
                    data-testid="button-copy-email"
                  >
                    <Copy className="w-3 h-3" /> Copy Email
                  </Button>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Social Media Post</p>
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-sm text-foreground" data-testid="text-share-social">
                        Business owners: curious what your card-processing statement really says? Liberty Bancard offers a free, no-obligation statement review. {baseUrl}/free-analysis?ref={stats.affiliate.code}
                      </p>
                    </CardContent>
                  </Card>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const text = `Business owners: curious what your card-processing statement really says? Liberty Bancard offers a free, no-obligation statement review. ${baseUrl}/free-analysis?ref=${stats.affiliate.code}`;
                        navigator.clipboard.writeText(text);
                        toast({ title: "Social post copied" });
                      }}
                      data-testid="button-copy-social"
                    >
                      <Copy className="w-3 h-3" /> Copy Post
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const url = encodeURIComponent(`${baseUrl}/free-analysis?ref=${stats.affiliate.code}`);
                        window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank", "width=600,height=400");
                      }}
                      data-testid="button-share-facebook"
                    >
                      <ExternalLink className="w-3 h-3" /> Share on Facebook
                    </Button>
                  </div>
                </div>
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
      <SEO
        title={AFFILIATE_PAGE.title}
        brandSuffix={false}
        description={AFFILIATE_PAGE.description}
        path={AFFILIATE_PAGE.path}
        keywords="affiliate account, referral partner, payment processing referral"
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">Affiliate and referral accounts</span>}
          headline={<>{AFFILIATE_PAGE.headingLead} <span className="text-primary">{AFFILIATE_PAGE.headingAccent}</span></>}
          subheadline={AFFILIATE_PAGE.intro}
          primaryCta={{ label: "Apply as a referral partner", href: applyHref, onClick: onApply }}
          secondaryCta={{ label: "Affiliate login", href: "#affiliate-account", onClick: openLogin }}
          data-testid="section-affiliate-hero"
        />

        <PublicSection id="affiliate-account" labelledBy="affiliate-account-heading" data-testid="section-affiliate-account">
          <PublicSectionHeader id="affiliate-account-heading" title="Already an affiliate? Nothing changes for you." description="Your account, referral link and history stay exactly as they are. Sign in to reach your dashboard." />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="affiliate-account-points">
            {AFFILIATE_ACCOUNT_POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="public-card p-6">
                <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="public-card-title mb-1 text-foreground">{title}</h3>
                <p className="public-small text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </PublicSection>

        {view === "login" && (
          <section id="affiliate-login" className="py-10 bg-muted/20" aria-labelledby="affiliate-login-heading" data-testid="section-affiliate-login">
            <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8">
              <Card>
                <CardHeader className="text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Lock className="w-6 h-6 text-primary" aria-hidden="true" />
                  </div>
                  <CardTitle id="affiliate-login-heading" className="text-xl">Affiliate Login</CardTitle>
                  <p className="text-sm text-muted-foreground">Sign in to access your dashboard</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label htmlFor="affiliate-login-email" className="text-sm font-medium text-foreground mb-1 block">Email</label>
                    <Input
                      id="affiliate-login-email"
                      type="email"
                      autoComplete="email"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                      placeholder="you@example.com"
                      data-testid="input-login-email"
                    />
                  </div>
                  <div>
                    <label htmlFor="affiliate-login-password" className="text-sm font-medium text-foreground mb-1 block">Password</label>
                    <Input
                      id="affiliate-login-password"
                      type="password"
                      autoComplete="current-password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      placeholder="Your password"
                      data-testid="input-login-password"
                      onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                    />
                  </div>
                  <Button className="w-full gap-2 min-h-11" size="lg" onClick={handleLogin} disabled={submitting} data-testid="button-submit-login">
                    {submitting ? "Signing in..." : "Sign In"}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  <div className="border-t border-border pt-4 mt-4">
                    <p className="text-sm text-center text-muted-foreground mb-2">New to Liberty Bancard partnerships?</p>
                    <Button variant="outline" className="w-full min-h-11" asChild>
                      <Link href={applyHref} onClick={onApply} data-testid="button-switch-apply">Apply as a referral partner</Link>
                    </Button>
                    <p className="mt-3 text-center text-sm text-muted-foreground">
                      Partner portal user? <Link href={PARTNER_ROUTES.login} className="underline" data-testid="link-affiliate-partner-login">Sign in to the partner portal</Link>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        <PublicSection tone="warm" labelledBy="affiliate-paths-heading" data-testid="section-affiliate-paths">
          <PublicSectionHeader id="affiliate-paths-heading" title="Two ways to partner with Liberty Bancard." description="Choose the path that matches how you work. Both start with a short application and no password." />
          <PartnerPathCards policy={policy} sourcePage={AFFILIATE_PAGE.path} headingId="affiliate-paths-heading" />
          <div className="mt-6"><PartnerReviewDisclosure /></div>
        </PublicSection>

        <PublicSection labelledBy="affiliate-faq-heading" data-testid="section-affiliate-faq">
          <PublicSectionHeader id="affiliate-faq-heading" title="Common questions." />
          <PartnerFaqList faqs={faqs} testId="affiliate-faq" />
        </PublicSection>

        <PublicSection tone="warm" labelledBy="affiliate-cta-heading" data-testid="section-affiliate-cta">
          <PublicSectionHeader id="affiliate-cta-heading" title="Ready to apply?" description="Your application is reviewed by Liberty Bancard. We confirm terms in writing before any work begins." />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="min-h-11">
              <Link href={applyHref} onClick={onApply} data-testid="button-cta-apply">Apply as a referral partner</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={partnerRouteWithAttribution(PARTNER_ROUTES.hub)} data-testid="link-cta-compare-paths">Compare partnership paths</Link>
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={openLogin} data-testid="button-cta-login">
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" /> Affiliate login
            </Button>
          </div>
        </PublicSection>
      </main>

      <Footer />
    </div>
  );
}
