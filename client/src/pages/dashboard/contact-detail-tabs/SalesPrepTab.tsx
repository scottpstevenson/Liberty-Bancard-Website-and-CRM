import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, RefreshCw, MessageSquare, Target, ShieldAlert, ArrowRight, FileText, Mail, CheckCircle, XCircle, AlertCircle, Trash2, Play, Pause } from "lucide-react";

interface SalesPrepOutput {
  callOpener: string;
  processorAngle: string;
  likelyObjection: string;
  recommendedCta: string;
  statementAsk: string;
}

interface SalesPrepStatus {
  sdrSourced: boolean;
  cached: SalesPrepOutput | null;
  cacheKey: string | null;
  generatedAt: string | null;
  canGenerate: boolean;
}

interface SalesPrepResult {
  output: SalesPrepOutput;
  generatedAt: string;
  fromCache: boolean;
  model: string;
}

interface ContactabilityStatus {
  sdrSourced: boolean;
  allowed?: boolean;
  reason?: string;
  channel?: string;
}

interface Sequence {
  id: number;
  name: string;
  status: string;
  channelsAllowed?: string[] | null;
}

interface SalesPrepTabProps {
  contactId: number;
}

interface Enrollment {
  id: number;
  sequenceId: number | null;
  contactId: number | null;
  status: string;
  currentStep: number | null;
  createdAt: string | null;
  nextActionAt?: string | null; // #540 — next scheduled step date
}

