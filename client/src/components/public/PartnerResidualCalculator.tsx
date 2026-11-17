import { useMemo, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Link } from "wouter";
import {
  PARTNER_RESIDUAL_BPS,
  PARTNER_RESIDUAL_COPY,
  PARTNER_RESIDUAL_DEFAULTS,
  PARTNER_RESIDUAL_LIMITS,
  PARTNER_RESIDUAL_PATHS,
  clampPartnerResidualBps,
  formatPartnerResidualUsd,
  illustratePartnerResidual,
  parsePartnerResidualField,
} from "@shared/partner-residual-calculator";
import {
  DEFAULT_REFERRAL_POLICY,
  PARTNER_PATH_ROUTE,
  type PartnerPathId,
  type PartnerReferralPolicy,
} from "@shared/partner-public-content";
import { trackPartnerEvent } from "@/lib/tracking";

interface PartnerResidualCalculatorProps {
  /** Published referral policy. Absent or unapproved means the referral result is the written-agreement message. */
  policy?: PartnerReferralPolicy;
  initialPath?: PartnerPathId;
  headingLevel?: "h2" | "h3";
}

/**
 * Hypothetical partner-compensation illustration. Every input recalculates on the same render: there is no submit step
 * and nothing is sent anywhere. The arithmetic and the wording live in shared/partner-residual-calculator.ts, and the
 * referral share can only come from the published policy passed in (never a literal in this component).
 */
