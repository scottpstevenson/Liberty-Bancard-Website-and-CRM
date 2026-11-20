import { IntakeRecordActions } from "@/components/intake/IntakeRecordActions";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import type { Referral } from "@shared/schema";
import type { PartnerOperatorRecord as Partner } from "@shared/partner-response";
const referralFormSchema = z.object({
  partnerId: z.coerce.number<string | number>().min(1, "Select a partner"),
  referredName: z.string().optional(),
  referredEmail: z.string().email().optional().or(z.literal("")),
  referredPhone: z.string().optional(),
  referredCompany: z.string().optional(),
  incentiveType: z.string().optional(),
  incentiveAmount: z.string().optional(),
  notes: z.string().optional(),
});

type ReferralFormData = z.infer<typeof referralFormSchema>;
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

export function MerchantReferralsPanel() {
  const { toast } = useToast();
  const [isReferralDialogOpen, setIsReferralDialogOpen] = useState(false);
  const partnerQuery = useCrmQuery<Partner[]>({ queryKey: ["/api/partners"] });
  const referralQuery = useCrmQuery<Referral[]>({ queryKey: ["/api/referrals"] });
  const partners = partnerQuery.data ?? [];
  const referrals = referralQuery.data ?? [];
  const loadingReferrals = referralQuery.isLoading || partnerQuery.isLoading;
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

  const referralForm = useForm<z.input<typeof referralFormSchema>, unknown, ReferralFormData>({
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

  const getPartnerName = (partnerId: number | null) => {
    if (!partnerId) return "—";
    const p = partners.find((partner) => partner.id === partnerId);
    return p ? p.companyName : "—";
  };
  if (referralQuery.isError || partnerQuery.isError) return <CrmDataState state="unavailable" message="Merchant referrals could not be loaded." onRetry={() => { void referralQuery.refetch(); void partnerQuery.refetch(); }} />;
  return (
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
                          <div className="mt-2"><IntakeRecordActions kind="referrals" id={String(referral.id)} /></div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>

  );
}
