import { MessageSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { SmsEligibilityResult } from "@shared/sms-eligibility";

// Presentational SMS follow-up section extracted from CallOutcome.tsx so its
// proactive disabled/reason-text gating can be rendered and asserted in
// isolation (see scripts/test-sms-follow-up-section.tsx). Purely UX gating —
// the backend /api/call-follow-ups/send remains the final authority on
// whether an SMS actually sends.
export function SmsFollowUpSection({
  eligibility,
  sendSms,
  onSendSmsChange,
  smsBody,
  onSmsBodyChange,
}: {
  eligibility: SmsEligibilityResult;
  sendSms: boolean;
  onSendSmsChange: (checked: boolean) => void;
  smsBody: string;
  onSmsBodyChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="section-sms-draft">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-green-500" />
          <span className="font-semibold text-sm">SMS Follow-Up</span>
        </div>
        <div className="flex items-center gap-2" title={!eligibility.eligible ? eligibility.reason : undefined}>
          <Checkbox
            checked={sendSms}
            onCheckedChange={(v) => onSendSmsChange(!!v)}
            disabled={!eligibility.eligible}
            data-testid="checkbox-send-sms"
          />
          <span className="text-xs text-muted-foreground">Send this</span>
        </div>
      </div>
      <Textarea
        value={smsBody}
        onChange={(e) => onSmsBodyChange(e.target.value)}
        rows={3}
        className="text-sm resize-none"
        disabled={!eligibility.eligible}
        data-testid="input-sms-body"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{smsBody.length} characters</span>
        {smsBody.length > 300 && <span className="text-amber-500">Consider shortening for SMS</span>}
        {!eligibility.eligible && (
          <span
            className={eligibility.checking ? "text-muted-foreground" : "text-red-500"}
            data-testid="text-sms-eligibility-reason"
          >
            {eligibility.reason}
          </span>
        )}
      </div>
    </div>
  );
}