export function PartnerResidualCalculator({ policy = DEFAULT_REFERRAL_POLICY, initialPath = PARTNER_RESIDUAL_DEFAULTS.path, headingLevel = "h3" }: PartnerResidualCalculatorProps) {
  const [merchants, setMerchants] = useState<string>(PARTNER_RESIDUAL_DEFAULTS.merchants);
  const [avgVolume, setAvgVolume] = useState<string>(PARTNER_RESIDUAL_DEFAULTS.avgMonthlyVolume);
  const [bps, setBps] = useState<number>(PARTNER_RESIDUAL_BPS.default);
  const [path, setPath] = useState<PartnerPathId>(initialPath);
  const usedReported = useRef(false);

  const reportUse = (calculatorPath: PartnerPathId) => {
    if (usedReported.current) return;
    usedReported.current = true;
    trackPartnerEvent("partner_calculator_used", { calculator_path: calculatorPath });
  };

  const parsedMerchants = parsePartnerResidualField("merchants", merchants);
  const parsedVolume = parsePartnerResidualField("avgMonthlyVolume", avgVolume);

  const illustration = useMemo(
    () => illustratePartnerResidual({ path, merchants: parsedMerchants, avgMonthlyVolume: parsedVolume, bps, policy }),
    [path, parsedMerchants, parsedVolume, bps, policy],
  );

  const merchantsMessage = parsedMerchants.kind === "invalid" ? parsedMerchants.message : null;
  const volumeMessage = parsedVolume.kind === "invalid" ? parsedVolume.message : null;
  const Heading = headingLevel;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 md:p-8" data-testid="partner-residual-calculator">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Calculator className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <Heading className="text-lg font-bold text-foreground">{PARTNER_RESIDUAL_COPY.heading}</Heading>
          <p className="text-sm text-muted-foreground">Hypothetical results from the assumptions you choose.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <Label htmlFor="partner-input-calc-merchants" className="block mb-2">
            {PARTNER_RESIDUAL_LIMITS.merchants.label}
          </Label>
          <Input
            className="min-h-11"
            id="partner-input-calc-merchants"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={merchants}
            onChange={(e) => { setMerchants(e.target.value); reportUse(path); }}
            aria-invalid={merchantsMessage !== null}
            aria-describedby="partner-calc-merchants-hint"
            data-testid="input-calc-merchants"
          />
          <p
            id="partner-calc-merchants-hint"
            className={`text-xs mt-1 ${merchantsMessage ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="hint-calc-merchants"
          >
            {merchantsMessage ?? "Merchant accounts in the portfolio that are actively processing (0 to 100,000)."}
          </p>
        </div>
        <div>
          <Label htmlFor="partner-input-calc-volume" className="block mb-2">
            {PARTNER_RESIDUAL_LIMITS.avgMonthlyVolume.label} ($)
          </Label>
          <Input
            className="min-h-11"
            id="partner-input-calc-volume"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={avgVolume}
            onChange={(e) => { setAvgVolume(e.target.value); reportUse(path); }}
            aria-invalid={volumeMessage !== null}
            aria-describedby="partner-calc-volume-hint"
            data-testid="input-calc-volume"
          />
          <p
            id="partner-calc-volume-hint"
            className={`text-xs mt-1 ${volumeMessage ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="hint-calc-volume"
          >
            {volumeMessage ?? "Average monthly card sales per merchant (0 to 100,000,000)."}
          </p>
        </div>
      </div>

      <div className="mb-6" data-testid="calc-bps-group">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <span id="partner-calc-bps-label" className="text-sm font-medium leading-snug text-foreground">{PARTNER_RESIDUAL_COPY.yieldLabel}</span>
          <p className="shrink-0 whitespace-nowrap text-lg font-bold text-foreground tabular-nums" data-testid="text-calc-bps">
            {bps} bps
            <span className="ml-2 text-sm font-normal text-muted-foreground">({(bps / 100).toFixed(2)}%)</span>
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 items-center">
          <div>
            <Slider
              className="h-11"
              min={PARTNER_RESIDUAL_BPS.min}
              max={PARTNER_RESIDUAL_BPS.max}
              step={PARTNER_RESIDUAL_BPS.step}
              value={[bps]}
              onValueChange={([value]) => { setBps(clampPartnerResidualBps(value)); reportUse(path); }}
              aria-label="Eligible Liberty residual yield in basis points"
              data-testid="slider-calc-bps"
            />
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{PARTNER_RESIDUAL_BPS.min} bps</span>
              <span>{PARTNER_RESIDUAL_BPS.max} bps</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-calc-bps-explanation">
            {PARTNER_RESIDUAL_COPY.yieldHelper}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <p id="partner-calc-type-label" className="text-sm font-medium text-foreground mb-2">Partnership path</p>
        <RadioGroup
          value={path}
          onValueChange={(value) => { setPath(value as PartnerPathId); reportUse(value as PartnerPathId); }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          aria-labelledby="partner-calc-type-label"
          data-testid="radio-calc-partner-type"
        >
          {PARTNER_RESIDUAL_PATHS.map((option) => (
            <Label
              key={option.id}
              htmlFor={`partner-radio-calc-${option.id}`}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-background px-4 py-3 ${
                path === option.id ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <RadioGroupItem id={`partner-radio-calc-${option.id}`} value={option.id} data-testid={`radio-calc-partner-${option.id}`} />
              <span className="text-sm font-medium text-foreground">{option.label}</span>
            </Label>
          ))}
        </RadioGroup>
        {path === "sales_agent" && (
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-calc-split-note">{PARTNER_RESIDUAL_COPY.agentQualification}</p>
        )}
      </div>

      {illustration.kind === "gated" ? (
        <div className="rounded-xl border border-border bg-background p-5" data-testid="text-calc-gated" role="status">
          <p className="text-sm text-foreground">{illustration.message}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-live="polite" aria-atomic="true">
          <div className="bg-background rounded-xl border border-border p-5 text-center">
            <p className="text-sm text-muted-foreground mb-1">{PARTNER_RESIDUAL_COPY.monthlyLabel}</p>
            <p className="text-3xl font-bold text-primary" data-testid="text-calc-monthly">
              {illustration.kind === "amount" ? formatPartnerResidualUsd(illustration.monthly) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">per month</p>
          </div>
          <div className="bg-background rounded-xl border border-border p-5 text-center">
            <p className="text-sm text-muted-foreground mb-1">{PARTNER_RESIDUAL_COPY.annualLabel}</p>
            <p className="text-3xl font-bold text-green-700" data-testid="text-calc-annual">
              {illustration.kind === "amount" ? formatPartnerResidualUsd(illustration.annualized) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">monthly × 12, same activity every month</p>
          </div>
        </div>
      )}
      {illustration.kind === "incomplete" && (
        <p className="text-xs text-destructive mt-3 text-center" data-testid="text-calc-incomplete">
          Enter a valid number of merchants and average monthly volume to see an illustration.
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-4 text-center" data-testid="text-calc-formula">
        {PARTNER_RESIDUAL_COPY.formula}
      </p>
      <p
        className="text-xs text-muted-foreground mt-4 rounded-lg border border-border/60 bg-background/60 p-3 leading-relaxed"
        data-testid="text-calc-disclosure"
      >
        {PARTNER_RESIDUAL_COPY.disclosure}
      </p>
      <p className="mt-4 text-center">
        <Link href={PARTNER_PATH_ROUTE[path]} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" data-testid="link-calc-cta">
          {PARTNER_RESIDUAL_COPY.cta}
        </Link>
      </p>
    </div>
  );
}
