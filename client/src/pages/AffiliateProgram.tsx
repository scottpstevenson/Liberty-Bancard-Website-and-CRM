import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getStoredUTMParams } from "@/lib/utm";
import { trackAffiliateSignup } from "@/lib/tracking";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  DollarSign,
  Link2,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  Copy,
  ExternalLink,
  BarChart3,
  Clock,
  Shield,
  Zap,
  Gift,
  Star,
  Eye,
  MousePointerClick,
  UserPlus,
  Handshake,
  Share,
} from "lucide-react";

type ViewMode = "info" | "signup" | "dashboard";

export default function AffiliateProgram() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [view, setView] = useState<ViewMode>("info");
  const [submitting, setSubmitting] = useState(false);
  const [affiliateCode, setAffiliateCode] = useState<string | null>(null);
  const [dashboardCode, setDashboardCode] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyName: "",
    website: "",
    howHeard: "",
  });

  useEffect(() => {
    const saved = localStorage.getItem("lb_affiliate_code");
    if (saved) {
      setAffiliateCode(saved);
      setDashboardCode(saved);
    }
  }, []);

  const handleSignup = async () => {
    if (!form.firstName || !form.email || !form.phone) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const utmParams = getStoredUTMParams();
      const res = await fetch("/api/affiliate/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...utmParams }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Signup failed", variant: "destructive" });
        return;
      }
      trackAffiliateSignup();
      setAffiliateCode(data.affiliateCode);
      localStorage.setItem("lb_affiliate_code", data.affiliateCode);
      setDashboardCode(data.affiliateCode);
      toast({ title: "Welcome to the affiliate program!" });
      loadDashboard(data.affiliateCode);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const loadDashboard = async (code?: string) => {
    const c = code || dashboardCode;
    if (!c) {
      toast({ title: "Please enter your affiliate code", variant: "destructive" });
      return;
    }
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/affiliate/stats/${c}`);
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Code not found", variant: "destructive" });
        setLoadingStats(false);
        return;
      }
      setStats(data);
      setAffiliateCode(c);
      localStorage.setItem("lb_affiliate_code", c);
      setView("dashboard");
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoadingStats(false);
    }
  };

  const copyLink = () => {
    const link = `${window.location.origin}?ref=${affiliateCode}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Referral link copied!" });
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://libertybancard.com";

  const benefits = [
    { icon: DollarSign, title: "Generous Commissions", desc: "Earn 10% commission on every merchant you refer who signs up for processing." },
    { icon: Clock, title: "Residual Income", desc: "Earn ongoing monthly residuals for the life of each merchant account you refer." },
    { icon: Link2, title: "Unique Tracking Link", desc: "Get your own branded referral link that tracks every click, signup, and conversion." },
    { icon: BarChart3, title: "Real-Time Dashboard", desc: "Track your referrals, conversions, and earnings in real time from your personal dashboard." },
    { icon: Shield, title: "No Risk, Free to Join", desc: "Zero cost to join. No quotas, no contracts, no hidden fees. Earn at your own pace." },
    { icon: Zap, title: "Fast Payouts", desc: "Commissions are calculated monthly and paid promptly via your preferred method." },
  ];

  const steps = [
    { icon: UserPlus, title: "Sign Up", desc: "Register in 30 seconds. Get your unique affiliate code and referral link instantly." },
    { icon: Link2, title: "Share Your Link", desc: "Share your referral link with business owners who accept credit cards. Social media, email, in person — any way works." },
    { icon: MousePointerClick, title: "Prospects Sign Up", desc: "When someone visits Liberty Bancard through your link and fills out a form, they're tracked to you automatically." },
    { icon: DollarSign, title: "Get Paid", desc: "Earn a commission for every merchant that activates. Plus ongoing residuals every month they process." },
  ];

  if (view === "dashboard" && stats) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO title="Affiliate Dashboard" description="Track your referrals and earnings" path="/affiliate" noindex={true} />
        <Navbar />
        <main className="flex-grow pt-28 pb-16">
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
                <Button variant="outline" size="sm" onClick={() => { setView("info"); setStats(null); }} data-testid="button-back-info">
                  Back to Program Info
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

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Referrals</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.recentReferrals.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground mb-2">No referrals yet</p>
                    <p className="text-sm text-muted-foreground">Share your referral link to start earning commissions.</p>
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

            <div className="mt-8 bg-primary/5 rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-2">Tips to Maximize Earnings</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Share your link on social media and in local business groups</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Talk to business owners you know who accept credit cards</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Focus on restaurants, retail shops, and service businesses — they save the most</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Mention our free statement analysis — it's an easy conversation starter</li>
              </ul>
            </div>

            <Card className="mt-8" data-testid="card-quick-share">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Share className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Quick Share Panel</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Pre-written messages ready to share with your ref link</p>
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
                        Hey! Are you overpaying on credit card processing? Take this free 60-second quiz to see how much you could save: {baseUrl}/free-analysis?ref={stats.affiliate.code}
                      </p>
                    </CardContent>
                  </Card>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-2"
                    onClick={() => {
                      navigator.clipboard.writeText(`Hey! Are you overpaying on credit card processing? Take this free 60-second quiz to see how much you could save: ${baseUrl}/free-analysis?ref=${stats.affiliate.code}`);
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
                      <p className="text-sm font-semibold text-foreground mb-1">Subject: Are you overpaying on credit card processing?</p>
                      <p className="text-sm text-foreground" data-testid="text-share-email">
                        Hi there,{"\n\n"}I wanted to share something that could save your business real money. Liberty Bancard offers a free savings analysis that shows exactly how much you're overpaying on credit card processing.{"\n\n"}It takes 60 seconds — no obligation, and you keep the breakdown even if you don't switch.{"\n\n"}Check it out here: {baseUrl}/free-analysis?ref={stats.affiliate.code}{"\n\n"}Most businesses save 20-40% on processing fees. Worth a look!
                      </p>
                    </CardContent>
                  </Card>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-2"
                    onClick={() => {
                      const emailBody = `Hi there,\n\nI wanted to share something that could save your business real money. Liberty Bancard offers a free savings analysis that shows exactly how much you're overpaying on credit card processing.\n\nIt takes 60 seconds — no obligation, and you keep the breakdown even if you don't switch.\n\nCheck it out here: ${baseUrl}/free-analysis?ref=${stats.affiliate.code}\n\nMost businesses save 20-40% on processing fees. Worth a look!`;
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
                        Business owners: are you overpaying on credit card processing fees? Most are and don't even know it. Take this free 60-second quiz to find out how much you could save. No obligation. {baseUrl}/free-analysis?ref={stats.affiliate.code}
                      </p>
                    </CardContent>
                  </Card>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const text = `Business owners: are you overpaying on credit card processing fees? Most are and don't even know it. Take this free 60-second quiz to find out how much you could save. No obligation. ${baseUrl}/free-analysis?ref=${stats.affiliate.code}`;
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
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Affiliate Program — Earn Commissions Referring Merchants"
        description="Join the Liberty Bancard Affiliate Program. Earn generous commissions and monthly residuals by referring businesses to our payment processing solutions. Free to join, no quotas."
        path="/affiliate"
        keywords="affiliate program, referral program, payment processing affiliate, earn commissions, residual income, merchant referral"
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-16 md:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
              <div>
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/20" data-testid="badge-affiliate">
                  <Gift className="w-3 h-3 mr-1" /> Affiliate Program
                </Badge>
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground mb-4" data-testid="text-affiliate-heading">
                  Earn Money Referring <span className="text-primary">Businesses</span>
                </h1>
                <p className="text-lg text-muted-foreground mb-6">
                  Join our affiliate program and earn commissions every time a business you refer signs up for payment processing. No experience needed — just share your link.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" className="gap-2" onClick={() => setView("signup")} data-testid="button-join-now">
                    <UserPlus className="w-5 h-5" /> Join Free — Start Earning
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2" onClick={() => {
                    if (affiliateCode) { loadDashboard(affiliateCode); } else { setView("signup"); }
                  }} data-testid="button-my-dashboard">
                    <BarChart3 className="w-5 h-5" /> My Dashboard
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: DollarSign, label: "10%", sub: "Commission Rate", color: "text-emerald-500" },
                  { icon: TrendingUp, label: "Residual", sub: "Monthly Income", color: "text-blue-500" },
                  { icon: Users, label: "Free", sub: "To Join", color: "text-purple-500" },
                  { icon: Zap, label: "Instant", sub: "Tracking Link", color: "text-amber-500" },
                ].map((item, i) => (
                  <Card key={i} className="text-center">
                    <CardContent className="p-5">
                      <item.icon className={`w-7 h-7 ${item.color} mx-auto mb-2`} />
                      <p className="text-xl font-bold text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.sub}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {view === "signup" && (
          <section className="py-12 bg-muted/30" id="signup">
            <div className="max-w-xl mx-auto px-4 sm:px-6">
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl font-display" data-testid="text-signup-title">Join the Affiliate Program</CardTitle>
                  <p className="text-muted-foreground mt-1">Takes less than 30 seconds. Start earning today.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {affiliateCode && (
                    <div className="bg-primary/10 rounded-lg p-4 text-center mb-4">
                      <p className="text-sm text-muted-foreground mb-1">Already have a code? Enter it to view your dashboard:</p>
                      <div className="flex gap-2 mt-2">
                        <Input
                          value={dashboardCode}
                          onChange={(e) => setDashboardCode(e.target.value)}
                          placeholder="Your affiliate code"
                          className="text-center font-mono"
                          data-testid="input-dashboard-code"
                        />
                        <Button onClick={() => loadDashboard()} disabled={loadingStats} data-testid="button-load-dashboard">
                          {loadingStats ? "Loading..." : "Go"}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">First Name *</label>
                      <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="John" data-testid="input-first-name" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Last Name</label>
                      <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Smith" data-testid="input-last-name" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Email *</label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" data-testid="input-email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Phone *</label>
                    <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(555) 123-4567" data-testid="input-phone" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Company Name (optional)</label>
                    <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Your company" data-testid="input-company" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Website (optional)</label>
                    <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://yoursite.com" data-testid="input-website" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">How did you hear about us?</label>
                    <Input value={form.howHeard} onChange={(e) => setForm({ ...form, howHeard: e.target.value })} placeholder="Google, friend, social media..." data-testid="input-how-heard" />
                  </div>
                  <Button className="w-full gap-2" size="lg" onClick={handleSignup} disabled={submitting} data-testid="button-submit-signup">
                    {submitting ? "Creating Account..." : "Create Affiliate Account"}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    By signing up you agree to our affiliate terms. No fees, no commitments — cancel anytime.
                  </p>

                  <div className="border-t border-border pt-4 mt-4">
                    <p className="text-sm text-center text-muted-foreground mb-2">Already an affiliate?</p>
                    <div className="flex gap-2">
                      <Input
                        value={dashboardCode}
                        onChange={(e) => setDashboardCode(e.target.value)}
                        placeholder="Enter your affiliate code"
                        className="text-center font-mono"
                        data-testid="input-existing-code"
                      />
                      <Button variant="outline" onClick={() => loadDashboard()} disabled={loadingStats} data-testid="button-existing-dashboard">
                        {loadingStats ? "..." : "View Dashboard"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3" data-testid="text-how-it-works">
                How It Works
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Start earning in 4 simple steps. No sales experience required.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step, i) => (
                <div key={i} className="text-center">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                    <step.icon className="w-6 h-6 text-primary" />
                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3" data-testid="text-why-join">
                Why Join Our Program?
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                We've built one of the most rewarding affiliate programs in payment processing.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {benefits.map((b, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                      <b.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">{b.title}</h3>
                    <p className="text-sm text-muted-foreground">{b.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3">
                Frequently Asked Questions
              </h2>
            </div>
            <div className="space-y-4">
              {[
                { q: "How much can I earn?", a: "You earn 10% commission on each merchant's first-year processing fees, plus ongoing monthly residuals. Top affiliates earn $1,000–$5,000/month." },
                { q: "Is there a cost to join?", a: "No — it's completely free. No signup fee, no monthly fee, no hidden costs." },
                { q: "Do I need sales experience?", a: "Not at all. Just share your link with business owners. Our team handles the sales process, setup, and support." },
                { q: "How do I get paid?", a: "Commissions are calculated monthly and paid via check, ACH, or PayPal. You can set your preferred method in your dashboard." },
                { q: "What types of businesses should I refer?", a: "Any business that accepts credit or debit cards: restaurants, retail shops, salons, auto repair, medical offices, e-commerce — the list goes on." },
                { q: "How do I track my referrals?", a: "Your affiliate dashboard shows real-time stats on clicks, signups, conversions, and earnings. You'll also get email notifications for key events." },
              ].map((faq, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <h3 className="font-semibold text-foreground mb-2">{faq.q}</h3>
                    <p className="text-sm text-muted-foreground">{faq.a}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary/5 py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Handshake className="w-12 h-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3">
              Ready to Start Earning?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Join hundreds of affiliates already earning commissions with Liberty Bancard. It takes 30 seconds to sign up and you can start sharing your link immediately.
            </p>
            <Button size="lg" className="gap-2" onClick={() => { setView("signup"); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid="button-cta-join">
              <UserPlus className="w-5 h-5" /> Join the Affiliate Program
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
