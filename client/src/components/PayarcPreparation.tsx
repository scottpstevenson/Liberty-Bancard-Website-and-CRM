import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
interface Field {
  type?: string;
  enum?: string[];
}
interface Preparation {
  applicationId: number;
  prepared: boolean;
  canCorrect: boolean;
  fields: Record<string, Field>;
  ownerTitles: string[];
  pricing: Record<string, Record<string, Field>>;
}
const names: Record<string, string> = {
  DiscountRateProgram: "Pricing model",
  bundleRate: "Blended rate",
  interchange: "Interchange plus",
  tiered: "Tiered pricing",
  llc: "LLC",
  TaxId: "Tax ID (protected application)",
  SSN: "SSN (protected application)",
  BankAccountNo: "Bank account (protected application)",
  BankRoutingNo: "Routing number (protected application)",
  DateIncorporated: "Business start date",
  BirthDate: "Owner date of birth",
  OwnershipPct: "Ownership percentage",
  "general-retail-rest-low-risk": "General retail / restaurant — low risk",
};
const label = (s: string): string =>
  names[s] ?? s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
function friendlyError(error: Error): string {
  try {
    const value = JSON.parse(error.message.slice(error.message.indexOf("{")));
    if (Array.isArray(value.fields) && value.fields.length) {
      const fields = [
        ...new Set<string>(
          value.fields.map((field: string) => {
            const path = field.split(":")[0].split(".");
            return label(path.at(-1) ?? "Required field");
          }),
        ),
      ];
      return (
        "Complete the required fields before saving: " +
        fields.join(", ") +
        ". Correct protected details in the merchant application."
      );
    }
    if (value.message === "PAYARC_CORRECTION_NOT_ALLOWED")
      return "This case cannot be resent in its current state. Check the latest processor status and resolve any uncertain delivery first.";
  } catch {
    /* no raw provider or API payload in the visible error */
  }
  return "The request could not be completed. Review the case requirements and try again.";
}
export default function PayarcPreparation({ dealId }: { dealId: number }) {
  const correctionKey = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const q = useQuery<Preparation>({
    queryKey: ["/api/deals", dealId, "payarc-preparation"],
    queryFn: async () => {
      const r = await fetch(`/api/deals/${dealId}/payarc-preparation`, {
        credentials: "include",
      });
      if (!r.ok)
        throw Error("A directly linked, reviewable application is required.");
      return r.json();
    },
    enabled: open,
    retry: false,
  });
  const save = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(
        "POST",
        `/api/deals/${dealId}/payarc-preparation`,
        { applicationId: q.data!.applicationId, extras },
      );
      return r.json();
    },
    onSuccess: () => {
      setError("");
      correctionKey.current = null;
      void queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
      setOpen(false);
    },
    onError: (e: Error) => setError(friendlyError(e)),
  });
  const field = (
    k: string,
    s: Field,
    onChange: (v: unknown) => void,
    value: unknown,
  ) => (
    <div key={k} className="space-y-1 min-w-0">
      <Label htmlFor={`payarc-${k}`}>{label(k)}</Label>
      {s.enum ? (
        <select
          id={`payarc-${k}`}
          className="h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select</option>
          {s.enum.map((v) => (
            <option key={v} value={v}>
              {label(v)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={`payarc-${k}`}
          type={s.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={(e) =>
            onChange(
              s.type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </div>
  );
  const correction = useMutation({
    mutationFn: async () => {
      const key = correctionKey.current ?? crypto.randomUUID();
      correctionKey.current = key;
      const r = await apiRequest(
        "POST",
        `/api/deals/${dealId}/payarc-correction`,
        { commandKey: key },
      );
      return r.json();
    },
    onSuccess: () => {
      setError("Correction queued for the existing Payarc application.");
      void queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
    },
    onError: (e: Error) => setError(friendlyError(e)),
  });
  const pricing = q.data?.pricing[String(extras.DiscountRateProgram ?? "")];
  return (
    <section className="rounded-xl border border-primary/20 bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold">Payarc application preparation</h4>
          <p className="text-sm text-muted-foreground">
            Complete processor requirements using the reviewed application.
            Saving sends nothing.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Review requirements"}
        </Button>
      </div>
      {open && (
        <>
          {q.isLoading ? (
            <p>Loading requirements…</p>
          ) : q.error ? (
            <p role="alert">{q.error.message}</p>
          ) : (
            q.data && (
              <>
                <p className="text-sm">
                  {q.data.prepared
                    ? "The reviewed preparation is saved for this application."
                    : "Preparation required."}{" "}
                  Banking, tax and owner identity come from protected
                  application fields. Missing application fields must be
                  corrected there.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(q.data.fields).map(([k, s]) =>
                    field(
                      k,
                      s,
                      (v) =>
                        setExtras((x) => ({
                          ...x,
                          [k]: v,
                          ...(k === "DiscountRateProgram"
                            ? { Pricing: {} }
                            : {}),
                        })),
                      extras[k],
                    ),
                  )}
                  {field(
                    "OwnerTitle",
                    { enum: q.data.ownerTitles },
                    (v) => setExtras((x) => ({ ...x, OwnerTitle: v })),
                    extras.OwnerTitle,
                  )}
                </div>
                {pricing && (
                  <fieldset className="space-y-3">
                    <legend className="font-medium">Approved pricing</legend>
                    <p className="text-sm text-muted-foreground">
                      Enter only reviewed pricing. Blank fields are omitted; no
                      rates are assumed.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {Object.entries(pricing)
                        .filter(([k]) => !!k)
                        .map(([k, s]) =>
                          field(
                            k,
                            s,
                            (v) =>
                              setExtras((x) => {
                                const p = { ...((x.Pricing as any) ?? {}) };
                                if (v === "") delete p[k];
                                else p[k] = v;
                                return { ...x, Pricing: p };
                              }),
                            (extras.Pricing as any)?.[k],
                          ),
                        )}
                    </div>
                  </fieldset>
                )}
                {error && (
                  <p
                    role="alert"
                    className="text-sm text-destructive break-words"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => save.mutate()}
                    disabled={save.isPending}
                  >
                    Save reviewed preparation
                  </Button>
                  {q.data.prepared && q.data.canCorrect && (
                    <Button
                      variant="outline"
                      onClick={() => correction.mutate()}
                      disabled={correction.isPending}
                    >
                      Queue correction & signature resend
                    </Button>
                  )}
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
