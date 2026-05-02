import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, CheckCircle, ArrowLeft } from "lucide-react";
import logoBlue from "@assets/logo-blue.png";
import { apiRequest } from "@/lib/queryClient";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const token = new URLSearchParams(window.location.search).get("token");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!token) {
      setError("Invalid reset link. Please request a new one.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, password });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SEO title="Set a New Password" description="Choose a new password for your Liberty Bancard account using your secure reset link." path="/reset-password" noindex />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Link href="/">
            <img src={logoBlue} alt="Liberty Bancard" className="h-12 object-contain cursor-pointer" data-testid="logo-reset-password" />
          </Link>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center" data-testid="text-reset-password-title">Reset Password</CardTitle>
            <CardDescription className="text-center">
              Enter your new password below
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {success ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md" data-testid="text-reset-password-success">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Your password has been reset successfully.</span>
                </div>
                <Link href="/login">
                  <Button className="w-full" data-testid="link-login-after-reset">
                    Sign In
                  </Button>
                </Link>
              </div>
            ) : !token ? (
              <div className="space-y-4">
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-reset-password-invalid">
                  Invalid or missing reset token. Please request a new password reset link.
                </div>
                <Link href="/forgot-password">
                  <Button variant="outline" className="w-full" data-testid="link-forgot-password">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Request New Link
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-reset-password-error">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                      minLength={6}
                      data-testid="input-password"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                      required
                      minLength={6}
                      data-testid="input-confirm-password"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-reset-password">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
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
