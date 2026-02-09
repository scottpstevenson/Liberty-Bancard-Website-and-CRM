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

const OUTCOMES = [
  "Connected - Send Review Summary",
  "Connected - Needs Proposal",
  "Connected - Not a Fit",
  "No Show",
  "Not Now (Nurture)",
  "Closed Won",
  "Closed Lost",
] as const;

const OUTCOME_TO_STAGE: Record<string, string> = {
  "Connected - Send Review Summary": "Review In Progress",
  "Connected - Needs Proposal": "Proposal Sent",
  "Connected - Not a Fit": "Closed Lost",
  "No Show": "Negotiation / Follow-Up",
  "Not Now (Nurture)": "Nurture / Not Now",
  "Closed Won": "Closed Won",
  "Closed Lost": "Closed Lost",
};

const formSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  dealId: z.string().min(1, "Deal is required"),
  outcome: z.string().min(1, "Outcome is required"),
  notes: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  interestedIn0Percent: z.boolean().default(false),
  needsTerminal: z.boolean().default(false),
  sendPacketNow: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

export default function CallOutcome() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: "",
      dealId: "",
      outcome: "",
      notes: "",
      nextFollowUpDate: "",
      interestedIn0Percent: false,
      needsTerminal: false,
      sendPacketNow: false,
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
      const newStage = OUTCOME_TO_STAGE[values.outcome];

      await apiRequest("PUT", `/api/deals/${dealId}`, {
        stage: newStage,
        notes: values.notes || undefined,
        nextFollowUp: values.nextFollowUpDate
          ? new Date(values.nextFollowUpDate).toISOString()
          : undefined,
      });

      if (values.nextFollowUpDate) {
        await apiRequest("POST", "/api/tasks", {
          dealId,
          contactId: Number(values.contactId),
          title: `Follow up - ${values.outcome}`,
          dueDate: new Date(values.nextFollowUpDate).toISOString(),
          priority: "normal",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Call outcome recorded", description: "Deal stage updated successfully." });
      form.reset();
      setSelectedContactId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save call outcome", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` - ${c.companyName}` : ""}`;

  if (contactsLoading || dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="calloutcome-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="calloutcome-page">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-calloutcome-title">LB - Sales Call Outcome</CardTitle>
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
                name="outcome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outcome</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-outcome">
                          <SelectValue placeholder="Select outcome" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {OUTCOMES.map((o) => (
                          <SelectItem key={o} value={o} data-testid={`select-outcome-${o.replace(/\s+/g, "-").toLowerCase()}`}>
                            {o}
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
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Call notes..." data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nextFollowUpDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next Follow-Up Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-follow-up-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="interestedIn0Percent"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-interested-0-percent"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Interested in 0%?</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="needsTerminal"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-needs-terminal"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Needs Terminal?</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sendPacketNow"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-send-packet"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Send Packet Now?</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full"
                data-testid="button-submit-call-outcome"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {submitMutation.isPending ? "Saving..." : "Submit Call Outcome"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
