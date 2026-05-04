import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ShieldCheck, ShieldOff, Smartphone, Copy, KeyRound, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface TotpStatus {
  enabled: boolean;
  trustedDeviceCount: number;
  trustedDevices: Array<{ name: string; expiresAt: string }>;
  backupCodesRemaining: number;
}

export default function SecuritySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enrollStep, setEnrollStep] = useState<"idle" | "scan" | "verify" | "done">("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenCodes, setRegenCodes] = useState<string[]>([]);

  const { data: status, isLoading } = useQuery<TotpStatus>({
    queryKey: ["/api/auth/totp/status"],
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/totp/enroll");
      return res.json();
    },
    onSuccess: (data) => {
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setEnrollStep("scan");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/totp/confirm", { code });
      return res.json();
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setEnrollStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/totp/status"] });
      toast({ title: "2FA Enabled", description: "Two-factor authentication has been enabled on your account." });
    },
    onError: (err: Error) => {
      toast({ title: "Invalid code", description: err.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/totp/disable", { password });
      return res.json();
    },
    onSuccess: () => {
      setDisableDialogOpen(false);
      setDisablePassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/totp/status"] });
      toast({ title: "2FA Disabled", description: "Two-factor authentication has been removed from your account." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const regenMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/totp/regenerate-backup-codes", { password });
      return res.json();
    },
    onSuccess: (data) => {
      setRegenCodes(data.backupCodes);
      setRegenPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/totp/status"] });
      toast({ title: "Backup codes regenerated", description: "Your old backup codes have been invalidated. Save these new codes in a safe place." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const clearDevicesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/auth/totp/trusted-devices");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/totp/status"] });
      toast({ title: "Trusted devices cleared", description: "All trusted devices have been removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copySecret = async () => {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const copyBackupCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    toast({ title: "Copied", description: "Backup codes copied to clipboard." });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl" data-testid="page-security-settings">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-security-title">Security Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your account security and authentication settings.</p>
      </div>

      <Card data-testid="card-2fa">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {status?.enabled ? (
                <ShieldCheck className="w-6 h-6 text-green-500" />
              ) : (
                <ShieldOff className="w-6 h-6 text-muted-foreground" />
              )}
              <div>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>Add an extra layer of security to your account</CardDescription>
              </div>
            </div>
            <Badge
              variant={status?.enabled ? "default" : "secondary"}
              className={status?.enabled ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200" : ""}
              data-testid="badge-2fa-status"
            >
              {status?.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status?.enabled && enrollStep === "idle" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use an authenticator app like Google Authenticator or Authy to generate time-based one-time passwords (TOTP).
              </p>
              <Button onClick={() => enrollMutation.mutate()} disabled={enrollMutation.isPending} data-testid="button-enable-2fa">
                {enrollMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Smartphone className="w-4 h-4 mr-2" />}
                Set Up Authenticator App
              </Button>
            </div>
          )}

          {enrollStep === "scan" && (
            <div className="space-y-4">
              <Alert>
                <Smartphone className="w-4 h-4" />
                <AlertDescription>
                  Scan this QR code with your authenticator app, then enter the 6-digit code below to confirm setup.
                </AlertDescription>
              </Alert>
              <div className="flex flex-col items-center gap-4">
                {qrDataUrl && (
                  <img src={qrDataUrl} alt="2FA QR Code" className="w-48 h-48 rounded-lg border" data-testid="img-qr-code" />
                )}
                <div className="w-full space-y-2">
                  <Label>Can't scan? Enter this key manually:</Label>
                  <div className="flex gap-2">
                    <Input
                      value={secret}
                      readOnly
                      className="font-mono text-xs"
                      data-testid="input-totp-secret"
                    />
                    <Button variant="outline" size="icon" aria-label="Copy secret" onClick={copySecret} data-testid="button-copy-secret">
                      {copiedSecret ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="totp-code">Enter verification code</Label>
                <div className="flex gap-2">
                  <Input
                    id="totp-code"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="font-mono text-lg tracking-widest max-w-[160px]"
                    data-testid="input-totp-code"
                  />
                  <Button
                    onClick={() => confirmMutation.mutate(totpCode)}
                    disabled={totpCode.length !== 6 || confirmMutation.isPending}
                    data-testid="button-verify-totp"
                  >
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Verify & Enable
                  </Button>
                </div>
              </div>
              <Button variant="ghost" onClick={() => setEnrollStep("idle")} data-testid="button-cancel-2fa-setup">
                Cancel
              </Button>
            </div>
          )}

          {enrollStep === "done" && backupCodes.length > 0 && (
            <div className="space-y-4">
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  <strong>Save your backup codes!</strong> These can be used to access your account if you lose your authenticator. Each code can only be used once.
                </AlertDescription>
              </Alert>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1" data-testid="div-backup-codes">
                {backupCodes.map((code, i) => (
                  <div key={i} className="text-center" data-testid={`text-backup-code-${i}`}>{code}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={copyBackupCodes} data-testid="button-copy-backup-codes">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Codes
                </Button>
                <Button onClick={() => { setEnrollStep("idle"); setBackupCodes([]); }} data-testid="button-done-2fa">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Done
                </Button>
              </div>
            </div>
          )}

          {status?.enabled && enrollStep === "idle" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Backup codes remaining</span>
                <span className="font-medium" data-testid="text-backup-codes-remaining">{status.backupCodesRemaining} of 8</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => { setRegenCodes([]); setRegenPassword(""); setRegenDialogOpen(true); }}
                  data-testid="button-regen-backup-codes"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Regenerate Backup Codes
                </Button>
                <Button variant="destructive" onClick={() => setDisableDialogOpen(true)} data-testid="button-disable-2fa">
                  <ShieldOff className="w-4 h-4 mr-2" />
                  Disable 2FA
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.enabled && status.trustedDeviceCount > 0 && (
        <Card data-testid="card-trusted-devices">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              Trusted Devices
            </CardTitle>
            <CardDescription>
              Devices that have been trusted for 30 days and don't require a 2FA code on login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {status.trustedDevices.map((device, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border text-sm" data-testid={`row-trusted-device-${i}`}>
                  <div>
                    <div className="font-medium" data-testid={`text-device-name-${i}`}>{device.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Expires {new Date(device.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearDevicesMutation.mutate()}
              disabled={clearDevicesMutation.isPending}
              data-testid="button-clear-trusted-devices"
            >
              {clearDevicesMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Remove All Trusted Devices
            </Button>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-recovery">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Account Recovery
          </CardTitle>
          <CardDescription>If you lose access to your authenticator app, contact an administrator to reset your 2FA.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Administrators can reset 2FA for any user from the User Management page. Contact your admin if you're locked out.
          </p>
        </CardContent>
      </Card>

      <Dialog open={regenDialogOpen} onOpenChange={(open) => { setRegenDialogOpen(open); if (!open) { setRegenCodes([]); setRegenPassword(""); } }}>
        <DialogContent data-testid="dialog-regen-backup-codes">
          <DialogHeader>
            <DialogTitle>Regenerate Backup Codes</DialogTitle>
            <DialogDescription>
              This will permanently invalidate your existing backup codes and generate 8 new ones. Enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          {regenCodes.length === 0 ? (
            <div className="space-y-4 py-2">
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  Your current backup codes will be permanently invalidated.
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="regen-password">Password</Label>
                <Input
                  id="regen-password"
                  type="password"
                  value={regenPassword}
                  onChange={(e) => setRegenPassword(e.target.value)}
                  placeholder="Enter your password"
                  data-testid="input-regen-password"
                  onKeyDown={(e) => { if (e.key === "Enter" && regenPassword) regenMutation.mutate(regenPassword); }}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setRegenDialogOpen(false); setRegenPassword(""); }} data-testid="button-cancel-regen">
                  Cancel
                </Button>
                <Button
                  onClick={() => regenMutation.mutate(regenPassword)}
                  disabled={!regenPassword || regenMutation.isPending}
                  data-testid="button-confirm-regen"
                >
                  {regenMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                  Regenerate Codes
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  <strong>Save these codes now!</strong> They won't be shown again. Each code can only be used once.
                </AlertDescription>
              </Alert>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1" data-testid="div-regen-backup-codes">
                {regenCodes.map((code, i) => (
                  <div key={i} className="text-center" data-testid={`text-regen-code-${i}`}>{code}</div>
                ))}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(regenCodes.join("\n"));
                    toast({ title: "Copied", description: "Backup codes copied to clipboard." });
                  }}
                  data-testid="button-copy-regen-codes"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Codes
                </Button>
                <Button onClick={() => { setRegenDialogOpen(false); setRegenCodes([]); }} data-testid="button-done-regen">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <DialogContent data-testid="dialog-disable-2fa">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to confirm. This will remove 2FA protection from your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Password</Label>
              <Input
                id="disable-password"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Enter your password"
                data-testid="input-disable-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDisableDialogOpen(false); setDisablePassword(""); }} data-testid="button-cancel-disable-2fa">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => disableMutation.mutate(disablePassword)}
              disabled={!disablePassword || disableMutation.isPending}
              data-testid="button-confirm-disable-2fa"
            >
              {disableMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Disable 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
