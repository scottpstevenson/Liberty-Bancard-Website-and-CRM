import { useEffect, useState } from "react";
import { SEO } from "@/components/SEO";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { captureAuthActionToken } from "@/lib/auth-action-fragment";

type VerifyState = "loading" | "success" | "error";

export default function VerifyEmail() {
  const [token] = useState(captureAuthActionToken);
  const [state, setState] = useState<VerifyState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("No verification token provided");
      return;
    }

    // CSRF_EXEMPT: TOKEN_AUTH_FLOW — verifies the one-time email token before a session exists
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setState("success");
          setMessage(data.message || "Email verified successfully");
        } else {
          setState("error");
          setMessage(data.message || "Invalid or expired verification link");
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Something went wrong. Please try again.");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="verify-email-page">
      <SEO title="Verify Your Email" description="Verify your Liberty Bancard email address to activate your account." path="/verify-email" noindex />
      <Card className="w-full max-w-md" data-testid="verify-email-card">
        <CardHeader className="text-center">
          <CardTitle data-testid="verify-email-title">Email Verification</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3" data-testid="verify-email-loading">
              <Loader2 className="w-12 h-12 animate-spin text-primary" data-testid="icon-loading" />
              <p className="text-muted-foreground" data-testid="text-loading">Verifying your email...</p>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-3" data-testid="verify-email-success">
              <CheckCircle className="w-12 h-12 text-green-600" data-testid="icon-success" />
              <p className="text-lg font-semibold" data-testid="text-success">Email verified!</p>
              <p className="text-muted-foreground text-center" data-testid="text-success-message">{message}</p>
              <Link href="/login">
                <Button data-testid="link-login">Go to Login</Button>
              </Link>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-3" data-testid="verify-email-error">
              <XCircle className="w-12 h-12 text-destructive" data-testid="icon-error" />
              <p className="text-lg font-semibold" data-testid="text-error">Verification Failed</p>
              <p className="text-muted-foreground text-center" data-testid="text-error-message">{message}</p>
              <p className="text-sm text-muted-foreground text-center" data-testid="text-resend-hint">
                Need a new verification link? Please sign up again or contact support.
              </p>
              <Link href="/login">
                <Button variant="outline" data-testid="link-login-error">Back to Login</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
