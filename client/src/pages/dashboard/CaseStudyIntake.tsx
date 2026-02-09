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
import { Loader2, FileText } from "lucide-react";
import type { Contact, Deal } from "@shared/schema";

const formSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  dealId: z.string().min(1, "Deal is required"),
  businessVertical: z.string().min(1, "Business vertical is required"),
  monthlyVolume: z.string().min(1, "Monthly volume is required"),
  highlights: z.string().min(1, "Highlights are required"),
  permissionObtained: z.boolean().default(false),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function CaseStudyIntake() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: "",
      dealId: "",
      businessVertical: "",
      monthlyVolume: "",
      highlights: "",
      permissionObtained: false,
      notes: "",
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
      const dealId = Number(values.dealId);

      const taskRes = await apiRequest("POST", "/api/tasks", {
        dealId,
        contactId,
        title: "Produce case study draft",
        description: `Vertical: ${values.businessVertical}\nMonthly Volume: ${values.monthlyVolume}\nHighlights: ${values.highlights}\nPermission: ${values.permissionObtained ? "Yes" : "No"}\nNotes: ${values.notes || "N/A"}`,
        priority: "normal",
      });

      await apiRequest("POST", "/api/notifications", {
        channel: "in_app",
        title: "Case Study Intake Submitted",
        message: `New case study intake for Deal #${dealId} - ${values.businessVertical}`,
        type: "info",
      });

      await apiRequest("POST", "/api/audit-logs", {
        action: "case_study_intake_submitted",
        entityType: "deal",
        entityId: dealId,
        details: {
          contactId,
          businessVertical: values.businessVertical,
          monthlyVolume: values.monthlyVolume,
          permissionObtained: values.permissionObtained,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Case study intake submitted", description: "Task created and team notified." });
      form.reset();
      setSelectedContactId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit intake", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` - ${c.companyName}` : ""}`;

  if (contactsLoading || dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="casestudy-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="casestudy-page">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
            <CardTitle data-testid="text-casestudy-title">Case Study Intake</CardTitle>
          </div>
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
                        <SelectTrigger data-testid="select-casestudy-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} data-testid={`select-casestudy-contact-${c.id}`}>
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
                        <SelectTrigger data-testid="select-casestudy-deal">
                          <SelectValue placeholder={selectedContactId ? "Select a deal" : "Select a contact first"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contactDeals.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} data-testid={`select-casestudy-deal-${d.id}`}>
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
                name="businessVertical"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Vertical</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Medical/Dental, Restaurant, Retail" data-testid="input-casestudy-vertical" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="monthlyVolume"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Volume Processed</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., $50,000" data-testid="input-casestudy-volume" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="highlights"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Highlights / Key Results</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe the key results and highlights..." data-testid="input-casestudy-highlights" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="permissionObtained"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-casestudy-permission"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Permission obtained from merchant</FormLabel>
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
                      <Textarea {...field} placeholder="Additional notes..." data-testid="input-casestudy-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full"
                data-testid="button-submit-casestudy"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {submitMutation.isPending ? "Submitting..." : "Submit Case Study Intake"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