function ActiveEnrollmentsCard({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const enrollmentsQuery = useQuery<Enrollment[]>({
    queryKey: [`/api/contacts/${contactId}/enrollments`],
    staleTime: 30_000,
  });

  const sequencesQuery = useQuery<Sequence[]>({
    queryKey: ["/api/sequences"],
    staleTime: 60_000,
  });

  const cancelMutation = useMutation({
    mutationFn: (enrollment: Enrollment) =>
      apiRequest("DELETE", `/api/sequences/${enrollment.sequenceId}/enrollments/${contactId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}/enrollments`] });
      setConfirmId(null);
      toast({ title: "Removed from sequence", description: "The contact has been unenrolled." });
    },
    onError: () => {
      toast({ title: "Could not remove", description: "Please try again.", variant: "destructive" });
    },
  });

  // #541 — Toggle active/paused on individual enrollment
  const pauseMutation = useMutation({
    mutationFn: (enrollment: Enrollment) =>
      apiRequest("PATCH", `/api/sequences/${enrollment.sequenceId}/enrollments/${contactId}/pause`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}/enrollments`] });
      toast({ title: "Enrollment updated" });
    },
    onError: () => {
      toast({ title: "Could not update enrollment", variant: "destructive" });
    },
  });

  if (enrollmentsQuery.isLoading) return null;

  const allEnrollments = enrollmentsQuery.data ?? [];
  const active = allEnrollments.filter(e => e.status === "active" || e.status === "paused");
  const history = allEnrollments.filter(e => e.status !== "active" && e.status !== "paused");

  const sequenceMap = Object.fromEntries(
    (sequencesQuery.data ?? []).map(s => [s.id, s.name])
  );

  if (allEnrollments.length === 0) return null;

  const statusBadge = (status: string) => {
    if (status === "active") return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Active</Badge>;
    if (status === "paused") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">Paused</Badge>;
    if (status === "cancelled") return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Cancelled</Badge>;
    if (status === "completed") return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">Completed</Badge>;
    return <Badge variant="outline" className="text-xs">{status}</Badge>;
  };

  return (
    <Card data-testid="card-active-enrollments">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Mail className="h-4 w-4 text-indigo-500" />
          Sequence Enrollments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {active.length === 0 && history.length === 0 && (
          <p className="text-xs text-muted-foreground">No enrollment history.</p>
        )}

        {active.map(enrollment => (
          <div key={enrollment.id} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" data-testid={`enrollment-name-${enrollment.id}`}>
                {enrollment.sequenceId ? (sequenceMap[enrollment.sequenceId] ?? `Sequence #${enrollment.sequenceId}`) : "Unknown sequence"}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {statusBadge(enrollment.status)}
                <span className="text-xs text-muted-foreground">Step {enrollment.currentStep ?? 0}</span>
                {/* #540 — next step date */}
                {enrollment.nextActionAt && enrollment.status === "active" && (
                  <span className="text-xs text-muted-foreground" data-testid={`text-next-action-${enrollment.id}`}>
                    · Next: {new Date(enrollment.nextActionAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            </div>

            {confirmId === enrollment.id ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-muted-foreground">Remove?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2 text-xs"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(enrollment)}
                  data-testid={`button-confirm-remove-${enrollment.id}`}
                >
                  {cancelMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setConfirmId(null)}
                  data-testid={`button-cancel-remove-${enrollment.id}`}
                >
                  No
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                {/* #541 — Pause / resume individual enrollment */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground shrink-0"
                  onClick={() => pauseMutation.mutate(enrollment)}
                  disabled={pauseMutation.isPending}
                  aria-label={enrollment.status === "paused" ? "Resume enrollment" : "Pause enrollment"}
                  data-testid={`button-${enrollment.status === "paused" ? "resume" : "pause"}-enrollment-${enrollment.id}`}
                  title={enrollment.status === "paused" ? "Resume" : "Pause"}
                >
                  {enrollment.status === "paused"
                    ? <Play className="h-3.5 w-3.5 text-green-600" />
                    : <Pause className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setConfirmId(enrollment.id)}
                  aria-label="Remove from sequence"
                  data-testid={`button-remove-enrollment-${enrollment.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}

        {history.length > 0 && (
          <>
            {active.length > 0 && <Separator className="my-1" />}
            <p className="text-xs text-muted-foreground font-medium pt-1">History</p>
            {/* #548 — Group by sequence and show re-enrollment count */}
            {(() => {
              const grouped: Record<number, Enrollment[]> = {};
              for (const e of history) {
                const key = e.sequenceId ?? -1;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(e);
              }
              return Object.entries(grouped).map(([seqIdStr, entries]) => {
                const seqId = Number(seqIdStr);
                const latest = entries[entries.length - 1];
                return (
                  <div key={seqIdStr} className="flex items-center justify-between gap-2 py-0.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground truncate">
                        {seqId > 0 ? (sequenceMap[seqId] ?? `Sequence #${seqId}`) : "Unknown sequence"}
                        {entries.length > 1 && (
                          <span className="ml-1 text-[10px] text-muted-foreground/60" data-testid={`text-reenrollment-count-${seqId}`}>×{entries.length}</span>
                        )}
                      </p>
                    </div>
                    {statusBadge(latest.status)}
                  </div>
                );
              });
            })()}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OutreachEligibilityCard({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [enrolledSequenceName, setEnrolledSequenceName] = useState<string | null>(null);
  const [alreadyEnrolledMsg, setAlreadyEnrolledMsg] = useState<string | null>(null);

  // #531 — fetch minimal contact data to check email status
  const contactQuery = useQuery<{ emailStatus?: string | null }>({
    queryKey: [`/api/contacts/${contactId}`],
    staleTime: 60_000,
    select: (d: any) => ({ emailStatus: d?.emailStatus ?? null }),
  });
  const emailBlocked = ["bounced", "invalid", "opted_out"].includes(contactQuery.data?.emailStatus ?? "");

  const statusQuery = useQuery<ContactabilityStatus>({
    queryKey: [`/api/contacts/${contactId}/contactability-status`],
    staleTime: 30_000,
  });

  const sequencesQuery = useQuery<Sequence[]>({
    queryKey: ["/api/sequences"],
    staleTime: 60_000,
  });

  const enrollMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/contacts/${contactId}/sdr-enroll`, {
        sequenceId: Number(selectedSequenceId),
        confirmed: true,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      setEnrolledSequenceName(data.sequenceName ?? "sequence");
      setConfirmed(false);
      setSelectedSequenceId("");
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}/contactability-status`] });
    },
    onError: (err: any) => {
      // apiRequest throws Error("${status}: ${bodyText}") on non-ok responses
      const msg: string = err?.message ?? "";
      const colonIdx = msg.indexOf(":");
      const statusCode = colonIdx > 0 ? parseInt(msg.slice(0, colonIdx), 10) : 0;
      if (statusCode === 409) {
        const jsonPart = msg.slice(colonIdx + 1).trim();
        try {
          const parsed = JSON.parse(jsonPart);
          if (parsed?.alreadyEnrolled) {
            setAlreadyEnrolledMsg("Already enrolled in this sequence.");
            return;
          }
        } catch {
          // fall through to generic message
        }
        setAlreadyEnrolledMsg("Already enrolled in this sequence.");
        return;
      }
      let detail = "Could not enroll contact. Please try again.";
      if (colonIdx > 0) {
        const jsonPart = msg.slice(colonIdx + 1).trim();
        try {
          const parsed = JSON.parse(jsonPart);
          if (parsed?.message) detail = parsed.message;
        } catch { /* raw text */ }
      }
      toast({
        title: "Enrollment failed",
        description: detail,
        variant: "destructive",
      });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <Card data-testid="card-outreach-eligibility">
        <CardContent className="py-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking outreach eligibility…
        </CardContent>
      </Card>
    );
  }

  const status = statusQuery.data;
  if (!status?.sdrSourced) return null;

  // #534 — Filter sequences by contact's consent tier (if sequences declare eligibleConsentTiers)
  const contactConsentTier = (status as any)?.consentTier ?? "cold_no_consent";
  // Email-only sequences: channelsAllowed is null/empty or ["email"]
  const activeEmailSequences = (sequencesQuery.data ?? []).filter(s => {
    if (s.status !== "active") return false;
    const ch = s.channelsAllowed;
    if (!ch || ch.length === 0) return true;
    if (!(ch.length === 1 && ch[0] === "email")) return false;
    // If the sequence declares eligible consent tiers, check the contact matches
    const eligible = (s as any).eligibleConsentTiers as string[] | null | undefined;
    if (eligible && eligible.length > 0 && !eligible.includes(contactConsentTier)) return false;
    return true;
  });

  if (enrolledSequenceName) {
    return (
      <Card data-testid="card-outreach-eligibility">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-500" />
            Outreach Eligibility
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-600" data-testid="text-enroll-success">
            <CheckCircle className="h-4 w-4" />
            Successfully enrolled in <strong>{enrolledSequenceName}</strong>.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-outreach-eligibility">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Mail className="h-4 w-4 text-blue-500" />
          Outreach Eligibility
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          {status.allowed ? (
            <Badge className="bg-green-100 text-green-800 border-green-200" data-testid="badge-eligibility-allowed">
              <CheckCircle className="h-3 w-3 mr-1" />
              Allowed
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-800 border-red-200" data-testid="badge-eligibility-blocked">
              <XCircle className="h-3 w-3 mr-1" />
              Blocked
            </Badge>
          )}
          {status.reason && (
            <span className="text-xs text-muted-foreground" data-testid="text-eligibility-reason">
              {status.reason}
            </span>
          )}
        </div>

        {status.allowed && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`sequence-select-${contactId}`} className="text-xs font-medium">
                  Email-only sequence
                </Label>
                {sequencesQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="loader-sequences">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading sequences…
                  </div>
                ) : activeEmailSequences.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="text-no-sequences">
                    No active email-only sequences available.
                  </p>
                ) : (
                  <Select
                    value={selectedSequenceId}
                    onValueChange={(val) => {
                      setSelectedSequenceId(val);
                      setAlreadyEnrolledMsg(null);
                    }}
                  >
                    <SelectTrigger
                      id={`sequence-select-${contactId}`}
                      data-testid="select-sequence"
                      className="text-sm"
                    >
                      <SelectValue placeholder="Select a sequence…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeEmailSequences.map(s => (
                        <SelectItem
                          key={s.id}
                          value={String(s.id)}
                          data-testid={`option-sequence-${s.id}`}
                        >
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {selectedSequenceId && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`confirm-enroll-${contactId}`}
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(Boolean(v))}
                    data-testid="checkbox-confirm-enroll"
                  />
                  <Label
                    htmlFor={`confirm-enroll-${contactId}`}
                    className="text-xs leading-snug cursor-pointer"
                  >
                    I confirm this contact has consented to email outreach and I am manually enrolling them into this sequence.
                  </Label>
                </div>
              )}

              {alreadyEnrolledMsg && (
                <div className="flex items-center gap-2 text-sm text-amber-600" data-testid="text-already-enrolled">
                  <AlertCircle className="h-4 w-4" />
                  {alreadyEnrolledMsg}
                </div>
              )}

              {/* #531 — Bounce warning */}
              {emailBlocked && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2" data-testid="alert-email-blocked">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  This contact's email is marked as {contactQuery.data?.emailStatus ?? "undeliverable"}. Email sequences may not reach them.
                </div>
              )}
              <Button
                size="sm"
                disabled={!selectedSequenceId || !confirmed || enrollMutation.isPending}
                onClick={() => enrollMutation.mutate()}
                data-testid="button-enroll-submit"
              >
                {enrollMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Enrolling…
                  </>
                ) : (
                  <>
                    <Mail className="h-3 w-3 mr-2" />
                    Enroll in Sequence
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SalesPrepTab({ contactId }: SalesPrepTabProps) {
  const { toast } = useToast();
  const [localResult, setLocalResult] = useState<SalesPrepResult | null>(null);

  const statusQuery = useQuery<SalesPrepStatus>({
    queryKey: [`/api/contacts/${contactId}/sales-prep`],
    staleTime: Infinity,
  });

  const generateMutation = useMutation({
    mutationFn: (): Promise<SalesPrepResult> =>
      apiRequest("POST", `/api/contacts/${contactId}/sales-prep/generate`).then(r => r.json()),
    onSuccess: (data) => {
      setLocalResult(data);
      statusQuery.refetch();
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Could not generate sales prep. Please try again.", variant: "destructive" });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loader-sales-prep">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = statusQuery.data;
  if (!status?.sdrSourced) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm" data-testid="text-not-sdr-sourced">
          Sales prep is only available for SDR-sourced contacts.
        </CardContent>
      </Card>
    );
  }

  const output: SalesPrepOutput | null = localResult?.output ?? status.cached ?? null;
  const generatedAt: string | null = localResult?.generatedAt ?? status.generatedAt ?? null;
  const model: string | null = localResult?.model ?? null;

  if (!output) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              AI Sales Prep
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-no-cache">
              Generate an AI-powered sales brief for this contact — call opener, processor angle, likely objections, CTA, and statement ask.
            </p>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-sales-prep"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate Sales Prep
                </>
              )}
            </Button>
          </CardContent>
        </Card>
        <ActiveEnrollmentsCard contactId={contactId} />
        <OutreachEligibilityCard contactId={contactId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold" data-testid="text-sales-prep-heading">AI Sales Prep</h3>
          {generatedAt && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-generated-at">
              {new Date(generatedAt).toLocaleDateString()}
            </Badge>
          )}
          {model && model !== "test-fixture" && (
            <Badge variant="outline" className="text-xs" data-testid="badge-model">{model}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="button-regenerate-sales-prep"
          aria-label="Regenerate sales prep"
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card data-testid="card-call-opener">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            Call Opener
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-call-opener">{output.callOpener}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-processor-angle">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-green-500" />
            Processor Angle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-processor-angle">{output.processorAngle}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-likely-objection">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            Likely Objection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-likely-objection">{output.likelyObjection}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-recommended-cta">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-purple-500" />
            Recommended CTA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-recommended-cta">{output.recommendedCta}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-statement-ask">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" />
            Statement Ask
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-statement-ask">{output.statementAsk}</p>
        </CardContent>
      </Card>

      <ActiveEnrollmentsCard contactId={contactId} />
      <OutreachEligibilityCard contactId={contactId} />
    </div>
  );
}
