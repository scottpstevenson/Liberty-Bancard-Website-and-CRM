import { useState } from "react";
import { CheckCircle, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import { PublicIntakeNotice, IntakeReceipt } from "@/components/PublicIntakeNotice";
import { usePublicIntake } from "@/hooks/use-public-intake";
import { useToast } from "@/hooks/use-toast";
import { PHONE_NUMBER } from "@/lib/constants";

/**
 * Home callback request. Behaviour is unchanged from the previous Home page: the same intake key and
 * endpoint, the same PEWC consent checkbox and disclosure, the same recoverable/pending/receipt states.
 * Only a confirmed save shows success; a recoverable (202), unreadable or failed response keeps the same
 * intent and shows the truthful pending notice in the form.
 */
export function HomeCallbackForm() {
  const [cbName, setCbName] = useState("");
  const [cbPhone, setCbPhone] = useState("");
  const [cbBestTime, setCbBestTime] = useState("Morning");
  const [cbPewcConsent, setCbPewcConsent] = useState(false);
  const { toast } = useToast();

  const callbackIntake = usePublicIntake("callback_home", "/api/public/callback");
  const cbSubmitting = callbackIntake.submitting;
  const cbSubmitted = callbackIntake.state.phase === "saved";

  const handleCallbackSubmit = async () => {
    if (!cbName.trim() || !cbPhone.trim()) return;
    const outcome = await callbackIntake.submit({
      name: cbName, phone: cbPhone, bestTime: cbBestTime, pewcConsent: cbPewcConsent,
    });
    if (outcome.kind === "rejected") {
      toast({ title: "Something went wrong", description: outcome.message || `Please try again or call us at ${PHONE_NUMBER}.`, variant: "destructive" });
    }
  };

  if (cbSubmitted) {
    return (
      <div className="public-card border-2 border-emerald-200 bg-card p-6 text-center text-foreground sm:p-8">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h3 className="public-h3 mb-2" data-testid="text-callback-success">Request Saved</h3>
        <p className="public-body public-secondary mb-3" data-testid="text-callback-success-detail">
          {callbackIntake.state.phase === "saved" && callbackIntake.state.pendingReview
            ? "Your callback request is saved and follow-up is pending review. We can't promise a time yet. No pressure, just answers."
            : "We have your number and a Liberty advisor will follow up. No pressure, just answers."}
        </p>
        {callbackIntake.state.phase === "saved" && callbackIntake.state.receipt && (
          <IntakeReceipt receipt={callbackIntake.state.receipt} testIdPrefix="callback-home" />
        )}
        <Button type="button" variant="outline" className="mt-4" data-testid="callback-home-start-another"
          onClick={() => { setCbName(""); setCbPhone(""); setCbPewcConsent(false); callbackIntake.acknowledgeSaved(); }}>
          Send another request
        </Button>
      </div>
    );
  }

  return (
    <div className="public-card space-y-4 bg-card p-5 text-foreground sm:p-6" data-testid="form-callback">
      <div>
        <label className="public-small mb-1.5 block font-medium text-foreground" htmlFor="cb-name">Your Name</label>
        <Input id="cb-name" placeholder="First and Last" value={cbName} onChange={(e) => setCbName(e.target.value)} data-testid="input-callback-name" />
      </div>
      <div>
        <label className="public-small mb-1.5 block font-medium text-foreground" htmlFor="cb-phone">Phone Number</label>
        <Input id="cb-phone" type="tel" placeholder="(555) 123-4567" value={cbPhone} onChange={(e) => setCbPhone(e.target.value)} data-testid="input-callback-phone" />
      </div>
      <fieldset>
        <legend className="public-small mb-1.5 block font-medium text-foreground">Best Time to Call</legend>
        <div className="grid grid-cols-3 gap-2">
          {["Morning", "Afternoon", "Evening"].map((time) => (
            <Button
              key={time}
              type="button"
              variant={cbBestTime === time ? "default" : "outline"}
              size="sm"
              onClick={() => setCbBestTime(time)}
              aria-pressed={cbBestTime === time}
              className="toggle-elevate"
              data-testid={`button-callback-time-${time.toLowerCase()}`}
            >
              {time}
            </Button>
          ))}
        </div>
      </fieldset>
      <PewcCheckbox checked={cbPewcConsent} onCheckedChange={setCbPewcConsent} id="cb-pewc-consent" />
      <PublicIntakeNotice
        state={callbackIntake.state}
        testIdPrefix="callback-home-intake"
        checking={callbackIntake.checking}
        checkNote={callbackIntake.checkNote}
        onCheck={callbackIntake.check}
        onRetry={"restored" in callbackIntake.state && callbackIntake.state.restored ? undefined : handleCallbackSubmit}
        onDismiss={callbackIntake.dismiss}
      />
      <Button className="public-cta w-full gap-2" onClick={handleCallbackSubmit} disabled={cbSubmitting || !cbName.trim() || !cbPhone.trim()} data-testid="button-callback-submit">
        {cbSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
        Request a Callback
      </Button>
      <p className="public-caption public-secondary text-center">
        By submitting, you agree to be contacted by Liberty Bancard. Consent is not required for service.
      </p>
    </div>
  );
}
