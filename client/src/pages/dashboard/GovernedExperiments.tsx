import { Phase7CopyInventory } from "./Phase7CopyInventory";
import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import {
  FinalEmailPreview,
  type FinalMessagePreview,
} from "@/components/dashboard/MessageFinalPreview";
import { phase7DesignSchema } from "@shared/phase7-experiment";
const experiment = z
  .object({
    id: z.string().uuid(),
    key: z.string(),
    state: z.string(),
    revision: z.number().int().positive(),
    phase7_design: phase7DesignSchema.nullable(),
    started_at: z.string().nullable(),
    collection_ends_at: z.string().nullable(),
    maturity_ends_at: z.string().nullable(),
    decision: z.string().nullable(),
  })
  .passthrough();
const detail = experiment.extend({
  evaluations: z.array(
    z.object({
      id: z.string().uuid(),
      snapshot: z
        .object({
          recommendation: z.enum(["winner_a", "winner_b", "inconclusive"]),
          A: z.object({ n: z.number(), success: z.number() }),
          B: z.object({ n: z.number(), success: z.number() }),
          pValue: z.number(),
          adjustedAlpha: z.number(),
          difference: z.number(),
          effectInterval: z.array(z.number()),
          imbalance: z.boolean(),
        })
        .passthrough(),
    }),
  ),
  measurementStatus: z.string(),
  telemetry: z.object({ status: z.string(), reason: z.string() }),
  progress: z.array(
    z.object({
      arm: z.enum(["A", "B"]),
      allocated: z.number(),
      exposed: z.number(),
      qualified: z.number(),
    }),
  ),
  receipts: z.array(
    z.object({
      id: z.string().uuid(),
      provider_message_id: z.string(),
      kind: z.string(),
      reason: z.string(),
      occurred_at: z.string().nullable(),
      classification: z.string().nullable(),
    }),
  ),
});
export default function GovernedExperiments() {
  const { user } = useAuth();
  const search = useSearch(),
    [, navigate] = useLocation(),
    params = new URLSearchParams(search),
    selections = [...new Set(params.getAll("outreachExperiment"))];
  const validSelection =
    selections.length <= 1 &&
    (!selections.length || z.string().uuid().safeParse(selections[0]).success);
  const selected = validSelection ? (selections[0] ?? null) : null;
  const setSelected = (id: string) => {
    const p = new URLSearchParams(search);
    p.set("tab", "outreach-analytics");
    p.set("outreachView", "ab-testing");
    p.set("outreachExperiment", id);
    navigate("/dashboard/reporting?" + p.toString() + window.location.hash);
  };
  const [notice, setNotice] = useState(""),
    [showDraft, setShowDraft] = useState(false);
  const list = useCrmQuery({
    queryKey: ["/api/admin/cro07/experiments"],
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/admin/cro07/experiments", {
        credentials: "include",
        signal,
      });
      if (!r.ok) throw new Error("Experiment records unavailable");
      return z.array(experiment).parse(await r.json());
    },
  });
  const current = useCrmQuery({
    queryKey: ["/api/admin/cro07/experiments", selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/admin/cro07/experiments/" + selected, {
        credentials: "include",
        signal,
      });
      if (!r.ok) throw new Error("Experiment detail unavailable");
      return detail.parse(await r.json());
    },
  });
  const preview = useCrmQuery({
    queryKey: ["/api/admin/cro07/experiments", selected, "preview"],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const r = await fetch(
        `/api/admin/cro07/experiments/${selected}/preview`,
        { credentials: "include", signal },
      );
      if (!r.ok) throw new Error("Final preview unavailable");
      return r.json() as Promise<{
        available: boolean;
        previews?: Record<
          string,
          {
            ok: boolean;
            final: FinalMessagePreview | null;
            error?: { code: string };
          }
        >;
      }>;
    },
  });
  const [reviewReason, setReviewReason] = useState("");
  const [draft, setDraft] = useState({
    key: "",
    vertical: "",
    sourceSequenceId: "",
    challengerSubject: "",
    touch2: "",
    touch3: "",
  });
  const mutation = useMutation({
    mutationFn: async (input: {
      op: string;
      extra?: Record<string, unknown>;
    }) => {
      if (!user?.id || !user.accountVersion)
        throw new Error("Refresh your account before issuing a command.");
      const body = {
        commandId: crypto.randomUUID(),
        expectedActorId: user.id,
        expectedAccountVersion: user.accountVersion,
        expectedVersion:
          input.op === "draft" ? 1 : (current.data?.revision ?? 1),
        ...input.extra,
      };
      const path =
        input.op === "draft"
          ? "/api/admin/cro07/phase7/drafts"
          : `/api/admin/cro07/experiments/${selected}/${input.op}`;
      const r = await apiRequest("POST", path, body);
      return r.json();
    },
    onSuccess: (r) => {
      setNotice(
        r.state === "insufficient_data"
          ? "Insufficient sample or immature outcomes; no winner was selected."
          : "Command recorded. Approval, publication and recipient release remain separate.",
      );
      void list.refetch();
      void current.refetch();
      if (r.experiment) {
        setSelected(r.experiment.id);
        setShowDraft(false);
      }
    },
    onError: (e) => {
      setNotice(e.message + " Refresh to resolve stale versions.");
    },
  });
  const e = current.data,
    d = e?.phase7_design,
    snapshot = e?.evaluations[0];
  return (
    <section
      className="space-y-4 min-w-0"
      aria-label="Governed A/B experiments"
    >
      {!validSelection && (
        <CrmDataState
          state="conflict"
          message="Invalid or conflicting experiment selection. No detail has been requested."
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Subject experiments</h3>
          <p className="text-sm text-muted-foreground">
            Frozen two-arm designs. Distinct exposed businesses and verified
            qualified replies determine results. Opens and clicks are diagnostic
            only.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          data-testid="button-refresh-ab"
          onClick={() => {
            void list.refetch();
            if (selected) {
              void current.refetch();
              void preview.refetch();
            }
          }}
        >
          Refresh A/B data
        </Button>
      </div>
      <p className="rounded-md border p-3 text-sm">
        Creating a draft or evaluating results does not enroll recipients,
        approve copy, publish content, or authorize sending. Legacy counters
        remain history and cannot select a governed winner.
      </p>
      {notice && (
        <p role="status" className="text-sm break-words">
          {notice}
        </p>
      )}
      {list.isLoading ? (
        <CrmDataState state="loading" message="Loading governed experiments…" />
      ) : list.isError ? (
        <CrmDataState
          state="unavailable"
          message="Experiment evidence unavailable; no empty or zero result is inferred."
          onRetry={() => void list.refetch()}
        />
      ) : list.data?.length === 0 ? (
        <CrmDataState
          state="empty"
          message="No governed experiments. Prepare reviewed subject-only drafts before freezing a design."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.data?.map((x) => (
            <Button
              key={x.id}
              variant={selected === x.id ? "secondary" : "outline"}
              className="min-h-16 h-auto text-left justify-start whitespace-normal break-words p-3"
              onClick={() => setSelected(x.id)}
            >
              <span>
                {x.key}
                <br />
                <span className="text-xs font-normal">
                  {x.phase7_design ? x.state : "Legacy · unverified"} · revision{" "}
                  {x.revision}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
      {selected &&
        (current.isLoading ? (
          <CrmDataState
            state="loading"
            message="Loading frozen design and receipts…"
          />
        ) : current.isError ? (
          <CrmDataState
            state="unavailable"
            message="Detail unavailable. No command can use a missing revision."
            onRetry={() => void current.refetch()}
          />
        ) : (
          e && (
            <Card>
              <CardHeader>
                <CardTitle className="break-words">{e.key}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!d ? (
                  <p>
                    Legacy experiment retained as unverified history. It cannot
                    allocate or promote content.
                  </p>
                ) : (
                  <>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="font-semibold">Design</dt>
                        <dd>
                          {d.vertical} · subject only · 50/50 per canonical
                          business
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Primary metric</dt>
                        <dd>
                          Verified qualified replies / distinct exposed
                          businesses
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Fixed horizon</dt>
                        <dd>
                          {d.collectionDays} collection days +{" "}
                          {d.outcomeMaturityDays} maturity days;{" "}
                          {d.minPerArm.toLocaleString()} exposed businesses per
                          arm
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Method</dt>
                        <dd>
                          Two-sided Fisher exact test; family-adjusted α{" "}
                          {(d.alpha / d.comparisonFamilySize).toFixed(4)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Collection end</dt>
                        <dd>
                          {e.collection_ends_at
                            ? new Date(e.collection_ends_at).toLocaleString()
                            : "Not started"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Outcome maturity</dt>
                        <dd>
                          {e.maturity_ends_at
                            ? new Date(e.maturity_ends_at).toLocaleString()
                            : "Not started"}
                        </dd>
                      </div>
                    </dl>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <caption className="text-left py-2">
                          Canonical businesses · accepted/sent receipt exposure;
                          confirmed delivery is a separate event.
                        </caption>
                        <thead>
                          <tr>
                            <th className="text-left p-2">Arm</th>
                            <th className="p-2">Allocated</th>
                            <th className="p-2">Exposed</th>
                            <th className="p-2">Qualified</th>
                            <th className="p-2">Qualified rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["A", "B"] as const).map((arm) => {
                            const p = e.progress.find((p) => p.arm === arm);
                            return (
                              <tr key={arm} className="border-t">
                                <th className="text-left p-2">{arm}</th>
                                <td className="text-center p-2">
                                  {p?.allocated ?? 0}
                                </td>
                                <td className="text-center p-2">
                                  {p?.exposed ?? 0}
                                </td>
                                <td className="text-center p-2">
                                  {p?.qualified ?? 0}
                                </td>
                                <td className="text-center p-2">
                                  {p?.exposed &&
                                  e.telemetry.status === "complete"
                                    ? ((p.qualified / p.exposed) * 100).toFixed(
                                        2,
                                      ) + "%"
                                    : "Unavailable"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p role="status" className="text-sm">
                      Feedback coverage: {e.telemetry.status}.{" "}
                      {e.telemetry.reason} Counts show retained observations;
                      rates are unavailable until coverage is certified.
                    </p>
                    <div className="text-sm space-y-1">
                      <h4 className="font-semibold">Frozen safety stops</h4>
                      {d.guardrails.map((g) => (
                        <p key={g.metric}>
                          {g.metric}: stop above {(100 * g.maxRate).toFixed(2)}%
                          of distinct attempted businesses after{" "}
                          {g.minimumEvidence} attempts.
                        </p>
                      ))}
                    </div>
                    {e.receipts.length > 0 && (
                      <details>
                        <summary className="min-h-11 cursor-pointer">
                          Message-linked reply evidence · latest 100
                        </summary>
                        <p className="text-sm">
                          Automated, unmatched and ambiguous messages cannot be
                          qualified. Review the actual conversation before
                          recording business intent.
                        </p>
                        {user?.role === "admin" && (
                          <div>
                            <Label htmlFor="qualification-reason">
                              Review evidence and reason
                            </Label>
                            <textarea
                              id="qualification-reason"
                              minLength={20}
                              maxLength={2000}
                              className="w-full min-h-24 rounded border p-3 bg-background"
                              value={reviewReason}
                              onChange={(ev) =>
                                setReviewReason(ev.target.value)
                              }
                            />
                          </div>
                        )}
                        {e.receipts.map((r) => (
                          <div
                            key={r.id}
                            className="border-t py-3 space-y-2 text-sm"
                          >
                            <p>
                              {r.kind} · {r.reason} ·{" "}
                              {r.classification ?? "Not reviewed"}
                            </p>
                            <a
                              className="inline-flex min-h-11 items-center underline"
                              target="_blank"
                              rel="noreferrer"
                              href={
                                "https://mail.google.com/mail/u/0/#all/" +
                                encodeURIComponent(r.provider_message_id)
                              }
                            >
                              Inspect message in Gmail
                            </a>
                            {user?.role === "admin" &&
                              e.state === "collecting" &&
                              r.kind === "reply" &&
                              !r.classification &&
                              r.reason ===
                                "EXACT_MESSAGE_ACCOUNT_AND_RECIPIENT" && (
                                <div className="flex flex-wrap gap-2">
                                  {(
                                    ["qualified", "not_qualified"] as const
                                  ).map((classification) => (
                                    <Button
                                      key={classification}
                                      className="min-h-11"
                                      variant="outline"
                                      disabled={
                                        mutation.isPending ||
                                        reviewReason.trim().length < 20
                                      }
                                      onClick={() =>
                                        mutation.mutate({
                                          op: "qualify-reply",
                                          extra: {
                                            receiptId: r.id,
                                            classification,
                                            reason: reviewReason,
                                          },
                                        })
                                      }
                                    >
                                      {classification === "qualified"
                                        ? "Record qualified reply"
                                        : "Record non-qualified reply"}
                                    </Button>
                                  ))}
                                </div>
                              )}
                          </div>
                        ))}
                      </details>
                    )}
                    <p className="text-sm">
                      Planning assumptions:{" "}
                      {(100 * d.planning.baselineRate).toFixed(1)}% baseline and{" "}
                      {(100 * d.planning.minimumDetectableEffect).toFixed(1)}{" "}
                      percentage point effect. These are not observed
                      performance.
                    </p>
                    {snapshot ? (
                      <div className="space-y-2 text-sm">
                        <h4 className="font-semibold">Immutable evaluation</h4>
                        <p>
                          A: {snapshot.snapshot.A.success}/
                          {snapshot.snapshot.A.n} · B:{" "}
                          {snapshot.snapshot.B.success}/{snapshot.snapshot.B.n}{" "}
                          · p={snapshot.snapshot.pValue.toPrecision(4)}
                        </p>
                        <p>
                          Recommendation: {snapshot.snapshot.recommendation}.
                          Absolute B−A difference:{" "}
                          {(snapshot.snapshot.difference * 100).toFixed(2)}{" "}
                          points; interval{" "}
                          {snapshot.snapshot.effectInterval
                            .map((v) => (v * 100).toFixed(2))
                            .join(" to ")}{" "}
                          points.
                          {snapshot.snapshot.imbalance
                            ? " Sample-ratio imbalance holds a winner."
                            : ""}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm">
                        No completed fixed-horizon evaluation. Missing telemetry
                        is unknown; it is not a zero-success result.
                      </p>
                    )}
                    {user?.role === "admin" && (
                      <div className="flex flex-wrap gap-2">
                        {e.state === "draft_design" && (
                          <Button
                            disabled={mutation.isPending}
                            className="min-h-11"
                            onClick={() => mutation.mutate({ op: "freeze" })}
                          >
                            Freeze approved design
                          </Button>
                        )}
                        {e.state === "collecting" && (
                          <Button
                            disabled={mutation.isPending}
                            className="min-h-11"
                            onClick={() => mutation.mutate({ op: "evaluate" })}
                          >
                            Evaluate results
                          </Button>
                        )}
                        {["frozen_design", "collecting"].includes(e.state) && (
                          <Button
                            variant="outline"
                            disabled={mutation.isPending}
                            className="min-h-11"
                            onClick={() =>
                              mutation.mutate({
                                op: "stop",
                                extra: { state: "cancelled" },
                              })
                            }
                          >
                            Stop experiment
                          </Button>
                        )}
                        {e.state === "ready_for_review" && snapshot && (
                          <Button
                            disabled={mutation.isPending}
                            className="min-h-11"
                            onClick={() =>
                              mutation.mutate({
                                op: "decide",
                                extra: {
                                  evaluationId: snapshot.id,
                                  decision: snapshot.snapshot.recommendation,
                                },
                              })
                            }
                          >
                            Accept recommendation
                            {snapshot.snapshot.recommendation.startsWith(
                              "winner",
                            )
                              ? " into new draft"
                              : ""}
                          </Button>
                        )}
                      </div>
                    )}
                    {preview.isError ? (
                      <CrmDataState
                        state="unavailable"
                        message="Final branded previews unavailable."
                        onRetry={() => void preview.refetch()}
                      />
                    ) : preview.isLoading ? (
                      <CrmDataState
                        state="loading"
                        message="Composing both subject previews…"
                      />
                    ) : (
                      preview.data?.previews && (
                        <div className="space-y-4">
                          {Object.entries(preview.data.previews).map(
                            ([arm, p]) => (
                              <div key={arm} className="min-w-0">
                                <h4 className="font-semibold mb-2">
                                  Arm {arm} · final transport preview
                                </h4>
                                {p.ok && p.final ? (
                                  <FinalEmailPreview final={p.final} />
                                ) : (
                                  <p role="status">
                                    Rendering held:{" "}
                                    {p.error?.code ?? "unavailable"}
                                  </p>
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )
        ))}
      {user?.role === "admin" && (
        <>
          <Phase7CopyInventory
            onSelect={(candidate) => {
              setDraft(candidate);
              setShowDraft(true);
            }}
          />
          <Button
            variant="outline"
            className="min-h-11"
            aria-expanded={showDraft}
            onClick={() => setShowDraft((v) => !v)}
          >
            Prepare review-only copy draft
          </Button>
          {showDraft && (
            <form
              className="space-y-3 rounded-lg border p-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                mutation.mutate({
                  op: "draft",
                  extra: {
                    key: draft.key,
                    vertical: draft.vertical,
                    sourceSequenceId: Number(draft.sourceSequenceId),
                    challengerSubject: draft.challengerSubject,
                    followupBodies: [draft.touch2, draft.touch3],
                  },
                });
              }}
            >
              <p className="text-sm">
                Use the installed-copy inventory and real eligibility readback
                before choosing three volume-based pilots. Source must be an
                unchanged, paused three-email sequence. Both first-touch bodies
                and the existing relative cadence are preserved.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    "key",
                    "vertical",
                    "sourceSequenceId",
                    "challengerSubject",
                  ] as const
                ).map((k) => (
                  <div key={k}>
                    <Label htmlFor={"experiment-" + k}>
                      {
                        {
                          key: "Draft identity",
                          vertical: "Canonical vertical",
                          sourceSequenceId: "Source sequence ID",
                          challengerSubject: "Challenger subject",
                        }[k]
                      }
                    </Label>
                    <Input
                      id={"experiment-" + k}
                      required
                      className="min-h-11 text-base"
                      type={k === "sourceSequenceId" ? "number" : "text"}
                      value={draft[k]}
                      onChange={(ev) =>
                        setDraft((v) => ({ ...v, [k]: ev.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              {(["touch2", "touch3"] as const).map((k, i) => (
                <div key={k}>
                  <Label htmlFor={"experiment-" + k}>
                    Revised touch {i + 2} body
                  </Label>
                  <textarea
                    id={"experiment-" + k}
                    required
                    className="w-full min-h-32 rounded-md border p-3 bg-background text-base"
                    value={draft[k]}
                    onChange={(ev) =>
                      setDraft((v) => ({ ...v, [k]: ev.target.value }))
                    }
                  />
                </div>
              ))}
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="min-h-11"
              >
                Save CR-06 review package and draft experiment
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
