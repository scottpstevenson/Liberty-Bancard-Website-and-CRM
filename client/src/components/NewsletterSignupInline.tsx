import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Mail, CheckCircle, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { EmailMarketingCheckbox, emailConsentPayload, type EmailConsentOutcome } from "@/components/EmailMarketingCheckbox";
import { Link } from "wouter";

interface NewsletterSignupInlineProps {
  variant?: "inline" | "end";
  sourceArticle?: string;
}

export function NewsletterSignupInline({ variant = "inline", sourceArticle }: NewsletterSignupInlineProps) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [subscribeToNewsletter, setSubscribeToNewsletter] = useState(false);
  const [consentOutcome, setConsentOutcome] = useState<EmailConsentOutcome | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const subscribe = useMutation({
    mutationFn: async () => {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const payload: Record<string, unknown> = { firstName, email, ...emailConsentPayload("newsletter_signup", subscribeToNewsletter) };
      if (sourceArticle) payload.sourceArticle = sourceArticle;
      const res = await apiRequest("POST", "/api/newsletter/subscribe", payload, {
        "Idempotency-Key": idempotencyKeyRef.current,
      });
      return res.json() as Promise<{ emailConsent?: EmailConsentOutcome }>;
    },
    onSuccess: (body) => {
      // Subscription is reported only from the server's recorded consent fact, never from the request having been saved.
      setConsentOutcome(body?.emailConsent === "recorded" || body?.emailConsent === "unavailable" ? body.emailConsent : "not_recorded");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim() || !subscribeToNewsletter) return;
    subscribe.mutate();
  };

  if (consentOutcome === "recorded") {
    return (
      <Card
        className="my-8 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
        data-testid="newsletter-signup-confirmed"
      >
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                  You're subscribed to the newsletter.
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
                  Your choice is saved. You can unsubscribe from any email at any time.
                </p>
              </div>
              <div className="border-t border-emerald-200 dark:border-emerald-800 pt-3">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2">
                  Want us to decode YOUR statement?
                </p>
                <Button size="sm" className="gap-2" asChild>
                  <Link href="/upload-statement" data-testid="link-newsletter-bonus-cta">
                    Upload Your Statement Now
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (consentOutcome) {
    return (
      <Card
        className="my-8 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20"
        data-testid="newsletter-signup-not-recorded"
        role="status"
      >
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="font-semibold text-amber-900 dark:text-amber-100">
                {consentOutcome === "unavailable" ? "We couldn't record your subscription right now." : "Your subscription was not recorded."}
              </p>
              <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                We will not send newsletter email until a subscription is recorded. Please try again later.
              </p>
              <Button size="sm" variant="outline" onClick={() => setConsentOutcome(null)} data-testid="button-newsletter-try-again">
                Try again
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`my-8 ${variant === "end" ? "border-primary/20 bg-primary/5 dark:bg-primary/10" : "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/20"}`}
      data-testid="newsletter-signup-inline"
    >
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900 flex items-center justify-center shrink-0 mt-0.5">
            <BookOpen className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <p className="font-semibold text-foreground">
                Liberty Bancard newsletter
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Plain-English card-processing tips and savings guides by email.
              </p>
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-newsletter-pdf-unavailable">
                The Merchant Statement Decoder PDF is not available for download yet.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3" data-testid="form-newsletter-signup">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`newsletter-name-${variant}`} className="text-xs">First Name</Label>
                  <Input
                    id={`newsletter-name-${variant}`}
                    placeholder="Your first name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    data-testid="input-newsletter-first-name"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`newsletter-email-${variant}`} className="text-xs">Email Address</Label>
                  <Input
                    id={`newsletter-email-${variant}`}
                    type="email"
                    placeholder="you@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="input-newsletter-email"
                  />
                </div>
              </div>
              <EmailMarketingCheckbox
                surface="newsletter_signup"
                id={`newsletter-consent-${variant}`}
                checked={subscribeToNewsletter}
                onCheckedChange={setSubscribeToNewsletter}
                required
              />
              <Button
                type="submit"
                disabled={subscribe.isPending || !firstName.trim() || !email.trim() || !subscribeToNewsletter}
                className="gap-2"
                data-testid="button-newsletter-subscribe"
              >
                {subscribe.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                {subscribe.isPending ? "Subscribing..." : "Subscribe"}
              </Button>
              {subscribe.isError && (
                <p className="text-xs text-destructive" data-testid="text-newsletter-error">
                  Something went wrong. Please try again.
                </p>
              )}
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
