import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getApiErrorMessage } from "@/lib/ghlTruth";
import { FinalEmailPreview, type FinalMessagePreview } from "./MessageFinalPreview";

type Group = "current_sfp" | "sales_library" | "merchant_lifecycle" | "history" | "diagnostics";
const GROUPS: Array<{ key: Group; label: string; help: string }> = [
  { key: "current_sfp", label: "Current SFP", help: "The live South Florida packages, resolved from the package record at request time." },
  { key: "sales_library", label: "Sales library", help: "Reusable sales and education content. Reuse after review; nothing here is activated by viewing it." },
  { key: "merchant_lifecycle", label: "Merchant lifecycle", help: "Onboarding, service and relationship content. Keep its event and account-relationship purpose." },
  { key: "history", label: "History", help: "Superseded or retired content. Read-only." },
  { key: "diagnostics", label: "Diagnostics", help: "Test-labelled content with its dependencies. Nothing is deleted or retired by name." },
];

interface Row { assetType: "campaign" | "sequence"; id: number; name: string; status: string | null; steps: number; reason: string; enrollments?: { total: number; active: number; started: number } }
interface Overview {
  capturedAt: string;
  currentPackages: Array<{ packageKey: string; vertical: string; campaignId: number; sequenceId: number; contentHash: string; campaignName: string; sequenceName: string; steps: number; stepDays: number[]; startedJourneys: number; activeEnrollments: number }>;
  groups: Record<Group, Row[]>;
  counts: Record<Group, number> & { campaigns: number; sequences: number; campaignSteps: number; sequenceSteps: number };
}
interface DraftTouch { family: string; vertical: string; touch: number; day: number; cta: string; subject: string; body: string; resolvedBody: string | null; unresolvedReason: string | null }
interface Drafts { status: string; note: string; families: Array<{ family: string; vertical: string; touches: DraftTouch[] }>; problems: Array<{ family: string; problem: string }> }

const PAGE = 50;

function initialGroup(): Group {
  const q = new URLSearchParams(window.location.search).get("content");
  return GROUPS.some((g) => g.key === q) ? (q as Group) : "current_sfp";
}

function DraftPreview({ touch }: { touch: DraftTouch }) {
  const preview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/message-steps/final-preview", { subject: touch.subject, body: touch.resolvedBody!, transport: "sfp_smtp" })).json() as Promise<{ ok: boolean; error: { detail: string } | null; final: FinalMessagePreview | null }>,
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words" data-testid={`draft-body-${touch.family}-${touch.touch}`}>{touch.body}</p>
      {touch.unresolvedReason && <p className="text-xs text-destructive">Link unavailable: {touch.unresolvedReason}</p>}
      <Button variant="outline" size="sm" className="min-h-11" disabled={!touch.resolvedBody || preview.isPending} onClick={() => preview.mutate()} data-testid={`button-preview-draft-${touch.family}-${touch.touch}`}>
        {preview.isPending ? "Rendering..." : "Preview as SFP email"}
      </Button>
      {preview.isError && <p className="text-xs text-destructive">{getApiErrorMessage(preview.error, "Could not render preview")}</p>}
      {preview.data && (preview.data.ok && preview.data.final ? <FinalEmailPreview final={preview.data.final} /> : <p className="text-xs text-destructive">{preview.data.error?.detail ?? "Preview failed"}</p>)}
    </div>
  );
}

