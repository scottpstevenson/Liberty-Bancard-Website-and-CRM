import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  UserPlus, Users, Award, DollarSign, Search, MoreHorizontal, Target, Download,
  Calculator, BookOpen, Trash2, Plus, Eye, Info
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/export-csv";
import DashboardErrorState from "@/components/DashboardErrorState";
import { useAuth } from "@/hooks/use-auth";
import type { Agent, AgentQuota, AgentMerchant, Deal } from "@shared/schema";

const agentFormSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  role: z.string().min(1, "Required"),
  commissionSplitPercent: z.coerce.number().min(0).max(100),
  territory: z.string().optional(),
  status: z.string().min(1, "Required"),
  hireDate: z.string().optional(),
  vestingMonths: z.coerce.number().min(0).max(120).optional(),
  notes: z.string().optional(),
});

type AgentFormData = z.infer<typeof agentFormSchema>;

const quotaFormSchema = z.object({
  agentId: z.coerce.number().min(1, "Select an agent"),
  period: z.string().min(1, "Required"),
  periodStart: z.string().min(1, "Required"),
  periodEnd: z.string().min(1, "Required"),
  targetDeals: z.coerce.number().min(0),
  targetRevenue: z.string().min(1, "Required"),
});

type QuotaFormData = z.infer<typeof quotaFormSchema>;

const assignMerchantSchema = z.object({
  dealId: z.coerce.number().min(1, "Select a merchant"),
  merchantName: z.string().optional(),
});
type AssignMerchantData = z.infer<typeof assignMerchantSchema>;

const calcSchema = z.object({
  agentId: z.coerce.number().min(1, "Select an agent"),
  totalResidual: z.coerce.number().min(0, "Enter a valid amount"),
  month: z.string().optional(),
});
type CalcFormData = z.infer<typeof calcSchema>;

