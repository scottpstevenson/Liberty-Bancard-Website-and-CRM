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
import { Loader2, Wand2, RefreshCw, MessageSquare, Target, ShieldAlert, ArrowRight, FileText, Mail, CheckCircle, XCircle, AlertCircle } from "lucide-react";

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

function OutreachEligibilityCard({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [enrolledSequenceName, setEnrolledSequenceName] = useState<string | null>(null);
  const [alreadyEnrolledMsg, setAlreadyEnrolledMsg] = useState<string | null>(null);

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

  // Email-only sequences: channelsAllowed is null/empty or ["email"]
  const activeEmailSequences = (sequencesQuery.data ?? []).filter(s => {
    if (s.status !== "active") return false;
    const ch = s.channelsAllowed;
    if (!ch || ch.length === 0) return true;
    return ch.length === 1 && ch[0] === "email";
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

      <OutreachEligibilityCard contactId={contactId} />
    </div>
  );
}
