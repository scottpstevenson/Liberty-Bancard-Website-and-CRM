import { Checkbox } from "@/components/ui/checkbox";

interface PewcCheckboxProps {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  id?: string;
}

/**
 * Wave 2 — PEWC (Prior Express Written Consent) checkbox.
 *
 * This is OPTIONAL — checking it upgrades the contact's consent tier to
 * pewc_full_automation, which unlocks automated SMS/call channels. Not
 * checking it does not block form submission.
 */
export function PewcCheckbox({ checked, onCheckedChange, id = "pewc-consent" }: PewcCheckboxProps) {
  return (
    <div className="flex items-start gap-3 pt-2" data-testid="container-pewc-consent">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        data-testid="checkbox-pewc-consent"
        className="mt-0.5 shrink-0"
      />
      <label htmlFor={id} className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none">
        <span className="font-medium text-foreground/80">(Optional)</span>{" "}
        I provide my express written consent for Liberty Bancard to contact me via autodialed or pre-recorded calls and automated text messages at the phone number above. I understand this consent is not required to obtain any product or service. Msg &amp; data rates may apply. Reply STOP to opt out at any time. See our{" "}
        <a href="/sms-terms" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">SMS Terms</a>
        {" "}and{" "}
        <a href="/tcpa-consent" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">TCPA Consent</a>.
      </label>
    </div>
  );
}
