import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Users, Award, DollarSign, Search, MoreHorizontal, Target, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/export-csv";
import type { Agent, AgentQuota } from "@shared/schema";

const agentFormSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  role: z.string().min(1, "Required"),
  commissionSplitPercent: z.coerce.number().min(0).max(100),
  territory: z.string().optional(),
  status: z.string().min(1, "Required"),
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

function formatCurrency(value: string | number | null | undefined): string {
  const num = parseFloat(String(value || "0"));
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(num);
}

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function AgentManagement() {
  const { data: agents, isLoading } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: quotas } = useQuery<AgentQuota[]>({ queryKey: ["/api/agent-quotas"] });
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isQuotaDialogOpen, setIsQuotaDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const { toast } = useToast();

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      role: "sales_rep",
      commissionSplitPercent: 50,
      territory: "",
      status: "active",
    },
  });

  const quotaForm = useForm<QuotaFormData>({
    resolver: zodResolver(quotaFormSchema),
    defaultValues: {
      agentId: 0,
      period: "",
      periodStart: "",
      periodEnd: "",
      targetDeals: 0,
      targetRevenue: "0",
    },
  });

  const createAgent = useMutation({
    mutationFn: async (data: AgentFormData) => {
      const res = await apiRequest("POST", "/api/agents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Agent created" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Failed to create agent", variant: "destructive" });
    },
  });

  const updateAgent = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<AgentFormData> }) => {
      const res = await apiRequest("PATCH", `/api/agents/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Agent updated" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Failed to update agent", variant: "destructive" });
    },
  });

  const createQuota = useMutation({
    mutationFn: async (data: QuotaFormData) => {
      const res = await apiRequest("POST", "/api/agent-quotas", {
        ...data,
        periodStart: new Date(data.periodStart).toISOString(),
        periodEnd: new Date(data.periodEnd).toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-quotas"] });
      toast({ title: "Quota created" });
      setIsQuotaDialogOpen(false);
      quotaForm.reset({ agentId: 0, period: "", periodStart: "", periodEnd: "", targetDeals: 0, targetRevenue: "0" });
    },
    onError: () => {
      toast({ title: "Failed to create quota", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAgent(null);
    form.reset({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      role: "sales_rep",
      commissionSplitPercent: 50,
      territory: "",
      status: "active",
    });
  };

  const openEditDialog = (agent: Agent) => {
    setEditingAgent(agent);
    form.reset({
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      phone: agent.phone || "",
      role: agent.role || "sales_rep",
      commissionSplitPercent: agent.commissionSplitPercent ?? 50,
      territory: agent.territory || "",
      status: agent.status || "active",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AgentFormData) => {
    if (editingAgent) {
      await updateAgent.mutateAsync({ id: editingAgent.id, data });
    } else {
      await createAgent.mutateAsync(data);
    }
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

  const isPending = createAgent.isPending || updateAgent.isPending;

  const getAgentQuota = (agentId: number): AgentQuota | undefined => {
    return quotas?.find(q => q.agentId === agentId);
  };

  const getQuotaAttainment = (agentId: number): number | null => {
    const quota = getAgentQuota(agentId);
    if (!quota || !quota.targetDeals || quota.targetDeals === 0) return null;
    return Math.round(((quota.actualDeals || 0) / quota.targetDeals) * 100);
  };

  return (
    <div className="space-y-6">
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
              }));
              exportToCSV(exportData, "agents", [
                { key: "name", label: "Name" },
                { key: "email", label: "Email" },
                { key: "role", label: "Role" },
                { key: "territory", label: "Territory" },
                { key: "status", label: "Status" },
                { key: "commissionPercent", label: "Commission %" },
                { key: "totalDeals", label: "Total Deals" },
                { key: "totalRevenue", label: "Total Revenue" },
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
              <DialogHeader>
                <DialogTitle>Add Agent Quota</DialogTitle>
              </DialogHeader>
              <Form {...quotaForm}>
                <form onSubmit={quotaForm.handleSubmit((data) => createQuota.mutate(data))} className="space-y-4">
                  <FormField
                    control={quotaForm.control}
                    name="agentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agent</FormLabel>
                        <Select onValueChange={field.onChange} value={String(field.value || "")}>
                          <FormControl>
                            <SelectTrigger data-testid="select-quota-agent">
                              <SelectValue placeholder="Select agent" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {agents?.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={quotaForm.control}
                    name="period"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Period</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. Q1 2026" data-testid="input-quota-period" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={quotaForm.control}
                      name="periodStart"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Period Start</FormLabel>
                          <FormControl><Input {...field} type="date" data-testid="input-quota-start" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={quotaForm.control}
                      name="periodEnd"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Period End</FormLabel>
                          <FormControl><Input {...field} type="date" data-testid="input-quota-end" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={quotaForm.control}
                      name="targetDeals"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Deals</FormLabel>
                          <FormControl><Input {...field} type="number" min={0} data-testid="input-quota-target-deals" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={quotaForm.control}
                      name="targetRevenue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Revenue</FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. 50000" data-testid="input-quota-target-revenue" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingAgent ? "Edit Agent" : "Add New Agent"}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl><Input {...field} data-testid="input-first-name" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl><Input {...field} data-testid="input-last-name" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input {...field} type="email" data-testid="input-email" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl><Input {...field} data-testid="input-phone" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-role">
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="sales_rep">Sales Rep</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="iso_agent">ISO Agent</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="commissionSplitPercent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Commission Split %</FormLabel>
                          <FormControl><Input {...field} type="number" min={0} max={100} data-testid="input-commission" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="territory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Territory</FormLabel>
                        <FormControl><Input {...field} data-testid="input-territory" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isPending} data-testid="button-save-agent">
                      {isPending ? "Saving..." : editingAgent ? "Update Agent" : "Create Agent"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Territory</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Deals</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Quota %</TableHead>
                <TableHead>Hire Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center h-24">Loading...</TableCell>
                </TableRow>
              ) : filteredAgents?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center h-24 text-muted-foreground">No agents found</TableCell>
                </TableRow>
              ) : (
                filteredAgents?.map((agent) => {
                  const attainment = getQuotaAttainment(agent.id);
                  return (
                    <TableRow key={agent.id} data-testid={`agent-row-${agent.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {agent.firstName[0]}{agent.lastName[0]}
                          </div>
                          <span data-testid={`text-agent-name-${agent.id}`}>{agent.firstName} {agent.lastName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" data-testid={`text-agent-email-${agent.id}`}>{agent.email}</TableCell>
                      <TableCell className="text-muted-foreground text-sm" data-testid={`text-agent-phone-${agent.id}`}>{agent.phone || "N/A"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-agent-role-${agent.id}`}>
                          {roleBadgeLabel(agent.role || "sales_rep")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-agent-territory-${agent.id}`}>{agent.territory || "N/A"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={agent.status === "active" ? "default" : "destructive"}
                          className={agent.status === "active" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 no-default-hover-elevate no-default-active-elevate" : ""}
                          data-testid={`badge-agent-status-${agent.id}`}
                        >
                          {agent.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-agent-commission-${agent.id}`}>{agent.commissionSplitPercent ?? 0}%</TableCell>
                      <TableCell data-testid={`text-agent-deals-${agent.id}`}>{agent.totalDeals || 0}</TableCell>
                      <TableCell data-testid={`text-agent-revenue-${agent.id}`}>{formatCurrency(agent.totalRevenue)}</TableCell>
                      <TableCell data-testid={`text-agent-quota-${agent.id}`}>
                        {attainment !== null ? (
                          <Badge
                            variant="secondary"
                            className={`text-xs no-default-hover-elevate no-default-active-elevate ${attainment >= 100 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : attainment >= 50 ? "" : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"}`}
                          >
                            {attainment}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-agent-hire-date-${agent.id}`}>{formatDate(agent.hireDate)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-actions-${agent.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(agent)} data-testid={`button-edit-${agent.id}`}>
                              Edit Agent
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updateAgent.mutate({ id: agent.id, data: { status: agent.status === "active" ? "inactive" : "active" } })}
                              data-testid={`button-toggle-status-${agent.id}`}
                            >
                              {agent.status === "active" ? "Deactivate" : "Activate"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {quotas && quotas.length > 0 && (
        <Card data-testid="card-quota-tracking">
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Agent Quota Tracking</CardTitle>
            <Target className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {quotas.map((quota) => {
                const agent = agents?.find(a => a.id === quota.agentId);
                if (!agent) return null;
                return (
                  <Card key={quota.id} data-testid={`card-quota-${quota.id}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle className="text-sm font-medium">{agent.firstName} {agent.lastName}</CardTitle>
                        <Badge variant="outline" className="text-xs">{quota.period}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(quota.periodStart)} - {formatDate(quota.periodEnd)}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ProgressBar
                        value={quota.actualDeals || 0}
                        max={quota.targetDeals || 0}
                        label="Deals"
                      />
                      <ProgressBar
                        value={parseFloat(quota.actualRevenue || "0")}
                        max={parseFloat(quota.targetRevenue || "0")}
                        label="Revenue"
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
