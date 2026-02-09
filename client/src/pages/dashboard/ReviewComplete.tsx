import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import type { Contact, Deal } from "@shared/schema";

const RECOMMENDED_PATHS = [
  "Wholesale",
  "0% Program (where permitted)",
  "Keep Setup (No Change)",
] as const;

const TERMINAL_OPTIONS = [
  "Needs terminal",
  "Existing ok",
  "Not sure",
] as const;

const formSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  dealId: z.string().min(1, "Deal is required"),
  effectiveRate: z.string().min(1, "Effective rate is required"),
  totalVolume: z.string().min(1, "Total volume is required"),
  totalFees: z.string().min(1, "Total fees is required"),
  costDriver1: z.string().optional(),
  costDriver2: z.string().optional(),
  costDriver3: z.string().optional(),
  recommendedPath: z.string().min(1, "Recommended path is required"),
  optionASummary: z.string().optional(),
  optionBSummary: z.string().optional(),
  terminalRecommendation: z.string().min(1, "Terminal recommendation is required"),
  fundingNotes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ReviewComplete() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: "",
      dealId: "",
      effectiveRate: "",
      totalVolume: "",
      totalFees: "",
      costDriver1: "",
      costDriver2: "",
      costDriver3: "",
      recommendedPath: "",
      optionASummary: "",
      optionBSummary: "",
      terminalRecommendation: "",
      fundingNotes: "",
    },
  });

  const { data: contacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const contactDeals = deals?.filter(
    (d) => d.contactId === Number(selectedContactId)
  ) || [];

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const dealId = Number(values.dealId);
      const topCostDrivers = [values.costDriver1, values.costDriver2, values.costDriver3].filter(Boolean);

      await apiRequest("PUT", `/api/deals/${dealId}`, {
        stage: "Proposal Sent",
        effectiveRate: values.effectiveRate,
        totalVolume: values.totalVolume,
        totalFees: values.totalFees,
        topCostDrivers,
        recommendedPath: values.recommendedPath,
        terminalRecommendation: values.terminalRecommendation,
        fundingNotes: values.fundingNotes || undefined,
        notes: [values.optionASummary ? `Option A: ${values.optionASummary}` : "", values.optionBSummary ? `Option B: ${values.optionBSummary}` : ""].filter(Boolean).join("\n"),
      });

      await apiRequest("POST", "/api/tasks", {
        dealId,
        contactId: Number(values.contactId),
        title: "Call / follow up to present options",
        priority: "high",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Review complete", description: "Deal updated to Proposal Sent. Follow-up task created." });
      form.reset();
      setSelectedContactId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save review", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` - ${c.companyName}` : ""}`;

  if (contactsLoading || dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="reviewcomplete-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="reviewcomplete-page">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-reviewcomplete-title">LB - Statement Review Complete</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        setSelectedContactId(v);
                        form.setValue("dealId", "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} data-testid={`select-contact-${c.id}`}>
                            {getContactLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dealId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deal</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!selectedContactId}>
                      <FormControl>
                        <SelectTrigger data-testid="select-deal">
                          <SelectValue placeholder={selectedContactId ? "Select a deal" : "Select a contact first"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contactDeals.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} data-testid={`select-deal-${d.id}`}>
                            Deal #{d.id} - {d.stage} ({d.pipeline})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="effectiveRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective Rate %</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} placeholder="e.g. 3.25" data-testid="input-effective-rate" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalVolume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Volume</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} placeholder="e.g. 50000" data-testid="input-total-volume" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalFees"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Fees</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} placeholder="e.g. 1500" data-testid="input-total-fees" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="costDriver1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top Cost Driver #1</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. High interchange markup" data-testid="input-cost-driver-1" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="costDriver2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top Cost Driver #2</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Non-qualified surcharges" data-testid="input-cost-driver-2" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="costDriver3"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top Cost Driver #3</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Monthly fees" data-testid="input-cost-driver-3" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="recommendedPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recommended Path</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-recommended-path">
                          <SelectValue placeholder="Select recommended path" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RECOMMENDED_PATHS.map((p) => (
                          <SelectItem key={p} value={p} data-testid={`select-path-${p.replace(/\s+/g, "-").toLowerCase()}`}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="optionASummary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Option A Summary</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe Option A..." data-testid="input-option-a" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="optionBSummary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Option B Summary</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe Option B..." data-testid="input-option-b" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="terminalRecommendation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terminal Recommendation</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-terminal-recommendation">
                          <SelectValue placeholder="Select terminal recommendation" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TERMINAL_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t} data-testid={`select-terminal-${t.replace(/\s+/g, "-").toLowerCase()}`}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fundingNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Funding Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Funding preferences or notes..." data-testid="input-funding-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full"
                data-testid="button-submit-review"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {submitMutation.isPending ? "Saving..." : "Submit Review"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
