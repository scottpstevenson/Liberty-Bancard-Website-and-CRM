/**
 * Merchant Portal Activation Page
 *
 * Reached via the one-time invite link in the approval email:
 *   /activate-portal#token=<opaque_bearer>
 *
 * Flow:
 *   1. Validate the token against the server with a POST request
 *   2. Show a "set your password" form
 *   3. POST /api/auth/portal-invite/activate — creates the session
 *   4. Redirect to /dashboard/merchant-portal
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { captureAuthActionToken } from "@/lib/auth-action-fragment";

interface ValidateResponse {
  valid: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  message?: string;
}

type PageState = "loading" | "form" | "invalid" | "success" | "error";

export default function ActivatePortal() {
  const [, navigate] = useLocation();

  const [token] = useState(() => captureAuthActionToken() ?? "");

  const [pageState, setPageState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setPageState("invalid");
      return;
    }

    fetch("/api/auth/portal-invite/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((data: ValidateResponse) => {
        if (data.valid) {
          setPageState("form");
        } else {
          setPageState("invalid");
        }
      })
      .catch(() => setPageState("invalid"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/portal-invite/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message ?? "Activation failed. Please try again.");
        setSubmitting(false);
        return;
      }

      setPageState("success");

      // Give the user a moment to see the success state, then redirect
      setTimeout(() => navigate("/dashboard/merchant-portal"), 2000);
    } catch {
      setErrorMsg("A network error occurred. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-md bg-[#1e3a5f] flex items-center justify-center">
              <span className="text-white font-bold text-sm">LB</span>
            </div>
            <span className="font-semibold text-slate-800 dark:text-slate-100">Liberty Bancard</span>
          </div>
        </div>

        {/* Loading */}
        {pageState === "loading" && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              <p className="text-sm text-muted-foreground">Validating your invitation…</p>
            </CardContent>
          </Card>
        )}

        {/* Invalid / expired */}
        {pageState === "invalid" && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-2">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <CardTitle>Invitation Link Expired</CardTitle>
              <CardDescription>
                This invitation link is invalid or has expired. Portal invitations are valid for 72 hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-sm text-muted-foreground">
                Contact your Liberty Bancard account manager to request a new invitation link.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Password form */}
        {pageState === "form" && (
          <Card>
            <CardHeader>
              <CardTitle>Activate Your Portal Account</CardTitle>
              <CardDescription>
                Set a password to access your merchant portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Password */}
                <div className="space-y-1">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div className="space-y-1">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat your password"
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {errorMsg}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Activating…
                    </>
                  ) : (
                    "Activate Account"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Success */}
        {pageState === "success" && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="font-semibold text-lg">Account activated!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Redirecting you to your merchant portal…
                </p>
              </div>
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
