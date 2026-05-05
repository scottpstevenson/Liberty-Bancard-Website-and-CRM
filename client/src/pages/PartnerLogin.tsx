import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Lock, Shield, Handshake, CheckCircle } from "lucide-react";
import logoBlue from "@assets/logo-blue.png";
import { SEO } from "@/components/SEO";

type PartnerLoginView = "login" | "forgot" | "reset" | "set-password";

export default function PartnerLogin() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<PartnerLoginView>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);

  const [resetToken, setResetToken] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reset = params.get("reset");
    const invite = params.get("invite");
    if (reset) {
      setResetToken(reset);
      setView("reset");
    } else if (invite) {
      setInviteToken(invite);
      setView("set-password");
    }
  }, []);

  useEffect(() => {
    fetch("/api/partners/me", { credentials: "include" })
      .then(res => { if (res.ok) return res.json(); throw new Error("no session"); })
      .then(() => { setLocation("/partner-portal"); })
      .catch(() => {});
  }, [setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Login failed. Please check your credentials.");
        return;
      }
      setLocation("/partner-portal");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Something went wrong.");
        return;
      }
      setForgotSubmitted(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Reset failed. The link may have expired.");
        return;
      }
      setResetSuccess(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to set password. The invite link may have expired.");
        return;
      }
      setResetSuccess(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "set-password") {
    return (
      <>
      <SEO title="Partner Sign In" description="Sign in to your Liberty Bancard partner portal." noindex />
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Link href="/">
              <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-partner-login" />
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Handshake className="w-4 h-4" />
              <span className="text-sm">Partner Portal — Set Your Password</span>
            </div>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-center" data-testid="text-set-password-title">
                {resetSuccess ? "Password Set!" : "Create Your Password"}
              </CardTitle>
              <CardDescription className="text-center">
                {resetSuccess
                  ? "Your account is ready. You can now log in to your partner portal."
                  : "Choose a secure password to activate your partner account."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resetSuccess ? (
                <div className="text-center space-y-4">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <Button className="w-full" onClick={() => setView("login")} data-testid="button-go-to-login">
                    Sign In Now
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSetPassword} className="space-y-4">
                  {error && (
                    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-set-password-error">
                      {error}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Minimum 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-new-password"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-confirm-password"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-set-password">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Setting password...</> : "Set Password & Activate Account"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </>
    );
  }

  if (view === "reset") {
    return (
      <>
      <SEO title="Partner Sign In" description="Sign in to your Liberty Bancard partner portal." noindex />
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Link href="/">
              <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-partner-reset" />
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Handshake className="w-4 h-4" />
              <span className="text-sm">Partner Portal — Reset Password</span>
            </div>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-center" data-testid="text-reset-title">
                {resetSuccess ? "Password Reset!" : "Set New Password"}
              </CardTitle>
              <CardDescription className="text-center">
                {resetSuccess
                  ? "Your password has been updated. You can now log in."
                  : "Enter your new password below."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resetSuccess ? (
                <div className="text-center space-y-4">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <Button className="w-full" onClick={() => { setResetSuccess(false); setView("login"); }} data-testid="button-go-to-login-reset">
                    Sign In Now
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  {error && (
                    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-reset-error">
                      {error}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="reset-password">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="reset-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Minimum 6 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-reset-password"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-confirm">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="reset-confirm"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-reset-confirm"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-reset-password">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Resetting...</> : "Reset Password"}
                  </Button>
                  <Button variant="ghost" className="w-full text-sm" type="button" onClick={() => setView("login")} data-testid="button-back-to-login">
                    Back to Sign In
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </>
    );
  }

  if (view === "forgot") {
    return (
      <>
      <SEO title="Partner Sign In" description="Sign in to your Liberty Bancard partner portal." noindex />
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Link href="/">
              <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-partner-forgot" />
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Handshake className="w-4 h-4" />
              <span className="text-sm">Partner Portal — Password Recovery</span>
            </div>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-center" data-testid="text-forgot-title">
                {forgotSubmitted ? "Check Your Email" : "Reset Your Password"}
              </CardTitle>
              <CardDescription className="text-center">
                {forgotSubmitted
                  ? "If an account with that email exists, we've sent a reset link. Check your inbox."
                  : "Enter your partner account email and we'll send you a reset link."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!forgotSubmitted ? (
                <form onSubmit={handleForgot} className="space-y-4">
                  {error && (
                    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-forgot-error">
                      {error}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-forgot-email"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-send-reset">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending...</> : "Send Reset Link"}
                  </Button>
                  <Button variant="ghost" className="w-full text-sm" type="button" onClick={() => setView("login")} data-testid="button-back-to-login-forgot">
                    Back to Sign In
                  </Button>
                </form>
              ) : (
                <div className="text-center space-y-4">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <Button variant="outline" className="w-full" onClick={() => { setForgotSubmitted(false); setView("login"); }} data-testid="button-back-after-forgot">
                    Back to Sign In
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    <SEO title="Partner Sign In" description="Sign in to your Liberty Bancard partner portal." noindex />
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Link href="/">
            <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-partner-login-main" />
          </Link>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span className="text-sm">Partner Portal — Secure Login</span>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center" data-testid="text-partner-login-title">Partner Sign In</CardTitle>
            <CardDescription className="text-center">
              Access your partner dashboard, referrals, and commission reports
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-partner-login-error">
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
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-partner-email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-partner-password"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  onClick={() => { setError(""); setView("forgot"); }}
                  data-testid="link-partner-forgot-password"
                >
                  Forgot password?
                </button>
              </div>

              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-partner-login">
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in...</>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Not a partner yet?{" "}
              <Link href="/partners" className="text-primary underline-offset-4 hover:underline" data-testid="link-become-partner">
                Apply to join
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Looking for the affiliate program?{" "}
          <Link href="/affiliate" className="underline" data-testid="link-affiliate-program">
            Affiliate login
          </Link>
        </p>
      </div>
    </div>
    </>
  );
}