function formatCurrency(value: string | number | null | undefined): string {
  const num = parseFloat(String(value || "0"));
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

function roleBadgeLabel(role: string): string {
  switch (role) {
    case "sales_rep": return "Sales Rep";
    case "manager": return "Manager";
    case "iso_agent": return "ISO Agent";
    default: return role;
  }
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="space-y-1" data-testid={`progress-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value} / {max} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-600" : pct >= 50 ? "bg-primary" : "bg-orange-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface CalcResult {
  agentId: number;
  agentName: string;
  splitPercent: number;
  totalResidual: number;
  repPayout: number;
  ownerOverride: number;
  month: string | null;
  breakdown: Array<{
    id: number;
    dealId: number;
    merchantName: string;
    share: number;
    repShare: number;
    ownerShare: number;
  }>;
}

export default function AgentManagement() {
  const { data: agents, isLoading, isError, refetch } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: quotas } = useQuery<AgentQuota[]>({ queryKey: ["/api/agent-quotas"] });
  const { data: allDeals } = useQuery<{ data: Deal[] }>({ queryKey: ["/api/deals"] });
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isQuotaDialogOpen, setIsQuotaDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'admin';

  const { data: profileMerchants, isLoading: profileMerchantsLoading } = useQuery<AgentMerchant[]>({
    queryKey: ["/api/agent-merchants", profileAgent?.id],
    queryFn: async () => {
      if (!profileAgent) return [];
      const res = await fetch(`/api/agent-merchants?agentId=${profileAgent.id}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!profileAgent,
  });

  const { data: profileResiduals } = useQuery<any[]>({
    queryKey: ["/api/merchant-residuals", "agent", profileAgent?.id],
    queryFn: async () => {
      if (!profileAgent) return [];
      const res = await fetch(`/api/merchant-residuals?agentId=${profileAgent.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profileAgent,
  });

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      firstName: "", lastName: "", email: "", phone: "",
      role: "sales_rep", commissionSplitPercent: 60,
      territory: "", status: "active", hireDate: "", vestingMonths: 3, notes: "",
    },
  });

  const quotaForm = useForm<QuotaFormData>({
    resolver: zodResolver(quotaFormSchema),
    defaultValues: { agentId: 0, period: "", periodStart: "", periodEnd: "", targetDeals: 0, targetRevenue: "0" },
  });

  const assignForm = useForm<AssignMerchantData>({
    resolver: zodResolver(assignMerchantSchema),
    defaultValues: { dealId: 0, merchantName: "" },
  });

  const calcForm = useForm<CalcFormData>({
    resolver: zodResolver(calcSchema),
    defaultValues: { agentId: 0, totalResidual: 0, month: "" },
  });

  const createAgent = useMutation({
    mutationFn: async (data: AgentFormData) => (await apiRequest("POST", "/api/agents", data)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agents"] }); toast({ title: "Agent created" }); closeDialog(); },
    onError: (err: Error) => toast({ title: "Failed to create agent", description: err.message, variant: "destructive" }),
  });

  const updateAgent = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<AgentFormData> }) =>
      (await apiRequest("PATCH", `/api/agents/${id}`, data)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agents"] }); toast({ title: "Agent updated" }); closeDialog(); },
    onError: (err: Error) => toast({ title: "Failed to update agent", description: err.message, variant: "destructive" }),
  });

  const createQuota = useMutation({
    mutationFn: async (data: QuotaFormData) => (await apiRequest("POST", "/api/agent-quotas", {
      ...data, periodStart: new Date(data.periodStart).toISOString(), periodEnd: new Date(data.periodEnd).toISOString(),
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agent-quotas"] }); toast({ title: "Quota created" }); setIsQuotaDialogOpen(false); quotaForm.reset({ agentId: 0, period: "", periodStart: "", periodEnd: "", targetDeals: 0, targetRevenue: "0" }); },
    onError: (err: Error) => toast({ title: "Failed to create quota", description: err.message, variant: "destructive" }),
  });

  const assignMerchant = useMutation({
    mutationFn: async (data: AssignMerchantData) => {
      const selectedDeal = (allDeals?.data || []).find(d => d.id === data.dealId);
      const payload = {
        agentId: profileAgent!.id,
        dealId: data.dealId,
        merchantName: data.merchantName || selectedDeal?.notes || `Merchant #${data.dealId}`,
      };
      return (await apiRequest("POST", "/api/agent-merchants", payload)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-merchants", profileAgent?.id] });
      toast({ title: "Merchant assigned" });
      assignForm.reset({ dealId: 0, merchantName: "" });
    },
    onError: (err: Error) => toast({ title: "Failed to assign merchant", description: err.message, variant: "destructive" }),
  });

  const unassignMerchant = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/agent-merchants/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-merchants", profileAgent?.id] });
      toast({ title: "Merchant unassigned" });
    },
    onError: (err: Error) => toast({ title: "Failed to unassign", description: err.message, variant: "destructive" }),
  });

  const runCalculator = useMutation({
    mutationFn: async (data: CalcFormData) =>
      (await apiRequest("POST", "/api/agents/residual-calculator", data)).json() as Promise<CalcResult>,
    onSuccess: (result) => setCalcResult(result),
    onError: (err: Error) => toast({ title: "Calculation failed", description: err.message, variant: "destructive" }),
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAgent(null);
    form.reset({ firstName: "", lastName: "", email: "", phone: "", role: "sales_rep", commissionSplitPercent: 60, territory: "", status: "active", hireDate: "", vestingMonths: 3, notes: "" });
  };

  const openEditDialog = (agent: Agent) => {
    setEditingAgent(agent);
    form.reset({
      firstName: agent.firstName, lastName: agent.lastName, email: agent.email,
      phone: agent.phone || "", role: agent.role || "sales_rep",
      commissionSplitPercent: agent.commissionSplitPercent ?? 60,
      territory: agent.territory || "", status: agent.status || "active",
      hireDate: agent.hireDate ? new Date(agent.hireDate).toISOString().split("T")[0] : "",
      vestingMonths: agent.vestingMonths ?? 3,
      notes: agent.notes || "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AgentFormData) => {
    try {
      const { hireDate, ...rest } = data;
      const payload = {
        ...rest,
        ...(hireDate ? { hireDate: new Date(hireDate).toISOString() } : {}),
      };
      if (editingAgent) { await updateAgent.mutateAsync({ id: editingAgent.id, data: payload }); }
      else { await createAgent.mutateAsync(payload); }
    } catch { }
  };

  const filteredAgents = agents?.filter((a) => {
    const term = searchTerm.toLowerCase();
    return (
      a.firstName.toLowerCase().includes(term) ||
      a.lastName.toLowerCase().includes(term) ||
      a.email.toLowerCase().includes(term) ||
      (a.territory || "").toLowerCase().includes(term)
    );
  });

  const activeAgents = agents?.filter((a) => a.status === "active") || [];
  const totalDeals = agents?.reduce((sum, a) => sum + (a.totalDeals || 0), 0) || 0;
  const avgDeals = activeAgents.length > 0 ? Math.round(totalDeals / activeAgents.length) : 0;
  const totalRevenue = agents?.reduce((sum, a) => sum + parseFloat(a.totalRevenue || "0"), 0) || 0;

  const getAgentQuota = (agentId: number): AgentQuota | undefined => quotas?.find(q => q.agentId === agentId);
  const getQuotaAttainment = (agentId: number): number | null => {
    const quota = getAgentQuota(agentId);
    if (!quota || !quota.targetDeals || quota.targetDeals === 0) return null;
    return Math.round(((quota.actualDeals || 0) / quota.targetDeals) * 100);
  };

  const exportAgentPayouts = (result: CalcResult) => {
    const rows = result.breakdown.map(b => ({
      merchantName: b.merchantName,
      totalShare: b.share.toFixed(2),
      repPayout: b.repShare.toFixed(2),
      ownerOverride: b.ownerShare.toFixed(2),
    }));
    rows.push({
      merchantName: "TOTAL",
      totalShare: result.totalResidual.toFixed(2),
      repPayout: result.repPayout.toFixed(2),
      ownerOverride: result.ownerOverride.toFixed(2),
    });
    exportToCSV(rows, `${result.agentName.replace(/\s/g, "_")}_payout_${result.month || "monthly"}`, [
      { key: "merchantName", label: "Merchant" },
      { key: "totalShare", label: "Total Residual Share" },
      { key: "repPayout", label: "Rep Payout" },
      { key: "ownerOverride", label: "Owner Override" },
    ]);
  };

  if (isError) return <DashboardErrorState title="Failed to load agents" onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="team" className="w-full">
        <TabsList className="mb-4" data-testid="tabs-agent-management">
          <TabsTrigger value="team" data-testid="tab-team"><Users className="w-4 h-4 mr-1" />Team Members</TabsTrigger>
          <TabsTrigger value="calculator" data-testid="tab-calculator"><Calculator className="w-4 h-4 mr-1" />Residual Calculator</TabsTrigger>
          {isOwner && <TabsTrigger value="comp-model" data-testid="tab-comp-model"><BookOpen className="w-4 h-4 mr-1" />Comp Model</TabsTrigger>}
        </TabsList>

        {/* ─── TEAM MEMBERS TAB ─── */}
        <TabsContent value="team" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="kpi-active-agents">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Active Agents</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <div className="text-2xl font-bold" data-testid="text-active-agents-count">{activeAgents.length}</div>
                )}
              </CardContent>
            </Card>
            <Card data-testid="kpi-total-deals">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Deals</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <div className="text-2xl font-bold" data-testid="text-total-deals">{totalDeals}</div>
                )}
              </CardContent>
            </Card>
            <Card data-testid="kpi-avg-deals">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Deals Per Agent</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <div className="text-2xl font-bold" data-testid="text-avg-deals">{avgDeals}</div>
                )}
              </CardContent>
            </Card>
            <Card data-testid="kpi-total-revenue">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue Managed</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <div className="text-2xl font-bold" data-testid="text-total-revenue">{formatCurrency(totalRevenue)}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-agents"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const exportData = (filteredAgents || []).map(a => ({
                    name: `${a.firstName} ${a.lastName}`,
                    email: a.email,
                    role: roleBadgeLabel(a.role || ""),
                    territory: a.territory || "",
                    status: a.status || "",
                    commissionPercent: a.commissionSplitPercent ?? "",
                    totalDeals: a.totalDeals || 0,
                    totalRevenue: a.totalRevenue || "0",
                    notes: a.notes || "",
                  }));
                  exportToCSV(exportData, "agents", [
                    { key: "name", label: "Name" }, { key: "email", label: "Email" },
                    { key: "role", label: "Role" }, { key: "territory", label: "Territory" },
                    { key: "status", label: "Status" }, { key: "commissionPercent", label: "Commission %" },
                    { key: "totalDeals", label: "Total Deals" }, { key: "totalRevenue", label: "Total Revenue" },
                    { key: "notes", label: "Notes" },
                  ]);
                }}
                data-testid="button-export-agents"
              >
                <Download className="w-4 h-4 mr-1" /> Export Agents
              </Button>
              <Dialog open={isQuotaDialogOpen} onOpenChange={setIsQuotaDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-add-quota">
                    <Target className="w-4 h-4" /> Add Quota
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Agent Quota</DialogTitle></DialogHeader>
                  <Form {...quotaForm}>
                    <form onSubmit={quotaForm.handleSubmit((data) => createQuota.mutate(data))} className="space-y-4">
                      <FormField control={quotaForm.control} name="agentId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Agent</FormLabel>
                          <Select onValueChange={field.onChange} value={String(field.value || "")}>
                            <FormControl><SelectTrigger data-testid="select-quota-agent"><SelectValue placeholder="Select agent" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {agents?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={quotaForm.control} name="period" render={({ field }) => (
                        <FormItem><FormLabel>Period</FormLabel><FormControl><Input {...field} placeholder="e.g. Q1 2026" data-testid="input-quota-period" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={quotaForm.control} name="periodStart" render={({ field }) => (
                          <FormItem><FormLabel>Period Start</FormLabel><FormControl><Input {...field} type="date" data-testid="input-quota-start" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={quotaForm.control} name="periodEnd" render={({ field }) => (
                          <FormItem><FormLabel>Period End</FormLabel><FormControl><Input {...field} type="date" data-testid="input-quota-end" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={quotaForm.control} name="targetDeals" render={({ field }) => (
                          <FormItem><FormLabel>Target Deals</FormLabel><FormControl><Input {...field} type="number" min={0} data-testid="input-quota-target-deals" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={quotaForm.control} name="targetRevenue" render={({ field }) => (
                          <FormItem><FormLabel>Target Revenue</FormLabel><FormControl><Input {...field} placeholder="e.g. 50000" data-testid="input-quota-target-revenue" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={createQuota.isPending} data-testid="button-save-quota">
                          {createQuota.isPending ? "Saving..." : "Create Quota"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
              <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setIsDialogOpen(true); }}>
                <DialogTrigger asChild>
                  <Button className="gap-2" data-testid="button-add-agent">
                    <UserPlus className="w-4 h-4" /> Add Agent
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{editingAgent ? "Edit Agent" : "Add New Agent"}</DialogTitle></DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="firstName" render={({ field }) => (
                          <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} data-testid="input-first-name" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="lastName" render={({ field }) => (
                          <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} data-testid="input-last-name" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} type="email" data-testid="input-email" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="phone" render={({ field }) => (
                        <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} data-testid="input-phone" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="role" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Role</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger data-testid="select-role"><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="sales_rep">Sales Rep</SelectItem>
                                <SelectItem value="manager">Manager</SelectItem>
                                <SelectItem value="iso_agent">ISO Agent</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="commissionSplitPercent" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Split % (Rep receives)</FormLabel>
                            <FormControl><Input {...field} type="number" min={0} max={100} data-testid="input-commission" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="territory" render={({ field }) => (
                          <FormItem><FormLabel>Territory</FormLabel><FormControl><Input {...field} data-testid="input-territory" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="status" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger data-testid="select-status"><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="hireDate" render={({ field }) => (
                          <FormItem><FormLabel>Start Date</FormLabel><FormControl><Input {...field} type="date" data-testid="input-hire-date" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="vestingMonths" render={({ field }) => (
                          <FormItem><FormLabel>Vesting (months)</FormLabel><FormControl><Input {...field} type="number" min={0} max={120} placeholder="3" data-testid="input-vesting-months" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem><FormLabel>Notes / Clawback Terms</FormLabel><FormControl><Textarea {...field} rows={2} placeholder="Clawback terms, special conditions..." data-testid="textarea-notes" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                        <Button type="submit" disabled={createAgent.isPending || updateAgent.isPending} data-testid="button-save-agent">
                          {createAgent.isPending || updateAgent.isPending ? "Saving..." : editingAgent ? "Update Agent" : "Create Agent"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table data-testid="table-agents">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Split %</TableHead>
                    <TableHead>Territory</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quota Progress</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ))
                  ) : (filteredAgents || []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No agents found.</TableCell></TableRow>
                  ) : (
                    (filteredAgents || []).map((agent) => {
                      const quota = getAgentQuota(agent.id);
                      const attainment = getQuotaAttainment(agent.id);
                      return (
                        <TableRow key={agent.id} data-testid={`row-agent-${agent.id}`}>
                          <TableCell>
                            <div>
                              <div className="font-medium" data-testid={`text-agent-name-${agent.id}`}>{agent.firstName} {agent.lastName}</div>
                              <div className="text-xs text-muted-foreground">{agent.email}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" data-testid={`badge-role-${agent.id}`}>{roleBadgeLabel(agent.role || "sales_rep")}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold text-primary" data-testid={`text-split-${agent.id}`}>{agent.commissionSplitPercent ?? 60}%</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{agent.territory || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={agent.status === "active" ? "default" : "outline"} data-testid={`badge-status-${agent.id}`}>
                              {agent.status || "active"}
                            </Badge>
                          </TableCell>
                          <TableCell className="w-48">
                            {quota ? (
                              <ProgressBar value={quota.actualDeals || 0} max={quota.targetDeals || 1} label="Quota" />
                            ) : (
                              <span className="text-xs text-muted-foreground">No quota set</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setProfileAgent(agent)} data-testid={`button-profile-${agent.id}`}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" data-testid={`button-menu-${agent.id}`}><MoreHorizontal className="w-4 h-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditDialog(agent)} data-testid={`menu-edit-${agent.id}`}>Edit Agent</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setProfileAgent(agent); }} data-testid={`menu-profile-${agent.id}`}>View Profile</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── RESIDUAL CALCULATOR TAB ─── */}
        <TabsContent value="calculator" className="space-y-6">
          <Card data-testid="card-residual-calculator">
            <CardHeader>
              <CardTitle>Monthly Residual Calculator</CardTitle>
              <CardDescription>
                Enter the total residual received from the processor for an agent's book. The system will split it by the agent's configured percentage and show the owner override.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...calcForm}>
                <form onSubmit={calcForm.handleSubmit((d) => runCalculator.mutate(d))} className="space-y-4 max-w-md">
                  <FormField control={calcForm.control} name="agentId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agent</FormLabel>
                      <Select onValueChange={field.onChange} value={String(field.value || "")}>
                        <FormControl><SelectTrigger data-testid="select-calc-agent"><SelectValue placeholder="Select agent" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(agents || []).map(a => (
                            <SelectItem key={a.id} value={String(a.id)} data-testid={`option-calc-agent-${a.id}`}>
                              {a.firstName} {a.lastName} ({a.commissionSplitPercent ?? 60}% split)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={calcForm.control} name="totalResidual" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Residual Received ($)</FormLabel>
                      <FormControl><Input {...field} type="number" step="0.01" min={0} placeholder="e.g. 2500.00" data-testid="input-calc-total" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={calcForm.control} name="month" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Month (optional)</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. April 2026" data-testid="input-calc-month" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={runCalculator.isPending} data-testid="button-run-calculator">
                    {runCalculator.isPending ? "Calculating..." : "Calculate Splits"}
                  </Button>
                </form>
              </Form>

              {calcResult && (
                <div className="mt-8 space-y-4" data-testid="calc-result">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Results for {calcResult.agentName}{calcResult.month ? ` — ${calcResult.month}` : ""}</h3>
                    <Button size="sm" variant="outline" onClick={() => exportAgentPayouts(calcResult)} data-testid="button-export-payout">
                      <Download className="w-4 h-4 mr-1" /> Export CSV
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="bg-muted/40">
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground">Total Residual</div>
                        <div className="text-2xl font-bold" data-testid="text-calc-total">{formatCurrency(calcResult.totalResidual)}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-primary/30 bg-primary/5">
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground">Rep Payout ({calcResult.splitPercent}%)</div>
                        <div className="text-2xl font-bold text-primary" data-testid="text-calc-rep-payout">{formatCurrency(calcResult.repPayout)}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-green-500/30 bg-green-500/5">
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground">Owner Override ({100 - calcResult.splitPercent}%)</div>
                        <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-calc-owner-override">{formatCurrency(calcResult.ownerOverride)}</div>
                      </CardContent>
                    </Card>
                  </div>

                  {calcResult.breakdown.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Merchant Breakdown</h4>
                      <Table data-testid="table-calc-breakdown">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Merchant</TableHead>
                            <TableHead className="text-right">Total Share</TableHead>
                            <TableHead className="text-right">Rep Payout</TableHead>
                            <TableHead className="text-right">Owner Override</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {calcResult.breakdown.map((b, i) => (
                            <TableRow key={i} data-testid={`row-breakdown-${b.dealId}`}>
                              <TableCell className="font-medium">{b.merchantName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(b.share)}</TableCell>
                              <TableCell className="text-right text-primary">{formatCurrency(b.repShare)}</TableCell>
                              <TableCell className="text-right text-green-700 dark:text-green-400">{formatCurrency(b.ownerShare)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold bg-muted/30">
                            <TableCell>TOTAL</TableCell>
                            <TableCell className="text-right">{formatCurrency(calcResult.totalResidual)}</TableCell>
                            <TableCell className="text-right text-primary">{formatCurrency(calcResult.repPayout)}</TableCell>
                            <TableCell className="text-right text-green-700 dark:text-green-400">{formatCurrency(calcResult.ownerOverride)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {calcResult.breakdown.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No merchants assigned to this agent yet. Assign merchants from the agent profile to get a per-merchant breakdown.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── COMP MODEL TAB ─── */}
        {isOwner && <TabsContent value="comp-model" className="space-y-4">
          <Card data-testid="card-comp-model">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" />Compensation Model Reference</CardTitle>
              <CardDescription>Owner-only view — full compensation structure, vesting, and override schedule</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4" data-testid="comp-model-structure">
                <h3 className="font-semibold text-base">How the Split Works</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">1</div>
                    <div>
                      <div className="font-medium">Processor Pays Owner</div>
                      <div className="text-muted-foreground">Payarc pays the owner 50% of the spread (net revenue after processor costs) on every merchant account in the portfolio.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">2</div>
                    <div>
                      <div className="font-medium">Owner Pays Rep (Configured Split)</div>
                      <div className="text-muted-foreground">The rep receives their configured split percentage of the owner's residual. Typical range: 60–70%. Set per agent in the Team Members tab.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-green-600/10 flex items-center justify-center text-green-700 font-bold text-xs flex-shrink-0">3</div>
                    <div>
                      <div className="font-medium">Owner Override (Remainder)</div>
                      <div className="text-muted-foreground">Owner keeps the remainder as the override. Example: at a 65% rep split, the owner retains 35% as override income — typically $0.15–$0.20 per dollar of spread, or roughly 5–10 bps on volume.</div>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h3 className="font-semibold text-base">Example Calculation</h3>
                <div className="rounded-lg border overflow-hidden text-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Line Item</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Basis</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow><TableCell>Gross Spread (processor pays owner)</TableCell><TableCell className="text-right">$1,000</TableCell><TableCell className="text-right">50% of spread</TableCell></TableRow>
                      <TableRow><TableCell className="text-primary">Rep Payout (65% split)</TableCell><TableCell className="text-right text-primary">$650</TableCell><TableCell className="text-right">65% of owner residual</TableCell></TableRow>
                      <TableRow className="font-semibold"><TableCell className="text-green-700 dark:text-green-400">Owner Override (35%)</TableCell><TableCell className="text-right text-green-700 dark:text-green-400">$350</TableCell><TableCell className="text-right">35% retained</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h3 className="font-semibold text-base flex items-center gap-2"><Info className="w-4 h-4" />Vesting & Clawback Guidelines</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-32">Vesting Period:</span>
                    <span>Residuals typically vest after the merchant processes for 90 days (3 months). Merchants lost before vesting may not trigger a payout for that month.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-32">Clawback Window:</span>
                    <span>If a merchant attrits within 6 months of activation, the rep may be subject to a full or partial clawback of commissions paid during that period.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-32">Termination:</span>
                    <span>Upon rep termination, the owner retains the residual book. No further payouts are made unless otherwise contractually agreed.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-32">Per-Agent Notes:</span>
                    <span>Agent-specific vesting and clawback terms are stored in the Notes field on each agent record. Edit an agent to update these terms.</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h3 className="font-semibold text-base">Typical Split Ranges</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="font-medium">New Rep</div>
                    <div className="text-2xl font-bold text-primary">50–60%</div>
                    <div className="text-muted-foreground">First 12 months / under 10 merchants</div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="font-medium">Experienced Rep</div>
                    <div className="text-2xl font-bold text-primary">60–70%</div>
                    <div className="text-muted-foreground">12+ months / 10–25 active merchants</div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="font-medium">Top Producer / ISO</div>
                    <div className="text-2xl font-bold text-primary">70–80%</div>
                    <div className="text-muted-foreground">25+ merchants or ISO agreement</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>

      {/* ─── AGENT PROFILE SHEET ─── */}
      <Sheet open={!!profileAgent} onOpenChange={(open) => { if (!open) setProfileAgent(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-agent-profile">
          {profileAgent && (
            <div className="space-y-6">
              <SheetHeader>
                <SheetTitle data-testid="text-profile-name">{profileAgent.firstName} {profileAgent.lastName}</SheetTitle>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">{roleBadgeLabel(profileAgent.role || "sales_rep")}</Badge>
                  <Badge variant={profileAgent.status === "active" ? "default" : "outline"}>{profileAgent.status || "active"}</Badge>
                  <span className="text-sm text-muted-foreground">{profileAgent.email}</span>
                </div>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><div className="text-muted-foreground">Split %</div><div className="font-semibold text-primary text-lg" data-testid="text-profile-split">{profileAgent.commissionSplitPercent ?? 60}%</div></div>
                <div><div className="text-muted-foreground">Owner Override</div><div className="font-semibold text-green-700 dark:text-green-400 text-lg" data-testid="text-profile-override">{100 - (profileAgent.commissionSplitPercent ?? 60)}%</div></div>
                <div><div className="text-muted-foreground">Territory</div><div className="font-medium">{profileAgent.territory || "—"}</div></div>
                <div><div className="text-muted-foreground">Total Deals</div><div className="font-medium">{profileAgent.totalDeals || 0}</div></div>
                <div><div className="text-muted-foreground">Revenue Managed</div><div className="font-medium">{formatCurrency(profileAgent.totalRevenue)}</div></div>
                <div><div className="text-muted-foreground">Vesting Period</div><div className="font-medium">{profileAgent.vestingMonths ?? 3} months</div></div>
                {profileAgent.hireDate && <div><div className="text-muted-foreground">Start Date</div><div className="font-medium">{new Date(profileAgent.hireDate).toLocaleDateString()}</div></div>}
                {profileAgent.phone && <div><div className="text-muted-foreground">Phone</div><div className="font-medium">{profileAgent.phone}</div></div>}
              </div>

              {/* Monthly Residual Summary */}
              {profileResiduals && profileResiduals.length > 0 && (() => {
                const totalMonthlyNet = profileResiduals.reduce((s, r) => s + parseFloat(r.netRevenue || "0"), 0);
                const totalCommission = profileResiduals.reduce((s, r) => s + parseFloat(r.agentCommission || "0"), 0);
                const ownerOverride = totalMonthlyNet - totalCommission;
                return (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30" data-testid="profile-residual-summary">
                    <div className="text-sm font-medium">Monthly Residual Summary</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><div className="text-muted-foreground">Net Revenue</div><div className="font-semibold">{formatCurrency(totalMonthlyNet)}</div></div>
                      <div><div className="text-muted-foreground">Rep Payout</div><div className="font-semibold text-primary">{formatCurrency(totalCommission)}</div></div>
                      <div><div className="text-muted-foreground">Owner Override</div><div className="font-semibold text-green-700 dark:text-green-400">{formatCurrency(ownerOverride)}</div></div>
                    </div>
                    <div className="text-xs text-muted-foreground">{profileResiduals.length} merchant{profileResiduals.length !== 1 ? "s" : ""} · Based on residual data on file</div>
                  </div>
                );
              })()}

              {profileAgent.notes && (
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Notes / Vesting / Clawback</div>
                  <div className="text-sm p-3 rounded-lg bg-muted/40 whitespace-pre-wrap" data-testid="text-profile-notes">{profileAgent.notes}</div>
                </div>
              )}

              <Separator />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Assigned Merchants</h3>
                  <span className="text-sm text-muted-foreground" data-testid="text-merchant-count">{(profileMerchants || []).length} merchant{(profileMerchants || []).length !== 1 ? "s" : ""}</span>
                </div>

                <Form {...assignForm}>
                  <form onSubmit={assignForm.handleSubmit((d) => assignMerchant.mutate(d))} className="flex gap-2 mb-4">
                    <FormField control={assignForm.control} name="dealId" render={({ field }) => (
                      <FormItem className="flex-1">
                        <Select onValueChange={field.onChange} value={String(field.value || "")}>
                          <FormControl><SelectTrigger data-testid="select-assign-merchant"><SelectValue placeholder="Select deal/merchant..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            {(allDeals?.data || []).map(d => (
                              <SelectItem key={d.id} value={String(d.id)} data-testid={`option-deal-${d.id}`}>
                                Deal #{d.id}{d.stage ? ` · ${d.stage}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={assignForm.control} name="merchantName" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input {...field} placeholder="Merchant name (optional)" data-testid="input-merchant-name" /></FormControl>
                      </FormItem>
                    )} />
                    <Button type="submit" size="sm" disabled={assignMerchant.isPending} data-testid="button-assign-merchant">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </form>
                </Form>

                {profileMerchantsLoading ? (
                  <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (profileMerchants || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-merchants">No merchants assigned yet.</p>
                ) : (
                  <div className="space-y-2" data-testid="list-assigned-merchants">
                    {(profileMerchants || []).map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border bg-card" data-testid={`item-merchant-${m.id}`}>
                        <div>
                          <div className="font-medium text-sm">{m.merchantName || `Merchant #${m.dealId}`}</div>
                          <div className="text-xs text-muted-foreground">Deal #{m.dealId} · Assigned {m.assignedAt ? new Date(m.assignedAt).toLocaleDateString() : "—"}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => unassignMerchant.mutate(m.id)}
                          disabled={unassignMerchant.isPending}
                          data-testid={`button-unassign-${m.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
