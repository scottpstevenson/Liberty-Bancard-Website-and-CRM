import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Mail, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface NewsletterSignupInlineProps {
  variant?: "inline" | "end";
  sourceArticle?: string;
}

export function NewsletterSignupInline({ variant = "inline", sourceArticle }: NewsletterSignupInlineProps) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const subscribe = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = { firstName, email };
      if (sourceArticle) payload.sourceArticle = sourceArticle;
      const res = await apiRequest("POST", "/api/newsletter/subscribe", payload);
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) return;
    subscribe.mutate();
  };

  if (submitted) {
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
                  Check your email for the PDF!
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
                  The Merchant Statement Decoder is on its way to your inbox.
                </p>
              </div>
              <div className="border-t border-emerald-200 dark:border-emerald-800 pt-3">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2">
                  Bonus: Want us to decode YOUR statement?
                </p>
                <Link href="/upload-statement" data-testid="link-newsletter-bonus-cta">
                  <Button size="sm" className="gap-2">
                    Upload Your Statement Now
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
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
                Download The Merchant Statement Decoder — Free PDF
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                A plain-English guide to understanding every line of your merchant statement. Free, instant, no strings attached.
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
              <Button
                type="submit"
                disabled={subscribe.isPending || !firstName.trim() || !email.trim()}
                className="gap-2"
                data-testid="button-newsletter-subscribe"
              >
                {subscribe.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                {subscribe.isPending ? "Sending..." : "Send Me the Free PDF"}
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
