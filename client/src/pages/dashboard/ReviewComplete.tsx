import { useState, useRef, useEffect } from "react";
import { useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, protectedScope } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { invalidateWorkFacts } from "@/hooks/use-work-commands";
import { useOwnedToast as useToast } from "@/hooks/use-owned-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import type { Contact } from "@shared/schema";
import { useContacts } from "@/hooks/use-contacts";
import { useCrmQuery } from "@/hooks/use-crm-query";
import type { ContactDetailData } from "./contact-detail-tabs/shared";
import { CrmPage, CrmPageHeader } from "@/components/crm/CrmPresentation";
import { safeParams } from "@/lib/crm-destination-state";
import { useContextualContact } from "@/hooks/use-contextual-contact";

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
  const {user}=useAuth();
  const search = useSearch();
  const params = safeParams(search,["contactId","dealId"]);
  const initialContactId = params.get("contactId") ?? "";
  const initialDealId = params.get("dealId") ?? "";
  const [selectedContactId, setSelectedContactId] = useState<string>(initialContactId);
  const [contactSearch, setContactSearch] = useState("");
  const taskCommand = useRef<{ commandId: string; payload: Record<string, unknown>; key: string } | null>(null);
  const [partialOutcome, setPartialOutcome] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: initialContactId,
      dealId: initialDealId,
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
  const selectedDealId=form.watch("dealId");
  const context=JSON.stringify([protectedScope(user),selectedContactId,selectedDealId]);
  const currentContext=useRef(context);currentContext.current=context;
  const actorContext=JSON.stringify(protectedScope(user));
  useEffect(()=>{
    const target=safeParams(search,["contactId","dealId"]);
    const contactId=target.get("contactId") ?? "";
    form.reset({...form.formState.defaultValues,contactId,dealId:target.get("dealId") ?? ""});
    setSelectedContactId(contactId);taskCommand.current=null;setPartialOutcome(null);setContactSearch("");
  },[actorContext,form]);
  useEffect(()=>{
    setSelectedContactId(initialContactId);form.setValue("contactId",initialContactId);form.setValue("dealId",initialDealId);
  },[search,form]);

  const contactsQuery = useContacts({ limit: 50, offset: 0, search: contactSearch.trim() || undefined });
  const selectedContactQuery = useContextualContact(selectedContactId);
  const selectedContact=selectedContactQuery.data?.contact;
  const contacts:Contact[]=selectedContact && !contactsQuery.data?.data.some(row=>row.id===selectedContact.id)
    ? [selectedContact,...(contactsQuery.data?.data ?? [])] : contactsQuery.data?.data ?? [];
  const contactDeals = selectedContactQuery.data?.deals?.filter(deal => deal.contactId === Number(selectedContactId) && !deal.archivedAt) ?? [];
  const contactsLoading = contactsQuery.isLoading || (!!selectedContactId && selectedContactQuery.isLoading);
  const dealsLoading = !!selectedContactId && selectedContactQuery.isLoading;

  const submitMutation = useMutation({
    onMutate:()=>({context,scope:protectedScope(user)}),
    mutationFn: async (values: FormValues) => {
      const dealId = Number(values.dealId);
      const displayedDeal = contactDeals.find(deal => deal.id === dealId);
      if (!displayedDeal || typeof displayedDeal.stage !== "string") {
        throw new Error("The displayed deal stage is unavailable. Reload the authorized deal details before submitting.");
      }
      const topCostDrivers = [values.costDriver1, values.costDriver2, values.costDriver3].filter(Boolean);

      const taskKey = JSON.stringify([protectedScope(user),values]);
      if (!taskCommand.current || taskCommand.current.key !== taskKey) {
        if(partialOutcome) throw new Error("Resolve the unconfirmed submission by retrying its unchanged intent before creating another follow-up.");
        taskCommand.current = {
          commandId: crypto.randomUUID(),key:taskKey,
          payload: {dealId,contactId:Number(values.contactId),title:"Call / follow up to present options",priority:"high",
            dueDate:new Date(Date.now()+24*60*60*1000).toISOString(),expectedActorId:user?.id,expectedAccountVersion:user?.accountVersion},
        };
      }
      const command=taskCommand.current;
      await apiRequest("PUT", `/api/deals/${dealId}`, {
        stage: "Proposal Sent",
        expectedStage: displayedDeal.stage,
        effectiveRate: values.effectiveRate,
        totalVolume: values.totalVolume,
        totalFees: values.totalFees,
        topCostDrivers,
        recommendedPath: values.recommendedPath,
        terminalRecommendation: values.terminalRecommendation,
        fundingNotes: values.fundingNotes || undefined,
        notes: [values.optionASummary ? `Option A: ${values.optionASummary}` : "", values.optionBSummary ? `Option B: ${values.optionBSummary}` : ""].filter(Boolean).join("\n"),
      });

      try {
        const taskResponse = await apiRequest("POST", "/api/tasks", { ...command.payload, commandId: command.commandId });
        if (!taskResponse.ok) throw new Error("The task service did not confirm creation.");
        const saved=await taskResponse.json();
        if(!Number.isSafeInteger(saved?.id) || saved.dealId!==dealId || saved.contactId!==Number(values.contactId))
          throw new Error("Follow-up task confirmation did not match the submitted record.");
      } catch (error) {
        throw new Error(`PARTIAL: Deal #${dealId} was updated, but the follow-up task is not confirmed. Retry will reuse the same task command identity. ${error instanceof Error ? error.message : ""}`);
      }
    },
    onSuccess: (_data,_values,submitted) => {
      if(currentContext.current!==submitted?.context)return;
      taskCommand.current = null;
      setPartialOutcome(null);
      invalidateWorkFacts();
      toast({ title: "Review complete", description: "Deal updated to Proposal Sent. Follow-up task created." });
      form.reset();
      setSelectedContactId("");
    },
    onError: async (err: Error, values, submitted) => {
      if(currentContext.current!==submitted?.context)return;
      const dealId = Number(values.dealId);
      let stageReadback = "";
      try {
        const response = await apiRequest("GET", `/api/deals/${dealId}`);
        const authoritativeDeal = await response.json();
        if(currentContext.current!==submitted?.context)return;
        if(authoritativeDeal.id!==dealId || authoritativeDeal.contactId!==Number(values.contactId)) throw new Error("Invalid exact-deal readback");
        queryClient.setQueryData(["/api/contacts", Number(values.contactId), "detail",{section:"deals"},submitted.scope], (old: any) => old
          ? { ...old, deals: old.deals?.map((deal: any) => deal.id === authoritativeDeal.id ? authoritativeDeal : deal) }
          : old);
        stageReadback = ` Server read-back confirms the current deal stage is “${authoritativeDeal.stage}”.`;
      } catch {
        stageReadback = " Server read-back was unavailable; deal stage remains unconfirmed.";
      }
      if(currentContext.current!==submitted?.context)return;
      void queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      if (err.message.startsWith("PARTIAL:")) setPartialOutcome(err.message.replace("PARTIAL: ", ""));
      toast({ title: err.message.startsWith("PARTIAL:") ? "Review partially saved" : "Review not saved", description: `${err.message.replace("PARTIAL: ", "")}${stageReadback}`, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` - ${c.companyName}` : ""}`;

  if (contactsLoading || dealsLoading) {
    return (
      <CrmPage className="max-w-3xl space-y-5">
        <CrmPageHeader title="Statement review" description="Loading authorized contact and deal context." />
        <div className="w-full space-y-3" aria-label="Loading review context" role="status">
          <div className="h-14 animate-pulse rounded bg-muted" /><div className="h-14 animate-pulse rounded bg-muted" />
          <div className="h-14 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded bg-muted" />
        </div>
      </CrmPage>
    );
  }

  return (
    <CrmPage className="max-w-3xl space-y-5">
      <CrmPageHeader title="Statement review" description="Record the reviewed offer and create its follow-up task." />
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-reviewcomplete-title">Review complete</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedContactQuery.isError && <div className="mb-4 rounded-md border border-destructive/40 p-3 text-sm" role="alert">
            {selectedContactQuery.error.message} <Button variant="outline" className="ml-2" onClick={() => void selectedContactQuery.refetch()}>Retry</Button>
          </div>}
          {partialOutcome && <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="status">{partialOutcome}</div>}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact</FormLabel>
                    <Input value={contactSearch} onChange={event => setContactSearch(event.currentTarget.value)}
                      placeholder="Search name, company, email" aria-label="Search contacts" className="mb-2" />
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        setSelectedContactId(v);
                        form.setValue("dealId", v === initialContactId ? initialDealId : "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contactsQuery.isError && <SelectItem value="__contact-search-error" disabled>Contact search unavailable; retry the search</SelectItem>}
                        {contactsQuery.isLoading && <SelectItem value="__contact-search-loading" disabled>Searching authorized contacts…</SelectItem>}
                        {[...new Map([...(selectedContactQuery.data?.contact ? [selectedContactQuery.data.contact] : []), ...(contacts ?? [])].map(contact => [contact.id, contact])).values()].map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} data-testid={`select-contact-${c.id}`}>
                            {getContactLabel(c)}
                          </SelectItem>
                        ))}
                        {!contactsQuery.isError && !contactsQuery.isLoading && !contacts?.length && !selectedContactQuery.data?.contact && <SelectItem value="__contact-empty" disabled>No authorized contacts match this search</SelectItem>}
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
                        {!contactDeals.length && selectedContactId && !selectedContactQuery.isError && <SelectItem value="__deals-empty" disabled>No linked active deals are available for this contact</SelectItem>}
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
    </CrmPage>
  );
}
