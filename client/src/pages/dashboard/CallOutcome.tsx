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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Loader2, Phone, Mail, MessageSquare, Send, Sparkles, CheckCircle, Clock,
  FileText, ArrowRight, Eye, Edit3, ChevronDown, ChevronUp
} from "lucide-react";
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

const OUTCOME_LABELS: Record<string, { color: string; description: string }> = {
  "Connected - Send Review Summary": { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", description: "Good call — merchant wants to see the numbers" },
  "Connected - Needs Proposal": { color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", description: "Ready for a formal pricing proposal" },
  "Connected - Not a Fit": { color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200", description: "Not a match right now" },
  "No Show": { color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", description: "Missed the scheduled call" },
  "Not Now (Nurture)": { color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", description: "Interested but timing isn't right" },
  "Closed Won": { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", description: "They signed up!" },
  "Closed Lost": { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", description: "Went another direction" },
};

const formSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  dealId: z.string().min(1, "Deal is required"),
  outcome: z.string().min(1, "Outcome is required"),
  notes: z.string().optional(),
  firefliesRecap: z.string().optional(),
  duration: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  interestedIn0Percent: z.boolean().default(false),
  needsTerminal: z.boolean().default(false),
  sendPacketNow: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

interface FollowUpDrafts {
  email: { subject: string; body: string };
  sms: { body: string };
  callSummary: string;
  nextSteps: string;
  sentiment: string;
  contactName: string;
  companyName: string;
}

export default function CallOutcome() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [step, setStep] = useState<"log" | "review" | "sent">("log");
  const [drafts, setDrafts] = useState<FollowUpDrafts | null>(null);
  const [editEmailSubject, setEditEmailSubject] = useState("");
  const [editEmailBody, setEditEmailBody] = useState("");
  const [editSmsBody, setEditSmsBody] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);
  const [showRecap, setShowRecap] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: "",
      dealId: "",
      outcome: "",
      notes: "",
      firefliesRecap: "",
      duration: "",
      nextFollowUpDate: "",
      interestedIn0Percent: false,
      needsTerminal: false,
      sendPacketNow: false,
    },
  });

  const { data: contactsRes, isLoading: contactsLoading } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes?.data;

  const { data: dealsRes, isLoading: dealsLoading } = useQuery<{ data: Deal[]; total: number }>({
    queryKey: ["/api/deals"],
  });
  const deals = dealsRes?.data;

  const contactDeals = deals?.filter(
    (d) => d.contactId === Number(selectedContactId)
  ) || [];

  const generateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await apiRequest("POST", "/api/call-follow-ups/generate", {
        contactId: Number(values.contactId),
        dealId: values.dealId ? Number(values.dealId) : undefined,
        outcome: values.outcome,
        callNotes: values.notes || undefined,
        firefliesRecap: values.firefliesRecap || undefined,
        duration: values.duration ? Number(values.duration) : undefined,
      });
      return res.json();
    },
    onSuccess: (data: FollowUpDrafts) => {
      setDrafts(data);
      setEditEmailSubject(data.email.subject);
      setEditEmailBody(data.email.body);
      setEditSmsBody(data.sms.body);
      setStep("review");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't generate follow-ups", description: err.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const values = form.getValues();
      const res = await apiRequest("POST", "/api/call-follow-ups/send", {
        contactId: Number(values.contactId),
        dealId: values.dealId ? Number(values.dealId) : undefined,
        outcome: values.outcome,
        callNotes: values.notes || undefined,
        firefliesRecap: values.firefliesRecap || undefined,
        duration: values.duration ? Number(values.duration) : undefined,
        emailSubject: editEmailSubject,
        emailBody: editEmailBody,
        smsBody: editSmsBody,
        sendEmail,
        sendSms,
        callSummary: drafts?.callSummary || "",
        nextSteps: drafts?.nextSteps || "",
        sentiment: drafts?.sentiment || "neutral",
        nextFollowUpDate: values.nextFollowUpDate || undefined,
        interestedIn0Percent: values.interestedIn0Percent,
        needsTerminal: values.needsTerminal,
        sendPacketNow: values.sendPacketNow,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSendResult(data);
      setStep("sent");
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      toast({ title: "Follow-ups sent and call logged", description: `Stage updated to: ${data.newStage || "unchanged"}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send follow-ups", description: err.message, variant: "destructive" });
    },
  });

  const onSubmitForReview = (values: FormValues) => {
    generateMutation.mutate(values);
  };

  const handleLogOnly = async () => {
    const values = form.getValues();
    try {
      const res = await apiRequest("POST", "/api/call-follow-ups/send", {
        contactId: Number(values.contactId),
        dealId: values.dealId ? Number(values.dealId) : undefined,
        outcome: values.outcome,
        callNotes: values.notes || undefined,
        firefliesRecap: values.firefliesRecap || undefined,
        duration: values.duration ? Number(values.duration) : undefined,
        sendEmail: false,
        sendSms: false,
        callSummary: "",
        nextSteps: "",
        sentiment: "neutral",
        nextFollowUpDate: values.nextFollowUpDate || undefined,
        interestedIn0Percent: values.interestedIn0Percent,
        needsTerminal: values.needsTerminal,
        sendPacketNow: values.sendPacketNow,
      });
      const data = await res.json();
      setSendResult(data);
      setStep("sent");
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      toast({ title: "Call logged (no follow-ups sent)", description: `Stage updated to: ${data.newStage || "unchanged"}` });
    } catch (err: any) {
      toast({ title: "Failed to log call", description: err.message, variant: "destructive" });
    }
  };

  const getContactLabel = (c: Contact) =>
    `${c.firstName} ${c.lastName}${c.companyName ? ` — ${c.companyName}` : ""}`;

  const selectedOutcome = form.watch("outcome");
  const outcomeInfo = selectedOutcome ? OUTCOME_LABELS[selectedOutcome] : null;
  const selectedContact = contacts?.find(c => c.id === Number(selectedContactId));

  const resetAll = () => {
    form.reset();
    setSelectedContactId("");
    setStep("log");
    setDrafts(null);
    setSendResult(null);
    setShowRecap(false);
  };

  if (contactsLoading || dealsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="calloutcome-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (step === "sent") {
    return (
      <div className="max-w-2xl mx-auto" data-testid="calloutcome-sent">
        <Card>
          <CardContent className="pt-8 pb-8">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-2xl font-bold" data-testid="text-sent-heading">Call Logged & Follow-Ups Processed</h2>
              <div className="space-y-2 text-sm text-muted-foreground">
                {sendResult?.emailSent && (
                  <div className="flex items-center justify-center gap-2">
                    <Mail className="w-4 h-4 text-blue-500" />
                    <span>Follow-up email sent</span>
                  </div>
                )}
                {sendResult?.smsSent && (
                  <div className="flex items-center justify-center gap-2">
                    <MessageSquare className="w-4 h-4 text-green-500" />
                    <span>Follow-up SMS sent</span>
                  </div>
                )}
                {sendResult?.stageUpdated && (
                  <div className="flex items-center justify-center gap-2">
                    <ArrowRight className="w-4 h-4 text-purple-500" />
                    <span>Deal moved to: <strong>{sendResult.newStage}</strong></span>
                  </div>
                )}
                {sendResult?.sequenceEnrolled && (
                  <div className="flex items-center justify-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span>Enrolled in: <strong>{sendResult.sequenceEnrolled}</strong></span>
                  </div>
                )}
              </div>
              <Button onClick={resetAll} className="mt-4" data-testid="button-log-another">
                Log Another Call
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "review" && drafts) {
    return (
      <div className="max-w-3xl mx-auto space-y-4" data-testid="calloutcome-review">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2" data-testid="text-review-heading">
                <Eye className="w-5 h-5" />
                Review Follow-Ups Before Sending
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setStep("log")} data-testid="button-back-to-edit">
                Back to Edit
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              These were generated from the call details{form.getValues().firefliesRecap ? " and Fireflies recap" : ""}. Edit anything before approving.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">To:</span>
              <span className="font-medium">{drafts.contactName}</span>
              {drafts.companyName && <span className="text-muted-foreground">({drafts.companyName})</span>}
              <Badge variant="secondary" className="ml-auto no-default-hover-elevate">{form.getValues().outcome}</Badge>
            </div>

            {drafts.callSummary && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm" data-testid="text-call-summary">
                <span className="font-medium text-muted-foreground">AI Call Summary: </span>
                {drafts.callSummary}
              </div>
            )}

            <Separator />

            <div className="space-y-3" data-testid="section-email-draft">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-sm">Email Follow-Up</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={sendEmail}
                    onCheckedChange={(v) => setSendEmail(!!v)}
                    data-testid="checkbox-send-email"
                  />
                  <span className="text-xs text-muted-foreground">Send this</span>
                </div>
              </div>
              <Input
                value={editEmailSubject}
                onChange={(e) => setEditEmailSubject(e.target.value)}
                placeholder="Subject line"
                className="text-sm"
                data-testid="input-email-subject"
              />
              <Textarea
                value={editEmailBody}
                onChange={(e) => setEditEmailBody(e.target.value)}
                rows={8}
                className="text-sm resize-none"
                data-testid="input-email-body"
              />
            </div>

            <Separator />

            <div className="space-y-3" data-testid="section-sms-draft">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-green-500" />
                  <span className="font-semibold text-sm">SMS Follow-Up</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={sendSms}
                    onCheckedChange={(v) => setSendSms(!!v)}
                    data-testid="checkbox-send-sms"
                  />
                  <span className="text-xs text-muted-foreground">Send this</span>
                </div>
              </div>
              <Textarea
                value={editSmsBody}
                onChange={(e) => setEditSmsBody(e.target.value)}
                rows={3}
                className="text-sm resize-none"
                data-testid="input-sms-body"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{editSmsBody.length} characters</span>
                {editSmsBody.length > 300 && <span className="text-amber-500">Consider shortening for SMS</span>}
                {!selectedContact?.consentSms && <span className="text-red-500">Contact has not consented to SMS</span>}
              </div>
            </div>

            {drafts.nextSteps && (
              <>
                <Separator />
                <div className="text-sm" data-testid="text-next-steps">
                  <span className="font-medium text-muted-foreground">Next Steps: </span>
                  {drafts.nextSteps}
                </div>
              </>
            )}

            <Separator />

            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || (!sendEmail && !sendSms)}
                className="flex-1 gap-2"
                data-testid="button-approve-send"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {sendMutation.isPending ? "Sending..." : "Approve & Send Follow-Ups"}
              </Button>
              <Button
                variant="outline"
                onClick={handleLogOnly}
                className="gap-2"
                data-testid="button-log-only"
              >
                <FileText className="w-4 h-4" />
                Log Call Only
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4" data-testid="calloutcome-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-calloutcome-title">
            <Phone className="w-5 h-5" />
            Sales Call Outcome
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Log the call, paste your Fireflies recap, and we'll draft personalized follow-ups for you to review before sending.
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitForReview)} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                              Deal #{d.id} — {d.stage} ({d.pipeline})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="outcome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Call Outcome</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-outcome">
                          <SelectValue placeholder="What happened on the call?" />
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
                    {outcomeInfo && (
                      <p className="text-xs text-muted-foreground mt-1">{outcomeInfo.description}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Call Duration (minutes)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="e.g. 15" {...field} data-testid="input-duration" />
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
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your Call Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Quick notes about what you discussed, key points, merchant concerns..."
                        rows={3}
                        className="resize-none"
                        data-testid="input-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRecap(!showRecap)}
                  className="gap-1.5 text-xs mb-2"
                  data-testid="button-toggle-recap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Fireflies / Meeting Recap
                  {showRecap ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>
                {showRecap && (
                  <FormField
                    control={form.control}
                    name="firefliesRecap"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Paste your Fireflies.ai meeting summary, transcript, or any call recap here. The AI will use this to write more specific, personalized follow-ups that reference actual conversation points."
                            rows={6}
                            className="resize-none text-sm"
                            data-testid="input-fireflies-recap"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground mt-1">
                          The more detail you paste, the more personalized the follow-ups will be.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="interestedIn0Percent"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-interested-0-percent"
                        />
                      </FormControl>
                      <FormLabel className="font-normal text-sm">Interested in 0%?</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="needsTerminal"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-needs-terminal"
                        />
                      </FormControl>
                      <FormLabel className="font-normal text-sm">Needs Terminal?</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sendPacketNow"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-send-packet"
                        />
                      </FormControl>
                      <FormLabel className="font-normal text-sm">Send Packet?</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={generateMutation.isPending}
                  className="flex-1 gap-2"
                  data-testid="button-generate-followups"
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {generateMutation.isPending ? "Generating Follow-Ups..." : "Generate Follow-Up Drafts"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLogOnly}
                  className="gap-2"
                  data-testid="button-log-only-skip"
                >
                  <FileText className="w-4 h-4" />
                  Log Only
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
