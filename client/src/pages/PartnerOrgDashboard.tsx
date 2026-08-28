import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { getCsrfToken } from "@/lib/queryClient";
import { SEO } from "@/components/SEO";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { captureAuthActionToken } from "@/lib/auth-action-fragment";
import {
  Loader2, Users, DollarSign, TrendingUp, CheckCircle,
  LogIn, LogOut, BarChart3, Building2, UserPlus, X,
  FileText, Send, Copy, Plus, Eye, CheckCircle2, Clock,
  ExternalLink, Trash2,
} from "lucide-react";

interface OrgSession {
  user: { id: number; email: string; firstName: string; lastName: string; role: string };
  org: { id: number; name: string; slug: string; logoUrl: string | null; primaryColor: string | null };
}

interface DashboardData {
  org: {
    id: number; name: string; slug: string; logoUrl: string | null;
    primaryColor: string | null; commissionRate: number;
  };
  kpis: {
    totalLeads: number; pipelineDeals: number; closedDeals: number;
    commissionMTD: number; totalCommissionEarned: number;
  };
  deals: Array<{
    id: number; stage: string; pipeline: string; contactId: number | null;
    estMonthlyRevenue: string | null; closedAt: string | null;
    createdAt: string | null; estimatedCommission: number;
  }>;
  contacts: Array<{
    id: number; firstName: string; lastName: string;
    companyName: string | null; status: string | null; createdAt: string | null;
  }>;
}

interface TeamMember {
  id: number;
  email: string;
  firstName: string;
  lastName: string | null;
  role: string;
  status: string;
  createdAt: string | null;
}

interface Proposal {
  id: number;
  merchantName: string;
  merchantEmail: string | null;
  merchantMonthlyVolume: string | null;
  merchantEffectiveRate: string | null;
  pricingPlan: string | null;
  status: string;
  viewCount: number;
  viewedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  token: string;
  viewerUrl: string;
}

