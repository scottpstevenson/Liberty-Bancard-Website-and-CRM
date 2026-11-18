import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  defaultFunnelDates,
  funnelQuerySchema,
  funnelResponseSchema,
  FUNNEL_LABELS,
  type FunnelStage,
} from "@shared/conversion-funnel";
import { funnelFilterKeys } from "@/lib/crm-destination-state";
const keyMap = {
  start: "funnelStart",
  end: "funnelEnd",
  vertical: "funnelVertical",
  rep: "funnelRep",
  source: "funnelSource",
  campaign: "funnelCampaign",
  breakdown: "funnelBreakdown",
  stage: "funnelStage",
  asOf: "funnelAsOf",
  cursor: "funnelCursor",
} as const;
export default function ConversionFunnel() {
  const search = useSearch(),
    [, navigate] = useLocation();
  const params = new URLSearchParams(search),
    raw: Record<string, string> = { ...defaultFunnelDates() };
  let conflict = false;
  for (const [key, param] of Object.entries(keyMap)) {
    const values = [...new Set(params.getAll(param))];
    if (values.length > 1) conflict = true;
    if (values.length) raw[key] = values[0];
  }
  const parsed = funnelQuerySchema.safeParse(raw);
  const valid = parsed.success && !conflict;
  const api = new URLSearchParams(
    valid ? Object.entries(parsed.data).map(([k, v]) => [k, String(v)]) : [],
  );
  const [draft, setDraft] = useState(raw),
    [filterError, setFilterError] = useState("");
  useEffect(() => {
    setDraft(raw);
    setFilterError("");
  }, [search]);
  function update(
    next: Record<string, string | undefined>,
    retainSnapshot = false,
  ) {
    const p = new URLSearchParams(search);
    for (const k of funnelFilterKeys) p.delete(k);
    const merged = { ...raw, ...next };
    if (!retainSnapshot) {
      delete merged.asOf;
      delete merged.cursor;
    }
    for (const [key, param] of Object.entries(keyMap)) {
      const value = merged[key];
      if (value) p.set(param, value);
    }
    p.set("tab", "growth");
    p.set("growthView", "conversion-funnel");
    navigate("/dashboard/reporting?" + p.toString() + window.location.hash);
  }
  const query = useCrmQuery({
    queryKey: ["/api/analytics/conversion-cohort", api.toString()],
    enabled: valid,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/analytics/conversion-cohort?" + api, {
        credentials: "include",
        signal,
      });
      if (!r.ok)
        throw new Error(
          r.status === 403
            ? "Permission denied"
            : "Cohort evidence unavailable",
        );
      return funnelResponseSchema.parse(await r.json());
    },
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const exportParams = new URLSearchParams(api);
  if (data) exportParams.set("asOf", data.meta.asOf);
  exportParams.delete("cursor");
  const percent = (v: number | null) =>
    v == null ? "Unavailable" : (v * 100).toFixed(1) + "%";
  const drill = (stage: FunnelStage) =>
    update({ stage, asOf: data?.meta.asOf, cursor: undefined }, true);
  return (
    <section
      className="space-y-4 min-w-0"
      data-testid="conversion-funnel-report"
      aria-labelledby="conversion-funnel-title"
    >
      <div>
        <h2 id="conversion-funnel-title" className="text-xl font-semibold">
          Conversion Funnel
        </h2>
        <p className="text-sm text-muted-foreground">
          Canonical business sales journeys with ordered, durable milestone
          evidence. Activity counts and earned revenue are separate reports.
        </p>
      </div>
      <div role="status" className="rounded-lg border p-3 text-sm space-y-1">
        <p>
          {data
            ? `${data.meta.completeness === "partial" ? "Partial evidence coverage" : "Complete evidence coverage"} · ${data.entered} entered journeys · America/New_York · Captured ${new Date(data.meta.asOf).toLocaleString("en-US", { timeZone: "America/New_York" })}`
            : "Evidence coverage is not yet available."}
        </p>
        <p>
          Reports do not authorize sending, enrollment, or experiment admission.
        </p>
      </div>
      <form
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const test = funnelQuerySchema.safeParse({
            ...defaultFunnelDates(),
            ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v)),
          });
          if (!test.success) {
            setFilterError(test.error.issues[0].message);
            return;
          }
          update(draft);
        }}
      >
        {(
          ["start", "end", "vertical", "rep", "source", "campaign"] as const
        ).map((k) => (
          <div key={k} className="min-w-0 space-y-1">
            <Label htmlFor={"funnel-" + k}>
              {k === "start"
                ? "Cohort start"
                : k === "end"
                  ? "Cohort end (inclusive)"
                  : k === "rep"
                    ? "Rep at acquisition"
                    : k[0].toUpperCase() + k.slice(1)}
            </Label>
            <Input
              id={"funnel-" + k}
              className="min-h-11 text-base"
              type={k === "start" || k === "end" ? "date" : "text"}
              maxLength={120}
              value={draft[k] ?? ""}
              placeholder="All"
              onChange={(e) => setDraft((v) => ({ ...v, [k]: e.target.value }))}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="funnel-breakdown">Break down by</Label>
          <select
            id="funnel-breakdown"
            className="w-full min-h-11 rounded-md border bg-background px-3 text-base"
            value={draft.breakdown ?? "vertical"}
            onChange={(e) =>
              setDraft((v) => ({ ...v, breakdown: e.target.value }))
            }
          >
            {["vertical", "rep", "source", "campaign"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <Button type="submit" className="min-h-11">
            Apply filters
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            data-testid="funnel-refresh"
            onClick={() => {
              if (valid) {
                if (raw.asOf || raw.cursor)
                  update({ asOf: undefined, cursor: undefined });
                else void query.refetch();
              }
            }}
          >
            Refresh
          </Button>
        </div>
      </form>
      {(filterError || !valid) && (
        <CrmDataState
          state="conflict"
          message={
            filterError ||
            "Invalid or conflicting URL filters. No broader population has been requested."
          }
        />
      )}
      {valid && query.isLoading && (
        <CrmDataState state="loading" message="Loading cohort evidence…" />
      )}
      {valid && query.isError && (
        <CrmDataState
          state="unavailable"
          message={
            query.error.message + `; this is not a zero-conversion result.`
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {valid && data && (
        <>
          {data.entered === 0 && (
            <CrmDataState
              state="empty"
              message="No linked business journeys entered this cohort. Unknown and unlinked evidence is shown separately below; no historical conversion was inferred."
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Seven-stage cohort</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.stages.map((s) => (
                <div
                  key={s.key}
                  className="grid grid-cols-1 sm:grid-cols-[12rem_1fr_5rem] gap-2 items-center"
                >
                  <Button
                    variant="ghost"
                    className="min-h-11 justify-start whitespace-normal h-auto text-left"
                    onClick={() => drill(s.key)}
                  >
                    {s.label}
                  </Button>
                  <div
                    role="img"
                    aria-label={`${s.count} qualified journeys at ${s.label}`}
                    className="h-5 rounded bg-muted overflow-hidden"
                  >
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${data.entered ? (100 * s.count) / data.entered : 0}%`,
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-right">{s.count}</span>
                </div>
              ))}
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <caption className="text-left py-2">
                    Readable equivalent: qualified stages require every
                    preceding milestone in order.
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "Stage",
                        "Qualified",
                        "Observed journeys",
                        "Missing/out of order",
                        "Adjacent rate",
                        "Entry rate",
                      ].map((v) => (
                        <th className="text-left p-2" key={v}>
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.stages.map((s) => (
                      <tr className="border-t" key={s.key}>
                        <th className="text-left p-2">{s.label}</th>
                        <td className="p-2">{s.count}</td>
                        <td className="p-2">{s.observedJourneys}</td>
                        <td className="p-2">{s.missingOrOutOfOrder}</td>
                        <td className="p-2">{percent(s.adjacentRate)}</td>
                        <td className="p-2">{percent(s.entryRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Breakdown by {data.breakdown.by}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Dimensions are frozen at acquisition.{" "}
                {!data.breakdown.complete &&
                  "Showing the first 100 groups; full journey export covers all matching groups."}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr>
                      <th className="text-left p-2">{data.breakdown.by}</th>
                      <th className="text-right p-2">Entered journeys</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakdown.items.map((r) => (
                      <tr key={r.dimension} className="border-t">
                        <td>
                          <Button
                            variant="ghost"
                            className="min-h-11"
                            onClick={() =>
                              update(
                                {
                                  [data.breakdown.by]: r.dimension,
                                  asOf: data.meta.asOf,
                                  cursor: undefined,
                                },
                                true,
                              )
                            }
                          >
                            {r.dimension}
                          </Button>
                        </td>
                        <td className="text-right p-2">{r.entered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                Evidence: {FUNNEL_LABELS[data.drilldown.stage]}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {data.drilldown.total} matching journeys under the same filter
                and observation cutoff.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left p-2">Journey</th>
                      <th className="text-left p-2">Business</th>
                      <th className="text-left p-2">Entry (Eastern)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drilldown.items.map((r) => (
                      <tr key={r.journey_key} className="border-t">
                        <td className="p-2">{r.journey_key}</td>
                        <td className="p-2">{r.business_id}</td>
                        <td className="p-2">
                          {new Date(r.entry_at).toLocaleString("en-US", {
                            timeZone: "America/New_York",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="outline"
                disabled={!data.drilldown.hasMore}
                onClick={() =>
                  update(
                    {
                      cursor: data.drilldown.nextCursor ?? undefined,
                      asOf: data.meta.asOf,
                    },
                    true,
                  )
                }
              >
                Next evidence page
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Coverage and limitations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {data.meta.coverage.observations} raw observations in the date
                window; {data.meta.coverage.unlinked} unlinked;{" "}
                {data.meta.coverage.unknown} unknown-class;{" "}
                {data.meta.coverage.excluded_test} test observations excluded.
              </p>
              {data.meta.sources.map((s) => (
                <p key={s.source_type}>
                  <strong>
                    {s.source_type}: {s.status}.
                  </strong>{" "}
                  {s.reason}
                </p>
              ))}
              {data.meta.limitations.map((x) => (
                <p key={x}>{x}</p>
              ))}
              <Button asChild variant="outline" className="min-h-11">
                <a
                  href={
                    "/api/analytics/conversion-cohort/export?" + exportParams
                  }
                >
                  Export all matching journeys (CSV)
                </a>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