function RowTable({ rows, group }: { rows: Row[]; group: Group }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Filter by name" aria-label="Filter by name" data-testid={`input-filter-${group}`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-content-${group}`}>
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Type</th><th className="pr-2">Name</th><th className="pr-2">Status</th><th className="pr-2">Steps</th><th className="pr-2">Journeys</th><th>Why here</th></tr></thead>
          <tbody>
            {filtered.slice(0, shown).map((r) => (
              <tr key={`${r.assetType}-${r.id}`} className="border-t align-top">
                <td className="py-1 pr-2">{r.assetType}</td>
                <td className="pr-2 break-words max-w-[22rem]">{r.name} <span className="text-xs text-muted-foreground">#{r.id}</span></td>
                <td className="pr-2">{r.status ?? "-"}</td>
                <td className="pr-2">{r.steps}</td>
                <td className="pr-2">{r.enrollments ? `${r.enrollments.started} started / ${r.enrollments.total}` : "-"}</td>
                <td className="text-xs text-muted-foreground">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} row{filtered.length === 1 ? "" : "s"}{filtered.length > shown ? `, showing ${shown}` : ""}</p>
      {filtered.length > shown && <Button variant="outline" className="min-h-11" onClick={() => setShown((n) => n + PAGE)}>Show more</Button>}
    </div>
  );
}

export function ContentWorkspace({ canView }: { canView: boolean }) {
  const [tab, setTab] = useState<Group>(initialGroup);
  const overview = useQuery<Overview>({ queryKey: ["/api/content-workspace/overview"], enabled: canView });
  const drafts = useQuery<Drafts>({ queryKey: ["/api/content-workspace/premium-drafts"], enabled: canView });
  if (!canView) return null;
  const onTab = (v: string) => {
    setTab(v as Group);
    const u = new URL(window.location.href);
    u.searchParams.set("content", v);
    window.history.replaceState(null, "", u.toString());
  };
  const o = overview.data;
  return (
    <Card data-testid="card-content-workspace">
      <CardHeader>
        <CardTitle>Campaign and sequence content</CardTitle>
        <CardDescription>A read-only map of campaigns and sequences. Viewing or previewing never activates, enrolls, sends or books.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          : overview.isError || !o ? <p className="text-sm text-destructive">{getApiErrorMessage(overview.error, "Could not load content overview")}</p>
          : (
            <Tabs value={tab} onValueChange={onTab}>
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {GROUPS.map((g) => <TabsTrigger key={g.key} value={g.key} className="min-h-11" data-testid={`tab-content-${g.key}`}>{g.label} ({o.counts[g.key]})</TabsTrigger>)}
              </TabsList>
              {GROUPS.map((g) => (
                <TabsContent key={g.key} value={g.key} className="space-y-3">
                  <p className="text-sm text-muted-foreground">{g.help}</p>
                  {g.key === "current_sfp" ? (
                    <div className="space-y-4">
                      {o.currentPackages.length === 0
                        ? <p className="text-sm text-muted-foreground" data-testid="text-no-current-packages">No current SFP package is recorded in this environment.</p>
                        : <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="table-current-packages">
                          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Package</th><th className="pr-2">Campaign</th><th className="pr-2">Sequence</th><th className="pr-2">Cadence (days)</th><th className="pr-2">Journeys started</th><th>Content hash</th></tr></thead>
                          <tbody>{o.currentPackages.map((p) => (
                            <tr key={p.packageKey} className="border-t align-top">
                              <td className="py-1 pr-2">{p.vertical}</td>
                              <td className="pr-2">#{p.campaignId} {p.campaignName}</td>
                              <td className="pr-2">#{p.sequenceId} {p.sequenceName}</td>
                              <td className="pr-2">{p.stepDays.join(" / ") || "-"}</td>
                              <td className="pr-2">{p.startedJourneys}{p.startedJourneys > 0 && <Badge variant="outline" className="ml-1 text-xs">protected</Badge>}</td>
                              <td className="font-mono text-xs">{p.contentHash.slice(0, 12)}</td>
                            </tr>))}</tbody></table></div>}
                      <div className="space-y-2" data-testid="premium-drafts">
                        <p className="text-sm font-medium">Proposed premium five-touch drafts</p>
                        <Alert><AlertDescription>
                          {drafts.data?.note ?? "Proposed wording only."} These are not adopted into any package yet: replacing a package's steps needs the package publication flow, which is not available here.
                        </AlertDescription></Alert>
                        {drafts.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                        {drafts.data?.problems.length ? <p className="text-xs text-destructive">{drafts.data.problems.length} draft check problem(s) found.</p> : null}
                        {drafts.data?.families.map((f) => (
                          <details key={f.family} className="rounded-md border p-3" data-testid={`draft-family-${f.family}`}>
                            <summary className="cursor-pointer text-sm font-medium min-h-11 flex items-center">{f.vertical} <span className="ml-2 text-xs text-muted-foreground">{f.touches.length} touches</span></summary>
                            <div className="space-y-4 pt-2">
                              {f.touches.map((t) => (
                                <div key={t.touch} className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
                                  <p className="text-sm">Touch {t.touch} - day {t.day} - {t.cta.replace(/_/g, " ")}: <span className="font-medium">{t.subject}</span></p>
                                  <DraftPreview touch={t} />
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : <RowTable rows={o.groups[g.key]} group={g.key} />}
                </TabsContent>
              ))}
            </Tabs>
          )}
      </CardContent>
    </Card>
  );
}
