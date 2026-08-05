import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Shield, Mail, Lock, Smartphone, KeyRound } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import logoBlue from "@assets/logo-blue.png";
import { SEO } from "@/components/SEO";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, isLoggingIn, loginError, user, verifyMfa, isVerifyingMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) setError(urlError);

    // Show session-expired message if redirected due to session expiry
    const logoutReason = sessionStorage.getItem("auth_logout_reason");
    if (logoutReason === "session_expired") {
      setError("Your session expired. Please sign in again.");
      sessionStorage.removeItem("auth_logout_reason");
    } else if (logoutReason === "session_invalidated") {
      setError("Your session was terminated by an administrator. Please sign in again.");
      sessionStorage.removeItem("auth_logout_reason");
    }
  }, []);

  if (user) {
    setLocation("/dashboard");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const result = await login({ email, password });
      if ((result as any)?.mfa_required) {
        setMfaRequired(true);
      } else {
        setLocation("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await verifyMfa({ code: mfaCode, rememberDevice });
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err.message || "Invalid code");
    }
  };

  if (mfaRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Link href="/">
              <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-login" />
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Smartphone className="w-4 h-4" />
              <span className="text-sm">Two-Factor Authentication</span>
            </div>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-center" data-testid="text-mfa-title">Verify Your Identity</CardTitle>
              <CardDescription className="text-center">
                Enter the 6-digit code from your authenticator app, or use a backup code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                {(error || loginError) && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-mfa-error">
                    {error || loginError?.message}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="mfa-code">Authentication Code</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="mfa-code"
                      type="text"
                      inputMode="numeric"
                      placeholder="000000 or XXXXX-XXXXX (backup)"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      className="pl-10 font-mono tracking-widest text-center text-lg"
                      autoComplete="one-time-code"
                      autoFocus
                      required
                      data-testid="input-mfa-code"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2" data-testid="checkbox-remember-device">
                  <Checkbox
                    id="remember-device"
                    checked={rememberDevice}
                    onCheckedChange={(checked) => setRememberDevice(checked === true)}
                    data-testid="input-remember-device"
                  />
                  <Label htmlFor="remember-device" className="text-sm font-normal cursor-pointer">
                    Remember this device for 30 days
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={!mfaCode || isVerifyingMfa} data-testid="button-verify-mfa">
                  {isVerifyingMfa ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Verifying...
                    </>
                  ) : (
                    "Verify"
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Lost access to your app?{" "}
                <span className="text-primary">Use a backup code above</span>
              </p>

              <Button
                variant="ghost"
                className="w-full text-sm"
                onClick={() => { setMfaRequired(false); setError(""); setMfaCode(""); }}
                data-testid="button-back-to-login"
              >
                Back to Sign In
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SEO title="Sign In" description="Sign in to your Liberty Bancard merchant or partner dashboard to manage your payment processing account." path="/login" noindex />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Link href="/">
            <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-login" />
          </Link>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span className="text-sm">Secure Login</span>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center" data-testid="text-login-title">Sign In</CardTitle>
            <CardDescription className="text-center">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {(error || loginError) && (
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-login-error">
                  {error || loginError?.message}
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
                    data-testid="input-email"
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
                    data-testid="input-password"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline" data-testid="link-forgot-password">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-login">
                {isLoggingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="underline">Terms of Service</Link>{" "}
          and{" "}
          <Link href="/privacy-policy" className="underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
