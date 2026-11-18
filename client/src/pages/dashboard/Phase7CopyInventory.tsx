import { useState } from "react";
import { z } from "zod";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { Button } from "@/components/ui/button";
import { CrmDataState } from "@/components/crm/CrmPresentation";
const row = z.object({
  owner: z.string(),
  asset_id: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number().nullable(),
  step_id: z.string(),
  step_order: z.number(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  delay_days: z.number().nullable(),
  delay_hours: z.number().nullable(),
  contentHash: z.string(),
  disposition: z.string(),
  findings: z
    .array(z.object({ rule: z.string(), match: z.string(), why: z.string() }))
    .default([]),
});
const contract = z.object({
  asOf: z.string(),
  complete: z.boolean(),
  rows: z.array(row),
  pins: z.array(
    z.object({
      sequence_id: z.number(),
      vertical: z.string(),
      lifecycle_state: z.string(),
    }),
  ),
});
export type ReviewCopyDraft = {
  key: string;
  vertical: string;
  sourceSequenceId: string;
  challengerSubject: string;
  touch2: string;
  touch3: string;
};
export function Phase7CopyInventory({
  onSelect,
}: {
  onSelect: (draft: ReviewCopyDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const inventory = useCrmQuery({
    queryKey: ["/api/admin/cro07/phase7/inventory"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/admin/cro07/phase7/inventory", {
        credentials: "include",
        signal,
      });
      if (!r.ok) throw new Error("Installed copy inventory unavailable");
      return contract.parse(await r.json());
    },
  });
  const eligibility = useCrmQuery({
    queryKey: ["/api/admin/cro07/phase7/eligibility"],
    enabled: false,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/admin/cro07/phase7/eligibility", {
        credentials: "include",
        signal,
      });
      if (!r.ok)
        throw new Error(
          "Eligibility authority unavailable; no pilot ranking can be established",
        );
      return z
        .object({
          asOf: z.string(),
          selection: z.literal("volume_based_pilot_not_conversion_winner"),
          rankedVerticals: z.array(
            z.object({
              vertical: z.string(),
              eligibleBusinesses: z.number().int().nonnegative(),
            }),
          ),
          inventory: z
            .object({
              releaseBlockers: z.array(
                z
                  .object({
                    key: z.string(),
                    state: z.enum(["blocked", "ok", "unknown"]),
                    label: z.string().optional(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        })
        .parse(await r.json());
    },
  });
  const select = (sequenceId: number, vertical: string) => {
    const subject =
      vertical === "Healthcare"
        ? "Patient-payment processing at {{companyName}}"
        : vertical === "Automotive"
          ? "A review of repair-invoice card fees"
          : vertical === "Beauty/Spa"
            ? "A review of card payments and tips"
            : vertical === "Construction/Trades/Home Services"
              ? "A review of invoice and deposit card fees"
              : "A statement review for {{companyName}}";
    const context =
      vertical === "Healthcare"
        ? "patient-payment processing"
        : vertical === "Automotive"
          ? "card-paid repair invoices"
          : vertical === "Beauty/Spa"
            ? "card payments, tips and any recurring charges"
            : vertical === "Construction/Trades/Home Services"
              ? "card-paid invoices and deposits"
              : "card-payment processing";
    const cta = "https://libertybancard.com/upload-statement";
    onSelect({
      key: "phase7-" + sequenceId + "-" + new Date().toISOString().slice(0, 10),
      vertical,
      sourceSequenceId: String(sequenceId),
      challengerSubject: subject,
      touch2: `Hello,\n\nFollowing up on my note about ${context} at {{companyName}}. A statement review can separate network costs, processor markup and fixed fees using the same transaction volume.\n\nIf a breakdown would be useful, you can request a review at ${cta}. Please use the secure form rather than emailing financial documents.`,
      touch3: `Hello,\n\nThis is my final follow-up about reviewing ${context} at {{companyName}}. If a fee breakdown would help later, you can request a review at ${cta}.\n\nNo need to reply if the timing is not right.`,
    });
  };
  return (
    <section className="space-y-3 border rounded-lg p-3">
      <Button
        variant="outline"
        className="min-h-11"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Installed copy inventory and pilot eligibility
      </Button>
      {open && (
        <>
          <p className="text-sm">
            All installed sequence, campaign and template steps are retained
            with stable identity and content hashes. Selection is based on
            distinct eligible businesses from the existing readiness authority,
            and does not identify conversion winners.
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={eligibility.isFetching}
            onClick={() => void eligibility.refetch()}
          >
            {eligibility.isFetching
              ? "Reading eligibility…"
              : "Run read-only eligibility check"}
          </Button>
          {eligibility.isError && (
            <CrmDataState
              state="unavailable"
              message={eligibility.error.message}
              onRetry={() => void eligibility.refetch()}
            />
          )}
          {eligibility.data && (
            <div className="text-sm space-y-2">
              <p>
                Eligible-volume snapshot:{" "}
                {new Date(eligibility.data.asOf).toLocaleString()}. Ready-held,
                currently qualified businesses only. No membership or validation
                request is created.
              </p>
              {eligibility.data.rankedVerticals.length === 0 ? (
                <p>
                  No verified eligible volume is available. Pilot selection is
                  held.
                </p>
              ) : (
                <ol className="list-decimal pl-5">
                  {eligibility.data.rankedVerticals.slice(0, 3).map((v) => (
                    <li key={v.vertical}>
                      {v.vertical}: {v.eligibleBusinesses} distinct businesses.
                      Below the frozen sample plan remains insufficient data.
                    </li>
                  ))}
                </ol>
              )}
              <p>
                {eligibility.data.inventory.releaseBlockers
                  .map((b) => b.label ?? b.key)
                  .join(" · ") ||
                  "Recipient release is still a separate authorized action."}
              </p>
            </div>
          )}
          {inventory.isLoading ? (
            <CrmDataState
              state="loading"
              message="Reading installed copy and package pins…"
            />
          ) : inventory.isError ? (
            <CrmDataState
              state="unavailable"
              message={inventory.error.message}
              onRetry={() => void inventory.refetch()}
            />
          ) : (
            inventory.data && (
              <>
                <p className="text-sm">
                  {inventory.data.rows.length} installed steps ·{" "}
                  {inventory.data.complete
                    ? "Complete bounded inventory"
                    : "Partial inventory: do not finalize pilot selection until the remaining inventory is reviewed"}{" "}
                  · {new Date(inventory.data.asOf).toLocaleString()}
                </p>
                <div className="overflow-x-auto max-h-[32rem]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {[
                          "Owner / identity",
                          "Version / state",
                          "Cadence",
                          "Copy / hash",
                          "Review",
                        ].map((v) => (
                          <th key={v} className="text-left p-2">
                            {v}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.data.rows.map((r) => {
                        const pin = inventory.data!.pins.filter(
                          (p) =>
                            p.sequence_id === Number(r.asset_id) &&
                            p.lifecycle_state === "current",
                        );
                        return (
                          <tr
                            key={r.owner + ":" + r.step_id}
                            className="border-t"
                          >
                            <td className="p-2">
                              {r.owner} {r.asset_id} / step {r.step_id}
                              <br />
                              {r.name}
                            </td>
                            <td className="p-2">
                              {r.version ?? "Unversioned"} · {r.status}
                              <br />
                              {r.disposition}
                            </td>
                            <td className="p-2">
                              Touch {r.step_order}; relative {r.delay_days ?? 0}
                              d {r.delay_hours ?? 0}h
                            </td>
                            <td className="p-2">
                              <details>
                                <summary className="min-h-11 cursor-pointer">
                                  {r.subject || "No subject"}
                                </summary>
                                <p className="whitespace-pre-wrap break-words max-w-xl">
                                  {r.body}
                                </p>
                                <p className="font-mono text-xs break-all">
                                  {r.contentHash}
                                </p>
                              </details>
                            </td>
                            <td className="p-2">
                              <div className="mb-2 max-w-xs break-words" data-testid={`copy-findings-${r.owner}-${r.step_id}`}>
                                {r.findings.length ? (
                                  <>
                                    <p className="text-sm font-medium">Automated flags · human review required</p>
                                    <ul className="mt-1 space-y-2 text-sm" aria-label="Copy review findings">
                                      {r.findings.map((finding, index) => (
                                        <li key={`${finding.rule}:${index}`}>
                                          <strong>{finding.rule}</strong>: {finding.why}
                                          <blockquote className="mt-1 border-l-2 pl-2 text-muted-foreground">{finding.match}</blockquote>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : <p className="text-sm text-muted-foreground">No automated flags; approval is separate.</p>}
                              </div>
                              {r.owner === "sequence" &&
                                r.step_order === 1 &&
                                pin.length === 1 &&
                                ["paused", "draft"].includes(r.status) && (
                                  <Button
                                    variant="outline"
                                    className="min-h-11 whitespace-normal h-auto"
                                    disabled={!inventory.data!.complete}
                                    onClick={() =>
                                      select(
                                        Number(r.asset_id),
                                        pin[0].vertical,
                                      )
                                    }
                                  >
                                    Prepare review-only {pin[0].vertical} draft
                                  </Button>
                                )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
