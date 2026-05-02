import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, ArrowLeft, CheckCircle } from "lucide-react";
import logoBlue from "@assets/logo-blue.png";
import { apiRequest } from "@/lib/queryClient";
import { SEO } from "@/components/SEO";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SEO title="Reset Your Password" description="Reset your Liberty Bancard password. We'll send a secure link to your registered email address." path="/forgot-password" noindex />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Link href="/">
            <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-forgot-password" />
          </Link>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center" data-testid="text-forgot-password-title">Forgot Password</CardTitle>
            <CardDescription className="text-center">
              Enter your email address and we'll send you a link to reset your password
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md" data-testid="text-forgot-password-success">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>If an account with that email exists, a reset link has been sent.</span>
                </div>
                <Link href="/login">
                  <Button variant="outline" className="w-full" data-testid="link-back-to-login">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sign In
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-forgot-password-error">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-submit-forgot-password">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  <Link href="/login" className="text-primary underline-offset-4 hover:underline" data-testid="link-login">
                    <span className="inline-flex items-center gap-1">
                      <ArrowLeft className="w-3 h-3" />
                      Back to Sign In
                    </span>
                  </Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
