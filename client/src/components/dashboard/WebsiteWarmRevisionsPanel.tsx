import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Mail } from "lucide-react";
import { apiRequest, queryClient, parseApiRequestError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WEBSITE_EMAIL_STATUS_KEY, type WebsiteEmailStatus } from "@/components/dashboard/WebsiteEmailLaneCard";
import { PROGRAM_LABELS, WEBSITE_SOURCE_LABELS } from "@/lib/website-email-reasons";

interface RevisionPreview {
  revisionId: number;
  program: string;
  state: string;
  snapshotHash: string;
  sourceSequence: { id: number | null; name: string | null };
  unsupportedSteps: Array<{ stepOrder: number; actionType: string; reason: string }>;
  steps: Array<{ order: number; delayMinutes: number; subject: string; html: string | null; text: string | null; links: string[]; renderError: string | null }>;
  note: string;
}

const STATE_LABEL: Record<string, string> = { inactive: "Not approved", approved: "Approved", retired: "Retired" };
const UNSUPPORTED_LABEL: Record<string, string> = {
  NON_EMAIL_STEP: "not an email step",
  UNSUPPORTED_STEP_TYPE: "unsupported step type",
  EMAIL_STEP_WITHOUT_CONTENT: "email step without subject or body",
};

const delayText = (minutes: number) =>
  minutes === 0 ? "immediately" : minutes % 1440 === 0 ? `after ${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 ? `after ${minutes / 60} h` : `after ${minutes} min`;

/**
 * Frozen, inactive warm copies of existing sequences for the website email lane. The source sequence is only read: it is
 * never edited, activated, unpaused or enrolled by anything on this panel.
 */
export function WebsiteWarmRevisionsPanel({ canControl, sequences }: { canControl: boolean; sequences: Array<{ id: number; name: string; status?: string }> }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<WebsiteEmailStatus>({ queryKey: WEBSITE_EMAIL_STATUS_KEY });
  const [sequenceId, setSequenceId] = useState<string>("");
  const [program, setProgram] = useState<"requested_followup" | "nurture">("nurture");
  const [previewId, setPreviewId] = useState<number | null>(null);

  const preview = useQuery<RevisionPreview>({
    queryKey: [`/api/admin/website-email/revisions/${previewId}/preview`],
    enabled: previewId !== null,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: WEBSITE_EMAIL_STATUS_KEY });
  const fail = (title: string) => (e: Error) => {
    const code = parseApiRequestError(e.message).code;
    toast({ title, description: code ?? e.message, variant: "destructive" });
  };

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/website-email/revisions", { sequenceId: Number(sequenceId), program })).json(),
    onSuccess: (r: { created?: boolean; unsupported?: unknown[] }) => {
      toast({ title: r.created ? "Frozen copy created" : "An identical frozen copy already exists", description: "The source sequence was not changed." });
      refresh();
    },
    onError: fail("Could not create the frozen copy"),
  });
  const approve = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/admin/website-email/revisions/${id}/approve`, {})).json(),
    onSuccess: () => { toast({ title: "Revision approved", description: "It can be mapped to a source. Nothing is sent." }); refresh(); },
    onError: fail("Could not approve the revision"),
  });
  const retire = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/admin/website-email/revisions/${id}/retire`, {})).json(),
    onSuccess: () => { toast({ title: "Revision retired" }); refresh(); },
    onError: fail("Could not retire the revision"),
  });

  const mapping = data?.lane.sourceProgramMap ?? {};
  const mappedRows = Object.entries(mapping).flatMap(([source, programs]) => Object.entries(programs).map(([prog, id]) => ({ source, program: prog, id })));

  return (
    <Card data-testid="card-website-warm-revisions">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Website follow-up content</CardTitle>
        </div>
        <CardDescription>
          Email-only frozen copies of your sequences for the website follow-up lane. A copy changes nothing about the sequence it came from, which stays paused.
          Mapping a copy to a form is done on the{" "}
          <Link href="/dashboard/outbound-readiness" className="underline">Outbound readiness page</Link>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive" data-testid="text-warm-revisions-error">Website follow-up content could not be loaded.</p>
        ) : (
          <>
            <div data-testid="list-website-source-mapping">
              <p className="text-sm font-medium">Mapped to forms</p>
              {mappedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No form is mapped. The lane has nothing to send for any request.</p>
              ) : (
                <ul className="text-sm">
                  {mappedRows.map((r) => (
                    <li key={`${r.source}-${r.program}`}>{WEBSITE_SOURCE_LABELS[r.source] ?? r.source}: {r.program === "nurture" ? "nurture" : "requested follow-up"} uses revision {r.id}</li>
                  ))}
                </ul>
              )}
            </div>

            {data.warmRevisions.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-warm-revisions">No frozen copies yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-warm-revisions">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Revision</th>
                      <th className="py-1 pr-3 font-medium">Program</th>
                      <th className="py-1 pr-3 font-medium">State</th>
                      <th className="py-1 pr-3 font-medium">Steps</th>
                      <th className="py-1 pr-3 font-medium">Source sequence</th>
                      <th className="py-1 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warmRevisions.map((r) => (
                      <tr key={r.id} className="border-b align-middle" data-testid={`row-warm-revision-${r.id}`}>
                        <td className="py-1 pr-3 font-mono">{r.id}</td>
                        <td className="py-1 pr-3">{r.program === "nurture" ? "Nurture" : "Requested follow-up"}</td>
                        <td className="py-1 pr-3"><Badge variant={r.state === "approved" ? "default" : "secondary"} className="text-xs">{STATE_LABEL[r.state] ?? r.state}</Badge></td>
                        <td className="py-1 pr-3">
                          {r.steps} email{r.steps === 1 ? "" : "s"}
                          {r.unsupportedSteps > 0 && <span className="ml-1 text-destructive" data-testid={`text-unsupported-${r.id}`}>({r.unsupportedSteps} unsupported)</span>}
                        </td>
                        <td className="py-1 pr-3">{sequences.find((s) => s.id === r.sourceSequenceId)?.name ?? (r.sourceSequenceId ? `#${r.sourceSequenceId}` : "none")}</td>
                        <td className="py-1">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="outline" className="min-h-11" onClick={() => setPreviewId(r.id)} data-testid={`button-preview-revision-${r.id}`}>Preview</Button>
                            {canControl && r.state === "inactive" && (
                              <Button size="sm" className="min-h-11" disabled={r.unsupportedSteps > 0 || approve.isPending} onClick={() => approve.mutate(r.id)} data-testid={`button-approve-revision-${r.id}`}>Approve</Button>
                            )}
                            {canControl && r.state !== "retired" && (
                              <Button size="sm" variant="outline" className="min-h-11" disabled={retire.isPending} onClick={() => retire.mutate(r.id)} data-testid={`button-retire-revision-${r.id}`}>Retire</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canControl ? (
              <div className="space-y-3 border-t pt-4" data-testid="section-create-warm-revision">
                <p className="text-sm font-medium">Create a frozen copy</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="warm-source-sequence">Source sequence</Label>
                    <Select value={sequenceId} onValueChange={setSequenceId}>
                      <SelectTrigger id="warm-source-sequence" className="min-h-11" data-testid="select-warm-source-sequence"><SelectValue placeholder="Choose a sequence" /></SelectTrigger>
                      <SelectContent>
                        {sequences.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="warm-program">Program</Label>
                    <Select value={program} onValueChange={(v) => setProgram(v as typeof program)}>
                      <SelectTrigger id="warm-program" className="min-h-11" data-testid="select-warm-program"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nurture">Nurture</SelectItem>
                        <SelectItem value="requested_followup">Requested follow-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{PROGRAM_LABELS[program]}. SMS, call and other non-email steps are listed as unsupported and block approval.</p>
                <Button className="min-h-11" disabled={!sequenceId || create.isPending} onClick={() => create.mutate()} data-testid="button-create-warm-revision">
                  {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Create frozen copy
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Only an administrator can create, approve or retire a copy.</p>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={previewId !== null} onOpenChange={(o) => { if (!o) setPreviewId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="dialog-warm-revision-preview">
          <DialogHeader>
            <DialogTitle>Revision {previewId} preview</DialogTitle>
            <DialogDescription>{preview.data?.note ?? "Rendered with a sample contact."}</DialogDescription>
          </DialogHeader>
          {preview.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : preview.isError || !preview.data ? (
            <p className="text-sm text-destructive" data-testid="text-warm-preview-error">The preview could not be loaded.</p>
          ) : (
            <div className="space-y-5">
              {preview.data.unsupportedSteps.length > 0 && (
                <div className="rounded-md border border-destructive/50 p-3 text-sm" data-testid="list-warm-unsupported-steps">
                  <p className="font-medium">Steps that cannot be sent by this lane (approval is blocked):</p>
                  <ul className="list-disc pl-5">
                    {preview.data.unsupportedSteps.map((u) => (
                      <li key={u.stepOrder}>Step {u.stepOrder}: {u.actionType}, {UNSUPPORTED_LABEL[u.reason] ?? u.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.data.steps.map((step) => (
                <section key={step.order} className="space-y-2" data-testid={`section-warm-step-${step.order}`}>
                  <h3 className="text-sm font-semibold">Email {step.order + 1}, {delayText(step.delayMinutes)}</h3>
                  {step.renderError ? (
                    <p className="text-sm text-destructive" data-testid={`text-warm-step-error-${step.order}`}>This step would be refused at send time: {step.renderError}.</p>
                  ) : (
                    <>
                      <p className="text-sm"><span className="text-muted-foreground">Subject: </span>{step.subject}</p>
                      <iframe
                        title={`HTML preview of email ${step.order + 1}`}
                        sandbox=""
                        srcDoc={step.html ?? ""}
                        className="h-56 w-full rounded-md border bg-white"
                        data-testid={`iframe-warm-step-${step.order}`}
                      />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Plain-text version</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs" data-testid={`text-warm-plain-${step.order}`}>{step.text}</pre>
                      </div>
                      <div data-testid={`list-warm-links-${step.order}`}>
                        <p className="text-xs font-medium text-muted-foreground">Links</p>
                        {step.links.length === 0 ? <p className="text-xs text-muted-foreground">No links.</p> : (
                          <ul className="break-all text-xs">{step.links.map((l, i) => <li key={`${l}-${i}`}>{l}</li>)}</ul>
                        )}
                      </div>
                    </>
                  )}
                </section>
              ))}
              <p className="break-all text-xs text-muted-foreground">Content fingerprint {preview.data.snapshotHash}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
