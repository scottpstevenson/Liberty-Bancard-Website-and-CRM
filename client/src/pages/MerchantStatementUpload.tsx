import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Upload, Loader2 } from "lucide-react";

interface TokenInfo {
  companyName?: string;
  merchantId?: number;
  valid: boolean;
}

export default function MerchantStatementUpload() {
  const { token } = useParams<{ token: string }>();
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Idempotency key: generated once per logical submission, reused on retry, rotated on success.
  const [idempotencyKey] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (!token) return;
    fetch(`/api/statement-upload/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setTokenError(data.message || "Invalid or expired upload link.");
          return;
        }
        const data = await res.json();
        setTokenInfo(data);
      })
      .catch(() => setTokenError("Could not validate the upload link. Please try again."))
      .finally(() => setTokenLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    const formData = new FormData();
    formData.append("statementFile", file);

    try {
      const res = await fetch(`/api/statement-upload/${token}`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.message || "Upload failed. Please try again.");
        // Keep same key so retry is deduplicated
        return;
      }
      setSuccess(true);
      // Key is single-use per mount; success state prevents re-submission
    } catch {
      setSubmitError("An unexpected error occurred. Please try again.");
      // Keep same key so retry is deduplicated
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader-token-validate" />
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription data-testid="text-token-error">{tokenError}</AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground mt-4 text-center">
              If you believe this is an error, please contact your Liberty Bancard representative.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-upload-success">Statement Uploaded!</h2>
            <p className="text-muted-foreground text-sm">
              Thank you! We've received your processing statement and will have your personalized savings analysis ready within 24 hours.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Liberty Bancard — Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle data-testid="text-upload-title">Upload Your Processing Statement</CardTitle>
          <CardDescription>
            {tokenInfo?.companyName
              ? `Uploading for ${tokenInfo.companyName}`
              : "Securely upload your statement for a free savings analysis."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="statementFile">Processing Statement (PDF or image)</Label>
              <Input
                id="statementFile"
                data-testid="input-statement-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Accepted formats: PDF, PNG, JPG, TIFF. Max 10 MB.
              </p>
            </div>

            {submitError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription data-testid="text-submit-error">{submitError}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!file || submitting}
              data-testid="button-upload-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Statement
                </>
              )}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-4 text-center">
            Your statement is transmitted securely and used only to generate your savings analysis. Liberty Bancard — Eligibility, underwriting, card brand rules, and applicable laws apply.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
