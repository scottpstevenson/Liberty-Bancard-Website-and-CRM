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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import type { Contact, Deal } from "@shared/schema";

const UNDERWRITING_DOCS = [
  "Business License",
  "Bank Statement",
  "Processing Statement",
  "Voided Check",
  "Government ID",
] as const;

const formSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  dealId: z.string().min(1, "Deal is required"),
  terminalNeeded: z.string().min(1, "Terminal selection is required"),
  goLiveDate: z.string().min(1, "Go-live target date is required"),
  fundingNotes: z.string().optional(),
  underwritingDocs: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof formSchema>;

export default function OnboardingKickoff() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: "",
      dealId: "",
      terminalNeeded: "",
      goLiveDate: "",
      fundingNotes: "",
      underwritingDocs: [],
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
      const contactId = Number(values.contactId);
      const needsTerminal = values.terminalNeeded === "yes";

      const newDeal = await apiRequest("POST", "/api/deals", {
        contactId,
        pipeline: "onboarding",
        stage: "Contract Sent",
        goLiveDate: new Date(values.goLiveDate).toISOString(),
        fundingNotes: values.fundingNotes || undefined,
        terminalRecommendation: needsTerminal ? "Needs terminal" : "Existing ok",
        notes: values.underwritingDocs.length
          ? `Underwriting docs checklist: ${values.underwritingDocs.join(", ")}`
          : undefined,
      });
      const dealData = await newDeal.json();
      const newDealId = dealData.id;

      await apiRequest("POST", "/api/tasks", {
        dealId: newDealId,
        contactId,
        title: "Collect underwriting docs",
        priority: "high",
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (needsTerminal) {
        await apiRequest("POST", "/api/tasks", {
          dealId: newDealId,
          contactId,
          title: "Order terminal",
          priority: "normal",
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      await apiRequest("POST", "/api/tasks", {
        dealId: newDealId,
        contactId,
        title: "Schedule go-live",
        priority: "normal",
        dueDate: new Date(values.goLiveDate).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Onboarding started", description: "New onboarding deal and tasks created successfully." });
      form.reset();
      setSelectedContactId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start onboarding", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` - ${c.companyName}` : ""}`;

  if (contactsLoading || dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="onboardingkickoff-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="onboardingkickoff-page">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-onboardingkickoff-title">LB - Onboarding Kickoff</CardTitle>
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

              <FormField
                control={form.control}
                name="terminalNeeded"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terminal needed?</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-terminal-needed">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="yes" data-testid="select-terminal-yes">Yes</SelectItem>
                        <SelectItem value="no" data-testid="select-terminal-no">No</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="goLiveDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Go-live target date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-go-live-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fundingNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Funding preference notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Funding preferences..." data-testid="input-funding-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="underwritingDocs"
                render={() => (
                  <FormItem>
                    <FormLabel>Underwriting docs checklist</FormLabel>
                    <div className="space-y-3 pt-1">
                      {UNDERWRITING_DOCS.map((doc) => (
                        <FormField
                          key={doc}
                          control={form.control}
                          name="underwritingDocs"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center gap-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(doc)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value || [];
                                    if (checked) {
                                      field.onChange([...current, doc]);
                                    } else {
                                      field.onChange(current.filter((v) => v !== doc));
                                    }
                                  }}
                                  data-testid={`checkbox-doc-${doc.replace(/\s+/g, "-").toLowerCase()}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">{doc}</FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full"
                data-testid="button-submit-onboarding"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {submitMutation.isPending ? "Starting..." : "Start Onboarding"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
