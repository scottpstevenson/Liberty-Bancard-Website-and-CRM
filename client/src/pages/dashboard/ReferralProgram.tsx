import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Users, Handshake, DollarSign, Award, Plus } from "lucide-react";
import type { Partner, Referral } from "@shared/schema";
import { PARTNER_TYPES, REFERRAL_STATUSES } from "@shared/schema";

const partnerFormSchema = z.object({
  companyName: z.string().min(1, "Required"),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  partnerType: z.string().min(1, "Required"),
  commissionPercent: z.coerce.number().min(0).max(100).default(10),
  notes: z.string().optional(),
});

const referralFormSchema = z.object({
  partnerId: z.coerce.number().min(1, "Select a partner"),
  referredName: z.string().optional(),
  referredEmail: z.string().email().optional().or(z.literal("")),
  referredPhone: z.string().optional(),
  referredCompany: z.string().optional(),
  incentiveType: z.string().optional(),
  incentiveAmount: z.string().optional(),
  notes: z.string().optional(),
});

type PartnerFormData = z.infer<typeof partnerFormSchema>;
type ReferralFormData = z.infer<typeof referralFormSchema>;

function KpiCard({ icon: Icon, label, value, testId }: { icon: typeof Users; label: string; value: string | number; testId: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
          <span className="text-2xl font-bold" data-testid={testId}>{value}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function partnerTypeBadgeVariant(type: string): "default" | "secondary" | "outline" {
  switch (type) {
    case "iso_agent": return "default";
    case "bank_partner": return "secondary";
    case "strategic": return "default";
    default: return "outline";
  }
}

function referralStatusColor(status: string): string {
  switch (status) {
    case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "contacted": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "qualified": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    case "converted": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "lost": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "paid": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function formatPartnerType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ReferralProgram() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"partners" | "referrals">("partners");
  const [isPartnerDialogOpen, setIsPartnerDialogOpen] = useState(false);
  const [isReferralDialogOpen, setIsReferralDialogOpen] = useState(false);

  const { data: partners = [], isLoading: loadingPartners } = useQuery<Partner[]>({
    queryKey: ["/api/partners"],
  });

  const { data: referrals = [], isLoading: loadingReferrals } = useQuery<Referral[]>({
    queryKey: ["/api/referrals"],
  });

  const createPartner = useMutation({
    mutationFn: async (data: PartnerFormData) => {
      const res = await apiRequest("POST", "/api/partners", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partners"] });
      toast({ title: "Partner created" });
      setIsPartnerDialogOpen(false);
      partnerForm.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createReferral = useMutation({
    mutationFn: async (data: ReferralFormData) => {
      const res = await apiRequest("POST", "/api/referrals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partners"] });
      toast({ title: "Referral created" });
      setIsReferralDialogOpen(false);
      referralForm.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const partnerForm = useForm<PartnerFormData>({
    resolver: zodResolver(partnerFormSchema),
    defaultValues: {
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      partnerType: "referral",
      commissionPercent: 10,
      notes: "",
    },
  });

  const referralForm = useForm<ReferralFormData>({
    resolver: zodResolver(referralFormSchema),
    defaultValues: {
      partnerId: 0,
      referredName: "",
      referredEmail: "",
      referredPhone: "",
      referredCompany: "",
      incentiveType: "commission",
      incentiveAmount: "",
      notes: "",
    },
  });

  const totalPartners = partners.length;
  const activeReferrals = referrals.filter((r) => r.status !== "lost" && r.status !== "paid").length;
  const totalConverted = referrals.filter((r) => r.status === "converted" || r.status === "paid").length;
  const conversionRate = referrals.length > 0 ? Math.round((totalConverted / referrals.length) * 100) : 0;
  const totalPayouts = partners.reduce((sum, p) => sum + parseFloat(p.totalPayouts || "0"), 0);

  const getPartnerName = (partnerId: number | null) => {
    if (!partnerId) return "—";
    const p = partners.find((partner) => partner.id === partnerId);
    return p ? p.companyName : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Referral & Partner Program</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={isPartnerDialogOpen} onOpenChange={setIsPartnerDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="button-add-partner">
                <Plus className="w-4 h-4" /> Add Partner
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Partner</DialogTitle>
              </DialogHeader>
              <Form {...partnerForm}>
                <form onSubmit={partnerForm.handleSubmit((d) => createPartner.mutate(d))} className="space-y-4">
                  <FormField control={partnerForm.control} name="companyName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-partner-company" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={partnerForm.control} name="contactName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl><Input {...field} data-testid="input-partner-contact" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={partnerForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input {...field} type="email" data-testid="input-partner-email" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={partnerForm.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl><Input {...field} data-testid="input-partner-phone" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={partnerForm.control} name="partnerType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Partner Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-partner-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PARTNER_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>{formatPartnerType(t)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={partnerForm.control} name="commissionPercent" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission %</FormLabel>
                      <FormControl><Input {...field} type="number" min={0} max={100} data-testid="input-partner-commission" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={partnerForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Textarea {...field} className="resize-none" data-testid="input-partner-notes" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={createPartner.isPending} data-testid="button-submit-partner">
                      {createPartner.isPending ? "Creating..." : "Create Partner"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Users} label="Total Partners" value={loadingPartners ? "..." : totalPartners} testId="kpi-total-partners" />
        <KpiCard icon={Handshake} label="Active Referrals" value={loadingReferrals ? "..." : activeReferrals} testId="kpi-active-referrals" />
        <KpiCard icon={Award} label="Conversion Rate" value={loadingReferrals ? "..." : `${conversionRate}%`} testId="kpi-conversion-rate" />
        <KpiCard icon={DollarSign} label="Total Payouts" value={loadingPartners ? "..." : `$${totalPayouts.toLocaleString()}`} testId="kpi-total-payouts" />
      </div>

      <div className="flex gap-2">
        <Button
          variant={activeTab === "partners" ? "default" : "outline"}
          onClick={() => setActiveTab("partners")}
          data-testid="tab-partners"
        >
          Partners
        </Button>
        <Button
          variant={activeTab === "referrals" ? "default" : "outline"}
          onClick={() => setActiveTab("referrals")}
          data-testid="tab-referrals"
        >
          Referrals
        </Button>
      </div>

      {activeTab === "partners" && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Partner Type</TableHead>
                  <TableHead>Commission %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Referrals</TableHead>
                  <TableHead>Conversions</TableHead>
                  <TableHead>Total Payouts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPartners ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center h-24">
                      <div className="flex items-center justify-center gap-2">
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : partners.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center h-24 text-muted-foreground" data-testid="text-no-partners">
                      No partners yet
                    </TableCell>
                  </TableRow>
                ) : (
                  partners.map((partner) => (
                    <TableRow key={partner.id} data-testid={`row-partner-${partner.id}`}>
                      <TableCell className="font-medium" data-testid={`text-partner-company-${partner.id}`}>{partner.companyName}</TableCell>
                      <TableCell>{partner.contactName || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{partner.email || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{partner.phone || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={partnerTypeBadgeVariant(partner.partnerType || "referral")} data-testid={`badge-partner-type-${partner.id}`}>
                          {formatPartnerType(partner.partnerType || "referral")}
                        </Badge>
                      </TableCell>
                      <TableCell>{partner.commissionPercent ?? 0}%</TableCell>
                      <TableCell>
                        <Badge variant={partner.status === "active" ? "default" : "secondary"} data-testid={`badge-partner-status-${partner.id}`}>
                          {partner.status || "active"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-partner-referrals-${partner.id}`}>{partner.totalReferrals ?? 0}</TableCell>
                      <TableCell data-testid={`text-partner-conversions-${partner.id}`}>{partner.totalConversions ?? 0}</TableCell>
                      <TableCell data-testid={`text-partner-payouts-${partner.id}`}>${parseFloat(partner.totalPayouts || "0").toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === "referrals" && (
        <>
          <div className="flex justify-end">
            <Dialog open={isReferralDialogOpen} onOpenChange={setIsReferralDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="button-add-referral">
                  <Plus className="w-4 h-4" /> Add Referral
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Referral</DialogTitle>
                </DialogHeader>
                <Form {...referralForm}>
                  <form onSubmit={referralForm.handleSubmit((d) => createReferral.mutate(d))} className="space-y-4">
                    <FormField control={referralForm.control} name="partnerId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Partner</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={String(field.value)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-referral-partner">
                              <SelectValue placeholder="Select partner" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {partners.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>{p.companyName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={referralForm.control} name="referredName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referred Name</FormLabel>
                          <FormControl><Input {...field} data-testid="input-referral-name" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={referralForm.control} name="referredEmail" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input {...field} type="email" data-testid="input-referral-email" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={referralForm.control} name="referredPhone" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl><Input {...field} data-testid="input-referral-phone" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={referralForm.control} name="referredCompany" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl><Input {...field} data-testid="input-referral-company" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={referralForm.control} name="incentiveType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Incentive Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-incentive-type">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="commission">Commission</SelectItem>
                              <SelectItem value="flat_fee">Flat Fee</SelectItem>
                              <SelectItem value="bonus">Bonus</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={referralForm.control} name="incentiveAmount" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Incentive Amount</FormLabel>
                          <FormControl><Input {...field} data-testid="input-referral-incentive" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={referralForm.control} name="notes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl><Textarea {...field} className="resize-none" data-testid="input-referral-notes" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="flex justify-end pt-4">
                      <Button type="submit" disabled={createReferral.isPending} data-testid="button-submit-referral">
                        {createReferral.isPending ? "Creating..." : "Create Referral"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Referred Company</TableHead>
                    <TableHead>Referred Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Incentive</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingReferrals ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24">
                        <div className="flex items-center justify-center gap-2">
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : referrals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24 text-muted-foreground" data-testid="text-no-referrals">
                        No referrals yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    referrals.map((referral) => (
                      <TableRow key={referral.id} data-testid={`row-referral-${referral.id}`}>
                        <TableCell className="font-medium" data-testid={`text-referral-company-${referral.id}`}>{referral.referredCompany || "—"}</TableCell>
                        <TableCell>{referral.referredName || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{referral.referredEmail || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{referral.referredPhone || "—"}</TableCell>
                        <TableCell>{getPartnerName(referral.partnerId)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${referralStatusColor(referral.status || "pending")}`} data-testid={`badge-referral-status-${referral.id}`}>
                            {referral.status || "pending"}
                          </span>
                        </TableCell>
                        <TableCell data-testid={`text-referral-incentive-${referral.id}`}>
                          {referral.incentiveAmount ? `$${parseFloat(referral.incentiveAmount).toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {referral.createdAt ? new Date(referral.createdAt).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
