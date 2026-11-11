import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  PARTNER_RESIDUAL_BPS,
  PARTNER_RESIDUAL_COPY,
  PARTNER_RESIDUAL_DEFAULTS,
  PARTNER_RESIDUAL_TYPES,
  calculatePartnerResidual,
  clampPartnerResidualBps,
  formatPartnerResidualUsd,
  parsePartnerResidualField,
  partnerResidualSplitPercent,
  type PartnerResidualTypeId,
} from "@shared/partner-residual-calculator";

/**
 * Partner income estimator on /partners. Every input recalculates the result on the same render: there is no
 * submit step and nothing is sent anywhere. The arithmetic and the wording live in
 * shared/partner-residual-calculator.ts.
 */
export function PartnerResidualCalculator() {
  const [merchants, setMerchants] = useState<string>(PARTNER_RESIDUAL_DEFAULTS.merchants);
  const [avgVolume, setAvgVolume] = useState<string>(PARTNER_RESIDUAL_DEFAULTS.avgMonthlyVolume);
  const [bps, setBps] = useState<number>(PARTNER_RESIDUAL_BPS.default);
  const [partnerType, setPartnerType] = useState<PartnerResidualTypeId>(PARTNER_RESIDUAL_DEFAULTS.partnerType);

  const parsedMerchants = parsePartnerResidualField("merchants", merchants);
  const parsedVolume = parsePartnerResidualField("avgMonthlyVolume", avgVolume);
  const splitPercent = partnerResidualSplitPercent(partnerType);

  const result = useMemo(
    () =>
      parsedMerchants.kind === "ok" && parsedVolume.kind === "ok"
        ? calculatePartnerResidual({
            merchants: parsedMerchants.value,
            avgMonthlyVolume: parsedVolume.value,
            bps,
            splitPercent,
          })
        : null,
    [parsedMerchants, parsedVolume, bps, splitPercent],
  );

  const merchantsMessage = parsedMerchants.kind === "invalid" ? parsedMerchants.message : null;
  const volumeMessage = parsedVolume.kind === "invalid" ? parsedVolume.message : null;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 md:p-8" data-testid="partner-residual-calculator">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Calculator className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">Partner Income Estimator</h3>
          <p className="text-sm text-muted-foreground">Estimate your monthly residual income</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <Label htmlFor="partner-input-calc-merchants" className="block mb-2">
            Number of active merchants
          </Label>
          <Input
            className="min-h-11"
            id="partner-input-calc-merchants"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={merchants}
            onChange={(e) => setMerchants(e.target.value)}
            aria-invalid={merchantsMessage !== null}
            aria-describedby="partner-calc-merchants-hint"
            data-testid="input-calc-merchants"
          />
          <p
            id="partner-calc-merchants-hint"
            className={`text-xs mt-1 ${merchantsMessage ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="hint-calc-merchants"
          >
            {merchantsMessage ?? "Merchant accounts in your portfolio that are actively processing"}
          </p>
        </div>
        <div>
          <Label htmlFor="partner-input-calc-volume" className="block mb-2">
            Average monthly card volume per merchant ($)
          </Label>
          <Input
            className="min-h-11"
            id="partner-input-calc-volume"
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            value={avgVolume}
            onChange={(e) => setAvgVolume(e.target.value)}
            aria-invalid={volumeMessage !== null}
            aria-describedby="partner-calc-volume-hint"
            data-testid="input-calc-volume"
          />
          <p
            id="partner-calc-volume-hint"
            className={`text-xs mt-1 ${volumeMessage ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="hint-calc-volume"
          >
            {volumeMessage ?? "Per merchant, average monthly card sales"}
          </p>
        </div>
      </div>

      <div className="mb-6" data-testid="calc-bps-group">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <span className="text-sm font-medium leading-none text-foreground">Estimated eligible Liberty residual yield</span>
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
              onValueChange={([value]) => setBps(clampPartnerResidualBps(value))}
              aria-label="Estimated eligible Liberty residual yield in basis points"
              data-testid="slider-calc-bps"
            />
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{PARTNER_RESIDUAL_BPS.min} bps</span>
              <span>{PARTNER_RESIDUAL_BPS.max} bps</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-calc-bps-explanation">
            {PARTNER_RESIDUAL_COPY.bpsExplanation}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <p id="partner-calc-type-label" className="text-sm font-medium text-foreground mb-2">Partner type</p>
        <RadioGroup
          value={partnerType}
          onValueChange={(value) => setPartnerType(value as PartnerResidualTypeId)}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          aria-labelledby="partner-calc-type-label"
          aria-describedby="partner-calc-split-note"
          data-testid="radio-calc-partner-type"
        >
          {PARTNER_RESIDUAL_TYPES.map((type) => (
            <Label
              key={type.id}
              htmlFor={`partner-radio-calc-${type.id}`}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-background px-4 py-3 ${
                partnerType === type.id ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <RadioGroupItem
                id={`partner-radio-calc-${type.id}`}
                value={type.id}
                data-testid={`radio-calc-partner-${type.id}`}
              />
              <span className="text-sm font-medium text-foreground">
                {type.label} <span className="text-muted-foreground font-normal">at {type.splitPercent}%</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <p id="partner-calc-split-note" className="text-xs text-muted-foreground mt-2" data-testid="text-calc-split-note">
          {PARTNER_RESIDUAL_COPY.splitNote}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-live="polite" aria-atomic="true">
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Monthly Income</p>
          <p className="text-3xl font-bold text-primary" data-testid="text-calc-monthly">
            {result ? formatPartnerResidualUsd(result.monthly) : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per month</p>
        </div>
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Annualized Income</p>
          <p className="text-3xl font-bold text-green-700" data-testid="text-calc-annual">
            {result ? formatPartnerResidualUsd(result.annualized) : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">monthly income × 12</p>
        </div>
      </div>
      {!result && (
        <p className="text-xs text-destructive mt-3 text-center" data-testid="text-calc-incomplete">
          Enter a valid number of merchants and average monthly volume to see an estimate.
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
    </div>
  );
}