export default function PartnerOrgDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [authAction] = useState(() => {
    const purpose = new URLSearchParams(window.location.hash.slice(1)).get("action");
    const token = captureAuthActionToken();
    return token && (purpose === "activate" || purpose === "reset") ? { token, purpose } : null;
  });
  const [actionPassword, setActionPassword] = useState("");
  const [actionValid, setActionValid] = useState<boolean | null>(null);
  const [actionDone, setActionDone] = useState(false);

  const [session, setSession] = useState<OrgSession | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [wrongOrg, setWrongOrg] = useState(false);

  useEffect(() => {
    if (!authAction) return;
    fetch("/api/partner-org/auth-action/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: authAction.token, purpose: authAction.purpose === "activate" ? "partner_org_activation" : "partner_org_password_reset" }),
    }).then(r => setActionValid(r.ok)).catch(() => setActionValid(false));
  }, [authAction]);

  const submitAuthAction = async () => {
    if (!authAction || actionPassword.length < 8) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner-org/auth-action/consume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: authAction.token, password: actionPassword,
          purpose: authAction.purpose === "activate" ? "partner_org_activation" : "partner_org_password_reset" }),
      });
      if (!res.ok) { setActionValid(false); return; }
      setActionDone(true);
    } finally { setSubmitting(false); }
  };

  // Team management state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ firstName: "", lastName: "", email: "", password: "", role: "member" });
  const [inviting, setInviting] = useState(false);

  // Proposals state
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [showNewProposalForm, setShowNewProposalForm] = useState(false);
  const [proposalForm, setProposalForm] = useState({
    merchantName: "",
    merchantEmail: "",
    merchantMonthlyVolume: "",
    merchantEffectiveRate: "",
    pricingPlan: "interchangePlus",
    customMessage: "",
  });
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [sendingProposalId, setSendingProposalId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/partner-org/session", { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("no session"); return r.json(); })
      .then((data: OrgSession) => {
        if (!slug || data.org.slug === slug) {
          setSession(data);
          loadDashboard();
        } else {
          // Logged in, but to a different org — show 403 rather than the login form
          setWrongOrg(true);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const loadDashboard = async () => {
    try {
      const res = await fetch("/api/partner-org/dashboard", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch {}
    finally { setLoading(false); }
  };

  const loadTeam = async () => {
    setTeamLoading(true);
    try {
      const res = await fetch("/api/partner-org/team", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch {}
    finally { setTeamLoading(false); }
  };

  const handleLogin = async () => {
    if (!loginForm.email || !loginForm.password) {
      toast({ title: "Please enter your email and password", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // CSRF_EXEMPT: PUBLIC_FLOW — partner org login; pre-authentication, no session exists yet
      const res = await fetch("/api/partner-org/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...loginForm, slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Login failed", variant: "destructive" });
        return;
      }
      setSession(data);
      setLoading(true);
      await loadDashboard();
      toast({ title: `Welcome back, ${data.user.firstName}!` });
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    // CSRF_EXEMPT: PUBLIC_FLOW — partner org logout; session-termination, low CSRF risk
    await fetch("/api/partner-org/logout", { method: "POST", credentials: "include" });
    setSession(null);
    setDashboardData(null);
  };

  const loadProposals = async () => {
    setProposalsLoading(true);
    try {
      const res = await fetch("/api/partner-org/proposals", { credentials: "include" });
      if (res.ok) setProposals(await res.json());
    } catch {}
    finally { setProposalsLoading(false); }
  };

  const handleCreateProposal = async () => {
    if (!proposalForm.merchantName.trim()) {
      toast({ title: "Merchant name is required", variant: "destructive" });
      return;
    }
    setCreatingProposal(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch("/api/partner-org/proposals", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(proposalForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Failed to create proposal", variant: "destructive" });
        return;
      }
      toast({ title: "Proposal created!", description: "Copy the link below to share it." });
      setProposalForm({ merchantName: "", merchantEmail: "", merchantMonthlyVolume: "", merchantEffectiveRate: "", pricingPlan: "interchangePlus", customMessage: "" });
      setShowNewProposalForm(false);
      loadProposals();
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setCreatingProposal(false);
    }
  };

  const handleSendProposal = async (proposal: Proposal) => {
    if (!proposal.merchantEmail) {
      toast({ title: "No email on file for this merchant", description: "Edit the proposal to add an email first.", variant: "destructive" });
      return;
    }
    setSendingProposalId(proposal.id);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(`/api/partner-org/proposals/${proposal.id}/send`, {
        method: "POST", headers, credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Failed to send", variant: "destructive" });
        return;
      }
      toast({ title: "Proposal sent!", description: `Delivered to ${proposal.merchantEmail}` });
      loadProposals();
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSendingProposalId(null);
    }
  };

  const handleDeleteProposal = async (id: number) => {
    if (!confirm("Delete this proposal? This cannot be undone.")) return;
    try {
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      await fetch(`/api/partner-org/proposals/${id}`, { method: "DELETE", headers, credentials: "include" });
      loadProposals();
      toast({ title: "Proposal deleted." });
    } catch {}
  };

  const proposalStatusBadge = (p: Proposal) => {
    if (p.acceptedAt) return <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" />Accepted</Badge>;
    if (p.viewCount > 0) return <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1"><Eye className="w-3 h-3" />Viewed</Badge>;
    if (p.deliveredAt) return <Badge className="bg-sky-100 text-sky-800 border-sky-200 gap-1"><Send className="w-3 h-3" />Sent</Badge>;
    return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Draft</Badge>;
  };

  const handleInvite = async () => {
    if (!inviteForm.firstName || !inviteForm.email || !inviteForm.password) {
      toast({ title: "First name, email, and password are required", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const inviteHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const csrfInvite = getCsrfToken();
      if (csrfInvite) inviteHeaders["X-CSRF-Token"] = csrfInvite;
      const res = await fetch("/api/partner-org/invite-user", {
        method: "POST",
        headers: inviteHeaders,
        credentials: "include",
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Invite failed", variant: "destructive" });
        return;
      }
      toast({ title: `${inviteForm.firstName} has been added to your team!` });
      setInviteForm({ firstName: "", lastName: "", email: "", password: "", role: "member" });
      setShowInviteForm(false);
      loadTeam();
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const primaryColor = session?.org.primaryColor || dashboardData?.org.primaryColor || "#2563eb";

  const stageColor = (stage: string) => {
    if (stage === "Closed Won") return "bg-green-100 text-green-800";
    if (stage === "Closed Lost") return "bg-red-100 text-red-800";
    if (stage === "Proposal Sent") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-800";
  };

  if (authAction) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Card className="w-full max-w-sm"><CardContent className="p-8 space-y-4">
        <h1 className="text-xl font-bold">{actionDone ? "Password updated" : "Set your password"}</h1>
        {actionValid === null ? <Loader2 className="w-5 h-5 animate-spin" /> : actionValid === false ?
          <p className="text-sm text-muted-foreground">This link is invalid or expired.</p> : actionDone ?
          <p className="text-sm text-muted-foreground">You can now sign in.</p> :
          <><Input type="password" autoComplete="new-password" value={actionPassword} onChange={e => setActionPassword(e.target.value)} placeholder="At least 8 characters" />
          <Button className="w-full" onClick={submitAuthAction} disabled={submitting || actionPassword.length < 8}>Set Password</Button></>}
      </CardContent></Card>
    </div>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Logged in but wrong org — show 403 instead of silently falling to the login form
  if (wrongOrg) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-sm shadow-lg border-0">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 bg-red-50">
              <Building2 className="w-7 h-7 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h1>
            <p className="text-sm text-gray-500 mb-6">
              You are logged in to a different partner organization and cannot access this dashboard.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                // CSRF_EXEMPT: PUBLIC_FLOW — partner org logout; session-termination, low CSRF risk
                await fetch("/api/partner-org/logout", { method: "POST", credentials: "include" });
                setWrongOrg(false);
                setSession(null);
              }}
            >
              Log out and switch organization
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Login screen
  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <SEO title="Partner Portal Login" description="Log in to your white-label partner dashboard" path={`/partner-org/${slug}`} noindex={true} />
        <Card className="w-full max-w-sm shadow-lg border-0">
          <CardContent className="p-8">
            <div className="text-center mb-6">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `${primaryColor}20` }}
              >
                <Building2 className="w-7 h-7" style={{ color: primaryColor }} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Partner Portal</h1>
              {slug && <p className="text-sm text-gray-500 mt-1 capitalize">{slug.replace(/-/g, " ")}</p>}
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="you@yourcompany.com"
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  data-testid="input-login-email"
                />
              </div>
              <div>
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
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
                style={{ backgroundColor: primaryColor, borderColor: primaryColor }}
                onClick={handleLogin}
                disabled={submitting}
                data-testid="button-login"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><LogIn className="w-4 h-4" /> Log In</>}
              </Button>
              <p className="text-xs text-center text-gray-400">
                Need access? Contact your organization administrator.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Dashboard
  const data = dashboardData;
  const orgName = data?.org.name || session.org.name;
  const isAdmin = session.user.role === "admin";

  return (
    <div className="min-h-screen bg-gray-50">
      <SEO title={`${orgName} Partner Dashboard`} description="Your partner pipeline and earnings" path={`/partner-org/${slug}`} noindex={true} />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {session.org.logoUrl ? (
              <img src={session.org.logoUrl} alt={orgName} className="h-9 w-auto object-contain" />
            ) : (
              <div
                className="h-9 px-4 flex items-center rounded-md font-bold text-white text-sm"
                style={{ backgroundColor: primaryColor }}
              >
                {orgName}
              </div>
            )}
            <span className="text-xs text-gray-400 hidden sm:block">Partner Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">
              {session.user.firstName} {session.user.lastName}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2" data-testid="button-logout">
              <LogOut className="w-4 h-4" /> Log Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="text-dashboard-title">
            Welcome back, {session.user.firstName}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{orgName} — Partner Dashboard</p>
        </div>

        {!data ? (
          <div className="text-center py-20 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
            Loading your dashboard...
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
              {[
                { icon: Users, label: "Total Leads", value: data.kpis.totalLeads, testId: "kpi-leads" },
                { icon: BarChart3, label: "Pipeline", value: data.kpis.pipelineDeals, testId: "kpi-pipeline" },
                { icon: CheckCircle, label: "Closed Won", value: data.kpis.closedDeals, testId: "kpi-closed" },
                { icon: TrendingUp, label: "Commission MTD", value: `$${data.kpis.commissionMTD.toLocaleString()}`, testId: "kpi-mtd" },
                { icon: DollarSign, label: "Total Earned", value: `$${data.kpis.totalCommissionEarned.toLocaleString()}`, testId: "kpi-total" },
              ].map(({ icon: Icon, label, value, testId }) => (
                <Card key={label} className="border-0 shadow-sm">
                  <CardContent className="p-4 text-center">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mx-auto mb-2"
                      style={{ backgroundColor: `${primaryColor}20` }}
                    >
                      <Icon className="w-4 h-4" style={{ color: primaryColor }} />
                    </div>
                    <p className="text-2xl font-bold text-gray-900" data-testid={testId}>{value}</p>
                    <p className="text-xs text-gray-500 mt-1">{label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Commission rate notice */}
            <div
              className="rounded-lg p-4 mb-6 flex items-center gap-3 text-white text-sm"
              style={{ backgroundColor: primaryColor }}
            >
              <DollarSign className="w-5 h-5 shrink-0" />
              <span>
                Your commission rate is <strong>{data.org.commissionRate}%</strong> of monthly processing revenue for each closed deal.
                Commission is tracked and paid offline — contact your Liberty Bancard rep for payout schedule.
              </span>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="pipeline" className="space-y-4" onValueChange={v => {
              if (v === "team") loadTeam();
              if (v === "proposals") loadProposals();
            }}>
              <TabsList>
                <TabsTrigger value="pipeline" data-testid="tab-pipeline">Pipeline</TabsTrigger>
                <TabsTrigger value="contacts" data-testid="tab-contacts">Leads</TabsTrigger>
                <TabsTrigger value="proposals" data-testid="tab-proposals">
                  <FileText className="w-3.5 h-3.5 mr-1.5" />Proposals
                </TabsTrigger>
                {isAdmin && <TabsTrigger value="team" data-testid="tab-team">Team</TabsTrigger>}
              </TabsList>

              <TabsContent value="pipeline">
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">All Deals ({data.deals.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {data.deals.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>No deals attributed to your org yet.</p>
                        <p className="text-xs mt-1">Leads submitted through your partner portal will appear here.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Deal ID</th>
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Pipeline</th>
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Stage</th>
                              <th className="text-right py-3 px-4 text-gray-500 font-medium">Est. Revenue</th>
                              <th className="text-right py-3 px-4 text-gray-500 font-medium">Your Commission</th>
                              <th className="text-right py-3 px-4 text-gray-500 font-medium">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.deals.map(deal => (
                              <tr key={deal.id} className="border-b border-gray-50 hover:bg-gray-50" data-testid={`row-deal-${deal.id}`}>
                                <td className="py-3 px-4 text-gray-400 font-mono text-xs">#{deal.id}</td>
                                <td className="py-3 px-4 capitalize text-gray-700">{deal.pipeline}</td>
                                <td className="py-3 px-4">
                                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stageColor(deal.stage)}`}>
                                    {deal.stage}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right text-gray-700">
                                  {deal.estMonthlyRevenue ? `$${parseFloat(deal.estMonthlyRevenue).toLocaleString()}/mo` : "—"}
                                </td>
                                <td className="py-3 px-4 text-right font-semibold text-green-700">
                                  ${deal.estimatedCommission.toLocaleString()}
                                </td>
                                <td className="py-3 px-4 text-right text-gray-400 text-xs">
                                  {deal.createdAt ? new Date(deal.createdAt).toLocaleDateString() : "—"}
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

              <TabsContent value="contacts">
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">All Leads ({data.contacts.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {data.contacts.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>No leads attributed to your org yet.</p>
                        <p className="text-xs mt-1">Share your branded partner page to start capturing leads.</p>
                        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
                          <span className="font-mono bg-gray-100 px-3 py-1 rounded text-gray-600">
                            {window.location.origin}/partner/{data.org.slug}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Name</th>
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Company</th>
                              <th className="text-left py-3 px-4 text-gray-500 font-medium">Status</th>
                              <th className="text-right py-3 px-4 text-gray-500 font-medium">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.contacts.map(contact => (
                              <tr key={contact.id} className="border-b border-gray-50 hover:bg-gray-50" data-testid={`row-contact-${contact.id}`}>
                                <td className="py-3 px-4 font-medium text-gray-900">
                                  {contact.firstName} {contact.lastName}
                                </td>
                                <td className="py-3 px-4 text-gray-600">{contact.companyName || "—"}</td>
                                <td className="py-3 px-4">
                                  <Badge variant={contact.status === "Closed Won" ? "default" : "secondary"} className="text-xs">
                                    {contact.status || "New"}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-right text-gray-400 text-xs">
                                  {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : "—"}
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

              {/* ── Proposals Tab ─────────────────────────────────────────── */}
              <TabsContent value="proposals">
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Co-Branded Proposals ({proposals.length})</CardTitle>
                    {!showNewProposalForm && (
                      <Button
                        size="sm"
                        className="gap-2"
                        style={{ backgroundColor: primaryColor }}
                        onClick={() => setShowNewProposalForm(true)}
                        data-testid="button-new-proposal"
                      >
                        <Plus className="w-4 h-4" /> New Proposal
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    {/* New proposal form */}
                    {showNewProposalForm && (
                      <div className="border border-gray-200 rounded-lg p-5 mb-6 bg-gray-50">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-gray-900 text-sm">Create New Proposal</h3>
                          <button
                            onClick={() => setShowNewProposalForm(false)}
                            className="text-gray-400 hover:text-gray-600"
                            data-testid="button-cancel-proposal"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2">
                            <Label htmlFor="prop-merchant">Merchant / Business Name *</Label>
                            <Input
                              id="prop-merchant"
                              value={proposalForm.merchantName}
                              onChange={e => setProposalForm(f => ({ ...f, merchantName: e.target.value }))}
                              placeholder="Acme Restaurant LLC"
                              data-testid="input-proposal-merchant"
                            />
                          </div>
                          <div>
                            <Label htmlFor="prop-email">Merchant Email</Label>
                            <Input
                              id="prop-email"
                              type="email"
                              value={proposalForm.merchantEmail}
                              onChange={e => setProposalForm(f => ({ ...f, merchantEmail: e.target.value }))}
                              placeholder="owner@restaurant.com"
                              data-testid="input-proposal-email"
                            />
                          </div>
                          <div>
                            <Label>Pricing Plan</Label>
                            <Select value={proposalForm.pricingPlan} onValueChange={v => setProposalForm(f => ({ ...f, pricingPlan: v }))}>
                              <SelectTrigger data-testid="select-proposal-plan">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="interchangePlus">Interchange Plus (Most Transparent)</SelectItem>
                                <SelectItem value="cashDiscount">Cash Discount (0% for Business)</SelectItem>
                                <SelectItem value="flatRate">Flat Rate (Predictable)</SelectItem>
                                <SelectItem value="tieredReduction">Tiered Reduction (Gradual Savings)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="prop-volume">Monthly Processing Volume ($)</Label>
                            <Input
                              id="prop-volume"
                              value={proposalForm.merchantMonthlyVolume}
                              onChange={e => setProposalForm(f => ({ ...f, merchantMonthlyVolume: e.target.value }))}
                              placeholder="50000"
                              data-testid="input-proposal-volume"
                            />
                          </div>
                          <div>
                            <Label htmlFor="prop-rate">Current Effective Rate (%)</Label>
                            <Input
                              id="prop-rate"
                              value={proposalForm.merchantEffectiveRate}
                              onChange={e => setProposalForm(f => ({ ...f, merchantEffectiveRate: e.target.value }))}
                              placeholder="3.2"
                              data-testid="input-proposal-rate"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label htmlFor="prop-message">Personal Message (optional)</Label>
                            <Textarea
                              id="prop-message"
                              value={proposalForm.customMessage}
                              onChange={e => setProposalForm(f => ({ ...f, customMessage: e.target.value }))}
                              placeholder="Hi John, based on our conversation I've put together a few options that could save you significantly on processing..."
                              rows={3}
                              data-testid="input-proposal-message"
                            />
                          </div>
                        </div>
                        <div className="flex gap-3 mt-4">
                          <Button
                            size="sm"
                            className="gap-2"
                            style={{ backgroundColor: primaryColor }}
                            onClick={handleCreateProposal}
                            disabled={creatingProposal}
                            data-testid="button-create-proposal"
                          >
                            {creatingProposal ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Create Proposal</>}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowNewProposalForm(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Proposals list */}
                    {proposalsLoading ? (
                      <div className="flex items-center gap-2 py-10 justify-center text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin" /> Loading proposals...
                      </div>
                    ) : proposals.length === 0 ? (
                      <div className="text-center py-14 text-gray-400">
                        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="font-medium mb-1">No proposals yet</p>
                        <p className="text-xs max-w-sm mx-auto">
                          Create a co-branded proposal for any merchant. It will include your logo, contact details, and a personalized savings analysis.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proposals.map(proposal => (
                          <div
                            key={proposal.id}
                            className="border border-gray-200 rounded-lg p-4 bg-white hover:border-gray-300 transition-colors"
                            data-testid={`card-proposal-${proposal.id}`}
                          >
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="font-semibold text-gray-900 text-sm" data-testid={`text-proposal-merchant-${proposal.id}`}>
                                    {proposal.merchantName}
                                  </span>
                                  {proposalStatusBadge(proposal)}
                                </div>
                                <div className="text-xs text-gray-500 space-y-0.5">
                                  {proposal.merchantEmail && <div>Email: {proposal.merchantEmail}</div>}
                                  {proposal.merchantMonthlyVolume && <div>Volume: ${parseFloat(proposal.merchantMonthlyVolume || "0").toLocaleString()}/mo</div>}
                                  {proposal.merchantEffectiveRate && <div>Current Rate: {proposal.merchantEffectiveRate}%</div>}
                                  <div>Created: {proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : "—"}</div>
                                  {proposal.viewCount > 0 && (
                                    <div className="text-blue-600 font-medium">
                                      Viewed {proposal.viewCount}× {proposal.viewedAt ? `— last ${new Date(proposal.viewedAt).toLocaleDateString()}` : ""}
                                    </div>
                                  )}
                                  {proposal.acceptedAt && (
                                    <div className="text-green-600 font-medium">
                                      Accepted {new Date(proposal.acceptedAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-8"
                                  onClick={() => {
                                    navigator.clipboard.writeText(proposal.viewerUrl);
                                    toast({ title: "Proposal link copied!" });
                                  }}
                                  data-testid={`button-copy-proposal-${proposal.id}`}
                                >
                                  <Copy className="w-3 h-3" /> Copy Link
                                </Button>
                                <a href={proposal.viewerUrl} target="_blank" rel="noopener noreferrer">
                                  <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" data-testid={`button-view-proposal-${proposal.id}`}>
                                    <ExternalLink className="w-3 h-3" /> Preview
                                  </Button>
                                </a>
                                {proposal.merchantEmail && (
                                  <Button
                                    size="sm"
                                    className="gap-1.5 text-xs h-8"
                                    style={{ backgroundColor: primaryColor }}
                                    onClick={() => handleSendProposal(proposal)}
                                    disabled={sendingProposalId === proposal.id}
                                    data-testid={`button-send-proposal-${proposal.id}`}
                                  >
                                    {sendingProposalId === proposal.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <><Send className="w-3 h-3" /> Send Email</>
                                    )}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="gap-1.5 text-xs h-8 text-red-600 hover:text-red-700"
                                  onClick={() => handleDeleteProposal(proposal.id)}
                                  data-testid={`button-delete-proposal-${proposal.id}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {isAdmin && (
                <TabsContent value="team">
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Team Members</CardTitle>
                      {!showInviteForm && (
                        <Button
                          size="sm"
                          className="gap-2"
                          style={{ backgroundColor: primaryColor }}
                          onClick={() => setShowInviteForm(true)}
                          data-testid="button-invite-member"
                        >
                          <UserPlus className="w-4 h-4" /> Invite Member
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      {/* Invite form */}
                      {showInviteForm && (
                        <div className="border border-gray-200 rounded-lg p-5 mb-6 bg-gray-50">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-gray-900 text-sm">Invite a Team Member</h3>
                            <button
                              onClick={() => setShowInviteForm(false)}
                              className="text-gray-400 hover:text-gray-600"
                              data-testid="button-cancel-invite"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="invite-first">First Name *</Label>
                              <Input
                                id="invite-first"
                                value={inviteForm.firstName}
                                onChange={e => setInviteForm(f => ({ ...f, firstName: e.target.value }))}
                                placeholder="Jane"
                                data-testid="input-invite-first"
                              />
                            </div>
                            <div>
                              <Label htmlFor="invite-last">Last Name</Label>
                              <Input
                                id="invite-last"
                                value={inviteForm.lastName}
                                onChange={e => setInviteForm(f => ({ ...f, lastName: e.target.value }))}
                                placeholder="Smith"
                                data-testid="input-invite-last"
                              />
                            </div>
                            <div>
                              <Label htmlFor="invite-email">Email *</Label>
                              <Input
                                id="invite-email"
                                type="email"
                                value={inviteForm.email}
                                onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                                placeholder="jane@yourcompany.com"
                                data-testid="input-invite-email"
                              />
                            </div>
                            <div>
                              <Label htmlFor="invite-password">Initial Password *</Label>
                              <Input
                                id="invite-password"
                                type="password"
                                value={inviteForm.password}
                                onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
                                placeholder="••••••••"
                                data-testid="input-invite-password"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <Label>Role</Label>
                              <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                                <SelectTrigger data-testid="select-invite-role">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="member">Member — can view pipeline and leads</SelectItem>
                                  <SelectItem value="admin">Admin — can also invite team members</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex gap-3 mt-4">
                            <Button
                              size="sm"
                              className="gap-2"
                              style={{ backgroundColor: primaryColor }}
                              onClick={handleInvite}
                              disabled={inviting}
                              data-testid="button-submit-invite"
                            >
                              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4" /> Add Member</>}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setShowInviteForm(false)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Team list */}
                      {teamLoading ? (
                        <div className="flex items-center gap-2 py-8 justify-center text-gray-500">
                          <Loader2 className="w-5 h-5 animate-spin" /> Loading team...
                        </div>
                      ) : teamMembers.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                          <p>No team members yet.</p>
                          <p className="text-xs mt-1">Invite sub-agents or partners to give them access to this dashboard.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="text-left py-3 px-4 text-gray-500 font-medium">Name</th>
                                <th className="text-left py-3 px-4 text-gray-500 font-medium">Email</th>
                                <th className="text-left py-3 px-4 text-gray-500 font-medium">Role</th>
                                <th className="text-left py-3 px-4 text-gray-500 font-medium">Status</th>
                                <th className="text-right py-3 px-4 text-gray-500 font-medium">Added</th>
                              </tr>
                            </thead>
                            <tbody>
                              {teamMembers.map(member => (
                                <tr key={member.id} className="border-b border-gray-50 hover:bg-gray-50" data-testid={`row-member-${member.id}`}>
                                  <td className="py-3 px-4 font-medium text-gray-900">
                                    {member.firstName} {member.lastName}
                                  </td>
                                  <td className="py-3 px-4 text-gray-600">{member.email}</td>
                                  <td className="py-3 px-4">
                                    <Badge variant={member.role === "admin" ? "default" : "secondary"} className="text-xs capitalize">
                                      {member.role}
                                    </Badge>
                                  </td>
                                  <td className="py-3 px-4">
                                    <Badge variant={member.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                                      {member.status}
                                    </Badge>
                                  </td>
                                  <td className="py-3 px-4 text-right text-gray-400 text-xs">
                                    {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : "—"}
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
              )}
            </Tabs>

            {/* Partner link */}
            <Card className="border-0 shadow-sm mt-6">
              <CardContent className="p-5">
                <p className="text-sm font-medium text-gray-700 mb-2">Your Branded Partner Page</p>
                <p className="text-xs text-gray-500 mb-3">Share this URL with prospects. All leads submitted through it are automatically attributed to your organization.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-700 truncate">
                    {window.location.origin}/partner/{data.org.slug}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/partner/${data.org.slug}`);
                      toast({ title: "Partner link copied!" });
                    }}
                    data-testid="button-copy-link"
                  >
                    Copy
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="border-t border-gray-200 mt-16 py-6 text-center text-xs text-gray-400">
        <p>Powered by <a href="https://libertybancard.com" className="underline">Liberty Bancard</a></p>
      </footer>
    </div>
  );
}
